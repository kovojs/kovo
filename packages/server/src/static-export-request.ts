import type { RequestHandler } from './app.js';

export interface StaticExportReplayRequestOptions {
  handler: RequestHandler;
  href?: string;
  origin: string;
  pathname?: string;
}

export interface StaticExportReplayRequestResult {
  request: Request;
  response: Response;
  url: URL;
}

export async function replayStaticExportRequest({
  handler,
  href,
  origin,
  pathname,
}: StaticExportReplayRequestOptions): Promise<StaticExportReplayRequestResult> {
  const url = new URL(href ?? pathname ?? '/', origin);
  const request = new Request(url, { method: 'GET' });

  return {
    request,
    response: await handler(request),
    url,
  };
}
