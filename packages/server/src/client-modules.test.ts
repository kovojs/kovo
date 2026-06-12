import { describe, expect, it, vi } from 'vitest';

import {
  createMemoryVersionedClientModuleRegistry,
  renderVersionedClientModuleResponse,
} from './client-modules.js';

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

    expect(oldHref).toBe('/c/cart.client.js?v=old');
    expect(newHref).toBe('/c/cart.client.js?v=new');
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
