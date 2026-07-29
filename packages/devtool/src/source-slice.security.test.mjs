/* oxlint-disable typescript/unbound-method -- Test restores deliberately poisoned methods. */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildBundle, resolveSource } from './source-slice.mjs';

function pageGraph(...routes) {
  return {
    pages: routes.map((route) => ({ navigationSegments: [], route })),
  };
}

describe('devtool source-root confinement', () => {
  it('accepts only bounded producer-owned diagnostic fields and never carries raw causes', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kovo-devtool-diagnostics-'));
    const root = join(fixture, 'src');
    mkdirSync(root);
    const source = 'export const app = true;\n';
    writeFileSync(join(root, 'app.tsx'), source);
    const diagnostic = {
      category: 'proof',
      code: 'KV436',
      help: 'Declare one access posture.',
      message: 'Access posture is missing.',
      severity: 'error',
      source: { end: 16, file: 'src/app.tsx', start: 13 },
      version: 'kovo-diagnostic/v1',
    };

    try {
      const bundle = buildBundle({
        app: 'fixture',
        diagnostics: [diagnostic],
        graph: {},
        srcRoot: fixture,
      });
      expect(bundle.nodes[0]).toMatchObject({
        data: diagnostic,
        kind: 'diagnostic',
        source: { file: 'src/app.tsx', start: 13, end: 16 },
      });
      expect(() =>
        buildBundle({
          app: 'fixture',
          diagnostics: [{ ...diagnostic, rawCause: 'SECRET_SENTINEL' }],
          graph: {},
          srcRoot: fixture,
        }),
      ).toThrow(/rawCause is not supported/u);

      let helpReads = 0;
      const accessor = { ...diagnostic };
      Object.defineProperty(accessor, 'help', {
        enumerable: true,
        get() {
          helpReads += 1;
          return 'forged';
        },
      });
      expect(() =>
        buildBundle({
          app: 'fixture',
          diagnostics: [accessor],
          graph: {},
          srcRoot: fixture,
        }),
      ).toThrow(/help (?:changed|must be an enumerable own data property)/u);
      expect(helpReads).toBe(0);
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it('uses exact compiler offsets even when a decoy declaration appears first', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kovo-devtool-source-anchor-'));
    const root = join(fixture, 'src');
    mkdirSync(root);
    const file = join(root, 'routes.tsx');
    const source =
      "const decoy = route('/same', { page: () => 'decoy' });\n" +
      '\n\n\n' +
      "export const exact = route('/same', {\n  page: () => <main>Exact</main>,\n});\n";
    writeFileSync(file, source);
    const start = source.indexOf("route('/same'", source.indexOf('export const exact'));
    const end = source.indexOf(');', start) + 2;

    try {
      const bundle = buildBundle({
        app: 'fixture',
        graph: {
          pages: [
            {
              navigationSegments: [],
              route: '/same',
              source: { end, file: 'src/routes.tsx', start },
            },
          ],
        },
        srcRoot: root,
      });

      expect(bundle.nodes[0]?.source).toMatchObject({
        anchorLine: 5,
        end,
        file: 'routes.tsx',
        highlight: {
          end: { column: 4, line: 7 },
          start: { column: 22, line: 5 },
        },
        start,
      });
      expect(bundle.nodes[0]?.source?.code).toContain('<main>Exact</main>');
      expect(bundle.nodes[0]?.source?.code).not.toContain("page: () => 'decoy'");
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it('fails closed on an out-of-root compiler anchor without falling back to a symbol match', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kovo-devtool-source-anchor-outside-'));
    const root = join(fixture, 'src');
    const outside = join(fixture, 'outside.tsx');
    mkdirSync(root);
    writeFileSync(
      join(root, 'routes.tsx'),
      "export const visible = route('/private', { page: () => 'VISIBLE'; });\n",
    );
    writeFileSync(outside, "export const secret = route('/private', { page: () => 'SECRET'; });\n");

    try {
      const outsideSource = "export const secret = route('/private', { page: () => 'SECRET'; });\n";
      const bundle = buildBundle({
        app: 'fixture',
        graph: {
          pages: [
            {
              navigationSegments: [],
              route: '/private',
              source: { end: outsideSource.length, file: outside, start: 0 },
            },
          ],
        },
        srcRoot: root,
      });
      expect(bundle.nodes[0]?.source).toBeNull();
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it('does not preview TypeScript reached through an out-of-root symlink', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kovo-devtool-source-root-'));
    const root = join(fixture, 'root');
    const outside = join(fixture, 'outside');
    mkdirSync(root);
    mkdirSync(outside);
    const safeFile = join(root, 'routes.tsx');
    const privateFile = join(outside, 'private.tsx');
    const safeSource = "export const safe = route('/safe', { page() { return ''; } });\n";
    writeFileSync(safeFile, safeSource);
    writeFileSync(
      privateFile,
      "export const secret = route('/private', { page() { return 'SECRET'; } });\n",
    );
    symlinkSync(outside, join(root, 'linked-outside'), 'dir');

    try {
      const bundle = buildBundle({
        app: 'fixture',
        graph: {
          pages: [
            {
              navigationSegments: [],
              route: '/safe',
              source: { end: safeSource.length, file: 'routes.tsx', start: 0 },
            },
            { navigationSegments: [], route: '/private' },
          ],
        },
        srcRoot: root,
      });
      const safe = bundle.nodes.find((node) => node.name === '/safe');
      const privateNode = bundle.nodes.find((node) => node.name === '/private');

      expect(safe?.source).toMatchObject({ file: 'routes.tsx' });
      expect(privateNode?.source).toBeNull();
      expect(resolveSource({ data: {}, kind: 'page', name: '/private' }, root)).toBeNull();

      const originalFind = Array.prototype.find;
      const originalIterator = Array.prototype[Symbol.iterator];
      const originalEndsWith = String.prototype.endsWith;
      const originalIncludes = String.prototype.includes;
      const originalStartsWith = String.prototype.startsWith;
      let poisonedPage;
      let poisonedComponent;
      try {
        Array.prototype.find = () => privateFile;
        Array.prototype[Symbol.iterator] = function* () {
          yield privateFile;
        };
        String.prototype.endsWith = () => true;
        String.prototype.includes = () => true;
        String.prototype.startsWith = () => false;
        poisonedPage = resolveSource({ data: {}, kind: 'page', name: '/private' }, root);
        poisonedComponent = resolveSource(
          {
            data: { domName: 'missing', exportName: 'Missing' },
            kind: 'component',
            name: 'missing',
          },
          root,
        );
      } finally {
        Array.prototype.find = originalFind;
        Array.prototype[Symbol.iterator] = originalIterator;
        String.prototype.endsWith = originalEndsWith;
        String.prototype.includes = originalIncludes;
        String.prototype.startsWith = originalStartsWith;
      }
      expect(poisonedPage).toBeNull();
      expect(poisonedComponent).toBeNull();
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });

  it('does not walk the selected source root when no compiler anchor exists', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'kovo-devtool-source-cycle-'));
    const root = join(fixture, 'root');
    mkdirSync(root);
    symlinkSync(root, join(root, 'cycle'), 'dir');

    try {
      expect(() =>
        buildBundle({ app: 'fixture', graph: pageGraph('/missing'), srcRoot: root }),
      ).not.toThrow();
    } finally {
      rmSync(fixture, { force: true, recursive: true });
    }
  });
});
