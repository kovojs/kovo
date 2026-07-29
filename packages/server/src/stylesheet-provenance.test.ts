import { describe, expect, it } from 'vitest';

import { stylesheetCallerFile } from './stylesheet-provenance.js';

describe('stylesheet provenance', () => {
  it('finds the app caller when published helpers share a content-hashed chunk', () => {
    expect(
      stylesheetCallerFile(
        [
          'Error',
          '    at stylesheetCallerFile (file:///app/node_modules/@kovojs/server/dist/document-core-a1b2c3.mjs:10:2)',
          '    at localStylesheetSourceFile (file:///app/node_modules/@kovojs/server/dist/document-core-a1b2c3.mjs:20:2)',
          '    at stylesheet (file:///app/node_modules/@kovojs/server/dist/document-core-a1b2c3.mjs:30:2)',
          '    at file:///app/src/app.tsx:8:17',
        ].join('\n'),
      ),
    ).toBe('file:///app/src/app.tsx');
  });

  it('continues to recognize unbundled hints source frames', () => {
    expect(
      stylesheetCallerFile(
        [
          'Error',
          '    at stylesheetCallerFile (file:///repo/packages/server/src/stylesheet-provenance.ts:10:2)',
          '    at localStylesheetSourceFile (file:///repo/packages/server/src/hints.ts:20:2)',
          '    at stylesheet (file:///repo/packages/server/src/hints.ts:30:2)',
          '    at /tmp/kovo-app/src/app.tsx:8:17',
        ].join('\n'),
      ),
    ).toBe('file:///tmp/kovo-app/src/app.tsx');
  });
});
