import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { assertExtractedComponentCss, emitSiteUiCss } from './emit-ui-css.mjs';
import { assertServedStylesheetContent } from './export-static.mjs';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('site UI CSS generation', () => {
  beforeAll(() => {
    emitSiteUiCss();
  });

  it('keeps gallery @kovojs/ui atoms in the site stylesheet input', () => {
    const siteCss = readFileSync(resolve(siteRoot, 'src/styles.css'), 'utf8');
    const uiCss = readFileSync(resolve(siteRoot, 'src/generated/kovo-ui.css'), 'utf8');

    // SPEC §13.1: gallery routes render @kovojs/ui classes, so /assets/site.css
    // must include the matching package StyleX atoms.
    expect(siteCss).toContain(`@import './${'generated'}/kovo-ui.css';`);
    expect(uiCss).toContain('--kovo-theme-sys-color-on-surface:');
    expect(uiCss).toContain('var(--kovo-theme-sys-color-on-surface)');
    expect(uiCss).toContain('.kv-switch-bd-');
    expect(uiCss).toContain('.kv-switch-h-');
    expect(uiCss).toContain('.kv-button-bd-');
  });
});

describe('emit-ui-css component CSS guard', () => {
  beforeAll(() => {
    emitSiteUiCss();
  });

  // A real broken-install state produced an empty/short extraction that shipped
  // silently; the guard must fail loudly instead (SPEC §6.1.1, §13.1).
  it('passes for the real generated component CSS', () => {
    const uiCss = readFileSync(resolve(siteRoot, 'src/generated/kovo-ui.css'), 'utf8');
    expect(() => assertExtractedComponentCss(uiCss)).not.toThrow();
  });

  it('throws when the extracted CSS is empty', () => {
    expect(() => assertExtractedComponentCss('')).toThrow(/empty or missing required atoms/);
  });

  it('throws naming the missing atoms and the pnpm install fix', () => {
    // Tokens-only sheet with no component atoms — the observed broken output.
    const tokensOnly = ':root{--kovo-theme-sys-color-on-surface:#000}';
    let thrown;
    try {
      assertExtractedComponentCss(tokensOnly);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain('kv-button-');
    expect(thrown.message).toContain('kv-switch-');
    expect(thrown.message).toContain('kv-dialog-');
    expect(thrown.message).toContain('pnpm install');
  });

  it('throws when only some atoms are present', () => {
    const partial = '.kv-button-x{color:red}'.padEnd(100, ' ');
    expect(() => assertExtractedComponentCss(partial)).toThrow(/kv-switch-, kv-dialog-/);
  });
});

describe('export-static served stylesheet guard', () => {
  // The served /assets/site.css must clear a size floor and carry component
  // atoms; otherwise the gallery ships unstyled (SPEC §6.1.1, §13.1).
  const goodCss = `.kv-button-a{}.kv-switch-b{}.kv-dialog-c{}`.padEnd(50_000, ' ');

  it('passes for a healthy stylesheet (size + atoms)', () => {
    expect(() => assertServedStylesheetContent(goodCss, '/dist-css/assets/site.css')).not.toThrow();
  });

  it('passes for the real built stylesheet when present', () => {
    let built;
    try {
      built = readFileSync(resolve(siteRoot, 'dist-css/assets/site.css'), 'utf8');
    } catch {
      // No build present in this checkout; the synthetic cases cover the guard.
      return;
    }
    expect(() => assertServedStylesheetContent(built, 'dist-css/assets/site.css')).not.toThrow();
  });

  it('throws on a short stylesheet (the stale ~6.5KB regression)', () => {
    const short = `.kv-button-a{}.kv-switch-b{}.kv-dialog-c{}`.padEnd(6_500, ' ');
    expect(() => assertServedStylesheetContent(short, '/dist-css/assets/site.css')).toThrow(
      /only \d+ bytes/,
    );
  });

  it('throws naming the missing component atoms', () => {
    // Chrome-only sheet over the floor but with no @kovojs/ui component atoms.
    const chromeOnly = `.kv-site-chrome-a{}`.padEnd(50_000, ' ');
    expect(() => assertServedStylesheetContent(chromeOnly, '/dist-css/assets/site.css')).toThrow(
      /missing required component atoms \(kv-button-, kv-switch-, kv-dialog-\)/,
    );
  });

  it('reports both size and atom problems together', () => {
    let thrown;
    try {
      assertServedStylesheetContent('.kv-site-chrome-a{}', '/dist-css/assets/site.css');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toMatch(/only \d+ bytes/);
    expect(thrown.message).toContain('missing required component atoms');
    expect(thrown.message).toContain('pnpm install');
  });
});
