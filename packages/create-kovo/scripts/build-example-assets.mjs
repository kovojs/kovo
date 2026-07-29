import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const defaultRepositoryRoot = path.resolve(packageRoot, '../..');
const defaultCatalogPath = path.join(packageRoot, 'example-sources.json');
const defaultOutputRoot = path.join(packageRoot, 'dist/examples');
const assetSchema = 'create-kovo-example-assets/v1';

export function buildExampleAssets({
  catalogPath = defaultCatalogPath,
  outputRoot = defaultOutputRoot,
  repositoryRoot = defaultRepositoryRoot,
  trackedFiles = (exampleName) => listTrackedExampleFiles(repositoryRoot, exampleName),
} = {}) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  validateExampleSourceCatalog(catalog);

  const resolvedOutputRoot = path.resolve(outputRoot);
  rmSync(resolvedOutputRoot, { force: true, recursive: true });
  mkdirSync(resolvedOutputRoot, { recursive: true });

  const examples = {};
  for (const [exampleName, example] of Object.entries(catalog.examples)) {
    const tracked = trackedFiles(exampleName);
    validateExampleSourceInventory(exampleName, example, tracked);
    const sourceRoot = path.join(repositoryRoot, 'examples', exampleName);
    const canonicalSourceRoot = realpathSync(sourceRoot);
    const files = [];

    for (const relativePath of example.sources) {
      assertSafeExamplePath(relativePath);
      const sourcePath = path.join(sourceRoot, ...relativePath.split('/'));
      const status = lstatSync(sourcePath);
      if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error(
          `create-kovo example ${exampleName} source must be a regular tracked file: ${relativePath}`,
        );
      }
      const canonicalSource = realpathSync(sourcePath);
      if (!isWithin(canonicalSourceRoot, canonicalSource)) {
        throw new Error(
          `create-kovo example ${exampleName} source escapes its tracked root: ${relativePath}`,
        );
      }
      const source = readFileSync(canonicalSource);
      assertNoSecretMaterial(exampleName, relativePath, source);
      const destination = path.join(resolvedOutputRoot, exampleName, ...relativePath.split('/'));
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, source, { flag: 'wx', mode: 0o644 });
      files.push({
        bytes: source.byteLength,
        path: relativePath,
        sha256: createHash('sha256').update(source).digest('hex'),
      });
    }

    examples[exampleName] = { files };
  }

  const manifest = { schema: assetSchema, examples };
  writeFileSync(
    path.join(resolvedOutputRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o644 },
  );
  return manifest;
}

export function validateExampleSourceCatalog(catalog) {
  if (
    typeof catalog !== 'object' ||
    catalog === null ||
    catalog.schema !== 'create-kovo-example-sources/v1' ||
    typeof catalog.examples !== 'object' ||
    catalog.examples === null
  ) {
    throw new Error('Invalid create-kovo example source catalog.');
  }
  const names = Object.keys(catalog.examples);
  if (names.length !== 2 || !names.includes('crm') || !names.includes('commerce')) {
    throw new Error('create-kovo example source catalog must contain only crm and commerce.');
  }
  for (const [name, example] of Object.entries(catalog.examples)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(name)) {
      throw new Error(`Invalid create-kovo example name: ${name}`);
    }
    if (
      typeof example !== 'object' ||
      example === null ||
      typeof example.description !== 'string' ||
      typeof example.entry !== 'string' ||
      typeof example.label !== 'string' ||
      !Array.isArray(example.sources) ||
      !Array.isArray(example.excluded)
    ) {
      throw new Error(`Invalid create-kovo example catalog entry: ${name}`);
    }
    assertSafeExamplePath(example.entry);
    const accounted = new Set();
    for (const relativePath of example.sources) {
      assertSafeExamplePath(relativePath);
      if (accounted.has(relativePath)) {
        throw new Error(`Duplicate create-kovo example path for ${name}: ${relativePath}`);
      }
      accounted.add(relativePath);
    }
    for (const excluded of example.excluded) {
      if (
        typeof excluded !== 'object' ||
        excluded === null ||
        typeof excluded.path !== 'string' ||
        typeof excluded.reason !== 'string' ||
        excluded.reason.trim().length === 0
      ) {
        throw new Error(`Invalid create-kovo excluded-source entry for ${name}.`);
      }
      assertSafeExamplePath(excluded.path);
      if (accounted.has(excluded.path)) {
        throw new Error(`Duplicate create-kovo example path for ${name}: ${excluded.path}`);
      }
      accounted.add(excluded.path);
    }
    if (!example.sources.includes(example.entry)) {
      throw new Error(`create-kovo example ${name} entry is not an allowlisted source.`);
    }
  }
}

export function validateExampleSourceInventory(exampleName, example, trackedFiles) {
  const expected = [...example.sources, ...example.excluded.map((excluded) => excluded.path)].sort(
    (left, right) => left.localeCompare(right),
  );
  const actual = [...trackedFiles].sort((left, right) => left.localeCompare(right));
  if (new Set(actual).size !== actual.length) {
    throw new Error(`create-kovo example ${exampleName} tracked inventory contains duplicates.`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const unaccounted = actual.filter((file) => !expectedSet.has(file));
    const missing = expected.filter((file) => !actualSet.has(file));
    throw new Error(
      [
        `create-kovo example ${exampleName} source inventory drifted.`,
        ...(unaccounted.length === 0
          ? []
          : [`Unaccounted tracked files: ${unaccounted.join(', ')}`]),
        ...(missing.length === 0 ? [] : [`Catalog paths not tracked: ${missing.join(', ')}`]),
      ].join('\n'),
    );
  }
}

function listTrackedExampleFiles(repositoryRoot, exampleName) {
  const prefix = `examples/${exampleName}/`;
  const output = execFileSync('git', ['ls-files', '--', `examples/${exampleName}`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .filter(Boolean)
    .map((file) => {
      if (!file.startsWith(prefix)) {
        throw new Error(`Unexpected tracked create-kovo example path: ${file}`);
      }
      return file.slice(prefix.length);
    });
}

function assertSafeExamplePath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe create-kovo example source path: ${String(relativePath)}`);
  }
  const lower = relativePath.toLowerCase();
  if (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.includes('/.env') ||
    lower.includes('/node_modules/') ||
    lower.startsWith('node_modules/') ||
    lower.includes('/.git/') ||
    lower.startsWith('.git/') ||
    /(?:^|\/)(?:id_[rd]sa|.*\.(?:key|pem|p12|pfx))$/u.test(lower)
  ) {
    throw new Error(`Forbidden create-kovo example source path: ${relativePath}`);
  }
}

function assertNoSecretMaterial(exampleName, relativePath, source) {
  const text = source.toString('utf8');
  if (
    /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(text) ||
    /(?:^|\n)\s*(?:KOVO_CSRF_SECRET|DATABASE_URL|BETTER_AUTH_SECRET)\s*=\s*[^#\s][^\n]*/u.test(text)
  ) {
    throw new Error(
      `create-kovo example ${exampleName} source contains secret-shaped material: ${relativePath}`,
    );
  }
}

function isWithin(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  buildExampleAssets();
}
