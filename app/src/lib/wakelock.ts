/**
 * Screen Wake Lock during an active rally: keeps the screen (and therefore
 * GPS + the WebSocket) alive while people navigate to the rally point.
 */

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!('wakeLock' in navigator) || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Low battery or platform refusal — non-fatal.
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') void acquire();
});

export function setWakeLock(enabled: boolean): void {
  wanted = enabled;
  if (enabled) {
    void acquire();
  } else {
    void sentinel?.release();
    sentinel = null;
  }
}
