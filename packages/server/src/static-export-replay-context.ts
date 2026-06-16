import { createRequestHandler } from './app.js';
import type { KovoApp, RequestHandler } from './app-types.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';

export interface StaticExportReplayContext {
  handler: RequestHandler;
  origin: string;
}

export interface StaticExportReplayContextOptions {
  app: KovoApp;
  origin?: string;
}

export function createStaticExportReplayContext({
  app,
  origin,
}: StaticExportReplayContextOptions): StaticExportReplayContext {
  return {
    handler: createRequestHandler(app),
    origin: staticExportReplayOrigin(origin),
  };
}

function staticExportReplayOrigin(origin: string | undefined): string {
  if (origin === undefined) return 'https://kovo.local';

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw invalidStaticExportOrigin(origin);
  }

  if (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  ) {
    return url.origin;
  }

  throw invalidStaticExportOrigin(origin);
}

function invalidStaticExportOrigin(origin: string): StaticExportError {
  return new StaticExportError([
    staticExportDiagnostic(
      'origin',
      `KV229 static export refused origin '${origin}'. SPEC §9.5 synthetic replay origin must be an absolute http(s) origin without a path, search, or hash.`,
    ),
  ]);
}
