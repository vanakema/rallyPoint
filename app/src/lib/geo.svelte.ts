/**
 * Reactive wrapper around the Geolocation API. One watchPosition for the
 * whole app; every consumer reads the same signal.
 */
import type { Position } from '@rallypoint/shared/protocol';

export type GeoFix = Position & { ts: number };

class GeoWatcher {
  position = $state<GeoFix | null>(null);
  /** 'denied' | 'unavailable' | null */
  error = $state<string | null>(null);
  #watchId: number | null = null;

  start(): void {
    if (this.#watchId !== null) return;
    if (!('geolocation' in navigator)) {
      this.error = 'unavailable';
      return;
    }
    this.#watchId = navigator.geolocation.watchPosition(
      (fix) => {
        this.error = null;
        this.position = {
          lat: fix.coords.latitude,
          lng: fix.coords.longitude,
          acc: fix.coords.accuracy ?? 1000,
          ts: fix.timestamp,
        };
      },
      (err) => {
        this.error = err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable';
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
  }
}

export const geo = new GeoWatcher();
