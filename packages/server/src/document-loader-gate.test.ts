import { inlineKovoLoaderInstallerSource } from '@kovojs/browser/internal/inline-loader';
import { SEMANTIC_ATTRIBUTE_MANIFEST } from '@kovojs/core/internal/semantic-attributes';
import { describe, expect, it } from 'vitest';

import { renderDeferredDocument, renderDocument } from './document-core.js';
import { stylesheet } from './hints.js';

const runtimeHref = '/c/__v/0123456789abcdef/kovo-runtime.client.js';

function documentHtml(options: Parameters<typeof renderDocument>[0]): string {
  return renderDocument({ loaderRuntimeHref: runtimeHref, ...options }).html;
}

/**
 * SPEC §4.4 (the loader) + O10/D7 in `plans/good-perf.md`.
 *
 * The inline bootstrap and the deferred runtime module it imports exist to serve client surface. A
 * document with none — no islands, no handlers, no enhanced form, no query truth, no deferred
 * region, no session-dependent bfcache posture — previously still shipped 22,819 bytes of inline
 * bootstrap and then imported a 267,611-byte runtime after paint for no behaviour at all.
 */
describe('document loader emission gate (SPEC §4.4)', () => {
  it('omits the inline bootstrap for a document with no client surface', () => {
    const html = documentHtml({ body: '<main><h1>Catalog</h1><p>Static copy.</p></main>' });

    expect(html).not.toContain('installInlineKovoBootstrap');
    expect(html).not.toContain(runtimeHref);
    expect(html).toContain('<main><h1>Catalog</h1><p>Static copy.</p></main>');
  });

  it('does not treat an app-authored attribute value that mentions kovo as client surface', () => {
    // Regression: the first cut of this gate matched the bare substring `kovo`, which the
    // benchmark app trips with `data-cart-root="kovo"` — an inert app-authored value. Markers are
    // leading-space substring probes over the serialized attribute vocabulary, not an
    // attribute-position parse: the leading space rules out a bare token inside a quoted attribute
    // value, while ordinary prose containing a marker still matches and — fail-safe — keeps the
    // bootstrap.
    const html = documentHtml({
      body: '<span data-cart-root="kovo"><a href="/kovo-supply">Kovo Supply</a></span>',
    });

    expect(html).not.toContain('installInlineKovoBootstrap');
  });

  it.each([
    ['island marker', '<main kovo-c="cart">0</main>'],
    ['delegated handler', '<main><button on:click="/c/cart.client.js#add">Add</button></main>'],
    ['execution trigger', '<main><section on:visible="/c/feed.client.js#more"></section></main>'],
    ['update-plan binding', '<main><span data-bind="cart.count">0</span></main>'],
    ['enhanced form', '<form enhance data-mutation="cart/add" method="post"></form>'],
    ['deferred region', '<main><kovo-defer target="recommendations"></kovo-defer></main>'],
  ])('emits the inline bootstrap for a document carrying %s', (_label, body) => {
    const html = documentHtml({ body });

    expect(html).toContain('installInlineKovoBootstrap');
    expect(html).toContain(runtimeHref);
  });

  it('emits the inline bootstrap when the document carries query truth', () => {
    const html = documentHtml({
      body: '<main>Cart</main>',
      queries: [{ href: '/_q/cart', name: 'cart', value: { count: 1 } }],
    });

    expect(html).toContain('installInlineKovoBootstrap');
  });

  it.each([
    ['session-dependent posture', { sessionDependent: true }],
    ['a session fingerprint', { sessionFingerprint: 'abc123' }],
  ])(
    // SPEC §8/§9.3: the runtime owns the bfcache-restore decision for a credentialed document, so
    // dropping it would let a persisted restore replay another principal's rendered page.
    'emits the inline bootstrap for a document with %s',
    (_label, posture) => {
      const html = documentHtml({ body: '<main>Dashboard</main>', ...posture });

      expect(html).toContain('installInlineKovoBootstrap');
    },
  );

  it('emits the inline bootstrap for a deferred-region document', () => {
    // SPEC §8: deferred chunks are applied through the bootstrap's `__kovo_a` queue.
    const rendered = renderDeferredDocument({
      body: '<main>Shell</main>',
      chunks: [{ fragments: [{ html: '<section>Ready</section>', target: 'recommendations' }] }],
      loaderRuntimeHref: runtimeHref,
    });

    expect(rendered.body).toContain('installInlineKovoBootstrap');
  });

  it('keeps the inline bootstrap for a deferFull stylesheet it alone promotes', () => {
    // SPEC §13.1: `deferFull` ships `rel=preload` plus a `<noscript>` copy that never applies with
    // JS enabled; only the bootstrap promotes the preload to a real stylesheet.
    const html = documentHtml({
      body: '<main>Static</main>',
      hints: { stylesheets: [stylesheet({ deferFull: true, href: '/assets/app.css' })] },
    });

    expect(html).toContain('installInlineKovoBootstrap');
  });

  it('drops the bootstrap for a render-blocking stylesheet that needs no promotion', () => {
    const html = documentHtml({
      body: '<main>Static</main>',
      hints: { stylesheets: ['/assets/app.css'] },
    });

    expect(html).not.toContain('installInlineKovoBootstrap');
    expect(html).toContain('<link rel="stylesheet" href="/assets/app.css">');
  });

  it('keeps the bootstrap when structured document chrome carries client surface', () => {
    const html = documentHtml({
      body: '<main>Static</main>',
      document: { bodyEnd: ['<footer kovo-c="site-footer"></footer>'] },
    });

    expect(html).toContain('installInlineKovoBootstrap');
  });
});

