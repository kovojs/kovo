import {
  analyzeSqlSafetyFromProject,
  diagnosticsForQueryFacts,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  type SourceFileInput,
  type TouchGraphProjectOptions,
} from '@kovojs/drizzle/internal/static';

import { compileComponentModule } from '../../compiler/src/index.js';

export const PHASE0_METAMORPHIC_REQUIRED_CODES = [
  'KV414',
  'KV435',
  'KV422',
  'KV426',
  'KV407',
  'KV311',
] as const;

export type Phase0MetamorphicCode = (typeof PHASE0_METAMORPHIC_REQUIRED_CODES)[number];

export type MetamorphicVariantKind =
  | 'control'
  | 'import-alias'
  | 'namespace-import'
  | 're-export-barrel'
  | 'local-alias'
  | 'wrapper-helper'
  | 'destructured-binding';

export type MetamorphicExpectation = 'enforced' | 'todo';

export interface MetamorphicRunResult {
  codes: readonly string[];
  detail: readonly string[];
}

export interface MetamorphicVariantCase {
  expectation: MetamorphicExpectation;
  kind: MetamorphicVariantKind;
  label: string;
  reason?: string;
  run?: () => MetamorphicRunResult;
}

export interface MetamorphicRecognitionSeed {
  code: Phase0MetamorphicCode;
  description: string;
  label: string;
  variants: readonly MetamorphicVariantCase[];
}

export interface MetamorphicCoverageRow {
  code: Phase0MetamorphicCode;
  enforced: number;
  label: string;
  todo: number;
  variants: readonly MetamorphicVariantKind[];
}

interface KovoServerBindingVariant {
  callee: string;
  expectation: MetamorphicExpectation;
  extraFiles?: readonly SourceFileInput[];
  importLine: string;
  kind: MetamorphicVariantKind;
  label: string;
  reason?: string;
  setupLines?: readonly string[];
}

interface SqlBindingVariant {
  expectation: MetamorphicExpectation;
  expression: string;
  extraFiles?: readonly SourceFileInput[];
  importLine: string;
  kind: MetamorphicVariantKind;
  label: string;
  reason?: string;
  setupLines?: readonly string[];
}

interface CompilerExpressionVariant {
  expectation: MetamorphicExpectation;
  extraFilesUnsupported?: true;
  importLine?: string;
  kind: MetamorphicVariantKind;
  label: string;
  reason?: string;
  source: string;
}

export const metamorphicRecognitionSeeds: readonly MetamorphicRecognitionSeed[] = [
  {
    code: 'KV414',
    description:
      'Owner-table read keyed by client args must surface the unscoped access audit that kovo check enforces as KV414.',
    label: 'owner read IDOR',
    variants: kovoServerBindingVariants().map((variant) =>
      variantCase(variant, () => runOwnerReadIdorVariant(variant)),
    ),
  },
  {
    code: 'KV435',
    description: 'Secret-classified query projection must remain visible to the query-wire gate.',
    label: 'secret query wire',
    variants: kovoServerBindingVariants().map((variant) =>
      variantCase(variant, () => runSecretWireVariant(variant)),
    ),
  },
  {
    code: 'KV422',
    description:
      'Request-derived text must not reach executable SQL sinks, including through raw-helper spelling variants.',
    label: 'SQL text provenance',
    variants: sqlBindingVariants().map((variant) =>
      variantCase(variant, () => runSqlSafetyVariant(variant)),
    ),
  },
  {
    code: 'KV426',
    description:
      'trustedHtml() over query-derived data must require audited provenance instead of silently branding tainted HTML.',
    label: 'trusted HTML provenance',
    variants: trustedHtmlVariants().map((variant) =>
      variantCase(variant, () => runCompilerDiagnosticVariant('KV426', variant)),
    ),
  },
  {
    code: 'KV407',
    description:
      'A derived query read domain omitted from the declared read set must surface the missed-invalidation gate.',
    label: 'undeclared query read',
    variants: kovoServerBindingVariants().map((variant) =>
      variantCase(variant, () => runUndeclaredReadVariant(variant)),
    ),
  },
  {
    code: 'KV311',
    description:
      'Query-dependent render positions with disabled server refresh must remain visible to update-coverage diagnostics.',
    label: 'update coverage',
    variants: updateCoverageVariants().map((variant) =>
      variantCase(variant, () => runCompilerDiagnosticVariant('KV311', variant)),
    ),
  },
];

