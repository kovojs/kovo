import { afterEach, describe, expect, it } from 'vitest';

import { DomMorphTarget } from './morph.js';
import { applyHtmlResponseFragments } from './response-fragment-apply.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser response fragment apply', () => {
  it('morphs the fragment root instead of leading stylesheet links', () => {
    const target = document.createElement('div');
    target.setAttribute('kovo-fragment-target', 'cart-badge');
    target.innerHTML = '<span>old</span>';
    document.body.append(target);

    const applied = applyHtmlResponseFragments(
      [
        {
          html: '<link rel="stylesheet" href="/assets/app.css"><div kovo-fragment-target="cart-badge"><span>new</span></div>',
          target: 'cart-badge',
        },
      ],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );

    expect(applied).toEqual(['cart-badge']);
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(document.querySelector('[kovo-fragment-target="cart-badge"]')?.outerHTML).toBe(
      '<div kovo-fragment-target="cart-badge"><span>new</span></div>',
    );
  });

  it('uses the same fragment root selection for DOM morph targets', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'cart-badge');
    target.innerHTML = '<p>old</p>';
    document.body.append(target);

    new DomMorphTarget(target).replaceWithHtml(
      '<link rel="stylesheet" href="/assets/app.css"><section kovo-fragment-target="cart-badge"><p>new</p></section>',
    );

    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
    expect(target.outerHTML).toBe(
      '<section kovo-fragment-target="cart-badge"><p>new</p></section>',
    );
  });
});
