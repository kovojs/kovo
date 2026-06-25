import { describe, expect, it } from 'vitest';

import { safeRichHtml } from './rendering/html/safe-html.js';
import { renderHtmlValue } from './html.js';

describe('server safe rich HTML sanitizer', () => {
  it('sanitizes rich HTML before server rendering unwraps the trusted brand', () => {
    const rendered = renderHtmlValue(
      safeRichHtml(
        '<article><h2>CMS</h2><p onclick="bad()">Body <em>copy</em></p>' +
          '<script>alert(1)</script><a href="java\nscript:alert(1)">bad</a>' +
          '<a href="https://example.test/post?x=1&y=2">good</a></article>',
      ),
    );

    expect(rendered).toBe(
      '<article><h2>CMS</h2><p>Body <em>copy</em></p><a href="#">bad</a>' +
        '<a href="https://example.test/post?x=1&amp;y=2">good</a></article>',
    );
  });

  it('drops dangerous non-HTML subtrees before branding', () => {
    expect(renderHtmlValue(safeRichHtml('<svg><script>alert(1)</script></svg><p>ok</p>'))).toBe(
      '<p>ok</p>',
    );
  });
});
