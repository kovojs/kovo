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

  it('sanitizes copied fragment attributes during keyed morphs', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'promo');
    target.setAttribute('kovo-key', 'promo');
    target.innerHTML = '<a kovo-key="link" href="/safe">old</a>';
    document.body.append(target);

    new DomMorphTarget(target).replaceWithHtml(
      [
        '<section kovo-fragment-target="promo" kovo-key="promo" onclick="bad()">',
        '<a kovo-key="link" href="java\tscript:alert(1)" srcdoc="<script>bad()</script>">new</a>',
        '</section>',
      ].join(''),
    );

    const link = target.querySelector('a');
    expect(target.getAttribute('onclick')).toBeNull();
    expect(link?.getAttribute('href')).toBe('#');
    expect(link?.getAttribute('srcdoc')).toBeNull();
  });

  it('sanitizes whole-node replacement fragment trees before adoption', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'promo');
    target.innerHTML = '<p>old</p>';
    document.body.append(target);

    const applied = applyHtmlResponseFragments(
      [
        {
          html: [
            '<article kovo-fragment-target="promo"',
            ' onclick="alert(1)" innerHTML="<img src=x onerror=alert(1))" style="background:url(javascript:alert(1))">',
            '<a href="java\tscript:alert(1)"',
            ' srcdoc="<script>bad()</script>"',
            ' srcset="/safe.png 1x, javascript:alert(1) 2x">new</a>',
            '<span style="min-height: 120px">safe style</span>',
            '</article>',
          ].join(''),
          target: 'promo',
        },
      ],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );

    const article = document.querySelector('article[kovo-fragment-target="promo"]');
    const link = article?.querySelector('a');
    const span = article?.querySelector('span');

    expect(applied).toEqual(['promo']);
    expect(article?.getAttribute('onclick')).toBeNull();
    expect(article?.getAttribute('innerHTML')).toBeNull();
    expect(article?.getAttribute('style')).toBeNull();
    expect(link?.getAttribute('href')).toBe('#');
    expect(link?.getAttribute('srcdoc')).toBeNull();
    expect(link?.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(span?.getAttribute('style')).toBeNull();
  });

  it('sanitizes appended fragment nodes before adoption', () => {
    const target = document.createElement('ul');
    target.setAttribute('kovo-fragment-target', 'feed');
    target.innerHTML = '<li kovo-key="existing">old</li>';
    document.body.append(target);

    const applied = applyHtmlResponseFragments(
      [
        {
          html: [
            '<li kovo-key="new">',
            '<a href="javascript:alert(1)" onclick="alert(1)" innerHTML="<img src=x onerror=alert(1))"',
            ' srcdoc="<script>bad()</script>"',
            ' srcset="/safe.png 1x, javascript:alert(1) 2x"',
            ' style="background:url(javascript:alert(1))">new</a>',
            '</li>',
          ].join(''),
          mode: 'append',
          target: 'feed',
        },
      ],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );

    const link = target.querySelector('[kovo-key="new"] a');

    expect(applied).toEqual(['feed']);
    expect([...target.children].map((child) => child.getAttribute('kovo-key'))).toEqual([
      'existing',
      'new',
    ]);
    expect(link?.getAttribute('href')).toBe('#');
    expect(link?.getAttribute('innerHTML')).toBeNull();
    expect(link?.getAttribute('onclick')).toBeNull();
    expect(link?.getAttribute('srcdoc')).toBeNull();
    expect(link?.getAttribute('srcset')).toBe('/safe.png 1x');
    expect(link?.getAttribute('style')).toBeNull();
  });
});
