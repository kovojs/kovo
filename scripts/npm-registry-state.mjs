import { execFileSync } from 'node:child_process';

export function readNpmPublishedState(name, version, { exec = execFileSync } = {}) {
  try {
    exec('npm', ['view', `${name}@${version}`, 'version', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { state: 'published' };
  } catch (error) {
    if (isMissingVersionError(error)) {
      return { state: 'missing' };
    }
    return { state: 'error', detail: formatNpmRegistryError(error) };
  }
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
