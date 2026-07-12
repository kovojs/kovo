import { describe, expect, it } from 'vitest';

import {
  checkFilesystemBoundary,
  defaultAllowedToolingFiles,
  filesystemBoundaryFile,
  filesystemIntrinsicsFile,
  staticExportEndpointBlockerFile,
  staticExportEndpointBlockerFindings,
  staticExportReplayArtifactCommitFindings,
  staticExportReplayArtifactFile,
} from './check-filesystem-boundary.mjs';

function runFixture(files, overrides = {}) {
  return checkFilesystemBoundary({
    allowedRuntimeFiles: [filesystemBoundaryFile],
    allowedToolingFiles: overrides.allowedToolingFiles ?? [],
    exists: (relativePath) => Object.hasOwn(files, relativePath),
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
      exists: (relativePath) => relativePath === filesystemBoundaryFile,
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
