/**
 * End-to-end protocol test. Simulates real clients (HTTP session + WebSockets
 * + GPS streams) against a running RallyPoint server and walks the entire
 * product flow: proximity sync -> group formation -> live positions ->
 * rally -> add-member -> leave.
 *
 * Usage:
 *   node tests/integration.mjs                     # spawns wrangler dev
 *   BASE_URL=https://host node tests/integration.mjs  # against a deployment
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import WebSocket from 'ws';

const EXTERNAL = !!process.env.BASE_URL;
const PORT = 8788;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const WS_BASE = BASE.replace(/^http/, 'ws');

// Mid-city test coordinates; ~0.00005 deg lat ≈ 5.5 m.
const HERE = { lat: 39.7392, lng: -104.9903 };
const NEARBY = { lat: HERE.lat + 0.00005, lng: HERE.lng };
const FAR = { lat: HERE.lat + 0.05, lng: HERE.lng }; // ~5.5 km away

let wranglerProc = null;
const failures = [];
let passes = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    passes += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name} ${detail}`);
  }
}

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = null;
    this.userId = null;
    this.ws = null;
    this.inbox = [];
    this.waiters = [];
    this.posTimer = null;
  }

  async createSession() {
    const res = await fetch(`${BASE}/api/session`, { method: 'POST' });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) throw new Error('no session cookie');
    this.cookie = setCookie.split(';')[0];
    this.userId = (await res.json()).userId;
  }

  connect(path) {
    return new Promise((resolve, reject) => {
      this.inbox = [];
      this.ws = new WebSocket(`${WS_BASE}${path}`, {
        headers: { Cookie: this.cookie },
      });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());
        this.inbox.push(message);
        for (const waiter of [...this.waiters]) waiter();
      });
    });
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  streamPosition(pos, intervalMs = 700) {
    const send = () =>
      this.ws?.readyState === WebSocket.OPEN &&
      this.send({ t: 'pos', lat: pos.lat, lng: pos.lng, acc: 10 });
    send();
    this.posTimer = setInterval(send, intervalMs);
  }

  stopStreaming() {
    clearInterval(this.posTimer);
    this.posTimer = null;
  }

  /** Wait until a message matching `predicate` has arrived (incl. past ones). */
  waitFor(predicate, timeoutMs = 10_000, label = 'message') {
    const check = () => this.inbox.find(predicate);
    const found = check();
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `${this.name}: timeout waiting for ${label}; inbox=${JSON.stringify(this.inbox.map((m) => m.t))}`,
          ),
        );
      }, timeoutMs);
      const waiter = () => {
        const match = check();
        if (match) {
          cleanup();
          resolve(match);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
      };
      this.waiters.push(waiter);
    });
  }

  close() {
    this.stopStreaming();
    this.ws?.close();
    this.ws = null;
  }
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server did not become ready');
}

