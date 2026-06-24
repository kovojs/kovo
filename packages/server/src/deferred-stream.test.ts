import { describe, expect, it } from 'vitest';

import { cspSha256, renderContentSecurityPolicy } from './csp.js';
import { renderDeferredStream } from './deferred-stream.js';

// G1 (bugs-part3 CSP-1): the apply/cleanup scripts now carry a CSP hash attribute and
// their bodies are hashed for `response.csp`.
const applyScriptBody =
  'var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()';
const cleanupScriptBody =
  'for(var n of [...document.body.childNodes])if((n.textContent||"").includes("--kovo-boundary"))n.remove();document.currentScript.remove()';
const visibleApplyScriptBody =
  'var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--kovo-boundary"))break;n=p}var b=e.join("\\n"),a=()=>globalThis.__kovo_a?.(b),o=globalThis.IntersectionObserver&&new IntersectionObserver((r)=>{for(const x of r)if(x.isIntersecting){o.disconnect();a();break}},{rootMargin:"600px 0px"}),c=0;if(o){for(var v of ["rail:p1"]){var d=[...document.getElementsByTagName("kovo-defer")].find((x)=>x.getAttribute("target")===v);if(d){o.observe(d);c++}}}if(!c)a();s.remove()';
const applyHash = cspSha256(applyScriptBody);
const cleanupHash = cspSha256(cleanupScriptBody);
const visibleApplyHash = cspSha256(visibleApplyScriptBody);
const applyScript = `<script data-kovo-csp-hash="${applyHash}">${applyScriptBody}</script>`;
const cleanupScript = `<script data-kovo-csp-hash="${cleanupHash}">${cleanupScriptBody}</script>`;
const visibleApplyScript = `<script data-kovo-csp-hash="${visibleApplyHash}">${visibleApplyScriptBody}</script>`;

