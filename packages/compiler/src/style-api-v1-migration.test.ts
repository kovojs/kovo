import { describe, expect, it } from 'vitest';

import { analyzeStyleApiV1Migration } from './style-api-v1-migration.js';

describe('style API v1 migration analysis', () => {
  it('rewrites direct, aliased, and namespace-qualified StyleRecord type imports', () => {
    const source = `
import type { StyleRecord, StyleRecord as LocalStyle } from '@kovojs/style';
import * as style from '@kovojs/style';

export interface Props {
  root: StyleRecord;
  local: LocalStyle;
  nested: style.StyleRecord;
}
`;

    expect(analyzeStyleApiV1Migration({ fileName: 'button.tsx', source })).toEqual(
      expect.objectContaining({
        source: `
import type { StyleHandle, StyleHandle as LocalStyle } from '@kovojs/style';
import * as style from '@kovojs/style';

export interface Props {
  root: StyleHandle;
  local: LocalStyle;
  nested: style.StyleHandle;
}
`,
        status: 'rewritten',
      }),
    );
  });

  it('refuses createTheme imports because seed themes are not semantically equivalent', () => {
    const source = `
import { createTheme, defineVars } from '@kovojs/style';
const vars = defineVars({ accent: 'red' });
export const dark = createTheme(vars, { accent: 'black' });
`;
    const result = analyzeStyleApiV1Migration({ fileName: 'theme.ts', source });

    expect(result).toMatchObject({
      status: 'refused',
      refusals: [
        expect.objectContaining({
          category: 'app-context',
          reason: expect.stringContaining('no semantics-preserving replacement'),
        }),
      ],
    });
    expect(result.source).toBe(source);
  });

  it('refuses computed, dynamic-import, re-export, and retired Theme carriers', () => {
    const sources = [
      `import * as style from '@kovojs/style'; type X = typeof style['StyleRecord'];`,
      `import * as style from '@kovojs/style'; const name = 'StyleRecord'; type X = typeof style[typeof name];`,
      `const style = await import('@kovojs/style');`,
      `const style = require('@kovojs/style');`,
      `export type { StyleRecord } from '@kovojs/style';`,
      `export * from '@kovojs/style';`,
      `export * as style from '@kovojs/style';`,
      `import type { Theme } from '@kovojs/style'; type X = Theme;`,
    ];

    for (const source of sources) {
      expect(analyzeStyleApiV1Migration({ fileName: 'ambiguous.ts', source })).toMatchObject({
        status: 'refused',
      });
    }
  });

  it('refuses a shadowed direct binding rather than rewriting an unrelated local type', () => {
    const source = `
import type { StyleRecord } from '@kovojs/style';
export function read() {
  type StyleRecord = string;
  const value: StyleRecord = 'local';
  return value;
}
`;

    expect(analyzeStyleApiV1Migration({ fileName: 'shadowed.ts', source })).toMatchObject({
      status: 'refused',
      refusals: [expect.objectContaining({ category: 'ambiguous-binding' })],
    });
  });

  it('covers every removed representation and theme helper with a fail-closed refusal', () => {
    const removedTypes = [
      'AttrsResult',
      'Keyframes',
      'Style',
      'StyleNamespaces',
      'StylePrimitive',
      'Theme',
      'ThemeCustomColorGroup',
      'ThemeCustomColorInput',
      'ThemeCustomColorsInput',
      'ThemeFromSeedOptions',
      'ThemeReferencePaletteName',
      'ThemeReferencePalettes',
      'ThemeSchemeValues',
      'ThemeSeed',
      'ThemeShapeInput',
      'ThemeShapeTokenName',
      'ThemeShapeValues',
      'ThemeSystemColorName',
      'ThemeSystemColorValues',
      'ThemeVariant',
    ] as const;

    for (const symbol of removedTypes) {
      const source = `import type { ${symbol} } from '@kovojs/style'; type AppType = ${symbol};`;
      expect(analyzeStyleApiV1Migration({ fileName: 'types.ts', source })).toMatchObject({
        status: 'refused',
        refusals: [expect.objectContaining({ category: 'app-context' })],
      });
    }
  });

  it('leaves comments, strings, and already-current source unchanged', () => {
    const source = `
import type { StyleHandle } from '@kovojs/style';
// StyleRecord and createTheme are historical prose.
const note = 'StyleRecord';
export type Props = { root: StyleHandle };
`;

    expect(analyzeStyleApiV1Migration({ fileName: 'current.ts', source })).toEqual({
      source,
      status: 'unchanged',
    });
  });
});
