import type { RequestHandler } from './app-types.js';

export interface StaticExportReplayRequestOptions {
  handler: RequestHandler;
  href?: string;
  origin: string;
  pathname?: string;
}

export interface StaticExportReplayRequestResult {
  response: Response;
  url: URL;
}

export async function replayStaticExportRequest({
  handler,
  href,
  origin,
  pathname,
}: StaticExportReplayRequestOptions): Promise<StaticExportReplayRequestResult> {
  // SPEC §9.5: static export replays synthetic GET requests through the app handler.
  const url = new URL(href ?? pathname ?? '/', origin);
  const request = new Request(url, { method: 'GET' });

  return {
    response: await handler(request),
    url,
  };
}
