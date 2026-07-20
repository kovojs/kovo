import { describe, expect, it } from 'vitest';

import { collectStaticBuildTrustFactsFromProject } from './trust-escapes-static.js';

const unsupportedDirectives = [
  '@jsxRuntime classic',
  '@jsx h',
  '@jsxFrag Fragment',
  '@jsxImportSource react',
] as const;

function jsxRuntimeOverrideSinks(fileName: string, source: string) {
  return collectStaticBuildTrustFactsFromProject({
    files: [{ fileName, source }],
  }).unregisteredSinks.filter((fact) => fact.sink === 'compiler.jsx-runtime-override');
}

describe('static JSX pragma authority closure', () => {
  // @kovo-security-classifier-corpus kv424-request-process
  // @kovo-security-certifies C13 static-build-jsx-pragma-closure
  // SPEC §5.2/§6.6: the pre-evaluation project analysis must close every comment-borne
  // runtime override before Vite can turn authored JSX into an unanalyzed custom factory call.
  it.each(['tsx', 'jsx'])(
    'closes classic and custom JSX pragma authority throughout authored .%s comments',
    (extension) => {
      const placeDirective = [
        (directive: string) => `/** ${directive} */\n`,
        (directive: string) => `'use strict';\n/** ${directive} */\n`,
        (directive: string) => `const marker = 0; /** ${directive} */\n`,
      ];

      for (const directive of unsupportedDirectives) {
        for (const place of placeDirective) {
          const source = `${place(directive)}export const Unsafe = <div />;\n`;
          expect(jsxRuntimeOverrideSinks(`src/unsafe.${extension}`, source)).toEqual([
            expect.objectContaining({
              safePath: 'use the compiler-owned automatic @kovojs/server JSX runtime',
              sink: 'compiler.jsx-runtime-override',
              source: directive,
            }),
          ]);
        }
      }
    },
  );

  it.each(['tsx', 'jsx'])(
    'does not classify JSX pragma spellings inside authored .%s string literals as comments',
    (extension) => {
      const source = `
const examples = [
  '/** @jsxRuntime classic */',
  '/** @jsx h */',
  '/** @jsxFrag Fragment */',
  '/** @jsxImportSource react */',
  \`/** @jsxRuntime classic */\`,
];
const pattern = /\\/\\*\\* @jsx h \\*\\//u;
export const Safe = <div>{examples.length + pattern.source.length}</div>;
`;

      expect(jsxRuntimeOverrideSinks(`src/safe.${extension}`, source)).toEqual([]);
    },
  );

  it('ignores pragma-shaped comments in a non-JSX helper module', () => {
    expect(
      jsxRuntimeOverrideSinks(
        'src/docs.ts',
        `/** Example only: @jsx h */\nexport const documentation = true;\n`,
      ),
    ).toEqual([]);
  });

  it.each(['tsx', 'jsx'])(
    'accepts only the exact framework JSX import source throughout authored .%s comments',
    (extension) => {
      const source = `
'use strict';
const marker = 0; /** @jsxImportSource @kovojs/server */
export const Safe = <div />;
`;

      expect(jsxRuntimeOverrideSinks(`src/safe.${extension}`, source)).toEqual([]);
    },
  );
});
