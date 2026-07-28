import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const packageNames = ['browser', 'compiler', 'core', 'server'] as const;
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface FileSubject {
  readonly bytes: number;
  readonly executable: boolean;
  readonly path: string;
  readonly schema: 'kovo.app-contract-d1-file-subject/v1';
  readonly sha256: string;
}

export interface ContentSubject {
  readonly digest: string;
  readonly files: readonly FileSubject[];
  readonly schema: 'kovo.app-contract-d1-content-subject/v1';
}

export interface PackedArtifact {
  readonly extractedPackageRoot: string;
  readonly name: string;
  readonly packedContents: ContentSubject;
  readonly sourceContents: ContentSubject;
  readonly sourceSha256: string;
  readonly tarball: string;
}

export interface FreshArtifactSet {
  readonly buildCommands: readonly string[];
  readonly frameworkHeadCommit: string;
  readonly frameworkSourceCommit: string;
  readonly frameworkSourceContents: ContentSubject;
  readonly frameworkSourceTreeClean: boolean;
  readonly packages: Readonly<Record<(typeof packageNames)[number], PackedArtifact>>;
}

export interface PackedCompilerEntrypoint {
  readonly packedFile: FileSubject;
  readonly realpath: string;
  readonly requested: '@kovojs/compiler' | '@kovojs/compiler/internal';
  readonly resolvedSha256: string;
}

export interface LoadedPackedCompiler {
  readonly entrypoints: readonly PackedCompilerEntrypoint[];
  readonly internal: Readonly<Record<string, unknown>>;
  readonly root: Readonly<Record<string, unknown>>;
}

export async function buildAndPackFresh(root: string): Promise<FreshArtifactSet> {
  const frameworkHeadCommit = git('rev-parse', 'HEAD').trim();
  const frameworkSourceTreeClean =
    git('status', '--porcelain=v1', '--untracked-files=all').trim() === '';
  if (!frameworkSourceTreeClean) {
    throw new Error('D1 v5 fresh artifact build requires a clean framework source tree.');
  }
  const frameworkSourceFiles = frameworkFiles();
  const frameworkSourceContents = await contentSubject(repoRoot, frameworkSourceFiles);
  const buildCommands: string[] = [];
  for (const packageName of ['core', 'browser', 'server', 'compiler'] as const) {
    const name = `@kovojs/${packageName}`;
    const args = ['--filter', name, 'run', 'build:dist'];
    run('pnpm', args, repoRoot);
    buildCommands.push(`pnpm ${args.join(' ')}`);
  }

  const packed = {} as Record<(typeof packageNames)[number], PackedArtifact>;
  for (const packageName of packageNames) {
    const name = `@kovojs/${packageName}`;
    const destination = join(root, 'packed', packageName);
    await mkdir(destination, { recursive: true });
    const args = ['--filter', name, 'pack', '--pack-destination', destination];
    run('pnpm', args, repoRoot);
    buildCommands.push(`pnpm ${args.join(' ')}`);
    const tarballName = (await readdir(destination)).find((entry) => entry.endsWith('.tgz'));
    if (!tarballName) throw new Error(`Fresh pack for ${name} did not emit a tarball.`);
    const tarball = join(destination, tarballName);
    const extracted = join(root, 'extracted', packageName);
    await mkdir(extracted, { recursive: true });
    run('tar', ['-xzf', tarball, '-C', extracted], repoRoot);
    const extractedPackageRoot = await realpath(join(extracted, 'package'));
    const sourceContents = await contentSubject(repoRoot, packageFiles(packageName));
    packed[packageName] = {
      extractedPackageRoot,
      name,
      packedContents: await directoryContentSubject(extractedPackageRoot),
      sourceContents,
      sourceSha256: sourceContents.digest,
      tarball,
    };
  }

  return {
    buildCommands,
    frameworkHeadCommit,
    frameworkSourceCommit: frameworkSourceCommit(),
    frameworkSourceContents,
    frameworkSourceTreeClean,
    packages: packed,
  };
}

