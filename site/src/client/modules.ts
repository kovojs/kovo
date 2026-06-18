import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server';

// The docs site's client islands (SPEC §4.4, §7 L1): search ⌘K, theme toggle,
// and the code-window copy button. They are authored source under src/client/
// and registered through the framework's versioned client-module registry — the
// same store createApp() serves to the browser — so the on:click hrefs carry an
// immutable content-hash version (SPEC §6.6) instead of bare, cache-unsafe paths.

const clientDir = fileURLToPath(new URL('./', import.meta.url));

function contentHash(source: string): string {
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

function register(
  registry: ReturnType<typeof createMemoryVersionedClientModuleRegistry>,
  name: string,
): string {
  const source = readFileSync(path.join(clientDir, name), 'utf8');
  return registry.put({
    path: `/c/${name}`,
    source,
    version: `site-${contentHash(source)}`,
  });
}

export const siteClientModules = createMemoryVersionedClientModuleRegistry();

/** Versioned hrefs (/c/__v/<version>/...) for each island, threaded into chrome
 * render context and the markdown copy button so on:click resolves the exact
 * registered module. */
export const clientHrefs = {
  code: register(siteClientModules, 'code.js'),
  search: register(siteClientModules, 'search.js'),
  theme: register(siteClientModules, 'theme.js'),
} as const;
