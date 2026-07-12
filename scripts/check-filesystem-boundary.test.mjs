import { describe, expect, it } from 'vitest';

import {
  buildSecurityIntrinsicsFile,
  cloudflareTomlAssemblyFindings,
  checkFilesystemBoundary,
  defaultAllowedToolingFiles,
  egressArrayCommitFindings,
  egressSecurityIntrinsicsFile,
  filesystemBoundaryFile,
  filesystemIntrinsicsFile,
  nodeRuntimePackageBoundaryFindings,
  neutralBuildFile,
  neutralMetadataCommitFindings,
  neutralPublicAssetCopyFindings,
  neutralStylesheetAssemblyFindings,
  presetDiagnosticAggregationFindings,
  presetRetentionPolicyFile,
  presetRetentionPolicyFindings,
  responseSecurityArrayCommitFindings,
  responseSecurityIntrinsicsFile,
  staticExportEndpointBlockerFile,
  staticExportEndpointBlockerFindings,
  staticExportReplayArtifactCommitFindings,
  staticExportReplayArtifactFile,
  staticExportReplayContextFile,
  staticExportReplayRequestFile,
  staticExportSyntheticRequestFindings,
  taskArrayCommitFindings,
  taskSecurityIntrinsicsFile,
} from './check-filesystem-boundary.mjs';

function runFixture(files, overrides = {}) {
  return checkFilesystemBoundary({
    allowedRuntimeFiles: [filesystemBoundaryFile],
    allowedToolingFiles: overrides.allowedToolingFiles ?? [],
    exists: (relativePath) => Object.hasOwn(files, relativePath),
    neutralPublicAssetCopyFiles: overrides.neutralPublicAssetCopyFiles ?? [],
    readText: (relativePath) => files[relativePath] ?? '',
    sourceFiles: Object.keys(files).sort(),
  });
}