/**
 * Recurrence gate for the detector's denominator. The first cut of `clientSurfaceMarkers` was a
 * hand-rolled list that missed manifest vocabulary (`data-derive`, `data-derive-attr`, `data-key`,
 * `data-plan`, `data-stream`, `data-stream-renderer`, `data-stream-state`, `data-p-…`), so a page
 * using only those was classified inert and shipped without the runtime — silently broken
 * interactivity. The detector is now derived from `SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly`
 * (`document-core.ts`), and this suite iterates the manifest itself: an attribute or prefix added
 * to the framework's closed emission vocabulary is asserted here automatically, so it cannot fall
 * out of the detector again without failing this file.
 */
describe('client-surface detector covers the closed generated-attribute manifest (SPEC §4.4)', () => {
  // The only names the detector may treat as inert. Deliberately duplicated from
  // `document-core.ts` rather than imported: widening the exclusion there without updating this
  // pin makes the coverage cases below fail.
  const browserNativeOnlyVocabulary = ['popovertarget', 'popovertargetaction'];

  const coveredAttributes = SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.attributes.filter(
    (attribute) => !browserNativeOnlyVocabulary.includes(attribute),
  );

  it.each(coveredAttributes)(
    'emits the bootstrap for a document carrying generated-only attribute `%s`',
    (attribute) => {
      const html = documentHtml({
        body: `<main><div ${attribute}="probe">Static copy.</div></main>`,
      });

      expect(html).toContain('installInlineKovoBootstrap');
      expect(html).toContain(runtimeHref);
    },
  );

  it.each([...SEMANTIC_ATTRIBUTE_MANIFEST.generatedOnly.prefixes])(
    'emits the bootstrap for a document carrying a `%s`-prefixed attribute',
    (prefix) => {
      const html = documentHtml({
        body: `<main><div ${prefix}probe="value">Static copy.</div></main>`,
      });

      expect(html).toContain('installInlineKovoBootstrap');
      expect(html).toContain(runtimeHref);
    },
  );

  it('treats browser-native popover invocation as inert, which the bootstrap ships no code for', () => {
    // SPEC §5.2.4 platform lowering: `popovertarget`/`popovertargetaction` are complete UA
    // behavior ("preserves L0 popover behavior without handler imports",
    // `loader.browser.test.ts`). The exclusion is only sound while the bootstrap carries no
    // popover fallback — pinned below against the installer source itself.
    expect(inlineKovoLoaderInstallerSource).not.toContain('showPopover');
    expect(inlineKovoLoaderInstallerSource).not.toContain('togglePopover');

    const html = documentHtml({
      body: [
        '<main><button popovertarget="cart" popovertargetaction="toggle">Cart</button>',
        '<div id="cart" popover="">Empty cart.</div></main>',
      ].join(''),
    });

    expect(html).not.toContain('installInlineKovoBootstrap');
  });

  it('keeps `command`/`commandfor` as client surface because the bootstrap owns their fallback', () => {
    // The generated installer implements the dialog-invoker fallback (`showModal`), so a
    // `commandfor` document without the bootstrap is dead in a browser without native invoker
    // support. If the fallback ever leaves the bootstrap, revisit the marker set with it.
    expect(inlineKovoLoaderInstallerSource).toContain('showModal');

    const html = documentHtml({
      body: '<main><button commandfor="details" command="show-modal">Open</button></main>',
    });

    expect(html).toContain('installInlineKovoBootstrap');
  });
});

/**
 * O12 in `plans/good-perf.md`. CSS delivery is non-executable, so it precedes the framework
 * bootstrap in the head; every executable head hint still follows it, preserving the SPEC §6.6/§8
 * browser-authority ordering.
 */
describe('document head ordering (SPEC §6.6/§8/§13.1)', () => {
  it('places the stylesheet link ahead of the inline bootstrap', () => {
    const html = documentHtml({
      body: '<main kovo-c="cart">0</main>',
      hints: { meta: [{ title: 'Cart' }], stylesheets: ['/assets/app.css'] },
    });

    const stylesheetIndex = html.indexOf('<link rel="stylesheet" href="/assets/app.css">');
    const loaderIndex = html.indexOf('installInlineKovoBootstrap');
    const titleIndex = html.indexOf('<title>');

    expect(stylesheetIndex).toBeGreaterThan(-1);
    expect(loaderIndex).toBeGreaterThan(stylesheetIndex);
    expect(titleIndex).toBeGreaterThan(loaderIndex);
    // The stylesheet must be reachable inside a typical initcwnd rather than after the bootstrap's
    // ~22.8 KB inline body.
    expect(stylesheetIndex).toBeLessThan(512);
  });

  it('keeps every executable head hint after the bootstrap', () => {
    const html = documentHtml({
      body: '<main kovo-c="cart">0</main>',
      hints: {
        bootstrapScript: '/assets/app.js',
        modulepreloads: ['/assets/cart.js'],
        stylesheets: ['/assets/app.css'],
      },
    });

    const loaderIndex = html.indexOf('installInlineKovoBootstrap');
    expect(html.indexOf('<link rel="stylesheet"')).toBeLessThan(loaderIndex);
    expect(html.indexOf('<link rel="modulepreload"')).toBeGreaterThan(loaderIndex);
    expect(html.indexOf('<script type="module" src="/assets/app.js">')).toBeGreaterThan(
      loaderIndex,
    );
  });
});