export function metamorphicRecognitionCoverageRows(
  seeds: readonly MetamorphicRecognitionSeed[] = metamorphicRecognitionSeeds,
): MetamorphicCoverageRow[] {
  return seeds.map((seed) => ({
    code: seed.code,
    enforced: seed.variants.filter((variant) => variant.expectation === 'enforced').length,
    label: seed.label,
    todo: seed.variants.filter((variant) => variant.expectation === 'todo').length,
    variants: seed.variants.map((variant) => variant.kind),
  }));
}

export function metamorphicRecognitionTodoRows(
  seeds: readonly MetamorphicRecognitionSeed[] = metamorphicRecognitionSeeds,
): Array<{
  code: Phase0MetamorphicCode;
  kind: MetamorphicVariantKind;
  label: string;
  reason: string;
}> {
  return seeds.flatMap((seed) =>
    seed.variants
      .filter((variant) => variant.expectation === 'todo')
      .map((variant) => ({
        code: seed.code,
        kind: variant.kind,
        label: variant.label,
        reason: variant.reason ?? '',
      })),
  );
}

function variantCase(
  variant: KovoServerBindingVariant | SqlBindingVariant | CompilerExpressionVariant,
  run: () => MetamorphicRunResult,
): MetamorphicVariantCase {
  return {
    expectation: variant.expectation,
    kind: variant.kind,
    label: variant.label,
    ...(variant.reason === undefined ? {} : { reason: variant.reason }),
    ...(variant.expectation === 'enforced' ? { run } : {}),
  };
}

function kovoServerBindingVariants(): readonly KovoServerBindingVariant[] {
  return [
    {
      callee: 'query',
      expectation: 'enforced',
      importLine: 'import { query } from "@kovojs/server";',
      kind: 'control',
      label: 'direct @kovojs/server import',
    },
    {
      callee: 'q',
      expectation: 'enforced',
      importLine: 'import { query as q } from "@kovojs/server";',
      kind: 'import-alias',
      label: 'named import alias',
    },
    {
      callee: 'srv.query',
      expectation: 'enforced',
      importLine: 'import * as srv from "@kovojs/server";',
      kind: 'namespace-import',
      label: 'namespace import member',
    },
    {
      callee: 'q',
      expectation: 'enforced',
      extraFiles: [
        {
          fileName: 'server-barrel.ts',
          source: 'export { query as q } from "@kovojs/server";',
        },
      ],
      importLine: 'import { q } from "./server-barrel";',
      kind: 're-export-barrel',
      label: 'local barrel re-export',
    },
    {
      callee: 'q',
      expectation: 'enforced',
      importLine: 'import { query } from "@kovojs/server";',
      kind: 'local-alias',
      label: 'local const alias',
      setupLines: ['const q = query;'],
    },
    {
      callee: 'q',
      expectation: 'todo',
      importLine: 'import * as srv from "@kovojs/server";',
      kind: 'destructured-binding',
      label: 'destructured namespace binding',
      reason:
        'Workstream B identity resolution should follow destructured namespace bindings; the current source recognizer does not.',
      setupLines: ['const { query: q } = srv;'],
    },
    {
      callee: 'defineQuery',
      expectation: 'todo',
      importLine: 'import { query } from "@kovojs/server";',
      kind: 'wrapper-helper',
      label: 'wrapper helper call',
      reason:
        'Workstreams A/C should fail closed or recognize helper-indirect query declarations; current query extraction is declaration-call based.',
      setupLines: [
        'const defineQuery = (key: string, body: unknown) => query(key, body as never);',
      ],
    },
  ];
}

