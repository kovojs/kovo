import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import {
  buildOwnDataProperty,
  buildSecurityFileUrlToPath,
  buildSecurityPathBasename,
  buildSecurityPathDirname,
  buildSecurityPathJoin,
  buildSecurityPathRelative,
  buildSecurityPathResolve,
  snapshotBuildArray,
} from './build-security-intrinsics.js';
import {
  createSecurityNullRecord,
  createSecuritySet,
  securityArrayJoin,
  securityArrayPush,
  securityIsUrl,
  securityObjectKeys,
  securitySetAdd,
  securitySetHas,
  securityStringEndsWith,
  securityStringSlice,
  securityStringStartsWith,
  securityUrlObjectSnapshot,
} from './response-security-intrinsics.js';
import {
  staticExportOutputTargets,
  type StaticExportOutputPlanItem,
  type StaticExportOutputPlanItemKind,
  type StaticExportOutputTarget,
} from './static-export-output-targets.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { createStaticExportHeaderSink, staticExportHeaders } from './static-export-headers.js';
import { staticHostHeaders, type StaticHostHeaderPolicyKind } from './static-host-header-policy.js';
import { witnessArrayAppend, witnessFreeze } from './security-witness-intrinsics.js';
import {
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';
import { writeArtifactOutput, type ArtifactOutputEntry } from './output-staging.js';

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Synthetic root used
 * when export callers need a dry-run plan but no filesystem write.
 */
export const STATIC_EXPORT_DRY_RUN_ROOT = '/__kovo_static_export_plan__';

export type { StaticExportOutputPlanItem, StaticExportOutputPlanItemKind };

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Filesystem root
 * options for dry-run and write-output planning.
 */
export interface StaticExportOutputPlanOptions {
  outDir: string | URL;
}

interface StaticExportOutputArtifacts {
  readonly artifacts: readonly StaticExportArtifact[];
  readonly assets: readonly StaticExportAssetArtifact[];
  readonly clientModules: readonly StaticExportClientModuleArtifact[];
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Complete resolved
 * write plan consumed by the atomic output writer.
 */
export interface StaticExportOutputPlan extends StaticExportOutputArtifacts {
  readonly outDir: string | URL;
  readonly root: string;
  readonly writes: readonly StaticExportPlannedWrite[];
}

interface StaticExportOutputPlanInput extends StaticExportOutputArtifacts {
  outDir: string | URL;
}

/**
 * @internal Dry-run export task wiring must inspect the same target files that a
 * write export would publish, without reimplementing path planning (SPEC.md §9.5).
 */
export function staticExportOutputPlan(
  result: StaticExportOutputArtifacts,
  options: StaticExportOutputPlanOptions,
): StaticExportOutputPlanItem[] {
  const writes = createStaticExportOutputPlan({
    artifacts: result.artifacts,
    assets: result.assets,
    clientModules: result.clientModules,
    outDir: options.outDir,
  }).writes;
  const output: StaticExportOutputPlanItem[] = [];
  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index]!;
    witnessArrayAppend(
      output,
      {
        kind: write.itemKind,
        path: write.diagnosticPath,
        targetPath: write.targetPath,
      },
      'Server packages/server/src/static-export-output.ts collection',
    );
  }
  return output;
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Creates the exact
 * target list used by static export dry-run and write modes.
 */
export function createStaticExportOutputPlan(
  plan: StaticExportOutputPlanInput,
): StaticExportOutputPlan {
  // SPEC §6.6: target validation and write selection must consume the same artifact identities.
  // Snapshot each caller-owned array once before either phase so a Proxy cannot present a reviewed
  // element through own descriptors and substitute executable bytes on a later index read.
  const pinnedArtifacts = witnessFreeze({
    artifacts: snapshotBuildArray(plan.artifacts, 'static-export route artifacts'),
    assets: snapshotBuildArray(plan.assets, 'static-export assets'),
    clientModules: snapshotBuildArray(plan.clientModules, 'static-export client modules'),
  });
  const root = staticExportOutputRoot(plan.outDir);
  const writes = snapshotBuildArray(
    staticExportPlannedWrites(pinnedArtifacts, root),
    'static-export planned writes',
  );

  return witnessFreeze({ ...pinnedArtifacts, outDir: plan.outDir, root, writes });
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Resolves and validates
 * the filesystem root for a static export write.
 */
export function staticExportOutputRoot(outDir: string | URL): string {
  if (securityIsUrl(outDir)) {
    const snapshot = securityUrlObjectSnapshot(outDir);
    if (snapshot.protocol === 'file:') {
      return buildSecurityPathResolve(buildSecurityFileUrlToPath(snapshot.href));
    }

    throw new StaticExportError([
      staticExportDiagnostic(
        'outDir',
        `KV229 static export cannot write to '${snapshot.href}'. SPEC §9.5 static export output directories must be filesystem paths or file: URLs.`,
      ),
    ]);
  }

  return buildSecurityPathResolve(outDir);
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Atomically writes a
 * resolved static export output plan.
 */
export async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  const assets = snapshotBuildArray(plan.assets, 'static-export output assets');
  for (let index = 0; index < assets.length; index += 1) {
    await assertReadableStaticExportAssetSource(assets[index]!);
  }

  await assertStaticExportOutputRoot(plan.root);
  if (plan.writes.length === 0) {
    // C2/SPEC §9.5: even when this export emits nothing, prior route documents must be reconciled so
    // a fully-removed route stops serving stale 200 HTML across rebuilds.
    await pruneStaleStaticExportRouteDocuments(plan);
    return;
  }

  const writes = snapshotBuildArray(plan.writes, 'static-export output writes');
  const outputEntries: ArtifactOutputEntry[] = [];
  for (let index = 0; index < writes.length; index += 1) {
    witnessArrayAppend(
      outputEntries,
      staticExportArtifactOutputEntry(writes[index]!),
      'Server packages/server/src/static-export-output.ts collection',
    );
  }
  await writeArtifactOutput(plan.root, outputEntries, {
    cleanup: {
      async enumerate(root) {
        return await enumerateStaticExportRouteDocuments(root, buildSecurityPathJoin(root, 'c'));
      },
    },
    diagnostics: {
      root: (root) =>
        new StaticExportError([
          staticExportDiagnostic(
            root,
            `KV229 static export cannot write output because output root '${root}' is not a directory.`,
          ),
        ]),
      target: (entry, reason) =>
        new StaticExportError([
          staticExportDiagnostic(
            entry.label,
            `KV229 static export cannot write ${entry.kind ?? 'artifact'} '${entry.label}' because ${reason}.`,
          ),
        ]),
    },
    stagingPrefix: '.kovo-static-export-',
  });
}

/**
 * @internal C2/SPEC §9.5 + §14. After the atomic rename commit, remove prior mutable
 * route-document `index.html` artifacts under the output root that the current plan no longer owns,
 * so a removed/unpublished route stops serving stale 200 HTML across rebuilds. Immutable versioned
 * client modules under `/c/__v/` are preserved for the SPEC §14 deploy-skew retention window and are
 * never enumerated for pruning.
 */
async function pruneStaleStaticExportRouteDocuments(plan: StaticExportOutputPlan): Promise<void> {
  const ownedIndexHtmlDocuments = createSecuritySet<string>();
  const writes = snapshotBuildArray(plan.writes, 'static-export output writes');
  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index]!;
    if (
      write.itemKind === 'route-document' ||
      (write.itemKind === 'static-asset' &&
        buildSecurityPathBasename(write.targetPath) === 'index.html')
    ) {
      securitySetAdd(ownedIndexHtmlDocuments, write.targetPath);
    }
  }

  const clientModuleRoot = buildSecurityPathJoin(plan.root, 'c');
  const existingDocuments = snapshotBuildArray(
    await enumerateStaticExportRouteDocuments(plan.root, clientModuleRoot),
    'existing static-export route documents',
  );
  for (let index = 0; index < existingDocuments.length; index += 1) {
    const indexHtmlPath = existingDocuments[index]!;
    if (!securitySetHas(ownedIndexHtmlDocuments, indexHtmlPath)) {
      // Remove only the stale directory-index document; leave any sibling files (assets the export
      // does not own a manifest for, user-managed files) untouched.
      const fileSystem = createFrameworkOutputFileSystemBoundary(plan.root);
      const relativePath = buildSecurityPathRelative(plan.root, indexHtmlPath);
      await fileSystem.deleteFile(relativePath);
    }
  }
}

