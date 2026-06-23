import { describe, expect, it } from 'vitest';

import {
  buildInlineKovoLoaderInstallerSource,
  inlineKovoLoaderInstallerReadableSource,
} from './inline-loader-build.js';
import { inlineKovoLoaderInstallerSource } from './inline-loader.js';

// Security finding M10: the inline loader's fragment-target lookup (`ft`) builds `querySelector`
// strings from wire data. Escaping keeps selector-hostile but valid ids targetable, while the
// try/catch remains a final guard so unexpected selector failures do not abort the response-apply
// pass and fall back to a fresh native form submit with no Kovo-Idem dedup.
//
// This is asserted at the source level across every shipped representation of the loader. The
// runtime artifact's byte-for-byte parity with this build source is independently enforced by
// `pnpm run check:inline-loader`, so a source that guards `ft` guarantees the shipped loader does.
describe('inline loader fragment-target selector guard (M10)', () => {
  const sources: readonly [string, string][] = [
    ['readable build source', inlineKovoLoaderInstallerReadableSource],
    ['freshly minified build source', buildInlineKovoLoaderInstallerSource()],
    ['generated runtime installer source', inlineKovoLoaderInstallerSource],
  ];

  it.each(sources)('guards the fragment-target querySelector in the %s', (_name, source) => {
    // The fragment-target selector is escaped before querySelector sees it...
    expect(source).toContain('[kovo-fragment-target="');
    expect(/try\s*\{[\s\S]{0,120}sq\(target\)/.test(source)).toBe(true);
    // ...explicit fragment targets are tried before component stamps...
    expect(source.indexOf('[kovo-fragment-target="')).toBeLessThan(source.indexOf('[kovo-c="'));
    // ...and a `catch` closes the guard so a malformed selector cannot throw out of `ft`.
    expect(/\[kovo-fragment-target="[\s\S]{0,700}?catch/.test(source)).toBe(true);
  });
});
