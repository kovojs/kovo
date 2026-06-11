import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { deriveAppGraph } from '@jiso/compiler/graph';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const sourcePath = resolve(commerceRoot, 'src/app.ts');
const graphPath = resolve(commerceRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(commerceRoot, 'src/generated/touch-graph.ts');
const source = readFileSync(sourcePath, 'utf8');

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
};

const graphDeclarations = {
  components: [
    {
      fragments: ['cart-badge'],
      name: 'CartBadge',
      queries: ['cart'],
    },
    {
      fragments: ['product-grid'],
      name: 'ProductGrid',
      queries: ['productGrid'],
    },
    {
      fragments: ['order-history'],
      name: 'OrderHistory',
      queries: ['orderHistory'],
    },
  ],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      invalidates: ['cart', 'product', 'order'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'commerceSession',
      writes: ['cart', 'product', 'order'],
    },
    {
      enctype: 'multipart/form-data',
      fileFields: ['receipt'],
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['orderId', 'receipt'],
      key: 'order/receipt',
      session: 'commerceSession',
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ],
  pages: [
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 1 verifiable cart item.',
        title: 'Jiso Commerce (1)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
      stylesheets: ['/assets/tailwind.css'],
    },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
};

const { graph } = deriveAppGraph({
  graph: {
    ...graphDeclarations,
    touchGraph: commerceTouchGraph,
  },
});

const graphJson = `${formatJson(graph)}\n`;
const touchGraphSource = `export const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: '${commerceTouchGraph['cart.addItem'].touches[0].site}',
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: '${commerceTouchGraph['cart.addItem'].touches[1].site}',
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: '${commerceTouchGraph['cart.addItem'].touches[2].site}',
        via: 'products',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;
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
