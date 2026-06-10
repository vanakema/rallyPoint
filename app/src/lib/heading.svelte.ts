/**
 * Reactive compass heading (degrees clockwise from north).
 *
 * Sources, in order of preference:
 *  - `deviceorientationabsolute` (Chromium): heading = 360 - alpha
 *  - `deviceorientation` with `webkitCompassHeading` (iOS Safari) — already
 *    a compass heading; requires DeviceOrientationEvent.requestPermission()
 *    from a user gesture on iOS 13+.
 */

type IOSDeviceOrientationEvent = DeviceOrientationEvent & {
  webkitCompassHeading?: number;
};

class HeadingWatcher {
  /** Current heading, or null when no absolute source is available. */
  heading = $state<number | null>(null);
  /** 'idle' | 'needs-permission' | 'active' | 'unsupported' */
  status = $state<'idle' | 'needs-permission' | 'active' | 'unsupported'>('idle');
  #listening = false;

  /** Safe to call repeatedly; call requestPermission() from a tap on iOS. */
  start(): void {
    if (this.#listening || this.status === 'unsupported') return;
    if (!('DeviceOrientationEvent' in window)) {
      this.status = 'unsupported';
      return;
    }
    const needsPermission =
      typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
        .requestPermission === 'function';
    if (needsPermission) {
      this.status = 'needs-permission';
      return;
    }
    this.#listen();
  }

  /** Must be invoked from a user gesture (iOS requirement). */
  async requestPermission(): Promise<void> {
    try {
      const request = (
        DeviceOrientationEvent as unknown as {
          requestPermission: () => Promise<'granted' | 'denied'>;
        }
      ).requestPermission;
      const result = await request();
      if (result === 'granted') {
        this.#listen();
      } else {
        this.status = 'unsupported';
      }
    } catch {
      this.status = 'unsupported';
    }
  }

  #listen(): void {
    if (this.#listening) return;
    this.#listening = true;
    this.status = 'active';

    const onAbsolute = (event: DeviceOrientationEvent) => {
      if (event.alpha === null) return;
      this.heading = (360 - event.alpha) % 360;
    };
    const onOrientation = (event: IOSDeviceOrientationEvent) => {
      if (typeof event.webkitCompassHeading === 'number') {
        this.heading = event.webkitCompassHeading;
      } else if (event.absolute && event.alpha !== null) {
        this.heading = (360 - event.alpha) % 360;
      }
    };

    const hasAbsoluteEvent = 'ondeviceorientationabsolute' in window;
    if (hasAbsoluteEvent) {
      window.addEventListener(
        'deviceorientationabsolute',
        onAbsolute as EventListener,
        { passive: true },
      );
    } else {
      window.addEventListener('deviceorientation', onOrientation as EventListener, {
        passive: true,
      });
    }
  }
}

export const compass = new HeadingWatcher();
