import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  analyzeSqlSafetyFromProject,
  diagnosticsForQueryFacts,
  extractOwnerAuditFromProject,
  extractQueryFactsFromProject,
  type SourceFileInput,
  type TouchGraphProjectOptions,
} from '@kovojs/drizzle/internal/static';

import { compileComponentModule } from '../../compiler/src/index.js';
import { viteFrameworkIdentityFiles } from '../../compiler/src/internal.js';

export const PHASE0_METAMORPHIC_REQUIRED_CODES = [
  'KV414',
  'KV435',
  'KV422',
  'KV426',
  'KV407',
  'KV311',
  'KV330',
] as const;

export type Phase0MetamorphicCode = (typeof PHASE0_METAMORPHIC_REQUIRED_CODES)[number];

export type MetamorphicVariantKind =
  | 'control'
  | 'closure'
  | 'import-alias'
  | 'namespace-import'
  | 're-export-barrel'
  | 'local-alias'
  | 'local-shadow'
  | 'wrapper-helper'
  | 'function-helper'
  | 'destructured-binding';

export type MetamorphicExpectation = 'enforced' | 'todo';

export type MetamorphicProofPath =
  | 'fixture-only-compiler'
  | 'production-resolver'
  | 'single-file-compiler'
  | 'static-project';

export const METAMORPHIC_RECOGNITION_BLOCKERS = {
  compilerMultiFileFixture: 'Compiler multi-file component fixture harness',
  failClosedDefault: 'Workstream A fail-closed default',
  irVerification: 'Workstream C IR verification',
  semanticIdentity: 'Workstream B semantic identity resolver',
} as const;

export type MetamorphicRecognitionBlocker =
  (typeof METAMORPHIC_RECOGNITION_BLOCKERS)[keyof typeof METAMORPHIC_RECOGNITION_BLOCKERS];

export interface MetamorphicRunResult {
  codes: readonly string[];
  detail: readonly string[];
}

