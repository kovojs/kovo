import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

interface ExpectedBrowserPostureManifest {
  readonly externalOrigins: readonly {
    readonly directive: string;
    readonly origin: string;
    readonly site: string;
    readonly span: { readonly end: number; readonly start: number };
  }[];
  readonly opaqueExternalUrls: readonly {
    readonly directive: string;
    readonly reason: string;
    readonly site: string;
    readonly span: { readonly end: number; readonly start: number };
  }[];
  readonly schema: 'kovo-browser-posture/v1';
}

function browserPosture(source: string): {
  readonly diagnostics: ReturnType<typeof compileComponentModule>['diagnostics'];
  readonly manifest: ExpectedBrowserPostureManifest | undefined;
} {
  const result = compileComponentModule({ fileName: 'browser-posture.tsx', source });
  return {
    diagnostics: result.diagnostics,
    manifest: (result as unknown as { browserPostureManifest?: ExpectedBrowserPostureManifest })
      .browserPostureManifest,
  };
}

describe('compiler-derived browser response posture (SPEC §2/§4.8)', () => {
  it('censuses literal external asset origins by exact CSP directive with source spans', () => {
    const { diagnostics, manifest } = browserPosture(`
import { component } from '@kovojs/core';

export const BrowserAssets = component({
  render: () => (
    <main>
      <script src="https://scripts.example.test/sdk.js" external />
      <link rel="stylesheet" href="https://styles.example.test/app.css" external />
      <img src="https://images.example.test/avatar.png" alt="avatar" external />
      <iframe src="https://frames.example.test/embed" sandbox="allow-scripts" external />
    </main>
  ),
});
`);

    expect(diagnostics).toEqual([]);
    expect(manifest).toMatchObject({ schema: 'kovo-browser-posture/v1' });
    expect(manifest?.externalOrigins).toEqual([
      expect.objectContaining({
        directive: 'frame-src',
        origin: 'https://frames.example.test',
        site: 'iframe[src]',
      }),
      expect.objectContaining({
        directive: 'img-src',
        origin: 'https://images.example.test',
        site: 'img[src]',
      }),
      expect.objectContaining({
        directive: 'script-src',
        origin: 'https://scripts.example.test',
        site: 'script[src]',
      }),
      expect.objectContaining({
        directive: 'style-src',
        origin: 'https://styles.example.test',
        site: 'link[href]',
      }),
    ]);
    for (const entry of manifest?.externalOrigins ?? []) {
      expect(entry.span.start).toBeGreaterThan(0);
      expect(entry.span.end).toBeGreaterThan(entry.span.start);
    }
  });

  it('fails closed for a computed asset URL unless the exact trustedUrl export is used', () => {
    const dynamic = browserPosture(`
import { component } from '@kovojs/core';

export const DynamicAsset = component({
  render: ({ avatar }) => <img src={avatar} alt="avatar" />,
});
`);
    const shadow = browserPosture(`
import { component } from '@kovojs/core';
const trustedUrl = (value: string, _reason: string) => value;

export const ShadowEscape = component({
  render: ({ avatar }) => <img src={trustedUrl(avatar, 'reviewed avatar CDN')} alt="avatar" />,
});
`);
    const reviewed = browserPosture(`
import { component } from '@kovojs/core';
import { trustedUrl } from '@kovojs/browser';

export const ReviewedEscape = component({
  render: ({ avatar }) => <img src={trustedUrl(avatar, 'reviewed avatar CDN')} alt="avatar" />,
});
`);

    expect(dynamic.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('computed external asset URL'),
        }),
      ]),
    );
    expect(shadow.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('computed external asset URL'),
        }),
      ]),
    );
    expect(reviewed.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(reviewed.manifest?.opaqueExternalUrls).toEqual([
      expect.objectContaining({
        directive: 'img-src',
        reason: 'reviewed avatar CDN',
        site: 'img[src]',
      }),
    ]);
  });
});
