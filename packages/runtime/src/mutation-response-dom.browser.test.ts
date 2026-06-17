import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { createQueryStore, DomMorphRoot, keyedDomMorph } from './index.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser mutation response DOM apply', () => {
  it('preserves focus, selection, scroll, and keyed identity during a real DOM fragment morph', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<form kovo-c="cart-form">',
      '<label kovo-key="label">Quantity</label>',
      '<div kovo-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Panel</p></div>',
      '<textarea kovo-key="quantity" name="quantity">12345</textarea>',
      '</form>',
    ].join('');
    document.body.append(root);
    const textarea = root.querySelector('textarea');
    const panel = root.querySelector<HTMLDivElement>('[kovo-key="panel"]');

    if (!textarea || !panel) throw new Error('missing browser fixture');

    textarea.focus();
    textarea.setSelectionRange(1, 3, 'forward');
    panel.scrollTop = 4;

    const applied = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-fragment target="cart-form">',
        '<form kovo-c="cart-form">',
        '<textarea kovo-key="quantity" name="quantity">67890</textarea>',
        '<div kovo-key="panel" style="height: 20px; overflow: auto"><p style="height: 80px">Updated panel</p></div>',
        '<label kovo-key="label">Updated quantity</label>',
        '</form>',
        '</kovo-fragment>',
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
    expect(root.querySelector<HTMLDivElement>('[kovo-key="panel"]')).toBe(panel);
    expect(panel.scrollTop).toBe(4);
    expect(root.querySelector('label')?.textContent).toBe('Updated quantity');
  });

  it('preserves client-owned nested island state when a parent fragment morph reuses it', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-fragment-target="profile-panel" kovo-key="profile-panel">',
      '<output data-bind="profile.version">0</output>',
      '<nested-counter kovo-c="nested-counter" kovo-key="nested-counter" kovo-state="{&quot;count&quot;:3}">',
      '<button data-bind="state.count">3</button>',
      '</nested-counter>',
      '</section>',
    ].join('');
    document.body.append(root);
    const nested = root.querySelector('nested-counter');

    if (!nested) throw new Error('missing nested island fixture');

    const applied = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-fragment target="profile-panel">',
        '<section kovo-fragment-target="profile-panel" kovo-key="profile-panel">',
        '<output data-bind="profile.version">1</output>',
        '<nested-counter kovo-c="nested-counter" kovo-key="nested-counter" kovo-state="{&quot;count&quot;:0}">',
        '<button data-bind="state.count">0</button>',
        '</nested-counter>',
        '</section>',
        '</kovo-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    // SPEC.md §9.1/§4.2: a keyed nested island is browser-owned state inside a
    // parent fragment morph; server-initial `kovo-state` must not clobber it.
    expect(applied.appliedFragments).toEqual(['profile-panel']);
    expect(root.querySelector('nested-counter')).toBe(nested);
    expect(nested.getAttribute('kovo-state')).toBe('{"count":3}');
    expect(nested.querySelector('[data-bind="state.count"]')?.textContent).toBe('3');
    expect(root.querySelector('[data-bind="profile.version"]')?.textContent).toBe('1');
  });

  it('appends real DOM fragments without replacing keyed list nodes', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-c="product-grid">',
      '<article kovo-key="p1"><input value="keep"></article>',
      '<article kovo-key="p2">Second</article>',
      '</section>',
    ].join('');
    document.body.append(root);
    const grid = root.querySelector('[kovo-c="product-grid"]');
    const first = root.querySelector('[kovo-key="p1"]');
    const second = root.querySelector('[kovo-key="p2"]');
    const input = root.querySelector('input');

    if (!grid || !first || !second || !input) throw new Error('missing append fixture');

    input.focus();

    const appendResult = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-fragment target="product-grid" mode="append">',
        '<article kovo-key="p3">Third</article>',
        '<article kovo-key="p4">Fourth</article>',
        '</kovo-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    expect(appendResult.appliedFragments).toEqual(['product-grid']);
    expect(root.querySelector('[kovo-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[kovo-key="p1"]')).toBe(first);
    expect(root.querySelector('[kovo-key="p2"]')).toBe(second);
    expect(document.activeElement).toBe(input);
    expect([...grid.children].map((child) => child.getAttribute('kovo-key'))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);

    applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-fragment target="product-grid">',
        '<section kovo-c="product-grid">',
        '<article kovo-key="p4">Fourth updated</article>',
        '<article kovo-key="p1"><input value="keep"></article>',
        '<article kovo-key="p3">Third</article>',
        '<article kovo-key="p2">Second</article>',
        '</section>',
        '</kovo-fragment>',
      ].join(''),
      morph: keyedDomMorph,
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    expect(root.querySelector('[kovo-c="product-grid"]')).toBe(grid);
    expect(root.querySelector('[kovo-key="p1"]')).toBe(first);
    expect(root.querySelector('[kovo-key="p2"]')).toBe(second);
    expect([...grid.children].map((child) => child.getAttribute('kovo-key'))).toEqual([
      'p4',
      'p1',
      'p3',
      'p2',
    ]);
  });

  it('resolves browser fragment targets through component stamps, ids, and target attributes', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-c="cart-badge">stale badge</section>',
      '<section id="reviews:p1">stale reviews</section>',
      '<section kovo-fragment-target="recommendations">stale recommendations</section>',
    ].join('');
    document.body.append(root);

    const applied = applyMutationResponseBodyToRuntime({
      body: [
        '<kovo-fragment target="cart-badge"><section kovo-c="cart-badge">fresh badge</section></kovo-fragment>',
        '<kovo-fragment target="reviews:p1"><section id="reviews:p1">fresh reviews</section></kovo-fragment>',
        '<kovo-fragment target="recommendations"><section kovo-fragment-target="recommendations">fresh recommendations</section></kovo-fragment>',
      ].join(''),
      root: new DomMorphRoot(root),
      store: createQueryStore(),
    });

    // SPEC.md §9.1: browser fragment application must resolve the same live
    // target vocabulary sent in Kovo-Targets and accepted by the inline loader.
    expect(applied.appliedFragments).toEqual(['cart-badge', 'reviews:p1', 'recommendations']);
    expect(root.querySelector('[kovo-c="cart-badge"]')?.textContent).toBe('fresh badge');
    expect(root.querySelector('[id="reviews:p1"]')?.textContent).toBe('fresh reviews');
    expect(root.querySelector('[kovo-fragment-target="recommendations"]')?.textContent).toBe(
      'fresh recommendations',
    );
  });

  it('reports browser query apply failures and still applies later fragments', () => {
    const root = document.createElement('main');
    root.innerHTML =
      '<section kovo-c="cart-badge">stale</section><span data-bind="cart.count">0</span>';
    document.body.append(root);
    const store = createQueryStore();
    const onError = vi.fn();
    const hookError = new Error('browser query hook failed');

    const applied = applyMutationResponseBodyToRuntime({
      applyQuery(query) {
        if ((query.value as { count: number }).count === 1) throw hookError;
      },
      body: [
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-query name="cart">{"count":2}</kovo-query>',
        '<kovo-fragment target="cart-badge"><section kovo-c="cart-badge">fresh</section></kovo-fragment>',
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
    expect(root.querySelector('[kovo-c="cart-badge"]')?.textContent).toBe('fresh');
  });
});
