import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
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
  readonly tarballSha256: string;
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
    throw new Error('D1 v6 fresh artifact build requires a clean framework source tree.');
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
    const stagingDestination = join(root, 'staging-packs', packageName);
    await mkdir(stagingDestination, { recursive: true });
    const args = ['--filter', name, 'pack', '--pack-destination', stagingDestination];
    run('pnpm', args, repoRoot);
    buildCommands.push(
      `pnpm --filter ${name} pack --pack-destination <artifact>/staging-packs/${packageName}`,
    );
    const stagingTarballName = (await readdir(stagingDestination)).find((entry) =>
      entry.endsWith('.tgz'),
    );
    if (!stagingTarballName) throw new Error(`Fresh pack for ${name} did not emit a tarball.`);
    const stagedExtraction = join(root, 'staged', packageName);
    await mkdir(stagedExtraction, { recursive: true });
    run(
      'tar',
      ['-xzf', join(stagingDestination, stagingTarballName), '-C', stagedExtraction],
      repoRoot,
    );
    const stagedPackageRoot = await realpath(join(stagedExtraction, 'package'));
    await canonicalizePublishedDependencyOrder(stagedPackageRoot);
    buildCommands.push(`canonicalize ${name} published dependency order`);

    const destination = join(root, 'packed', packageName);
    await mkdir(destination, { recursive: true });
    const repackArgs = ['pack', '--ignore-scripts', '--pack-destination', destination];
    run('npm', repackArgs, stagedPackageRoot);
    buildCommands.push(
      `npm pack --ignore-scripts --pack-destination <artifact>/packed/${packageName}`,
    );
    const tarballName = (await readdir(destination)).find((entry) => entry.endsWith('.tgz'));
    if (!tarballName) throw new Error(`Deterministic repack for ${name} did not emit a tarball.`);
    const tarball = join(destination, tarballName);
    canonicalizeTarball(tarball);
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
      tarballSha256: sha256(await readFile(tarball)),
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

export async function packSealedOverlay(
  packageRoot: string,
  destination: string,
): Promise<{ readonly sha256: string; readonly tarball: string }> {
  await mkdir(destination, { recursive: true });
  const before = new Set((await readdir(destination)).filter((entry) => entry.endsWith('.tgz')));
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', destination], packageRoot);
  const created = (await readdir(destination)).filter(
    (entry) => entry.endsWith('.tgz') && !before.has(entry),
  );
  if (created.length !== 1) {
    throw new Error(`D1 v6 sealed overlay pack emitted ${created.length} tarballs.`);
  }
  const tarball = join(destination, created[0]!);
  canonicalizeTarball(tarball);
  return { sha256: sha256(await readFile(tarball)), tarball };
}

export async function directorySubject(directory: string): Promise<ContentSubject> {
  return directoryContentSubject(directory);
}

async function canonicalizePublishedDependencyOrder(packageRoot: string): Promise<void> {
  const manifestPath = join(packageRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'peerDependenciesMeta',
  ] as const) {
    const value = manifest[field];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    manifest[field] = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  }
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (serialized.includes('"workspace:')) {
    throw new Error('D1 v6 staged published manifest retained a workspace protocol.');
  }
  await writeFile(manifestPath, serialized);
}

export async function loadAuthenticatedPackedCompiler(
  artifacts: FreshArtifactSet,
): Promise<LoadedPackedCompiler> {
  const compilerRoot = artifacts.packages.compiler.extractedPackageRoot;
  const dependencyDirectory = join(compilerRoot, 'node_modules');
  await mkdir(join(dependencyDirectory, '@kovojs'), { recursive: true });
  await linkAuthenticatedPackedKovoDependency(compilerRoot, 'browser', artifacts.packages.browser);
  await linkAuthenticatedPackedKovoDependency(compilerRoot, 'core', artifacts.packages.core);
  for (const dependency of ['style', 'verify'] as const) {
    await symlink(
      await realpath(join(repoRoot, `packages/compiler/node_modules/@kovojs/${dependency}`)),
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

async function linkAuthenticatedPackedKovoDependency(
  consumerRoot: string,
  packageName: 'browser' | 'core',
  artifact: PackedArtifact,
): Promise<void> {
  const expectedName = `@kovojs/${packageName}`;
  if (artifact.name !== expectedName) {
    throw new Error(`D1 v6 packed dependency ${expectedName} was paired with ${artifact.name}.`);
  }

  const authenticatedRoot = await realpath(artifact.extractedPackageRoot);
  const observedSubject = await directoryContentSubject(authenticatedRoot);
  if (JSON.stringify(observedSubject) !== JSON.stringify(artifact.packedContents)) {
    throw new Error(
      `D1 v6 packed dependency ${expectedName} extracted bytes do not match the authenticated packed content subject.`,
    );
  }

  const dependencyLink = join(consumerRoot, 'node_modules', ...expectedName.split('/'));
  await mkdir(join(consumerRoot, 'node_modules', '@kovojs'), { recursive: true });
  await symlink(authenticatedRoot, dependencyLink, 'dir');
  const resolvedRoot = await realpath(dependencyLink);
  if (resolvedRoot !== authenticatedRoot) {
    throw new Error(
      `D1 v6 packed dependency ${expectedName} resolved outside its authenticated extracted package.`,
    );
  }
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

function canonicalizeTarball(tarball: string): void {
  const helper = join(repoRoot, 'scripts/lib/deterministic-tarball.mjs');
  run(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      'const { canonicalizePackedTarball } = await import(process.argv[1]); canonicalizePackedTarball(process.argv[2]);',
      pathToFileURL(helper).href,
      tarball,
    ],
    repoRoot,
  );
}
