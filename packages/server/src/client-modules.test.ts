import { describe, expect, it, vi } from 'vitest';

import {
  computeRenderPlanFingerprint,
  createMemoryVersionedClientModuleRegistry,
  RENDER_PLAN_GRAMMAR_VERSION,
  renderVersionedClientModuleResponse,
} from './client-modules.js';

// ─── D1 + DEPLOY-3: render-plan fingerprint & never-empty token ───────────────

describe('render-plan fingerprint and grammar version (D1, DEPLOY-3)', () => {
  it('RENDER_PLAN_GRAMMAR_VERSION is a non-empty stable string', () => {
    expect(typeof RENDER_PLAN_GRAMMAR_VERSION).toBe('string');
    expect(RENDER_PLAN_GRAMMAR_VERSION.length).toBeGreaterThan(0);
  });

  it('computeRenderPlanFingerprint returns different values for different shape inputs (D1)', () => {
    const fpA = computeRenderPlanFingerprint({ cart: 'field:id,count', product: 'field:id,name' });
    const fpB = computeRenderPlanFingerprint({ cart: 'field:id,count', product: 'field:id,price' });
    expect(fpA).not.toBe(fpB);
  });

  it('computeRenderPlanFingerprint is deterministic and key-order independent', () => {
    const fp1 = computeRenderPlanFingerprint({ a: 'x', b: 'y' });
    const fp2 = computeRenderPlanFingerprint({ b: 'y', a: 'x' });
    expect(fp1).toBe(fp2);
  });

  it('buildToken() is never empty even with zero registered modules (DEPLOY-3)', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const token = registry.buildToken();
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(0);
  });

  it('two registries with identical modules but different renderPlanFingerprint produce different tokens (D1)', () => {
    const fp1 = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    const fp2 = computeRenderPlanFingerprint({ cart: 'field:id,total' });

    const registryA = createMemoryVersionedClientModuleRegistry({ renderPlanFingerprint: fp1 });
    const registryB = createMemoryVersionedClientModuleRegistry({ renderPlanFingerprint: fp2 });

    // Same module registrations in both
    for (const r of [registryA, registryB]) {
      r.put({ path: '/c/cart.client.js', source: 'export {}', version: 'v1' });
    }

    expect(registryA.buildToken()).not.toBe(registryB.buildToken());
  });

  it('setRenderPlanFingerprint changes buildToken() without re-registering modules (D1)', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    registry.put({ path: '/c/cart.client.js', source: 'export {}', version: 'v1' });

    const tokenBefore = registry.buildToken();
    const fp = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    registry.setRenderPlanFingerprint?.(fp);
    const tokenAfter = registry.buildToken();

    expect(tokenBefore).not.toBe(tokenAfter);
  });

  it('setRenderPlanFingerprint is stable — calling with the same value preserves the token', () => {
    const fp = computeRenderPlanFingerprint({ cart: 'field:id,count' });
    const registry = createMemoryVersionedClientModuleRegistry({ renderPlanFingerprint: fp });
    const token1 = registry.buildToken();
    registry.setRenderPlanFingerprint?.(fp);
    const token2 = registry.buildToken();
    expect(token1).toBe(token2);
  });
});

// ─── D1 / DEPLOY-3: module-less app stamps non-empty kovo-build meta ──────────
// (integration test — requires app-document; lives here for co-location with the registry tests)

describe('versioned client modules', () => {
  it('retains old versioned client module responses after newer deploys register', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const oldHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "old";',
      version: 'old',
    });
    const newHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "new";',
      version: 'new',
    });

    expect(oldHref).toBe('/c/__v/old/cart.client.js');
    expect(newHref).toBe('/c/__v/new/cart.client.js');
    expect(registry.resolve(oldHref)).toEqual({
      body: 'export const version = "old";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    expect(registry.resolve(newHref)).toMatchObject({
      body: 'export const version = "new";',
      status: 200,
    });
    expect(registry.resolve('/c/cart.client.js?v=old')).toMatchObject({
      body: 'export const version = "old";',
      status: 200,
    });
  });

  it('can bound retained client module versions per path', () => {
    const registry = createMemoryVersionedClientModuleRegistry({ maxVersionsPerPath: 1 });
    const oldHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "old";',
      version: 'old',
    });
    const newHref = registry.put({
      path: '/c/cart.client.js',
      source: 'export const version = "new";',
      version: 'new',
    });

    expect(registry.resolve(oldHref)).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(registry.resolve('/c/cart.client.js')).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(registry.resolve(newHref)).toMatchObject({ body: 'export const version = "new";' });
  });

  it('enumerates normalized client modules deterministically without exposing registry state', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    registry.put({
      path: 'https://kovo.local/c/z.client.js',
      source: 'export const z = true;',
      version: 'z-v1',
    });
    registry.put({
      contentType: 'application/javascript',
      path: '/c/a.client.js',
      source: 'export const a = true;',
      version: 'a-v1',
    });

    const entries = registry.entries();
    expect(entries).toEqual([
      {
        contentType: 'application/javascript',
        path: '/c/a.client.js',
        source: 'export const a = true;',
        version: 'a-v1',
      },
      {
        path: '/c/z.client.js',
        source: 'export const z = true;',
        version: 'z-v1',
      },
    ]);

    (entries[0] as { source: string }).source = 'mutated';
    expect(registry.resolve('/c/a.client.js?v=a-v1')).toMatchObject({
      body: 'export const a = true;',
    });
  });

  it('serves versioned client module requests through the immutable registry', () => {
    const registry = createMemoryVersionedClientModuleRegistry();
    const href = registry.put({
      contentType: 'text/javascript; charset=utf-8',
      path: '/c/cart.client.js',
      source: 'export const version = "build-1";',
      version: 'build-1',
    });

    expect(renderVersionedClientModuleResponse(registry, { url: href })).toEqual({
      body: 'export const version = "build-1";',
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Type': 'text/javascript; charset=utf-8',
      },
      status: 200,
    });
    expect(renderVersionedClientModuleResponse(registry, { url: '/c/cart.client.js' })).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    const onError = vi.fn();
    expect(
      renderVersionedClientModuleResponse(registry, {
        onError,
        url: '/assets/cart.client.js',
      }),
    ).toEqual({
      body: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      status: 404,
    });
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[1]).toEqual({
      operation: 'client-module',
      url: '/assets/cart.client.js',
    });
  });
});
