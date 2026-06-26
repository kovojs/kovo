import { jsx } from '@kovojs/server/jsx-runtime';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge.js';
import { MenubarItem } from './menubar.js';
import { SelectItem } from './select.js';
import { Sheet } from './sheet.js';

// bugz-3 M7 regression. SPEC.md §4.5/§5.2: the @kovojs/server JSX runtime
// (renderServerRenderable -> escapeTextWithRenderedHtml for children,
// safeRuntimeAttribute -> escapeAttribute for attribute values) escapes scalar
// text exactly ONCE. @kovojs/ui primitives must therefore pass raw text and let
// the runtime escape it; a former local `escapeHtml` pre-escape made `&`/`<`/`>`
// ship DOUBLE-escaped (e.g. `AT&T` -> `AT&amp;amp;T`, which renders as `AT&amp;T`
// to the user). These assertions fail on the pre-fix (double-escape) source.

/** Render a server JSX node (a kovo component returns a Promise<RenderedHtml>) to its HTML string. */
async function render(node: unknown): Promise<string> {
  return String(await node);
}

describe('@kovojs/ui scalar text/labels are escaped exactly once (bugz-3 M7)', () => {
  it('Badge renders ampersand text single-escaped (the cited AT&T case)', async () => {
    const html = await render(jsx(Badge, { children: 'AT&T' }));

    // KEY ASSERTION: single escape, not the pre-fix double `AT&amp;amp;T`.
    expect(html).toMatch(/<span[^>]*>AT&amp;T<\/span>/);
    expect(html).not.toContain('AT&amp;amp;T');
  });

  it('Badge escapes XSS-y markup exactly once (still safe, never under-escaped)', async () => {
    const html = await render(jsx(Badge, { children: '<b>x</b>' }));

    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    // Never under-escaped: the raw tag must not survive into the output.
    expect(html).not.toContain('<b>x</b>');
    // Never double-escaped: no `&amp;lt;` leaking the entity itself.
    expect(html).not.toContain('&amp;lt;');
  });

  it('SelectItem itemValue fallback text is single-escaped', async () => {
    const html = await render(jsx(SelectItem, { itemValue: 'AT&T' }));

    expect(html).toContain('AT&amp;T');
    expect(html).not.toContain('AT&amp;amp;T');
  });

  it('MenubarItem itemValue fallback text is single-escaped', async () => {
    const html = await render(jsx(MenubarItem, { itemValue: 'Q&A' }));

    expect(html).toContain('Q&amp;A');
    expect(html).not.toContain('Q&amp;amp;A');
  });

  it('Sheet escapes scalar title children AND the aria-label attribute exactly once', async () => {
    const html = await render(
      jsx(Sheet, {
        closeLabel: 'Save & Close',
        contentId: 'sheet-1',
        title: 'Q&A',
        trigger: 'Open & Go',
      }),
    );

    // Scalar text children (title, trigger): single-escaped.
    expect(html).toContain('Q&amp;A');
    expect(html).toContain('Open &amp; Go');
    expect(html).not.toContain('Q&amp;amp;A');
    // Attribute value path (aria-label) is escaped once by the runtime too.
    expect(html).toContain('aria-label="Save &amp; Close"');
    expect(html).not.toContain('Save &amp;amp; Close');
  });
});
