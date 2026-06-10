/**
 * MatchmakerDO — the "lobby" room where syncing users are clustered into
 * groups by physical proximity.
 *
 * v1 uses a single global instance (see lobbyName()), which is trivially
 * correct (no cell-boundary edge cases) and comfortably handles hobby-scale
 * load: only users actively holding the Sync button are connected, and a
 * Durable Object processes messages single-threaded, so group formation is
 * atomic. To shard later, derive the lobby name from a coarse geographic
 * cell of the user's first position — the rest of the code is unchanged.
 */
import { DurableObject } from 'cloudflare:workers';
import {
  lobbyClientMessageSchema,
  MATCH,
  type LobbyServerMessage,
} from '@rallypoint/shared/protocol';
import {
  clearPairsFor,
  evaluateClusters,
  pairKey,
  type LobbyPeer,
} from './clustering.ts';
import type { Env } from './env.ts';

/** Routing hook: where does a user at (lat, lng) go to find peers? */
export function lobbyName(_lat?: number, _lng?: number): string {
  return 'global';
}

interface Attachment {
  userId: string;
  name?: string;
  groupId?: string;
}

export class MatchmakerDO extends DurableObject<Env> {
  /** Runtime peer state, rebuilt from socket attachments after hibernation. */
  private peers = new Map<WebSocket, LobbyPeer>();
  private pairSince = new Map<string, number>();

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const userId = request.headers.get('X-RP-User');
    if (!userId) return new Response('unauthorized', { status: 401 });

    // A reconnecting user replaces their previous socket.
    for (const ws of this.ctx.getWebSockets()) {
      if (this.peerFor(ws)?.userId === userId) {
        ws.close(1000, 'replaced by newer connection');
        this.dropSocket(ws);
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId } satisfies Attachment);
    this.peers.set(server, { userId, name: 'anonymous' });
    await this.ensureSweepAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const peer = this.peerFor(ws);
    if (!peer) return ws.close(1011, 'unknown peer');

    let parsed;
    try {
      parsed = lobbyClientMessageSchema.parse(JSON.parse(String(raw)));
    } catch {
      return this.send(ws, { t: 'error', code: 'bad_message', message: 'invalid message' });
    }

    if (parsed.t === 'hello') {
      peer.name = parsed.name;
      peer.groupId = parsed.groupId;
      ws.serializeAttachment({
        userId: peer.userId,
        name: peer.name,
        groupId: peer.groupId,
      } satisfies Attachment);
      return;
    }

    // pos
    peer.pos = { lat: parsed.lat, lng: parsed.lng, acc: parsed.acc, ts: Date.now() };
    const result = evaluateClusters(peer, this.peers.values(), this.pairSince, Date.now());
    this.send(ws, { t: 'peers', count: result.partners.length });

    if (result.cluster) {
      await this.formGroup(result.cluster, result.groupId);
    }
  }

  override webSocketClose(ws: WebSocket): void {
    this.dropSocket(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.dropSocket(ws);
  }

  /** Periodic sweep: drop peers that stopped reporting positions. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    for (const [ws, peer] of this.peers) {
      if (peer.pos && now - peer.pos.ts > MATCH.PEER_TTL_MS) {
        ws.close(1000, 'stale');
        this.dropSocket(ws);
      }
    }
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(now + MATCH.PEER_TTL_MS);
    }
  }

  private async formGroup(cluster: LobbyPeer[], existingGroupId?: string): Promise<void> {
    const groupId = existingGroupId ?? crypto.randomUUID();
    const stub = this.env.GROUP.get(this.env.GROUP.idFromName(groupId));
    await stub.addMembers(
      groupId,
      cluster.map((p) => ({ id: p.userId, name: p.name })),
    );

    const memberIds = new Set(cluster.map((p) => p.userId));
    for (const [ws, peer] of this.peers) {
      if (!memberIds.has(peer.userId)) continue;
      this.send(ws, { t: 'grouped', groupId });
      ws.close(1000, 'grouped');
      this.dropSocket(ws);
    }
    // Stability state between two now-grouped members is irrelevant; pairs
    // with remaining lobby users were already cleared by dropSocket.
    for (const a of memberIds) {
      for (const b of memberIds) {
        if (a < b) this.pairSince.delete(pairKey(a, b));
      }
    }
  }

  private peerFor(ws: WebSocket): LobbyPeer | undefined {
    const existing = this.peers.get(ws);
    if (existing) return existing;
    // Rebuild after hibernation from the serialized attachment.
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment?.userId) return undefined;
    const peer: LobbyPeer = {
      userId: attachment.userId,
      name: attachment.name ?? 'anonymous',
      groupId: attachment.groupId,
    };
    this.peers.set(ws, peer);
    return peer;
  }

  private dropSocket(ws: WebSocket): void {
    const peer = this.peers.get(ws);
    if (peer) clearPairsFor(peer.userId, this.pairSince);
    this.peers.delete(ws);
  }

  private async ensureSweepAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + MATCH.PEER_TTL_MS);
    }
  }

  private send(ws: WebSocket, message: LobbyServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket already closing; the close handler cleans up.
    }
  }
}
