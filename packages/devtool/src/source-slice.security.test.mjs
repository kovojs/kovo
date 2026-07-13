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
