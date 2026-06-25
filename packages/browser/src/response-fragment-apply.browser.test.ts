import { decideRuntimeAttributeWrite } from '@kovojs/core/internal/sink-policy';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';
import { DomMorphTarget } from './morph.js';
import {
  __responseFragmentApplySanitizerParityForTests,
  applyHtmlResponseFragments,
} from './response-fragment-apply.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const sinkParityCases = [
  { name: 'href', value: 'java\nscript:alert(1)' },
  { name: 'xlink:href', value: 'java\tscript:alert(1)' },
  {
    name: 'srcset',
    value: '/safe.png 1x, url("https://cdn.test/a,b.png") 2x, javascript:alert(1) 3x',
  },
  { name: 'srcset', value: 'java\tscript:alert(1) 1x' },
  { name: 'imagesrcset', value: '/safe.png 1x, data:text/html 2x' },
  { name: 'style', value: 'min-height: 120px; overflow: auto' },
  { name: 'style', value: 'background-image: url("java\nscript:alert(1)")' },
  { name: 'InNeRhTmL', value: '<img src=x onerror=alert(1)>' },
] as const;

function expectedAttributeAfterPolicy(name: string, value: string): string | null {
  const decision = decideRuntimeAttributeWrite(name, value);
  if (decision.action === 'remove') return null;
  return decision.value ?? value;
}

function renderFragmentAttributeCase(target: string, name: string, value: string): string {
  const host = name === 'imagesrcset' ? 'link' : 'a';
  const escaped = value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return [
    `<${host} kovo-fragment-target="${target}"`,
    ` ${name}="${escaped}">`,
    'fragment',
    `</${host}>`,
  ].join('');
}

function readSanitizedAttribute(element: Element | null, name: string): string | null {
  return element?.getAttribute(name) ?? element?.getAttribute(name.toLowerCase()) ?? null;
}

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
    expect(span?.getAttribute('style')).toBe('min-height: 120px');
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

  it('keeps modular fragment sanitizer decisions in parity with the shared KV236 sink policy', () => {
    // SPEC.md §4.8/KV236: fragment adoption is a runtime output sink. The local
    // self-contained helper must match `decideRuntimeAttributeWrite()` because
    // the same helper is extracted into the inline loader.
    for (const testCase of sinkParityCases) {
      const target = document.createElement('div');
      target.setAttribute('kovo-fragment-target', testCase.name);
      document.body.append(target);

      applyHtmlResponseFragments(
        [
          {
            html: renderFragmentAttributeCase(testCase.name, testCase.name, testCase.value),
            target: testCase.name,
          },
        ],
        (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
      );

      const element = document.querySelector(`[kovo-fragment-target="${testCase.name}"]`);
      expect(readSanitizedAttribute(element, testCase.name), testCase.name).toBe(
        expectedAttributeAfterPolicy(testCase.name, testCase.value),
      );
      element?.remove();
    }
  });

  it('keeps extracted inline fragment sanitizer decisions in parity with the shared KV236 sink policy', () => {
    installInlineKovoLoader(async () => ({}));

    for (const testCase of sinkParityCases) {
      const target = `inline-${testCase.name}`;
      const existing = document.createElement('div');
      existing.setAttribute('kovo-fragment-target', target);
      document.body.append(existing);

      (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
        [
          `<kovo-fragment target="${target}">`,
          renderFragmentAttributeCase(target, testCase.name, testCase.value),
          '</kovo-fragment>',
        ].join(''),
      );

      const element = document.querySelector(`[kovo-fragment-target="${target}"]`);
      expect(readSanitizedAttribute(element, testCase.name), testCase.name).toBe(
        expectedAttributeAfterPolicy(testCase.name, testCase.value),
      );
      element?.remove();
    }
  });

  it('keeps focused sanitizer helper outputs in parity with shared URL/srcset/CSS decisions', () => {
    for (const testCase of sinkParityCases) {
      const decision = decideRuntimeAttributeWrite(testCase.name, testCase.value);

      if (decision.family === 'srcset') {
        expect(__responseFragmentApplySanitizerParityForTests.sanitizeSrcset(testCase.value)).toBe(
          decision.action === 'remove' ? null : decision.value,
        );
      } else if (decision.family === 'css-text') {
        expect(
          __responseFragmentApplySanitizerParityForTests.hasUnsafeCssText(testCase.value),
        ).toBe(decision.action === 'remove');
      } else if (decision.family === 'url') {
        expect(
          __responseFragmentApplySanitizerParityForTests.hasUnsafeUrlScheme(testCase.value),
        ).toBe(decision.action !== 'allow');
      }
    }
  });
});
