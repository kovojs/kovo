import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('site UI CSS generation', () => {
  it('keeps gallery @kovojs/ui atoms in the site stylesheet input', () => {
    const siteCss = readFileSync(resolve(siteRoot, 'src/styles.css'), 'utf8');
    const uiCss = readFileSync(resolve(siteRoot, 'src/generated/kovo-ui.css'), 'utf8');

    // SPEC §13.1: gallery routes render @kovojs/ui classes, so /assets/site.css
    // must include the matching package StyleX atoms.
    expect(siteCss).toContain("@import './generated/kovo-ui.css';");
    expect(uiCss).toContain('--kovo-theme-sys-color-on-surface:');
    expect(uiCss).toContain('var(--kovo-theme-sys-color-on-surface)');
    expect(uiCss).toContain('.kv-switch-bd-');
    expect(uiCss).toContain('.kv-switch-h-');
    expect(uiCss).toContain('.kv-button-bd-');
  });
});
