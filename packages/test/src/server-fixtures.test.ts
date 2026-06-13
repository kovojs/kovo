import { describe, expect, it } from 'vitest';
import {
  csrfField,
  csrfToken,
  domain,
  mutation,
  notFound,
  query,
  renderMutationResponse,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderRoutePageResponse,
  route,
  runMutation,
  runQuery,
  runRoutePage,
  s,
} from '@jiso/server';

import {
  serverCommerceTransactionBehaviorFact,
  serverDataPlaneBehaviorFact,
  serverMutationLifecycleBehaviorFact,
} from './server-fixtures.ts';

const mutationRuntime = {
  domain,
  mutation,
  query,
  renderMutationResponse,
  runMutation,
  s,
};

const dataPlaneRuntime = {
  ...mutationRuntime,
  csrfField,
  csrfToken,
  notFound,
  renderQueryEndpointResponse,
  renderQueryRegistryEndpointResponse,
  renderRoutePageResponse,
  route,
  runQuery,
  runRoutePage,
};

describe('@jiso/test server fixture facts', () => {
  it('projects mutation transaction and fragment behavior through public server APIs', async () => {
    await expect(serverMutationLifecycleBehaviorFact(mutationRuntime)).resolves.toEqual({
      failedTransaction: {
        events: ['begin', 'handler', 'rollback'],
        result: {
          error: {
            code: 'OUT_OF_STOCK',
            payload: { availableQuantity: 0 },
          },
          ok: false,
          status: 422,
        },
      },
      fragmentResponse: {
        body: '<fw-query name="cart" key="cart:c1">{"cartId":"c1"}</fw-query>',
        headers: {
          'Content-Type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'FW-Changes': '[{"domain":"cart"}]',
        },
        status: 200,
      },
      successfulTransaction: {
        events: ['guard:u1', 'begin:plain', 'handler:tx', 'commit'],
        result: {
          changes: [],
          ok: true,
          rerunQueries: [],
          value: 'p1',
        },
      },
    });
  });

  it('projects query, route, and CSRF data-plane behavior through public server APIs', async () => {
    const fact = await serverDataPlaneBehaviorFact(dataPlaneRuntime);

    expect(fact.query).toEqual({
      endpoint: {
        body: '<fw-query name="product:p1" version="3">{"id":"p1","max":3,"userId":"u1"}</fw-query>',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 200,
      },
      invalidInput: {
        error: {
          code: 'VALIDATION',
          payload: { issues: [{ message: 'Expected string', path: ['id'] }] },
        },
        ok: false,
        status: 422,
      },
      missingRegistryQuery: {
        body: 'Not Found',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        status: 404,
      },
      success: {
        input: { id: 'p1', max: 10 },
        ok: true,
        value: { id: 'p1', max: 10, userId: 'u1' },
      },
      unauthorized: {
        error: { code: 'UNAUTHORIZED', payload: {} },
        ok: false,
        status: 422,
      },
    });
    expect(fact.route).toEqual({
      notFound: {
        body: 'Not Found',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        status: 404,
      },
      success: {
        ok: true,
        value: 'u1:p1:details',
      },
    });
    expect(fact.csrf).toEqual({
      field: expect.stringMatching(/^<input type="hidden" name="csrf" value="[A-Za-z0-9+/=_-]+">$/),
      guardCallsAfterFailure: 1,
      guardCallsAfterSuccess: 1,
      missingToken: {
        error: { code: 'CSRF', payload: {} },
        ok: false,
        status: 422,
      },
      success: {
        changes: [],
        ok: true,
        rerunQueries: [],
        value: 'p1',
      },
    });
  });

  it('projects commerce-style transactional rollback behavior through public server APIs', async () => {
    await expect(serverCommerceTransactionBehaviorFact(mutationRuntime)).resolves.toEqual({
      failed: {
        db: {
          commits: 1,
          items: [{ productId: 'p1', qty: 2 }],
          rollbacks: 1,
        },
        result: {
          error: { code: 'OUT_OF_STOCK', payload: { availableQuantity: 5 } },
          ok: false,
          status: 422,
        },
      },
      successful: {
        db: {
          commits: 1,
          items: [{ productId: 'p1', qty: 2 }],
          rollbacks: 0,
        },
        result: {
          changes: [],
          ok: true,
          rerunQueries: [],
          value: { count: 1 },
        },
      },
    });
  });
});
