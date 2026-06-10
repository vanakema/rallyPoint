/**
 * Edge entry point: anonymous session auth, WebSocket routing to the
 * Durable Objects, and a couple of tiny JSON endpoints. Static PWA assets
 * are served by the assets binding (see wrangler.jsonc); only /api/* and
 * /ws/* reach this code.
 */
import {
  createSessionCookieValue,
  sessionSetCookieHeader,
  userIdFromRequest,
} from './auth.ts';
import type { Env } from './env.ts';
import { lobbyName } from './matchmaker.ts';

export { GroupDO } from './group.ts';
export { MatchmakerDO } from './matchmaker.ts';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/api/health') {
      return Response.json({ ok: true });
    }

    if (pathname === '/api/config') {
      return Response.json({ vapidPublicKey: env.VAPID_PUBLIC_KEY });
    }

    if (pathname === '/api/session' && request.method === 'POST') {
      return handleSession(request, env);
    }

    if (pathname === '/ws/lobby' || pathname.startsWith('/ws/group/')) {
      return handleWebSocket(request, env, pathname);
    }

    // Anything else under run_worker_first patterns is unknown.
    if (pathname.startsWith('/api/') || pathname.startsWith('/ws/')) {
      return Response.json({ error: 'not found' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

async function handleSession(request: Request, env: Env): Promise<Response> {
  const existing = await userIdFromRequest(request, env.AUTH_SECRET);
  if (existing) {
    return Response.json({ userId: existing }, { headers: JSON_HEADERS });
  }
  const userId = crypto.randomUUID();
  const cookie = await createSessionCookieValue(userId, env.AUTH_SECRET);
  return Response.json(
    { userId },
    { headers: { ...JSON_HEADERS, 'Set-Cookie': sessionSetCookieHeader(cookie) } },
  );
}

async function handleWebSocket(request: Request, env: Env, pathname: string): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('expected websocket upgrade', { status: 426 });
  }

  // Browsers always send Origin on WebSocket upgrades; reject cross-site
  // attempts (cookies are SameSite=Lax, this is defense in depth). Non-browser
  // clients (tests, curl) send no Origin and authenticate by cookie alone.
  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return new Response('cross-origin websocket rejected', { status: 403 });
  }

  const userId = await userIdFromRequest(request, env.AUTH_SECRET);
  if (!userId) return new Response('unauthorized', { status: 401 });

  // Re-issue the request with a trusted identity header for the DO. The
  // header cannot be spoofed externally because only this worker can reach
  // the Durable Objects.
  const forwarded = new Request(request);
  forwarded.headers.set('X-RP-User', userId);

  if (pathname === '/ws/lobby') {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(lobbyName()));
    return stub.fetch(forwarded);
  }

  const groupId = pathname.slice('/ws/group/'.length);
  if (!groupId || groupId.length > 64 || groupId.includes('/')) {
    return new Response('bad group id', { status: 400 });
  }
  const stub = env.GROUP.get(env.GROUP.idFromName(groupId));
  return stub.fetch(forwarded);
}
