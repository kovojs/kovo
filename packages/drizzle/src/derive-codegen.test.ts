import type {
  AlgebraicQueryShape,
  PatchProgram,
  SymbolicEffect,
} from '@kovojs/core/internal/derivation';
import { describe, expect, it } from 'vitest';

import { deriveOptimistic } from './derive.js';
import {
  lowerTransform,
  serializeCoreRegistryModule,
  serializeDerivedOptimistic,
} from './derive-codegen.js';

// SPEC.md §10.4 Phase 3 — the generated module is committed, reviewable, and
// overridable. These tests pin the DO-NOT-EDIT header, the `satisfies
// OptimisticFor` resolution, override precedence, and the lowered transform body.

const cartProgram: PatchProgram = {
  ops: [{ by: { kind: 'param', path: 'quantity' }, op: 'inc', path: 'count' }],
  query: 'cart',
};

const pushProgram: PatchProgram = {
  ops: [
    {
      op: 'push-row',
      path: 'items',
      placeholderColumns: ['id', 'total'],
      position: 'end',
      row: {
        id: { kind: 'placeholder', placeholder: 'tempId' },
        productId: { kind: 'param', path: 'productId' },
        total: { kind: 'const', value: 0 },
      },
    },
  ],
  query: 'orderHistory',
};

describe('serializeDerivedOptimistic', () => {
  it('emits a DO-NOT-EDIT header and a satisfies clause when complete', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'cartAddDerivedOptimistic',
      entries: [{ program: cartProgram, query: 'cart' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
      queue: 'cart',
    });

    expect(source).toContain('// DO NOT EDIT');
    expect(source).toContain("import type { addToCartForm } from '../../app.js';");
    expect(source).toContain("import type { OptimisticFor } from '@kovojs/browser';");
    expect(source).toContain('export const cartAddDerivedOptimistic = {');
    expect(source).toContain("queue: 'cart',");
    expect(source).toContain('transforms: {');
    expect(source).toContain('cart: (draft, $input) => {');
    // C5 (SPEC.md §10.5:1172) — inc coerces base + increment via the shared `n(...)`
    // helper (identical to the interpreter's `asNumber`) so string-serialized
    // numeric/decimal/bigint columns sum rather than string-concatenate.
    expect(source).toContain('const n = (v) => (typeof v === "number" ? v : Number(v ?? 0));');
    expect(source).toContain('draft.count = n(draft.count) + n($input.quantity);');
    expect(source).toContain('} satisfies OptimisticFor<typeof addToCartForm>;');
  });

  it('imports tempId only when a push uses a tempId placeholder', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'plan',
      entries: [{ program: pushProgram, query: 'orderHistory' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
    });
    expect(source).toContain("import { tempId, type OptimisticFor } from '@kovojs/browser';");
    expect(source).toContain(
      'draft.items.push({ id: tempId(), productId: $input.productId, total: 0 });',
    );
    expect(source).not.toContain('now()');
  });

  it('override precedence: a hand-written entry is suppressed (no satisfies, named note)', () => {
    const source = serializeDerivedOptimistic({
      complete: false,
      constName: 'cartAddDerivedOptimistic',
      entries: [{ program: { ops: [], query: 'orderHistory' }, query: 'orderHistory' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
      overrides: ['cart', 'productGrid'],
    });

    // Suppressed pairs are not emitted; the const is a partial the app merges.
    expect(source).not.toContain('cart: (draft');
    expect(source).not.toContain('productGrid: (draft');
    // The empty (no-op) program reads no input, so the param lowers to `_$input`.
    expect(source).toContain('orderHistory: (draft, _$input) =>');
    expect(source).not.toContain('satisfies OptimisticFor');
    expect(source).toContain(
      'Overridden in the mutation module (derivation suppressed): cart, productGrid.',
    );
  });

  it('erases private session scope from a derived scoped exact-row transform', () => {
    const rowset = {
      filters: [
        { column: 'sessionId', op: 'eq' as const, value: { kind: 'session' as const, path: 'id' } },
      ],
      key: 'sessionId,id',
      orderBy: [],
      table: 'questions',
    };
    const shape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id', 'score'],
          rowKey: 'sessionId,id',
          rowset,
        },
      },
      query: 'questionList',
    };
    const effect: SymbolicEffect = {
      match: {
        eq: [
          { column: 'sessionId', value: { kind: 'session', path: 'id' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: {
        score: {
          kind: 'arith',
          left: { kind: 'col', column: 'score' },
          op: '+',
          right: { kind: 'const', value: 1 },
        },
      },
      table: 'questions',
    };
    const result = deriveOptimistic([effect], shape);
    if (result.kind !== 'derived') throw new Error(`expected derived, got ${result.kind}`);

    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'questionVoteDerivedOptimistic',
      entries: [{ program: result.program, query: 'questionList' }],
      formImport: { name: 'voteQuestionForm', path: '../../app.js' },
    });

    expect(source).toContain('entry.id === $input.targetId');
    expect(source).not.toContain('sessionId');
    expect(source).not.toContain('session:');
    expect(source).not.toContain('$input.session');
    expect(source).not.toContain('tenant');
  });
});

