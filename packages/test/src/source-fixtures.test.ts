import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

import {
  cssSourceDirectives,
  forbiddenBrowserArchitectureFacts,
  projectSourceSiteFact,
} from './source-fixtures.js';

describe('@jiso/test source fixture seam', () => {
  it('extracts Tailwind source directives without keeping a local fw-check parser', () => {
    expect(
      cssSourceDirectives(
        [
          '@import "tailwindcss";',
          '  @source "../index.html";',
          '@source inline("bg-emerald-50 text-emerald-700");',
        ].join('\n'),
      ),
    ).toEqual(['"../index.html"', 'inline("bg-emerald-50 text-emerald-700")']);
  });

  it('turns generated graph source sites into path and line facts', () => {
    expect(projectSourceSiteFact('examples/commerce/src/app.ts:42')).toEqual({
      line: 42,
      path: 'examples/commerce/src/app.ts',
    });
    expect(() => projectSourceSiteFact('examples/commerce/src/app.ts')).toThrow(
      'Project source site includes a line number: examples/commerce/src/app.ts',
    );
    expect(() => projectSourceSiteFact('examples/commerce/src/app.ts:0')).toThrow(
      'Project source site line is positive: examples/commerce/src/app.ts:0',
    );
  });

  it('returns structured forbidden browser architecture facts from TSX source', () => {
    const facts = forbiddenBrowserArchitectureFacts(
      ts,
      'packages/runtime/src/browser.tsx',
      [
        'customElements.define("x-card", XCard);',
        'host.attachShadow({ mode: "open" });',
        'window.addEventListener("unload", cleanup);',
        'window.addEventListener("pagehide", cleanup);',
        'router = createBrowserRouter(routes);',
        'hydrateRoot(root, <App />);',
        'window.onunload = cleanup;',
        'export const View = () => <script type="importmap" />;',
        'export const Safe = () => <script type="application/json" />;',
      ].join('\n'),
    );

    expect(
      facts.map(({ column, fileName, label, line, site }) => ({
        column,
        fileName,
        label,
        line,
        site,
      })),
    ).toEqual([
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'customElements.define',
        line: 1,
        site: 'packages/runtime/src/browser.tsx:1:1',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'attachShadow',
        line: 2,
        site: 'packages/runtime/src/browser.tsx:2:1',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'addEventListener unload',
        line: 3,
        site: 'packages/runtime/src/browser.tsx:3:1',
      },
      {
        column: 10,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'createBrowserRouter',
        line: 5,
        site: 'packages/runtime/src/browser.tsx:5:10',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'hydrateRoot',
        line: 6,
        site: 'packages/runtime/src/browser.tsx:6:1',
      },
      {
        column: 1,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'onunload',
        line: 7,
        site: 'packages/runtime/src/browser.tsx:7:1',
      },
      {
        column: 35,
        fileName: 'packages/runtime/src/browser.tsx',
        label: 'importmap script',
        line: 8,
        site: 'packages/runtime/src/browser.tsx:8:35',
      },
    ]);
  });
});
