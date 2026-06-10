/**
 * Generates a VAPID key pair for Web Push (RFC 8292) and prints both keys
 * base64url-encoded — the standard format used by PushManager.subscribe()
 * and web-push libraries.
 *
 *   node scripts/generate-vapid-keys.mjs
 */
const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

// Public key: 65-byte uncompressed EC point.
const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
// Private key: the JWK `d` parameter is already base64url.
const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${toBase64Url(rawPublic)}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
