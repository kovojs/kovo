import { describe, expect, it, vi } from 'vitest';
import { planFrameworkTargetRequestHeaders } from '@kovojs/core/internal/wire-input-grammar';

import {
  createDocumentLifecycleRecovery,
  type DocumentLifecycleRecoveryOptions,
} from './document-lifecycle.js';
import { readExactTypedQueryResponseElement } from './wire-response-scanner.js';

function recoveryOptions(overrides: Partial<DocumentLifecycleRecoveryOptions> = {}) {
  const applied: Array<{ body: string; build?: string }> = [];
  const reload = vi.fn(() => true);
  const nextDocument = {} as Document;
  const nextTarget = {} as Element;
  const options: DocumentLifecycleRecoveryOptions = {
    acceptHeader: 'text/html',
    addLifecycleEventListener: () => true,
    applyBody: (body, build) => applied.push(build === undefined ? { body } : { body, build }),
    buildHeader: () => 'build-old',
    canonicalRequestUrl: (value) => value,
    currentBuild: (root) => (root === nextDocument ? 'build-old' : 'build-old'),
    currentHref: () => 'https://kovo.test/account',
    discardResponseBody: () => undefined,
    document: {} as Document,
    encodeAttribute: (value) => value,
    fetchValue: async () => ({ status: 200 }),
    findTarget: () => nextTarget,
    liveTargets: () => [{ target: 'account', wireEntry: 'account#account@token:{}' }],
    parseHtmlDocument: () => nextDocument,
    planTargetRequestHeaders: planFrameworkTargetRequestHeaders,
    queryAll: () => [],
    queryOne: () => null,
    queryUrl: () => '',
    readAttribute: () => null,
    readDomAttribute: () => null,
    rememberQueryHref: () => undefined,
    readElementAttribute: () => ({ present: false }),
    readPageTransitionPersisted: () => false,
    responseContentType: () => 'text/html; charset=utf-8',
    responseAllowsInlineBody: () => true,
    responseIsBuildSkew: () => false,
    responseUrlIsExact: () => true,
    readResponseStatus: () => 200,
    readResponseText: async () => '<html><body>next</body></html>',
    reload,
    snapshotElementHtml: () => '<section kovo-fragment-target="account">next</section>',
    targetHeader: () => [],
    typedReadBodyIsExact: (body, identity) =>
      readExactTypedQueryResponseElement(body, identity) !== undefined,
    wireKey: () => undefined,
    ...overrides,
  };
  return { applied, nextDocument, options, reload };
}

