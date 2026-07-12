import { describe, expect, it } from 'vitest';

import type { StaticExportResult } from './static-export-types.js';
import {
  assertStaticExportManifestUsesDirectoryIndexDocuments,
  staticExportManifest,
} from './static-export-result.js';
import { kovoAppShellViteStaticExportWithManifest } from './vite-static-export-result.js';

function staticExportResult(path: string): StaticExportResult {
  return {
    artifacts: [
      {
        body: '<main>Exported</main>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
        path,
        status: 200,
      },
    ],
    assets: [],
    clientModules: [],
    diagnostics: [],
  };
}

describe('server app shell Vite static export result boundary', () => {
  it('returns the dry-run manifest with the matching write result', async () => {
    const result = staticExportResult('/index.html');

    await expect(
      kovoAppShellViteStaticExportWithManifest({
        async dryRun() {
          return result;
        },
        async write() {
          return result;
        },
      }),
    ).resolves.toEqual({
      manifest: {
        assets: [],
        clientModules: [],
        files: [
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
            kind: 'route-document',
            path: '/index.html',
            status: 200,
          },
        ],
        routeDocuments: [
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
            path: '/index.html',
            status: 200,
          },
        ],
      },
      result,
    });
  });

  it('rejects write results that drift from the dry-run manifest', async () => {
    await expect(
      kovoAppShellViteStaticExportWithManifest({
        async dryRun() {
          return staticExportResult('/index.html');
        },
        async write() {
          return staticExportResult('/about/index.html');
        },
      }),
    ).rejects.toThrow(
      'Static export manifest does not match the written export result. Expected routeDocuments=1, clientModules=0, assets=0, files=1. Received routeDocuments=1, clientModules=0, assets=0, files=1.',
    );
  });

  it('C192 rejects manifest drift after late JSON and inherited toJSON replacement', async () => {
    const previousToJson = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
    const originalStringify = JSON.stringify;
    let outcome: unknown;
    try {
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value: () => ({ hidden: true }),
      });
      JSON.stringify = () => '{}';
      outcome = await kovoAppShellViteStaticExportWithManifest({
        async dryRun() {
          return staticExportResult('/index.html');
        },
        async write() {
          return staticExportResult('/about/index.html');
        },
      }).catch((error: unknown) => error);
    } finally {
      JSON.stringify = originalStringify;
      if (previousToJson === undefined) delete (Object.prototype as { toJSON?: unknown }).toJSON;
      else Object.defineProperty(Object.prototype, 'toJSON', previousToJson);
    }

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(
      'Static export manifest does not match the written export result.',
    );
  });

  it('rejects stale flat route-document manifests before export tasks publish compatibility output', async () => {
    const flatResult = staticExportResult('/about.html');

    expect(() =>
      assertStaticExportManifestUsesDirectoryIndexDocuments(staticExportManifest(flatResult)),
    ).toThrow(
      'Static export manifest contains non-directory-index route documents. Invalid route documents: /about.html. SPEC §9.5 exports route documents as directory-index HTML.',
    );

    await expect(
      kovoAppShellViteStaticExportWithManifest({
        async dryRun() {
          return flatResult;
        },
        async write() {
          return flatResult;
        },
      }),
    ).rejects.toThrow('non-directory-index route documents');
  });

  it('rejects stale flat route-document inventory entries in public manifests', () => {
    const manifest = staticExportManifest(staticExportResult('/about/index.html'));

    expect(() =>
      assertStaticExportManifestUsesDirectoryIndexDocuments({
        ...manifest,
        files: [
          ...manifest.files,
          {
            headers: { 'content-type': 'text/html; charset=utf-8' },
            kind: 'route-document',
            path: '/about.html',
            status: 200,
          },
        ],
      }),
    ).toThrow(
      'Static export manifest contains non-directory-index route documents. Invalid route documents: /about.html. SPEC §9.5 exports route documents as directory-index HTML.',
    );
  });

  it('C192 keeps flat route documents blocking after late collection-method replacement', () => {
    const manifest = staticExportManifest(staticExportResult('/about.html'));
    const originalMap = Array.prototype.map;
    const originalFilter = Array.prototype.filter;
    try {
      Array.prototype.map = function (callback, thisArg) {
        if (this === manifest.routeDocuments) return ['/index.html'];
        return Reflect.apply(originalMap, this, [callback, thisArg]);
      } as typeof Array.prototype.map;
      Array.prototype.filter = function (callback, thisArg) {
        if (this === manifest.files) return [];
        return Reflect.apply(originalFilter, this, [callback, thisArg]);
      } as typeof Array.prototype.filter;

      expect(() => assertStaticExportManifestUsesDirectoryIndexDocuments(manifest)).toThrow(
        /non-directory-index route documents/u,
      );
    } finally {
      Array.prototype.map = originalMap;
      Array.prototype.filter = originalFilter;
    }
  });
});