function sqlBindingVariants(): readonly SqlBindingVariant[] {
  return [
    {
      expectation: 'enforced',
      expression: 'sql.raw(input.sort)',
      importLine: 'import { sql } from "@kovojs/drizzle";',
      kind: 'control',
      label: 'direct sql import',
    },
    {
      expectation: 'enforced',
      expression: 'kSql.raw(input.sort)',
      importLine: 'import { sql as kSql } from "@kovojs/drizzle";',
      kind: 'import-alias',
      label: 'named sql import alias',
    },
    {
      expectation: 'enforced',
      expression: 'kovoDrizzle.sql.raw(input.sort)',
      importLine: 'import * as kovoDrizzle from "@kovojs/drizzle";',
      kind: 'namespace-import',
      label: 'namespace sql member',
    },
    {
      expectation: 'enforced',
      expression: 'kSql.raw(input.sort)',
      extraFiles: [
        {
          fileName: 'drizzle-barrel.ts',
          source: 'export { sql as kSql } from "@kovojs/drizzle";',
        },
      ],
      importLine: 'import { kSql } from "./drizzle-barrel";',
      kind: 're-export-barrel',
      label: 'barrel-exported sql helper',
    },
    {
      expectation: 'enforced',
      expression: 'kSql.raw(input.sort)',
      importLine: 'import { sql } from "@kovojs/drizzle";',
      kind: 'local-alias',
      label: 'local sql const alias',
      setupLines: ['const kSql = sql;'],
    },
    {
      expectation: 'enforced',
      expression: 'kSql.raw(input.sort)',
      importLine: 'import * as kovoDrizzle from "@kovojs/drizzle";',
      kind: 'destructured-binding',
      label: 'destructured namespace sql binding',
      setupLines: ['const { sql: kSql } = kovoDrizzle;'],
    },
    {
      expectation: 'enforced',
      expression: 'rawFragment(input.sort)',
      importLine: 'import { sql } from "@kovojs/drizzle";',
      kind: 'wrapper-helper',
      label: 'wrapper helper returning raw SQL',
      setupLines: ['const rawFragment = (value: string) => sql.raw(value);'],
    },
  ];
}

function trustedHtmlVariants(): readonly CompilerExpressionVariant[] {
  return [
    {
      expectation: 'enforced',
      importLine: 'import { trustedHtml } from "@kovojs/browser";',
      kind: 'control',
      label: 'direct trustedHtml import',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(post.body)}</article>,
});
`,
    },
    {
      expectation: 'enforced',
      importLine: 'import { trustedHtml as th } from "@kovojs/browser";',
      kind: 'import-alias',
      label: 'trustedHtml import alias',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
    },
    {
      expectation: 'enforced',
      importLine: 'import { trustedHtml } from "@kovojs/browser";',
      kind: 'destructured-binding',
      label: 'destructured query field',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => {
    const { body } = post;
    return <article>{trustedHtml(body)}</article>;
  },
});
`,
    },
    {
      expectation: 'todo',
      importLine: 'import * as browser from "@kovojs/browser";',
      kind: 'namespace-import',
      label: 'trustedHtml namespace member',
      reason:
        'The current KV426 validator records direct named browser imports; Workstream B should lift this to semantic export identity.',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{browser.trustedHtml(post.body)}</article>,
});
`,
    },
    {
      expectation: 'todo',
      extraFilesUnsupported: true,
      importLine: 'import { th } from "./browser-barrel";',
      kind: 're-export-barrel',
      label: 'trustedHtml local barrel re-export',
      reason:
        'compileComponentModule is currently single-file and the KV426 recognizer does not follow browser re-export barrels.',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
    },
    {
      expectation: 'todo',
      importLine: 'import { trustedHtml } from "@kovojs/browser";',
      kind: 'local-alias',
      label: 'trustedHtml local const alias',
      reason:
        'The current KV426 recognizer tracks imported local names, not same-scope aliases of the trustedHtml binding.',
      source: `
