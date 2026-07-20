import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import { deriveBrowserPostureManifestFromSourceFiles } from './browser-posture-project.js';

// @kovo-security-classifier-corpus browser-posture

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
  readonly isolationBlockers: readonly {
    readonly kind: string;
    readonly site: string;
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
    const missingReason = browserPosture(`
import { component } from '@kovojs/core';
import { trustedUrl } from '@kovojs/browser';

export const MissingReason = component({
  render: ({ avatar }) => <img src={trustedUrl(avatar)} alt="avatar" />,
});
`);
    const reviewedSpread = browserPosture(`
import { component } from '@kovojs/core';
import { trustedUrl } from '@kovojs/browser';

export const ReviewedSpread = component({
  render: ({ avatar }) => (
    <img {...{ src: trustedUrl(avatar, 'reviewed spread avatar CDN') }} alt="avatar" />
  ),
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
    expect(missingReason.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('trustedUrl(value, auditedReason)'),
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
    expect(reviewedSpread.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual(
      [],
    );
    expect(reviewedSpread.manifest?.opaqueExternalUrls).toEqual([
      expect.objectContaining({
        directive: 'img-src',
        reason: 'reviewed spread avatar CDN',
      }),
    ]);
  });

  it('uses browser-effective attribute order for duplicate and spread-owned asset URLs', () => {
    const { diagnostics, manifest } = browserPosture(`
import { component } from '@kovojs/core';

export const OrderedAssets = component({
  render: () => (
    <main>
      <script
        SRC="https://first.example.test/runtime.js"
        src="https://second.example.test/runtime.js"
        external
      />
      <img
        {...{ src: "https://overwritten.example.test/avatar.png" }}
        src="https://effective.example.test/avatar.png"
        alt="ordered"
        external
      />
    </main>
  ),
});
`);

    expect(diagnostics).toEqual([]);
    expect(manifest?.externalOrigins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          directive: 'script-src',
          origin: 'https://first.example.test',
        }),
        expect.objectContaining({
          directive: 'img-src',
          origin: 'https://effective.example.test',
        }),
      ]),
    );
    expect(manifest?.externalOrigins).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: 'https://second.example.test' }),
        expect.objectContaining({ origin: 'https://overwritten.example.test' }),
      ]),
    );
  });

  it('carries exact trustedUrl provenance through a nested finite object spread', () => {
    const { diagnostics, manifest } = browserPosture(`
import { component } from '@kovojs/core';
import { trustedUrl } from '@kovojs/browser';

export const NestedReviewedAsset = component({
  render: ({ avatar }) => (
    <img
      {...{ ...{ src: trustedUrl(avatar, 'reviewed nested avatar CDN') } }}
      alt="avatar"
    />
  ),
});
`);

    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(manifest?.opaqueExternalUrls).toEqual([
      expect.objectContaining({
        directive: 'img-src',
        reason: 'reviewed nested avatar CDN',
        site: 'img[src]',
      }),
    ]);
  });

  it('parses static srcset candidates and preload/media directives without URL-list drift', () => {
    const { diagnostics, manifest } = browserPosture(`
import { component } from '@kovojs/core';

export const ResponsiveAssets = component({
  render: () => (
    <main>
      <img
        srcset="https://images.example.test/a.png 1x, https://retina.example.test/a.png 2x"
        alt="responsive"
        external
      />
      <link rel="preload" as="font" href="https://fonts.example.test/app.woff2" external />
      <link rel="preload stylesheet" href="https://styles.example.test/app.css" external />
      <video src="https://media.example.test/intro.mp4" external />
      <track src="https://captions.example.test/en.vtt" kind="captions" external />
      <input type="image" src="https://controls.example.test/submit.png" external />
    </main>
  ),
});
`);
    expect(diagnostics).toEqual([]);
    expect(manifest?.externalOrigins).toEqual([
      expect.objectContaining({ directive: 'font-src', origin: 'https://fonts.example.test' }),
      expect.objectContaining({ directive: 'img-src', origin: 'https://controls.example.test' }),
      expect.objectContaining({ directive: 'img-src', origin: 'https://images.example.test' }),
      expect.objectContaining({ directive: 'img-src', origin: 'https://retina.example.test' }),
      expect.objectContaining({ directive: 'media-src', origin: 'https://captions.example.test' }),
      expect.objectContaining({ directive: 'media-src', origin: 'https://media.example.test' }),
      expect.objectContaining({ directive: 'style-src', origin: 'https://styles.example.test' }),
    ]);
  });

  it('limits input src posture to image controls without flagging ordinary input spreads', () => {
    const ordinary = browserPosture(`
import { component } from '@kovojs/core';

export const OrdinaryInput = component({
  render: ({ attrs }) => <input type="hidden" {...attrs} />,
});
`);
    const image = browserPosture(`
import { component } from '@kovojs/core';

export const ImageInput = component({
  render: ({ attrs }) => <input type="image" {...attrs} />,
});
`);

    expect(ordinary.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(image.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('opaque spread'),
        }),
      ]),
    );
  });

  it('records frame, popup, and external-resource isolation blockers', () => {
    const { diagnostics, manifest } = browserPosture(`
import { component } from '@kovojs/core';

export const Interop = component({
  render: () => (
    <main>
      <a href="/oauth" target="_blank" rel="noopener">OAuth</a>
      <iframe src="/embed" sandbox="allow-same-origin" />
      <img src="https://images.example.test/a.png" alt="external" external />
    </main>
  ),
});
`);
    expect(diagnostics).toEqual([]);
    expect(manifest?.isolationBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'external-resource', site: 'img[src]' }),
        expect.objectContaining({ kind: 'frame', site: 'iframe' }),
        expect.objectContaining({ kind: 'popup', site: 'a[target]' }),
      ]),
    );
  });

  it('keeps named and computed popup targets outside an isolation-positive build', () => {
    const result = browserPosture(`
import { component } from '@kovojs/core';

export const DynamicPopup = component({
  render: ({ target }) => (
    <main>
      <a href="/oauth" target="oauth-window">Named popup</a>
      <button formtarget={target}>Submit elsewhere</button>
    </main>
  ),
});
`);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['KV236', 'KV236']);
    expect(result.manifest?.isolationBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'popup', site: 'a[target]' }),
        expect.objectContaining({ kind: 'popup', site: 'button[formtarget]' }),
      ]),
    );
  });

  it('fails closed when a computed link relation hides the browser fetch directive', () => {
    const result = browserPosture(`
import { component } from '@kovojs/core';

export const DynamicLink = component({
  render: ({ rel }) => <link rel={rel} href="https://assets.example.test/item" external />,
});
`);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('computed rel'),
        }),
      ]),
    );
  });

  it('keeps raw dynamic browser fetches and workers outside an isolation-positive build', () => {
    for (const expression of ["fetch('/dynamic')", "new Worker('/worker.js')"] as const) {
      const result = browserPosture(`
import { component } from '@kovojs/core';

export const DynamicBrowserAuthority = component({
  render: () => <button onClick={() => ${expression}}>run</button>,
});
`);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(['KV201']),
      );
      expect(result.manifest?.isolationBlockers).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'dynamic-fetch-or-worker' })]),
      );
    }
  });

  it('merges project manifests deterministically and closes a dynamic asset before boot', () => {
    const files = [
      {
        fileName: 'z-card.tsx',
        source: `
import { component } from '@kovojs/core';
export const Z = component({ render: () => <img src="https://z.example.test/z.png" external /> });`,
      },
      {
        fileName: 'a-card.tsx',
        source: `
import { component } from '@kovojs/core';
export const A = component({ render: () => <script src="https://a.example.test/a.js" external /> });`,
      },
    ] as const;
    const manifest = deriveBrowserPostureManifestFromSourceFiles(files);
    const reversed = deriveBrowserPostureManifestFromSourceFiles([files[1], files[0]]);
    expect(reversed).toEqual(manifest);
    expect(manifest.externalOrigins.map((entry) => entry.origin)).toEqual([
      'https://z.example.test',
      'https://a.example.test',
    ]);
    expect(() =>
      deriveBrowserPostureManifestFromSourceFiles([
        {
          fileName: 'dynamic.tsx',
          source: `
import { component } from '@kovojs/core';
export const Dynamic = component({ render: ({ src }) => <script src={src} /> });`,
        },
      ]),
    ).toThrow(/Browser posture derivation failed closed.*KV236.*external asset URL/);
  });
});
