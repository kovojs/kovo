import { confinedPath } from '@kovojs/core/internal/filesystem';

import {
  buildSecurityDecodeURIComponent,
  buildSecurityPathJoin,
  buildSecurityPathSeparator,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import {
  createSecurityMap,
  securityArrayJoin,
  securityArrayPush,
  securityMapGet,
  securityMapSet,
  securityObjectKeys,
  securityRegExpTest,
  securityStringIncludes,
  securityStringSplit,
  securityStringStartsWith,
  securityUrlSnapshot,
  type SecurityUrlSnapshot,
} from './response-security-intrinsics.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import {
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Plan item kind used by
 * dry-run/write-output tooling, not app authors.
 *
 * `'header-sidecar'` is the per-export `_headers` file that materializes the full captured
 * security-header floor (CSP, X-Frame-Options, COOP, Permissions-Policy, Referrer-Policy) for
 * each route-document into a host-consumable sidecar (SPEC §6.6 DiD floor; bugz M4).
 */
export type StaticExportOutputPlanItemKind =
  | 'client-module'
  | 'header-sidecar'
  | 'route-document'
  | 'static-asset';

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Public dry-run shape
 * mirrored by the internal target planner.
 */
export interface StaticExportOutputPlanItem {
  kind: StaticExportOutputPlanItemKind;
  path: string;
  targetPath: string;
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Resolved filesystem
 * target for one artifact, client module, or asset.
 */
export interface StaticExportOutputTarget {
  diagnosticPath: string;
  itemIndex: number;
  itemKind: StaticExportOutputPlanItemKind;
  kind: string;
  targetPath: string;
}

interface StaticExportOutputTargetArtifacts {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Resolves all target
 * paths and detects conflicts before a write starts.
 */
export function staticExportOutputTargets(
  plan: StaticExportOutputTargetArtifacts,
  root: string,
): StaticExportOutputTarget[] {
  const targets: StaticExportOutputTarget[] = [];
  const artifacts = snapshotBuildArray(plan.artifacts, 'static-export route artifacts');
  const clientModules = snapshotBuildArray(plan.clientModules, 'static-export client modules');
  const assets = snapshotBuildArray(plan.assets, 'static-export assets');

  for (let itemIndex = 0; itemIndex < artifacts.length; itemIndex += 1) {
    const artifact = artifacts[itemIndex]!;
    securityArrayPush(targets, {
      diagnosticPath: artifact.path,
      itemIndex,
      itemKind: 'route-document',
      kind: 'route document',
      targetPath: staticExportArtifactTargetPath(root, artifact.path),
    });
  }

  for (let itemIndex = 0; itemIndex < clientModules.length; itemIndex += 1) {
    const artifact = clientModules[itemIndex]!;
    const targetPath = staticExportClientModuleTargetPath(root, artifact.path);
    assertStaticExportClientModuleTarget(artifact);
    securityArrayPush(targets, {
      diagnosticPath: artifact.path,
      itemIndex,
      itemKind: 'client-module',
      kind: 'client module',
      targetPath,
    });
  }

  for (let itemIndex = 0; itemIndex < assets.length; itemIndex += 1) {
    const artifact = assets[itemIndex]!;
    securityArrayPush(targets, {
      diagnosticPath: artifact.path,
      itemIndex,
      itemKind: 'static-asset',
      kind: 'static asset',
      targetPath: staticExportAssetTargetPath(root, artifact.path),
    });
  }

  // Emit a Netlify-style `_headers` sidecar that materializes the captured per-document
  // security-header floor (CSP, X-Frame-Options, COOP, Permissions-Policy, Referrer-Policy)
  // into a host-consumable artifact (SPEC §6.6 DiD floor; bugz M4). bugz-3 L8: the sidecar
  // must ALSO carry the immutable-asset floor (nosniff/CORP/immutable cache-control) for
  // versioned client modules (`/c/…`) and static assets (`/assets/…`) that every server
  // preset applies (build.ts `immutableStaticHeaders()`), so emit it whenever there are
  // route-document headers OR any `/c/`/`/assets/` artifacts to protect.
  let hasRouteDocumentHeaders = false;
  for (let index = 0; index < artifacts.length; index += 1) {
    if (securityObjectKeys(artifacts[index]!.headers).length > 0) {
      hasRouteDocumentHeaders = true;
      break;
    }
  }
  let hasAssetFloor = false;
  for (let index = 0; index < assets.length; index += 1) {
    if (securityStringStartsWith(assets[index]!.path, '/assets/')) {
      hasAssetFloor = true;
      break;
    }
  }
  const hasImmutableAssetArtifacts = clientModules.length > 0 || hasAssetFloor;
  if (hasRouteDocumentHeaders || hasImmutableAssetArtifacts) {
    securityArrayPush(targets, {
      diagnosticPath: '_headers',
      itemIndex: 0,
      itemKind: 'header-sidecar',
      kind: 'header sidecar',
      targetPath: buildSecurityPathJoin(root, '_headers'),
    });
  }

  assertNoStaticExportOutputConflicts(targets);
  return targets;
}

function assertStaticExportClientModuleTarget(artifact: StaticExportClientModuleArtifact): void {
  const hrefUrl = staticExportClientModuleHrefUrl(artifact);

  if (
    hrefUrl.origin === 'https://kovo.local' &&
    securityStringStartsWith(artifact.path, '/c/') &&
    hrefUrl.pathname === artifact.path &&
    (securityRegExpTest(/[?&]v=[^&]+/u, hrefUrl.search) ||
      securityStringStartsWith(hrefUrl.pathname, '/c/__v/'))
  ) {
    return;
  }

  throw new StaticExportError([
    staticExportDiagnostic(
      artifact.path,
      `KV229 static export refused client module '${artifact.path}' with href '${artifact.href}'. SPEC §4.3 and §9.5 publish same-origin immutable versioned /c/ module URLs, so artifact path and href pathname must match under /c/ with a path or query version.`,
    ),
  ]);
}

function staticExportClientModuleHrefUrl(
  artifact: StaticExportClientModuleArtifact,
): SecurityUrlSnapshot {
  try {
    return securityUrlSnapshot(artifact.href, 'https://kovo.local');
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export refused client module '${artifact.path}' with invalid href '${artifact.href}'. SPEC §4.3 and §9.5 publish same-origin immutable versioned /c/ module URLs.`,
      ),
    ]);
  }
}

function assertNoStaticExportOutputConflicts(targets: readonly StaticExportOutputTarget[]): void {
  const seen = createSecurityMap<string, StaticExportOutputTarget>();
  const pinnedTargets = snapshotBuildArray(targets, 'static-export output targets');

  for (let index = 0; index < pinnedTargets.length; index += 1) {
    const target = pinnedTargets[index]!;
    const existing = securityMapGet(seen, target.targetPath);
    if (existing) {
      throw new StaticExportError([
        staticExportDiagnostic(
          target.diagnosticPath,
          `KV229 static export cannot write ${target.kind} '${target.diagnosticPath}' because it conflicts with ${existing.kind} '${existing.diagnosticPath}'.`,
        ),
      ]);
    }

    securityMapSet(seen, target.targetPath, target);
  }
}

function staticExportArtifactTargetPath(root: string, artifactPath: string): string {
  const segments = decodedStaticExportPathSegments(artifactPath, decodeRouteDocumentPathSegment);
  if (segments.length === 0) {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifactPath,
        `KV229 static export refused route document '${artifactPath}' because it does not name an output file.`,
      ),
    ]);
  }

  const targetPath = confinedPath(root, securityArrayJoin(segments, buildSecurityPathSeparator()));
  if (targetPath !== undefined) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      artifactPath,
      `KV229 static export refused to write '${artifactPath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeRouteDocumentPathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = buildSecurityDecodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `KV229 static export cannot write route document path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (
    decoded === '.' ||
    decoded === '..' ||
    securityStringIncludes(decoded, '/') ||
    securityStringIncludes(decoded, '\\')
  ) {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `KV229 static export refused unsafe route document path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}

function staticExportClientModuleTargetPath(root: string, modulePath: string): string {
  const segments = decodedStaticExportPathSegments(modulePath, decodeClientModulePathSegment);
  const targetPath = confinedPath(root, securityArrayJoin(segments, buildSecurityPathSeparator()));
  if (targetPath !== undefined) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      modulePath,
      `KV229 static export refused to write client module '${modulePath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeClientModulePathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = buildSecurityDecodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        `/c/${segment}`,
        `KV229 static export cannot write client module path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (
    decoded === '.' ||
    decoded === '..' ||
    securityStringIncludes(decoded, '/') ||
    securityStringIncludes(decoded, '\\')
  ) {
    throw new StaticExportError([
      staticExportDiagnostic(
        `/c/${segment}`,
        `KV229 static export refused unsafe client module path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}

function staticExportAssetTargetPath(root: string, assetPath: string): string {
  const segments = decodedStaticExportPathSegments(assetPath, decodeStaticExportAssetPathSegment);
  if (segments.length === 0) {
    throw new StaticExportError([
      staticExportDiagnostic(
        assetPath,
        `KV229 static export refused static asset '${assetPath}' because it does not name an output file.`,
      ),
    ]);
  }

  const targetPath = confinedPath(root, securityArrayJoin(segments, buildSecurityPathSeparator()));
  if (targetPath !== undefined) return targetPath;

  throw new StaticExportError([
    staticExportDiagnostic(
      assetPath,
      `KV229 static export refused to write static asset '${assetPath}' outside the configured output directory.`,
    ),
  ]);
}

function decodeStaticExportAssetPathSegment(segment: string): string {
  let decoded: string;
  try {
    decoded = buildSecurityDecodeURIComponent(segment);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `KV229 static export cannot write static asset path segment '${segment}' because it is not valid URL encoding.`,
      ),
    ]);
  }

  if (
    decoded === '.' ||
    decoded === '..' ||
    securityStringIncludes(decoded, '/') ||
    securityStringIncludes(decoded, '\\')
  ) {
    throw new StaticExportError([
      staticExportDiagnostic(
        segment,
        `KV229 static export refused unsafe static asset path segment '${segment}'.`,
      ),
    ]);
  }

  return decoded;
}

function decodedStaticExportPathSegments(
  value: string,
  decode: (segment: string) => string,
): string[] {
  const rawSegments = securityStringSplit(value, '/');
  const decoded: string[] = [];
  for (let index = 0; index < rawSegments.length; index += 1) {
    const segment = rawSegments[index]!;
    if (segment !== '') securityArrayPush(decoded, decode(segment));
  }
  return decoded;
}
