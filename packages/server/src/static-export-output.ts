import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFrameworkOutputFileSystemBoundary } from '@kovojs/core/internal/filesystem';

import {
  staticExportOutputTargets,
  type StaticExportOutputPlanItem,
  type StaticExportOutputPlanItemKind,
  type StaticExportOutputTarget,
} from './static-export-output-targets.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { createStaticExportHeaderSink } from './static-export-headers.js';
import { staticHostHeaders, type StaticHostHeaderPolicyKind } from './static-host-header-policy.js';
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
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Complete resolved
 * write plan consumed by the atomic output writer.
 */
export interface StaticExportOutputPlan extends StaticExportOutputArtifacts {
  outDir: string | URL;
  root: string;
  writes: readonly StaticExportPlannedWrite[];
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
  return createStaticExportOutputPlan({
    artifacts: result.artifacts,
    assets: result.assets,
    clientModules: result.clientModules,
    outDir: options.outDir,
  }).writes.map((write) => ({
    kind: write.itemKind,
    path: write.diagnosticPath,
    targetPath: write.targetPath,
  }));
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Creates the exact
 * target list used by static export dry-run and write modes.
 */
export function createStaticExportOutputPlan(
  plan: StaticExportOutputPlanInput,
): StaticExportOutputPlan {
  const root = staticExportOutputRoot(plan.outDir);
  const writes = staticExportPlannedWrites(plan, root);

  return { ...plan, root, writes };
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Resolves and validates
 * the filesystem root for a static export write.
 */
export function staticExportOutputRoot(outDir: string | URL): string {
  if (outDir instanceof URL) {
    if (outDir.protocol === 'file:') return path.resolve(fileURLToPath(outDir));

    throw new StaticExportError([
      staticExportDiagnostic(
        'outDir',
        `KV229 static export cannot write to '${outDir.href}'. SPEC §9.5 static export output directories must be filesystem paths or file: URLs.`,
      ),
    ]);
  }

  return path.resolve(outDir);
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Atomically writes a
 * resolved static export output plan.
 */
export async function writeStaticExportOutput(plan: StaticExportOutputPlan): Promise<void> {
  for (const artifact of plan.assets) {
    await assertReadableStaticExportAssetSource(artifact);
  }

  await assertStaticExportOutputRoot(plan.root);
  if (plan.writes.length === 0) {
    // C2/SPEC §9.5: even when this export emits nothing, prior route documents must be reconciled so
    // a fully-removed route stops serving stale 200 HTML across rebuilds.
    await pruneStaleStaticExportRouteDocuments(plan);
    return;
  }

  await writeArtifactOutput(plan.root, plan.writes.map(staticExportArtifactOutputEntry), {
    cleanup: {
      enumerate(root) {
        return enumerateStaticExportRouteDocuments(root, path.join(root, 'c'));
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
  const ownedIndexHtmlDocuments = new Set(
    plan.writes
      .filter(
        (write) =>
          write.itemKind === 'route-document' ||
          (write.itemKind === 'static-asset' && path.basename(write.targetPath) === 'index.html'),
      )
      .map((write) => write.targetPath),
  );

  const clientModuleRoot = path.join(plan.root, 'c');
  for await (const indexHtmlPath of enumerateStaticExportRouteDocuments(
    plan.root,
    clientModuleRoot,
  )) {
    if (!ownedIndexHtmlDocuments.has(indexHtmlPath)) {
      // Remove only the stale directory-index document; leave any sibling files (assets the export
      // does not own a manifest for, user-managed files) untouched.
      const fileSystem = createFrameworkOutputFileSystemBoundary(plan.root);
      const relativePath = path.relative(plan.root, indexHtmlPath);
      await fileSystem.deleteFile(relativePath);
    }
  }
}

/**
 * @internal Enumerate existing static-export route-document `index.html` files under `root`,
 * skipping the entire `/c/` client-module subtree so immutable versioned modules (SPEC §14) are
 * never considered for pruning.
 */
async function* enumerateStaticExportRouteDocuments(
  root: string,
  clientModuleRoot: string,
): AsyncGenerator<string> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(root);
  for await (const entry of fileSystem.entries('.')) {
    const entryPath = path.join(root, entry.relativePath);
    if (entry.kind === 'directory') {
      // `/c/` holds immutable versioned client modules — never descend (SPEC §14 retention).
      if (entryPath === clientModuleRoot) continue;
      yield* enumerateStaticExportRouteDocuments(entryPath, clientModuleRoot);
      continue;
    }

    if (entry.kind === 'file' && entry.name === 'index.html') {
      yield entryPath;
    }
  }
}

/**
 * @internal Static export output planner internal (SPEC.md §9.5). Converts user-declared
 * static assets into replay artifacts before target planning.
 */
export function staticExportAssetArtifacts(
  assets: readonly StaticExportAssetInput[],
): StaticExportAssetArtifact[] {
  return assets.map((asset) => ({
    headers: staticExportAssetHeaders(asset),
    path: asset.path,
    source: staticExportSourcePath(asset),
    status: 200,
  }));
}

function staticExportPlannedWrites(
  plan: StaticExportOutputArtifacts,
  root: string,
): StaticExportPlannedWrite[] {
  return staticExportOutputTargets(plan, root).map((target) =>
    staticExportPlannedWrite(plan, target),
  );
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

  for (const artifact of plan.artifacts) {
    const entries = Object.entries(artifact.headers);
    if (entries.length === 0) continue;

    for (const documentPath of staticExportDocumentHeaderPaths(artifact.path)) {
      lines.push('');
      lines.push(documentPath);
      for (const [name, value] of entries) {
        lines.push(`  ${name}: ${value}`);
      }
    }
  }

  const fallbackHeaders = commonStaticExportDocumentHeaders(plan.artifacts);
  if (Object.keys(fallbackHeaders).length > 0) {
    lines.push('');
    lines.push('/*');
    for (const [name, value] of Object.entries(fallbackHeaders)) {
      lines.push(`  ${name}: ${value}`);
    }
  }

  // bugz-3 L8: versioned client modules live under `/c/` (enforced by
  // `assertStaticExportClientModuleTarget`); static assets under `/assets/` follow the
  // preset convention. Carry the immutable-asset floor on those public file trees.
  if (plan.clientModules.length > 0) {
    appendStaticExportHeaderPolicyStanza(lines, '/c/*', 'clientModule');
  }
  if (plan.assets.some((asset) => asset.path.startsWith('/assets/'))) {
    appendStaticExportHeaderPolicyStanza(lines, '/assets/*', 'immutableAsset');
  }

  lines.push('');
  return lines.join('\n');
}

function staticExportDocumentHeaderPaths(artifactPath: string): string[] {
  const paths = [artifactPath];
  if (artifactPath === '/index.html') {
    paths.push('/');
  } else if (artifactPath.endsWith('/index.html')) {
    const directory = artifactPath.slice(0, -'index.html'.length);
    paths.push(directory, directory.endsWith('/') ? directory.slice(0, -1) || '/' : directory);
  }
  return [...new Set(paths)];
}

function commonStaticExportDocumentHeaders(
  artifacts: readonly StaticExportArtifact[],
): Record<string, string> {
  if (artifacts.length === 0) return {};
  const [first, ...rest] = artifacts;
  if (first === undefined) return {};

  return Object.fromEntries(
    Object.entries(first.headers).filter(([name, value]) =>
      rest.every((artifact) => artifact.headers[name] === value),
    ),
  );
}

function appendStaticExportHeaderPolicyStanza(
  lines: string[],
  pathPattern: string,
  policy: StaticHostHeaderPolicyKind,
): void {
  lines.push('');
  lines.push(pathPattern);
  for (const [name, value] of Object.entries(staticHostHeaders(policy))) {
    lines.push(`  ${name}: ${value}`);
  }
}

async function assertReadableStaticExportAssetSource(
  artifact: StaticExportAssetArtifact,
): Promise<void> {
  const fileSystem = createFrameworkOutputFileSystemBoundary(path.dirname(artifact.source));
  const sourceStat = await fileSystem.statFile(path.basename(artifact.source));
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
  if (asset.headers !== undefined) {
    if (asset.headers instanceof Headers) {
      for (const [name, value] of asset.headers.entries()) headers.append(name, value);
    } else if (Array.isArray(asset.headers)) {
      for (const [name, value] of asset.headers) headers.append(String(name), String(value));
    } else {
      for (const [name, value] of Object.entries(asset.headers)) {
        headers.append(name, String(value));
      }
    }
  }
  if (asset.contentType !== undefined) headers.set('content-type', asset.contentType);
  return headers.toJSON();
}

function staticExportSourcePath(asset: StaticExportAssetInput): string {
  if (asset.source instanceof URL) {
    if (asset.source.protocol === 'file:') return fileURLToPath(asset.source);

    throw new StaticExportError([
      staticExportDiagnostic(
        asset.path,
        `KV229 static export cannot copy static asset '${asset.path}' from '${asset.source.href}'. Static asset sources must be filesystem paths or file: URLs.`,
      ),
    ]);
  }

  return asset.source;
}
