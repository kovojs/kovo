// Framework-owned Vitest seam. Example app modules remain pure, and production runners retain the
// guarded public wrapper; only the configured example tests import this internal raw dispatcher.
import { isKovoApp as isRuntimeKovoApp } from '../packages/server/src/app-guards.js';
import { resolveKovoAppToken, type KovoApp } from '../packages/server/src/app-token.js';
import { createRequestHandler, type RequestHandler } from '../packages/server/src/app.js';
import type { KovoApp as RuntimeKovoApp } from '../packages/server/src/app-types.js';

export function createExampleTestRequestHandler(app: KovoApp | RuntimeKovoApp): RequestHandler {
  const runtime = isRuntimeKovoApp(app)
    ? app
    : resolveKovoAppToken(app, 'createExampleTestRequestHandler()');
  return createRequestHandler(runtime);
}