describe('lowerTransform — codegen ≡ interpreter parity', () => {
  it('produces an executable transform equivalent to applyPatchProgram', async () => {
    const { applyPatchProgram } = await import('@kovojs/core/internal/derivation');
    const program: PatchProgram = {
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
    };
    const before = {
      items: [
        { id: 'p1', stock: 5 },
        { id: 'p2', stock: 9 },
      ],
    };
    const input = { productId: 'p1', quantity: 2 };

    // Executing the emitted transform source is exactly what proves codegen ≡ interpreter.
    // oxlint-disable-next-line no-implied-eval -- see above.
    const factory = new Function('tempId', 'now', `return ${lowerTransform(program)};`) as (
      t: () => string,
      n: () => number,
    ) => (draft: unknown, $input: unknown) => void;
    const transform = factory(
      () => '__tempId__',
      () => 0,
    );

    const generated = structuredClone(before);
    transform(generated, input);
    const interpreted = applyPatchProgram(before, input, program, {
      now: () => 0,
      tempId: () => '__tempId__',
    });

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({
      items: [
        { id: 'p1', stock: 3 },
        { id: 'p2', stock: 9 },
      ],
    });
  });

  it('rejects private scope values before generating browser-visible code', () => {
    const leakedSessionMatch: PatchProgram = {
      ops: [
        {
          guard: 'find-or-noop',
          match: [{ column: 'sessionId', value: { kind: 'session', path: 'id' } }],
          op: 'remove-row',
          path: 'items',
        },
      ],
      query: 'questionList',
    };
    const leakedTenantRow: PatchProgram = {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: [],
          position: 'end',
          row: {
            id: { kind: 'param', path: 'id' },
            tenantId: { kind: 'tenant', path: 'id' },
          },
        },
      ],
      query: 'tickets',
    };
    const leakedGuardValue: PatchProgram = {
      ops: [{ op: 'set-field', path: 'owner', value: { kind: 'guard', path: 'owner.id' } }],
      query: 'owner',
    };

    expect(() => lowerTransform(leakedSessionMatch)).toThrow(
      'private scope value leaked into optimistic codegen (session:id)',
    );
    expect(() => lowerTransform(leakedTenantRow)).toThrow(
      'private scope value leaked into optimistic codegen (tenant:id)',
    );
    expect(() => lowerTransform(leakedGuardValue)).toThrow(
      'private scope value leaked into optimistic codegen (guard:owner.id)',
    );
  });

  // C5 (SPEC.md §10.5:1172 commuting diagram) — node-postgres serializes
  // numeric/decimal/bigint columns as STRINGS. The SHIPPED path is codegen; it must
  // coerce numerically EXACTLY as the interpreter (`asNumber`), or `0 + "19.99"`
  // string-concatenates into a corrupt total and codegen ≢ interpreter.
  async function runBoth(program: PatchProgram, before: unknown, input: unknown) {
    const { applyPatchProgram } = await import('@kovojs/core/internal/derivation');
    // oxlint-disable-next-line no-implied-eval -- executing emitted source proves codegen parity.
    const factory = new Function('tempId', 'now', `return ${lowerTransform(program)};`) as (
      t: () => string,
      n: () => number,
    ) => (draft: unknown, $input: unknown) => void;
    const transform = factory(
      () => '__tempId__',
      () => 0,
    );
    const generated = structuredClone(before);
    transform(generated, input);
    const interpreted = applyPatchProgram(before as never, input as never, program, {
      now: () => 0,
      tempId: () => '__tempId__',
    });
    return { generated, interpreted };
  }

  it('inc over a string-decimal SUM base agrees with the interpreter (no string concat)', async () => {
    const program: PatchProgram = {
      ops: [{ by: { kind: 'param', path: 'amount' }, op: 'inc', path: 'total' }],
      query: 'cart',
    };
    const { generated, interpreted } = await runBoth(program, { total: '100.50' }, { amount: '5' });

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({ total: 105.5 });
  });

  it('resum over string-decimal row columns agrees with the interpreter', async () => {
    const program: PatchProgram = {
      ops: [{ column: 'amount', from: 'lines', op: 'resum', path: 'total' }],
      query: 'cart',
    };
    const { generated, interpreted } = await runBoth(
      program,
      { lines: [{ amount: '19.99' }, { amount: '5' }], total: '0' },
      {},
    );

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({ lines: [{ amount: '19.99' }, { amount: '5' }], total: 24.99 });
  });

  it('sorted push-row over string-numeric orderBy agrees with the interpreter', async () => {
    const program: PatchProgram = {
      ops: [
        {
          op: 'push-row',
          path: 'items',
          placeholderColumns: [],
          position: { column: 'rank', direction: 'asc' },
          row: { id: { kind: 'param', path: 'id' }, rank: { kind: 'param', path: 'rank' } },
        },
      ],
      query: 'leaderboard',
    };
    // String-serialized ranks: lexical compare would place "10" before "9"; numeric
    // coercion (asNumber) must place the new "9" before "10".
    const { generated, interpreted } = await runBoth(
      program,
      {
        items: [
          { id: 'a', rank: '2' },
          { id: 'b', rank: '10' },
        ],
      },
      { id: 'c', rank: '9' },
    );

    expect(generated).toEqual(interpreted);
    expect(generated).toEqual({
      items: [
        { id: 'a', rank: '2' },
        { id: 'c', rank: '9' },
        { id: 'b', rank: '10' },
      ],
    });
  });

  it('advanced analyzer derived programs commute across scoped rows, membership exits, and aggregates', async () => {
    const sessionQuestionRowset = {
      filters: [
        { column: 'sessionId', op: 'eq' as const, value: { kind: 'session' as const, path: 'id' } },
      ],
      key: 'sessionId,id',
      orderBy: [{ column: 'id', direction: 'asc' as const }],
      table: 'questions',
    };
    const questionListShape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id', 'score'],
          rowKey: 'sessionId,id',
          rowset: sessionQuestionRowset,
        },
      },
      query: 'questionList',
      rowsByTable: { questions: { columns: ['id', 'score'], rowsPath: 'items' } },
    };
    const voteUpEffect: SymbolicEffect = {
      match: {
        eq: [
          { column: 'sessionId', value: { kind: 'session', path: 'id' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: {
        score: {
          kind: 'arith',
          left: { kind: 'col', column: 'score' },
          op: '+',
          right: { kind: 'const', value: 1 },
        },
      },
      table: 'questions',
    };

    const tenantTicketRowset = {
      filters: [
        { column: 'tenantId', op: 'eq' as const, value: { kind: 'tenant' as const, path: 'id' } },
        { column: 'status', op: 'eq' as const, value: { kind: 'const' as const, value: 'open' } },
      ],
      key: 'tenantId,id',
      orderBy: [],
      table: 'tickets',
    };
    const openTicketsShape: AlgebraicQueryShape = {
      fields: {
        items: {
          kind: 'agg',
          projection: ['id', 'status'],
          rowKey: 'tenantId,id',
          rowset: tenantTicketRowset,
        },
      },
      query: 'openTickets',
      rowsByTable: { tickets: { columns: ['id', 'status'], rowsPath: 'items' } },
    };
    const closeTicketEffect: SymbolicEffect = {
      match: {
        eq: [
          { column: 'tenantId', value: { kind: 'tenant', path: 'id' } },
          { column: 'id', value: { kind: 'param', path: 'targetId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { status: { kind: 'const', value: 'closed' } },
      table: 'tickets',
    };

    const cartRowset = {
      filters: [
        {
          column: 'cartId',
          op: 'eq' as const,
          value: { kind: 'session' as const, path: 'cartId' },
        },
      ],
      key: 'cartId,productId',
      orderBy: [],
      table: 'cart_items',
    };
    const cartSummaryShape: AlgebraicQueryShape = {
      fields: {
        itemCount: {
          kind: 'count',
          rowset: cartRowset,
          witness: { columns: ['productId'], rowsPath: 'items' },
        },
        items: {
          kind: 'agg',
          projection: ['productId', 'quantity'],
          rowKey: 'cartId,productId',
          rowset: cartRowset,
        },
        totalQuantity: {
          arith: { column: 'quantity', kind: 'col' },
          kind: 'sum',
          rowset: cartRowset,
          witness: { columns: ['quantity'], rowsPath: 'items' },
        },
      },
      query: 'cartSummary',
      rowsByTable: {
        cart_items: { columns: ['productId', 'quantity'], rowsPath: 'items', rowset: cartRowset },
      },
    };
    const updateQuantityEffect: SymbolicEffect = {
      match: {
        eq: [
          { column: 'cartId', value: { kind: 'session', path: 'cartId' } },
          { column: 'productId', value: { kind: 'param', path: 'productId' } },
        ],
        kind: 'keys',
      },
      op: 'update',
      sets: { quantity: { kind: 'param', path: 'nextQuantity' } },
      table: 'cart_items',
    };
    const removeLineEffect: SymbolicEffect = {
      match: {
        eq: [
          { column: 'cartId', value: { kind: 'session', path: 'cartId' } },
          { column: 'productId', value: { kind: 'param', path: 'productId' } },
        ],
        kind: 'keys',
      },
      op: 'delete',
      table: 'cart_items',
    };

    const scenarios = [
      {
        before: {
          items: [
            { id: 'q1', score: '4' },
            { id: 'q2', score: '10' },
          ],
        },
        effect: voteUpEffect,
        input: { targetId: 'q1' },
        query: 'questionList',
        shape: questionListShape,
      },
      {
        before: {
          items: [
            { id: 't1', status: 'open' },
            { id: 't2', status: 'open' },
          ],
        },
        effect: closeTicketEffect,
        input: { targetId: 't2' },
        query: 'openTickets',
        shape: openTicketsShape,
      },
      {
        before: {
          itemCount: 2,
          items: [
            { productId: 'p1', quantity: '2' },
            { productId: 'p2', quantity: '5' },
          ],
          totalQuantity: '7',
        },
        effect: updateQuantityEffect,
        input: { nextQuantity: '8', productId: 'p1' },
        query: 'cartSummary',
        shape: cartSummaryShape,
      },
      {
        before: {
          itemCount: 2,
          items: [
            { productId: 'p1', quantity: '2' },
            { productId: 'p2', quantity: '5' },
          ],
          totalQuantity: '7',
        },
        effect: removeLineEffect,
        input: { productId: 'p2' },
        query: 'cartSummary',
        shape: cartSummaryShape,
      },
    ];

    for (const scenario of scenarios) {
      const result = deriveOptimistic([scenario.effect], scenario.shape);
      if (result.kind !== 'derived') {
        throw new Error(`expected ${scenario.query} to derive, got ${result.kind}`);
      }
      const { generated, interpreted } = await runBoth(
        result.program,
        scenario.before,
        scenario.input,
      );
      expect(generated).toEqual(interpreted);
    }
  });
});

// SPEC.md §6.1/§10.6/§11.1 — the generated `@kovojs/core` registry augmentation drives KV310 /
// `OptimisticFor` exhaustiveness without a hand-authored `declare module` (capability-gaps §3).
describe('serializeCoreRegistryModule', () => {
  it('emits a module-augmentation .d.ts with sorted QueryRegistry + InvalidationSets', () => {
    const source = serializeCoreRegistryModule({
      headerImports: [`import type { QueryResult } from '@kovojs/server';`],
      invalidations: {
        voteUp: ['questionScore', 'questionList', 'questionDetail'],
        postQuestion: ['questionList', 'questionDetail'],
      },
      queries: [
        {
          name: 'questionScore',
          type: `QueryResult<typeof import('../queries.js').questionScore>`,
        },
        { name: 'questionList', type: `QueryResult<typeof import('../queries.js').questionList>` },
      ],
    });

    // Top-level import makes the file a module, so `declare module` is a merging augmentation.
    expect(source).toContain(`import type { QueryResult } from '@kovojs/server';`);
    expect(source).toContain(`declare module '@kovojs/core' {`);
    expect(source).toContain(`interface QueryRegistry {`);
    expect(source).toContain(
      `questionList: QueryResult<typeof import('../queries.js').questionList>;`,
    );
    // InvalidationSets entries are mutation→query unions, deterministically sorted.
    expect(source).toContain(`voteUp: 'questionDetail' | 'questionList' | 'questionScore';`);
    expect(source).toContain(`postQuestion: 'questionDetail' | 'questionList';`);
    // Keys are emitted in sorted order (postQuestion before voteUp; questionList before score).
    expect(source.indexOf('postQuestion:')).toBeLessThan(source.indexOf('voteUp:'));
    expect(source.indexOf('questionList:')).toBeLessThan(source.indexOf('questionScore:'));
  });

  it('emits an empty OptimisticDerivationSets when no derivations are supplied', () => {
    const source = serializeCoreRegistryModule({
      invalidations: { voteUp: ['questionList'] },
      queries: [{ name: 'questionList', type: 'unknown' }],
    });
    expect(source).toMatch(/interface OptimisticDerivationSets \{\s*\}/);
  });

  it('quotes registry keys that are not valid identifiers', () => {
    const source = serializeCoreRegistryModule({
      invalidations: { 'cart/add': ['cart'] },
      queries: [{ name: 'cart', type: 'unknown' }],
    });
    expect(source).toContain(`"cart/add": 'cart';`);
  });
});
