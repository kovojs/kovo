/**
 * KV429 RUNTIME — stale-version 409 lifecycle tests.
 *
 * SPEC §10.3/§11.1 (KV429): when a mutation handler throws a `StaleVersionError`
 * (e.g. after a compareAndSet returns CasConflict), the mutation lifecycle must:
 *  1. Return a typed `{ ok: false, status: 409, error: { code: 'STALE_VERSION' } }`
 *     from `runMutation` — distinct from the IDEMPOTENCY_CONFLICT 409 produced by the
 *     replay-idempotency path.
 *  2. Render a HTTP 409 fragment wire response from `renderMutationResponse`, abandoning
 *     the replay reservation so the client can refetch the fresh version and retry.
 */

import { describe, expect, it } from 'vitest';

import { renderMutationResponse, runMutation, StaleVersionError } from './mutation.js';
import { s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

// ────────────────────────────────────────────────────────────────────────────────
// Helper fixtures
// ────────────────────────────────────────────────────────────────────────────────

const staleVersionMutation = mutation('products/buy', {
  input: s.object({ id: s.string(), prevVer: s.number().int() }),
  handler(_input, _request, _context) {
    // Simulate: compareAndSet returned CasConflict → throw StaleVersionError
    throw new StaleVersionError();
  },
});

const successMutation = mutation('products/view', {
  input: s.object({ id: s.string() }),
  handler() {
    return { viewed: true };
  },
});

// ────────────────────────────────────────────────────────────────────────────────
// runMutation — stale-version conflict
// ────────────────────────────────────────────────────────────────────────────────

describe('runMutation — StaleVersionError → typed 409 outcome (KV429)', () => {
  it('returns ok:false, status:409, code:STALE_VERSION when handler throws StaleVersionError', async () => {
    const result = await runMutation(staleVersionMutation, { id: 'p1', prevVer: 7 }, {});
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: 'STALE_VERSION', payload: {} },
    });
  });

  it('STALE_VERSION 409 is distinct from a normal 422 fail', async () => {
    const failMutation = mutation('products/fail', {
      input: s.object({ id: s.string() }),
      errors: { OUT_OF_STOCK: s.object({ available: s.number() }) },
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { available: 0 });
      },
    });
    const result = await runMutation(failMutation, { id: 'p1' }, {});
    expect(result).toMatchObject({ ok: false, status: 422, error: { code: 'OUT_OF_STOCK' } });
  });

  it('other errors are still rethrown (not swallowed by stale-version handler)', async () => {
    const explodingMutation = mutation('products/explode', {
      input: s.object({ id: s.string() }),
      handler() {
        throw new RangeError('unexpected db failure');
      },
    });
    await expect(runMutation(explodingMutation, { id: 'p1' }, {})).rejects.toThrow(
      'unexpected db failure',
    );
  });

  it('StaleVersionError thrown inside a transaction wrapper also produces 409', async () => {
    const txMutation = mutation('products/tx-buy', {
      input: s.object({ id: s.string(), prevVer: s.number().int() }),
      transaction(_request, run) {
        return run(_request as never);
      },
      handler() {
        throw new StaleVersionError();
      },
    });
    const result = await runMutation(txMutation, { id: 'p1', prevVer: 3 }, {});
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: { code: 'STALE_VERSION' },
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// renderMutationResponse — stale-version 409 wire response
// ────────────────────────────────────────────────────────────────────────────────

describe('renderMutationResponse — StaleVersionError → HTTP 409 fragment (KV429)', () => {
  it('returns status 409 with STALE_VERSION error fragment when handler throws StaleVersionError', async () => {
    const response = await renderMutationResponse(staleVersionMutation, {
      buildToken: 'test-build-token',
      fragment: true,
      rawInput: { id: 'p1', prevVer: 7 },
      request: {},
      targets: ['product-form'],
    });
    expect(response.status).toBe(409);
    expect(response.body).toContain('STALE_VERSION');
  });

  it('409 stale-version response is distinct from 409 replay-conflict response', async () => {
    // Replay-conflict fragment uses code "IDEMPOTENCY_CONFLICT"; stale-version uses "STALE_VERSION"
    const staleResponse = await renderMutationResponse(staleVersionMutation, {
      buildToken: 'test-build-token',
      fragment: true,
      rawInput: { id: 'p1', prevVer: 7 },
      request: {},
    });
    expect(staleResponse.status).toBe(409);
    expect(staleResponse.body).toContain('STALE_VERSION');
    expect(staleResponse.body).not.toContain('IDEMPOTENCY_CONFLICT');
  });

  it('successful mutation still returns status 200', async () => {
    const response = await renderMutationResponse(successMutation, {
      buildToken: 'test-build-token',
      fragment: true,
      rawInput: { id: 'p1' },
      request: {},
    });
    expect(response.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// StaleVersionError duck-typing
// ────────────────────────────────────────────────────────────────────────────────

describe('StaleVersionError shape', () => {
  it('has kind:StaleVersionError for cross-realm duck-typing', () => {
    const err = new StaleVersionError();
    expect(err.kind).toBe('StaleVersionError');
    expect(err.name).toBe('StaleVersionError');
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts a custom message', () => {
    const err = new StaleVersionError('custom stale message');
    expect(err.message).toBe('custom stale message');
  });

  it('has a sensible default message', () => {
    const err = new StaleVersionError();
    expect(err.message).toContain('KV429');
  });
});
