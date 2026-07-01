import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { collectSourceFiles } from './lib/source-files.mjs';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const compilerPackageName = '@kovojs/compiler';
const compilerPackageVersion = '0.1.0';
const compilerBuildIdVersion = 'compiler-build-id/v1';

const sourceFingerprints = Object.fromEntries(
  collectSourceFiles(repoRoot, ['packages/compiler/src'], {
    absolute: true,
    includeFile: ({ relativePath }) => relativePath.endsWith('.ts'),
  })
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
