import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const { deriveOptimistic, serializeDerivedOptimistic } = await import('@jiso/drizzle/derive');
const ts = await import('typescript');
const { createCommerceGraph } = await import('../src/graph.js');

const scriptDir = dirname(fileURLToPath(import.meta.url));
const commerceRoot = resolve(scriptDir, '..');
const sourcePath = resolve(commerceRoot, 'src/app.ts');
const graphPath = resolve(commerceRoot, 'src/generated/graph.json');
const touchGraphPath = resolve(commerceRoot, 'src/generated/touch-graph.ts');
const optimisticPath = resolve(commerceRoot, 'src/generated/optimistic/cart-add.ts');
const source = readFileSync(sourcePath, 'utf8');
const starterCart = { count: 0 };

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

const writeReceiverName = (expression) => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'request' &&
    expression.name.text === 'db'
  ) {
    return 'request.db';
  }
  return undefined;
};

const collectCommerceWriteSites = (fileName, fileSource) => {
  const sourceFile = ts.createSourceFile(fileName, fileSource, ts.ScriptTarget.Latest, true);
  const sites = new Map();

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'write'
    ) {
      const receiver = writeReceiverName(node.expression.expression);
      const tableArg = node.arguments[0];
      if (receiver && tableArg && ts.isStringLiteralLike(tableArg)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const key = `${receiver}:${tableArg.text}`;
        const existing = sites.get(key) ?? [];
        sites.set(key, [...existing, `${fileName}:${line + 1}`]);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return sites;
};

const commerceWriteSites = collectCommerceWriteSites('examples/commerce/src/app.ts', source);

const siteFor = (receiver, table) => {
  const key = `${receiver}:${table}`;
  const sites = commerceWriteSites.get(key) ?? [];
  assert.equal(sites.length, 1, `commerce source has one structured write site for ${key}`);
  const [site] = sites;
  return site;
};

const commerceTouchGraph = {
  'cart.addItem': {
    touches: [
      {
        domain: 'cart',
        keys: null,
        site: siteFor('request.db', 'cart_items'),
        via: 'cart_items',
      },
      {
        domain: 'order',
        keys: null,
        site: siteFor('request.db', 'orders'),
        via: 'orders',
      },
      {
        domain: 'product',
        keys: 'arg:productId',
        predicate: 'eq',
        site: siteFor('request.db', 'products'),
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
        site: siteFor('tx', 'orders'),
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
        site: siteFor('request.db', 'attachments'),
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

// SPEC.md §10.5 (derived optimism): the commerce reference app declares its
// cart/add symbolic effects + query shapes the same way it declares the touch
// graph (commerce is not Drizzle-backed; the Drizzle extractor proves the same
// IR in conformance/drizzle-pin). The source-agnostic deriver turns these into
// committed transforms — deleting a hand-written transform lets derivation take
// the pair over (SPEC.md §10.4).
const param = (path) => ({ kind: 'param', path });
const productsRowset = {
  filters: [],
  key: 'id',
  orderBy: [{ column: 'id', direction: 'asc' }],
  table: 'products',
};
const ordersRowset = { filters: [], key: 'id', orderBy: [], table: 'orders' };
const cartAddEffects = [
  {
    op: 'insert',
    table: 'cart_items',
    values: {
      productId: param('productId'),
      qty: param('quantity'),
      unitPrice: { expr: 'found.unitPrice', kind: 'opaque' },
    },
  },
  {
    op: 'insert',
    table: 'orders',
    values: {
      id: { expr: 'order-${db.orders.length + 1}', kind: 'opaque' },
      productId: param('productId'),
      qty: param('quantity'),
      total: { expr: 'found.unitPrice * quantity', kind: 'opaque' },
      userId: { expr: 'session.user.id', kind: 'opaque' },
    },
  },
  {
    match: { eq: [{ column: 'id', value: param('productId') }], kind: 'keys' },
    op: 'update',
    sets: {
      stock: {
        kind: 'arith',
        left: { column: 'stock', kind: 'col' },
        op: '-',
        right: param('quantity'),
      },
    },
    table: 'products',
  },
];
const cartAddShapes = {
  cart: {
    fields: {
      count: {
        arith: { column: 'qty', kind: 'col' },
        kind: 'sum',
        rowset: { filters: [], key: null, orderBy: [], table: 'cart_items' },
      },
    },
    query: 'cart',
  },
  orderHistory: {
    fields: {
      items: {
        columnTypes: {
          id: 'string',
          productId: 'string',
          qty: 'number',
          total: 'number',
          userId: 'string',
        },
        kind: 'agg',
        projection: ['id', 'productId', 'qty', 'total', 'userId'],
        rowKey: 'id',
        rowset: ordersRowset,
      },
    },
    query: 'orderHistory',
    rowsByTable: {
      orders: { columns: ['id', 'productId', 'qty', 'total', 'userId'], rowsPath: 'items' },
    },
  },
  productGrid: {
    fields: {
      items: {
        kind: 'agg',
        projection: ['id', 'stock', 'unitPrice'],
        rowKey: 'id',
        rowset: productsRowset,
      },
      nextCursor: { kind: 'cursor', rowset: productsRowset },
    },
    query: 'productGrid',
    rowsByTable: { products: { columns: ['id', 'stock', 'unitPrice'], rowsPath: 'items' } },
  },
};
const cartAddOptimisticEntries = [];
for (const query of Object.keys(cartAddShapes)) {
  const result = deriveOptimistic(cartAddEffects, cartAddShapes[query]);
  assert.equal(result.kind, 'derived', `commerce ${query} must derive: ${JSON.stringify(result)}`);
  cartAddOptimisticEntries.push({ program: result.program, query });
}
const optimisticSource = serializeDerivedOptimistic({
  complete: true,
  constName: 'cartAddDerivedOptimistic',
  entries: cartAddOptimisticEntries,
  formImport: { name: 'addToCartForm', path: '../../app.js' },
  queue: 'cart',
});

if (process.argv.includes('--check')) {
  assert.equal(readFileSync(graphPath, 'utf8'), graphJson, 'generated graph.json is stale');
  assert.equal(
    readFileSync(touchGraphPath, 'utf8'),
    touchGraphSource,
    'generated touch-graph.ts is stale',
  );
  assert.equal(
    readFileSync(optimisticPath, 'utf8'),
    optimisticSource,
    'generated optimistic/cart-add.ts is stale',
  );
} else {
  writeFileSync(graphPath, graphJson);
  writeFileSync(touchGraphPath, touchGraphSource);
  mkdirSync(resolve(commerceRoot, 'src/generated/optimistic'), { recursive: true });
  writeFileSync(optimisticPath, optimisticSource);
}
