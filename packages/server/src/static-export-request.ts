import type { StaticExportReplayContext } from './static-export-replay-context.js';

export interface StaticExportReplayRequestOptions {
  context: StaticExportReplayContext;
  href?: string;
  pathname?: string;
}

export interface StaticExportReplayRequestResult {
  response: Response;
  url: URL;
}

export async function replayStaticExportRequest({
  context,
  href,
  pathname,
}: StaticExportReplayRequestOptions): Promise<StaticExportReplayRequestResult> {
  // SPEC §9.5: static export replays synthetic GET requests through the app handler.
  const url = new URL(href ?? pathname ?? '/', context.origin);
  const request = new Request(url, { method: 'GET' });

  return {
    response: await context.handler(request),
    url,
  };
}