export interface MetamorphicVariantCase {
  blockers?: readonly MetamorphicRecognitionBlocker[];
  expectation: MetamorphicExpectation;
  kind: MetamorphicVariantKind;
  label: string;
  proofPath?: MetamorphicProofPath;
  reason?: string;
  run?: () => MetamorphicRunResult;
  usesFixtureFiles?: boolean;
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

export interface MetamorphicRecognitionGateOptions {
  readonly approvedTodos?: readonly string[];
}

interface KovoServerBindingVariant {
  blockers?: readonly MetamorphicRecognitionBlocker[];
  callee: string;
  expectation: MetamorphicExpectation;
  extraFiles?: readonly SourceFileInput[];
  importLine: string;
  kind: MetamorphicVariantKind;
  label: string;
  proofPath?: MetamorphicProofPath;
  reason?: string;
  setupLines?: readonly string[];
}

interface SqlBindingVariant {
  blockers?: readonly MetamorphicRecognitionBlocker[];
  expectation: MetamorphicExpectation;
  expression: string;
  extraFiles?: readonly SourceFileInput[];
  importLine: string;
  kind: MetamorphicVariantKind;
  label: string;
  proofPath?: MetamorphicProofPath;
  reason?: string;
  setupLines?: readonly string[];
}

interface CompilerExpressionVariant {
  blockers?: readonly MetamorphicRecognitionBlocker[];
  expectation: MetamorphicExpectation;
  extraFiles?: readonly SourceFileInput[];
  importLine?: string;
  kind: MetamorphicVariantKind;
  label: string;
  proofPath?: MetamorphicProofPath;
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
  {
    code: 'KV330',
    description:
      'Task and webhook direct DB writes must emit handler write-sink facts and fail the direct-write policy gate.',
    label: 'task/webhook direct DB writes',
    variants: directDbHandlerVariants().map((variant) =>
      variantCase(variant, () => runDirectDbHandlerVariant(variant)),
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
  blockers: readonly MetamorphicRecognitionBlocker[];
  code: Phase0MetamorphicCode;
  kind: MetamorphicVariantKind;
  label: string;
  reason: string;
}> {
  return seeds.flatMap((seed) =>
    seed.variants
      .filter((variant) => variant.expectation === 'todo')
      .map((variant) => ({
        blockers: variant.blockers ?? [],
        code: seed.code,
        kind: variant.kind,
        label: variant.label,
        reason: variant.reason ?? '',
      })),
  );
}

export function metamorphicRecognitionGateViolations(
  seeds: readonly MetamorphicRecognitionSeed[] = metamorphicRecognitionSeeds,
  options: MetamorphicRecognitionGateOptions = {},
): string[] {
  const failures: string[] = [];
  const approvedTodos = new Set(options.approvedTodos ?? []);
  const requiredCodes = new Set(PHASE0_METAMORPHIC_REQUIRED_CODES);
  const seenCodes = new Map<Phase0MetamorphicCode, number>();
  const validBlockers = new Set<string>(Object.values(METAMORPHIC_RECOGNITION_BLOCKERS));

  for (const seed of seeds) {
    seenCodes.set(seed.code, (seenCodes.get(seed.code) ?? 0) + 1);

    if (seed.variants.length === 0) {
      failures.push(`${seed.code}: add at least one metamorphic recognition variant`);
      continue;
    }

    if (!seed.variants.some((variant) => variant.kind === 'control')) {
      failures.push(`${seed.code}: add a control variant before gating spelling variants`);
    }

    if (!seed.variants.some((variant) => variant.expectation === 'enforced')) {
      failures.push(`${seed.code}: at least one variant must be enforced in CI`);
    }

    const seenVariantKinds = new Set<MetamorphicVariantKind>();
    for (const variant of seed.variants) {
      if (seenVariantKinds.has(variant.kind)) {
        failures.push(`${seed.code}: duplicate variant kind ${variant.kind}`);
      }
      seenVariantKinds.add(variant.kind);

      if (variant.expectation === 'enforced' && variant.run === undefined) {
        failures.push(`${seed.code}/${variant.kind}: enforced variants must provide a runner`);
      }

      if (
        variant.expectation === 'enforced' &&
        variant.usesFixtureFiles === true &&
        variant.proofPath === 'fixture-only-compiler'
      ) {
        failures.push(
          `${seed.code}/${variant.kind}: security variants with sibling files must use the production resolver path, not fixture-only extraFiles`,
        );
      }

      if (variant.expectation === 'todo') {
        const todoKey = `${seed.code}/${variant.kind}`;
        if (!approvedTodos.has(todoKey)) {
          failures.push(`${todoKey}: TODO variant lacks explicit approval`);
        }
        if ((variant.reason ?? '').trim().length === 0) {
          failures.push(`${seed.code}/${variant.kind}: TODO variants require a precise reason`);
        }
        if ((variant.blockers ?? []).length === 0) {
          failures.push(`${seed.code}/${variant.kind}: TODO variants require named blockers`);
        }
        for (const blocker of variant.blockers ?? []) {
          if (!validBlockers.has(blocker)) {
            failures.push(`${seed.code}/${variant.kind}: unknown blocker ${blocker}`);
          }
        }
      }
    }
  }

  for (const code of PHASE0_METAMORPHIC_REQUIRED_CODES) {
    if (!seenCodes.has(code)) failures.push(`${code}: missing CI-gated metamorphic seed`);
  }

  for (const [code, count] of seenCodes) {
    if (!requiredCodes.has(code)) {
      failures.push(`${code}: seed code is not enrolled in PHASE0_METAMORPHIC_REQUIRED_CODES`);
    }
    if (count > 1) failures.push(`${code}: duplicate metamorphic seed entries`);
  }

  return failures;
}

function variantCase(
  variant: KovoServerBindingVariant | SqlBindingVariant | CompilerExpressionVariant,
  run: () => MetamorphicRunResult,
): MetamorphicVariantCase {
  return {
    ...(variant.blockers === undefined ? {} : { blockers: variant.blockers }),
    expectation: variant.expectation,
    kind: variant.kind,
    label: variant.label,
    proofPath: variant.proofPath ?? defaultProofPath(variant),
    ...(variant.reason === undefined ? {} : { reason: variant.reason }),
    ...(variant.expectation === 'enforced' ? { run } : {}),
    usesFixtureFiles: (variant.extraFiles?.length ?? 0) > 0,
  };
}

function defaultProofPath(
  variant: KovoServerBindingVariant | SqlBindingVariant | CompilerExpressionVariant,
): MetamorphicProofPath {
  if ('source' in variant) {
    return (variant.extraFiles?.length ?? 0) > 0 ? 'production-resolver' : 'single-file-compiler';
  }
  return 'static-project';
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
      expectation: 'enforced',
      importLine: 'import * as srv from "@kovojs/server";',
      kind: 'destructured-binding',
      label: 'destructured namespace binding',
      setupLines: ['const { query: q } = srv;'],
    },
    {
      callee: 'defineQuery',
      expectation: 'enforced',
      importLine: 'import { query } from "@kovojs/server";',
      kind: 'wrapper-helper',
      label: 'wrapper helper call',
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
      expectation: 'enforced',
      importLine: 'import * as browser from "@kovojs/browser";',
      kind: 'namespace-import',
      label: 'trustedHtml namespace member',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{browser.trustedHtml(post.body)}</article>,
});
`,
    },
    {
      expectation: 'enforced',
      extraFiles: [
        {
          fileName: 'browser-root.ts',
          source: 'export { trustedHtml, trustedUrl } from "@kovojs/browser";',
        },
        {
          fileName: 'browser-barrel.ts',
          source: 'export * from "./browser-root";',
        },
      ],
      importLine: 'import * as browser from "./browser-barrel.js";',
      kind: 're-export-barrel',
      label: 'trustedHtml/trustedUrl export-star literal element access',
      source: `
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => (
    <article>
      {browser['trustedHtml'](post.body)}
      <a href={browser['trustedUrl'](post.href)}>read</a>
    </article>
  ),
});
`,
    },
    {
      expectation: 'enforced',
      importLine: 'import { trustedHtml } from "@kovojs/browser";',
      kind: 'local-alias',
      label: 'trustedHtml local const alias',
      source: `