/**
 * @internal Enumerate existing static-export route-document `index.html` files under `root`,
 * skipping the entire `/c/` client-module subtree so immutable versioned modules (SPEC §14) are
 * never considered for pruning.
 */
async function enumerateStaticExportRouteDocuments(
  root: string,
  clientModuleRoot: string,
): Promise<readonly string[]> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  const entries = snapshotBuildArray(
    await fileSystem.entries('.'),
    'static-export directory entries',
  );
  const documents: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const entryPath = buildSecurityPathJoin(root, entry.relativePath);
    if (entry.kind === 'directory') {
      // `/c/` holds immutable versioned client modules — never descend (SPEC §14 retention).
      if (entryPath === clientModuleRoot) continue;
      const nestedDocuments = snapshotBuildArray(
        await enumerateStaticExportRouteDocuments(entryPath, clientModuleRoot),
        'nested static-export route documents',
      );
      for (let nestedIndex = 0; nestedIndex < nestedDocuments.length; nestedIndex += 1) {
        securityArrayPush(documents, nestedDocuments[nestedIndex]!);
      }
      continue;
    }

    if (entry.kind === 'file' && entry.name === 'index.html') {
      securityArrayPush(documents, entryPath);
    }
  }
  return documents;
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Converts user-declared
 * static assets into replay artifacts before target planning.
 */
