/**
 * Real-browser smoke test: two headless Chromium contexts with mocked GPS
 * walk through the actual UI — name + Sync on both phones, automatic group
 * formation, live member list, and a rally round-trip.
 *
 * Usage:
 *   node tests/browser.mjs                      # spawns wrangler dev
 *   BASE_URL=https://host node tests/browser.mjs  # against a deployment
 */
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const EXTERNAL = !!process.env.BASE_URL;
const PORT = 8789;
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const SHOTS = new URL('./artifacts/', import.meta.url).pathname;

const HERE = { latitude: 39.7392, longitude: -104.9903 };
const NEARBY = { latitude: 39.73925, longitude: -104.9903 };

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

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('server did not become ready');
}

async function newPhone(browser, name, coords) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: coords,
    baseURL: BASE,
    // Sandboxed CI environments often MITM TLS; tile fetches must not fail
    // on the proxy certificate.
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`  [${name}] pageerror:`, err.message));
  await page.goto('/');
  return { context, page, name };
}

async function main() {
  await mkdir(SHOTS, { recursive: true });
  if (!EXTERNAL) {
    console.log('starting wrangler dev…');
    wranglerProc = spawn(
      'pnpm',
      ['exec', 'wrangler', 'dev', '--port', String(PORT), '--show-interactive-dev-session', 'false'],
      { cwd: new URL('../worker', import.meta.url).pathname, stdio: ['ignore', 'ignore', 'ignore'] },
    );
  }
  await waitForServer();
  console.log(`testing against ${BASE}\n`);

  const browser = await chromium.launch();
  const alice = await newPhone(browser, 'alice', HERE);
  const bob = await newPhone(browser, 'bob', NEARBY);

  console.log('home screen');
  await alice.page.waitForSelector('input.name');
  ok('home screen renders', await alice.page.isVisible('button.sync'));
  await alice.page.screenshot({ path: `${SHOTS}1-home.png` });

  // Sync without a name shows the inline error.
  await alice.page.click('button.sync');
  ok(
    'sync without a name is rejected with a hint',
    await alice.page.waitForSelector('.hint.error', { timeout: 3000 }).then(() => true, () => false),
  );

  console.log('proximity sync');
  await alice.page.fill('input.name', 'Alice');
  await bob.page.fill('input.name', 'Bob');
  await alice.page.click('button.sync');
  await bob.page.click('button.sync');
  await alice.page.screenshot({ path: `${SHOTS}2-syncing.png` });

  await Promise.all([
    alice.page.waitForURL(/\/app\//, { timeout: 30_000 }),
    bob.page.waitForURL(/\/app\//, { timeout: 30_000 }),
  ]);
  const aliceGroupUrl = new URL(alice.page.url());
  const bobGroupUrl = new URL(bob.page.url());
  ok('both phones land in the same group', aliceGroupUrl.pathname === bobGroupUrl.pathname);

  console.log('group view');
  await alice.page.waitForSelector('.members li');
  const memberText = await alice.page.textContent('.members');
  ok('member list shows both people', memberText.includes('Alice') && memberText.includes('Bob'));
  ok('self is labeled', memberText.includes('(you)'));

  // Live distance appears once positions fan out.
  const distanceShown = await alice.page
    .waitForFunction(
      () => /m\b|km\b/.test(document.querySelector('.members')?.textContent ?? ''),
      undefined,
      { timeout: 10_000 },
    )
    .then(() => true, () => false);
  ok('live distance to the other member is shown', distanceShown);
  await alice.page.screenshot({ path: `${SHOTS}3-members.png` });

  console.log('rally');
  await alice.page.click('button.rally');
  const bobSeesRally = await bob.page
    .waitForFunction(
      () => document.querySelector('button.rally')?.textContent?.includes('Stop Rally'),
      undefined,
      { timeout: 10_000 },
    )
    .then(() => true, () => false);
  ok("rally started on Alice's phone reaches Bob's", bobSeesRally);
  await bob.page.screenshot({ path: `${SHOTS}4-rally-compass.png` });

  await bob.page.click('button.rally'); // stop
  const aliceSeesStop = await alice.page
    .waitForFunction(
      () => document.querySelector('button.rally')?.textContent?.includes('Start Rally'),
      undefined,
      { timeout: 10_000 },
    )
    .then(() => true, () => false);
  ok('rally stop propagates back', aliceSeesStop);

  console.log('map pane');
  await alice.page.click('nav.tabs button:has-text("Map")');
  const mapRendered = await alice.page
    .waitForSelector('.maplibregl-canvas', { timeout: 20_000 })
    .then(() => true, () => false);
  ok('maplibre map renders with OpenFreeMap tiles', mapRendered);
  const markerCount = await alice.page
    .waitForFunction(() => document.querySelectorAll('.member-marker').length >= 2, undefined, {
      timeout: 10_000,
    })
    .then(() => true, () => false);
  ok('both member markers are on the map', markerCount);
  await alice.page.waitForTimeout(2500); // let tiles paint for the screenshot
  await alice.page.screenshot({ path: `${SHOTS}5-map.png` });

  console.log('reload / rejoin');
  await alice.page.reload();
  await alice.page.waitForSelector('.members li', { timeout: 15_000 });
  ok('reload rejoins the group automatically', alice.page.url().includes(aliceGroupUrl.pathname));

  console.log('leave');
  alice.page.on('dialog', (dialog) => dialog.accept());
  await alice.page.click('header .icon-btn[aria-label="Leave group"]');
  await alice.page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10_000 });
  ok('leaving returns to the home screen', true);
  const bobSeesDeparture = await bob.page
    .waitForFunction(
      () => !(document.querySelector('.members')?.textContent ?? '').includes('Alice'),
      undefined,
      { timeout: 10_000 },
    )
    .then(() => true, () => false);
  ok("Bob's member list drops Alice", bobSeesDeparture);

  await browser.close();
  console.log(`\n${passes} passed, ${failures.length} failed`);
  console.log(`screenshots in tests/artifacts/`);
  if (failures.length > 0) {
    console.error('FAILED:', failures.join(', '));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('\nbrowser test crashed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    wranglerProc?.kill('SIGTERM');
    setTimeout(() => process.exit(process.exitCode ?? 0), 1500).unref();
  });
