import { describe, expect, it, vi } from 'vitest';
import { trustedHtml } from '@kovojs/browser';
import { component, form } from '@kovojs/core';

import { renderComponentMutationFailure } from './component-render.js';
import { csrfToken, KOVO_IDEM_FIELD_NAME, mintCsrfField, type CsrfOptions } from './csrf.js';
import { renderedHtml } from './html.js';
import { renderMutationEndpointResponse, renderNoJsMutationResponse } from './mutation.js';
import { createMemoryMutationReplayStore } from './replay.js';
import { isBlessedRedirectResponse, serverResponseToWebResponse } from './response.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';
import { tagUntrustedRequestValue } from './untrusted-request-body.js';

function anonymousNoJsCsrfRequest(mutationKey: string): {
  csrf: CsrfOptions<Request>;
  request: Request;
  token(): string;
} {
  const csrf: CsrfOptions<Request> = {
    field: 'csrf',
    secret: 'anonymous-nojs-replay-secret-0123456789abcdef',
    sessionId: () => undefined,
  };
  const origin = 'https://nojs-replay.test';
  const minted = mintCsrfField(new Request(`${origin}/form`), {
    ...csrf,
    mutation: mutationKey,
  });
  if (!minted.setCookie) throw new Error('anonymous no-JS fixture did not mint a CSRF cookie');
  const cookie = minted.setCookie.split(';', 1)[0];
  if (!cookie) throw new Error('anonymous no-JS fixture emitted an empty CSRF cookie');
  const request = new Request(`${origin}/_m/${mutationKey}`, {
    headers: { Cookie: cookie, Origin: origin },
    method: 'POST',
  });
  return {
    csrf,
    request,
    token: () => csrfToken(request, csrf, { mutation: mutationKey }),
  };
}