const th = trustedHtml;
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
    },
    {
      expectation: 'todo',
      importLine: 'import { trustedHtml } from "@kovojs/browser";',
      kind: 'wrapper-helper',
      label: 'trustedHtml wrapper helper',
      reason:
        'The current KV426 gate documents function-call results as bounded interprocedural residue until fail-closed provenance lands.',
      source: `
const unsafeTrust = (value: string) => trustedHtml(value);
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{unsafeTrust(post.body)}</article>,
});
`,
    },
  ];
}

function updateCoverageVariants(): readonly CompilerExpressionVariant[] {
  return [
    {
      expectation: 'enforced',
      kind: 'control',
      label: 'direct query expression',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => <cart-badge>{cart.count + 1}</cart-badge>,
});
`,
    },
    {
      expectation: 'enforced',
      kind: 'local-alias',
      label: 'render-local const alias',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => {
    const label = cart.count + 1;
    return <cart-badge>{label}</cart-badge>;
  },
});
`,
    },
    {
      expectation: 'todo',
      kind: 'destructured-binding',
      label: 'destructured query field',
      reason:
        'The current KV311 coverage pass does not follow destructured query fields; Workstreams A/C should make this fail closed through model facts.',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => {
    const { count } = cart;
    return <cart-badge>{count}</cart-badge>;
  },
});
`,
    },
    {
      expectation: 'todo',
      kind: 'wrapper-helper',
      label: 'closure helper returning query value',
      reason:
        'The residual closure-shaped read is intentionally left visible for Workstreams A/C; current coverage extraction does not traverse ordinary closures.',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => {
    const label = (() => cart.count + 1)();
    return <cart-badge>{label}</cart-badge>;
  },
});
`,
    },
  ];
}

function runOwnerReadIdorVariant(variant: KovoServerBindingVariant): MetamorphicRunResult {
  const files = ownerSecretQueryFiles(variant);
  const audit = extractOwnerAuditFromProject(withPgDatabaseTypes({ files }));
  const idorAudits = audit.scopeAudits.filter(
    (scopeAudit) =>
      scopeAudit.domain === 'order' &&
      scopeAudit.kind === 'query' &&
      scopeAudit.name === 'order' &&
      scopeAudit.scope !== 'session' &&
      !scopeAudit.justification,
  );

  return {
    codes: idorAudits.length > 0 ? ['KV414'] : [],
    detail: idorAudits.map(
      (scopeAudit) =>
        `${scopeAudit.name}:${scopeAudit.domain}:${scopeAudit.scope}:${scopeAudit.key ?? '-'}`,
    ),
  };
}

function runSecretWireVariant(variant: KovoServerBindingVariant): MetamorphicRunResult {
  const facts = extractQueryFactsFromProject(
    withPgDatabaseTypes({ files: ownerSecretQueryFiles(variant) }),
  );
  const diagnostics = diagnosticsForQueryFacts(facts).filter(
    (diagnostic) => diagnostic.code === 'KV435',
  );

  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    detail: diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function runUndeclaredReadVariant(variant: KovoServerBindingVariant): MetamorphicRunResult {
  const facts = extractQueryFactsFromProject(
    withPgDatabaseTypes({ files: undeclaredReadQueryFiles(variant) }),
  );
  const fact = facts.find((queryFact) => queryFact.query === 'product/list');
  const declaredDomains = new Set<string>();
  const missing = (fact?.reads ?? []).filter((domain) => !declaredDomains.has(domain));

  return {
    codes: missing.length > 0 ? ['KV407'] : [],
    detail: missing.map((domain) => `product/list reads ${domain}`),
  };
}

function runSqlSafetyVariant(variant: SqlBindingVariant): MetamorphicRunResult {
  const diagnostics = analyzeSqlSafetyFromProject({
    files: [
      ...(variant.extraFiles ?? []),
      {
        fileName: 'sql-probe.ts',
        source: [
          variant.importLine,
          ...(variant.setupLines ?? []),
          '',
          'export async function report(input: { sort: string }, db: any) {',
          `  await db.execute(${variant.expression});`,
          '}',
        ].join('\n'),
      },
    ],
  });

  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    detail: diagnostics.map((diagnostic) => `${diagnostic.site}: ${diagnostic.message}`),
  };
}