async function main() {
  if (!EXTERNAL) {
    console.log('starting wrangler dev…');
    wranglerProc = spawn(
      'pnpm',
      ['exec', 'wrangler', 'dev', '--port', String(PORT), '--show-interactive-dev-session', 'false'],
      { cwd: new URL('../worker', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    wranglerProc.stdout.on('data', () => {});
    wranglerProc.stderr.on('data', () => {});
  }
  await waitForServer();
  console.log(`testing against ${BASE}\n`);

  // --- sessions ------------------------------------------------------------
  console.log('sessions');
  const alice = new Client('alice');
  const bob = new Client('bob');
  const carol = new Client('carol');
  await Promise.all([alice.createSession(), bob.createSession(), carol.createSession()]);
  ok('three distinct anonymous identities', new Set([alice.userId, bob.userId, carol.userId]).size === 3);

  const reuse = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { Cookie: alice.cookie },
  }).then((r) => r.json());
  ok('session cookie is stable across requests', reuse.userId === alice.userId);

  const unauthWs = new WebSocket(`${WS_BASE}/ws/lobby`);
  const unauthRejected = await new Promise((resolve) => {
    unauthWs.on('unexpected-response', (_req, res) => resolve(res.statusCode === 401));
    unauthWs.on('open', () => resolve(false));
    unauthWs.on('error', () => resolve(true));
  });
  ok('lobby rejects connections without a session', unauthRejected);

  // --- proximity sync ------------------------------------------------------
  console.log('proximity sync');
  await alice.connect('/ws/lobby');
  await bob.connect('/ws/lobby');
  await carol.connect('/ws/lobby');
  alice.send({ t: 'hello', name: 'Alice' });
  bob.send({ t: 'hello', name: 'Bob' });
  carol.send({ t: 'hello', name: 'Carol' });
  alice.streamPosition(HERE);
  bob.streamPosition(NEARBY);
  carol.streamPosition(FAR);

  const [aliceGrouped, bobGrouped] = await Promise.all([
    alice.waitFor((m) => m.t === 'grouped', 15_000, 'grouped'),
    bob.waitFor((m) => m.t === 'grouped', 15_000, 'grouped'),
  ]);
  ok('nearby users are grouped together', aliceGrouped.groupId === bobGrouped.groupId);
  ok(
    'peer counts were reported while syncing',
    alice.inbox.some((m) => m.t === 'peers' && m.count >= 1),
  );
  await new Promise((r) => setTimeout(r, 1500));
  ok('distant user is NOT grouped', !carol.inbox.some((m) => m.t === 'grouped'));
  const groupId = aliceGrouped.groupId;
  alice.stopStreaming();
  bob.stopStreaming();

  // --- group room ----------------------------------------------------------
  console.log('group room');
  await alice.connect(`/ws/group/${groupId}`);
  const aliceState = await alice.waitFor((m) => m.t === 'state', 5000, 'state');
  ok('snapshot lists both members', aliceState.members.length === 2);
  ok(
    'snapshot carries member names',
    aliceState.members.some((m) => m.name === 'Alice') &&
      aliceState.members.some((m) => m.name === 'Bob'),
  );
  ok('group starts out not rallying', aliceState.isRallying === false);

  await bob.connect(`/ws/group/${groupId}`);
  await bob.waitFor((m) => m.t === 'state', 5000, 'state');
  await alice.waitFor(
    (m) => m.t === 'member:online' && m.userId === bob.userId && m.online,
    5000,
    "bob's presence",
  );
  ok('presence is broadcast when a member connects', true);

  // Outsider cannot join the group room.
  const outsiderWs = new WebSocket(`${WS_BASE}/ws/group/${groupId}`, {
    headers: { Cookie: carol.cookie },
  });
  const outsiderRejected = await new Promise((resolve) => {
    outsiderWs.on('unexpected-response', (_req, res) => resolve(res.statusCode === 403));
    outsiderWs.on('open', () => resolve(false));
    outsiderWs.on('error', () => resolve(true));
  });
  ok('non-members are rejected from the group room', outsiderRejected);

  // Live position fan-out.
  alice.send({ t: 'pos', lat: HERE.lat, lng: HERE.lng, acc: 8 });
  const bobSeesAlice = await bob.waitFor(
    (m) => m.t === 'pos' && m.userId === alice.userId,
    5000,
    "alice's position",
  );
  ok('positions fan out to other members', Math.abs(bobSeesAlice.lat - HERE.lat) < 1e-9);

  // Rally round-trip.
  alice.send({ t: 'rally:start' });
  const bobRally = await bob.waitFor((m) => m.t === 'rally', 5000, 'rally');
  ok('rally start reaches the group', bobRally.isRallying === true);
  bob.send({ t: 'rally:stop' });
  await alice.waitFor((m) => m.t === 'rally' && m.isRallying === false, 5000, 'rally stop');
  ok('rally stop reaches the group', true);

  // --- add-member flow (recruit Carol into the existing group) -------------
  console.log('add members');
  await carol.close();
  await alice.connect(`/ws/lobby`);
  await carol.createSession(); // fresh inbox state is enough, session may be reused
  await carol.connect('/ws/lobby');
  alice.send({ t: 'hello', name: 'Alice', groupId });
  carol.send({ t: 'hello', name: 'Carol' });
  alice.streamPosition(HERE);
  carol.streamPosition(NEARBY);
  const carolGrouped = await carol.waitFor((m) => m.t === 'grouped', 15_000, 'grouped');
  ok('recruited user joins the existing group', carolGrouped.groupId === groupId);
  const bobSeesCarol = await bob.waitFor(
    (m) => m.t === 'member:joined' && m.member.name === 'Carol',
    10_000,
    'member:joined',
  );
  ok('existing members see the newcomer', !!bobSeesCarol);
  alice.stopStreaming();
  carol.stopStreaming();
  alice.close();

  // --- leave ---------------------------------------------------------------
  console.log('leave');
  await carol.connect(`/ws/group/${groupId}`);
  await carol.waitFor((m) => m.t === 'state', 5000, 'state');
  carol.send({ t: 'leave' });
  await carol.waitFor((m) => m.t === 'removed', 5000, 'removed');
  ok('leaver is acknowledged', true);
  await bob.waitFor((m) => m.t === 'member:left' && m.userId === carol.userId, 5000, 'member:left');
  ok('remaining members see the departure', true);

  bob.close();
  carol.close();

  console.log(`\n${passes} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('FAILED:', failures.join(', '));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\nintegration test crashed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    wranglerProc?.kill('SIGTERM');
    setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref();
  });
