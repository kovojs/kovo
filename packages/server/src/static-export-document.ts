import { normalizePathname } from './match.js';
import { collectStaticExportServerEndpointRefs } from './static-export-document-refs.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { replayStaticExportRequest } from './static-export-request.js';
import type { StaticExportReplayContext } from './static-export-replay-context.js';
import { readStaticExportReplayedResponse } from './static-export-response.js';
import {
  type StaticExportArtifact,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export interface StaticExportRouteDocumentReplayOptions {
  context: StaticExportReplayContext;
  htmlPathStyle: StaticExportHtmlPathStyle;
  routePath: string;
}

export async function replayStaticExportRouteDocumentArtifact({
  context,
  htmlPathStyle,
  routePath,
}: StaticExportRouteDocumentReplayOptions): Promise<StaticExportArtifact> {
  const pathname = normalizePathname(routePath).pathname;
  const { response } = await replayStaticExportRequest({ context, pathname });
  const replayed = await readStaticExportReplayedResponse({
    kind: 'route-document',
    response,
    routePath,
  });
  const { body } = replayed;
  assertStaticExportRouteDocumentL0L1({ body, origin: context.origin, routePath });

  return {
    ...replayed,
    path: staticExportRouteDocumentArtifactPath(pathname, htmlPathStyle),
  };
}

export function staticExportRouteDocumentArtifactPath(
  pathname: string,
  style: StaticExportHtmlPathStyle,
): string {
  if (pathname === '/') return '/index.html';
  return style === 'directory' ? `${pathname}/index.html` : `${pathname}.html`;
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
