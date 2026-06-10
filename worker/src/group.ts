/**
 * GroupDO — one Durable Object per group. Authoritative for membership and
 * rally state (persisted in the DO's SQLite database) and fans live member
 * positions out over hibernating WebSockets.
 *
 * Positions are deliberately kept in memory only: they repopulate from
 * clients within seconds after an eviction, never hit storage (privacy +
 * free-tier row-write budget), and vanish when the group dissolves.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  groupClientMessageSchema,
  type GroupServerMessage,
  type MemberInfo,
  type Position,
  type PushSubscriptionJson,
} from '@rallypoint/shared/protocol';
import type { Env } from './env.ts';
import { sendPush } from './push.ts';

/** Groups with no activity for this long are dissolved by the alarm. */
const GROUP_TTL_MS = 24 * 60 * 60 * 1000;
/** Throttle for persisting the activity timestamp. */
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

interface Attachment {
  userId: string;
}

export class GroupDO extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;
  private positions = new Map<string, Position & { ts: number }>();
  private lastActivityWrite = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        joined_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_subs (
        endpoint TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        sub_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // -------------------------------------------------------------------------
  // RPC (called by MatchmakerDO)
  // -------------------------------------------------------------------------

  async addMembers(groupId: string, newMembers: { id: string; name: string }[]): Promise<void> {
    const now = Date.now();
    this.setMeta('groupId', groupId);
    const added: MemberInfo[] = [];
    for (const member of newMembers) {
      const existing = this.sql
        .exec('SELECT id FROM members WHERE id = ?', member.id)
        .toArray();
      if (existing.length > 0) continue;
      this.sql.exec(
        'INSERT INTO members (id, name, joined_at) VALUES (?, ?, ?)',
        member.id,
        member.name,
        now,
      );
      added.push({ id: member.id, name: member.name, online: false, pos: null });
    }
    for (const member of added) {
      this.broadcast({ t: 'member:joined', member });
    }
    this.touchActivity(true);
    await this.ensureTtlAlarm();
  }

  // -------------------------------------------------------------------------
  // WebSocket lifecycle
  // -------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const userId = request.headers.get('X-RP-User');
    if (!userId) return new Response('unauthorized', { status: 401 });
    if (!this.isMember(userId)) {
      return new Response('not a member of this group', { status: 403 });
    }

    // Replace any previous socket for this user.
    for (const ws of this.ctx.getWebSockets()) {
      if (this.userIdFor(ws) === userId) ws.close(1000, 'replaced by newer connection');
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies Attachment);

    this.send(server, this.snapshot());
    this.broadcast({ t: 'member:online', userId, online: true }, server);
    this.touchActivity();
    await this.ensureTtlAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const userId = this.userIdFor(ws);
    if (!userId) return ws.close(1011, 'unknown socket');

    let parsed;
    try {
      parsed = groupClientMessageSchema.parse(JSON.parse(String(raw)));
    } catch {
      return this.send(ws, { t: 'error', code: 'bad_message', message: 'invalid message' });
    }

    switch (parsed.t) {
      case 'pos': {
        const pos = { lat: parsed.lat, lng: parsed.lng, acc: parsed.acc, ts: Date.now() };
        this.positions.set(userId, pos);
        this.broadcast({ t: 'pos', userId, ...pos }, ws);
        this.touchActivity();
        break;
      }
      case 'rally:start':
      case 'rally:stop': {
        const isRallying = parsed.t === 'rally:start';
        this.setMeta('isRallying', isRallying ? '1' : '0');
        this.broadcast({ t: 'rally', isRallying });
        this.touchActivity(true);
        if (isRallying) {
          const groupId = this.getMeta('groupId') ?? '';
          await this.pushToOfflineMembers(userId, groupId);
        }
        break;
      }
      case 'leave':
        await this.removeMember(userId);
        break;
      case 'push:subscribe':
        this.sql.exec(
          'INSERT OR REPLACE INTO push_subs (endpoint, user_id, sub_json) VALUES (?, ?, ?)',
          parsed.subscription.endpoint,
          userId,
          JSON.stringify(parsed.subscription),
        );
        break;
    }
  }

  override webSocketClose(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  /** TTL alarm: dissolve the group after sustained inactivity. */
  override async alarm(): Promise<void> {
    const lastActivity = Number(this.getMeta('lastActivity') ?? 0);
    if (Date.now() - lastActivity >= GROUP_TTL_MS) {
      await this.dissolve();
    } else {
      await this.ctx.storage.setAlarm(lastActivity + GROUP_TTL_MS);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private handleDisconnect(ws: WebSocket): void {
    const userId = this.userIdFor(ws);
    if (!userId) return;
    const stillConnected = this.ctx
      .getWebSockets()
      .some((other) => other !== ws && this.userIdFor(other) === userId);
    if (!stillConnected) {
      this.broadcast({ t: 'member:online', userId, online: false }, ws);
    }
  }

  private async removeMember(userId: string): Promise<void> {
    this.sql.exec('DELETE FROM members WHERE id = ?', userId);
    this.sql.exec('DELETE FROM push_subs WHERE user_id = ?', userId);
    this.positions.delete(userId);

    for (const ws of this.ctx.getWebSockets()) {
      if (this.userIdFor(ws) === userId) {
        this.send(ws, { t: 'removed' });
        ws.close(1000, 'left group');
      }
    }
    this.broadcast({ t: 'member:left', userId });

    const remaining = this.sql.exec('SELECT COUNT(*) AS n FROM members').one().n as number;
    if (remaining === 0) {
      await this.dissolve();
    } else {
      this.touchActivity(true);
    }
  }

  private async dissolve(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: 'removed' });
      ws.close(1000, 'group dissolved');
    }
    this.positions.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async pushToOfflineMembers(senderId: string, groupId: string): Promise<void> {
    const online = new Set(
      this.ctx.getWebSockets().map((ws) => this.userIdFor(ws)).filter(Boolean),
    );
    const rows = this.sql
      .exec('SELECT endpoint, user_id, sub_json FROM push_subs')
      .toArray() as { endpoint: string; user_id: string; sub_json: string }[];

    for (const row of rows) {
      if (row.user_id === senderId || online.has(row.user_id)) continue;
      const subscription = JSON.parse(row.sub_json) as PushSubscriptionJson;
      const alive = await sendPush(this.env, subscription, {
        title: 'Rally!',
        body: 'Time to meet up with your group.',
        url: `/app/${groupId}`,
      });
      if (!alive) {
        this.sql.exec('DELETE FROM push_subs WHERE endpoint = ?', row.endpoint);
      }
    }
  }

  private snapshot(): GroupServerMessage {
    const online = new Set(
      this.ctx.getWebSockets().map((ws) => this.userIdFor(ws)).filter(Boolean),
    );
    const members = (
      this.sql.exec('SELECT id, name FROM members ORDER BY joined_at').toArray() as {
        id: string;
        name: string;
      }[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      online: online.has(row.id),
      pos: this.positions.get(row.id) ?? null,
    }));
    return {
      t: 'state',
      groupId: this.getMeta('groupId') ?? '',
      isRallying: this.getMeta('isRallying') === '1',
      members,
    };
  }

  private isMember(userId: string): boolean {
    return this.sql.exec('SELECT id FROM members WHERE id = ?', userId).toArray().length > 0;
  }

  private userIdFor(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.userId ?? null;
  }

  private touchActivity(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastActivityWrite < ACTIVITY_WRITE_INTERVAL_MS) return;
    this.lastActivityWrite = now;
    this.setMeta('lastActivity', String(now));
  }

  private async ensureTtlAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + GROUP_TTL_MS);
    }
  }

  private getMeta(key: string): string | null {
    const rows = this.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray();
    return rows.length > 0 ? (rows[0].value as string) : null;
  }

  private setMeta(key: string, value: string): void {
    this.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
  }

  private send(ws: WebSocket, message: GroupServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already closing; close handler cleans up.
    }
  }

  private broadcast(message: GroupServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude) continue;
      try {
        ws.send(data);
      } catch {
        // Socket already closing; close handler cleans up.
      }
    }
  }
}
