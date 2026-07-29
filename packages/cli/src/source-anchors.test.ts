import { describe, expect, it } from 'vitest';

import { snapshotBuildCompilerSourceAnchorsForTests } from './commands/build-export.js';

describe('build graph compiler source anchors', () => {
  it('retains exact query, mutation, endpoint, component, and route declaration ranges', () => {
    const source = `
import { component } from '@kovojs/core';
import { endpoint, mutation, query, route } from '@kovojs/server';
import { webhook } from '@kovojs/server/webhooks';

export const cartQuery = query('cart', {
  load: () => ({ count: 0 }),
  reads: [],
});

export const addToCart = mutation('cart/add', {
  handler() {
    return null;
  },
});

export const health = endpoint('/health', {
  handler() {
    return null;
  },
});

export const inbound = webhook('/inbound', {
  handler() {
    return null;
  },
});

export const CartBadge = component({
  queries: { cart: cartQuery },
  render: ({ cart }) => <strong>{cart.count}</strong>,
});

export const home = route('/', {
  page: () => <CartBadge />,
});
`;
    const snapshot = snapshotBuildCompilerSourceAnchorsForTests(
      [{ fileName: 'app.tsx', source }],
      [
        { kind: 'query', name: 'cart' },
        { kind: 'mutation', name: 'cart/add' },
        { kind: 'endpoint', name: '/health' },
        { kind: 'webhook', name: '/inbound' },
        { kind: 'page', name: '/' },
      ],
    );

    expect(
      snapshot.declarations.map((anchor) =>
        anchor === undefined ? undefined : source.slice(anchor.start, anchor.end),
      ),
    ).toEqual([
      expect.stringContaining("query('cart'"),
      expect.stringContaining("mutation('cart/add'"),
      expect.stringContaining("endpoint('/health'"),
      expect.stringContaining("webhook('/inbound'"),
      expect.stringContaining("route('/'"),
    ]);
    expect(snapshot.components).toHaveLength(1);
    expect(snapshot.components[0]?.source?.file).toBe('app.tsx');
    expect(
      source.slice(snapshot.components[0]?.source?.start, snapshot.components[0]?.source?.end),
    ).toContain('CartBadge = component(');
    expect(snapshot.routes).toHaveLength(1);
    expect(snapshot.routes[0]?.source).toEqual(snapshot.declarations[4]);
  });
});
