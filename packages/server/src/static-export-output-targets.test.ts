import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  clientModuleRepresentationDigest,
  versionedClientModuleHref,
} from '@kovojs/core/internal/client-module-url';

import { staticExportOutputTargets } from './static-export-output-targets.js';

describe('server static export output target boundary', () => {
  it('plans route document, client module, and static asset targets in write order', () => {
    const root = path.resolve('/tmp/kovo-static-export-targets');
    const clientSource = 'export const app = true;';
    const clientHref = versionedClientModuleHref(
      '/c/app.client.js',
      clientModuleRepresentationDigest(clientSource),
    );

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
              body: clientSource,
              headers: { 'content-type': 'text/javascript; charset=utf-8' },
              href: clientHref,
              path: clientHref,
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
        diagnosticPath: clientHref,
        itemIndex: 0,
        itemKind: 'client-module',
        kind: 'client module',
        targetPath: path.join(root, clientHref.slice(1)),
      },
      {
        diagnosticPath: '/assets/app.css',
        itemIndex: 0,
        itemKind: 'static-asset',
        kind: 'static asset',
        targetPath: path.join(root, 'assets', 'app.css'),
      },
      {
        diagnosticPath: '_headers',
        itemIndex: 0,
        itemKind: 'header-sidecar',
        kind: 'header sidecar',
        targetPath: path.join(root, '_headers'),
      },
    ]);
  });

  it('rejects unsafe route documents, client modules, and static assets before output writes', () => {
    const root = path.resolve('/tmp/kovo-static-export-targets');
    const base = {
      artifacts: [],
      assets: [],
      clientModules: [],
    };

    expect(() =>
      staticExportOutputTargets(
        {
          ...base,
          artifacts: [
            { body: '<!doctype html>', headers: {}, path: '/%2e%2e/x.html', status: 200 },
          ],
        },
        root,
      ),
    ).toThrow(/unsafe route document path segment/);

    expect(() =>
      staticExportOutputTargets(
        {
          ...base,
          artifacts: [
            { body: '<!doctype html>', headers: {}, path: '/%E0%A4%A.html', status: 200 },
          ],
        },
        root,
      ),
    ).toThrow(/not valid URL encoding/);

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
          clientModules: [
            {
              body: 'export {};',
              headers: {},
              href: 'https://cdn.example.test/c/app.js?v=bad',
              path: '/c/app.js',
              status: 200,
            },
          ],
        },
        root,
      ),
    ).toThrow(/same-origin \/c\/__v\//);

    expect(() =>
      staticExportOutputTargets(
        {
          ...base,
          clientModules: [
            {
              body: 'export {};',
              headers: {},
              href: 'https://[invalid.test/c/app.js?v=bad',
              path: '/c/app.js',
              status: 200,
            },
          ],
        },
        root,
      ),
    ).toThrow(/invalid href/);

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
        path.resolve('/tmp/kovo-static-export-targets'),
      ),
    ).toThrow(/conflicts with route document '\/index\.html'/);
  });

  it('pins artifact traversal and header-floor planning after intrinsic replacement', () => {
    const root = path.resolve('/tmp/kovo-static-export-targets-pinned');
    const artifacts = [
      {
        body: '<!doctype html><main>Home</main>',
        headers: { 'x-frame-options': 'DENY' },
        path: '/index.html',
        status: 200 as const,
      },
    ];
    const originalForEach = Array.prototype.forEach;
    const originalSome = Array.prototype.some;
    try {
      Array.prototype.forEach = function (callback, thisArg) {
        if (this === artifacts) return;
        return Reflect.apply(originalForEach, this, [callback, thisArg]);
      } as typeof Array.prototype.forEach;
      Array.prototype.some = function (callback, thisArg) {
        if (this === artifacts) return false;
        return Reflect.apply(originalSome, this, [callback, thisArg]);
      } as typeof Array.prototype.some;

      expect(
        staticExportOutputTargets({ artifacts, assets: [], clientModules: [] }, root).map(
          (target) => target.itemKind,
        ),
      ).toEqual(['route-document', 'header-sidecar']);
    } finally {
      Array.prototype.forEach = originalForEach;
      Array.prototype.some = originalSome;
    }
  });
});
