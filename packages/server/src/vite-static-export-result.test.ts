import { describe, expect, it } from 'vitest';

import type { StaticExportResult } from './static-export-types.js';
import {
  assertStaticExportManifestUsesDirectoryIndexDocuments,
  staticExportManifest,
} from './static-export-result.js';
import { jisoAppShellViteStaticExportWithManifest } from './vite-static-export-result.js';

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
      jisoAppShellViteStaticExportWithManifest({
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
      jisoAppShellViteStaticExportWithManifest({
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

  it('rejects stale flat route-document manifests before export tasks publish compatibility output', async () => {
    const flatResult = staticExportResult('/about.html');

    expect(() =>
      assertStaticExportManifestUsesDirectoryIndexDocuments(staticExportManifest(flatResult)),
    ).toThrow(
      'Static export manifest contains non-directory-index route documents. Invalid route documents: /about.html. SPEC §9.5 exports route documents as directory-index HTML.',
    );

    await expect(
      jisoAppShellViteStaticExportWithManifest({
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
});
