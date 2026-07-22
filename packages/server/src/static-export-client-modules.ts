import { collectStaticExportClientModuleHrefs } from './static-export-document-refs.js';
import {
  kovoDeferredRuntimeModulePath,
  kovoDeferredRuntimeModuleSource,
} from '@kovojs/browser/internal/inline-loader';
import {
  canonicalClientModuleRepresentation,
  clientModuleRepresentationDigest,
  parseVersionedClientModuleTarget,
} from '@kovojs/core/internal/client-module-url';
import { versionedClientModuleHref } from './client-modules.js';
import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import {
  createSecurityMap,
  createSecuritySet,
  securityMapGet,
  securityMapSet,
  securityObjectKeys,
  securitySetAdd,
  securityStringStartsWith,
} from './response-security-intrinsics.js';
import { witnessArrayAppend, witnessSetForEach } from './security-witness-intrinsics.js';
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
      versionedClientModuleHref(
        kovoDeferredRuntimeModulePath,
        clientModuleRepresentationDigest(kovoDeferredRuntimeModuleSource),
      ),
    );
  }
  const hrefs: string[] = [];
  witnessSetForEach(hrefSet, (href) => {
    witnessArrayAppend(
      hrefs,
      href,
      'Server packages/server/src/static-export-client-modules.ts collection',
    );
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
          `KV229 static export observed conflicting response snapshots for the same immutable client-module href '${artifact.path}'. SPEC §5.2.1 requires one exact representation per full-digest URL.`,
        ),
      ]);
    }

    if (existingArtifact === undefined) {
      witnessArrayAppend(
        artifacts,
        artifact,
        'Server packages/server/src/static-export-client-modules.ts collection',
      );
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
  const target = staticExportClientModuleTarget(href);
  const { response, url } = await replayStaticExportRequest({ context, href });
  const replayed = await readStaticExportReplayedResponse({
    href,
    kind: 'client-module',
    path: url.pathname,
    response,
  });
  assertStaticExportClientModuleRepresentation(href, target.digest, replayed);

  return {
    ...replayed,
    href,
    path: url.pathname,
  };
}

function staticExportClientModuleTarget(href: string): { digest: string; path: string } {
  const target = parseVersionedClientModuleTarget(href);
  if (target !== undefined) {
    const path = versionedClientModuleHref(target.path, target.digest);
    if (href === path || securityStringStartsWith(href, `${path}#`)) {
      return { digest: target.digest, path };
    }
  }

  throw new StaticExportError([
    staticExportDiagnostic(
      href,
      `KV229 static export refused non-canonical client module href '${href}'. SPEC §5.2.1 requires /c/__v/<64-lowercase-hex-representation-digest>/<module> with no query string or author version.`,
    ),
  ]);
}

function assertStaticExportClientModuleRepresentation(
  href: string,
  expectedDigest: string,
  replayed: Pick<StaticExportClientModuleArtifact, 'body' | 'headers'>,
): void {
  const contentType = buildOwnDataProperty(
    replayed.headers,
    'content-type',
    `client module '${href}' content type`,
  );
  const canonicalBody = canonicalClientModuleRepresentation(replayed.body);
  if (
    !contentType.present ||
    contentType.value !== 'text/javascript; charset=utf-8' ||
    canonicalBody !== replayed.body ||
    clientModuleRepresentationDigest(canonicalBody) !== expectedDigest
  ) {
    throw new StaticExportError([
      staticExportDiagnostic(
        href,
        `KV229 static export refused client module '${href}' because its response bytes or fixed Content-Type do not match the full representation digest in its immutable URL (SPEC §5.2.1).`,
      ),
    ]);
  }
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