export function staticExportAssetArtifacts(
  assets: readonly StaticExportAssetInput[],
): StaticExportAssetArtifact[] {
  const sourceAssets = snapshotBuildArray(assets, 'static-export asset inputs');
  const artifacts: StaticExportAssetArtifact[] = [];
  for (let index = 0; index < sourceAssets.length; index += 1) {
    const asset = sourceAssets[index]!;
    witnessArrayAppend(
      artifacts,
      {
        headers: staticExportAssetHeaders(asset),
        path: asset.path,
        source: staticExportSourcePath(asset),
        status: 200,
      },
      'Server packages/server/src/static-export-output.ts collection',
    );
  }
  return artifacts;
}

function staticExportPlannedWrites(
  plan: StaticExportOutputArtifacts,
  root: string,
): StaticExportPlannedWrite[] {
  const targets = snapshotBuildArray(
    staticExportOutputTargets(plan, root),
    'static-export output targets',
  );
  const writes: StaticExportPlannedWrite[] = [];
  for (let index = 0; index < targets.length; index += 1) {
    witnessArrayAppend(
      writes,
      staticExportPlannedWrite(plan, targets[index]!),
      'Server packages/server/src/static-export-output.ts collection',
    );
  }
  return writes;
}

function staticExportPlannedWrite(
  plan: StaticExportOutputArtifacts,
  target: StaticExportOutputTarget,
): StaticExportPlannedWrite {
  if (target.itemKind === 'route-document') {
    const artifact = plan.artifacts[target.itemIndex]!;
    return {
      ...target,
      content: artifact.body,
    };
  }

  if (target.itemKind === 'client-module') {
    const artifact = plan.clientModules[target.itemIndex]!;
    return {
      ...target,
      content: artifact.body,
    };
  }

  // SPEC §6.6 / bugz M4: emit a Netlify-compatible `_headers` sidecar that materializes the
  // per-document security-header floor (CSP, X-Frame-Options, COOP, Permissions-Policy,
  // Referrer-Policy) captured during replay into a host-consumable artifact. Static hosts
  // (Netlify, Cloudflare Pages) serve these headers alongside the prerendered HTML files,
  // restoring the floor that dynamic dispatch emits but a bare static file cannot carry.
  if (target.itemKind === 'header-sidecar') {
    return {
      ...target,
      content: buildNetlifyHeadersSidecar(plan),
    };
  }

  const artifact = plan.assets[target.itemIndex]!;
  return {
    ...target,
    sourcePath: artifact.source,
  };
}

