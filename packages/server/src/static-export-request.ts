import {
  buildSecurityGetRequest,
  buildSecurityUrlSnapshot,
  type BuildSecurityUrlSnapshot,
} from './build-security-intrinsics.js';
import type { StaticExportReplayContext } from './static-export-replay-context.js';

export interface StaticExportReplayRequestOptions {
  context: StaticExportReplayContext;
  href?: string;
  pathname?: string;
}

export interface StaticExportReplayRequestResult {
  response: Response;
  url: BuildSecurityUrlSnapshot;
}

export async function replayStaticExportRequest({
  context,
  href,
  pathname,
}: StaticExportReplayRequestOptions): Promise<StaticExportReplayRequestResult> {
  // SPEC §6.6/§9.5: earlier route evaluation shares this realm. Construct the synthetic target
  // and GET carrier through boot-pinned controls, and retain only the exact URL snapshot they prove.
  const url = buildSecurityUrlSnapshot(href ?? pathname ?? '/', context.origin);
  const request = buildSecurityGetRequest(url.href);

  return {
    response: await context.handler(request),
    url,
  };
}
