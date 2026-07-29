import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sourceCatalogJson from '../example-sources.json' with { type: 'json' };

export type CreateKovoExampleName = 'commerce' | 'crm';

interface ExampleSourceDefinition {
  description: string;
  entry: string;
  excluded: readonly { path: string; reason: string }[];
  label: string;
  sources: readonly string[];
}

interface ExampleSourceCatalog {
  examples: Record<CreateKovoExampleName, ExampleSourceDefinition>;
  schema: 'create-kovo-example-sources/v1';
}

interface ExampleAssetFile {
  bytes: number;
  path: string;
  sha256: string;
}

interface ExampleAssetManifest {
  examples: Record<CreateKovoExampleName, { files: readonly ExampleAssetFile[] }>;
  schema: 'create-kovo-example-assets/v1';
}

export interface KovoExampleSourceFile {
  path: string;
  source: string;
}

export const CREATE_KOVO_EXAMPLE_SOURCE_CATALOG = sourceCatalogJson as ExampleSourceCatalog;

export const CREATE_KOVO_EXAMPLE_NAMES = Object.freeze(
  Object.keys(CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples),
) as readonly CreateKovoExampleName[];

export function isCreateKovoExampleName(value: string): value is CreateKovoExampleName {
  return (CREATE_KOVO_EXAMPLE_NAMES as readonly string[]).includes(value);
}

export function readKovoExampleSourceFiles(
  exampleName: CreateKovoExampleName,
  { assetRoot }: { assetRoot?: string } = {},
): readonly KovoExampleSourceFile[] {
  const definition = CREATE_KOVO_EXAMPLE_SOURCE_CATALOG.examples[exampleName];
  const resolvedAssetRoot = assetRoot ? resolve(assetRoot) : resolveDefaultAssetRoot();
  const manifestPath = resolve(resolvedAssetRoot, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return readWorkspaceExampleSources(exampleName, definition, resolvedAssetRoot);
  }

  const manifest = readExampleAssetManifest(manifestPath);
  const assetFiles = manifest.examples[exampleName]?.files;
  if (!assetFiles) {
    throw new Error(`Bundled create-kovo example assets are missing ${exampleName}.`);
  }
  const expectedPaths = [...definition.sources].sort();
  const actualPaths = assetFiles.map((file) => file.path).sort();
  if (
    new Set(actualPaths).size !== actualPaths.length ||
    JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)
  ) {
    throw new Error(`Bundled create-kovo example ${exampleName} source inventory drifted.`);
  }

  const exampleRoot = resolve(resolvedAssetRoot, exampleName);
  return assetFiles.map((file) => {
    assertSafeExamplePath(file.path);
    if (
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    ) {
      throw new Error(`Invalid bundled create-kovo example metadata: ${exampleName}/${file.path}`);
    }
    const sourcePath = resolve(exampleRoot, ...file.path.split('/'));
    assertRegularFileWithin(exampleRoot, sourcePath, `${exampleName}/${file.path}`);
    const source = readFileSync(sourcePath);
    const digest = createHash('sha256').update(source).digest('hex');
    if (source.byteLength !== file.bytes || digest !== file.sha256) {
      throw new Error(
        `Bundled create-kovo example source failed integrity: ${exampleName}/${file.path}`,
      );
    }
    return { path: file.path, source: source.toString('utf8') };
  });
}

function resolveDefaultAssetRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const bundledRoot = resolve(moduleDirectory, 'examples');
  if (existsSync(resolve(bundledRoot, 'manifest.json'))) return bundledRoot;
  if (basename(moduleDirectory) !== 'src') {
    throw new Error('Packed create-kovo is missing its authenticated example asset manifest.');
  }
  return fileURLToPath(new URL('../../../examples/', import.meta.url));
}

function readWorkspaceExampleSources(
  exampleName: CreateKovoExampleName,
  definition: ExampleSourceDefinition,
  examplesRoot: string,
): readonly KovoExampleSourceFile[] {
  const exampleRoot = resolve(examplesRoot, exampleName);
  return definition.sources.map((path) => {
    assertSafeExamplePath(path);
    const sourcePath = resolve(exampleRoot, ...path.split('/'));
    assertRegularFileWithin(exampleRoot, sourcePath, `${exampleName}/${path}`);
    return { path, source: readFileSync(sourcePath, 'utf8') };
  });
}

function readExampleAssetManifest(manifestPath: string): ExampleAssetManifest {
  const status = lstatSync(manifestPath);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error('Bundled create-kovo example manifest must be a regular file.');
  }
  const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<ExampleAssetManifest>;
  if (
    value.schema !== 'create-kovo-example-assets/v1' ||
    typeof value.examples !== 'object' ||
    value.examples === null
  ) {
    throw new Error('Invalid bundled create-kovo example manifest.');
  }
  return value as ExampleAssetManifest;
}

function assertSafeExamplePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes('\\') ||
    isAbsolute(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe bundled create-kovo example path: ${path}`);
  }
}

function assertRegularFileWithin(root: string, file: string, label: string): void {
  const status = lstatSync(file);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`Bundled create-kovo example source must be a regular file: ${label}`);
  }
  const canonicalRoot = realpathSync(root);
  const canonicalFile = realpathSync(file);
  const relativePath = relative(canonicalRoot, canonicalFile);
  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    dirname(canonicalFile) === canonicalFile
  ) {
    throw new Error(`Bundled create-kovo example source escapes its asset root: ${label}`);
  }
}
