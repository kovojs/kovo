import { createRequestHandler } from './app.js';
import type { JisoApp, RequestHandler } from './app-types.js';

export interface StaticExportReplayContext {
  handler: RequestHandler;
  origin: string;
}

export interface StaticExportReplayContextOptions {
  app: JisoApp;
  origin?: string;
}

export function createStaticExportReplayContext({
  app,
  origin,
}: StaticExportReplayContextOptions): StaticExportReplayContext {
  return {
    handler: createRequestHandler(app),
    origin: origin ?? 'https://jiso.local',
  };
}
