import { execFileSync } from 'node:child_process';

export const npmPublicRegistry = 'https://registry.npmjs.org/';

export function readNpmPublishedState(name, version, { exec = execFileSync } = {}) {
  try {
    const output = exec(
      'vp',
      [
        'exec',
        'npm',
        'view',
        `${name}@${version}`,
        'dist.integrity',
        '--json',
        '--registry',
        npmPublicRegistry,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const integrity = parsePublishedIntegrity(output, name, version);
    return { state: 'published', integrity };
  } catch (error) {
    if (isMissingVersionError(error)) {
      return { state: 'missing' };
    }
    return { state: 'error', detail: formatNpmRegistryError(error) };
  }
}

export function parsePublishedIntegrity(output, name = 'package', version = 'version') {
  let integrity;
  try {
    integrity = JSON.parse(output);
  } catch {
    throw new Error(`${name}@${version}: npm returned invalid JSON for dist.integrity`);
  }
  if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) {
    throw new Error(`${name}@${version}: npm did not return a valid sha512 dist.integrity`);
  }
  return integrity;
}

export function formatNpmRegistryError(error) {
  const parts = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return 'npm view failed without stderr/stdout details';
  }
  return parts.join('\n');
}

function isMissingVersionError(error) {
  const detail = [error?.stderr, error?.stdout, error?.message]
    .filter((value) => typeof value === 'string')
    .join('\n');
  return /\bE404\b/.test(detail);
}
