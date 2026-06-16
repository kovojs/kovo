import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { createCommerceDemoServer } from '../../examples/commerce/scripts/demo-serve.mjs';

// SPEC.md §9.5 verification: prove the multi-tenant demo serve path gives every
// visitor an isolated, real-server instance. We boot the commerce demo server on
// an ephemeral port and exercise the REAL request path (Vite SSR + the per-session
// dispatcher), asserting at the isolation boundary:
//   1. a cookieless request mints a session id (Set-Cookie) and one instance,
//   2. a second cookieless request mints a DIFFERENT session + a SECOND instance,
//   3. re-using a cookie routes back to the SAME instance (no new build),
//   4. the two sessions hold distinct handler objects (separate PGlite-backed apps).
//
// Anonymous mutations (add-to-cart) require the example's better-auth + CSRF flow,
// so we assert isolation structurally here rather than through a UI mutation; the
// dispatcher's eviction/LRU/cookie behavior is unit-covered in dispatcher.test.mjs.

function sidFromResponse(response) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return undefined;
  const match = /kovo_demo_sid=([^;]+)/.exec(setCookie);
  return match?.[1];
}

const served = await createCommerceDemoServer({ host: '127.0.0.1', port: 0 });
const origin = `http://${served.host}:${served.port}`;

try {
  // 1. First visitor.
  const r1 = await fetch(`${origin}/`);
  assert.equal(r1.status, 200, 'home should render 200');
  const sidA = sidFromResponse(r1);
  assert.ok(sidA, 'first cookieless request must mint a session cookie');
  assert.equal(served.dispatcher.size, 1, 'exactly one instance after first visitor');

  // 2. Second visitor (no cookie) → distinct session + a second instance.
  const r2 = await fetch(`${origin}/`);
  const sidB = sidFromResponse(r2);
  assert.ok(sidB && sidB !== sidA, 'second visitor must get a different session id');
  assert.equal(served.dispatcher.size, 2, 'two isolated instances for two visitors');

  // 3. Returning visitor A reuses the same instance (no new Set-Cookie, no new build).
  const r3 = await fetch(`${origin}/`, { headers: { cookie: `kovo_demo_sid=${sidA}` } });
  assert.equal(r3.status, 200, 'returning visitor renders 200');
  assert.equal(sidFromResponse(r3), undefined, 'returning visitor is not re-minted a cookie');
  assert.equal(served.dispatcher.size, 2, 'no new instance for a returning visitor');

  // 4. The two sessions are backed by distinct handler objects.
  const handlerA = served.dispatcher.sessions.get(sidA)?.handler;
  const handlerB = served.dispatcher.sessions.get(sidB)?.handler;
  assert.ok(handlerA && handlerB, 'both sessions resolved a handler');
  assert.notEqual(handlerA, handlerB, 'each visitor has its own app-shell instance');

  process.stdout.write('demo-isolation/v1 OK — 2 visitors, 2 isolated real-server instances\n');
} finally {
  await served.close();
}

// Allow running directly: `node scripts/demo-session/verify-isolation.mjs`
if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  // imported — nothing else to do
}
