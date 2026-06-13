import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { buildInlineJisoLoaderInstallerSource } from './inline-loader-build.js';
import { expectInlineResponseApplyParity } from './inline-loader-response-apply-fixture.js';

describe('minified inline loader response apply source', () => {
  it('keeps minified enhanced response apply in parity with modular DOM apply', async () => {
    // SPEC.md §4.4/§9.1: minification cannot fork the inline mutation response
    // scanner or the raw `jiso:query` event handoff used by runtime query apply.
    const minifiedSource = buildInlineJisoLoaderInstallerSource();

    expect(minifiedSource).toBe(minifiedSource.trim());
    expect(minifiedSource).not.toMatch(/\n|\s{2,}/);
    await expectInlineResponseApplyParity(
      (importModule, globalRecord) => {
        globalRecord.__jisoInlineImport = importModule;
        runInThisContext(`(${minifiedSource})(globalThis.__jisoInlineImport);`);
      },
      { expect, vi },
    );
  });
});
