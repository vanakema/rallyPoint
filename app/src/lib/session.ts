/**
 * Anonymous identity: POST /api/session sets (or refreshes) the signed
 * httpOnly cookie and tells us our userId. Display name and last group
 * live in localStorage — losing them is harmless.
 */

let userId: string | null = null;

export async function ensureSession(): Promise<string> {
  if (userId) return userId;
  const res = await fetch('/api/session', { method: 'POST' });
  if (!res.ok) throw new Error(`session failed: ${res.status}`);
  const body = (await res.json()) as { userId: string };
  userId = body.userId;
  return userId;
}

export function currentUserId(): string | null {
  return userId;
}

const NAME_KEY = 'rp_name';
const GROUP_KEY = 'rp_groupId';

export function savedName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}
export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function savedGroupId(): string | null {
  return localStorage.getItem(GROUP_KEY);
}
export function saveGroupId(groupId: string | null): void {
  if (groupId) {
    localStorage.setItem(GROUP_KEY, groupId);
  } else {
    localStorage.removeItem(GROUP_KEY);
  }
}
