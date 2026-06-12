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
const { commerceCartPageMeta } = await import('../src/page-meta.js');

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
  endpoints: [
    {
      auth: 'verifier:stripe:v1:hmac-sha256',
      csrf: 'exempt',
      csrfJustification: 'payment/stripe webhook verifier stripe:v1:hmac-sha256',
      method: 'POST',
      name: 'payment/stripe',
      path: '/webhooks/stripe',
      writes: ['order'],
    },
    {
      auth: 'authed',
      csrf: 'checked',
      method: 'GET',
      name: 'orders/export',
      path: '/exports/orders.csv',
    },
    {
      auth: 'authed',
      csrf: 'checked',
      method: 'GET',
      name: 'attachments/download',
      path: '/attachments/:id',
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
      writes: ['attachment'],
    },
    {
      guards: ['authed'],
      inputFields: [],
      key: 'auth/sign-out',
      session: 'commerceSession',
      writes: ['auth'],
    },
  ],
  optimistic: [
    { mutation: 'cart/add', query: 'cart', status: 'hand-written' },
    { mutation: 'cart/add', query: 'productGrid', status: 'await-fragment' },
    { mutation: 'cart/add', query: 'orderHistory', status: 'await-fragment' },
  ],
  ownerDomains: [{ domain: 'attachment', owner: 'userId' }],
  pages: [
    {
      guards: ['role:admin'],
      modulepreloads: [],
      prefetch: false,
      queries: [],
      route: '/admin',
      stylesheets: ['/assets/tailwind.css'],
    },
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: commerceCartPageMeta(starterCart),
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
  scopeAudits: [
    {
      detail: 'attachment download filters id plus session user',
      domain: 'attachment',
      kind: 'query',
      name: 'attachments/download',
      scope: 'session',
      site: 'examples/commerce/src/app.ts:attachmentDownloadRoute',
    },
  ],
};

const { graph } = deriveAppGraph({
  graph: {
    ...graphDeclarations,
    touchGraph: commerceTouchGraph,
  },
});
const commerceInvalidationRegistry = deriveInvalidationRegistry({
  mutations: [
    { mutation: 'cart/add', touchGraphKey: 'cart.addItem' },
    { mutation: 'order/receipt', touchGraphKey: 'order.receipt' },
  ],
  queries: graphDeclarations.queries,
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

export const commerceTouchGraph = {
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
  'order.receipt': {
    touches: [
      {
        domain: 'attachment',
        keys: 'arg:orderId',
        predicate: 'eq',
        site: '${commerceTouchGraph['order.receipt'].touches[0].site}',
        via: 'attachments',
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
        site: '${commerceTouchGraph['payment.webhook'].touches[0].site}',
        via: 'orders',
      },
    ],
    reads: [],
    unresolved: [],
  },
} as const;

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
