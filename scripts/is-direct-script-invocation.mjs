import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Keep executable migration modules inert when their analyzers are bundled into the Kovo CLI.
 *
 * Bundlers collapse each module's `import.meta.url` to the CLI entry URL, so the usual direct
 * execution comparison alone cannot distinguish `node scripts/migrate-*.mjs` from `kovo export`.
 */
export function isDirectScriptInvocation(importMetaUrl, entryPath, expectedBasename) {
  return (
    typeof entryPath === 'string' &&
    basename(entryPath) === expectedBasename &&
    importMetaUrl === pathToFileURL(entryPath).href
  );
}