export async function loadAuthenticatedPackedCompiler(
  artifacts: FreshArtifactSet,
): Promise<LoadedPackedCompiler> {
  const compilerRoot = artifacts.packages.compiler.extractedPackageRoot;
  const dependencyDirectory = join(compilerRoot, 'node_modules');
  await mkdir(join(dependencyDirectory, '@kovojs'), { recursive: true });
  await symlink(
    artifacts.packages.core.extractedPackageRoot,
    join(dependencyDirectory, '@kovojs/core'),
    'dir',
  );
  for (const dependency of ['style', 'verify'] as const) {
    await symlink(
      await realpath(join(repoRoot, `node_modules/@kovojs/${dependency}`)),
      join(dependencyDirectory, `@kovojs/${dependency}`),
      'dir',
    );
  }
  await symlink(
    await realpath(join(repoRoot, 'node_modules/typescript')),
    join(dependencyDirectory, 'typescript'),
    'dir',
  );

  const requested = [
    ['@kovojs/compiler', 'dist/index.mjs'],
    ['@kovojs/compiler/internal', 'dist/internal.mjs'],
  ] as const;
  const entrypoints: PackedCompilerEntrypoint[] = [];
  for (const [name, packedPath] of requested) {
    const resolved = await realpath(join(compilerRoot, packedPath));
    const packedFile = artifacts.packages.compiler.packedContents.files.find(
      (file) => file.path === packedPath,
    );
    if (!packedFile) throw new Error(`Packed compiler subject is missing ${packedPath}.`);
    if (!isWithin(compilerRoot, resolved)) {
      throw new Error(`${name} resolved outside the extracted compiler package: ${resolved}.`);
    }
    const resolvedSha256 = sha256(await readFile(resolved));
    if (resolvedSha256 !== packedFile.sha256) {
      throw new Error(`${name} resolved bytes do not match the packed content subject.`);
    }
    entrypoints.push({ packedFile, realpath: resolved, requested: name, resolvedSha256 });
  }

  const cacheKey = artifacts.packages.compiler.packedContents.digest;
  const root = (await import(
    `${pathToFileURL(entrypoints[0]!.realpath).href}?d1=${cacheKey}`
  )) as Readonly<Record<string, unknown>>;
  const internal = (await import(
    `${pathToFileURL(entrypoints[1]!.realpath).href}?d1=${cacheKey}`
  )) as Readonly<Record<string, unknown>>;
  return { entrypoints, internal, root };
}

export async function fileSubject(baseDirectory: string, fileName: string): Promise<FileSubject> {
  const absolute = join(baseDirectory, fileName);
  const bytes = await readFile(absolute);
  const metadata = await lstat(absolute);
  return {
    bytes: bytes.byteLength,
    executable: (metadata.mode & 0o111) !== 0,
    path: fileName.replaceAll('\\', '/'),
    schema: 'kovo.app-contract-d1-file-subject/v1',
    sha256: sha256(bytes),
  };
}

export async function contentSubject(
  baseDirectory: string,
  files: readonly string[],
): Promise<ContentSubject> {
  const subjects: FileSubject[] = [];
  for (const fileName of files) subjects.push(await fileSubject(baseDirectory, fileName));
  subjects.sort((left, right) => left.path.localeCompare(right.path));
  return {
    digest: contentSubjectDigest(subjects),
    files: subjects,
    schema: 'kovo.app-contract-d1-content-subject/v1',
  };
}

export function contentSubjectDigest(files: readonly FileSubject[]): string {
  return sha256(
    JSON.stringify({
      files,
      schema: 'kovo.app-contract-d1-content-subject/v1',
    }),
  );
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function repoRootPath(): string {
  return repoRoot;
}

async function directoryContentSubject(directory: string): Promise<ContentSubject> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(relative(directory, absolute).replaceAll('\\', '/'));
    }
  };
  await visit(directory);
  return contentSubject(directory, files);
}

function frameworkSourceCommit(): string {
  return run(
    'git',
    [
      'log',
      '-1',
      '--format=%H',
      '--',
      'packages/browser/package.json',
      'packages/browser/src',
      'packages/compiler/package.json',
      'packages/compiler/src',
      'packages/core/package.json',
      'packages/core/src',
      'packages/server/package.json',
      'packages/server/src',
    ],
    repoRoot,
  ).trim();
}

function frameworkFiles(): string[] {
  return git(
    'ls-files',
    'packages/browser/package.json',
    'packages/browser/src',
    'packages/compiler/package.json',
    'packages/compiler/src',
    'packages/core/package.json',
    'packages/core/src',
    'packages/server/package.json',
    'packages/server/src',
  )
    .split('\n')
    .filter(Boolean)
    .sort();
}

function packageFiles(packageName: (typeof packageNames)[number]): string[] {
  return git('ls-files', `packages/${packageName}/package.json`, `packages/${packageName}/src`)
    .split('\n')
    .filter(Boolean)
    .sort();
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\');
}

function git(...args: readonly string[]): string {
  return run('git', args, repoRoot);
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status ?? 'signal'}):\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}
