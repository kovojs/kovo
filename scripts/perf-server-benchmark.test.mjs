import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { brotliCompressSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
  MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA,
  MATCHED_SERVER_SEMANTIC_SOURCE_SCHEMA,
  matchedServerSemanticContract,
  validateMatchedServerDocument,
} from '../benchmarks/shared/server-semantic-contract.mjs';
import {
  dynamicCachePostureFindings,
  establishServerExpectation,
  responseFindings,
  runKeepAliveWindow,
  serverConditionKey,
  serverConditionPath,
  serverConditions,
} from './perf-server-benchmark.mjs';

const matchedFixture = JSON.parse(
  await readFile(new URL('../benchmarks/shared/matched-fixture.json', import.meta.url), 'utf8'),
);
const matchedCatalog = JSON.parse(
  await readFile(new URL('../benchmarks/shared/catalog.json', import.meta.url), 'utf8'),
);
const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('production server benchmark adapter', () => {
  it('declares the complete 36-condition Phase 3 matrix', () => {
    const conditions = serverConditions();
    expect(conditions).toHaveLength(36);
    expect(new Set(conditions.map((condition) => condition.key)).size).toBe(36);
    expect(
      serverConditionKey({ concurrency: 32, encoding: 'br', mode: '304', route: 'detail' }),
    ).toBe('304-detail-br-c32');
    expect(serverConditionPath({ mode: 'HIT', route: 'listing' })).toBe('/matched/l0');
    expect(serverConditionPath({ mode: 'dynamic', route: 'detail' })).toBe(
      '/matched/runtime/dynamic/product/linen-field-jacket',
    );
    expect(() => serverConditions({ modes: [] })).toThrow(/non-empty/u);
    expect(() => serverConditions({ routes: ['listing', 'listing'] })).toThrow(/duplicates/u);
  });

  it('requires Kovo dynamic documents to retain the normative private/no-store Cookie floor', () => {
    expect(
      dynamicCachePostureFindings({ cacheControl: '', framework: 'kovo', vary: 'Accept' }),
    ).toEqual(['Cache-Control private', 'Cache-Control no-store', 'Vary Cookie']);
    expect(
      dynamicCachePostureFindings({
        cacheControl: 'private, no-store',
        framework: 'kovo',
        vary: 'Accept, Cookie',
      }),
    ).toEqual([]);
    expect(
      dynamicCachePostureFindings({
        cacheControl: 'private, no-store',
        framework: 'nextjs',
        vary: 'Accept-Encoding',
      }),
    ).toEqual([]);
  });

  it('proves byte-different Kovo and Next documents against one canonical semantic contract', () => {
    for (const route of ['listing', 'detail']) {
      const kovo = validateMatchedServerDocument(matchedDocument(route, 'kovo'), { route });
      const next = validateMatchedServerDocument(matchedDocument(route, 'nextjs'), { route });
      expect(kovo).toMatchObject({
        contract: {
          schema: MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
          sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          tokenCount: expect.any(Number),
        },
        evidence: {
          sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          tokenCount: expect.any(Number),
        },
        route,
        schema: MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA,
        source: {
          files: expect.arrayContaining([
            expect.objectContaining({ path: 'benchmarks/shared/catalog.json' }),
            expect.objectContaining({ path: 'benchmarks/shared/matched-fixture.json' }),
            expect.objectContaining({ path: 'benchmarks/shared/server-semantic-contract.mjs' }),
          ]),
          schema: MATCHED_SERVER_SEMANTIC_SOURCE_SCHEMA,
          sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        },
        validated: true,
      });
      expect(kovo.contract.tokenCount).toBeGreaterThan(route === 'listing' ? 200 : 30);
      expect(kovo.contract.sha256).toBe(kovo.evidence.sha256);
      expect(next.contract).toEqual(kovo.contract);
      expect(next.evidence).toEqual(kovo.evidence);
      expect(next.source).toEqual(kovo.source);
      expect(next.identityBodySha256).not.toBe(kovo.identityBodySha256);
      expect(matchedServerSemanticContract(route).route).toBe(route);
    }
  });

  it('fails closed on shell/content substitutions and cannot source omitted facts from inert bytes', () => {
    const listing = matchedDocument('listing', 'kovo');
    expect(() =>
      validateMatchedServerDocument(
        listing.replaceAll('Canvas Weekender', 'Canvas Weekender counterfeit'),
        { route: 'listing' },
      ),
    ).toThrow(/semantic contract mismatch/u);
    expect(() =>
      validateMatchedServerDocument(listing.replace('Benchmark Supply', 'Benchmark Substitution'), {
        route: 'listing',
      }),
    ).toThrow(/semantic contract mismatch/u);

    const omittedCard = listing.replace(/<article data-test-product="p07"[\s\S]*?<\/article>/u, '');
    const spoofed = omittedCard.replace(
      '</body>',
      '<!-- <article>Market Tote</article> --><script>"Market Tote"; "A durable canvas tote"</script></body>',
    );
    expect(() => validateMatchedServerDocument(spoofed, { route: 'listing' })).toThrow(
      /expected 24 product cards, received 23/u,
    );

    const detail = matchedDocument('detail', 'nextjs');
    expect(() =>
      validateMatchedServerDocument(
        detail.replace(
          matchedCatalog[0].blurb,
          'A substituted detail description that only looks capability-matched.',
        ),
        { route: 'detail' },
      ),
    ).toThrow(/semantic contract mismatch/u);
  });

  it('rejects status, exact-header, body, and missing Kovo-Pad evidence', () => {
    const expectation = {
      body: Buffer.from('expected'),
      headers: { 'cache-control': 'public, max-age=0, must-revalidate', etag: '"v1"' },
      kovoPad: 'required-fresh',
      statusCode: 200,
    };
    const state = { kovoPads: new Set() };
    expect(
      responseFindings(
        {
          body: Buffer.from('wrong'),
          headers: { 'cache-control': 'private, no-store', etag: '"v2"' },
          statusCode: 304,
        },
        expectation,
        state,
      ),
    ).toEqual([
      'status 304 != 200',
      'cache-control "private, no-store" != "public, max-age=0, must-revalidate"',
      'etag "\\"v2\\"" != "\\"v1\\""',
      'wire body differed from primed bytes',
      'Kovo-Pad was missing from a compressed Kovo response',
    ]);
  });

  it('uses node:http keep-alive and validates every response in a timed window', async () => {
    const body = Buffer.from('matched-body');
    const server = http.createServer((_request, response) => {
      response.writeHead(200, {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Content-Length': String(body.byteLength),
        ETag: '"v1"',
      });
      response.end(body);
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, 'localhost', resolve));
    const address = server.address();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 2 });
    try {
      const result = await runKeepAliveWindow({
        agent,
        concurrency: 2,
        durationMs: 50,
        expectation: {
          body,
          headers: {
            'cache-control': 'public, max-age=0, must-revalidate',
            etag: '"v1"',
          },
          kovoPad: 'absent',
          statusCode: 200,
        },
        headers: { 'accept-encoding': 'identity' },
        origin: `http://localhost:${String(address.port)}`,
        path: '/',
      });
      expect(result).toMatchObject({ failedRequests: 0, misses: 0 });
      expect(result.requests).toBeGreaterThan(2);
      expect(result.reusedSockets).toBeGreaterThan(0);
      expect(result.statusCounts).toEqual({ 200: result.requests });
    } finally {
      agent.destroy();
    }
  });

  it('binds Brotli and conditional cells to the validated identity semantics', async () => {
    const body = Buffer.from(matchedDocument('detail', 'kovo'));
    const identityHeaders = {
      'cache-control': 'public, max-age=0, must-revalidate',
      'content-type': 'text/html; charset=utf-8',
      etag: '"kovo-detail-v1"',
      'last-modified': 'Wed, 12 Aug 2026 00:00:00 GMT',
    };
    const compressed = brotliCompressSync(body);
    const brResponses = [
      { body, headers: identityHeaders, statusCode: 200 },
      {
        body: compressed,
        headers: {
          ...identityHeaders,
          'content-encoding': 'br',
          'kovo-pad': 'a',
        },
        statusCode: 200,
      },
    ];
    const br = await establishServerExpectation({
      agent: null,
      condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'detail' },
      framework: 'kovo',
      origin: 'http://localhost:1',
      request: async () => brResponses.shift(),
    });
    expect(br.evidence).toMatchObject({
      bodySha256: br.evidence.semanticContent.identityBodySha256,
      contentEncoding: 'br',
      semanticContent: {
        contract: { sha256: br.evidence.semanticContent.evidence.sha256 },
        route: 'detail',
        validated: true,
      },
      status: 200,
    });
    expect(br.evidence.wireBodySha256).not.toBe(br.evidence.bodySha256);

    const conditionalResponses = [
      { body, headers: identityHeaders, statusCode: 200 },
      { body: Buffer.alloc(0), headers: { etag: identityHeaders.etag }, statusCode: 304 },
    ];
    const conditional = await establishServerExpectation({
      agent: null,
      condition: { concurrency: 1, encoding: 'identity', mode: '304', route: 'detail' },
      framework: 'kovo',
      origin: 'http://localhost:1',
      request: async () => conditionalResponses.shift(),
    });
    expect(conditional.evidence).toMatchObject({
      bodySha256: conditional.evidence.semanticContent.identityBodySha256,
      requestIfNoneMatch: identityHeaders.etag,
      semanticContent: {
        contract: { sha256: conditional.evidence.semanticContent.evidence.sha256 },
        route: 'detail',
        validated: true,
      },
      status: 304,
      wireBodyBytes: 0,
    });
  });

  it('preserves Next.js identity-to-Brotli evidence as unsupported without a timing expectation', async () => {
    const body = Buffer.from(matchedDocument('listing', 'nextjs'));
    const headers = {
      'cache-control': 'public, max-age=0, must-revalidate',
      'content-type': 'text/html; charset=utf-8',
      etag: '"next-listing-v1"',
      'x-nextjs-cache': 'HIT',
    };
    const requests = [];
    const result = await establishServerExpectation({
      agent: null,
      condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' },
      framework: 'nextjs',
      origin: 'http://localhost:1',
      request: async ({ headers: requestHeaders }) => {
        requests.push(requestHeaders);
        return { body, headers, reusedSocket: true, statusCode: 200 };
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]['accept-encoding']).toBe('br');
    expect(result).toMatchObject({
      expectation: null,
      requestEtag: null,
      support: {
        observedContentEncoding: null,
        reason: 'requested Brotli returned the identity representation',
        requestedContentEncoding: 'br',
        status: 'unsupported',
      },
    });
    expect(result.evidence).toMatchObject({
      bodyBytes: body.byteLength,
      contentEncoding: null,
      requestAcceptEncoding: 'br',
      selectedResponse: { bodyBytes: body.byteLength, contentEncoding: null, status: 200 },
      status: 200,
      wireBodyBytes: body.byteLength,
    });
    expect(result.evidence.bodySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.evidence.selectedResponse.bodySha256).toBe(result.evidence.bodySha256);
    expect(result.evidence.semanticContent).toMatchObject({
      contract: {
        schema: MATCHED_SERVER_SEMANTIC_CONTRACT_SCHEMA,
        sha256: result.evidence.semanticContent.evidence.sha256,
        tokenCount: result.evidence.semanticContent.evidence.tokenCount,
      },
      identityBodySha256: result.evidence.bodySha256,
      route: 'listing',
      schema: MATCHED_SERVER_SEMANTIC_EVIDENCE_SCHEMA,
      validated: true,
    });
  });

  it('does not downgrade Kovo or a non-identity encoding mismatch to unsupported', async () => {
    const body = Buffer.from(matchedDocument('listing', 'kovo'));
    const identity = {
      body,
      headers: {
        'cache-control': 'public, max-age=0, must-revalidate',
        'content-type': 'text/html',
        etag: '"v1"',
        'last-modified': 'Wed, 12 Aug 2026 00:00:00 GMT',
      },
      statusCode: 200,
    };
    const kovoResponses = [identity, identity];
    await expect(
      establishServerExpectation({
        agent: null,
        condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' },
        framework: 'kovo',
        origin: 'http://localhost:1',
        request: async () => kovoResponses.shift(),
      }),
    ).rejects.toThrow(/Content-Encoding: br/u);

    const nextResponses = [
      { ...identity, headers: { ...identity.headers, 'x-nextjs-cache': 'HIT' } },
      {
        ...identity,
        headers: { ...identity.headers, 'content-encoding': 'gzip', 'x-nextjs-cache': 'HIT' },
      },
    ];
    await expect(
      establishServerExpectation({
        agent: null,
        condition: { concurrency: 1, encoding: 'br', mode: 'HIT', route: 'listing' },
        framework: 'nextjs',
        origin: 'http://localhost:1',
        request: async () => nextResponses.shift(),
      }),
    ).rejects.toThrow(/Content-Encoding: br/u);
  });
});