async function refresh(options: DocumentLifecycleRecoveryOptions): Promise<void> {
  createDocumentLifecycleRecovery(options).refreshLiveTargets();
  await vi.waitFor(() => expect(options.fetchValue).toHaveBeenCalledOnce());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('document lifecycle build proof (SPEC §9.1.1/§14)', () => {
  it('rejects invalid direct and injected query identities before URL construction', () => {
    const queryUrl = vi.fn(() => '/_q/unsafe');
    const { options, reload } = recoveryOptions({
      queryUrl,
      wireKey: () => ({ key: '', name: 'cart' }),
    });
    const lifecycle = createDocumentLifecycleRecovery(options);

    lifecycle.refreshQuery('');
    lifecycle.refreshQuery('\ud800');
    lifecycle.rememberQueryChunk({ attrs: ' name="cart" key=""' });

    expect(queryUrl).not.toHaveBeenCalled();
    // The first malformed identity starts one terminal recovery. Later calls in the stale realm
    // are inert even when navigation is delayed.
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads before reading an attachment live-target response', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const readResponseText = vi.fn(
      async () => '<kovo-fragment target="account">BAD</kovo-fragment>',
    );
    const { applied, options, reload } = recoveryOptions({
      fetchValue,
      readResponseText,
      responseAllowsInlineBody: () => false,
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(readResponseText).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it('reloads before reading an attachment query-refresh response', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const readResponseText = vi.fn(async () => '<kovo-query name="cart">{}</kovo-query>');
    const { applied, options, reload } = recoveryOptions({
      fetchValue,
      queryUrl: () => '/_q/cart',
      readResponseText,
      responseAllowsInlineBody: () => false,
    });

    createDocumentLifecycleRecovery(options).refreshQuery('cart');
    await vi.waitFor(() => expect(fetchValue).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(reload).toHaveBeenCalledOnce();
    expect(readResponseText).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it('rejects a typed-read body that mixes its requested query with fragment or text authority', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, options, reload } = recoveryOptions({
      fetchValue,
      queryUrl: () => '/_q/cart',
      readResponseText: async () =>
        '<kovo-query name="cart">{"count":2}</kovo-query>' +
        '<kovo-fragment target="admin">BAD</kovo-fragment>' +
        '<kovo-text target="log">BAD</kovo-text>',
    });

    createDocumentLifecycleRecovery(options).refreshQuery('cart');
    await vi.waitFor(() => expect(fetchValue).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

    expect(applied).toEqual([]);
  });

  it('rejects a delta on the full typed-read recovery surface', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, options, reload } = recoveryOptions({
      fetchValue,
      queryUrl: () => '/_q/cart',
      readResponseText: async () =>
        '<kovo-query name="cart" delta>{"set":{"count":2}}</kovo-query>',
    });

    createDocumentLifecycleRecovery(options).refreshQuery('cart');
    await vi.waitFor(() => expect(fetchValue).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

    expect(applied).toEqual([]);
  });

  it('rejects a mixed multi-query pass atomically before applying an earlier valid body', async () => {
    const fetchValue = vi.fn(async (url: string) => ({ status: 200, url }));
    const { applied, options, reload } = recoveryOptions({
      fetchValue,
      liveTargets: () => [],
      queryUrl: (identity) => `https://kovo.test/_q/${identity.name}`,
      readAttribute: (attrs, name) => {
        const match = new RegExp(`${name}="([^"]*)"`, 'u').exec(attrs);
        return match?.[1] ?? null;
      },
      readResponseText: async (response) => {
        const url = (response as { url: string }).url;
        return url.endsWith('/cart')
          ? '<kovo-query name="cart">{"count":2}</kovo-query>'
          : '<kovo-query name="private">{"secret":true}</kovo-query>' +
              '<kovo-query name="foreign">{"secret":true}</kovo-query>';
      },
      responseUrlIsExact: (response, expected) => (response as { url: string }).url === expected,
      wireKey: (name, key) => (name ? (key ? { key, name } : { name }) : undefined),
    });
    const lifecycle = createDocumentLifecycleRecovery(options);
    lifecycle.rememberQueryChunk({ attrs: ' name="cart" href="/_q/cart"' });
    lifecycle.rememberQueryChunk({ attrs: ' name="private" href="/_q/private"' });

    lifecycle.visibleReturnRefresh();
    await vi.waitFor(() => expect(fetchValue).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());

    expect(applied).toEqual([]);
  });

  it('stamps query refresh and reloads on a 409 build mismatch before reading the body', async () => {
    const fetchValue = vi.fn(async () => ({ status: 409 }));
    const readResponseText = vi.fn(async () => '<kovo-query name="cart">{}</kovo-query>');
    const { applied, options, reload } = recoveryOptions({
      buildHeader: () => 'build-new',
      fetchValue,
      queryUrl: () => '/_q/cart',
      readResponseStatus: () => 409,
      readResponseText,
    });

    createDocumentLifecycleRecovery(options).refreshQuery('cart');
    await vi.waitFor(() => expect(fetchValue).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchValue).toHaveBeenCalledWith('/_q/cart', {
      cache: 'no-store',
      headers: {
        Accept: 'text/html',
        'Kovo-Build': 'build-old',
        'Kovo-Fragment': 'true',
      },
      method: 'GET',
      redirect: 'error',
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(readResponseText).not.toHaveBeenCalled();
    expect(applied).toEqual([]);
  });

  it('reloads instead of stamping the active build onto wire bytes with no response proof', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, options, reload } = recoveryOptions({
      buildHeader: () => '',
      fetchValue,
      responseContentType: () => 'text/vnd.kovo.fragment+html; charset=utf-8',
      readResponseText: async () => '<kovo-fragment target="account">NEW-BUILD</kovo-fragment>',
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
  });

  it('requires the response header and fetched document meta to agree with the pinned page', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, nextDocument, options, reload } = recoveryOptions({
      currentBuild: (root) => (root === nextDocument ? 'build-new' : 'build-old'),
      fetchValue,
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
  });

  it('treats a full document containing protocol tags as a document, not a wire body', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, nextDocument, options, reload } = recoveryOptions({
      currentBuild: (root) => (root === nextDocument ? 'build-new' : 'build-old'),
      fetchValue,
      readResponseText: async () =>
        '<!doctype html><html><head><meta name="kovo-build" content="build-new"></head>' +
        '<body><kovo-fragment target="deferred">NEW BUILD</kovo-fragment></body></html>',
      responseContentType: () => 'text/html; charset=utf-8',
    });

    await refresh(options);

    expect(reload).toHaveBeenCalledOnce();
    expect(applied).toEqual([]);
  });

  it('applies a reconstructed target only under matching header, document, and page proof', async () => {
    const fetchValue = vi.fn(async () => ({ status: 200 }));
    const { applied, options, reload } = recoveryOptions({ fetchValue });

    await refresh(options);

    expect(reload).not.toHaveBeenCalled();
    expect(fetchValue).toHaveBeenCalledWith('https://kovo.test/account', {
      cache: 'no-store',
      headers: {
        Accept: 'text/html',
        'Kovo-Build': 'build-old',
        'Kovo-Current-Url': 'https://kovo.test/account',
        'Kovo-Fragment': 'true',
        'Kovo-Live-Targets': 'account#account@token:{}',
      },
      method: 'GET',
      redirect: 'error',
      referrerPolicy: 'origin',
    });
    expect(applied).toEqual([
      {
        body: '<kovo-fragment target="account"><section kovo-fragment-target="account">next</section></kovo-fragment>',
        build: 'build-old',
      },
    ]);
  });

  it('batches visible-return queries and blocks a delayed live-target apply after auth denial', async () => {
    let releaseLive: ((value: object) => void) | undefined;
    const liveResponse = new Promise<object>((resolve) => {
      releaseLive = resolve;
    });
    const fetchValue = vi.fn((url: string) => {
      if (url === 'https://kovo.test/account') return liveResponse;
      if (url.endsWith('/_q/cart')) {
        return Promise.resolve({
          build: 'build-old',
          contentType: 'text/html',
          redirected: false,
          status: 200,
          text: '<kovo-query name="cart">{"private":true}</kovo-query>',
          url,
        });
      }
      return Promise.resolve({
        build: 'build-old',
        contentType: 'text/html',
        redirected: false,
        status: 403,
        text: '<main>signed out</main>',
        url,
      });
    });
    const { applied, options, reload } = recoveryOptions({
      buildHeader: (response) => (response as { build?: string }).build ?? '',
      fetchValue,
      queryUrl: (identity) => `https://kovo.test/_q/${identity.name}`,
      readAttribute: (attrs, name) => {
        const match = new RegExp(`${name}="([^"]*)"`, 'u').exec(attrs);
        return match?.[1] ?? null;
      },
      readResponseStatus: (response) => (response as { status: number }).status,
      readResponseText: async (response) => (response as { text: string }).text,
      responseContentType: (response) =>
        (response as { contentType?: string }).contentType ?? 'text/vnd.kovo.fragment+html',
      responseUrlIsExact: (response, expected) =>
        (response as { redirected?: boolean; url?: string }).redirected === false &&
        (response as { url?: string }).url === expected,
      wireKey: (name, key) => (name ? (key ? { key, name } : { name }) : undefined),
    });
    const lifecycle = createDocumentLifecycleRecovery(options);
    lifecycle.rememberQueryChunk({ attrs: ' name="cart" href="/_q/cart"' });
    lifecycle.rememberQueryChunk({ attrs: ' name="private" href="/_q/private"' });

    lifecycle.visibleReturnRefresh();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    releaseLive?.({
      build: 'build-old',
      contentType: 'text/vnd.kovo.fragment+html',
      redirected: false,
      status: 200,
      text: '<kovo-fragment target="account">STALE</kovo-fragment>',
      url: 'https://kovo.test/account',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(applied).toEqual([]);
    expect(fetchValue).toHaveBeenCalledTimes(3);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('blocks a delayed query batch when the same visible pass rejects live-target media', async () => {
    let releaseQuery: ((value: object) => void) | undefined;
    const queryResponse = new Promise<object>((resolve) => {
      releaseQuery = resolve;
    });
    const fetchValue = vi.fn((url: string) =>
      url.endsWith('/_q/cart')
        ? queryResponse
        : Promise.resolve({
            build: 'build-old',
            contentType: 'text/plain',
            redirected: false,
            status: 200,
            text: 'not wire',
            url,
          }),
    );
    const { applied, options, reload } = recoveryOptions({
      buildHeader: (response) => (response as { build?: string }).build ?? '',
      fetchValue,
      queryUrl: (identity) => `https://kovo.test/_q/${identity.name}`,
      readAttribute: (attrs, name) => {
        const match = new RegExp(`${name}="([^"]*)"`, 'u').exec(attrs);
        return match?.[1] ?? null;
      },
      readResponseStatus: (response) => (response as { status: number }).status,
      readResponseText: async (response) => (response as { text: string }).text,
      responseContentType: (response) => (response as { contentType: string }).contentType,
      responseUrlIsExact: (response, expected) =>
        (response as { redirected?: boolean; url?: string }).redirected === false &&
        (response as { url?: string }).url === expected,
      wireKey: (name, key) => (name ? (key ? { key, name } : { name }) : undefined),
    });
    const lifecycle = createDocumentLifecycleRecovery(options);
    lifecycle.rememberQueryChunk({ attrs: ' name="cart" href="/_q/cart"' });

    lifecycle.visibleReturnRefresh();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    releaseQuery?.({
      build: 'build-old',
      contentType: 'text/html',
      redirected: false,
      status: 200,
      text: '<kovo-query name="cart">{"private":true}</kovo-query>',
      url: 'https://kovo.test/_q/cart',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(applied).toEqual([]);
    expect(fetchValue).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();
  });
});
