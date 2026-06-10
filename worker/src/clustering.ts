/**
 * Pure proximity-clustering logic for the matchmaker, kept free of any
 * Cloudflare imports so it can be unit-tested directly.
 *
 * Model: every syncing user streams positions. When two users are within
 * `matchRadiusMeters` of each other, the pair gets a `since` timestamp.
 * Once a pair has been continuously in range for MATCH.STABILITY_MS, the
 * pair (plus any other users stably in range of the updating user) becomes
 * a group. This replaces the 2015 client-side timer/leader-election race
 * with a single-threaded, server-authoritative decision.
 */
import {
  MATCH,
  matchRadiusMeters,
  type Position,
} from '@rallypoint/shared/protocol';
import { distanceMeters } from '@rallypoint/shared/geo';

export interface LobbyPeer {
  userId: string;
  name: string;
  /** Set when this peer is adding members to an existing group. */
  groupId?: string;
  pos?: Position & { ts: number };
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function inRange(a: LobbyPeer, b: LobbyPeer, now: number): boolean {
  if (!a.pos || !b.pos) return false;
  if (now - a.pos.ts > MATCH.PEER_TTL_MS || now - b.pos.ts > MATCH.PEER_TTL_MS) {
    return false;
  }
  return distanceMeters(a.pos, b.pos) <= matchRadiusMeters(a.pos.acc, b.pos.acc);
}

export interface ClusterResult {
  /** Other peers currently in range of `subject` (regardless of stability). */
  partners: LobbyPeer[];
  /** Members of a newly stable cluster including `subject`, or null. */
  cluster: LobbyPeer[] | null;
  /** Existing group to join, if any cluster member is recruiting for one. */
  groupId?: string;
}

/**
 * Called after `subject`'s position update. Mutates `pairSince` to track
 * pair stability and decides whether a group should form now.
 */
export function evaluateClusters(
  subject: LobbyPeer,
  peers: Iterable<LobbyPeer>,
  pairSince: Map<string, number>,
  now: number,
): ClusterResult {
  const partners: LobbyPeer[] = [];
  const stable: LobbyPeer[] = [];

  for (const peer of peers) {
    if (peer.userId === subject.userId) continue;
    const key = pairKey(subject.userId, peer.userId);
    if (inRange(subject, peer, now)) {
      partners.push(peer);
      const since = pairSince.get(key);
      if (since === undefined) {
        pairSince.set(key, now);
      } else if (now - since >= MATCH.STABILITY_MS) {
        stable.push(peer);
      }
    } else {
      pairSince.delete(key);
    }
  }

  if (stable.length === 0) return { partners, cluster: null };

  const cluster = [subject, ...stable];
  const groupId = cluster.find((p) => p.groupId)?.groupId;
  return { partners, cluster, groupId };
}

/** Remove all pair-stability entries that involve `userId`. */
export function clearPairsFor(userId: string, pairSince: Map<string, number>): void {
  for (const key of pairSince.keys()) {
    const [a, b] = key.split('|');
    if (a === userId || b === userId) pairSince.delete(key);
  }
}