describe('filesystem boundary gate', () => {
  it('accepts raw filesystem access inside the audited boot-pinned membrane', () => {
    const result = checkFilesystemBoundary({
      allowedRuntimeFiles: [filesystemBoundaryFile, filesystemIntrinsicsFile],
      allowedToolingFiles: [],
      exists: (relativePath) => relativePath === filesystemBoundaryFile,
      neutralPublicAssetCopyFiles: [],
      readText: (relativePath) =>
        relativePath === filesystemIntrinsicsFile
          ? `
import { readFile } from 'node:fs/promises';
const nativeReadFile = readFile;
export const pinnedReadFile = (path) => nativeReadFile(path);
`
          : 'export const boundary = true;',
      sourceFiles: [filesystemBoundaryFile, filesystemIntrinsicsFile],
    });

    expect(result.findings).toEqual([]);
  });

  it('rejects live raw filesystem controls inside the audited boundary', () => {
    const result = runFixture({
      [filesystemBoundaryFile]: `
import { readFile } from 'node:fs/promises';
export async function read(path) {
  return readFile(path);
}
`,
    });

    expect(result.findings).toContain(
      `${filesystemBoundaryFile}:2: raw node:fs/promises controls must be boot-pinned in ${filesystemIntrinsicsFile}`,
    );
  });

  it('rejects live path, temp-name, and stream controls inside the audited boundary', () => {
    const result = runFixture({
      [filesystemBoundaryFile]: `
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
export const controls = [randomUUID, path.resolve, Readable.toWeb];
`,
    });

    expect(result.findings).toEqual([
      `${filesystemBoundaryFile}:2: raw node:crypto controls must be boot-pinned in ${filesystemIntrinsicsFile}`,
      `${filesystemBoundaryFile}:3: raw node:path controls must be boot-pinned in ${filesystemIntrinsicsFile}`,
      `${filesystemBoundaryFile}:4: raw node:stream controls must be boot-pinned in ${filesystemIntrinsicsFile}`,
    ]);
  });

  it('rejects async-iterator protocol dispatch in filesystem authority enumeration', () => {
    const outputStaging = 'packages/server/src/output-staging.ts';
    const result = checkFilesystemBoundary({
      allowedRuntimeFiles: [filesystemBoundaryFile, outputStaging],
      allowedToolingFiles: [],
      exists: (relativePath) => relativePath === filesystemBoundaryFile,
      neutralPublicAssetCopyFiles: [],
      readText: (relativePath) =>
        relativePath === outputStaging
          ? 'for await (const victim of cleanup.enumerate(root)) deleteFile(victim);'
          : 'export const boundary = true;',
      sourceFiles: [filesystemBoundaryFile, outputStaging],
    });

    expect(result.findings).toContain(
      `${outputStaging}:1: filesystem authority enumeration must use snapshotted arrays, not mutable async-iterator protocol dispatch`,
    );
  });

  it('C196 pins the static-export endpoint blocker to snapshot and indexed traversal', () => {
    const result = checkFilesystemBoundary({
      allowedRuntimeFiles: [filesystemBoundaryFile],
      allowedToolingFiles: [],
      exists: (relativePath) => relativePath === filesystemBoundaryFile,
      neutralPublicAssetCopyFiles: [],
      readText: (relativePath) =>
        relativePath === staticExportEndpointBlockerFile
          ? 'const diagnostics = protocol.endpointRefs.map(toDiagnostic);'
          : 'export const boundary = true;',
      sourceFiles: [filesystemBoundaryFile, staticExportEndpointBlockerFile],
    });

    expect(result.findings).toContain(
      `${staticExportEndpointBlockerFile}:1: static-export endpoint blocker must not dispatch through mutable collection methods`,
    );
    expect(
      staticExportEndpointBlockerFindings(
        staticExportEndpointBlockerFile,
        `
          const endpointRefs = snapshotBuildArray(
            protocol.endpointRefs,
            'static-export route document endpoint references',
          );
          for (let index = 0; index < endpointRefs.length; index += 1) {
            diagnostics[diagnostics.length] = toDiagnostic(endpointRefs[index]);
          }
        `,
      ),
    ).toEqual([]);
  });

  it('C200 pins approved static-export artifacts to the boot-pinned dense commit', () => {
    expect(
      staticExportReplayArtifactCommitFindings(
        staticExportReplayArtifactFile,
        'artifacts.push(await replayStaticExportRouteDocumentArtifact(options));',
      ),
    ).toContain(
      `${staticExportReplayArtifactFile}:1: approved static-export route artifacts must not commit through mutable collection methods`,
    );
    expect(
      staticExportReplayArtifactCommitFindings(
        staticExportReplayArtifactFile,
        `
          const approvedArtifact = await replayStaticExportRouteDocumentArtifact(options);
          commitBuildArrayValue(
            artifacts,
            approvedArtifact,
            'approved static-export route artifact',
          );
        `,
      ),
    ).toEqual([]);
  });

  it('C215 pins synthetic static-export target and carrier construction', () => {
    expect(
      staticExportSyntheticRequestFindings(
        staticExportReplayRequestFile,
        `
          const url = new URL(pathname, context.origin);
          const request = new Request(url, { method: 'GET' });
          return { response: await context.handler(request), url };
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mutable ambient URL constructor'),
        expect.stringContaining('mutable ambient Request constructor'),
        expect.stringContaining('boot-pinned URL snapshot'),
        expect.stringContaining('boot-pinned GET Request constructor'),
        expect.stringContaining('witnessed URL snapshot'),
      ]),
    );

    expect(
      staticExportSyntheticRequestFindings(
        staticExportReplayRequestFile,
        `
          interface Result { url: BuildSecurityUrlSnapshot }
          const url = buildSecurityUrlSnapshot(pathname, context.origin);
          const request = buildSecurityGetRequest(url.href);
        `,
      ),
    ).toEqual([]);
    expect(
      staticExportSyntheticRequestFindings(
        staticExportReplayContextFile,
        'const url = buildSecurityUrlSnapshot(origin);',
      ),
    ).toEqual([]);
    expect(
      staticExportSyntheticRequestFindings(buildSecurityIntrinsicsFile, 'export const unsafe = 1;'),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('captured Request constructor'),
        expect.stringContaining('captured URL constructor'),
        expect.stringContaining('ambient URL descriptor restoration'),
      ]),
    );
  });

  it('C218 pins post-replay neutral stylesheet assembly', () => {
    const unsafe = `
      async function materializeNeutralStylesheetAssets() {
        const cssByPath = new Map<string, string[]>();
        for (const asset of app.stylesheets) chunks.push(asset.criticalCss);
        for (const [assetPath, chunks] of cssByPath) {
          const css = chunks.map((chunk) => chunk.trim()).join('\\n');
          new URL(assetPath, 'https://kovo.local');
        }
      }
      function isNodeError() {}
    `;
    expect(neutralStylesheetAssemblyFindings(neutralBuildFile, unsafe)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mutable collection method'),
        expect.stringContaining('mutable collection iterator'),
        expect.stringContaining('mutable Map constructor'),
        expect.stringContaining('mutable string method'),
        expect.stringContaining('mutable URL constructor'),
        expect.stringContaining('missing final CSS composition'),
      ]),
    );

    expect(
      neutralStylesheetAssemblyFindings(
        buildSecurityIntrinsicsFile,
        'export function buildSecurityPathJoin(...values: string[]): string { return nativePathJoin(...values); }',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('path join must snapshot variadic inputs'),
        expect.stringContaining('path resolution must snapshot variadic inputs'),
        expect.stringContaining('boot-pinned isAbsolute'),
      ]),
    );
  });

  it('C223 pins neutral public-asset enumeration, identity, and copy authority', () => {
    const unsafe = `
      async function writeNeutralPublicAssets(sourceRoot, outRoot) {
        await copyNeutralPublicAssetEntries(sourceRoot, outRoot);
      }
      async function copyNeutralPublicAssetEntries(sourceRoot, outRoot) {
        const entries = await readdir(sourceRoot, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (entry.isDirectory()) continue;
          if (entry.isFile()) await copyFile(entry.name, outRoot);
        }
      }
      function skipNeutralPublicAsset() {}
    `;
    expect(neutralPublicAssetCopyFindings(neutralBuildFile, unsafe)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('raw directory enumeration'),
        expect.stringContaining('mutable iterator traversal'),
        expect.stringContaining('mutable Dirent classification'),
        expect.stringContaining('raw copy sink'),
        expect.stringContaining('mutable Promise catch'),
        expect.stringContaining('missing identity-bound file read'),
      ]),
    );

    expect(
      neutralPublicAssetCopyFindings(
        filesystemBoundaryFile,
        `
          interface FrameworkOutputFileSystemBoundary {
            entriesOf(entry: ConfinedFileSystemEntry): Promise<readonly ConfinedFileSystemEntry[]>;
            fileBytesOf(entry: ConfinedFileSystemEntry): Promise<Uint8Array>;
          }
          async function confinedDirectoryEntries() {
            for (const entry of entries) output.push(entry);
          }
          async function ensureParentsStayDirectories() {}
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('indexed traversal'),
        expect.stringContaining('private entry provenance'),
        expect.stringContaining('descriptor stat witness'),
      ]),
    );
  });

  it('C228 pins dense neutral metadata snapshots and commits', () => {
    expect(
      neutralMetadataCommitFindings(
        buildSecurityIntrinsicsFile,
        `
          function snapshotBuildArray(value) {
            const snapshot = [];
            for (let index = 0; index < value.length; index += 1) {
              snapshot[index] = value[index];
            }
            return snapshot;
          }
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must not dispatch through inherited numeric setters'),
        expect.stringContaining('must commit descriptor values through commitBuildArrayValue'),
      ]),
    );

    expect(
      neutralMetadataCommitFindings(
        neutralBuildFile,
        `
          function neutralBuildTasks(app) {
            const tasks = [];
            tasks[tasks.length] = { key: app.tasks[0].key };
            return tasks;
          }
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must not dispatch through inherited numeric setters'),
        expect.stringContaining('missing pinned durable task metadata'),
        expect.stringContaining('missing pinned route entry metadata'),
      ]),
    );
  });

  it('C233 pins durable-task arrays to own-data indexed commits', () => {
    expect(
      taskArrayCommitFindings(
        taskSecurityIntrinsicsFile,
        `
          const nativeArrayPush = Array.prototype.push;
          export function taskArrayPush(values, value) {
            Reflect.apply(nativeArrayPush, values, [value]);
          }
          export function taskPromiseAll(values) {
            const results = [];
            results[index] = result;
          }
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('prototype-visible [[Set]]'),
        expect.stringContaining('must not dispatch through inherited numeric setters'),
        expect.stringContaining('missing descriptor-indexed array commit'),
        expect.stringContaining('missing Promise.all result commit'),
      ]),
    );

    expect(
      taskArrayCommitFindings(
        'packages/server/src/task-runner.ts',
        'function collect(running, job) { running.push(job); }',
      ),
    ).toEqual([
      expect.stringContaining(
        'durable-task collections must not append through mutable Array.push',
      ),
    ]);
  });

  it('C236 pins response and cookie arrays to own-data indexed commits', () => {
    expect(
      responseSecurityArrayCommitFindings(
        responseSecurityIntrinsicsFile,
        `
          const nativeArrayPush = NativeArray.prototype.push;
          export function securityArrayPush(values, value) {
            apply(nativeArrayPush, values, [value]);
          }
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('prototype-visible [[Set]]'),
        expect.stringContaining('missing boot-pinned property definition'),
        expect.stringContaining('missing descriptor-indexed response commit'),
        expect.stringContaining('missing securityArrayPush own-data delegation'),
      ]),
    );

    expect(
      responseSecurityArrayCommitFindings(
        'packages/server/src/cookies.ts',
        `
          function serializeCookie() {
            const parts = ['sid=value'];
            parts.push('HttpOnly');
          }
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cookie attributes must commit through securityArrayPush'),
        expect.stringContaining('HttpOnly cookie floor must use the response array choke'),
      ]),
    );
  });

  it('C237 pins egress parser and splice arrays to own-data indexed commits', () => {
    expect(
      egressArrayCommitFindings(
        egressSecurityIntrinsicsFile,
        `
          const nativeArrayPush = NativeArray.prototype.push;
          export function egressArrayPush(values, ...items) {
            return Reflect.apply(nativeArrayPush, values, items);
          }
          export function egressArraySplice(values, start, deleteCount, ...items) {
            const args = [start, deleteCount];
            args.push(items[0]);
            return Reflect.apply(nativeArraySplice, values, args);
          }
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must not append through mutable Array.push'),
        expect.stringContaining('prototype-visible [[Set]]'),
        expect.stringContaining('missing boot-pinned property definition'),
        expect.stringContaining('missing descriptor-indexed egress commit'),
        expect.stringContaining('missing own-data item snapshot'),
        expect.stringContaining('missing splice-argument own-data delegation'),
      ]),
    );

    expect(
      egressArrayCommitFindings(
        'packages/server/src/egress.ts',
        `
          function parse(words, value) {
            words[words.length] = value;
          }
        `,
      ),
    ).toEqual([expect.stringContaining('must not dispatch through inherited numeric setters')]);
  });

  it('C202 pins deploy-skew retention classification to the emitted module snapshot', () => {
    expect(
      presetRetentionPolicyFindings(
        presetRetentionPolicyFile,
        'const retained = build.clientModules.filter((module) => !isRuntime(module));',
      ),
    ).toContain(
      `${presetRetentionPolicyFile}:1: deploy-skew retention policy must not classify client modules through mutable collection methods`,
    );
    expect(
      presetRetentionPolicyFindings(
        presetRetentionPolicyFile,
        `
          const clientModules = snapshotBuildArray(
            build.clientModules,
            'preset deploy-skew client modules',
          );
          for (let index = 0; index < clientModules.length; index += 1) {
            if (!isRuntime(clientModules[index])) break;
          }
        `,
      ),
    ).toEqual([]);
  });

  it('C205 pins built-in preset diagnostic aggregation and source classifiers', () => {
    const unsafe = `
      const diagnostics = [...clientModuleRetentionDiagnostics(build), ...missingJobRunnerDiagnostics(build)];
      diagnostics.push(...runtimeDiagnostics);
      const taskList = build.tasks.map((task) => task.key).join(', ');
      if (source.then) source.then(classify);
      for (const moduleName of cloudflareBlockedNodeModules) classify(moduleName);
    `;
    expect(presetDiagnosticAggregationFindings(presetRetentionPolicyFile, unsafe)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mutable Array.push'),
        expect.stringContaining('mutable iterator spread'),
        expect.stringContaining('snapshot tasks'),
        expect.stringContaining('mutable Promise.prototype.then'),
        expect.stringContaining('pinned snapshot and indexed traversal'),
      ]),
    );

    expect(
      presetDiagnosticAggregationFindings(
        presetRetentionPolicyFile,
        `
          function appendPresetDiagnostics(target, source) {
            const diagnostics = snapshotBuildArray(source, 'preset diagnostics');
            for (let index = 0; index < diagnostics.length; index += 1) {
              appendPresetDiagnostic(target, diagnostics[index]);
            }
          }
          function appendPresetDiagnostic(target, diagnostic) {
            commitBuildArrayValue(target, diagnostic, 'preset diagnostic');
          }
          const tasks = snapshotBuildArray(build.tasks, 'preset tasks');
          securityRegExpTest(modulePattern, source);
          securityPromiseThen(sourcePromise, classify);
        `,
      ),
    ).toEqual([]);
  });

  it('C208 pins Cloudflare option values and final Wrangler TOML assembly', () => {
    expect(
      cloudflareTomlAssemblyFindings(
        presetRetentionPolicyFile,
        `
          function wranglerTomlSource(options) {
            return ['main = "./worker.mjs"', ''].join('\n');
          }
        `,
      ),
    ).toContain(
      `${presetRetentionPolicyFile}:3: authoritative Wrangler TOML must not assemble through mutable Array.join`,
    );
    expect(
      cloudflareTomlAssemblyFindings(
        presetRetentionPolicyFile,
        `
          function snapshotCloudflarePresetOptions(options) {
            return buildOwnDataProperty(options, 'name', 'Cloudflare options.name');
          }
          function wranglerTomlSource(options) {
            const lines = snapshotBuildArray(
              ['main = "./worker.mjs"', ''],
              'Cloudflare Wrangler TOML lines',
            );
            return securityArrayJoin(lines, '\n');
          }
        `,
      ),
    ).toEqual([]);
  });

  it('C213 pins Node runtime package parsing and lockfile selection', () => {
    expect(
      nodeRuntimePackageBoundaryFindings(
        presetRetentionPolicyFile,
        `
          const manifest = JSON.parse(source);
          for (const fileName of ['package-lock.json', 'pnpm-lock.yaml']) copy(fileName);
        `,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mutable JSON.parse'),
        expect.stringContaining('pinned inventory and indexed traversal'),
      ]),
    );
    expect(
      nodeRuntimePackageBoundaryFindings(
        presetRetentionPolicyFile,
        `
          const parsed = securityJsonParse(source);
          function snapshotNodeRuntimePackageManifest(value) {
            const names = securityObjectKeys(value);
            return names;
          }
          const fileNames = snapshotBuildArray(
            runtimeLockfileNames,
            'Node runtime lockfile candidates',
          );
          for (let index = 0; index < fileNames.length; index += 1) copy(fileNames[index]);
        `,
      ),
    ).toEqual([]);
  });

  it('rejects raw fs access outside the filesystem boundary', () => {
    const result = runFixture({
      [filesystemBoundaryFile]: 'export const boundary = true;',
      'packages/server/src/feature.ts': `
import { readFile } from 'node:fs/promises';
export async function leak(path: string) {
  return readFile(path);
}
`,
    });

    expect(result.findings).toContain(
      `packages/server/src/feature.ts:2: raw node:fs/promises access must route through ${filesystemBoundaryFile}`,
    );
  });

  it('rejects path confinement primitives outside the filesystem boundary', () => {
    const result = runFixture({
      [filesystemBoundaryFile]: 'export const boundary = true;',
      'packages/server/src/path-bypass.ts': `
import path from 'node:path';
export function escape(root: string, key: string) {
  return path.resolve(root, key);
}
`,
    });

    expect(result.findings).toContain(
      `packages/server/src/path-bypass.ts:4: path confinement primitives must route through ${filesystemBoundaryFile}`,
    );
  });

  it('allows explicit build/tooling file exceptions without widening runtime production files', () => {
    const result = checkFilesystemBoundary({
      allowedRuntimeFiles: [filesystemBoundaryFile],
      allowedToolingFiles: ['packages/server/src/build.ts'],
      cloudflareTomlAssemblyFiles: [],
      exists: (relativePath) => relativePath === filesystemBoundaryFile,
      neutralPublicAssetCopyFiles: [],
      nodeRuntimePackageBoundaryFiles: [],
      presetDiagnosticAggregationFiles: [],
      presetRetentionPolicyFiles: [],
      readText: (relativePath) =>
        relativePath === 'packages/server/src/build.ts'
          ? "import { readFile } from 'node:fs/promises';"
          : 'export const boundary = true;',
      sourceFiles: [filesystemBoundaryFile, 'packages/server/src/build.ts'],
    });

    expect(result.findings).toEqual([]);
  });

  it('keeps the static-analysis Stats intrinsic in the tooling-only inventory', () => {
    expect(defaultAllowedToolingFiles).toContain(
      'packages/server/src/internal/data-plane-static-analysis-intrinsics.ts',
    );
  });
});