const th = trustedHtml;
export const Post = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
    },
    {
      expectation: 'enforced',
      importLine: 'import { trustedHtml } from "@kovojs/browser";',
      kind: 'wrapper-helper',
      label: 'trustedHtml wrapper helper',
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
      expectation: 'enforced',
      kind: 'destructured-binding',
      label: 'destructured query field',
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
      expectation: 'enforced',
      kind: 'wrapper-helper',
      label: 'closure helper returning query value',
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
    {
      expectation: 'enforced',
      kind: 'function-helper',
      label: 'function declaration returning query value',
      source: `
export const CartBadge = component({
  queries: { cart: {} },
  disableServerRefresh: true,
  render: () => {
    function readCount() {
      return cart.count + 1;
    }
    const label = readCount();
    return <cart-badge>{label}</cart-badge>;
  },
});
`,
    },
  ];
}

function directDbHandlerVariants(): readonly CompilerExpressionVariant[] {
  return [
    {
      expectation: 'enforced',
      importLine: 'import { task, webhook } from "@kovojs/server";',
      kind: 'control',
      label: 'direct task/webhook imports',
      source: directDbTaskWebhookSource({ taskCallee: 'task', webhookCallee: 'webhook' }),
    },
    {
      expectation: 'enforced',
      importLine: 'import { task as defineTask, webhook as defineWebhook } from "@kovojs/server";',
      kind: 'import-alias',
      label: 'task/webhook named import aliases',
      source: directDbTaskWebhookSource({
        taskCallee: 'defineTask',
        webhookCallee: 'defineWebhook',
      }),
    },
    {
      expectation: 'enforced',
      importLine: 'import * as srv from "@kovojs/server";',
      kind: 'namespace-import',
      label: 'task/webhook namespace members',
      source: directDbTaskWebhookSource({ taskCallee: 'srv.task', webhookCallee: 'srv.webhook' }),
    },
    {
      expectation: 'enforced',
      extraFiles: [
        {
          fileName: 'server-barrel.ts',
          source: 'export { task as defineTask, webhook as defineWebhook } from "@kovojs/server";',
        },
      ],
      importLine: 'import { defineTask, defineWebhook } from "./server-barrel";',
      kind: 're-export-barrel',
      label: 'task/webhook local barrel re-export',
      source: directDbTaskWebhookSource({
        taskCallee: 'defineTask',
        webhookCallee: 'defineWebhook',
      }),
    },
    {
      expectation: 'enforced',
      importLine: 'import { task, webhook } from "@kovojs/server";',
      kind: 'wrapper-helper',
      label: 'handler-local wrapper helper write',
      source: directDbTaskWebhookSource({
        taskBody: [
          'function writeAudit() {',
          '  return appDb.insert(auditRows).values({ id: input.id });',
          '}',
          'await writeAudit();',
        ],
        taskCallee: 'task',
        webhookBody: [
          'function writeAudit() {',
          '  return appDb.insert(auditRows).values({ id: request.headers.get("x-id") });',
          '}',
          'await writeAudit();',
        ],
        webhookCallee: 'webhook',
      }),
    },
    {
      expectation: 'enforced',
      importLine: 'import { task, webhook } from "@kovojs/server";',
      kind: 'closure',
      label: 'handler-local closure write',
      source: directDbTaskWebhookSource({
        taskBody: [
          'const writeAudit = () => appDb.insert(auditRows).values({ id: input.id });',
          'await writeAudit();',
        ],
        taskCallee: 'task',
        webhookBody: [
          'const writeAudit = () => appDb.insert(auditRows).values({ id: request.headers.get("x-id") });',
          'await writeAudit();',
        ],
        webhookCallee: 'webhook',
      }),
    },
    {
      expectation: 'enforced',
      importLine: 'import { task, webhook } from "@kovojs/server";',
      kind: 'local-shadow',
      label: 'handler-local insert shadow fails closed',
      source: directDbTaskWebhookSource({
        taskBody: [
          'const local = { insert() { return { values() {} }; } };',
          'await local.insert(auditRows).values({ id: input.id });',
        ],
        taskCallee: 'task',
        webhookBody: [
          'const local = { insert() { return { values() {} }; } };',
          'await local.insert(auditRows).values({ id: request.headers.get("x-id") });',
        ],
        webhookCallee: 'webhook',
      }),
    },
  ];
}

