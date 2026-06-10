/**
 * Geographic math shared by client and server.
 * All positions are { lat, lng } in degrees (WGS84); distances in meters;
 * bearings in degrees clockwise from true north, normalized to [0, 360).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from `from` to `to`, degrees in [0, 360). */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const phi1 = from.lat * DEG;
  const phi2 = to.lat * DEG;
  const dLng = (to.lng - from.lng) * DEG;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Centroid of a set of points — the rally point. Mean of coordinates is
 * accurate at meetup scale (members within a few km of each other).
 * Returns null for an empty set.
 */
export function centroid(points: LatLng[]): LatLng | null {
  if (points.length === 0) return null;
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

/** Human-readable distance: meters under 1 km, otherwise km. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 2 : 1)} km`;
}

/**
 * Shortest signed angular difference `target - current` in degrees,
 * in (-180, 180]. Used to animate the compass needle along the short arc.
 */
export function shortestAngleDelta(current: number, target: number): number {
  let delta = (target - current) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}