describe('deferred streams', () => {
  it('renders deferred streams with shell first and query JSON before fragments', () => {
    const result = renderDeferredStream({
      closeHtml: '</body></html>',
      chunks: [
        {
          fragments: [
            {
              html: '<section kovo-c="reviews" kovo-deps="product:p1"><article kovo-key="r1">5</article></section>',
              target: 'reviews:p1',
            },
          ],
          queries: [
            { key: 'product:p1', name: 'reviews', value: { items: [{ id: 'r1', rating: 5 }] } },
          ],
        },
      ],
      shell:
        '<!doctype html>\n<html><body><main><product-page kovo-deps="product:p1"><kovo-defer target="reviews:p1" state="pending"></kovo-defer></product-page></main>',
    });

    expect(result).toEqual({
      // SPEC §9:769: query JSON arrives before its consumer INTRA-CHUNK — the query and
      // the fragment that consumes it ship in the same boundary chunk, query first.
      body: [
        '<!doctype html>\n<html><body><main><product-page kovo-deps="product:p1"><kovo-defer target="reviews:p1" state="pending"></kovo-defer></product-page></main>',
        '--kovo-boundary',
        '<kovo-query name="reviews" key="product:p1">{"items":[{"id":"r1","rating":5}]}</kovo-query>',
        '<kovo-fragment target="reviews:p1"><section kovo-c="reviews" kovo-deps="product:p1"><article kovo-key="r1">5</article></section></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
        '</body></html>',
      ].join('\n'),
      // G1 (bugs-part3 CSP-1): the apply/cleanup script hashes are surfaced on `csp`.
      csp: { scripts: [applyHash, cleanupHash], styles: [] },
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
      status: 200,
    });
  });

  // G1 (bugs-part3 CSP-1): a strict hash-CSP built from `response.csp` must admit the
  // deferred apply/cleanup scripts, and the HTML must carry matching hash attributes.
  it('hashes the deferred apply/cleanup scripts into response.csp (G1)', () => {
    const result = renderDeferredStream({
      boundary: 'x-b',
      chunks: [{ fragments: [{ html: '<section>Ready</section>', target: 'main' }] }],
      shell: '<!doctype html><html><body><kovo-defer target="main"></kovo-defer>',
    });

    const applyBody =
      'var s=document.currentScript,n=s.previousSibling,e=[];for(;n;){var p=n.previousSibling,t=n.textContent||"";if(n.outerHTML)e.unshift(n.outerHTML);n.remove();if(t.includes("--x-b"))break;n=p}globalThis.__kovo_a?.(e.join("\\n"));s.remove()';
    const cleanupBody =
      'for(var n of [...document.body.childNodes])if((n.textContent||"").includes("--x-b"))n.remove();document.currentScript.remove()';
    const applyHashXb = cspSha256(applyBody);
    const cleanupHashXb = cspSha256(cleanupBody);

    expect(result.csp.scripts).toEqual([applyHashXb, cleanupHashXb]);
    // The HTML stamps each script with the matching hash attribute.
    expect(result.body).toContain(`data-kovo-csp-hash="${applyHashXb}"`);
    expect(result.body).toContain(`data-kovo-csp-hash="${cleanupHashXb}"`);
    // The assembled CSP script-src admits both.
    const policy = renderContentSecurityPolicy(result.csp);
    expect(policy).toContain(`'${applyHashXb}'`);
    expect(policy).toContain(`'${cleanupHashXb}'`);
  });

  it('threads a document nonce onto deferred apply and cleanup scripts', () => {
    const result = renderDeferredStream({
      cspNonce: 'doc-nonce',
      chunks: [{ fragments: [{ html: '<section>Ready</section>', target: 'main' }] }],
      shell: '<!doctype html><html><body><kovo-defer target="main"></kovo-defer>',
    });

    expect(result.csp.nonce).toBe('doc-nonce');
    expect(result.body).toContain(`<script nonce="doc-nonce" data-kovo-csp-hash="${applyHash}">`);
    expect(result.body).toContain(`<script nonce="doc-nonce" data-kovo-csp-hash="${cleanupHash}">`);
    expect(renderContentSecurityPolicy(result.csp)).toContain("'nonce-doc-nonce' 'strict-dynamic'");
  });

  it('orders deferred stream chunks by priority, queries before fragments within each chunk', () => {
    const result = renderDeferredStream({
      chunks: [
        {
          fragments: [{ html: '<section>low</section>', target: 'low' }],
          priority: 'low',
          queries: [{ name: 'lowQuery', value: { ready: true } }],
        },
        {
          fragments: [
            { html: '<section>normal</section>', target: 'normal' },
            { html: '<section>critical</section>', priority: 5, target: 'critical&details' },
          ],
          priority: 'high',
          queries: [{ name: 'criticalQuery', value: { ready: true } }],
        },
      ],
      shell: '<!doctype html><html><body><kovo-defer target="critical&details"></kovo-defer>',
    });

    expect(result.body).toBe(
      [
        '<!doctype html><html><body><kovo-defer target="critical&details"></kovo-defer>',
        // High-priority chunk first; SPEC §9:769: each chunk emits its query JSON before
        // its consuming fragments. L2-deferred-2: fragments INSIDE a chunk keep author
        // order (normal before critical) even though critical has a higher numeric
        // priority — the client applies in array order.
        '--kovo-boundary',
        '<kovo-query name="criticalQuery">{"ready":true}</kovo-query>',
        '<kovo-fragment target="normal"><section>normal</section></kovo-fragment>',
        '<kovo-fragment target="critical&amp;details" priority="5"><section>critical</section></kovo-fragment>',
        applyScript,
        // Low-priority chunk last, its own query before its fragment.
        '--kovo-boundary',
        '<kovo-query name="lowQuery">{"ready":true}</kovo-query>',
        '<kovo-fragment target="low"><section>low</section></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
        '',
      ].join('\n'),
    );
  });

  it('renders visible deferred chunks with a viewport-gated apply script', () => {
    const result = renderDeferredStream({
      chunks: [
        {
          fragments: [
            {
              html: '<aside>Rail ready</aside>',
              priority: 'visible',
              target: 'rail:p1',
            },
          ],
          priority: 'visible',
        },
      ],
      shell: '<!doctype html><html><body><kovo-defer target="rail:p1"></kovo-defer>',
    });

    expect(result.body).toBe(
      [
        '<!doctype html><html><body><kovo-defer target="rail:p1"></kovo-defer>',
        '--kovo-boundary',
        '<kovo-fragment target="rail:p1" priority="visible"><aside>Rail ready</aside></kovo-fragment>',
        visibleApplyScript,
        '--kovo-boundary--',
        cleanupScript,
        '',
      ].join('\n'),
    );
    expect(result.csp.scripts).toEqual([visibleApplyHash, cleanupHash]);
  });

  // L2-deferred-2 (bugs-part3): same-target append/replace fragments in one chunk keep
  // author order regardless of priority (rows in order, append-before-cleanup avoided).
  it('preserves author order of fragments within a chunk (L2-deferred-2)', () => {
    const result = renderDeferredStream({
      chunks: [
        {
          fragments: [
            { html: '<article kovo-key="p1">First</article>', mode: 'append', target: 'grid' },
            {
              html: '<article kovo-key="p2">Second</article>',
              mode: 'append',
              priority: 99,
              target: 'grid',
            },
            { html: '<article kovo-key="p3">Third</article>', mode: 'append', target: 'grid' },
          ],
        },
      ],
      shell: '<!doctype html><html><body><kovo-defer target="grid"></kovo-defer>',
    });

    const firstIndex = result.body.indexOf('First');
    const secondIndex = result.body.indexOf('Second');
    const thirdIndex = result.body.indexOf('Third');
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(thirdIndex);
  });

  // L2-deferred-1 (bugs-part3): a non-finite numeric priority must not poison the
  // comparator (NaN → non-transitive order). It coerces to the normal floor.
  it('treats a non-finite numeric chunk priority as the normal floor (L2-deferred-1)', () => {
    const result = renderDeferredStream({
      chunks: [
        { fragments: [{ html: '<section>nan</section>', target: 'a' }], priority: Number.NaN },
        { fragments: [{ html: '<section>high</section>', target: 'b' }], priority: 'high' },
        { fragments: [{ html: '<section>low</section>', target: 'c' }], priority: 'low' },
      ],
      shell: '<!doctype html><html><body>',
    });

    // Deterministic, transitive order: high (1) > nan→0 = normal > low (-1).
    const highIndex = result.body.indexOf('high');
    const nanIndex = result.body.indexOf('nan');
    const lowIndex = result.body.indexOf('low');
    expect(highIndex).toBeLessThan(nanIndex);
    expect(nanIndex).toBeLessThan(lowIndex);
  });

  it('renders explicit numeric deferred fragment priority hints including zero', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [{ html: '<section>normal</section>', priority: 0, target: 'normal' }],
            queries: [{ name: 'cart', value: { count: 1 } }],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><kovo-defer target="normal"></kovo-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><kovo-defer target="normal"></kovo-defer>',
        '--kovo-boundary',
        '<kovo-query name="cart">{"count":1}</kovo-query>',
        '<kovo-fragment target="normal" priority="0"><section>normal</section></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
        '',
      ].join('\n'),
    );
  });

  it('renders deferred append fragment mode for streamed pagination fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<article kovo-key="p3">Third</article>',
                mode: 'append',
                target: 'product-grid',
              },
            ],
          },
        ],
        closeHtml: '',
        shell: '<!doctype html><html><body><kovo-defer target="product-grid"></kovo-defer>',
      }).body,
    ).toBe(
      [
        '<!doctype html><html><body><kovo-defer target="product-grid"></kovo-defer>',
        '--kovo-boundary',
        '<kovo-fragment target="product-grid" mode="append"><article kovo-key="p3">Third</article></kovo-fragment>',
        applyScript,
        '--kovo-boundary--',
        cleanupScript,
        '',
      ].join('\n'),
    );
  });

  it('uses configurable boundary in inline apply and cleanup scripts (K8)', () => {
    // K8: the apply/cleanup scripts were hardcoding '--kovo-boundary' while emit markers
    // used the configurable `boundary` option. Any non-default boundary broke the apply walk.
    const result = renderDeferredStream({
      boundary: 'alt-bnd',
      chunks: [
        {
          fragments: [{ html: '<section>Hello</section>', target: 'main' }],
        },
      ],
      shell: '<!doctype html><html><body><kovo-defer target="main"></kovo-defer>',
    });

    // Apply script must reference --alt-bnd, not --kovo-boundary.
    expect(result.body).toContain('--alt-bnd');
    expect(result.body).not.toContain('--kovo-boundary');

    // Emit markers must also use the configured boundary.
    const lines = result.body.split('\n');
    expect(lines).toContain('--alt-bnd');
    expect(lines).toContain('--alt-bnd--');

    // Apply script interpolates the boundary correctly.
    expect(result.body).toContain(`t.includes("--alt-bnd")`);
    // Cleanup script interpolates the boundary correctly.
    expect(result.body).toContain(`includes("--alt-bnd")`);
  });

  // L13-1 (bugs-part4): the chunk separator is a multipart-style line `--<boundary>`.
  // Fragment content containing a line equal to `--kovo-boundary` (a newline + the literal)
  // forges a chunk boundary: the client splits on it mid-content, so the FORGED boundary
  // truncates the first fragment and the later chunk/fragment is dropped. The render must
  // pick a boundary that does NOT collide with any serialized content line so every chunk
  // stays intact.
  it('re-rolls the boundary when fragment content forges the default `--kovo-boundary` line (L13-1)', () => {
    // An attacker renders text into the first fragment that contains a standalone
    // `--kovo-boundary` line followed by a second chunk's worth of content.
    const result = renderDeferredStream({
      chunks: [
        {
          fragments: [
            {
              html: '<section target="a">before\n--kovo-boundary\nforged</section>',
              target: 'a',
            },
          ],
        },
        {
          fragments: [{ html: '<section target="b">second-chunk</section>', target: 'b' }],
        },
      ],
      shell: '<!doctype html><html><body>',
    });

    const lines = result.body.split('\n');
    // The real boundary is the first separator line after the shell (the client uses this
    // exact line to split chunks). It must NOT be the colliding default literal.
    const realSep = lines.find((line) => /^--[\w-]+$/.test(line) && !line.endsWith('--'));
    expect(realSep).toBeDefined();
    expect(realSep).not.toBe('--kovo-boundary');
    const boundary = (realSep as string).slice(2);

    // Exactly one real separator line per chunk (two chunks). The forged `--kovo-boundary`
    // inside the first fragment is inert content, NOT a chosen separator.
    const realSeparators = lines.filter((line) => line === realSep);
    expect(realSeparators).toHaveLength(2);
    // The malicious line is still present (inert), but is never the chosen separator.
    expect(result.body).toContain('--kovo-boundary');
    expect(lines.includes('--kovo-boundary') && '--kovo-boundary' !== realSep).toBe(true);

    // Client-side split simulation: splitting on the real `--<boundary>` separator yields
    // chunk segments that each retain their full fragment (the forged line stays inert).
    const segments = result.body.split(`\n${realSep}\n`);
    // The first chunk segment retains its whole forged-content fragment...
    expect(segments.some((seg) => seg.includes('forged'))).toBe(true);
    // ...and the second chunk's fragment is NOT dropped.
    expect(segments.some((seg) => seg.includes('second-chunk'))).toBe(true);
    // The apply/cleanup scripts reference the chosen boundary, not the colliding default.
    expect(result.body).toContain(`t.includes("--${boundary}")`);
  });

  // L13-1: when content does NOT collide, the default boundary is preserved so the
  // canonical wire byte layout (golden `defer-stream.http`) is unchanged.
  it('keeps the default `kovo-boundary` when no content collides (L13-1 byte-layout stability)', () => {
    const result = renderDeferredStream({
      chunks: [{ fragments: [{ html: '<section>Ready</section>', target: 'main' }] }],
      shell: '<!doctype html><html><body><kovo-defer target="main"></kovo-defer>',
    });
    const lines = result.body.split('\n');
    expect(lines).toContain('--kovo-boundary');
    expect(lines).toContain('--kovo-boundary--');
  });

  it('delivers late stylesheets with deferred fragments', () => {
    expect(
      renderDeferredStream({
        chunks: [
          {
            fragments: [
              {
                html: '<section class="reviews-card">Ready</section>',
                stylesheets: ['/assets/reviews.css', '/assets/reviews.css'],
                target: 'reviews:p1',
              },
            ],
          },
        ],
        shell: '<!doctype html><html><body><kovo-defer target="reviews:p1"></kovo-defer>',
      }).body,
    ).toContain(
      `<kovo-fragment target="reviews:p1"><link rel="stylesheet" href="/assets/reviews.css"><section class="reviews-card">Ready</section></kovo-fragment>\n${applyScript}`,
    );
  });
});
