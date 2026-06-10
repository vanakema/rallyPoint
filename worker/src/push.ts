/**
 * Web Push (RFC 8030/8291/8292) via WebCrypto — replaces the 2015 app's
 * APNs certificates with VAPID keys and works for every browser's push
 * service from a Cloudflare Worker.
 */
import {
  buildPushPayload,
  type PushMessage,
  type PushSubscription,
} from '@block65/webcrypto-web-push';
import type { PushSubscriptionJson } from '@rallypoint/shared/protocol';
import type { Env } from './env.ts';

export interface RallyPushData {
  title: string;
  body: string;
  url: string;
}

/**
 * Sends a push to one subscription. Returns false when the subscription is
 * permanently gone (HTTP 404/410) and should be deleted.
 */
export async function sendPush(
  env: Env,
  subscription: PushSubscriptionJson,
  data: RallyPushData,
): Promise<boolean> {
  const message: PushMessage = {
    data: JSON.stringify(data),
    options: { ttl: 120, urgency: 'high' },
  };
  try {
    const payload = await buildPushPayload(message, subscription as PushSubscription, {
      subject: env.VAPID_SUBJECT,
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    });
    const res = await fetch(subscription.endpoint, payload);
    if (res.status === 404 || res.status === 410) return false;
    if (!res.ok) {
      console.warn('push send failed', res.status, await res.text().catch(() => ''));
    }
    return true;
  } catch (err) {
    console.warn('push send error', err);
    return true;
  }
}
