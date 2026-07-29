// Framework-owned Vitest seam. Example app modules remain pure, and production runners retain the
// guarded public wrapper; only the configured example tests import this internal raw dispatcher.
import { isKovoApp as isRuntimeKovoApp } from '../packages/server/src/app-guards.js';
import { deriveClosedKovoApp } from '../packages/server/src/app-snapshot.js';
import { resolveKovoAppToken, type KovoApp } from '../packages/server/src/app-token.js';
import { createRequestHandler, type RequestHandler } from '../packages/server/src/app.js';
import type { KovoApp as RuntimeKovoApp } from '../packages/server/src/app-types.js';
import { registeredGeneratedLiveTargetRenderers } from '../packages/server/src/live-target-registry.js';

export function createExampleTestRequestHandler(app: KovoApp | RuntimeKovoApp): RequestHandler {
  const runtime = isRuntimeKovoApp(app)
    ? app
    : resolveKovoAppToken(app, 'createExampleTestRequestHandler()');
  const renderers = registeredGeneratedLiveTargetRenderers();
  // SPEC §§6.6, 9.1, and 12: the Vitest-only generated-graph scope mirrors the compiler loader.
  // App modules keep an opaque token and never pass renderer maps; this framework-owned seam
  // derives an isolated test aggregate from the exact renderers active in the current scope.
  const effectiveRuntime =
    renderers.length === 0
      ? runtime
      : deriveClosedKovoApp(runtime, { liveTargetRenderers: renderers });
  return createRequestHandler(effectiveRuntime);
}
