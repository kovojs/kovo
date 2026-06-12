import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { deriveAppGraph } = await import('@jiso/compiler/graph');
const { deriveInvalidationRegistry, serializeInvalidationRegistry } =
  await import('@jiso/drizzle/static');
const { createCommerceGraph } = await import('../src/graph.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const sourcePath = resolve(commerceRoot, 'src/app.ts');
const graphPath = resolve(commerceRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(commerceRoot, 'src/generated/touch-graph.ts');
const source = readFileSync(sourcePath, 'utf8');
const starterCart = { count: 0 };

const lineNumberFor = (needle) => {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `commerce source contains ${needle}`);
  return source.slice(0, index).split('\n').length;
};

const formatJson = (value, indent = 0) => {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    const childIndent = ' '.repeat(indent + 2);
    return `[\n${value.map((item) => `${childIndent}${formatJson(item, indent + 2)}`).join(',\n')}\n${' '.repeat(indent)}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const childIndent = ' '.repeat(indent + 2);
    return `{\n${entries
      .map(([key, item]) => `${childIndent}${JSON.stringify(key)}: ${formatJson(item, indent + 2)}`)
      .join(',\n')}\n${' '.repeat(indent)}}`;
  }
  return JSON.stringify(value);
};

const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: `examples/commerce/src/app.ts:${lineNumberFor("request.db.write('cart_items'")}`,
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: `examples/commerce/src/app.ts:${lineNumberFor("request.db.write('orders'")}`,
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: `examples/commerce/src/app.ts:${lineNumberFor("request.db.write('products'")}`,
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'payment.webhook': {
    touches: [
      {
        domain: 'order',
        keys: 'arg:data.object.id',
        predicate: 'eq',
        site: `examples/commerce/src/app.ts:${lineNumberFor("tx.write('orders'")}`,
        via: 'orders',
      },
    ],
    reads: [],
    unresolved: [],
  },
  'order.receipt': {
    touches: [
      {
        domain: 'attachment',
        keys: 'arg:orderId',
        predicate: 'eq',
        site: `examples/commerce/src/app.ts:${lineNumberFor("request.db.write('attachments'")}`,
        via: 'attachments',
      },
    ],
    reads: [],
    unresolved: [],
  },
};

const commerceGraph = createCommerceGraph(starterCart, commerceTouchGraph);

const { graph } = deriveAppGraph({
  graph: commerceGraph,
});
const commerceInvalidationRegistry = deriveInvalidationRegistry({
  mutations: [
    { mutation: 'cart/add', touchGraphKey: 'cart.addItem' },
    { mutation: 'order/receipt', touchGraphKey: 'order.receipt' },
  ],
  queries: commerceGraph.queries,
  touchGraph: commerceTouchGraph,
});

const graphJson = `${formatJson(graph)}\n`;
const commerceInvalidationRegistrySource = serializeInvalidationRegistry(
  commerceInvalidationRegistry,
  {
    constName: 'commerceInvalidationSets',
    typeName: 'CommerceInvalidationSets',
  },
);
const touchGraphSource = `import type { CartQueryResult, CommerceDb, ProductGridResult } from '../app.js';

export const commerceTouchGraph = ${formatJson(commerceTouchGraph)} as const;

${commerceInvalidationRegistrySource}
declare module '@jiso/core' {
  interface QueryRegistry {
    cart: CartQueryResult;
    productGrid: ProductGridResult;
    orderHistory: { items: CommerceDb['orders'] };
  }

  interface InvalidationSets extends CommerceInvalidationSets {}
}
`;

if (process.argv.includes('--check')) {
  assert.equal(readFileSync(graphPath, 'utf8'), graphJson, 'generated graph.json is stale');
  assert.equal(
    readFileSync(touchGraphPath, 'utf8'),
    touchGraphSource,
    'generated touch-graph.ts is stale',
  );
} else {
  writeFileSync(graphPath, graphJson);
  writeFileSync(touchGraphPath, touchGraphSource);
}
