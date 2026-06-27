import { constants as fsConstants, type Dirent } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  staticExportOutputTargets,
  type StaticExportOutputPlanItem,
  type StaticExportOutputPlanItemKind,
  type StaticExportOutputTarget,
} from './static-export-output-targets.js';
import { StaticExportError, staticExportDiagnostic } from './static-export-diagnostics.js';
import { createStaticExportHeaderSink } from './static-export-headers.js';
import {
  type StaticExportArtifact,
  type StaticExportAssetArtifact,
  type StaticExportAssetInput,
  type StaticExportClientModuleArtifact,
} from './static-export-types.js';

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
  await assertWritableStaticExportTargets(plan);
  if (plan.writes.length === 0) {
    // C2/SPEC §9.5: even when this export emits nothing, prior route documents must be reconciled so
    // a fully-removed route stops serving stale 200 HTML across rebuilds.
    await pruneStaleStaticExportRouteDocuments(plan);
    return;
  }

  const stagingRoot = await createStaticExportStagingRoot(plan.root);
  try {
    await Promise.all(
      plan.writes.map((write) =>
        write.write(staticExportStagedTargetPath(plan.root, stagingRoot, write.targetPath)),
      ),
    );
    await commitStaticExportStagedOutput(plan, stagingRoot);
    // C2/SPEC §9.5: reconcile relative to the rename commit — remove prior route-document artifacts
    // (mutable `index.html`) the current plan no longer owns. A removed route must not keep serving
    // stale 200 HTML (stale-page disclosure). Immutable versioned `/c/__v/` modules are RETAINED per
    // SPEC §14 prior-version retention and never pruned here.
    await pruneStaleStaticExportRouteDocuments(plan);
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
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
      await rm(indexHtmlPath, { force: true });
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
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // `/c/` holds immutable versioned client modules — never descend (SPEC §14 retention).
      if (entryPath === clientModuleRoot) continue;
      yield* enumerateStaticExportRouteDocuments(entryPath, clientModuleRoot);
      continue;
    }

    if (entry.isFile() && entry.name === 'index.html') {
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
      write: async (writePath) => writeTextStaticExportFile(artifact.body, writePath),
    };
  }

  if (target.itemKind === 'client-module') {
    const artifact = plan.clientModules[target.itemIndex]!;
    return {
      ...target,
      write: async (writePath) => writeTextStaticExportFile(artifact.body, writePath),
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
      write: async (writePath) =>
        writeTextStaticExportFile(buildNetlifyHeadersSidecar(plan), writePath),
    };
  }

  const artifact = plan.assets[target.itemIndex]!;
  return {
    ...target,
    write: async (writePath) => copyStaticExportAsset(artifact.source, writePath),
  };
}

/**
 * @internal bugz-3 L8 / SPEC §6.6: the immutable-asset security floor that every server
 * preset applies to versioned client modules (`/c/…`) and static assets (`/assets/…`).
 * Kept in lockstep with `immutableStaticHeaders()` in `build.ts` (the Vercel/Cloudflare
 * Worker presets); a bare static file cannot carry HTTP headers, so the Netlify/Cloudflare-
 * Pages `_headers` sidecar must materialize this floor or public JS/CSS ships without
 * `x-content-type-options: nosniff`, `cross-origin-resource-policy: same-origin`, or
 * immutable caching — a DiD regression vs all server presets.
 */
