import { describe, expect, it } from 'vitest';

import {
  checkFilesystemBoundary,
  defaultAllowedToolingFiles,
  filesystemBoundaryFile,
  filesystemIntrinsicsFile,
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
