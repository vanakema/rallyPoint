/**
 * Wire protocol between client and server, shared so both sides compile
 * against the same shapes. Every message is a small JSON object with a
 * discriminating `t` field. The server validates all inbound messages
 * with these schemas; the client gets compile-time types for free.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const positionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** GPS accuracy radius in meters, as reported by the Geolocation API. */
  acc: z.number().min(0).max(100_000),
});
export type Position = z.infer<typeof positionSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});
export type PushSubscriptionJson = z.infer<typeof pushSubscriptionSchema>;

export interface MemberInfo {
  id: string;
  name: string;
  online: boolean;
  /** Last known position, if any has been reported this session. */
  pos: (Position & { ts: number }) | null;
}

// ---------------------------------------------------------------------------
// Lobby (proximity matchmaking) — client -> server
// ---------------------------------------------------------------------------

export const lobbyClientMessageSchema = z.discriminatedUnion('t', [
  /** First message after connecting. `groupId` joins newcomers to an existing group. */
  z.object({
    t: z.literal('hello'),
    name: z.string().trim().min(1).max(64),
    groupId: z.string().max(64).optional(),
  }),
  z.object({ t: z.literal('pos') }).extend(positionSchema.shape),
]);
export type LobbyClientMessage = z.infer<typeof lobbyClientMessageSchema>;

// Lobby — server -> client
export type LobbyServerMessage =
  /** Number of other syncing users currently within match range. */
  | { t: 'peers'; count: number }
  /** A group was formed; reconnect to /ws/group/:groupId. */
  | { t: 'grouped'; groupId: string }
  | { t: 'error'; code: string; message: string };

// ---------------------------------------------------------------------------
// Group room — client -> server
// ---------------------------------------------------------------------------

export const groupClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('pos') }).extend(positionSchema.shape),
  z.object({ t: z.literal('rally:start') }),
  z.object({ t: z.literal('rally:stop') }),
  z.object({ t: z.literal('leave') }),
  z.object({ t: z.literal('push:subscribe'), subscription: pushSubscriptionSchema }),
]);
export type GroupClientMessage = z.infer<typeof groupClientMessageSchema>;

// Group room — server -> client
export type GroupServerMessage =
  /** Full snapshot, sent on connect and after membership changes. */
  | { t: 'state'; groupId: string; isRallying: boolean; members: MemberInfo[] }
  | { t: 'pos'; userId: string; lat: number; lng: number; acc: number; ts: number }
  | { t: 'rally'; isRallying: boolean }
  | { t: 'member:joined'; member: MemberInfo }
  | { t: 'member:left'; userId: string }
  | { t: 'member:online'; userId: string; online: boolean }
  /** You are no longer a member (left, removed, or group dissolved). */
  | { t: 'removed' }
  | { t: 'error'; code: string; message: string };

// ---------------------------------------------------------------------------
// Matching parameters (single source of truth for client UX copy + server)
// ---------------------------------------------------------------------------

export const MATCH = {
  /** Base match radius in meters, before GPS accuracy widening. */
  BASE_RADIUS_M: 50,
  /** Cap on how much reported GPS inaccuracy can widen the radius. */
  MAX_ACCURACY_BONUS_M: 100,
  /** Two users must stay in range this long before a group forms. */
  STABILITY_MS: 2_000,
  /** Lobby peers silent for longer than this are dropped. */
  PEER_TTL_MS: 30_000,
} as const;

/** Effective pairwise match radius given both users' GPS accuracy. */
export function matchRadiusMeters(accA: number, accB: number): number {
  const bonus = Math.min(Math.max(accA, accB), MATCH.MAX_ACCURACY_BONUS_M);
  return MATCH.BASE_RADIUS_M + bonus;
}
