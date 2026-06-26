import { describe, expect, it } from 'vitest';
import { redirect, type Redirect, type Route } from '@kovojs/core';

import { mutation, renderNoJsMutationResponse } from './mutation.js';
import { s } from './schema.js';

// SPEC §6.4:724 / §9.1: a typed `redirect('/chat/:id', { params })` value is path-typed against the
// route table (KV220) and propagates route renames. Augment the registry so `redirect()` calls in
// this file are checked against real routes, exactly as an app's generated facts would.
declare module '@kovojs/core' {
  interface RouteRegistry {
    '/chat/:id': Route<'/chat/:id', { id: string }>;
    '/chat': Route<'/chat'>;
  }
}

describe('mutation redirectTo typed redirect() value (capability-gaps §3; SPEC §9.1 PRG / §6.4)', () => {
  const createChat = mutation('chat/create', {
    csrf: false,
    input: s.object({ title: s.string() }),
    handler(input) {
      return { id: 'c-123', title: input.title };
    },
  });

  it('emits the path-typed Location from a typed redirect() value (function form, create-then-navigate)', async () => {
    // The create-then-navigate case: the new row id is known only after the handler runs, so
    // redirectTo is a function returning a typed `redirect('/chat/:id', { params })` value.
    const response = await renderNoJsMutationResponse(createChat, {
      rawInput: { title: 'Hello' },
      redirectTo: (result) => redirect('/chat/:id', { params: { id: result.value.id } }),
      request: {},
    });

    expect(response.status).toBe(303);
    expect(response.headers.Location).toBe('/chat/c-123');
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('accepts a static typed redirect() value', async () => {
    const response = await renderNoJsMutationResponse(createChat, {
      rawInput: { title: 'Hello' },
      redirectTo: redirect('/chat/:id', { params: { id: 'fixed-id' } }),
      request: {},
    });

    expect(response.headers.Location).toBe('/chat/fixed-id');
  });

  it('keeps the plain string redirectTo form working (back-compat)', async () => {
    const response = await renderNoJsMutationResponse(createChat, {
      rawInput: { title: 'Hello' },
      redirectTo: '/chat',
      request: {},
    });

    expect(response.headers.Location).toBe('/chat');
  });

  it('keeps the function-returning-string redirectTo form working (back-compat)', async () => {
    const response = await renderNoJsMutationResponse(createChat, {
      rawInput: { title: 'Hello' },
      redirectTo: (result) => `/chat/${result.value.id}`,
      request: {},
    });

    expect(response.headers.Location).toBe('/chat/c-123');
  });

  it('accepts a typed redirect() value on the mutation definition itself (path-typed at the def site)', () => {
    // A typed redirect() value is assignable to MutationDefinition.redirectTo, so the redirect
    // participates in KV220 typing / route-rename propagation at the definition site, not only the
    // wire request. NOTE: a *function* redirectTo that reads `result.value` inline on the definition
    // sees `result.value` as `unknown` — a pre-existing TS limitation (Value is inferred from
    // `handler` and cannot contextually flow to a sibling `redirectTo` callback; the legacy
    // `=> string` form has the same limit). The result-reading create-then-navigate form is
    // exercised on the wire path above, where Value is already resolved.
    const withTypedRedirect = mutation('chat/create-2', {
      csrf: false,
      input: s.object({ title: s.string() }),
      redirectTo: redirect('/chat/:id', { params: { id: 'static-id' } }),
      handler(input) {
        return { id: 'c-999', title: input.title };
      },
    });

    expect(withTypedRedirect.key).toBe('chat/create-2');
    expect(withTypedRedirect.redirectTo).toEqual({ location: '/chat/static-id', status: 303 });
  });

  it('path-types the redirect target: a wrong path or param is a compile error (KV220, real not faked)', () => {
    // These assertions are enforced by `tsc` (the @ts-expect-error directives error if the call
    // type-checks). They prove the typed redirectTo reuses redirect()'s route-table path typing.
    const valid: Redirect = redirect('/chat/:id', { params: { id: 'ok' } });
    expect(valid).toEqual({ location: '/chat/ok', status: 303 });

    const assertUnknownRoute = () => {
      // @ts-expect-error '/chat/:missing' is not a declared route in RouteRegistry.
      redirect('/chat/:missing', { params: { missing: 'x' } });
    };
    const assertMissingParam = () => {
      // @ts-expect-error '/chat/:id' requires a `params.id`.
      redirect('/chat/:id', {});
    };
    const assertWrongParamName = () => {
      // @ts-expect-error '/chat/:id' has no `slug` param.
      redirect('/chat/:id', { params: { slug: 'x' } });
    };

    expect(assertUnknownRoute).toBeTypeOf('function');
    expect(assertMissingParam).toBeTypeOf('function');
    expect(assertWrongParamName).toBeTypeOf('function');
  });
});
