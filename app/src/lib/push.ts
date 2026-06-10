/** Web Push subscription helper (VAPID). */

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

/**
 * Requests notification permission (call from a user gesture) and returns
 * the serialized PushSubscription, or null if unavailable/denied.
 */
export async function subscribeForPush(): Promise<unknown | null> {
  if (!pushSupported()) return null;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;
  const config = (await fetch('/api/config').then((r) => r.json())) as {
    vapidPublicKey: string;
  };
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(config.vapidPublicKey).buffer as ArrayBuffer,
    }));
  return subscription.toJSON();
}
