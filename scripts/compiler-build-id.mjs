import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const compilerPackageName = '@kovojs/compiler';
const compilerPackageVersion = '0.1.0';
const compilerBuildIdVersion = 'compiler-build-id/v1';

const sourceFingerprints = Object.fromEntries(
  walk(join(repoRoot, 'packages/compiler/src'))
    .filter((fileName) => fileName.endsWith('.ts'))
    .map((fileName) => [
      relative(repoRoot, fileName).replaceAll('\\', '/'),
      sha256(readFileSync(fileName)),
    ]),
);

const payload = {
  packageName: compilerPackageName,
  packageVersion: compilerPackageVersion,
  sourceFingerprints,
  version: compilerBuildIdVersion,
};

process.stdout.write(
  `${compilerPackageName}@${compilerPackageVersion}/${sha256(canonicalJson(payload)).slice(0, 16)}\n`,
);

function walk(dir) {
  return readdirSync(dir)
    .flatMap((entry) => {
      const fileName = join(dir, entry);
      return statSync(fileName).isDirectory() ? walk(fileName) : [fileName];
    })
    .sort();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