function matchedDocument(route, framework) {
  const semantic = matchedFixture.serverSemantic;
  const product = matchedCatalog.find(({ slug }) => slug === semantic.detailProductSlug);
  const content =
    route === 'listing'
      ? `<main data-benchmark-destination="listing">
          <section class="hero"><h1>${text(matchedFixture.listingHeading)}</h1><p>${text(
            matchedFixture.listingDescription,
          )}</p></section>
          <section class="grid" aria-label="${attribute(semantic.productsLabel)}">
            ${matchedCatalog.map(productCard).join('\n')}
          </section>
        </main>`
      : `<main class="detail" data-benchmark-destination="detail">
          <div class="detail-media"><img src="${attribute(product.img)}" width="${attribute(
            semantic.image.width,
          )}" height="${attribute(semantic.image.height)}" loading="${attribute(
            semantic.image.detailLoading,
          )}" alt="${attribute(semantic.image.alt)}"></div>
          <section class="detail-copy">
            <h1>${text(product.name)}</h1><p>${text(product.blurb)}</p>
            <span class="price">${text(price(product.price))}</span>
            <label class="qty-row">${text(semantic.quantity.label)}
              <input type="number" min="${attribute(semantic.quantity.minimum)}" value="${attribute(
                semantic.quantity.value,
              )}">
            </label>
          </section>
        </main>`;
  const popover = framework === 'kovo' ? 'popover=""' : 'popover';
  const frameworkTail =
    framework === 'nextjs'
      ? '<script>self.__next_f=["Field goods for everyday carry","Linen Field Jacket"]</script>'
      : '';
  return `<!doctype html><html lang="en-US"><head><title>Matched server sample</title></head><body>
    <div class="shell ${framework}" data-benchmark-lane="${attribute(semantic.lane)}">
      <nav class="nav">
        <a class="brand" href="${attribute(semantic.basePath)}">${text(matchedFixture.brand)}</a>
        <button class="cart-button" type="button" aria-label="${attribute(
          matchedFixture.l0.cartLabel,
        )}" popovertarget="${attribute(semantic.shell.cartDialogId)}">${text(
          matchedFixture.l0.cartText,
        )}</button>
      </nav>
      ${content}
      <div id="${attribute(semantic.shell.cartDialogId)}" class="cart-dialog" role="dialog"
        aria-labelledby="${attribute(semantic.shell.cartTitleId)}" ${popover}>
        <header><div><h2 id="${attribute(semantic.shell.cartTitleId)}">${text(
          semantic.shell.cartTitle,
        )}</h2><p>${text(matchedFixture.l0.cartDescription)}</p></div>
          <button class="secondary-button" type="button" popovertarget="${attribute(
            semantic.shell.cartDialogId,
          )}" popovertargetaction="hide">${text(semantic.shell.closeLabel)}</button>
        </header>
        <form class="checkout" action="${attribute(semantic.basePath)}" method="${attribute(
          semantic.shell.checkoutMethod,
        )}">
          <label>${text(semantic.shell.nameLabel)}<input name="${attribute(
            semantic.shell.nameField.name,
          )}" autocomplete="${attribute(semantic.shell.nameField.autocomplete)}"></label>
          <label>${text(semantic.shell.emailLabel)}<input name="${attribute(
            semantic.shell.emailField.name,
          )}" type="${attribute(semantic.shell.emailField.type)}" autocomplete="${attribute(
            semantic.shell.emailField.autocomplete,
          )}"></label>
          <button class="primary-button" type="submit">${text(semantic.shell.submitLabel)}</button>
        </form>
      </div>
    </div>${frameworkTail}</body></html>`;
}

function productCard(product) {
  const semantic = matchedFixture.serverSemantic;
  const href = `${semantic.basePath}/product/${product.slug}`;
  return `<article data-test-product="${attribute(product.id)}" class="card">
    <a href="${attribute(href)}" aria-label="${attribute(
      `${semantic.viewLabelPrefix}${product.name}`,
    )}"><img src="${attribute(product.img)}" width="${attribute(
      semantic.image.width,
    )}" height="${attribute(semantic.image.height)}" loading="${attribute(
      semantic.image.listingLoading,
    )}" alt="${attribute(semantic.image.alt)}"></a>
    <h2>${text(product.name)}</h2><p>${text(product.blurb)}</p>
    <span class="price">${text(price(product.price))}</span>
    <div class="card-actions"><a class="secondary-button" href="${attribute(href)}">${text(
      semantic.detailsLabel,
    )}</a></div>
  </article>`;
}

function price(value) {
  return `$${value.toFixed(2)}`;
}

function text(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function attribute(value) {
  return text(value).replaceAll('"', '&quot;');
}
