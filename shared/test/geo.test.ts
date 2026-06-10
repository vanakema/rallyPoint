import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  centroid,
  distanceMeters,
  formatDistance,
  shortestAngleDelta,
} from '../src/geo.ts';

// Reference points checked against established geodesic calculators.
const EIFFEL = { lat: 48.8584, lng: 2.2945 };
const LOUVRE = { lat: 48.8606, lng: 2.3376 };

describe('distanceMeters', () => {
  it('returns 0 for identical points', () => {
    expect(distanceMeters(EIFFEL, EIFFEL)).toBe(0);
  });

  it('matches a known city-scale distance (Eiffel Tower -> Louvre ~3.17 km)', () => {
    const d = distanceMeters(EIFFEL, LOUVRE);
    expect(d).toBeGreaterThan(3100);
    expect(d).toBeLessThan(3250);
  });

  it('is accurate at meetup scale (~111.2 m per 0.001 deg latitude)', () => {
    const a = { lat: 40.0, lng: -75.0 };
    const b = { lat: 40.001, lng: -75.0 };
    expect(distanceMeters(a, b)).toBeCloseTo(111.2, 0);
  });

  it('is symmetric', () => {
    expect(distanceMeters(EIFFEL, LOUVRE)).toBeCloseTo(distanceMeters(LOUVRE, EIFFEL), 6);
  });

  it('handles the antimeridian', () => {
    const west = { lat: 0, lng: 179.999 };
    const east = { lat: 0, lng: -179.999 };
    expect(distanceMeters(west, east)).toBeLessThan(300);
  });
});

describe('bearingDegrees', () => {
  const origin = { lat: 0, lng: 0 };

  it('points north', () => {
    expect(bearingDegrees(origin, { lat: 1, lng: 0 })).toBeCloseTo(0, 5);
  });
  it('points east', () => {
    expect(bearingDegrees(origin, { lat: 0, lng: 1 })).toBeCloseTo(90, 5);
  });
  it('points south', () => {
    expect(bearingDegrees(origin, { lat: -1, lng: 0 })).toBeCloseTo(180, 5);
  });
  it('points west', () => {
    expect(bearingDegrees(origin, { lat: 0, lng: -1 })).toBeCloseTo(270, 5);
  });
});

describe('centroid', () => {
  it('returns null for empty input', () => {
    expect(centroid([])).toBeNull();
  });

  it('returns the point itself for a single member', () => {
    expect(centroid([EIFFEL])).toEqual(EIFFEL);
  });

  it('averages a square of points to its center', () => {
    const c = centroid([
      { lat: 10, lng: 20 },
      { lat: 12, lng: 20 },
      { lat: 10, lng: 22 },
      { lat: 12, lng: 22 },
    ]);
    expect(c).toEqual({ lat: 11, lng: 21 });
  });
});

describe('formatDistance', () => {
  it('uses meters under 1 km', () => {
    expect(formatDistance(42.4)).toBe('42 m');
  });
  it('uses km with 2 decimals under 10 km', () => {
    expect(formatDistance(3170)).toBe('3.17 km');
  });
  it('uses km with 1 decimal above 10 km', () => {
    expect(formatDistance(12_340)).toBe('12.3 km');
  });
  it('handles non-finite input', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
  });
});

describe('shortestAngleDelta', () => {
  it('goes the short way across 0/360', () => {
    expect(shortestAngleDelta(350, 10)).toBe(20);
    expect(shortestAngleDelta(10, 350)).toBe(-20);
  });
  it('returns 0 for equal angles', () => {
    expect(shortestAngleDelta(123, 123)).toBe(0);
  });
  it('maps 180 to +180 (never -180)', () => {
    expect(shortestAngleDelta(0, 180)).toBe(180);
  });
});
