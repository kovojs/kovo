import {
  BLOCKED_ACTIVE_EMBED_ELEMENT_NAMES,
  BLOCKED_DECLARATIVE_SHADOW_DOM_ATTRIBUTE_NAMES,
  BLOCKED_SVG_SMIL_ELEMENT_NAMES,
  createRenderedFragmentHtml,
  decideRuntimeAttributeWrite,
  type RenderedFragmentHtml,
} from '@kovojs/core/internal/sink-policy';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyMutationResponseBodyToRuntime } from './apply-mutation-response.js';
import { createQueryStore } from './client.js';
import { installInlineKovoLoader } from './inline-loader.js';
import { DomMorphRoot, DomMorphTarget, keyedDomMorph } from './morph.js';
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
  it('keeps live feImage/style activation reviewed and disables undelegated geolocation', async () => {
    const root = document.createElement('section');
    root.innerHTML = [
      '<svg><feImage data-case="feimage" href="/victim.svg" crossorigin="anonymous"',
      ' data-bind:crossorigin="state.credentialMode"></feImage></svg>',
      '<style data-case="style" type="text/plain" media="not all"',
      ' data-bind:type="state.styleType" data-bind:media="state.styleMedia">',
      'body { color: red }',
      '</style>',
      '<geolocation data-case="location"',
      ' data-bind:autolocate="state.autolocate" data-bind:watch="state.watch"',
      ' data-bind:accuracymode="state.accuracyMode"></geolocation>',
    ].join('');
    document.body.append(root);

    await applyStateBindings(root, {
      accuracyMode: 'precise',
      autolocate: true,
      credentialMode: 'use-credentials',
      styleMedia: 'all',
      styleType: 'text/css',
      watch: true,
    });

    const feImage = root.querySelector('[data-case="feimage"]');
    expect(feImage?.getAttribute('crossorigin')).toBe('anonymous');
    const style = root.querySelector('[data-case="style"]');
    expect(style?.getAttribute('type')).toBe('text/plain');
    expect(style?.getAttribute('media')).toBe('not all');
    const geolocation = root.querySelector('[data-case="location"]');
    expect(geolocation?.hasAttribute('autolocate')).toBe(false);
    expect(geolocation?.hasAttribute('watch')).toBe(false);
    expect(geolocation?.hasAttribute('accuracymode')).toBe(false);
  });

  for (const kind of ['object', 'embed'] as const) {
    it(`does not activate remotely selected same-origin HTML through <${kind}> during fragment morph`, async () => {
      const root = document.createElement('main');
      root.innerHTML = '<section kovo-c="active-embed-audit">old</section>';
      document.body.append(root);

      let executed = false;
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type === 'kovo:safe-account') executed = true;
      };
      addEventListener('message', onMessage);
      try {
        const element =
          kind === 'object'
            ? '<object data="/safe/account" type="text/html"></object>'
            : '<embed src="/safe/account" type="text/html">';
        applyMutationResponseBodyToRuntime({
          body: `<kovo-fragment target="active-embed-audit"><section kovo-c="active-embed-audit">${element}</section></kovo-fragment>`,
          morph: keyedDomMorph,
          root: new DomMorphRoot(root),
          store: createQueryStore(),
        });

        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(executed).toBe(false);
        const adopted = root.querySelector(kind);
        expect(adopted?.attributes).toHaveLength(0);
        expect(adopted?.childNodes).toHaveLength(0);
      } finally {
        removeEventListener('message', onMessage);
      }
    });
  }

  // @kovo-security-certifies C13 compiler-wire-control-plane-preserved
  it('preserves and executes compiler-emitted fragment interactivity', async () => {
    const target = document.createElement('button');
    target.setAttribute('kovo-fragment-target', 'interactive-fragment');
    document.body.append(target);
    const imports: string[] = [];
    installInlineKovoLoader(async (url) => {
      imports.push(url);
      return {
        run(event: Event) {
          (event.target as HTMLElement | null)?.setAttribute('data-ran', 'yes');
        },
      };
    });

    applyHtmlResponseFragments(
      [
        {
          html: fragmentHtml(
            [
              '<button kovo-fragment-target="interactive-fragment"',
              ' on:click="/c/fragment.client.js#run"',
              ' data-kovo-module-allowlist="/c/fragment.client.js"',
              ' data-stream-renderer="/c/fragment.client.js#render">Run</button>',
            ].join(''),
          ),
          target: 'interactive-fragment',
        },
      ],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );

    const button = document.querySelector<HTMLButtonElement>(
      '[kovo-fragment-target="interactive-fragment"]',
    );
    expect(button?.getAttribute('on:click')).toBe('/c/fragment.client.js#run');
    expect(button?.getAttribute('data-kovo-module-allowlist')).toBe('/c/fragment.client.js');
    expect(button?.getAttribute('data-stream-renderer')).toBe('/c/fragment.client.js#render');

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(imports).toContain('/c/fragment.client.js');
    expect(button?.getAttribute('data-ran')).toBe('yes');
  });

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

  it('removes an unreviewed iframe source before any modular live binding commits', async () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<iframe data-case="missing" src="/missing" data-bind:title="state.title"></iframe>',
      '<iframe data-case="pair" src="/pair" sandbox="allow-scripts allow-same-origin" data-bind:title="state.title"></iframe>',
      '<iframe data-case="safe" src="/safe" sandbox="allow-scripts" data-bind:title="state.title"></iframe>',
    ].join('');
    document.body.append(root);

    await applyStateBindings(root, { title: 'updated' });

    for (const unsafe of root.querySelectorAll('iframe:not([data-case="safe"])')) {
      expect(unsafe.getAttribute('src'), unsafe.getAttribute('data-case') ?? '').toBeNull();
    }
    expect(root.querySelector('iframe[data-case="safe"]')?.getAttribute('src')).toBe('/safe');
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

  it('strips hostile submitter form targets from newly adopted fragment nodes', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'submitter-controls');
    target.setAttribute('kovo-key', 'submitter-controls');
    document.body.append(target);

    new DomMorphTarget(target).replaceWithHtml(
      [
        '<section kovo-fragment-target="submitter-controls" kovo-key="submitter-controls">',
        '<button kovo-key="button" formtarget="attacker-window">Pay</button>',
        '<input kovo-key="input" formtarget="attacker-window">',
        '</section>',
      ].join(''),
    );

    expect(target.querySelector('[kovo-key="button"]')?.getAttribute('formtarget')).toBeNull();
    expect(target.querySelector('[kovo-key="input"]')?.getAttribute('formtarget')).toBeNull();
  });

  it('preserves reviewed element-context controls during keyed morphs', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'context-controls');
    target.setAttribute('kovo-key', 'context-controls');
    target.innerHTML = [
      '<script kovo-key="script" type="application/json" src="/reviewed/data.json" nomodule',
      ' integrity="sha384-reviewed" crossorigin="anonymous" referrerpolicy="strict-origin"',
      ' charset="utf-8" nonce="forbidden" language="javascript"></script>',
      '<link kovo-key="link" rel="alternate" href="data:text/plain,reviewed" type="text/css"',
      ' media="print" disabled integrity="sha384-reviewed" crossorigin="anonymous"',
      ' referrerpolicy="strict-origin" as="style" nonce="forbidden">',
      '<iframe kovo-key="frame" src="#reviewed" sandbox="allow-forms" allow="fullscreen"',
      ' credentialless csp="default-src \'none\'" referrerpolicy="strict-origin"',
      ' name="reviewed-frame"></iframe>',
      '<annotation-xml kovo-key="annotation" encoding="text/plain"></annotation-xml>',
      '<a kovo-key="anchor" target="_blank" rel="noopener noreferrer"',
      ' referrerpolicy="strict-origin" ping="/forbidden">reviewed</a>',
      '<map><area kovo-key="area" target="_self" rel="noreferrer"',
      ' referrerpolicy="no-referrer" ping="/forbidden"></map>',
      '<img kovo-key="image" referrerpolicy="same-origin">',
      '<meta kovo-key="metadata" name="description" content="reviewed">',
    ].join('');
    document.body.append(target);

    new DomMorphTarget(target).replaceWithHtml(
      [
        '<section kovo-fragment-target="context-controls" kovo-key="context-controls">',
        '<script kovo-key="script" type="module" src="/uploads/attacker.js"',
        ' integrity="" crossorigin="use-credentials" referrerpolicy="unsafe-url"',
        ' charset="attacker" nonce="attacker" language="vbscript"></script>',
        '<link kovo-key="link" rel="stylesheet" href="/uploads/attacker.css" type="attacker"',
        ' media="all" integrity="" crossorigin="use-credentials" referrerpolicy="unsafe-url"',
        ' as="script" nonce="attacker">',
        '<iframe kovo-key="frame" src="/uploads/attacker.html"',
        ' sandbox="allow-scripts allow-same-origin" allow="camera" csp=""',
        ' referrerpolicy="unsafe-url" name="attacker-frame"></iframe>',
        '<annotation-xml kovo-key="annotation" encoding="text/html"></annotation-xml>',
        '<a kovo-key="anchor" target="customer-window" rel="opener"',
        ' referrerpolicy="unsafe-url" ping="/collect">attacker</a>',
        '<map><area kovo-key="area" target="customer-window" rel="opener"',
        ' referrerpolicy="unsafe-url" ping="/collect"></map>',
        '<img kovo-key="image" referrerpolicy="unsafe-url">',
        '<meta kovo-key="metadata" name="referrer" content="unsafe-url">',
        '</section>',
      ].join(''),
    );

    const script = target.querySelector('[kovo-key="script"]');
    const link = target.querySelector('[kovo-key="link"]');
    const frame = target.querySelector('[kovo-key="frame"]');
    const annotation = target.querySelector('[kovo-key="annotation"]');
    const anchor = target.querySelector('[kovo-key="anchor"]');
    const area = target.querySelector('[kovo-key="area"]');
    const image = target.querySelector('[kovo-key="image"]');
    const metadata = target.querySelector('[kovo-key="metadata"]');
    expect(script?.getAttribute('type')).toBe('application/json');
    expect(script?.getAttribute('src')).toBe('/reviewed/data.json');
    expect(script?.getAttribute('integrity')).toBe('sha384-reviewed');
    expect(script?.getAttribute('crossorigin')).toBe('anonymous');
    expect(script?.getAttribute('referrerpolicy')).toBe('strict-origin');
    expect(script?.getAttribute('charset')).toBe('utf-8');
    expect(script?.hasAttribute('nomodule')).toBe(true);
    expect(script?.getAttribute('nonce')).toBeNull();
    expect(script?.getAttribute('language')).toBeNull();
    expect(link?.getAttribute('href')).toBe('data:text/plain,reviewed');
    expect(link?.getAttribute('rel')).toBe('alternate');
    expect(link?.getAttribute('type')).toBe('text/css');
    expect(link?.getAttribute('media')).toBe('print');
    expect(link?.hasAttribute('disabled')).toBe(true);
    expect(link?.getAttribute('integrity')).toBe('sha384-reviewed');
    expect(link?.getAttribute('crossorigin')).toBe('anonymous');
    expect(link?.getAttribute('referrerpolicy')).toBe('strict-origin');
    expect(link?.getAttribute('as')).toBe('style');
    expect(link?.getAttribute('nonce')).toBeNull();
    expect(frame?.getAttribute('src')).toBe('#reviewed');
    expect(frame?.getAttribute('sandbox')).toBe('allow-forms');
    expect(frame?.getAttribute('allow')).toBe('fullscreen');
    expect(frame?.hasAttribute('credentialless')).toBe(true);
    expect(frame?.getAttribute('csp')).toBe("default-src 'none'");
    expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin');
    expect(frame?.getAttribute('name')).toBe('reviewed-frame');
    expect(annotation?.getAttribute('encoding')).toBe('text/plain');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(anchor?.getAttribute('referrerpolicy')).toBe('strict-origin');
    expect(anchor?.getAttribute('ping')).toBeNull();
    expect(area?.getAttribute('target')).toBe('_self');
    expect(area?.getAttribute('rel')).toBe('noreferrer');
    expect(area?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(area?.getAttribute('ping')).toBeNull();
    expect(image?.getAttribute('referrerpolicy')).toBe('same-origin');
    expect(metadata?.getAttribute('name')).toBe('description');
    expect(metadata?.getAttribute('content')).toBeNull();
  });

  it('removes unsafe static browser-control values from newly adopted fragment nodes', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'unsafe-controls');
    document.body.append(target);

    new DomMorphTarget(target).replaceWithHtml(
      [
        '<article kovo-fragment-target="unsafe-controls">',
        '<a target="customer-window" rel="noreferrer opener" referrerpolicy="unsafe-url"',
        ' ping="/collect">link</a>',
        '<area target="customer-window" rel="opener" referrerpolicy="origin" ping="/collect">',
        '<img referrerpolicy="no-referrer-when-downgrade">',
        '<script type="application/json" nonce="attacker" language="javascript"></script>',
        '<link rel="alternate" nonce="attacker">',
        '<iframe data-case="missing" src="/missing-sandbox"></iframe>',
        '<iframe data-case="pair" src="/lifted" sandbox="allow-scripts allow-same-origin"></iframe>',
        '<iframe data-case="top" src="/top" sandbox="allow-top-navigation-by-user-activation"></iframe>',
        '<iframe data-case="popup" src="/popup" sandbox="allow-popups-to-escape-sandbox"></iframe>',
        '<iframe data-case="storage" src="/storage" sandbox="allow-storage-access-by-user-activation"></iframe>',
        '<iframe data-case="safe" src="/safe" sandbox="allow-scripts allow-forms"></iframe>',
        '<meta name="referrer" content="unsafe-url" data-safe="kept">',
        '</article>',
      ].join(''),
    );

    const adopted = document.querySelector('article[kovo-fragment-target="unsafe-controls"]');
    const [anchor, area] = adopted?.querySelectorAll('a, area') ?? [];
    const image = adopted?.querySelector('img');
    const script = adopted?.querySelector('script');
    const link = adopted?.querySelector('link');
    const meta = adopted?.querySelector('meta');
    for (const element of [anchor, area, image]) {
      expect(element?.getAttribute('referrerpolicy')).toBeNull();
    }
    expect(anchor?.getAttribute('target')).toBeNull();
    expect(anchor?.getAttribute('rel')).toBeNull();
    expect(anchor?.getAttribute('ping')).toBeNull();
    expect(area?.getAttribute('target')).toBeNull();
    expect(area?.getAttribute('rel')).toBeNull();
    expect(area?.getAttribute('ping')).toBeNull();
    expect(script?.getAttribute('nonce')).toBeNull();
    expect(script?.getAttribute('language')).toBeNull();
    expect(link?.getAttribute('nonce')).toBeNull();
    for (const unsafe of adopted?.querySelectorAll('iframe:not([data-case="safe"])') ?? []) {
      expect(unsafe.getAttribute('src'), unsafe.getAttribute('data-case') ?? '').toBeNull();
      expect(unsafe.getAttribute('sandbox'), unsafe.getAttribute('data-case') ?? '').toBeNull();
    }
    const safeFrame = adopted?.querySelector('iframe[data-case="safe"]');
    expect(safeFrame?.getAttribute('src')).toBe('/safe');
    expect(safeFrame?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(meta?.getAttribute('name')).toBeNull();
    expect(meta?.getAttribute('content')).toBeNull();
    expect(meta?.getAttribute('data-safe')).toBe('kept');
  });

  it('preserves reviewed request controls and strips hidden browser capabilities during morphs', () => {
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'request-controls');
    target.setAttribute('kovo-key', 'request-controls');
    target.innerHTML = [
      '<iframe kovo-key="frame" allowfullscreen></iframe>',
      '<form kovo-key="form" target="_blank" rel="noopener noreferrer">',
      '<button kovo-key="button" formtarget="_self">Pay</button>',
      '<input kovo-key="input" formtarget="_top"></form>',
      '<a kovo-key="anchor">Anchor</a><map><area kovo-key="area"></map>',
      '<img kovo-key="img" crossorigin="anonymous">',
      '<script kovo-key="script" type="application/json"></script>',
      '<style kovo-key="style"></style>',
      '<audio kovo-key="audio" crossorigin="anonymous"></audio>',
      '<video kovo-key="video" crossorigin="use-credentials"></video>',
      '<svg><image kovo-key="svg-image" href="/reviewed.svg" crossorigin="anonymous"></image></svg>',
    ].join('');
    document.body.append(target);

    new DomMorphTarget(target).replaceWithHtml(
      [
        '<section kovo-fragment-target="request-controls" kovo-key="request-controls">',
        '<iframe kovo-key="frame" browsingtopics allowpaymentrequest sharedstoragewritable></iframe>',
        '<form kovo-key="form" target="attacker-window" rel="opener">',
        '<button kovo-key="button" formtarget="attacker-window">Pay</button>',
        '<input kovo-key="input" formtarget="attacker-window"></form>',
        '<a kovo-key="anchor" attributionsrc="https://attacker.example/register"',
        ' attributiondestination="https://attacker.example" attributionsourceid="123"',
        ' attributionsourcenonce="nonce">Anchor</a>',
        '<map><area kovo-key="area" attributionsrc="https://attacker.example/register"></map>',
        '<img kovo-key="img" crossorigin="use-credentials"',
        ' attributionsrc="https://attacker.example/register" sharedstoragewritable>',
        '<script kovo-key="script" type="module"',
        ' attributionsrc="https://attacker.example/register"></script>',
        '<style kovo-key="style" nonce="attacker"></style>',
        '<audio kovo-key="audio" crossorigin="use-credentials"></audio>',
        '<video kovo-key="video" crossorigin="anonymous"></video>',
        '<svg><image kovo-key="svg-image" href="/attacker.svg"',
        ' crossorigin="use-credentials"></image></svg>',
        '</section>',
      ].join(''),
    );

    const frame = target.querySelector('[kovo-key="frame"]');
    expect(frame?.hasAttribute('allowfullscreen')).toBe(true);
    for (const attribute of ['browsingtopics', 'allowpaymentrequest', 'sharedstoragewritable']) {
      expect(frame?.hasAttribute(attribute), attribute).toBe(false);
    }
    const form = target.querySelector('[kovo-key="form"]');
    expect(form?.getAttribute('target')).toBe('_blank');
    expect(form?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(target.querySelector('[kovo-key="button"]')?.getAttribute('formtarget')).toBe('_self');
    expect(target.querySelector('[kovo-key="input"]')?.getAttribute('formtarget')).toBe('_top');
    for (const key of ['anchor', 'area', 'img', 'script']) {
      expect(target.querySelector(`[kovo-key="${key}"]`)?.hasAttribute('attributionsrc'), key).toBe(
        false,
      );
    }
    const anchor = target.querySelector('[kovo-key="anchor"]');
    for (const attribute of [
      'attributiondestination',
      'attributionsourceid',
      'attributionsourcenonce',
    ]) {
      expect(anchor?.hasAttribute(attribute), attribute).toBe(false);
    }
    const image = target.querySelector('[kovo-key="img"]');
    expect(image?.getAttribute('crossorigin')).toBe('anonymous');
    expect(image?.hasAttribute('sharedstoragewritable')).toBe(false);
    expect(target.querySelector('[kovo-key="style"]')?.hasAttribute('nonce')).toBe(false);
    expect(target.querySelector('[kovo-key="audio"]')?.getAttribute('crossorigin')).toBe(
      'anonymous',
    );
    expect(target.querySelector('[kovo-key="video"]')?.getAttribute('crossorigin')).toBe(
      'use-credentials',
    );
    expect(target.querySelector('[kovo-key="svg-image"]')?.getAttribute('crossorigin')).toBe(
      'anonymous',
    );
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

  it('keeps the extracted inline fragment path behind the same iframe sandbox boundary', () => {
    installInlineKovoLoader(async () => ({}));
    const existing = document.createElement('section');
    existing.setAttribute('kovo-fragment-target', 'inline-iframes');
    document.body.append(existing);

    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      [
        '<kovo-fragment target="inline-iframes">',
        '<section kovo-fragment-target="inline-iframes">',
        '<iframe data-case="missing" src="/missing"></iframe>',
        '<iframe data-case="pair" src="/pair" sandbox="allow-same-origin allow-scripts"></iframe>',
        '<iframe data-case="escape" src="/escape" sandbox="allow-popups-to-escape-sandbox"></iframe>',
        '<iframe data-case="safe" src="/safe" sandbox="allow-scripts"></iframe>',
        '</section>',
        '</kovo-fragment>',
      ].join(''),
    );

    for (const unsafe of document.querySelectorAll(
      '[kovo-fragment-target="inline-iframes"] iframe:not([data-case="safe"])',
    )) {
      expect(unsafe.getAttribute('src'), unsafe.getAttribute('data-case') ?? '').toBeNull();
      expect(unsafe.getAttribute('sandbox'), unsafe.getAttribute('data-case') ?? '').toBeNull();
    }
    const safe = document.querySelector(
      '[kovo-fragment-target="inline-iframes"] iframe[data-case="safe"]',
    );
    expect(safe?.getAttribute('src')).toBe('/safe');
    expect(safe?.getAttribute('sandbox')).toBe('allow-scripts');
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

  it('inerts base and meta-refresh navigation before modular or inline fragment adoption', () => {
    const assertInert = (target: string) => {
      const base = document.querySelector(`[kovo-fragment-target="${target}"] base`);
      const meta = document.querySelector(`[kovo-fragment-target="${target}"] meta`);
      expect(base?.getAttribute('href')).toBeNull();
      expect(base?.getAttribute('target')).toBeNull();
      expect(meta?.getAttribute('content')).toBeNull();
    };
    const incoming = (target: string) =>
      [
        `<section kovo-fragment-target="${target}">`,
        '<base href="https://attacker.example/" target="_self">',
        '<meta http-equiv="ReFrEsH" content="3600; url=https://attacker.example/collect">',
        '</section>',
      ].join('');

    const modular = document.createElement('section');
    modular.setAttribute('kovo-fragment-target', 'modular-navigation');
    document.body.append(modular);
    applyHtmlResponseFragments(
      [{ html: fragmentHtml(incoming('modular-navigation')), target: 'modular-navigation' }],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );
    assertInert('modular-navigation');

    const inline = document.createElement('section');
    inline.setAttribute('kovo-fragment-target', 'inline-navigation');
    document.body.append(inline);
    installInlineKovoLoader(async () => ({}));
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      `<kovo-fragment target="inline-navigation">${incoming('inline-navigation')}</kovo-fragment>`,
    );
    assertInert('inline-navigation');
  });

  it('strips declarative Shadow DOM before modular and inline fragment adoption', () => {
    const incoming = (target: string) =>
      [
        `<section kovo-fragment-target="${target}">`,
        '<template SHADOWROOTMODE="open" shadowRootDelegatesFocus shadowrootclonable shadowrootserializable>',
        '<button id="shadow-control">hidden control</button>',
        '</template>',
        '</section>',
      ].join('');
    const assertInert = (target: string) => {
      const host = document.querySelector<HTMLElement>(`[kovo-fragment-target="${target}"]`);
      const template = host?.querySelector<HTMLTemplateElement>('template');
      expect(host?.shadowRoot).toBeNull();
      expect(template).toBeTruthy();
      for (const name of BLOCKED_DECLARATIVE_SHADOW_DOM_ATTRIBUTE_NAMES) {
        expect(template?.getAttribute(name), name).toBeNull();
      }
      expect(template?.content.querySelector('#shadow-control')?.textContent).toBe(
        'hidden control',
      );

      const replay = document.createElement('div') as HTMLDivElement & {
        setHTMLUnsafe?: (html: string) => void;
      };
      const serialized = template?.outerHTML ?? '';
      if (typeof replay.setHTMLUnsafe === 'function') replay.setHTMLUnsafe(serialized);
      else replay.innerHTML = serialized;
      expect(replay.shadowRoot).toBeNull();
    };

    const modular = document.createElement('section');
    modular.setAttribute('kovo-fragment-target', 'modular-shadow');
    document.body.append(modular);
    applyHtmlResponseFragments(
      [{ html: fragmentHtml(incoming('modular-shadow')), target: 'modular-shadow' }],
      (name) => document.querySelector(`[kovo-fragment-target="${name}"]`),
    );
    assertInert('modular-shadow');

    const inline = document.createElement('section');
    inline.setAttribute('kovo-fragment-target', 'inline-shadow');
    document.body.append(inline);
    installInlineKovoLoader(async () => ({}));
    (globalThis as unknown as { __kovo_a?: (body: string) => void }).__kovo_a?.(
      `<kovo-fragment target="inline-shadow">${incoming('inline-shadow')}</kovo-fragment>`,
    );
    assertInert('inline-shadow');
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
    for (const name of BLOCKED_ACTIVE_EMBED_ELEMENT_NAMES) {
      expect(
        __responseFragmentApplySanitizerParityForTests.isBlockedActiveEmbedElementName(name),
      ).toBe(true);
      expect(
        __responseFragmentApplySanitizerParityForTests.isBlockedActiveEmbedElementName(
          name.toUpperCase(),
        ),
      ).toBe(true);
    }
    expect(
      __responseFragmentApplySanitizerParityForTests.isBlockedActiveEmbedElementName('iframe'),
    ).toBe(false);
    for (const name of BLOCKED_DECLARATIVE_SHADOW_DOM_ATTRIBUTE_NAMES) {
      expect(
        __responseFragmentApplySanitizerParityForTests.isBlockedDeclarativeShadowDomAttributeName(
          name,
        ),
      ).toBe(true);
      expect(
        __responseFragmentApplySanitizerParityForTests.isBlockedDeclarativeShadowDomAttributeName(
          name.toUpperCase(),
        ),
      ).toBe(true);
    }
    expect(
      __responseFragmentApplySanitizerParityForTests.isBlockedDeclarativeShadowDomAttributeName(
        'slot',
      ),
    ).toBe(false);
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
