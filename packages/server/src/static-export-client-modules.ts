import { collectStaticExportClientModuleHrefs } from './static-export-document-refs.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { replayStaticExportRequest } from './static-export-request.js';
import type { StaticExportReplayContext } from './static-export-replay-context.js';
import { readStaticExportReplayedResponse } from './static-export-response.js';
import {
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

export interface StaticExportClientModuleReplayOptions {
  context: StaticExportReplayContext;
  routeArtifacts: readonly StaticExportArtifact[];
}

export async function replayStaticExportClientModuleArtifacts({
  context,
  routeArtifacts,
}: StaticExportClientModuleReplayOptions): Promise<StaticExportClientModuleArtifact[]> {
  const artifacts: StaticExportClientModuleArtifact[] = [];
  const bodyByTargetPath = new Map<string, string>();

  for (const href of collectStaticExportClientModuleHrefs(routeArtifacts, context.origin)) {
    const artifact = await replayStaticExportClientModuleArtifact({ context, href });
    const existingBody = bodyByTargetPath.get(artifact.path);
    if (existingBody !== undefined && existingBody !== artifact.body) {
      throw new StaticExportError([
        staticExportDiagnostic(
          artifact.path,
          `FW229 static export found multiple client module versions for '${artifact.path}' with different bytes. Static hosts serve query-string variants from the same file path, so export documents must reference one immutable version per /c/ path.`,
        ),
      ]);
    }

    if (existingBody === undefined) {
      artifacts.push(artifact);
      bodyByTargetPath.set(artifact.path, artifact.body);
    }
  }

  return artifacts;
}

interface StaticExportClientModuleArtifactReplayOptions {
  context: StaticExportReplayContext;
  href: string;
}

async function replayStaticExportClientModuleArtifact({
  context,
  href,
}: StaticExportClientModuleArtifactReplayOptions): Promise<StaticExportClientModuleArtifact> {
  const { response, url } = await replayStaticExportRequest({ context, href });
  const replayed = await readStaticExportReplayedResponse({
    href,
    kind: 'client-module',
    path: url.pathname,
    response,
  });

  return {
    ...replayed,
    href,
    path: url.pathname,
  };
}
