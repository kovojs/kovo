import { component, type ComponentRenderResult } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { renderComponent } from './component-render.js';
import {
  escapeText,
  fragmentHtml,
  renderedHtml,
  renderFragmentHtmlValue,
  renderHtmlValue,
} from './html.js';
import { jsx } from './jsx-runtime.js';
import { renderServerRenderable } from './renderable.js';
import { renderTree, renderRegistry } from './render-tree.js';

const PREFIX = 'kovo-rendered-html';

async function resolve(value: unknown): Promise<string> {
  const out = value as { html?: string } | string | Promise<string>;
  if (typeof out === 'string') return out;
  if (out instanceof Promise) return resolve(await out);
  if (out && typeof out === 'object' && typeof out.html === 'string') return out.html;
  return String(out);
}

describe('bugz.md M2 / bugz-3 L5: compiler escapeText single-escape (SPEC §4.5/§5.2)', () => {
  it('A) scalar child renders single-escaped (no double-escape, no marker leak)', async () => {
    const html = await resolve(renderServerRenderable(escapeText('AT&T <3 >x')));
    expect(html).toBe('AT&amp;T &lt;3 &gt;x');
    expect(html).not.toContain('&amp;amp;');
    expect(html).not.toContain(PREFIX);
  });

  it('B) escapeText nested through jsx element is single-escaped', async () => {
    const html = await resolve(jsx('h2', { children: escapeText('AT&T') }));
    expect(html).toBe('<h2>AT&amp;T</h2>');
    expect(html).not.toContain(PREFIX);
  });

  it('C) list of escapeText children (list-stamp shape) stays single-escaped', async () => {
    const items = ['A&B', 'C<D', 'E>F'].map((v) => jsx('li', { children: escapeText(v) }));
    const html = await resolve(jsx('ul', { children: items }));
    expect(html).toBe('<ul><li>A&amp;B</li><li>C&lt;D</li><li>E&gt;F</li></ul>');
    expect(html).not.toContain('&amp;amp;');
    expect(html).not.toContain(PREFIX);
  });

  it('D) live-component server render of escapeText text is single-escaped', () => {
    const Widget = component({
      render: () =>
        jsx('span', { children: escapeText('R&D <b>') }) as unknown as ComponentRenderResult,
    });
    const html = renderComponent(Widget, {});
    expect(html).toBe('<span>R&amp;D &lt;b&gt;</span>');
    expect(html).not.toContain(PREFIX);
  });

  it('E) §4.10 render-tree text node (escapeText boundary) is single-escaped', async () => {
    const registry = renderRegistry({});
    const html = await renderTree(registry, { type: 'text', value: 'AT&T <x>' });
    expect(html).toBe('AT&amp;T &lt;x&gt;');
    expect(html).not.toContain('&amp;amp;');
    expect(html).not.toContain(PREFIX);
  });

  it('F) escapeText result coerced into a text string (renderHtmlValue) stays single-escaped', () => {
    const html = renderHtmlValue(escapeText('AT&T'));
    expect(html).toBe('AT&amp;T');
    expect(html).not.toContain(PREFIX);
  });

  it('G) pins and freezes RenderedHtml bytes before HTML and fragment sinks consume them', () => {
    const rendered = renderedHtml('<strong>server-safe</strong>');

    expect(Object.isFrozen(rendered)).toBe(true);
    expect(Reflect.set(rendered as unknown as object, 'html', '<script>alert(1)</script>')).toBe(
      false,
    );
    expect(() =>
      Object.defineProperty(rendered, 'html', { value: '<img src=x onerror=alert(1)>' }),
    ).toThrow();
    expect(renderHtmlValue(rendered)).toBe('<strong>server-safe</strong>');
    expect(renderFragmentHtmlValue(fragmentHtml(rendered))).toBe('<strong>server-safe</strong>');
  });

  it('H) keeps repeated and nested RenderedHtml + string composition stateless and single-escaped', () => {
    const inner = renderedHtml('<strong>safe</strong>');
    const composed = inner + ' AT&T';

    expect(renderHtmlValue(composed)).toBe('<strong>safe</strong> AT&amp;T');
    // A self-contained authenticated marker remains valid without retaining the source in a Map.
    expect(renderHtmlValue(composed)).toBe('<strong>safe</strong> AT&amp;T');
    expect(renderHtmlValue(composed + composed)).toBe(
      '<strong>safe</strong> AT&amp;T<strong>safe</strong> AT&amp;T',
    );

    const nested = renderedHtml(composed) + ' tail';
    expect(renderHtmlValue(nested)).toBe('<strong>safe</strong> AT&T tail');
    expect(renderHtmlValue(nested)).not.toContain(PREFIX);
  });

  it('I) refuses a tampered self-contained RenderedHtml coercion marker', () => {
    const composed = renderedHtml('<script>reviewed()</script>') + ' tail';
    const tampered = composed.replace(/([A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\uE001)/, (char) =>
      char === 'A' ? 'B' : 'A',
    );

    expect(renderHtmlValue(tampered)).not.toContain('<script>reviewed()</script>');
  });
});
