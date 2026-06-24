import { collectStaticExportClientModuleHrefs } from './static-export-document-refs.js';
import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';
import { versionedClientModuleHref } from './client-modules.js';
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
  const artifactByTargetPath = new Map<string, StaticExportClientModuleArtifact>();

  const hrefs = new Set([
    ...collectStaticExportClientModuleHrefs(routeArtifacts, context.origin),
    ...(routeArtifacts.length === 0
      ? []
      : [
          versionedClientModuleHref(
            kovoDeferredRuntimeModulePath,
            kovoDeferredRuntimeModuleVersion,
          ),
        ]),
  ]);

  for (const href of hrefs) {
    const artifact = await replayStaticExportClientModuleArtifact({ context, href });
    const existingArtifact = artifactByTargetPath.get(artifact.path);
    if (
      existingArtifact !== undefined &&
      !staticExportClientModuleArtifactsMatch(existingArtifact, artifact)
    ) {
      throw new StaticExportError([
        staticExportDiagnostic(
          artifact.path,
          `KV431 static export found multiple client module versions for '${artifact.path}' with different response snapshots. Static hosts serve query-string variants from the same file path, so export documents must reference one immutable version per /c/ path.`,
          undefined,
          'KV431',
        ),
      ]);
    }

    if (existingArtifact === undefined) {
      artifacts.push(artifact);
      artifactByTargetPath.set(artifact.path, artifact);
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

function staticExportClientModuleArtifactsMatch(
  left: StaticExportClientModuleArtifact,
  right: StaticExportClientModuleArtifact,
): boolean {
  return (
    left.body === right.body &&
    left.status === right.status &&
    staticExportHeadersMatch(left.headers, right.headers)
  );
}

function staticExportHeadersMatch(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;

  return leftEntries.every(([name, value]) => right[name] === value);
}
