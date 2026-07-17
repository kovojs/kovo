import {
  BLOCKED_SVG_SMIL_ELEMENT_NAMES,
  createRenderedFragmentHtml,
  decideRuntimeAttributeWrite,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installInlineKovoLoader } from './inline-loader.js';
import { DomMorphTarget } from './morph.js';
import { applyStateBindings } from './query-bindings.js';
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

const fragmentHtml = (html: string): RenderedFragmentHtml => createRenderedFragmentHtml(html);

describe('browser response fragment apply', () => {
  it('H12 inerts real SVG SMIL ancestor and href-targeted sibling XSS before Chromium click', async () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'smil-target');
    document.body.append(target);
    delete document.body.dataset.kovoSmilXss;

    const payload = "javascript:(document.body.dataset.kovoSmilXss='yes',void 0)";
    const html = [
      '<section kovo-fragment-target="smil-target">',
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<a id="ancestor-target"><text x="10" y="20">ancestor</text>',
      `<animate ATTRIBUTENAME="href" values="${payload}" begin="0s" dur="1s" fill="freeze" />`,
      '</a>',
      '<a id="sibling-target"><text x="10" y="40">sibling</text></a>',
      `<animate href="#sibling-target" attributeName="href" from="/safe" to="${payload}" begin="0s" dur="1s" fill="freeze" />`,
      `<set href="#sibling-target" attributeName="xlink:href" to="${payload}" begin="0s" />`,
      `<animate href="#sibling-target" attributeName="href" by="${payload}" begin="0s" dur="1s" />`,
      `<animate href="#sibling-target" attributeName="href" values="/safe;${payload}" begin="0s" dur="1s" />`,
      '</svg>',
      '</section>',
    ].join('');

    applyHtmlResponseFragments([{ html: fragmentHtml(html), target: 'smil-target' }], (name) =>
      document.querySelector(`[kovo-fragment-target="${name}"]`),
    );

    const animations = [...document.querySelectorAll('animate, set')];
    expect(animations).toHaveLength(5);
    for (const animation of animations) {
      expect(animation.attributes).toHaveLength(0);
      expect(animation.childNodes).toHaveLength(0);
    }

    // Chromium materializes the vulnerable animated javascript: URL only after a SMIL tick.
    // Dispatching the click exercises the actual SVG link default action, not a string assertion.
    await new Promise((resolve) => setTimeout(resolve, 60));
    for (const link of document.querySelectorAll('svg a')) {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.dataset.kovoSmilXss).toBeUndefined();
  });

  it('H12 closes both live-binding target/value transition orders on SMIL elements', async () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<svg>',
      '<animate attributeName="opacity" values="0;1" data-bind:attributeName="state.target" data-bind:values="state.payload"></animate>',
      '<set attributeName="href" to="/safe" data-bind:to="state.payload" data-bind:attributeName="state.target"></set>',
      '</svg>',
    ].join('');
    document.body.append(root);

    await applyStateBindings(root, {
      payload: "javascript:(document.body.dataset.kovoSmilXss='state',void 0)",
      target: 'xlink:href',
    });

    for (const animation of root.querySelectorAll('animate, set')) {
      expect(animation.attributes).toHaveLength(0);
    }
  });

  it('morphs the fragment root instead of leading stylesheet links', () => {
    const target = document.createElement('div');
    target.setAttribute('kovo-fragment-target', 'cart-badge');
    target.innerHTML = '<span>old</span>';
    document.body.append(target);

    const applied = applyHtmlResponseFragments(
      [
        {
          html: fragmentHtml(
            '<link rel="stylesheet" href="/assets/app.css"><div kovo-fragment-target="cart-badge"><span>new</span></div>',
          ),
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
          html: fragmentHtml(
            [
              '<article kovo-fragment-target="promo"',
              ' onclick="alert(1)" innerHTML="<img src=x onerror=alert(1))" style="background:url(javascript:alert(1))">',
              '<a href="java\tscript:alert(1)"',
              ' srcdoc="<script>bad()</script>"',
              ' srcset="/safe.png 1x, javascript:alert(1) 2x">new</a>',
              '<span style="min-height: 120px">safe style</span>',
              '</article>',
            ].join(''),
          ),
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
          html: fragmentHtml(
            [
              '<li kovo-key="new">',
              '<a href="javascript:alert(1)" onclick="alert(1)" innerHTML="<img src=x onerror=alert(1))"',
              ' srcdoc="<script>bad()</script>"',
              ' srcset="/safe.png 1x, javascript:alert(1) 2x"',
              ' style="background:url(javascript:alert(1))">new</a>',
              '</li>',
            ].join(''),
          ),
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

  it('C240 cannot erase an unsafe attribute through an inherited array-index setter', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'numeric-setter');
    document.body.append(target);
    const nativeDefineProperty = Object.defineProperty;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    let poisonHits = 0;

    try {
      nativeDefineProperty(Array.prototype, '0', {
        configurable: true,
        set(value: unknown) {
          if (value instanceof Attr && value.name === 'onclick') {
            poisonHits += 1;
            return;
          }
          nativeDefineProperty(this, '0', {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });

      applyHtmlResponseFragments(
        [
          {
            html: fragmentHtml(
              '<article onclick="alert(1)" kovo-fragment-target="numeric-setter">unsafe</article>',
            ),
            target: 'numeric-setter',
          },
        ],
        (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
      );
    } finally {
      if (originalDescriptor === undefined) delete Array.prototype[0];
      else nativeDefineProperty(Array.prototype, '0', originalDescriptor);
    }

    const article = document.querySelector('article[kovo-fragment-target="numeric-setter"]');
    expect(poisonHits).toBe(0);
    expect(article?.getAttribute('onclick')).toBeNull();
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
            html: fragmentHtml(
              renderFragmentAttributeCase(testCase.name, testCase.name, testCase.value),
            ),
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

  it('H12 keeps the extracted inline fragment path on the same SMIL ban', async () => {
    const target = document.createElement('div');
    target.setAttribute('kovo-fragment-target', 'inline-smil');
    document.body.append(target);
    delete document.body.dataset.kovoSmilXss;
    installInlineKovoLoader(async () => ({}));

    const payload = "javascript:(document.body.dataset.kovoSmilXss='inline-fragment',void 0)";
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="inline-smil">',
        '<div kovo-fragment-target="inline-smil"><svg>',
        '<a id="inline-smil-link"><text>click</text>',
        `<animate attributeName="href" values="${payload}" begin="0s" dur="1s" fill="freeze"></animate>`,
        '</a></svg></div>',
        '</kovo-fragment>',
      ].join(''),
    );

    const animation = document.querySelector('animate');
    expect(animation?.attributes).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 60));
    document
      .querySelector('#inline-smil-link')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.dataset.kovoSmilXss).toBeUndefined();
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

    for (const name of BLOCKED_SVG_SMIL_ELEMENT_NAMES) {
      expect(__responseFragmentApplySanitizerParityForTests.isBlockedSvgSmilElementName(name)).toBe(
        true,
      );
      expect(
        __responseFragmentApplySanitizerParityForTests.isBlockedSvgSmilElementName(
          name.toUpperCase(),
        ),
      ).toBe(true);
    }
    expect(__responseFragmentApplySanitizerParityForTests.isBlockedSvgSmilElementName('svg')).toBe(
      false,
    );
  });
});

// SPEC §9.3/§13.2: prepend ("load older") inserts keyed rows at the START of the target,
// dedupes by kovo-key, and carries a scroll-anchor guarantee — the target is the scroll
// container, and its scrollTop shifts by the inserted height so existing content does not
// jump. Real Chromium layout exercises the actual scrollHeight/scrollTop math.
describe('browser prepend (load-older) fragment apply', () => {
  const ROW = 40;

  function scrollContainer(keys: readonly string[]): HTMLElement {
    const container = document.createElement('ul');
    container.setAttribute('kovo-fragment-target', 'chat-log');
    container.style.cssText = 'height:120px;overflow:auto;margin:0;padding:0;box-sizing:border-box';
    for (const key of keys) {
      const row = document.createElement('li');
      row.setAttribute('kovo-key', key);
      row.textContent = key;
      row.style.cssText = `height:${ROW}px;list-style:none`;
      container.append(row);
    }
    document.body.append(container);
    return container;
  }

  function olderRows(...keys: string[]): string {
    return keys
      .map((key) => `<li kovo-key="${key}" style="height:${ROW}px;list-style:none">${key}</li>`)
      .join('');
  }

  it('p() inserts at the START, dedupes by kovo-key, and holds the scroll anchor', () => {
    const container = scrollContainer(['m5', 'm6', 'm7', 'm8']); // 160px content, 120px viewport
    container.scrollTop = container.scrollHeight; // scrolled to the newest row (bottom)
    const beforeHeight = container.scrollHeight;
    const beforeTop = container.scrollTop;
    const anchor = container.querySelector('[kovo-key="m8"]') as HTMLElement;
    const anchorTopBefore = anchor.getBoundingClientRect().top;

    // Older page includes a duplicate (m6) plus genuinely older rows (m3, m4).
    applyHtmlResponseFragments(
      [{ html: fragmentHtml(olderRows('m6', 'm3', 'm4')), mode: 'prepend', target: 'chat-log' }],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );

    expect([...container.children].map((c) => c.getAttribute('kovo-key'))).toEqual([
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
    ]);
    // Two new rows (m3,m4) of 40px each; scrollTop shifts by exactly that inserted height.
    expect(container.scrollHeight - beforeHeight).toBe(2 * ROW);
    expect(container.scrollTop - beforeTop).toBe(2 * ROW);
    // The previously-visible anchor row keeps its viewport position (no jump).
    expect(Math.abs(anchor.getBoundingClientRect().top - anchorTopBefore)).toBeLessThanOrEqual(1);
  });

  it('DomMorphTarget.prependHtml mirrors the keyed-dedup insert-at-START + scroll anchor', () => {
    const container = scrollContainer(['m5', 'm6', 'm7', 'm8']);
    container.scrollTop = container.scrollHeight;
    const beforeHeight = container.scrollHeight;
    const beforeTop = container.scrollTop;

    new DomMorphTarget(container).prependHtml(olderRows('m6', 'm3', 'm4'));

    expect([...container.children].map((c) => c.getAttribute('kovo-key'))).toEqual([
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
    ]);
    expect(container.scrollHeight - beforeHeight).toBe(2 * ROW);
    expect(container.scrollTop - beforeTop).toBe(2 * ROW);
  });
});