describe('no-JS mutation responses', () => {
  it('renders no-JS mutation success as POST-redirect-GET', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(input) {
        return input;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        rawInput: { productId: 'p1', quantity: 1 },
        redirectTo: '/cart',
        request: {},
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/cart',
      },
      status: 303,
    });
  });

  it('renders no-JS mutation failures as a full HTML 422 page', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      request: {},
    });

    expect(response).toMatchObject({
      body: '<!doctype html><html><body><output role="alert" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></body></html>',
      headers: expect.objectContaining({
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      }),
      status: 422,
    });
  });

  it('can render no-JS failures through the same component mutation form state', async () => {
    const addToCartForm = form<
      'cart/add',
      { productId: string; quantity: number },
      { code: 'OUT_OF_STOCK'; payload: { availableQuantity: number } }
    >('cart/add');
    const AddToCartForm = component({
      mutations: { addToCart: addToCartForm },
      render: (_queries, _state, { forms }) =>
        renderedHtml(
          '<!doctype html><html><body><form>' +
            (forms.addToCart.failure?.code === 'OUT_OF_STOCK'
              ? `<output role="alert">Only ${forms.addToCart.failure.payload.availableQuantity} left.</output>`
              : '') +
            '</form></body></html>',
        ),
    });
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1) }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 3 });
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      rawInput: { productId: 'p1', quantity: 2 },
      redirectTo: '/cart',
      renderFailurePage: (failure) =>
        renderComponentMutationFailure(AddToCartForm, {}, failure, { formName: 'addToCart' }),
      request: {},
    });

    expect(response).toMatchObject({
      body: '<!doctype html><html><body><form><output role="alert">Only 3 left.</output></form></body></html>',
      headers: expect.objectContaining({
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      }),
      status: 422,
    });
  });

  it('renders no-JS mutation handler exceptions as an HTML 500 response', async () => {
    const thrown = new Error('handler unavailable');
    const onError = vi.fn();
    const request = {};
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        throw thrown;
      },
    });

    await expect(
      renderNoJsMutationResponse(addToCart, {
        onError,
        rawInput: { productId: 'p1' },
        redirectTo: '/cart',
        request,
      }),
    ).resolves.toMatchObject({
      body: 'Internal Server Error',
      headers: expect.objectContaining({
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      }),
      status: 500,
    });
    expect(onError).toHaveBeenCalledWith(thrown, {
      mutationKey: 'cart/add',
      operation: 'no-js-mutation-handler',
      request,
    });
  });

  it('exposes raw no-JS submitted values to component failure rerenders', async () => {
    const updateProfileForm = form<
      'profile/update',
      { company: string; email: string },
      { code: 'DUPLICATE_EMAIL'; payload: Record<string, never> }
    >('profile/update');
    const UpdateProfileForm = component({
      mutations: { updateProfile: updateProfileForm },
      render: (_queries, _state, { forms }) =>
        renderedHtml(
          '<!doctype html><html><body><form>' +
            `<input name="email" value="${forms.updateProfile.submitted?.email ?? ''}">` +
            `<input name="company" value="${forms.updateProfile.submitted?.company ?? ''}">` +
            (forms.updateProfile.failure?.code === 'DUPLICATE_EMAIL'
              ? '<output role="alert">Duplicate email</output>'
              : '') +
            '</form></body></html>',
        ),
    });
    const updateProfile = mutation('profile/update', {
      errors: {
        DUPLICATE_EMAIL: s.object({}),
      },
      input: s.object({ company: s.string(), email: s.string().email() }),
      handler(_input, _request, context) {
        return context.fail('DUPLICATE_EMAIL', {});
      },
    });

    const response = await renderNoJsMutationResponse(updateProfile, {
      rawInput: { company: 'Acme', email: 'taken@example.com' },
      redirectTo: '/profile',
      renderFailurePage: (failure, rawInput) =>
        renderComponentMutationFailure(UpdateProfileForm, {}, failure, {
          formName: 'updateProfile',
          submitted: rawInput,
        }),
      request: {},
    });

    expect(response.body).toBe(
      '<!doctype html><html><body><form><input name="email" value="taken@example.com"><input name="company" value="Acme"><output role="alert">Duplicate email</output></form></body></html>',
    );
    expect(response.status).toBe(422);
  });

  it('renders no-JS schema validation failures with field paths by default', async () => {
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1),
      }),
      handler(input) {
        return input;
      },
    });

    const response = await renderNoJsMutationResponse(addToCart, {
      rawInput: { productId: 'p1', quantity: 0 },
      redirectTo: '/cart',
      request: {},
    });

    expect(response).toMatchObject({
      body: '<!doctype html><html><body><output role="alert" data-error-path="quantity">Expected number &gt;= 1</output></body></html>',
      headers: expect.objectContaining({
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
      }),
      status: 422,
    });
  });

  // A2-server (SPEC §10.3:1063): duplicate no-JS form submissions with the same Kovo-Idem
  // must run the handler only once; the settled 303 is replayed on re-submit.
  it('A2: deduplicates no-JS form submissions by Kovo-Idem, running the handler only once', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });

    // Build a simple in-memory NoJsMutationReplayStore using a Map.
    const store = new Map<string, import('./mutation-wire.js').NoJsMutationResponse>();
    const noJsReplayStore: import('./mutation-wire.js').NoJsMutationReplayStore = {
      get(scope, idem) {
        return store.get(`${scope}\0${idem}`);
      },
      reserve(scope, idem) {
        const key = `${scope}\0${idem}`;
        if (store.has(key)) return undefined;
        // Use a sentinel value to mark as reserved (pending).
        const reservation: import('./mutation-wire.js').NoJsMutationReplayReservation = {
          abort() {
            store.delete(key);
          },
          commit(response) {
            store.set(key, response);
          },
        };
        // Mark slot as taken so a concurrent reserve returns undefined.
        store.set(key, { body: '', headers: {}, status: 303 });
        return reservation;
      },
    };

    const base = {
      idem: 'idem_nojs_01',
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      replayStore: noJsReplayStore,
      request: { sessionId: 's1' },
    };

    // First submit: handler runs, 303 committed.
    const first = await renderNoJsMutationResponse(addToCart, base);
    expect(first.status).toBe(303);
    expect(handlerCalls).toBe(1);

    // Second submit (same idem): handler must NOT run again; replayed 303 returned.
    const second = await renderNoJsMutationResponse(addToCart, base);
    expect(second.status).toBe(303);
    expect(handlerCalls).toBe(1);
  });

  it('M4: anonymous no-JS submissions share the CSRF-cookie replay scope and normalized fingerprint', async () => {
    const anonymous = anonymousNoJsCsrfRequest('auth/reset');
    const replayStore = createMemoryMutationReplayStore();
    let handlerCalls = 0;
    const reset = mutation('auth/reset', {
      csrf: anonymous.csrf,
      input: s.object({ email: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const rawInput = () => {
      const body = new FormData();
      body.set('csrf', anonymous.token());
      body.set(KOVO_IDEM_FIELD_NAME, 'idem_anonymous_nojs');
      body.set('email', 'person@example.test');
      return body;
    };
    const submit = () =>
      renderNoJsMutationResponse(reset, {
        rawInput: rawInput(),
        redirectTo: '/reset-sent',
        replayStore,
        request: anonymous.request,
      });

    const first = await submit();
    const replayed = await submit();
    expect(first).toEqual(replayed);
    expect(first.status).toBe(303);
    expect(isBlessedRedirectResponse(first)).toBe(true);
    expect(isBlessedRedirectResponse(replayed)).toBe(true);
    expect(serverResponseToWebResponse(first, { method: 'POST' }).headers.get('location')).toBe(
      '/reset-sent',
    );
    expect(serverResponseToWebResponse(replayed, { method: 'POST' }).headers.get('location')).toBe(
      '/reset-sent',
    );
    expect(handlerCalls).toBe(1);
  });

  // GAP4-2 (SPEC §10.3:1062-1066): csrf:false mutation with no session must still
  // dedup by Kovo-Idem using a mutation-key namespace scope.
  it('GAP4-2: csrf:false sessionless mutation deduplicates by Kovo-Idem without session', async () => {
    let handlerCalls = 0;
    const extWrite = mutation('ext/write', {
      csrf: false,
      input: s.object({ value: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });

    const store = new Map<string, import('./mutation-wire.js').NoJsMutationResponse>();
    const noJsReplayStore: import('./mutation-wire.js').NoJsMutationReplayStore = {
      get(scope, idem) {
        return store.get(`${scope}\0${idem}`);
      },
      reserve(scope, idem) {
        const key = `${scope}\0${idem}`;
        if (store.has(key)) return undefined;
        const reservation: import('./mutation-wire.js').NoJsMutationReplayReservation = {
          abort() {
            store.delete(key);
          },
          commit(response) {
            store.set(key, response);
          },
        };
        store.set(key, { body: '', headers: {}, status: 303 });
        return reservation;
      },
    };

    const base = {
      idem: 'idem_gap42',
      rawInput: { value: 'hello' },
      redirectTo: '/done',
      replayStore: noJsReplayStore,
      request: {}, // no session
    };

    const first = await renderNoJsMutationResponse(extWrite, base);
    expect(first.status).toBe(303);
    expect(handlerCalls).toBe(1);

    // Same idem, no session: must dedup and not re-run the handler.
    const second = await renderNoJsMutationResponse(extWrite, base);
    expect(second.status).toBe(303);
    expect(handlerCalls).toBe(1);
  });

  it('fails closed instead of running no-JS mutations when replay reservation is refused', async () => {
    let handlerCalls = 0;
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler(input) {
        handlerCalls += 1;
        return input;
      },
    });
    const noJsReplayStore: import('./mutation-wire.js').NoJsMutationReplayStore = {
      get() {
        return undefined;
      },
      reserve() {
        return undefined;
      },
    };

    const response = await renderNoJsMutationResponse(addToCart, {
      idem: 'idem_saturated',
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      replayStore: noJsReplayStore,
      request: { sessionId: 's1' },
    });

    expect(handlerCalls).toBe(0);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('1');
    expect(response.headers).toEqual(
      expect.objectContaining({
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
        'Content-Type': 'text/html; charset=utf-8',
        Vary: 'Cookie',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      }),
    );
    expect(response.body).toContain('data-error-code="RATE_LIMITED"');
  });

  // M1 (SPEC §10.3:1151): the atomic-reservation replay floor MUST hold for ALL mutation paths,
  // "the enhanced and no-JS mutation() lifecycle". This drives the UNIFIED endpoint
  // (`renderMutationEndpointResponse`) — not the isolated `renderNoJsMutationResponse` — with a real
  // `FormData` POST carrying the hidden `Kovo-Idem` field and the app-injected replay store, exactly
  // as the request shell does. Before the fix the store was never threaded into the no-JS branch AND
  // the idem was probed with `'Kovo-Idem' in rawInput` (always false for FormData), so two concurrent
  // submits double-executed the handler. This regression test would have observed `handlerCalls === 2`.
  it('M1: dedups concurrent no-JS submits through renderMutationEndpointResponse (FormData Kovo-Idem, handler once)', async () => {
    let handlerCalls = 0;
    const extWrite = mutation('ext/transfer', {
      input: s.object({ amount: s.string() }),
      async handler(input) {
        handlerCalls += 1;
        // Keep the first submit in-flight so the second concurrent submit must block on the
        // pending reservation and then replay it, rather than racing past it.
        await new Promise((resolve) => setTimeout(resolve, 10));
        return input;
      },
    });

    const store = createMemoryMutationReplayStore();
    const submit = () => {
      const form = new FormData();
      form.set('amount', '100');
      // The per-submit idem the no-JS form stamps in its hidden field (SPEC §10.3:1063/1065).
      form.set(KOVO_IDEM_FIELD_NAME, 'idem_nojs_endpoint_01');
      return renderMutationEndpointResponse(extWrite, {
        headers: new Headers(), // no Kovo-Fragment header -> no-JS POST-redirect-GET branch
        rawInput: form,
        redirectTo: '/done',
        replayStore: store,
        request: { sessionId: 's1' },
      });
    };

    const [first, second] = await Promise.all([submit(), submit()]);

    // Handler ran exactly once; the duplicate replayed the settled 303.
    expect(handlerCalls).toBe(1);
    expect(first.status).toBe(303);
    expect(second.status).toBe(303);
    expect(first.headers['Location']).toBe('/done');
    expect(second.headers['Location']).toBe('/done');

    // A sequential resubmit of the same idem also replays without re-running the handler.
    const third = await submit();
    expect(handlerCalls).toBe(1);
    expect(third.status).toBe(303);
  });

  it('keeps enhanced fragment and no-JS PRG replay records in separate mode scopes', async () => {
    const handler = vi.fn((input: { productId: string }) => input);
    const addToCart = mutation('cart/mode-scope', {
      input: s.object({ productId: s.string() }),
      handler,
    });
    const replayStore = createMemoryMutationReplayStore();
    const idem = 'idem_mode_scope_01';
    const enhanced = await renderMutationEndpointResponse(addToCart, {
      buildToken: 'mode-scope-build',
      headers: { 'Kovo-Fragment': 'true', 'Kovo-Idem': idem },
      rawInput: { productId: 'p1' },
      redirectTo: '/cart',
      replayStore,
      request: { sessionId: 's1' },
    });

    const form = new FormData();
    form.set('productId', 'p1');
    form.set(KOVO_IDEM_FIELD_NAME, idem);
    const noJs = await renderMutationEndpointResponse(addToCart, {
      headers: new Headers(),
      rawInput: form,
      redirectTo: '/cart',
      replayStore,
      request: { sessionId: 's1' },
    });

    expect(enhanced.status).toBe(200);
    expect(noJs.status).toBe(303);
    expect(noJs.headers['Location']).toBe('/cart');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('rejects no-JS same Kovo-Idem with a different body as a 422 conflict', async () => {
    const writes: string[] = [];
    const addContact = mutation('contacts/add', {
      input: s.object({ email: s.string() }),
      handler(input) {
        writes.push(input.email);
        return input;
      },
    });
    const replayStore = createMemoryMutationReplayStore();
    const submit = (email: string) => {
      const form = new FormData();
      form.set('email', email);
      form.set(KOVO_IDEM_FIELD_NAME, 'idem_nojs_conflict_01');
      return renderMutationEndpointResponse(addContact, {
        headers: new Headers(),
        rawInput: form,
        redirectTo: '/contacts',
        replayStore,
        request: { sessionId: 's1' },
      });
    };

    const first = await submit('silent-a@example.test');
    const second = await submit('silent-b@example.test');

    expect(first.status).toBe(303);
    expect(second.status).toBe(422);
    expect(second.body).toContain('data-error-code="IDEMPOTENCY_CONFLICT"');
    expect(writes).toEqual(['silent-a@example.test']);
  });

  it('rejects no-JS Kovo-Idem collisions when parsed FormData fields are tagged untrusted', async () => {
    const writes: string[] = [];
    const addContact = mutation('contacts/add-tagged', {
      input: s.object({ email: s.string() }),
      handler(input) {
        writes.push(input.email);
        return input;
      },
    });
    const replayStore = createMemoryMutationReplayStore();
    const submit = (email: string) => {
      const form = new FormData();
      form.set('email', email);
      form.set(KOVO_IDEM_FIELD_NAME, 'idem_nojs_tagged_conflict_01');
      return renderMutationEndpointResponse(addContact, {
        headers: new Headers(),
        rawInput: tagUntrustedRequestValue(form),
        redirectTo: '/contacts',
        replayStore,
        request: { sessionId: 's1' },
      });
    };

    const first = await submit('tagged-a@example.test');
    const second = await submit('tagged-b@example.test');

    expect(first.status).toBe(303);
    expect(second.status).toBe(422);
    expect(second.body).toContain('data-error-code="IDEMPOTENCY_CONFLICT"');
    expect(writes).toEqual(['tagged-a@example.test']);
  });
});
