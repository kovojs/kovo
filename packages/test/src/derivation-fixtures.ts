import {
  applyPatchProgram,
  puntReasonLabel,
  type AlgebraicQueryShape,
  type DerivationStatus,
  type JsonValue,
  type OptimisticCoverage,
  type PatchProgram,
  type SymbolicEffect,
} from '@jiso/core';

// SPEC.md §10.5 / derived-optimism plan Phase 0: a single, formatting-resistant
// contract shared by the shape, effect, derivation, codegen, diagnostics, and
// property-suite slices. Every downstream test asserts these structured IRs (and
// runs `applyPatchProgram` over them), so no slice invents a local enum or pins
// generated source-string formatting.

/**
 * One end-to-end derivation contract sample: a Stage-1 `effect`, a Stage-2
 * `shape`, the Stage-3 `program` the deriver must produce, and a concrete
 * `before`/`after` client state proving the commuting diagram modulo
 * `placeholderColumns` (Opaque INSERT cols are content-matched on reconcile, so
 * they are excluded from exact equality — SPEC.md §10.5).
 */
export interface DerivationContractFixture {
  after: JsonValue;
  before: JsonValue;
  effect: SymbolicEffect;
  input: JsonValue;
  name: string;
  /** Columns of a pushed row excluded from soundness equality (tempId/now/opaque). */
  placeholderColumns: readonly string[];
  program: PatchProgram;
  query: string;
  shape: AlgebraicQueryShape;
}

const cartItemsRowset = { filters: [], key: null, orderBy: [], table: 'cart_items' } as const;
const productsRowset = {
  filters: [],
  key: 'id',
  orderBy: [{ column: 'id', direction: 'asc' }],
  table: 'products',
} as const;
const ordersRowset = { filters: [], key: 'id', orderBy: [], table: 'orders' } as const;

/**
 * Canonical contract fixtures spanning the commerce `cart/add` pairs plus the
 * §10.5 grammar rules they exercise: INSERT×SUM (scalar), UPDATE×Scalar on a
 * keyed row (guarded), INSERT×AGG (push with placeholders), and DELETE×COUNT.
 */