const STATIC_EXPORT_IMMUTABLE_ASSET_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'public, max-age=31536000, immutable',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
};

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
    appendStaticExportImmutableHeaderStanza(lines, '/c/*');
  }
  if (plan.assets.some((asset) => asset.path.startsWith('/assets/'))) {
    appendStaticExportImmutableHeaderStanza(lines, '/assets/*');
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

function appendStaticExportImmutableHeaderStanza(lines: string[], pathPattern: string): void {
  lines.push('');
  lines.push(pathPattern);
  for (const [name, value] of Object.entries(STATIC_EXPORT_IMMUTABLE_ASSET_HEADERS)) {
    lines.push(`  ${name}: ${value}`);
  }
}

async function assertReadableStaticExportAssetSource(
  artifact: StaticExportAssetArtifact,
): Promise<void> {
  let sourceStat: Awaited<ReturnType<typeof stat>>;
  try {
    sourceStat = await stat(artifact.source);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
      ),
    ]);
  }

  if (!sourceStat.isFile()) {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a file.`,
      ),
    ]);
  }

  try {
    await access(artifact.source, fsConstants.R_OK);
  } catch {
    throw new StaticExportError([
      staticExportDiagnostic(
        artifact.path,
        `KV229 static export cannot copy static asset '${artifact.path}' because source '${artifact.source}' is not a readable file.`,
      ),
    ]);
  }
}

async function writeTextStaticExportFile(body: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, body, 'utf8');
}

async function copyStaticExportAsset(source: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(source, targetPath);
}

interface StaticExportPlannedWrite extends StaticExportOutputTarget {
  diagnosticPath: string;
  itemKind: StaticExportOutputPlanItemKind;
  kind: string;
  targetPath: string;
  write(writePath: string): Promise<void>;
}

async function assertWritableStaticExportTargets(plan: StaticExportOutputPlan): Promise<void> {
  for (const write of plan.writes) {
    await ensureStaticExportTargetParentDirectories(plan.root, write);
    await assertStaticExportTargetIsNotDirectory(write);
  }
}

async function assertStaticExportOutputRoot(root: string): Promise<void> {
  let rootStat: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStat = await lstat(root);
  } catch {
    await mkdir(root, { recursive: true });
    rootStat = await lstat(root);
  }

  if (rootStat.isDirectory()) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      root,
      `KV229 static export cannot write output because output root '${root}' is not a directory.`,
    ),
  ]);
}

async function ensureStaticExportTargetParentDirectories(
  root: string,
  write: StaticExportPlannedWrite,
): Promise<void> {
  const relativeDirectory = path.relative(root, path.dirname(write.targetPath));
  const segments = relativeDirectory === '' ? [] : relativeDirectory.split(path.sep);
  let current = root;

  for (const segment of segments) {
    current = path.join(current, segment);

    let parentStat: Awaited<ReturnType<typeof lstat>>;
    try {
      parentStat = await lstat(current);
    } catch {
      await mkdir(current);
      parentStat = await lstat(current);
    }

    if (parentStat.isSymbolicLink()) {
      throw new StaticExportError([
        staticExportDiagnostic(
          write.diagnosticPath,
          `KV229 static export cannot write ${write.kind} '${write.diagnosticPath}' because output parent '${current}' is a symbolic link.`,
        ),
      ]);
    }

    if (!parentStat.isDirectory()) {
      throw new StaticExportError([
        staticExportDiagnostic(
          write.diagnosticPath,
          `KV229 static export cannot write ${write.kind} '${write.diagnosticPath}' because output parent '${current}' is not a directory.`,
        ),
      ]);
    }
  }
}

async function assertStaticExportTargetIsNotDirectory(
  write: StaticExportPlannedWrite,
): Promise<void> {
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(write.targetPath);
  } catch {
    return;
  }

  if (!targetStat.isDirectory()) return;

  throw new StaticExportError([
    staticExportDiagnostic(
      write.diagnosticPath,
      `KV229 static export cannot write ${write.kind} '${write.diagnosticPath}' because target '${write.targetPath}' is a directory.`,
    ),
  ]);
}

async function createStaticExportStagingRoot(root: string): Promise<string> {
  await mkdir(path.dirname(root), { recursive: true });
  return await mkdtemp(path.join(path.dirname(root), '.kovo-static-export-'));
}

function staticExportStagedTargetPath(
  root: string,
  stagingRoot: string,
  targetPath: string,
): string {
  return path.join(stagingRoot, path.relative(root, targetPath));
}

async function commitStaticExportStagedOutput(
  plan: StaticExportOutputPlan,
  stagingRoot: string,
): Promise<void> {
  for (const write of plan.writes) {
    const stagedPath = staticExportStagedTargetPath(plan.root, stagingRoot, write.targetPath);
    await assertStaticExportOutputRoot(plan.root);
    await ensureStaticExportTargetParentDirectories(plan.root, write);
    await assertStaticExportTargetIsNotDirectory(write);
    await rename(stagedPath, write.targetPath);
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
