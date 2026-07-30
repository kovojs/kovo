import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isDirectScriptInvocation } from './is-direct-script-invocation.mjs';

describe('migration script direct-entry detection', () => {
  it('recognizes the exact standalone migration executable', () => {
    const entryPath = resolve('scripts/migrate-core-api-v1.mjs');

    expect(
      isDirectScriptInvocation(pathToFileURL(entryPath).href, entryPath, 'migrate-core-api-v1.mjs'),
    ).toBe(true);
  });

  it('keeps bundled migration analyzers inert when import.meta.url collapses to the CLI entry', () => {
    const cliEntryPath = resolve('dist/cli/src/index.mjs');

    expect(
      isDirectScriptInvocation(
        pathToFileURL(cliEntryPath).href,
        cliEntryPath,
        'migrate-core-api-v1.mjs',
      ),
    ).toBe(false);
  });
});
