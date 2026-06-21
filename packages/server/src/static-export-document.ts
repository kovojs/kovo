import { normalizePathname } from './match.js';
import { collectStaticExportServerEndpointRefs } from './static-export-document-refs.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { replayStaticExportRequest } from './static-export-request.js';
import type { StaticExportReplayContext } from './static-export-replay-context.js';
import { readStaticExportReplayedResponse } from './static-export-response.js';
import { type StaticExportArtifact } from './static-export-types.js';

export interface StaticExportRouteDocumentReplayOptions {
  context: StaticExportReplayContext;
  routePath: string;
}

export async function replayStaticExportRouteDocumentArtifact({
  context,
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
    path: staticExportRouteDocumentArtifactPath(pathname),
  };
}

export function staticExportRouteDocumentArtifactPath(pathname: string): string {
  if (pathname === '/') return '/index.html';
  return `${pathname}/index.html`;
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
  // `routePath` here is the concrete replay target; stamp it as the concrete-path discriminator so
  // SPEC §9.5 `skip` suppresses only this exact target and not its valid param siblings.
  const diagnostics = collectStaticExportServerEndpointRefs(body, origin).map((ref) =>
    staticExportDiagnostic(
      routePath,
      `KV229 static export cannot export route '${routePath}' because document attribute '${ref.name}' references server ${ref.phase} endpoint '${ref.path}'. Export is L0/L1 only; serve this route dynamically or replace server-only interaction with an exportable client island.`,
      routePath,
    ),
  );

  if (diagnostics.length > 0) throw new StaticExportError(diagnostics);
}
