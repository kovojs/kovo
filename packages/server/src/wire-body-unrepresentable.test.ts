import { describe, expect, it } from 'vitest';

import type { BufferedMutationWireResponse, NoJsMutationResponse } from './mutation-wire.js';
import type { QueryEndpointResponse } from './query.js';
import {
  frameworkWireBody,
  replayMutationWireBody,
  type FrameworkWireBody,
  type RoutePageResponse,
} from './response.js';

describe('framework wire response body construction', () => {
  it('keeps the runtime body value a string', () => {
    const body = frameworkWireBody('<kovo-query name="cart">{"count":1}</kovo-query>');

    expect(body).toBe('<kovo-query name="cart">{"count":1}</kovo-query>');
    expect(typeof body).toBe('string');
  });

  it('requires an audit reason for replay body rehydration', () => {
    expect(() => replayMutationWireBody('cached', { reason: '' })).toThrow(
      'requires a non-empty audit reason',
    );
    expect(replayMutationWireBody('cached', { reason: 'restore persisted mutation replay' })).toBe(
      'cached',
    );
  });
});

// SPEC §9.1/§9.4: query and mutation wire bodies are framework-owned vocabulary.
// Plain strings must not structurally satisfy those response shapes.
// @ts-expect-error Response/query wire bodies must be minted by frameworkWireBody().
const forgedWireBody: FrameworkWireBody = '<kovo-query name="cart">{"count":1}</kovo-query>';

const forgedQueryResponse = {
  // @ts-expect-error QueryEndpointResponse cannot be constructed from an arbitrary body string.
  body: '<kovo-query name="cart">{"count":1}</kovo-query>',
  headers: {},
  status: 200,
} satisfies QueryEndpointResponse;

const forgedMutationResponse = {
  // @ts-expect-error BufferedMutationWireResponse cannot be constructed from an arbitrary body string.
  body: '<kovo-fragment target="cart"></kovo-fragment>',
  headers: {},
  status: 200,
} satisfies BufferedMutationWireResponse;

const forgedNoJsMutationResponse = {
  // @ts-expect-error NoJsMutationResponse cannot be constructed from an arbitrary body string.
  body: '<!doctype html><output role="alert">failed</output>',
  headers: {},
  status: 422,
} satisfies NoJsMutationResponse;

// Raw endpoints and route/file responses are audited escape paths, not mutation/query wire bodies.
const rawEndpointEscape: Response = new Response('app-owned endpoint body');
const routeResponseEscape: RoutePageResponse = {
  body: '<main>route document</main>',
  headers: {},
  status: 200,
};

void forgedWireBody;
void forgedQueryResponse;
void forgedMutationResponse;
void forgedNoJsMutationResponse;
void rawEndpointEscape;
void routeResponseEscape;
