import { readFileSync } from 'node:fs';

/** @internal Read the executing CLI package identity from a path valid in source and dist. */
export function readCliPackageVersion(): string {
  return readCliPackageVersionFromModuleUrl(import.meta.url);
}

/**
 * @internal Resolve the CLI package identity from either the published package layout or the
 * repository's bundled root `dist/cli/src` layout.
 */
export function readCliPackageVersionFromModuleUrl(moduleUrl: string | URL): string {
  const manifest = JSON.parse(readCliPackageManifest(moduleUrl)) as {
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

function readCliPackageManifest(moduleUrl: string | URL): string {
  const candidates = [
    new URL('../package.json', moduleUrl),
    new URL('../../../packages/cli/package.json', moduleUrl),
  ] as const;
  let missingManifestError: unknown;

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      missingManifestError = error;
    }
  }

  throw missingManifestError;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
