/**
 * Live group state, mirrored from the GroupDO over one WebSocket.
 * Everything the panes render derives from these signals; the rally point
 * is a pure derivation (centroid) of the same positions every client has.
 */
import { centroid, distanceMeters, type LatLng } from '@rallypoint/shared/geo';
import type {
  GroupClientMessage,
  GroupServerMessage,
  MemberInfo,
} from '@rallypoint/shared/protocol';
import { geo, type GeoFix } from './geo.svelte.ts';
import { currentUserId, saveGroupId } from './session.ts';
import { connectWS, type WSHandle } from './ws.ts';

/** Resend position at least this often even when standing still. */
const MAX_SILENCE_MS = 5_000;
/** Movement that triggers an immediate update. */
const MOVE_THRESHOLD_M = 3;
/** Floor between two sends. */
const MIN_INTERVAL_MS = 1_000;

export type MemberEntry = MemberInfo;

class GroupStore {
  status = $state<'idle' | 'connecting' | 'online' | 'reconnecting' | 'left'>('idle');
  groupId = $state<string | null>(null);
  isRallying = $state(false);
  members = $state<Record<string, MemberEntry>>({});

  rallyPoint: LatLng | null = $derived(
    centroid(
      Object.values(this.members)
        .map((m) => m.pos)
        .filter((p): p is NonNullable<MemberEntry['pos']> => p !== null),
    ),
  );

  othersCount = $derived(
    Object.keys(this.members).filter((id) => id !== currentUserId()).length,
  );

  #ws: WSHandle<GroupClientMessage> | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #lastSent: (GeoFix & { sentAt: number }) | null = null;

  connect(groupId: string): void {
    if (this.groupId === groupId && this.#ws) return;
    this.disconnect();
    this.groupId = groupId;
    this.status = 'connecting';

    this.#ws = connectWS<GroupServerMessage, GroupClientMessage>(`/ws/group/${groupId}`, {
      onOpen: () => {
        this.status = 'online';
        this.#lastSent = null;
        this.#maybeSendPosition();
      },
      onMessage: (message) => this.#handle(message),
      onDrop: () => {
        if (this.status === 'online') this.status = 'reconnecting';
      },
      maxAttempts: 4,
      onGiveUp: () => this.#leaveLocally(),
    });

    this.#timer = setInterval(() => this.#maybeSendPosition(), MIN_INTERVAL_MS);
  }

  disconnect(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#ws?.close();
    this.#ws = null;
    this.groupId = null;
    this.members = {};
    this.isRallying = false;
    this.status = 'idle';
  }

  leave(): void {
    this.#ws?.send({ t: 'leave' });
    this.#leaveLocally();
  }

  toggleRally(): void {
    this.#ws?.send({ t: this.isRallying ? 'rally:stop' : 'rally:start' });
  }

  sendPushSubscription(subscription: unknown): void {
    this.#ws?.send({
      t: 'push:subscribe',
      subscription,
    } as GroupClientMessage);
  }

  /** Distance in meters from me to a member, when both positions are known. */
  distanceTo(member: MemberEntry): number | null {
    const me = geo.position;
    if (!me || !member.pos) return null;
    return distanceMeters(me, member.pos);
  }

  #maybeSendPosition(): void {
    const pos = geo.position;
    if (!pos || !this.#ws?.isOpen) return;
    const now = Date.now();
    const last = this.#lastSent;
    if (last) {
      if (now - last.sentAt < MIN_INTERVAL_MS) return;
      const moved = distanceMeters(last, pos);
      if (moved < MOVE_THRESHOLD_M && now - last.sentAt < MAX_SILENCE_MS) return;
    }
    this.#lastSent = { ...pos, sentAt: now };
    this.#ws.send({ t: 'pos', lat: pos.lat, lng: pos.lng, acc: pos.acc });

    // Mirror my own position into the member list so the map/centroid see it
    // without a server round trip.
    const myId = currentUserId();
    if (myId && this.members[myId]) {
      this.members[myId].pos = { lat: pos.lat, lng: pos.lng, acc: pos.acc, ts: now };
    }
  }

  #handle(message: GroupServerMessage): void {
    switch (message.t) {
      case 'state': {
        const next: Record<string, MemberEntry> = {};
        for (const member of message.members) next[member.id] = member;
        this.members = next;
        this.isRallying = message.isRallying;
        break;
      }
      case 'pos': {
        const member = this.members[message.userId];
        if (member) {
          member.pos = { lat: message.lat, lng: message.lng, acc: message.acc, ts: message.ts };
          member.online = true;
        }
        break;
      }
      case 'rally':
        this.isRallying = message.isRallying;
        break;
      case 'member:joined':
        this.members[message.member.id] = message.member;
        break;
      case 'member:left':
        delete this.members[message.userId];
        break;
      case 'member:online': {
        const member = this.members[message.userId];
        if (member) member.online = message.online;
        break;
      }
      case 'removed':
        this.#leaveLocally();
        break;
      case 'error':
        console.warn('group error', message);
        break;
    }
  }

  #leaveLocally(): void {
    saveGroupId(null);
    this.disconnect();
    this.status = 'left';
  }
}

export const group = new GroupStore();
