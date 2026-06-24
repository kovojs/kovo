import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { describe, expect, it } from 'vitest';

import { compileComponentModule, deriveAppGraph } from './index.js';

const kv430 = diagnosticDefinitions.KV430;

describe('compiler wire schema budget diagnostics', () => {
  it('reports KV430 lint for unbounded arrays on inbound wire schemas', () => {
    const result = compileComponentModule({
      fileName: 'src/wire.ts',
      source: `
const tagList = s.array(s.string());
const productSearch = s.object({ tags: tagList });

export const addToCart = mutation('cart/add', {
  input: s.object({ lines: s.array(s.object({ sku: s.string() })) }),
  handler(input) {
    return input;
  },
});

export const products = query('products', {
  access: publicAccess('catalog'),
  args: s.object({ tags: tagList }),
  load(input) {
    return { input };
  },
});

export const productRoute = route('/products/:id', {
  access: publicAccess('catalog'),
  params: s.object({ id: s.string(), related: s.array(s.string()) }),
  search: productSearch,
  page() {
    return null;
  },
});

export const inboundEndpoint = endpoint('/sync', {
  access: publicAccess('machine sync'),
  method: 'POST',
  reason: 'future shaped endpoint fixture',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
  input: s.object({ rows: s.array(s.string()) }),
  handler() {
    return new Response('{}');
  },
});

export const stripeHook = webhook('stripe', {
  access: publicAccess('stripe webhook'),
  path: '/webhooks/stripe',
  verify: 'none',
  verifyJustification: 'fixture',
  input: s.object({ events: s.array(s.string()) }),
  handler(input) {
    return input;
  },
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV430')).toMatchObject([
      {
        code: 'KV430',
        fileName: 'src/wire.ts',
        message: `${kv430.message} mutation="cart/add" schema="input" collection="array" requires explicit .max(...).`,
        severity: 'lint',
      },
      {
        code: 'KV430',
        fileName: 'src/wire.ts',
        message: `${kv430.message} query="products" schema="args" collection="array" requires explicit .max(...).`,
        severity: 'lint',
      },
      {
        code: 'KV430',
        fileName: 'src/wire.ts',
        message: `${kv430.message} route="/products/:id" schema="params" collection="array" requires explicit .max(...).`,
        severity: 'lint',
      },
      {
        code: 'KV430',
        fileName: 'src/wire.ts',
        message: `${kv430.message} route="/products/:id" schema="search" collection="array" requires explicit .max(...).`,
        severity: 'lint',
      },
      {
        code: 'KV430',
        fileName: 'src/wire.ts',
        message: `${kv430.message} endpoint="/sync" schema="input" collection="array" requires explicit .max(...).`,
        severity: 'lint',
      },
      {
        code: 'KV430',
        fileName: 'src/wire.ts',
        message: `${kv430.message} webhook="stripe" schema="input" collection="array" requires explicit .max(...).`,
        severity: 'lint',
      },
    ]);

    const graph = deriveAppGraph({
      components: [
        {
          componentGraphFacts: result.componentGraphFacts,
          diagnostics: result.diagnostics,
        },
      ],
    }).graph;

    expect(graph.lints?.filter((lint) => lint.code === 'KV430')).toHaveLength(6);
    expect(graph.lints?.find((lint) => lint.code === 'KV430')).toMatchObject({
      code: 'KV430',
      detail: expect.stringContaining('mutation="cart/add" schema="input"'),
      site: expect.stringMatching(/^src\/wire\.ts:\d+:\d+$/),
    });
  });

  it('accepts explicit .max bounds and leaves output/lazy schemas runtime-only', () => {
    const result = compileComponentModule({
      fileName: 'src/bounded-wire.ts',
      source: `
const boundedTags = s.array(s.string()).max(20);
const tree = s.lazy(() => s.object({ children: s.array(tree) }));
const localOnly = s.array(s.string());

export const updateTags = mutation('tags/update', {
  input: s.object({ tags: boundedTags, matrix: s.array(s.array(s.string()).max(4)).max(4) }),
  handler(input) {
    return input;
  },
});

export const treeRoute = route('/tree', {
  access: publicAccess('tree'),
  search: tree,
  page() {
    return null;
  },
});

export const reports = query('reports', {
  access: publicAccess('reports'),
  args: s.object({ page: s.string() }),
  output: s.object({ rows: localOnly }),
  load() {
    return { rows: [] };
  },
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV430')).toEqual([]);
  });

  it('reports future s.record wire schemas unless an explicit max is visible', () => {
    const result = compileComponentModule({
      fileName: 'src/records.ts',
      source: `
export const sync = mutation('sync', {
  input: s.object({
    labels: s.record(s.string()),
    bounded: s.record(s.string()).max(12),
  }),
  handler(input) {
    return input;
  },
});
`,
    });

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV430')).toMatchObject([
      {
        code: 'KV430',
        message: `${kv430.message} mutation="sync" schema="input" collection="record" requires explicit .max(...).`,
        severity: 'lint',
      },
    ]);
  });
});
