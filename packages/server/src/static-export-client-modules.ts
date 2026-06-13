import type { RequestHandler } from './app.js';
import { readStaticExportClientModuleResponse } from './static-export-response.js';
import { collectStaticExportClientModuleHrefs } from './static-export-document.js';
import { replayStaticExportRequest } from './static-export-request.js';
import {
  StaticExportError,
  staticExportDiagnostic,
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

export interface StaticExportClientModuleReplayOptions {
  handler: RequestHandler;
  origin: string;
  routeArtifacts: readonly StaticExportArtifact[];
}

export async function replayStaticExportClientModuleArtifacts({
  handler,
  origin,
  routeArtifacts,
}: StaticExportClientModuleReplayOptions): Promise<StaticExportClientModuleArtifact[]> {
  const artifacts: StaticExportClientModuleArtifact[] = [];
  const bodyByTargetPath = new Map<string, string>();

  for (const href of collectStaticExportClientModuleHrefs(routeArtifacts, origin)) {
    const artifact = await replayStaticExportClientModuleArtifact({ handler, href, origin });
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
  handler: RequestHandler;
  href: string;
  origin: string;
}

async function replayStaticExportClientModuleArtifact({
  handler,
  href,
  origin,
}: StaticExportClientModuleArtifactReplayOptions): Promise<StaticExportClientModuleArtifact> {
  const { response, url } = await replayStaticExportRequest({ handler, href, origin });
  const replayed = await readStaticExportClientModuleResponse({
    href,
    path: url.pathname,
    response,
  });

  return {
    ...replayed,
    href,
    path: url.pathname,
  };
}