function runCompilerDiagnosticVariant(
  code: Phase0MetamorphicCode,
  variant: CompilerExpressionVariant,
): MetamorphicRunResult {
  const result = compileComponentModule({
    fileName: `${code.toLowerCase()}-${variant.kind}.tsx`,
    source: [variant.importLine ?? '', variant.source].filter(Boolean).join('\n'),
  });
  const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === code);

  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    detail: diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function ownerSecretQueryFiles(variant: KovoServerBindingVariant): SourceFileInput[] {
  return [
    ...(variant.extraFiles ?? []),
    {
      fileName: 'order.queries.ts',
      source: [
        variant.importLine,
        'import { s } from "@kovojs/server";',
        'import { eq } from "drizzle-orm";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { kovo, sql } from "@kovojs/drizzle";',
        ...(variant.setupLines ?? []),
        '',
        'export const orders = pgTable("orders", {',
        '  id: text("id").primaryKey(),',
        '  ownerId: text("owner_id").notNull(),',
        '  secretToken: text("secret_token").notNull(),',
        '}, kovo({ domain: "order", key: "id", owner: "ownerId", secret: ["secretToken"] }));',
        '',
        `export const orderById = ${variant.callee}("order", {`,
        '  output: s.object({ token: s.string() }),',
        '  reads: [orders],',
        '  load(input: { id: string }, db: PgAsyncDatabase<any, any>) {',
        '    return db',
        '      .select({ token: sql<string>`${orders.secretToken}` })',
        '      .from(orders)',
        '      .where(eq(orders.id, input.id));',
        '  },',
        '});',
      ].join('\n'),
    },
  ];
}

function undeclaredReadQueryFiles(variant: KovoServerBindingVariant): SourceFileInput[] {
  return [
    ...(variant.extraFiles ?? []),
    {
      fileName: 'product.queries.ts',
      source: [
        variant.importLine,
        'import { s } from "@kovojs/server";',
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        'import type { PgAsyncDatabase } from "drizzle-orm/pg-core";',
        'import { kovo } from "@kovojs/drizzle";',
        ...(variant.setupLines ?? []),
        '',
        'export const products = pgTable("products", {',
        '  id: text("id").primaryKey(),',
        '  name: text("name").notNull(),',
        '}, kovo({ domain: "product", key: "id" }));',
        '',
        `export const productList = ${variant.callee}("product/list", {`,
        '  output: s.object({ name: s.string() }),',
        '  load(_input: {}, db: PgAsyncDatabase<any, any>) {',
        '    return db.select({ name: products.name }).from(products);',
        '  },',
        '});',
      ].join('\n'),
    },
  ];
}

function withPgDatabaseTypes(options: TouchGraphProjectOptions): TouchGraphProjectOptions {
  if (options.files.some((file) => file.fileName === 'drizzle-types.d.ts')) return options;

  return {
    ...options,
    files: [
      {
        fileName: 'drizzle-types.d.ts',
        source: [
          'import "drizzle-orm/pg-core";',
          'declare module "drizzle-orm/pg-core" {',
          '  export interface PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> {',
          '    select(value?: unknown): { from(table: unknown): { where(value: unknown): Promise<unknown[]> } };',
          '  }',
          '}',
          'declare global {',
          '  type PgAsyncDatabase<TQueryResultHKT = unknown, TFullSchema = unknown> = import("drizzle-orm/pg-core").PgAsyncDatabase<any, any>;',
          '}',
        ].join('\n'),
      },
      ...options.files,
    ],
  };
}
