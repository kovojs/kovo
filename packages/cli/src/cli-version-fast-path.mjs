import { readFileSync } from 'node:fs';

const ROOT_VERSION_INVOCATIONS = Object.freeze(['--version', '-V', 'version']);
const EXACT_SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * Resolve the one root meta command that needs no dispatcher, authored code, or compiler realm.
 * The adjacent package manifest remains the authority in source and packed layouts. Invalid or
 * displaced package identity fails closed instead of falling through to a potentially different
 * version source.
 */
export function fastCliVersionOutput(args, binModuleUrl, readFile = readFileSync) {
  if (!Array.isArray(args) || args.length !== 1 || !ROOT_VERSION_INVOCATIONS.includes(args[0])) {
    return null;
  }
  const manifest = JSON.parse(readFile(new URL('../package.json', binModuleUrl), 'utf8'));
  if (manifest?.name !== '@kovojs/cli' || !EXACT_SEMVER.test(manifest?.version ?? '')) {
    throw new TypeError('@kovojs/cli package.json has an invalid package identity');
  }
  return `kovo ${manifest.version}\n`;
}
