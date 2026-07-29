/** @jsxImportSource @kovojs/server */
import { renderRouteHtml } from '@kovojs/server/rendering';
import { describe, expect, it } from 'vitest';
import { SiteHeader } from './chrome.js';
// Verifies the site chrome renders the migrated @kovojs/icons glyphs (Sun in the
// theme toggle) inline as real SVG — not the old raw-string injection, and not an
// unresolved Promise (icons are synchronous function components).
describe('site chrome @kovojs/icons adoption', () => {
  it('SiteHeader renders the Lucide Sun glyph inline in the theme toggle', async () => {
    const html = renderRouteHtml(
      await Promise.resolve(
        <SiteHeader
          activePath="/"
          clients={{
            code: '/c/code',
            search: '/c/search',
            sidebar: '/c/sidebar',
            theme: '/c/theme',
          }}
        />,
      ),
    );
    expect(html).toContain('<svg');
    expect(html).not.toContain('[object Promise]');
    // Lucide sun: a center circle plus rays; decorative by default.
    expect(html).toContain('<circle cx="12" cy="12" r="4">');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-kovo-module-allowlist="/c/search"');
    expect(html).toContain('data-kovo-module-allowlist="/c/theme"');
  });
});