/**
 * @internal Builds the content of a Netlify-style `_headers` file from the captured
 * per-document security headers (SPEC §6.6 DiD floor; bugz M4). Each route-document path
 * gets a stanza associating it with its full header set. Headers are already filtered by
 * `staticExportHeaders()` at capture time (set-cookie and kovo-* are stripped).
 *
 * bugz-3 L8: route documents are not the only artifacts that need a header floor. The
 * `/c/` versioned client modules and `/assets/` static files are public JS/CSS that every
 * server preset serves with the immutable-asset floor (nosniff/CORP/immutable). Emit
 * wildcard splat stanzas (`/c/*`, `/assets/*`) matching the presets' `/(?:assets|c)/(.*)`
 * rule so the static export carries the same floor a bare file cannot.
 *
 * The `_headers` format is recognized by Netlify and Cloudflare Pages. Hosts that use
 * `config.json` routes (Vercel) are handled separately via their platform preset.
 */
function buildNetlifyHeadersSidecar(plan: StaticExportOutputArtifacts): string {
  const lines: string[] = ['# Kovo static export security headers (SPEC §6.6)'];
  const artifacts = snapshotBuildArray(plan.artifacts, 'static-export route artifacts');

  for (let artifactIndex = 0; artifactIndex < artifacts.length; artifactIndex += 1) {
    const artifact = artifacts[artifactIndex]!;
    const entries = staticExportHeaderRecordEntries(artifact.headers);
    if (entries.length === 0) continue;

    const documentPaths = staticExportDocumentHeaderPaths(artifact.path);
    for (let pathIndex = 0; pathIndex < documentPaths.length; pathIndex += 1) {
      securityArrayPush(lines, '');
      securityArrayPush(lines, documentPaths[pathIndex]!);
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        const [name, value] = entries[entryIndex]!;
        securityArrayPush(lines, `  ${name}: ${value}`);
      }
    }
  }

  const fallbackHeaders = commonStaticExportDocumentHeaders(artifacts);
  const fallbackEntries = staticExportHeaderRecordEntries(fallbackHeaders);
  if (fallbackEntries.length > 0) {
    securityArrayPush(lines, '');
    securityArrayPush(lines, '/*');
    for (let index = 0; index < fallbackEntries.length; index += 1) {
      const [name, value] = fallbackEntries[index]!;
      securityArrayPush(lines, `  ${name}: ${value}`);
    }
  }

  // bugz-3 L8: versioned client modules live under `/c/` (enforced by
  // `assertStaticExportClientModuleTarget`); static assets under `/assets/` follow the
  // preset convention. Carry the immutable-asset floor on those public file trees.
  const clientModules = snapshotBuildArray(plan.clientModules, 'static-export client modules');
  if (clientModules.length > 0) {
    appendStaticExportHeaderPolicyStanza(lines, '/c/*', 'clientModule');
  }
  const assets = snapshotBuildArray(plan.assets, 'static-export assets');
  let hasImmutableAsset = false;
  for (let index = 0; index < assets.length; index += 1) {
    if (securityStringStartsWith(assets[index]!.path, '/assets/')) {
      hasImmutableAsset = true;
      break;
    }
  }
  if (hasImmutableAsset) {
    appendStaticExportHeaderPolicyStanza(lines, '/assets/*', 'immutableAsset');
  }

  securityArrayPush(lines, '');
  // SPEC §6.6: the validated sidecar plan is finalized through a boot-pinned join. App code
  // cannot replace the whole deployable `_headers` body after each header has passed the sink.
  return securityArrayJoin(lines, '\n');
}

function staticExportDocumentHeaderPaths(artifactPath: string): string[] {
  const paths = [artifactPath];
  if (artifactPath === '/index.html') {
    securityArrayPush(paths, '/');
  } else if (securityStringEndsWith(artifactPath, '/index.html')) {
    const directory = securityStringSlice(artifactPath, 0, -'index.html'.length);
    securityArrayPush(paths, directory);
    securityArrayPush(
      paths,
      securityStringEndsWith(directory, '/')
        ? securityStringSlice(directory, 0, -1) || '/'
        : directory,
    );
  }
  const unique: string[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const candidate = paths[index]!;
    let seen = false;
    for (let prior = 0; prior < unique.length; prior += 1) {
      if (unique[prior] === candidate) {
        seen = true;
        break;
      }
    }
    if (!seen) securityArrayPush(unique, candidate);
  }
  return unique;
}

