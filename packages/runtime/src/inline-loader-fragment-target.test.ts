import { describe, expect, it } from 'vitest';

import {
  buildInlineKovoLoaderInstallerSource,
  inlineKovoLoaderInstallerReadableSource,
} from './inline-loader-build.js';
import { createInlineKovoLoaderSource } from './inline-loader.js';

// Security finding M10: the inline loader's fragment-target lookup (`ft`) builds `querySelector`
// strings from un-escaped wire data. A malformed target (e.g. one containing a `"]` breakout)
// makes `querySelector` throw a SyntaxError; before the guard, that aborted the entire
// response-apply pass and fell back to a fresh native form submit with no Kovo-Idem dedup. The guard
// wraps the fragment-target lookups in try/catch so a malformed selector degrades to "no target
// found" instead of throwing.
//
// This is asserted at the source level across every shipped representation of the loader. The
// runtime artifact's byte-for-byte parity with this build source is independently enforced by
// `pnpm run check:inline-loader`, so a source that guards `ft` guarantees the shipped loader does.
describe('inline loader fragment-target selector guard (M10)', () => {
  const sources: readonly [string, string][] = [
    ['readable build source', inlineKovoLoaderInstallerReadableSource],
    ['freshly minified build source', buildInlineKovoLoaderInstallerSource()],
    ['generated bootstrap source', createInlineKovoLoaderSource('globalThis.__kovoInlineImport')],
  ];

  it.each(sources)('guards the fragment-target querySelector in the %s', (_name, source) => {
    // The fragment-target selector is still built from the wire target...
    expect(source).toContain('[kovo-c="');
    // ...the `[kovo-c="` lookup is opened inside a `try` block (var names may be minified)...
    expect(/try\s*\{[\s\S]{0,200}\[kovo-c="/.test(source)).toBe(true);
    // ...and a `catch` closes the guard so a malformed selector cannot throw out of `ft`.
    expect(/\[kovo-c="[\s\S]{0,600}?catch/.test(source)).toBe(true);
  });
});
