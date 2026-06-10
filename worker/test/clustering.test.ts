import { describe, expect, it } from 'vitest';
import { MATCH } from '@rallypoint/shared/protocol';
import {
  clearPairsFor,
  evaluateClusters,
  inRange,
  pairKey,
  type LobbyPeer,
} from '../src/clustering.ts';

const T0 = 1_750_000_000_000;

function peer(
  userId: string,
  lat: number,
  lng: number,
  opts: { acc?: number; ts?: number; groupId?: string } = {},
): LobbyPeer {
  return {
    userId,
    name: userId,
    groupId: opts.groupId,
    pos: { lat, lng, acc: opts.acc ?? 10, ts: opts.ts ?? T0 },
  };
}

// ~0.0001 deg latitude ≈ 11 m. Base point in a mid-latitude city.
const LAT = 39.7392;
const LNG = -104.9903;

describe('inRange', () => {
  it('matches users a few meters apart', () => {
    expect(inRange(peer('a', LAT, LNG), peer('b', LAT + 0.0001, LNG), T0)).toBe(true);
  });

  it('rejects users far apart', () => {
    expect(inRange(peer('a', LAT, LNG), peer('b', LAT + 0.01, LNG), T0)).toBe(false);
  });

  it('widens the radius by GPS accuracy, capped', () => {
    // ~120 m apart: outside 50m+10m, inside the widened 50m+100m radius.
    const far = peer('b', LAT + 0.00108, LNG);
    expect(inRange(peer('a', LAT, LNG, { acc: 10 }), far, T0)).toBe(false);
    expect(inRange(peer('a', LAT, LNG, { acc: 100 }), far, T0)).toBe(true);
    // ~178 m apart: even huge reported inaccuracy is capped at +100 m.
    const veryFar = peer('b', LAT + 0.0016, LNG);
    expect(inRange(peer('a', LAT, LNG, { acc: 500 }), veryFar, T0)).toBe(false);
  });

  it('ignores peers with stale positions', () => {
    const stale = peer('b', LAT, LNG, { ts: T0 - MATCH.PEER_TTL_MS - 1 });
    expect(inRange(peer('a', LAT, LNG), stale, T0)).toBe(false);
  });

  it('ignores peers with no position yet', () => {
    expect(inRange(peer('a', LAT, LNG), { userId: 'b', name: 'b' }, T0)).toBe(false);
  });
});

describe('evaluateClusters', () => {
  it('does not group on first contact, then groups after the stability window', () => {
    const a = peer('a', LAT, LNG);
    const b = peer('b', LAT + 0.0001, LNG);
    const pairSince = new Map<string, number>();

    const first = evaluateClusters(a, [a, b], pairSince, T0);
    expect(first.partners.map((p) => p.userId)).toEqual(['b']);
    expect(first.cluster).toBeNull();

    const tooSoon = evaluateClusters(a, [a, b], pairSince, T0 + MATCH.STABILITY_MS - 1);
    expect(tooSoon.cluster).toBeNull();

    const now = T0 + MATCH.STABILITY_MS;
    b.pos = { ...b.pos!, ts: now };
    a.pos = { ...a.pos!, ts: now };
    const stable = evaluateClusters(a, [a, b], pairSince, now);
    expect(stable.cluster?.map((p) => p.userId).sort()).toEqual(['a', 'b']);
  });

  it('resets stability when users drift out of range', () => {
    const a = peer('a', LAT, LNG);
    const b = peer('b', LAT + 0.0001, LNG);
    const pairSince = new Map<string, number>();

    evaluateClusters(a, [a, b], pairSince, T0);
    // b walks away…
    b.pos = { lat: LAT + 0.01, lng: LNG, acc: 10, ts: T0 + 500 };
    const apart = evaluateClusters(a, [a, b], pairSince, T0 + 500);
    expect(apart.partners).toHaveLength(0);
    expect(pairSince.size).toBe(0);

    // …and comes back: the clock starts over.
    b.pos = { lat: LAT + 0.0001, lng: LNG, acc: 10, ts: T0 + 1000 };
    a.pos = { ...a.pos!, ts: T0 + 1000 };
    const back = evaluateClusters(a, [a, b], pairSince, T0 + MATCH.STABILITY_MS + 500);
    expect(back.cluster).toBeNull();
  });

  it('groups three users standing together', () => {
    const a = peer('a', LAT, LNG);
    const b = peer('b', LAT + 0.0001, LNG);
    const c = peer('c', LAT, LNG + 0.0001);
    const pairSince = new Map<string, number>();

    evaluateClusters(a, [a, b, c], pairSince, T0);
    const now = T0 + MATCH.STABILITY_MS;
    for (const p of [a, b, c]) p.pos = { ...p.pos!, ts: now };
    const result = evaluateClusters(a, [a, b, c], pairSince, now);
    expect(result.cluster?.map((p) => p.userId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('excludes a distant third user', () => {
    const a = peer('a', LAT, LNG);
    const b = peer('b', LAT + 0.0001, LNG);
    const far = peer('far', LAT + 0.05, LNG);
    const pairSince = new Map<string, number>();

    evaluateClusters(a, [a, b, far], pairSince, T0);
    const now = T0 + MATCH.STABILITY_MS;
    for (const p of [a, b, far]) p.pos = { ...p.pos!, ts: now };
    const result = evaluateClusters(a, [a, b, far], pairSince, now);
    expect(result.cluster?.map((p) => p.userId).sort()).toEqual(['a', 'b']);
  });

  it('adopts an existing groupId when a cluster member is recruiting', () => {
    const recruiter = peer('r', LAT, LNG, { groupId: 'group-123' });
    const newcomer = peer('n', LAT + 0.0001, LNG);
    const pairSince = new Map<string, number>();

    evaluateClusters(newcomer, [recruiter, newcomer], pairSince, T0);
    const now = T0 + MATCH.STABILITY_MS;
    recruiter.pos = { ...recruiter.pos!, ts: now };
    newcomer.pos = { ...newcomer.pos!, ts: now };
    const result = evaluateClusters(newcomer, [recruiter, newcomer], pairSince, now);
    expect(result.groupId).toBe('group-123');
  });
});

describe('clearPairsFor', () => {
  it('removes only pairs involving the user', () => {
    const pairSince = new Map<string, number>([
      [pairKey('a', 'b'), T0],
      [pairKey('b', 'c'), T0],
      [pairKey('c', 'd'), T0],
    ]);
    clearPairsFor('b', pairSince);
    expect([...pairSince.keys()]).toEqual([pairKey('c', 'd')]);
  });
});
