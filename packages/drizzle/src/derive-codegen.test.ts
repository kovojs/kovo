import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AlgebraicQueryShape,
  PatchProgram,
  SymbolicEffect,
} from '@kovojs/core/internal/derivation';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { deriveOptimistic } from './derive.js';
import { lowerTransform, serializeDerivedOptimistic } from './derive-codegen.js';

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

function queryValueImport(query: string, name = query, path = '../../queries.js') {
  return [{ name, path, query }] as const;
}

describe('serializeDerivedOptimistic', () => {
  it('emits a DO-NOT-EDIT header and a satisfies clause when complete', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'cartAddDerivedOptimistic',
      entries: [{ program: cartProgram, query: 'cart' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
      queryValueImports: queryValueImport('cart'),
      queue: 'cart',
    });

    expect(source).toContain('// DO NOT EDIT');
    expect(source).toContain("import type { addToCartForm } from '../../app.js';");
    expect(source).toContain("import type { OptimisticFor } from '@kovojs/browser/generated';");
    expect(source).toContain('export const cartAddDerivedOptimistic = {');
    expect(source).toContain("queue: 'cart',");
    expect(source).toContain('transforms: {');
    expect(source).toContain('cart: (draft, $input) => {');
    expect(source).toContain("import type { QueryResult } from '@kovojs/server';");
    expect(source).toContain("cart: QueryResult<typeof import('../../queries.js').cart>;");
    // C5 (SPEC.md §10.5:1172) — inc coerces base + increment via the shared `n(...)`
    // helper (identical to the interpreter's `asNumber`) so string-serialized
    // numeric/decimal/bigint columns sum rather than string-concatenate.
    expect(source).toContain('const n = (v) => (typeof v === "number" ? v : Number(v ?? 0));');
    expect(source).toContain('draft.count = n(draft.count) + n($input.quantity);');
    expect(source).toContain(
      '} satisfies OptimisticFor<typeof addToCartForm, {\n' +
        "  cart: QueryResult<typeof import('../../queries.js').cart>;\n" +
        '}>;',
    );
  });

  it('imports tempId only when a push uses a tempId placeholder', () => {
    const source = serializeDerivedOptimistic({
      complete: true,
      constName: 'plan',
      entries: [{ program: pushProgram, query: 'orderHistory' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
      queryValueImports: queryValueImport('orderHistory'),
    });
    expect(source).toContain(
      "import { tempId, type OptimisticFor } from '@kovojs/browser/generated';",
    );
    expect(source).toContain(
      'draft.items.push({ id: tempId(), productId: $input.productId, total: 0 });',
    );
    expect(source).not.toContain('now()');
  });

  it('fails closed when a complete plan lacks an exact query identity map', () => {
    const complete = {
      complete: true,
      constName: 'plan',
      entries: [{ program: cartProgram, query: 'cart' }],
      formImport: { name: 'addToCartForm', path: '../../app.js' },
    } as const;

    expect(() => serializeDerivedOptimistic(complete)).toThrow(/missing: cart; extra: none/u);
    expect(() =>
      serializeDerivedOptimistic({
        ...complete,
        queryValueImports: [
          { name: 'cart', path: '../../queries.js', query: 'cart' },
          { name: 'cartAgain', path: '../../queries.js', query: 'cart' },
        ],
      }),
    ).toThrow(/Duplicate generated optimistic query identity: cart/u);
    expect(() =>
      serializeDerivedOptimistic({
        ...complete,
        queryValueImports: [
          {
            name: 'cart; export const owned = true',
            path: '../../queries.js',
            query: 'cart',
          },
        ],
      }),
    ).toThrow(/KV451/u);
  });

  it('confines hostile queue/import/comment data and rejects hostile emitted identifiers', () => {
    const queue = "serial'; owned: true, tail: 'queue";
    const importPath = "../../app.js'; const importedOwned = true; //";
    const override = 'cart\nexport const overrideOwned = true;';
    const source = serializeDerivedOptimistic({
      complete: false,
      constName: 'safePlan',
      entries: [{ program: cartProgram, query: 'cart' }],
      formImport: { name: 'addToCartForm', path: importPath },
      overrides: [override],
      queue,
    });
    const parsed = ts.createSourceFile(
      'generated/optimistic.ts',
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const leaves: string[] = [];
    const identifiers: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node)) leaves.push(node.text);
      if (ts.isIdentifier(node)) identifiers.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(parsed);

    expect(parsed.parseDiagnostics).toEqual([]);
    expect(leaves.filter((value) => value === queue)).toHaveLength(1);
    expect(leaves.filter((value) => value === importPath)).toHaveLength(1);
    expect(identifiers).not.toContain('importedOwned');
    expect(identifiers).not.toContain('overrideOwned');

    expect(() =>
      serializeDerivedOptimistic({
        complete: false,
        constName: 'safe; export const constOwned = true',
        entries: [],
        formImport: { name: 'addToCartForm', path: '../../app.js' },
      }),
    ).toThrow(/KV451/u);
    expect(() =>
      serializeDerivedOptimistic({
        complete: false,
        constName: 'safePlan',
        entries: [],
        formImport: {
          name: 'safe; export const importNameOwned = true',
          path: '../../app.js',
        },
      }),
    ).toThrow(/KV451/u);
  });

  it('typechecks and executes an emitted transform that exercises every placeholder import', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-derived-optimistic-emitted-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'node_modules', '@kovojs', 'browser'), { recursive: true });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ type: 'module' }, null, 2),
        'utf8',
      );
      writeFileSync(
        join(root, 'node_modules', '@kovojs', 'browser', 'package.json'),
        JSON.stringify({ exports: { './generated': './generated.mjs' }, type: 'module' }, null, 2),
        'utf8',
      );
      writeFileSync(
        join(root, 'node_modules', '@kovojs', 'browser', 'generated.mjs'),
        [
          'let id = 0;',
          'export function tempId() {',
          '  id += 1;',
          '  return `kovo-tmp-${id}`;',
          '}',
          'export function now() {',
          '  return Date.now();',
          '}',
          '',
        ].join('\n'),
        'utf8',
      );
      const source = serializeDerivedOptimistic({
        complete: true,
        constName: 'addLineDerivedOptimistic',
        entries: [
          {
            program: {
              ops: [
                {
                  op: 'push-row',
                  path: 'items',
                  placeholderColumns: ['id', 'createdAt'],
                  position: 'end',
                  row: {
                    createdAt: { kind: 'placeholder', placeholder: 'now' },
                    id: { kind: 'placeholder', placeholder: 'tempId' },
                    productId: { kind: 'param', path: 'productId' },
                    total: {
                      kind: 'arith',
                      left: { kind: 'param', path: 'quantity' },
                      op: '*',
                      right: { kind: 'param', path: 'unitPrice' },
                    },
                  },
                },
              ],
              query: 'orderHistory',
            },
            query: 'orderHistory',
          },
        ],
        formImport: { name: 'addLineForm', path: './form.js' },
        queryValueImports: queryValueImport('orderHistory', 'orderHistory', './queries.js'),
      });

      writeFileSync(
        join(root, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              baseUrl: '.',
              ignoreDeprecations: '6.0',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              noEmit: true,
              noImplicitAny: false,
              paths: {
                '@kovojs/browser/generated': ['./src/browser-generated.ts'],
                '@kovojs/core': [join(process.cwd(), 'packages/core/src/index.ts')],
                '@kovojs/server': ['./src/server.ts'],
              },
              strict: true,
              target: 'ES2022',
              typeRoots: [join(process.cwd(), 'node_modules/@types')],
              types: ['node'],
            },
            include: ['src/**/*.ts'],
          },
          null,
          2,
        ),
        'utf8',
      );
      writeFileSync(
        join(root, 'src', 'browser-generated.ts'),
        [
          "import type { Form } from '@kovojs/core';",
          '',
          'type FormInput<Definition> =',
          '  Definition extends Form<string, infer Input, unknown> ? Input : never;',
          '',
          'export type OptimisticFor<',
          '  Definition,',
          '  QueryValues extends Record<string, unknown>,',
          '> = {',
          '  transforms: {',
          '    [Query in keyof QueryValues]:',
          '      | ((draft: QueryValues[Query], input: FormInput<Definition>) => void)',
          "      | 'await-fragment';",
          '  };',
          '};',
          '',
          'export declare function now(): number;',
          'export declare function tempId(): string;',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src', 'form.ts'),
        [
          "import type { Form } from '@kovojs/core';",
          '',
          "export declare const addLineForm: Form<'addLine', { productId: string; quantity: number; unitPrice: number }, unknown>;",
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src', 'queries.ts'),
        [
          'export declare const orderHistory: {',
          '  load: () => {',
          '    items: Array<{',
          '      createdAt: number;',
          '      id: string;',
          '      productId: string;',
          '      total: number;',
          '    }>;',
          '  };',
          '};',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(
        join(root, 'src', 'server.ts'),
        [
          'export type QueryResult<Query> =',
          '  Query extends { load: (...args: never[]) => infer Value } ? Awaited<Value> : never;',
          '',
        ].join('\n'),
        'utf8',
      );
      writeFileSync(join(root, 'src', 'generated.ts'), source, 'utf8');

      execFileSync('pnpm', ['exec', 'tsc', '-p', join(root, 'tsconfig.json')], {
        cwd: process.cwd(),
        stdio: 'inherit',
      });

      const executable = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      writeFileSync(join(root, 'src', 'generated.mjs'), executable, 'utf8');
      const module = (await import(join(root, 'src', 'generated.mjs'))) as {
        addLineDerivedOptimistic: {
          transforms: {
            orderHistory: (draft: { items: unknown[] }, input: unknown) => void;
          };
        };
      };
      const draft = { items: [] };
      module.addLineDerivedOptimistic.transforms.orderHistory(draft, {
        productId: 'p1',
        quantity: 2,
        unitPrice: 7,
      });

      expect(source).toContain(
        "import { now, tempId, type OptimisticFor } from '@kovojs/browser/generated';",
      );
      expect(draft.items).toHaveLength(1);
      expect(draft.items[0]).toMatchObject({
        productId: 'p1',
        total: 14,
      });
      expect((draft.items[0] as { id: string }).id).toMatch(/^kovo-tmp-\d+$/);
      expect(typeof (draft.items[0] as { createdAt: unknown }).createdAt).toBe('number');
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
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
      "Overridden in the mutation module (derivation suppressed): 'cart', 'productGrid'.",
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
      queryValueImports: queryValueImport('questionList'),
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
