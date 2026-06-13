import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { staticExportOutputTargets } from './static-export-output-targets.js';

describe('server static export output target boundary', () => {
  it('plans route document, client module, and static asset targets in write order', () => {
    const root = path.resolve('/tmp/jiso-static-export-targets');

    expect(
      staticExportOutputTargets(
        {
          artifacts: [
            {
              body: '<!doctype html><main>Home</main>',
              headers: {},
              path: '/index.html',
              status: 200,
            },
          ],
          assets: [
            {
              headers: {},
              path: '/assets/app.css',
              source: '/workspace/public/app.css',
              status: 200,
            },
          ],
          clientModules: [
            {
              body: 'export const app = true;',
              headers: {},
              href: '/c/app.client.js?v=app',
              path: '/c/app.client.js',
              status: 200,
            },
          ],
        },
        root,
      ).map(({ diagnosticPath, itemIndex, itemKind, kind, targetPath }) => ({
        diagnosticPath,
        itemIndex,
        itemKind,
        kind,
        targetPath,
      })),
    ).toEqual([
      {
        diagnosticPath: '/index.html',
        itemIndex: 0,
        itemKind: 'route-document',
        kind: 'route document',
        targetPath: path.join(root, 'index.html'),
      },
      {
        diagnosticPath: '/c/app.client.js',
        itemIndex: 0,
        itemKind: 'client-module',
        kind: 'client module',
        targetPath: path.join(root, 'c', 'app.client.js'),
      },
      {
        diagnosticPath: '/assets/app.css',
        itemIndex: 0,
        itemKind: 'static-asset',
        kind: 'static asset',
        targetPath: path.join(root, 'assets', 'app.css'),
      },
    ]);
  });

  it('rejects unsafe route documents, client modules, and static assets before output writes', () => {
    const root = path.resolve('/tmp/jiso-static-export-targets');
    const base = {
      artifacts: [],
      assets: [],
      clientModules: [],
    };

    expect(() =>
      staticExportOutputTargets(
        {
          ...base,
          artifacts: [{ body: '<!doctype html>', headers: {}, path: '/../x.html', status: 200 }],
        },
        root,
      ),
    ).toThrow(/outside the configured output directory/);

    expect(() =>
      staticExportOutputTargets(
        {
          ...base,
          clientModules: [
            {
              body: 'export {};',
              headers: {},
              href: '/c/%2f/app.js?v=bad',
              path: '/c/%2f/app.js',
              status: 200,
            },
          ],
        },
        root,
      ),
    ).toThrow(/unsafe client module path segment/);

    expect(() =>
      staticExportOutputTargets(
        {
          ...base,
          assets: [{ headers: {}, path: '/', source: '/workspace/public/app.css', status: 200 }],
        },
        root,
      ),
    ).toThrow(/does not name an output file/);
  });

  it('rejects target conflicts across artifact categories', () => {
    expect(() =>
      staticExportOutputTargets(
        {
          artifacts: [
            {
              body: '<!doctype html>',
              headers: {},
              path: '/index.html',
              status: 200,
            },
          ],
          assets: [
            {
              headers: {},
              path: '/index.html',
              source: '/workspace/public/index.html',
              status: 200,
            },
          ],
          clientModules: [],
        },
        path.resolve('/tmp/jiso-static-export-targets'),
      ),
    ).toThrow(/conflicts with route document '\/index\.html'/);
  });
});
