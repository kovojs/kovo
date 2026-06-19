import { afterEach, describe, expect, it } from 'vitest';

import { createQueryStore } from './client.js';
import { applyDeferredStreamResponseToRuntime } from './generated.js';
import { DomMorphRoot, keyedDomMorph } from './morph.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser deferred stream response apply', () => {
  it('applies CRLF deferred stream query truth before browser fragment morphs', () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<section kovo-c="cart-badge"><output data-bind="cart.count">0</output></section>',
      '<p data-bind="cart.count">0</p>',
    ].join('');
    document.body.append(root);
    const store = createQueryStore();
    const badge = root.querySelector('[kovo-c="cart-badge"]');
    const observed: string[] = [];
    if (!badge) throw new Error('missing cart badge fixture');

    // SPEC.md §4.4/§9.1: deferred stream chunks reuse mutation query/fragment
    // apply, so browser morphs observe the query-store truth from the same part.
    const applied = applyDeferredStreamResponseToRuntime({
      body: [
        '--kovo-boundary\r\n',
        'Content-Type: text/vnd.kovo.fragment+html\r\n',
        '\r\n',
        '<kovo-query name="cart">{"count":4}</kovo-query>\r\n',
        '<kovo-fragment target="cart-badge">',
        '<section kovo-c="cart-badge"><output data-bind="cart.count">server</output></section>',
        '</kovo-fragment>\r\n',
        '--kovo-boundary--\r\n',
      ].join(''),
      morph(target, html) {
        observed.push(root.querySelector('p')?.textContent ?? '');
        keyedDomMorph(target, html);
      },
      queryPlans: { cart: { bindings: true } },
      queryRoot: document,
      root: new DomMorphRoot(root),
      store,
    });

    expect(applied.queries).toEqual(['cart']);
    expect(applied.appliedFragments).toEqual(['cart-badge']);
    expect(store.get('cart')).toEqual({ count: 4 });
    expect(observed).toEqual(['4']);
    expect(root.querySelector('[kovo-c="cart-badge"]')).toBe(badge);
    expect(root.querySelector('[kovo-c="cart-badge"] output')?.textContent).toBe('server');
    expect(root.querySelector('p')?.textContent).toBe('4');
  });
});
