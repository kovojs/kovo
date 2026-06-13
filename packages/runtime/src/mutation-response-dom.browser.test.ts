import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueryStore, DomMorphRoot, keyedDomMorph } from './index.js';
import { applyMutationResponseToDom } from './mutation-response-dom.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser mutation response DOM apply', () => {
  it('preserves focus, selection, scroll, and keyed identity during a real DOM fragment morph', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form fw-c="cart-form">',
      '<label fw-key="label">Quantity</label>',
      '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Panel</p></div>',
      '<textarea fw-key="quantity" name="quantity">12345</textarea>',
      '</form>',
    ].join('');
    document.body.append(root);
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[fw-key="panel"]');

    if (!textarea || !panel) throw new Error('missing browser fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const applied = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="cart-form">',
        '<form fw-c="cart-form">',
        '<textarea fw-key="quantity" name="quantity">67890</textarea>',
        '<div fw-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Updated panel</p></div>',
        '<label fw-key="label">Updated quantity</label>',
        '</form>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });
    const nextTextarea = root.querySelector('textarea');

    expect(applied.appliedFragments).toEqual(['cart-form']);
    expect(nextTextarea).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe('forward');
    expect(root.querySelector<HTMLDivElement>('[fw-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBe(4);
    expect(root.querySelector('label')?.textContent).toBe('Updated quantity');
  });

  it('appends real DOM fragments without replacing keyed list nodes', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section fw-c="product-grid">',
      '<article fw-key="p1"><input value="keep"></article>',
      '<article fw-key="p2">Second</article>',
      '</section>',
    ].join('');
    document.body.append(root);
    const grid = root.querySelector('[fw-c="product-grid"]');
    const first = root.querySelector('[fw-key="p1"]');
    const second = root.querySelector('[fw-key="p2"]');
    const input = root.querySelector('input');

    if (!grid || !first || !second || !input) throw new Error('missing append fixture');

    input.focus();

    const appendResult = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="product-grid" mode="append">',
        '<article fw-key="p3">Third</article>',
        '<article fw-key="p4">Fourth</article>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    expect(appendResult.appliedFragments).toEqual(['product-grid']);
    expect(root.querySelector('[fw-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[fw-key="p1"]')).toBe(first);
    expect(root.querySelector('[fw-key="p2"]')).toBe(second);
    expect(document.activeElement).toBe(input);
    expect([...grid.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);

    applyMutationResponseToDom({
      body: [
        '<fw-fragment target="product-grid">',
        '<section fw-c="product-grid">',
        '<article fw-key="p4">Fourth updated</article>',
        '<article fw-key="p1"><input value="keep"></article>',
        '<article fw-key="p3">Third</article>',
        '<article fw-key="p2">Second</article>',
        '</section>',
        '</fw-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    expect(root.querySelector('[fw-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[fw-key="p1"]')).toBe(first);
    expect(root.querySelector('[fw-key="p2"]')).toBe(second);
    expect([...grid.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p4',
      'p1',
      'p3',
      'p2',
    ]);
  });

  it('resolves browser fragment targets through component stamps, ids, and target attributes', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section fw-c="cart-badge">stale badge</section>',
      '<section id="reviews:p1">stale reviews</section>',
      '<section fw-fragment-target="recommendations">stale recommendations</section>',
    ].join('');
    document.body.append(root);

    const applied = applyMutationResponseToDom({
      body: [
        '<fw-fragment target="cart-badge"><section fw-c="cart-badge">fresh badge</section></fw-fragment>',
        '<fw-fragment target="reviews:p1"><section id="reviews:p1">fresh reviews</section></fw-fragment>',
        '<fw-fragment target="recommendations"><section fw-fragment-target="recommendations">fresh recommendations</section></fw-fragment>',
      ].join(''),
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    // SPEC.md §9.1: browser fragment application must resolve the same live
    // target vocabulary sent in FW-Targets and accepted by the inline loader.
    expect(applied.appliedFragments).toEqual(['cart-badge', 'reviews:p1', 'recommendations']);
    expect(root.querySelector('[fw-c="cart-badge"]')?.textContent).toBe('fresh badge');
    expect(root.querySelector('[id="reviews:p1"]')?.textContent).toBe('fresh reviews');
    expect(root.querySelector('[fw-fragment-target="recommendations"]')?.textContent).toBe(
      'fresh recommendations',
    );
  });

  it('reports browser query apply failures and still applies later fragments', () => {
    const root = document.createElement('main');
    root.innerHTML =
      '<section fw-c="cart-badge">stale</section><span data-bind="cart.count">0</span>';
    document.body.append(root);
    const store = createQueryStore();
    const onError = vi.fn();
    const hookError = new Error('browser query hook failed');

    const applied = applyMutationResponseToDom({
      applyQuery(query) {
        if ((query.value as { count: number }).count === 1) throw hookError;
      },
      body: [
        '<fw-query name="cart">{"count":1}</fw-query>',
        '<fw-query name="cart">{"count":2}</fw-query>',
        '<fw-fragment target="cart-badge"><section fw-c="cart-badge">fresh</section></fw-fragment>',
      ].join(''),
      onError,
      queryRoot: root,
      root: new DomMorphRoot(root),
      store,
    });

    // SPEC.md §9.1/§9.4: browser mutation responses share the decoded runtime
    // query apply path, so hook failures report while later server truth and
    // fragments continue through the same DOM apply pass.
    expect(onError).toHaveBeenCalledWith(hookError);
    expect(applied.queries).toEqual(['cart']);
    expect(applied.appliedFragments).toEqual(['cart-badge']);
    expect(store.get('cart')).toEqual({ count: 2 });
    expect(root.querySelector('[data-bind="cart.count"]')?.textContent).toBe('2');
    expect(root.querySelector('[fw-c="cart-badge"]')?.textContent).toBe('fresh');
  });
});
