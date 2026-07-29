import { createRequestHandler as createAppRequestHandler } from './app.js';
import type { RequestHandler } from './app-types.js';
import { resolveKovoAppToken, type KovoApp } from './app-token.js';
import { assertServerRequestSafeRuntimeRealmLocked } from './security-bootstrap.js';

/**
 * Turn a `KovoApp` into a Web-standard request handler after runtime bootstrap.
 *
 * Custom entries must import `@kovojs/server/runtime-bootstrap` as their literal first import on
 * every supported runtime. Generated Kovo runners install the same lock automatically. The handler
 * refuses to start without that ordering proof because classifier-reviewed globals otherwise
 * remain caller-mutable (SPEC §6.6/§9.5).
 *
 * @param app Opaque app token returned by `app.assemble()`.
 * @returns A bootstrapped request handler suitable for the platform adapter.
 */
export function createRequestHandler(app: KovoApp): RequestHandler {
  assertServerRequestSafeRuntimeRealmLocked();
  return createAppRequestHandler(resolveKovoAppToken(app, 'createRequestHandler()'));
}
