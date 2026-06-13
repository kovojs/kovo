import type { RequestHandler } from './app.js';
import { normalizePathname } from './match.js';
import { replayStaticExportRequest } from './static-export-request.js';
import { readStaticExportRouteDocumentResponse } from './static-export-response.js';
import {
  collectStaticExportServerEndpointRefs,
  staticExportRouteDocumentArtifactPath,
} from './static-export-document.js';
import {
  StaticExportError,
  staticExportDiagnostic,
  type StaticExportArtifact,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export {
  replayStaticExportClientModuleArtifacts,
  type StaticExportClientModuleReplayOptions,
} from './static-export-client-modules.js';

export interface StaticExportRouteReplayOptions {
  handler: RequestHandler;
  htmlPathStyle: StaticExportHtmlPathStyle;
  origin: string;
  routePath: string;
}

export async function replayStaticExportRouteArtifact({
  handler,
  htmlPathStyle,
  origin,
  routePath,
}: StaticExportRouteReplayOptions): Promise<StaticExportArtifact> {
  const pathname = normalizePathname(routePath).pathname;
  const { response } = await replayStaticExportRequest({ handler, origin, pathname });
  const replayed = await readStaticExportRouteDocumentResponse({ response, routePath });
  const { body } = replayed;
  assertStaticExportRouteDocumentL0L1({ body, origin, routePath });

  return {
    ...replayed,
    path: staticExportRouteDocumentArtifactPath(pathname, htmlPathStyle),
  };
}

interface StaticExportRouteDocumentL0L1Options {
  body: string;
  origin: string;
  routePath: string;
}

function assertStaticExportRouteDocumentL0L1({
  body,
  origin,
  routePath,
}: StaticExportRouteDocumentL0L1Options): void {
  const diagnostics = collectStaticExportServerEndpointRefs(body, origin).map((ref) =>
    staticExportDiagnostic(
      routePath,
      `FW229 static export cannot export route '${routePath}' because document attribute '${ref.name}' references server ${ref.phase} endpoint '${ref.path}'. Export is L0/L1 only; serve this route dynamically or replace server-only interaction with an exportable client island.`,
    ),
  );

  if (diagnostics.length > 0) throw new StaticExportError(diagnostics);
}
