import type { GroupDO } from './group.ts';
import type { MatchmakerDO } from './matchmaker.ts';

export interface Env {
  MATCHMAKER: DurableObjectNamespace<MatchmakerDO>;
  GROUP: DurableObjectNamespace<GroupDO>;
  ASSETS: Fetcher;
  /** Secret: HMAC key for session cookies. */
  AUTH_SECRET: string;
  /** Secret: VAPID private key (base64url, P-256 scalar). */
  VAPID_PRIVATE_KEY: string;
  /** Public VAPID key (base64url, uncompressed P-256 point). */
  VAPID_PUBLIC_KEY: string;
  /** VAPID subject, e.g. mailto:owner@example.com */
  VAPID_SUBJECT: string;
}
