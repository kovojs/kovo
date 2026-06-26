import { component, type ComponentRenderResult } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { renderComponent } from './component-render.js';
import { escapeText, renderHtmlValue } from './html.js';
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
});
