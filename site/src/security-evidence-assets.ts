import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRootPath = fileURLToPath(new URL('../../', import.meta.url));

export async function stageAnalyzableFragmentPublicAssets(outDir: string): Promise<void> {
  const manifestPath = 'security/analyzable-fragment.json';
  const rawManifest = await readFile(path.join(repoRootPath, manifestPath), 'utf8');
  const manifest: unknown = JSON.parse(rawManifest);
  if (
    !isRecord(manifest) ||
    manifest.schema !== 'kovo-analyzable-fragment/v1' ||
    !isRecord(manifest.handArgument) ||
    typeof manifest.handArgument.file !== 'string' ||
    !Array.isArray(manifest.prohibitions)
  ) {
    throw new TypeError('site export: analyzable-fragment evidence manifest is malformed.');
  }

  const sources = [
    { publicPath: manifestPath, sourcePath: manifestPath },
    {
      publicPath: path.posix.basename(manifest.handArgument.file),
      sourcePath: manifest.handArgument.file,
    },
  ];
  for (const prohibition of manifest.prohibitions) {
    if (
      !isRecord(prohibition) ||
      !isRecord(prohibition.witness) ||
      typeof prohibition.witness.file !== 'string'
    ) {
      throw new TypeError('site export: analyzable-fragment witness entry is malformed.');
    }
    sources.push({
      publicPath: prohibition.witness.file,
      sourcePath: prohibition.witness.file,
    });
  }

  for (const source of sources) {
    assertAnalyzableFragmentPublicSource(source.sourcePath, manifestPath);
    const target = containedOutputPath(outDir, source.publicPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(repoRootPath, source.sourcePath)));
  }
}

function assertAnalyzableFragmentPublicSource(sourcePath: string, manifestPath: string): void {
  const allowed =
    sourcePath === manifestPath ||
    sourcePath === 'spec/06-analyzable-fragment-hand-argument.md' ||
    (sourcePath.startsWith('packages/compiler/src/fixtures/analyzable-fragment/') &&
      sourcePath.endsWith('.tsx.txt'));
  if (
    !allowed ||
    path.posix.isAbsolute(sourcePath) ||
    path.posix.normalize(sourcePath) !== sourcePath ||
    sourcePath.includes('\\')
  ) {
    throw new TypeError(`site export: refused analyzable-fragment public source '${sourcePath}'.`);
  }
}

function containedOutputPath(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...relativePath.split('/'));
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new TypeError(`site export: refused public output path '${relativePath}'.`);
  }
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
