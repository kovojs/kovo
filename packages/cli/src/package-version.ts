import { readFileSync } from 'node:fs';

/** @internal Read the executing CLI package identity from a path valid in source and dist. */
export function readCliPackageVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    version?: unknown;
  };
  if (
    typeof manifest.version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
  ) {
    throw new TypeError('@kovojs/cli package.json is missing an exact semantic version');
  }
  return manifest.version;
}