function directDbTaskWebhookSource(options: {
  readonly taskBody?: readonly string[];
  readonly taskCallee: string;
  readonly webhookBody?: readonly string[];
  readonly webhookCallee: string;
}): string {
  const taskBody = options.taskBody ?? ['await appDb.insert(auditRows).values({ id: input.id });'];
  const webhookBody = options.webhookBody ?? [
    'await appDb.insert(auditRows).values({ id: request.headers.get("x-id") });',
  ];

  return `
export const auditTask = ${options.taskCallee}('audit/task', {
  async run(input, ctx) {
${indentLines(taskBody, 4)}
    await ctx.runMutation(recordAudit, input);
  },
});

export const auditWebhook = ${options.webhookCallee}('/webhooks/audit', {
  access: verifiedAccess,
  auth: auditAuth,
  async handler(request) {
${indentLines(webhookBody, 4)}
    return Response.json({ ok: true });
  },
});
`;
}

function indentLines(lines: readonly string[], spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return lines.map((line) => `${prefix}${line}`).join('\n');
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
  const result = compileComponentVariant(code, variant);
  const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === code);

  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    detail: diagnostics.map((diagnostic) => diagnostic.message),
  };
}

function runDirectDbHandlerVariant(variant: CompilerExpressionVariant): MetamorphicRunResult {
  const result = compileComponentVariant('KV330', variant);
  const diagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'KV330' || diagnostic.code === 'KV406',
  );
  const surfaces = new Set(result.handlerWriteSinkFacts.map((fact) => fact.surface));
  const hasRequiredFacts = surfaces.has('task') && surfaces.has('webhook');

  return {
    codes: hasRequiredFacts ? diagnostics.map((diagnostic) => diagnostic.code) : [],
    detail: [
      ...diagnostics.map((diagnostic) => diagnostic.message),
      ...result.handlerWriteSinkFacts.map(
        (fact) =>
          `${fact.surface}:${fact.owner.kind}:${fact.owner.value}:${fact.operationKind}:${fact.canonicalTarget.identity}`,
      ),
    ],
  };
}

function compileComponentVariant(
  code: Phase0MetamorphicCode,
  variant: CompilerExpressionVariant,
): ReturnType<typeof compileComponentModule> {
  const fileName = `${code.toLowerCase()}-${variant.kind}.${code === 'KV330' ? 'ts' : 'tsx'}`;
  const source = [variant.importLine ?? '', variant.source].filter(Boolean).join('\n');
  if (!variant.extraFiles?.length) return compileComponentModule({ fileName, source });

  // M2/E2: multi-file compiler security variants must exercise the same sibling-file resolver
  // collection used by Vite/kovo build, not certify a fixture-only `extraFiles` shortcut.
  const root = mkdtempSync(join(tmpdir(), 'kovo-metamorphic-resolver-'));
  try {
    writeMetamorphicSourceFile(root, fileName, source);
    for (const extraFile of variant.extraFiles) {
      writeMetamorphicSourceFile(root, extraFile.fileName, extraFile.source);
    }
    const extraFiles = viteFrameworkIdentityFiles(root, fileName, source);
    return compileComponentModule({
      ...(extraFiles.length === 0 ? {} : { extraFiles }),
      fileName,
      source,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function writeMetamorphicSourceFile(root: string, fileName: string, source: string): void {
  const path = join(root, fileName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source, 'utf8');
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
