import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  assertExtractedComponentCss,
  assertExtractedSiteAppCss,
  assertServedStylesheetContent,
  assertServedUiStylesheetContent,
  stageStaticExportReferencedPublicAssets,
} from './export-static.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('site export CSS guards', () => {
  const goodSiteCss = `
    :root{--site-token:1}
    .kv-site-landing-a{}
    .kv-site-chrome-b{}
    .kv-site-docs-layout-c{}
    .kv-site-gallery-d{}
    .kv-site-search-dialog-e{}
  `.padEnd(12_000, ' ');

  it('passes for a healthy global app stylesheet', () => {
    expect(() =>
      assertServedStylesheetContent(goodSiteCss, '/dist-css/assets/site.css'),
    ).not.toThrow();
  });

  it('passes for the real built stylesheet when present', () => {
    let built;
    try {
      built = readFileSync(resolve(siteRoot, 'dist-css/assets/site.css'), 'utf8');
    } catch {
      return;
    }
    expect(() => assertServedStylesheetContent(built, 'dist-css/assets/site.css')).not.toThrow();
  });

  it('throws on a short stylesheet', () => {
    const short = ':root{--site-token:1}'.padEnd(3_000, ' ');
    expect(() => assertServedStylesheetContent(short, '/dist-css/assets/site.css')).toThrow(
      /only \d+ bytes/,
    );
  });

  it('throws when the served stylesheet is missing site app atoms', () => {
    const globalOnly = ':root{--site-token:1}'.padEnd(12_000, ' ');
    expect(() => assertServedStylesheetContent(globalOnly, '/dist-css/assets/site.css')).toThrow(
      /missing site app atoms/,
    );
  });

  it('validates extracted site app CSS atoms', () => {
    expect(() => assertExtractedSiteAppCss(goodSiteCss)).not.toThrow();
    expect(() => assertExtractedSiteAppCss('.kv-site-landing-a{}')).toThrow(
      /kv-site-chrome-, kv-site-docs-layout-, kv-site-gallery-, kv-site-search-dialog-/,
    );
  });

  it('validates extracted gallery component CSS atoms', () => {
    expect(() =>
      assertExtractedComponentCss(`.kv-button-a{}.kv-switch-b{}.kv-dialog-c{}`),
    ).not.toThrow();
    expect(() => assertExtractedComponentCss('')).toThrow(/empty or missing required atoms/);
    expect(() => assertExtractedComponentCss('.kv-button-a{}')).toThrow(/kv-switch-, kv-dialog-/);
  });

  it('validates the route-scoped gallery UI stylesheet atoms', () => {
    expect(() =>
      assertServedUiStylesheetContent(
        `.kv-button-a{}.kv-switch-b{}.kv-dialog-c{}`,
        '/assets/kovo-ui.css',
      ),
    ).not.toThrow();
    expect(() =>
      assertServedUiStylesheetContent('.kv-site-chrome-a{}', '/assets/kovo-ui.css'),
    ).toThrow(/missing required component atoms \(kv-button-, kv-switch-, kv-dialog-\)/);
  });

  it('stages generated and intentional-error assets before static export replay', async () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), 'kovo-site-export-assets-'));
    try {
      await stageStaticExportReferencedPublicAssets(tempRoot);
      expect(readFileSync(resolve(tempRoot, 'llms.txt'), 'utf8')).toContain(
        'overwritten by site/src/aux.ts',
      );
      expect(existsSync(resolve(tempRoot, 'avatars/missing.png'))).toBe(true);
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
