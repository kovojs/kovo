import { collectStaticExportClientModuleHrefs } from './static-export-document-refs.js';
import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleVersion,
} from '@kovojs/browser/internal/inline-loader';
import { versionedClientModuleHref } from './client-modules.js';
import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecurityMap,
  createSecuritySet,
  securityMapGet,
  securityMapSet,
  securityObjectKeys,
  securitySetAdd,
} from './response-security-intrinsics.js';
import { witnessSetForEach } from './security-witness-intrinsics.js';
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
  const artifactByTargetPath = createSecurityMap<string, StaticExportClientModuleArtifact>();
  const routeArtifactSnapshot = snapshotBuildArray(routeArtifacts, 'static-export route artifacts');
  const hrefSet = createSecuritySet<string>();
  const collectedHrefs = collectStaticExportClientModuleHrefs(
    routeArtifactSnapshot,
    context.origin,
  );
  for (let index = 0; index < collectedHrefs.length; index += 1) {
    securitySetAdd(hrefSet, collectedHrefs[index]!);
  }
  if (routeArtifactSnapshot.length > 0) {
    securitySetAdd(
      hrefSet,
      versionedClientModuleHref(kovoDeferredRuntimeModulePath, kovoDeferredRuntimeModuleVersion),
    );
  }
  const hrefs: string[] = [];
  witnessSetForEach(hrefSet, (href) => {
    hrefs[hrefs.length] = href;
  });

  for (let index = 0; index < hrefs.length; index += 1) {
    const href = hrefs[index]!;
    const artifact = await replayStaticExportClientModuleArtifact({ context, href });
    const existingArtifact = securityMapGet(artifactByTargetPath, artifact.path);
    if (
      existingArtifact !== undefined &&
      !staticExportClientModuleArtifactsMatch(existingArtifact, artifact)
    ) {
      throw new StaticExportError([
        staticExportDiagnostic(
          artifact.path,
          `KV229 static export found multiple client module versions for '${artifact.path}' with different response snapshots. Static hosts serve query-string variants from the same file path, so export documents must reference one immutable version per /c/ path.`,
        ),
      ]);
    }

    if (existingArtifact === undefined) {
      artifacts[artifacts.length] = artifact;
      securityMapSet(artifactByTargetPath, artifact.path, artifact);
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
  const leftNames = securityObjectKeys(left);
  if (leftNames.length !== securityObjectKeys(right).length) return false;

  for (let index = 0; index < leftNames.length; index += 1) {
    const name = leftNames[index]!;
    const leftProperty = buildOwnDataProperty(left, name, `client module header '${name}'`);
    const rightProperty = buildOwnDataProperty(right, name, `client module header '${name}'`);
    if (
      !leftProperty.present ||
      !rightProperty.present ||
      leftProperty.value !== rightProperty.value
    ) {
      return false;
    }
  }
  return true;
}
