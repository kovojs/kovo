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
    writeFileSync(safeFile, "export const safe = route('/safe', { page() { return ''; } });\n");
    writeFileSync(
      privateFile,
      "export const secret = route('/private', { page() { return 'SECRET'; } });\n",
    );
    symlinkSync(outside, join(root, 'linked-outside'), 'dir');

    try {
      const bundle = buildBundle({
        app: 'fixture',
        graph: pageGraph('/safe', '/private'),
        srcRoot: root,
      });
      const safe = bundle.nodes.find((node) => node.name === '/safe');
      const privateNode = bundle.nodes.find((node) => node.name === '/private');

      expect(safe?.source).toMatchObject({ file: 'routes.tsx' });
      expect(privateNode?.source).toBeNull();
      expect(
        resolveSource({ data: {}, kind: 'page', name: '/private' }, root, [
          privateFile,
          join(root, 'linked-outside', 'private.tsx'),
        ]),
      ).toBeNull();

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
        poisonedPage = resolveSource({ data: {}, kind: 'page', name: '/private' }, root, [
          safeFile,
        ]);
        poisonedComponent = resolveSource(
          {
            data: { domName: 'missing', exportName: 'Missing' },
            kind: 'component',
            name: 'missing',
          },
          root,
          [safeFile],
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

  it('skips symlink cycles while walking the selected source root', () => {
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