export const derivationContractFixtures: readonly DerivationContractFixture[] = [
  {
    after: { count: 5 },
    before: { count: 3 },
    effect: {
      op: 'insert',
      table: 'cart_items',
      values: {
        productId: { kind: 'param', path: 'productId' },
        qty: { kind: 'param', path: 'quantity' },
        unitPrice: { kind: 'opaque', expr: 'found.unitPrice' },
      },
    },
    input: { productId: 'p1', quantity: 2 },
    name: 'cart/add × cart (INSERT × SUM)',
    placeholderColumns: [],
    program: {
      ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
      query: 'cart',
    },
    query: 'cart',
    shape: {
      fields: {
        count: { arith: { kind: 'col', column: 'qty' }, kind: 'sum', rowset: cartItemsRowset },
      },
      query: 'cart',
    },
  },
  {
    after: {
      items: [
        { id: 'p1', stock: 3, unitPrice: 1499 },
        { id: 'p2', stock: 2, unitPrice: 2599 },
      ],
      nextCursor: 'p2',
    },
    before: {
      items: [
        { id: 'p1', stock: 5, unitPrice: 1499 },
        { id: 'p2', stock: 2, unitPrice: 2599 },
      ],
      nextCursor: 'p2',
    },
    effect: {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'productId' } }], kind: 'keys' },
      op: 'update',
      sets: {
        stock: {
          kind: 'arith',
          left: { kind: 'col', column: 'stock' },
          op: '-',
          right: { kind: 'param', path: 'quantity' },
        },
      },
      table: 'products',
    },
    input: { productId: 'p1', quantity: 2 },
    name: 'cart/add × productGrid (UPDATE × Scalar on keyed row, guarded)',
    placeholderColumns: [],
    program: {
      ops: [
        {
          guard: 'find-or-noop',
          match: [{ column: 'id', value: { kind: 'param', path: 'productId' } }],
          op: 'update-row',
          path: 'items',
          sets: {
            stock: {
              kind: 'arith',
              left: { kind: 'col', column: 'stock' },
              op: '-',
              right: { kind: 'param', path: 'quantity' },
            },
          },
        },
      ],
      query: 'productGrid',
    },
    query: 'productGrid',
    shape: {
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
  },
  {
    after: {
      items: [
        { id: 'o1', productId: 'p0', qty: 1, total: 100, userId: 'u9' },
        { id: '__tempId__', productId: 'p1', qty: 2, total: 0, userId: '__tempId__' },
      ],
    },
    before: { items: [{ id: 'o1', productId: 'p0', qty: 1, total: 100, userId: 'u9' }] },
    effect: {
      op: 'insert',
      table: 'orders',
      values: {
        id: { kind: 'opaque', expr: 'order-${db.orders.length + 1}' },
        productId: { kind: 'param', path: 'productId' },
        qty: { kind: 'param', path: 'quantity' },
        total: { kind: 'opaque', expr: 'found.unitPrice * quantity' },
        userId: { kind: 'opaque', expr: 'session.user.id' },
      },
    },
    input: { productId: 'p1', quantity: 2 },
    name: 'cart/add × orderHistory (INSERT × AGG push, placeholders)',
    placeholderColumns: ['id', 'total', 'userId'],
    program: {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: ['id', 'total', 'userId'],
          position: 'end',
          row: {
            id: { kind: 'placeholder', placeholder: 'tempId' },
            productId: { kind: 'param', path: 'productId' },
            qty: { kind: 'param', path: 'quantity' },
            total: { kind: 'const', value: 0 },
            userId: { kind: 'placeholder', placeholder: 'tempId' },
          },
        },
      ],
      query: 'orderHistory',
    },
    query: 'orderHistory',
    shape: {
      fields: {
        items: {
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
  },
  {
    after: { items: [{ id: 'a' }], total: 1 },
    before: { items: [{ id: 'a' }, { id: 'b' }], total: 2 },
    effect: {
      match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
      op: 'delete',
      table: 'todos',
    },
    input: { id: 'b' },
    name: 'removeTodo × todoCount (DELETE × COUNT, guarded)',
    placeholderColumns: [],
    program: {
      ops: [
        {
          guard: 'find-or-noop',
          match: [{ column: 'id', value: { kind: 'param', path: 'id' } }],
          op: 'remove-row',
          path: 'items',
        },
        { by: { kind: 'const', value: -1 }, op: 'inc', path: 'total' },
      ],
      query: 'todoCount',
    },
    query: 'todoCount',
    shape: {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id'],
          rowKey: 'id',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'todos' },
        },
        total: {
          kind: 'count',
          rowset: { filters: [], key: 'id', orderBy: [], table: 'todos' },
          witness: { columns: ['id'], rowsPath: 'items' },
        },
      },
      query: 'todoCount',
      rowsByTable: { todos: { columns: ['id'], rowsPath: 'items' } },
    },
  },
];

/**
 * Run a contract fixture's program through the reference interpreter and return
 * the result with placeholder columns of pushed rows normalized to a sentinel,
 * so callers can assert the commuting diagram modulo content-matched columns.
 */
export function applyContractFixture(fixture: DerivationContractFixture): JsonValue {
  return applyPatchProgram(fixture.before, fixture.input, fixture.program, {
    now: () => 0,
    tempId: () => '__tempId__',
  });
}

/** Formatting-resistant fact for an optimistic coverage's derivation metadata. */
export function coverageDerivationFact(coverage: OptimisticCoverage): DerivationStatus | undefined {
  return coverage.derivation;
}

/** Stable label for a derivation status (e.g. `derived` or `PUNTED (Opaque: …)`). */
export function derivationStatusLabel(status: DerivationStatus): string {
  return status.status === 'derived' ? 'derived' : `PUNTED (${puntReasonLabel(status.reason)})`;
}