function commonStaticExportDocumentHeaders(
  artifacts: readonly StaticExportArtifact[],
): Record<string, string> {
  const source = snapshotBuildArray(artifacts, 'static-export route artifacts');
  if (source.length === 0) return createSecurityNullRecord<string>();
  const first = source[0];
  if (first === undefined) return {};

  const common = createSecurityNullRecord<string>();
  const firstEntries = staticExportHeaderRecordEntries(first.headers);
  for (let entryIndex = 0; entryIndex < firstEntries.length; entryIndex += 1) {
    const [name, value] = firstEntries[entryIndex]!;
    let shared = true;
    for (let artifactIndex = 1; artifactIndex < source.length; artifactIndex += 1) {
      const property = buildOwnDataProperty(
        source[artifactIndex]!.headers,
        name,
        `static-export header '${name}'`,
      );
      if (!property.present || property.value !== value) {
        shared = false;
        break;
      }
    }
    if (shared) common[name] = value;
  }
  return common;
}

function appendStaticExportHeaderPolicyStanza(
  lines: string[],
  pathPattern: string,
  policy: StaticHostHeaderPolicyKind,
): void {
  securityArrayPush(lines, '');
  securityArrayPush(lines, pathPattern);
  const entries = staticExportHeaderRecordEntries(staticHostHeaders(policy));
  for (let index = 0; index < entries.length; index += 1) {
    const [name, value] = entries[index]!;
    securityArrayPush(lines, `  ${name}: ${value}`);
  }
}

function staticExportHeaderRecordEntries(
  headers: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] {
  const names = securityObjectKeys(headers);
  const entries: (readonly [string, string])[] = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const property = buildOwnDataProperty(headers, name, `static-export header '${name}'`);
    if (!property.present || typeof property.value !== 'string') {
      throw new TypeError(`Static export header '${name}' must be an own string value.`);
    }
    witnessArrayAppend(
      entries,
      [name, property.value] as const,
      'Server packages/server/src/static-export-output.ts collection',
    );
  }
  return entries;
}

async function assertReadableStaticExportAssetSource(
  artifact: StaticExportAssetArtifact,
): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(
    buildSecurityPathDirname(artifact.source),
  );
  const sourceStat = await fileSystem.statFile(buildSecurityPathBasename(artifact.source));
  if (sourceStat === undefined) {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
      ),
    ]);
  }
}

interface StaticExportPlannedWrite extends StaticExportOutputTarget {
  diagnosticPath: string;
  itemKind: StaticExportOutputPlanItemKind;
  kind: string;
  targetPath: string;
  content?: string;
  sourcePath?: string;
}

function staticExportArtifactOutputEntry(write: StaticExportPlannedWrite): ArtifactOutputEntry {
  const entry: ArtifactOutputEntry = {
    kind: write.kind,
    label: write.diagnosticPath,
    targetPath: write.targetPath,
  };
  if (write.content !== undefined) entry.content = write.content;
  if (write.sourcePath !== undefined) entry.sourcePath = write.sourcePath;
  return entry;
}

async function assertStaticExportOutputRoot(root: string): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  try {
    await fileSystem.ensureDirectory();
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        root,
        `KV229 static export cannot write output because output root '${root}' is not a directory.`,
      ),
    ]);
  }
}

function staticExportAssetHeaders(asset: StaticExportAssetInput): Record<string, string> {
  const headers = createStaticExportHeaderSink({ path: asset.path });
  const normalized = staticExportHeaders(asset.headers, { path: asset.path });
  const entries = staticExportHeaderRecordEntries(normalized);
  for (let index = 0; index < entries.length; index += 1) {
    const [name, value] = entries[index]!;
    headers.append(name, value);
  }
  if (asset.contentType !== undefined) headers.set('content-type', asset.contentType);
  return headers.toJSON();
}

function staticExportSourcePath(asset: StaticExportAssetInput): string {
  if (securityIsUrl(asset.source)) {
    const snapshot = securityUrlObjectSnapshot(asset.source);
    if (snapshot.protocol === 'file:') return buildSecurityFileUrlToPath(snapshot.href);

    throw new StaticExportError([
      staticExportDiagnostic(
        asset.path,
        `KV229 static export cannot copy static asset '${asset.path}' from '${snapshot.href}'. Static asset sources must be filesystem paths or file: URLs.`,
      ),
    ]);
  }

  return asset.source;
}
