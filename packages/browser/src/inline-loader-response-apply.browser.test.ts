import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('browser inline loader response apply', () => {
  it('morphs enhanced mutation fragments through the installed inline loader', async () => {
    const style = document.createElement('style');
    style.textContent = [
      '.scroll-panel { height: 20px; overflow: auto }',
      '.scroll-panel-fill { height: 80px }',
    ].join('\n');
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance action="/cart" method="post">',
      '<section kovo-c="cart-form">',
      '<label kovo-key="label">Quantity</label>',
      '<div kovo-key="panel" class="scroll-panel"><p class="scroll-panel-fill">Panel</p></div>',
      '<textarea kovo-key="quantity" name="quantity">12345</textarea>',
      '</section>',
      '</form>',
    ].join('');
    document.body.append(style, root);

    const form = root.querySelector('form');
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[kovo-key="panel"]');

    if (!form || !textarea || !panel) throw new Error('missing inline morph fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const fetch = vi.fn(async () => ({
      async text() {
        textarea.focus();
        textarea.setSelectionRange(1, 3, 'forward');
        return [
          '<kovo-fragment target="cart-form">',
          '<section kovo-c="cart-form">',
          '<textarea kovo-key="quantity" name="quantity">67890</textarea>',
          '<div kovo-key="panel" class="scroll-panel"><p class="scroll-panel-fill">Updated panel</p></div>',
          '<label kovo-key="label">Updated quantity</label>',
          '</section>',
          '</kovo-fragment>',
        ].join('');
      },
    }));
    vi.stubGlobal('fetch', fetch);

    installInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-key="label"]')?.textContent).toBe('Updated quantity'),
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('textarea')).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector('[kovo-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBeCloseTo(4, 0);
  });

  it('applies fragments to explicit fragment targets before conflicting component stamps', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance action="/cart" method="post">',
      '<section kovo-fragment-target="cart" kovo-deps="cart">old cart</section>',
      '<aside kovo-c="cart">wrong target</aside>',
      '</form>',
    ].join('');
    document.body.append(root);

    const form = root.querySelector('form');
    if (!form) throw new Error('missing inline conflict fixture');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        async text() {
          return [
            '<kovo-fragment target="cart">',
            '<section kovo-fragment-target="cart" kovo-deps="cart">fresh cart</section>',
            '</kovo-fragment>',
          ].join('');
        },
      })),
    );

    installInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(root.querySelector('[kovo-fragment-target="cart"]')?.textContent).toBe('fresh cart'),
    );
    expect(root.querySelector('[kovo-c="cart"]')?.textContent).toBe('wrong target');
  });

  it('applies selector-invalid id and fragment-target values through escaped lookup', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form enhance action="/cart" method="post">',
      "<section id='target\"bad-id'>old id</section>",
      "<section kovo-fragment-target='target\"bad-fragment'>old fragment target</section>",
      '</form>',
    ].join('');
    document.body.append(root);

    const form = root.querySelector('form');
    if (!form) throw new Error('missing inline selector fixture');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        async text() {
          return [
            "<kovo-fragment target='target\"bad-id'>",
            "<section id='target\"bad-id'>fresh id</section>",
            '</kovo-fragment>',
            "<kovo-fragment target='target\"bad-fragment'>",
            "<section kovo-fragment-target='target\"bad-fragment'>fresh fragment target</section>",
            '</kovo-fragment>',
          ].join('');
        },
      })),
    );

    installInlineKovoLoader(async () => ({}));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      const sections = [...root.querySelectorAll('section')];
      expect(
        sections.find((section) => section.getAttribute('id') === 'target"bad-id')?.textContent,
      ).toBe('fresh id');
      expect(
        sections.find(
          (section) => section.getAttribute('kovo-fragment-target') === 'target"bad-fragment',
        )?.textContent,
      ).toBe('fresh fragment target');
    });
  });

  it('sanitizes unsafe fragment replacement and append attributes through the installed loader', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-fragment-target="promo">old promo</section>',
      '<ul kovo-fragment-target="feed"><li kovo-key="old">old</li></ul>',
    ].join('');
    document.body.append(root);

    installInlineKovoLoader(async () => ({}));
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="promo">',
        '<article kovo-fragment-target="promo"',
        ' onclick="alert(1)" innerHTML="<img src=x onerror=alert(1))" style="background:url(javascript:alert(1))">',
        '<a href="java\tscript:alert(1)"',
        ' srcdoc="<script>bad()</script>"',
        ' srcset="/safe.png 1x, javascript:alert(1) 2x">promo</a>',
        '</article>',
        '</kovo-fragment>',
        '<kovo-fragment target="feed" mode="append">',
        '<li kovo-key="new"><a href="javascript:alert(1)" onclick="bad()" innerHTML="<img src=x onerror=alert(1))"',
        ' srcdoc="<script>bad()</script>"',
        ' srcset="/safe.png 1x, javascript:alert(1) 2x"',
        ' style="background:url(javascript:alert(1))">new</a></li>',
        '</kovo-fragment>',
      ].join(''),
    );

    const promo = root.querySelector('article[kovo-fragment-target="promo"]');
    const promoLink = promo?.querySelector('a');
    const feedLink = root.querySelector('[kovo-key="new"] a');

    expect(promo?.getAttribute('onclick')).toBeNull();
    expect(promo?.getAttribute('innerHTML')).toBeNull();
    expect(promo?.getAttribute('style')).toBeNull();
    expect(promoLink?.getAttribute('href')).toBe('#');
    expect(promoLink?.getAttribute('srcdoc')).toBeNull();
    expect(promoLink?.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(feedLink?.getAttribute('href')).toBe('#');
    expect(feedLink?.getAttribute('innerHTML')).toBeNull();
    expect(feedLink?.getAttribute('onclick')).toBeNull();
    expect(feedLink?.getAttribute('srcdoc')).toBeNull();
    expect(feedLink?.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(feedLink?.getAttribute('style')).toBeNull();
  });

  it('aborts removed same-component keyed island signals by identity', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<ul kovo-fragment-target="cart-list">',
      '<li kovo-c="cart-row" kovo-key="row-1" on:click="/c/cart-row.js#mount">one</li>',
      '<li kovo-c="cart-row" kovo-key="row-2" on:click="/c/cart-row.js#mount">two</li>',
      '</ul>',
    ].join('');
    document.body.append(root);

    installInlineKovoLoader(async () => ({}));
    const firstController = new AbortController();
    const secondController = new AbortController();
    (root.querySelector('[kovo-key="row-1"]') as (Element & { a?: AbortController }) | null)!.a =
      firstController;
    (root.querySelector('[kovo-key="row-2"]') as (Element & { a?: AbortController }) | null)!.a =
      secondController;

    // SPEC.md §4.4/§13.2/§14.1: a removed island is identified by kovo-c plus
    // kovo-key/id, not by a component-name substring in replacement HTML.
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="cart-list">',
        '<ul kovo-fragment-target="cart-list">',
        '<li kovo-c="cart-row" kovo-key="row-2" on:click="/c/cart-row.js#mount">two fresh</li>',
        '</ul>',
        '</kovo-fragment>',
      ].join(''),
    );

    expect(firstController.signal.aborted).toBe(true);
    expect(secondController.signal.aborted).toBe(false);
    expect(root.querySelector('[kovo-key="row-1"]')).toBeNull();
    expect(root.querySelector('[kovo-key="row-2"]')?.textContent).toBe('two fresh');
  });
});
