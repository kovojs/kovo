#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { collectFilesAsync } from './lib/source-files.mjs';
import { canonicalizePackedTarball } from './lib/deterministic-tarball.mjs';
import { REQUIRED_CLASSIFIER_CORPORA } from './check-security-classifier-corpus.mjs';

const DEFAULT_ROOTS = {
  integration: ['tests/integration/specs'],
  vitest: ['scripts', 'tests', 'packages'],
};

const DEFAULT_HISTORY_NAME = 'timing-history.json';
const DEFAULT_DURATION_SECONDS = 5;
const STARTER_SHARD_COUNT = 10;
const PACKED_STARTER_MANIFEST = 'packed-kovo-packages.json';
const STARTER_CADENCES = new Set(['per-pr', 'nightly']);
const STARTER_LIST_TIMEOUT_MS = 120_000;
const MAX_LIVE_ACCEPTANCE_OUTPUT_BYTES = 32 * 1024 * 1024;
const STARTER_MIN_TIMEOUT_MS = 5 * 60_000;
const STARTER_MAX_TIMEOUT_MS = 30 * 60_000;
// The supervisor owns process launch, Vitest collection/reporting, and verified descendant cleanup
// outside the selected test's own watchdog. Keep those phases out of the test's deadline budget.
const STARTER_OUTER_PROCESS_HEADROOM_MS = 60_000;
const CREATE_KOVO_ACCEPTANCE_TEST_PATTERN =
  /^packages\/create-kovo\/src\/index\.(?:build\.(?:prod-artifact(?:\.[^.]+)*|runtime|scaffold(?:\.[^.]+)*)|example\.packed)\.test\.(?:mjs|ts|tsx|js)$/;
const packedStarterWorkspacePackages = [
  { name: '@kovojs/core', dir: 'core' },
  { name: '@kovojs/style', dir: 'style' },
  { name: '@kovojs/browser', dir: 'browser' },
  { name: '@kovojs/server', dir: 'server' },
  { name: '@kovojs/test', dir: 'test' },
  { name: '@kovojs/drizzle', dir: 'drizzle' },
  { name: '@kovojs/headless-ui', dir: 'headless-ui' },
  { name: '@kovojs/icons', dir: 'icons' },
  { name: '@kovojs/ui', dir: 'ui' },
  { name: '@kovojs/better-auth', dir: 'better-auth' },
  { name: '@kovojs/verify', dir: 'verify' },
  { name: '@kovojs/compiler', dir: 'compiler' },
  { name: '@kovojs/cli', dir: 'cli' },
  { name: 'create-kovo', dir: 'create-kovo' },
];

// This is the single ownership registry for create-kovo's build and packed-example acceptance
// tests. Selector-level starter entries refine an owned file; they never create a second owner.
// Keep lane names aligned with the one command that executes each file.
const CREATE_KOVO_ACCEPTANCE_OWNERS = [
  ['packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.assets.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.client-ip.test.ts', 'classifier'],
  ['packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.defer.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.headers.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-gate.test.ts', 'root'],
  ['packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime-runner.test.ts', 'root'],
  ['packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts', 'paranoid'],
  ['packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.security.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.sink-census.test.ts', 'c9'],
  ['packages/create-kovo/src/index.build.prod-artifact.table-security.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.runtime.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.scaffold.packed-postgres.test.ts', 'starter-packed'],
  ['packages/create-kovo/src/index.build.scaffold.packed-runtime.test.ts', 'starter-packed'],
  ['packages/create-kovo/src/index.build.scaffold.packed-sqlite.test.ts', 'starter-packed'],
  ['packages/create-kovo/src/index.build.scaffold.production.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.scaffold.source-check.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.scaffold.sqlite.test.ts', 'starter'],
  ['packages/create-kovo/src/index.build.scaffold.typecheck.test.ts', 'starter'],
  ['packages/create-kovo/src/index.example.packed.test.ts', 'starter-packed'],
].map(([file, lane]) => ({ file, lane }));

const CREATE_KOVO_ROOT_OWNED_FILES = new Set(
  CREATE_KOVO_ACCEPTANCE_OWNERS.filter((owner) => owner.lane === 'root').map((owner) => owner.file),
);
const CREATE_KOVO_NON_ROOT_OWNED_FILES = CREATE_KOVO_ACCEPTANCE_OWNERS.filter(
  (owner) => owner.lane !== 'root',
).map((owner) => owner.file);
const CONSOLIDATED_VITEST_FILES = new Set([
  // The G11 workflow owns this Node test directly through `node --test`; Vitest cannot collect its
  // `node:test` suites and would otherwise report the file as an empty test module.
  'scripts/g11-cloud-run-journey.test.mjs',
  // `static-core` owns the complete forcing mutation harness through
  // `check:security-gate-mutations`; a second full run in a generic root shard can exceed the
  // hosted-runner job budget without adding coverage.
  'scripts/security-gate-mutations.test.mjs',
  'packages/cli/src/index.kovo-compile.test.ts',
  'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.test.ts',
  'packages/core/src/diagnostics.test.ts',
  'packages/core/src/sql-safety.test.ts',
  ...CREATE_KOVO_NON_ROOT_OWNED_FILES,
  'packages/drizzle/src/runtime-surface.test.ts',
  'packages/drizzle/src/sql-safety-static.test.ts',
  'packages/server/src/guards.test.ts',
  'packages/test/src/pglite-harness.test.ts',
  'packages/test/src/query-verifier.test.ts',
  'packages/test/src/sqlite-harness.test.ts',
  'packages/test/src/verifier-sql.test.ts',
]);
const SECURITY_CLASSIFIER_CORPUS_FILES = new Set(
  REQUIRED_CLASSIFIER_CORPORA.flatMap((corpus) => corpus.testFiles),
);

const STARTER_ENTRIES = [
  {
    id: 'contacts-add-contact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'non-empty enhanced add-contact',
    // CI run 30685556558 measured the hosted marker at about 256.8s.
    seconds: 257,
    testTimeoutMs: 600_000,
  },
  {
    id: 'contacts-sqlite-add-contact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'generated SQLite add-contact',
    // CI run 30622986364 measured this focused case at 268.548s.
    seconds: 269,
  },
  {
    id: 'contacts-multi-component-refresh',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'multi-component modules',
    seconds: 73,
  },
  {
    id: 'contacts-idempotency-collisions',
    file: 'packages/create-kovo/src/index.build.prod-artifact.contacts.test.ts',
    testName: 'idempotency token collisions',
    // CI run 30622986364 measured this focused case at 251.757s.
    seconds: 252,
  },
  {
    id: 'security-auth-helper',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
    // CI run 30612746165 measured this focused entry at 425.980s.
    seconds: 426,
  },
  {
    id: 'security-raw-html-helper-imports',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'raw-HTML helper imports',
    seconds: 44,
  },
  {
    id: 'security-query-loader-storage-writes',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'storage writes from query loaders',
    seconds: 72,
  },
  {
    id: 'security-mutation-storage-writes',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'declared mutation storage writes',
    seconds: 74,
  },
  {
    id: 'security-trusted-output-provenance',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'trusted output provenance leaks',
    // CI run 30622986364 measured this focused proof at 390.476s.
    seconds: 391,
  },
  {
    id: 'security-trusted-url-attributes',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'TrustedUrl values in non-URL JSX attributes',
    // CI run 30622986364 measured this focused proof at 10.555s.
    seconds: 11,
  },
  ...['postgres', 'sqlite'].map((dialect) => ({
    id: `security-runtime-wires-${dialect}`,
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: `serves ${dialect} runtime-security wire escaping`,
    // CI run 30685556558 exceeded 300s for the former two-dialect selector. Split the observed
    // lower bound evenly until the first independent hosted timings replace these weights.
    seconds: 151,
    // generatedStarterTestTimeout({ cliProcessCount: 1, serverProcessCount: 1 }) is 820s in CI.
    testTimeoutMs: 820_000,
  })),
  {
    id: 'security-form-error',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'FormError',
    // CI run 30622986364 reached 279.609s before the former 240s deadline was reported.
    seconds: 280,
  },
  {
    id: 'security-starter-mutation-source-contract',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'augments the current app-scoped starter mutation shape without disabling CSRF',
    seconds: 5,
  },
  ...[
    [
      'security-summarized-mutation-laundering',
      'rejects summarized mutation input laundering through the real production build preflight',
    ],
    [
      'security-no-row-side-effect',
      'fails the production build for a request-reachable no-row side-effect mutation with no access guard',
    ],
    [
      'security-runtime-db-import',
      'blocks request-authored runtime DB imports from the production build artifact',
    ],
    [
      'security-import-equals-authority',
      'blocks runtime TypeScript import-equals authority in production preflight',
    ],
    [
      'security-reexported-import-equals-authority',
      'blocks authority under a route reached through a re-exported import-equals namespace',
    ],
    [
      'security-shadowed-route-authority',
      'blocks authority when lexical shadows and mutable aliases obscure route factories',
    ],
    [
      'security-secret-drizzle-view',
      'refuses a runtime Secret read through a Drizzle view before paranoid artifact emission',
    ],
    [
      'security-request-closed-reveal',
      'rejects request-reachable audited reveal imports before production artifact emission',
    ],
    [
      'security-postgres-reader-denial',
      'distinguishes Postgres reader-role denials from runtime Secret wire refusal',
    ],
    [
      'security-starter-db-scope-drift',
      'rejects statically visible starter DB scope drift before artifact emission',
    ],
    [
      'security-starter-table-scope',
      'enforces starter mutation DB table scope in paranoid production artifacts',
    ],
    [
      'security-sqlite-source-provenance',
      'boxes SQLite secret reads by source provenance while serving proven non-secret projections in paranoid mode',
    ],
    [
      'security-declared-controls',
      'serves only compiler-declared controls and session-transition reload hints from the production artifact',
    ],
  ].map(([id, testName]) => ({
    id,
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName,
    cadence: 'nightly',
    seconds: 600,
  })),
  {
    id: 'm1-storage-write-provenance',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName:
      'M1:storage-write tracks storage write gates from current postgres production source, not stale cache',
    expectedTestCount: 1,
    // CI run 30694384762 exceeded the former broad selector's 420s outer bound. Exact-SHA local
    // profiling measured this three-build proof at 250.182s; 355s preserves its proportional share
    // of the hosted lower bound until an independently completed hosted marker replaces the weight.
    seconds: 355,
    testTimeoutMs: 720_000,
  },
  {
    id: 'm1-storage-write-fixture-contract',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:storage-write fixture uses the current app-scoped declaration contract',
    expectedTestCount: 1,
    // Exact-SHA CI-mode profiling measured this source-only proof at 0.175s.
    seconds: 5,
  },
  {
    id: 'm1-storage-write-opaque',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:storage-write keeps opaque storage authority on the postgres KV424 path',
    expectedTestCount: 1,
    // Exact-SHA local profiling measured this one-build proof at 46.743s. Scale its scheduling
    // weight with the same hosted lower-bound ratio as the provenance sibling.
    seconds: 67,
    testTimeoutMs: 480_000,
  },
  {
    id: 'm1-raw-html-provenance',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:raw-html tracks trusted output provenance',
    // CI-mode profiling on 2026-08-01 measured the three-build proof at 460.884s. Its source-level
    // multi-build watchdog is 720s, so the outer supervisor must retain cleanup headroom beyond it.
    seconds: 461,
    testTimeoutMs: 720_000,
  },
  {
    id: 'm1-raw-html-mutable-alias',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:raw-html keeps mutable trusted-output aliases',
    // CI-mode profiling on 2026-08-01 measured this independent one-build proof at 49.505s.
    seconds: 50,
  },
  {
    id: 'm1-secret-wire',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:secret-wire',
    expectedTestCount: 4,
    seconds: 153,
  },
  {
    id: 'm1-safe-secret-wire',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:safe-secret-wire',
    seconds: 144,
  },
  ...['postgres', 'sqlite'].map((dialect) => ({
    id: `m1-${dialect}-raw-sql`,
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: `M1:${dialect}-raw-sql`,
    // CI run 30685556558 exceeded 300s for the former four-build, two-dialect selector. Split the
    // observed lower bound evenly until independent hosted timings replace these weights.
    seconds: 151,
    testTimeoutMs: 480_000,
  })),
  {
    id: 'm1-output-wire',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'M1:output-wire',
    expectedTestCount: 3,
    // CI run 30622986364 measured the filtered file at 747.315s across both dialects.
    seconds: 748,
  },
  {
    id: 'bugz-fixture-format',
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName: 'keeps BUGZ25/31 production fixtures formatter-clean before build preflight',
    seconds: 10,
  },
  ...[
    [
      'adversarial-diagnostic-assertion',
      'fails the diagnostic assertion when an unchanged production build succeeds',
    ],
    [
      'adversarial-bugz25-postgres',
      'bugz-25: composed concurrency provenance fails closed in the postgres production build',
    ],
    ...[
      'ordinary-carriers',
      'projection-carriers',
      'array-result-carriers',
      'iterable-binding-carriers',
      'assignment-targets',
      'loop-and-exhaustion-targets',
    ].map((carrier) => [
      `adversarial-bugz31-${carrier}`,
      `bugz-31: exact global member ${carrier} fail closed in a production artifact`,
    ]),
    [
      'adversarial-bugz31-assimilation',
      'bugz-31: helper, container, reflection, and Promise callback assimilation fail the production build',
    ],
    [
      'adversarial-bugz31-root-provenance',
      'bugz-31: trusted input mutation and authored result laundering fail the production build',
    ],
    [
      'adversarial-bugz31-namespace-members-postgres',
      'bugz-31: exact global namespace-member replacements fail the postgres production build',
    ],
  ].map(([id, testName]) => ({
    id,
    file: 'packages/create-kovo/src/index.build.prod-artifact.adversarial.test.ts',
    testName,
    cadence: 'nightly',
    seconds: 420,
  })),
  {
    id: 'raw-sql-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
    // CI run 30622986364 measured this file at 117.067s.
    seconds: 118,
  },
  {
    id: 'starter-typecheck',
    file: 'packages/create-kovo/src/index.build.scaffold.typecheck.test.ts',
    // CI run 30622986364 measured this file at 453.798s when the generated harness exhausted its
    // former fixed readiness budget after the verified build.
    seconds: 454,
  },
  {
    id: 'asset-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.assets.test.ts',
    seconds: 74,
  },
  {
    id: 'runtime-dev-server',
    file: 'packages/create-kovo/src/index.build.runtime.test.ts',
    // CI run 30622986364 measured the complete file at 681.475s while the two synchronous
    // production builds crossed their former 180s deadlines.
    seconds: 682,
  },
  {
    id: 'postgres-external-pglite-refusal',
    file: 'packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts',
    testName: 'refuses a production artifact that resolves to in-process PGlite',
    // Cold tsgolint dominated the latest exact baseline at 900.273s. This slice preserves that
    // work and gives it a process bound; it does not attempt to optimize the compiler cold path.
    seconds: 901,
  },
  {
    id: 'postgres-external-real-postgres',
    file: 'packages/create-kovo/src/index.build.prod-artifact.postgres-external.test.ts',
    testName:
      'deploys the generated Postgres starter against admin-provisioned external Postgres with a least-privilege runtime URL',
    needsPostgres: true,
    seconds: 156,
  },
  {
    id: 'starter-sqlite-check',
    file: 'packages/create-kovo/src/index.build.scaffold.sqlite.test.ts',
    testName: 'runs kovo check in the generated SQLite app',
    // CI run 30685556558 exceeded 300s for the former two-CLI whole-file selector. Split the
    // observed lower bound evenly until independent hosted timings replace these weights.
    seconds: 151,
    // generatedStarterTestTimeout({ cliProcessCount: 1 }) is 620s in CI.
    testTimeoutMs: 620_000,
  },
  {
    id: 'starter-sqlite-parser-dependency',
    file: 'packages/create-kovo/src/index.build.scaffold.sqlite.test.ts',
    testName: 'declares pgsql-ast-parser in the generated SQLite app package',
    seconds: 5,
  },
  {
    id: 'starter-sqlite-durable-task-refusal',
    file: 'packages/create-kovo/src/index.build.scaffold.sqlite.test.ts',
    testName: 'fails production build when a SQLite app registers durable tasks',
    // This is the second CLI-backed half of the former selector's hosted >300s lower bound.
    seconds: 151,
    testTimeoutMs: 620_000,
  },
  {
    id: 'starter-production-graph-gate',
    file: 'packages/create-kovo/src/index.build.scaffold.production.test.ts',
    testName: 'runs the generated production build graph gate',
    expectedTestCount: 1,
    // CI run 30694384762 exceeded the former two-test selector's 418s outer bound. Exact-SHA
    // CI-mode profiling measured this independent build at 134.266s.
    seconds: 141,
    testTimeoutMs: 360_000,
  },
  {
    id: 'starter-production-warm-cache',
    file: 'packages/create-kovo/src/index.build.scaffold.production.test.ts',
    testName: 'rebuilds production artifacts from current source when cache is warm',
    expectedTestCount: 1,
    // The same local profile measured this two-build proof at 264.040s. Its hosted-lower-bound
    // scheduling share is kept separate from the graph gate and its 600s test watchdog.
    seconds: 277,
    testTimeoutMs: 600_000,
  },
  {
    id: 'starter-source-check-postgres',
    file: 'packages/create-kovo/src/index.build.scaffold.source-check.test.ts',
    testName: 'passes the generated postgres quick check without claiming deployment retention',
    seconds: 240,
  },
  {
    id: 'starter-source-check-sqlite',
    file: 'packages/create-kovo/src/index.build.scaffold.source-check.test.ts',
    testName: 'passes the generated sqlite quick check without claiming deployment retention',
    seconds: 240,
  },
  {
    id: 'table-security-paranoid-preflight',
    file: 'packages/create-kovo/src/index.build.prod-artifact.table-security.test.ts',
    testName: 'rejects an exact Drizzle annotation-slot replacement during paranoid preflight',
    seconds: 300,
  },
  {
    id: 'starter-packed-postgres',
    file: 'packages/create-kovo/src/index.build.scaffold.packed-postgres.test.ts',
    needsPacked: true,
    seconds: 7,
  },
  {
    id: 'durable-task-retries',
    file: 'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.retries.test.ts',
    // CI run 30612746165 reached 162.930s before the old worker deadline aborted the build; a clean
    // complete replay under the concurrent verification load took 380.663s.
    seconds: 381,
  },
  {
    id: 'starter-packed-sqlite',
    file: 'packages/create-kovo/src/index.build.scaffold.packed-sqlite.test.ts',
    needsPacked: true,
    seconds: 7,
  },
  {
    id: 'transaction-default-served-artifact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'rolls back default mutation transactions and executes webhook mutation composition',
    seconds: 78,
  },
  {
    id: 'transaction-readonly-runtime-floor',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'keeps query writes KV449-closed when the dedicated KV433 finding is advisory',
    seconds: 60,
  },
  {
    id: 'transaction-managed-write-escape-default',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: "blocks managed write raw-driver escapes before 'default' artifact emission",
    seconds: 70,
  },
  {
    id: 'transaction-managed-write-escape-sqlite',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: "blocks managed write raw-driver escapes before 'SQLite' artifact emission",
    seconds: 70,
  },
  {
    id: 'transaction-readonly-escape-default',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: "blocks 'default' readonly DB computed-method escapes before artifact emission",
    seconds: 70,
  },
  {
    id: 'transaction-readonly-escape-sqlite',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: "blocks 'SQLite' readonly DB computed-method escapes before artifact emission",
    seconds: 70,
  },
  {
    id: 'transaction-sqlite-served-artifact',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName:
      'serves SQLite readonly reads and executes webhook mutation composition in the production artifact',
    // CI run 30622986364 measured this focused served-artifact proof at 209.596s.
    seconds: 210,
  },
  {
    id: 'transaction-webhook-escape-default',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: "blocks 'default' webhook context.tx raw-driver escapes before artifact emission",
    // The sibling proof in the same hosted command completed in 89.489s.
    seconds: 90,
  },
  {
    id: 'transaction-webhook-escape-sqlite',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: "blocks 'SQLite' webhook context.tx raw-driver escapes before artifact emission",
    seconds: 70,
  },
  {
    id: 'starter-packed-runtime',
    file: 'packages/create-kovo/src/index.build.scaffold.packed-runtime.test.ts',
    needsPacked: true,
    seconds: 195,
  },
  {
    id: 'starter-packed-examples',
    file: 'packages/create-kovo/src/index.example.packed.test.ts',
    needsPacked: true,
    // Provisional upper bound: two independently capped 600s consumers. Replace this estimate
    // with the first green same-manifest packed-artifact duration.
    seconds: 1_200,
  },
  {
    id: 'runtime-contract-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.runtime-contracts.test.ts',
    seconds: 70,
  },
  {
    id: 'durable-task-lifecycle',
    file: 'packages/create-kovo/src/index.build.prod-artifact.durable-tasks.lifecycle.test.ts',
    // CI run 30622986364 measured this focused proof at 562.737s.
    seconds: 563,
  },
  {
    id: 'defer-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.defer.test.ts',
    // CI run 30612746165 measured the two sequential cases at 575.795s total.
    seconds: 576,
  },
  {
    id: 'header-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.headers.test.ts',
    // CI run 30685556558 exceeded the 300s outer floor in this irreducible one-build proof.
    seconds: 301,
    testTimeoutMs: 600_000,
  },
  {
    id: 'redirect-capability-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.redirect-capability.test.ts',
    // CI run 30612746165 measured this focused entry at 254.669s.
    seconds: 255,
  },
  {
    id: 'island-derive-artifacts',
    file: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    testName: 'hydrates destructured state aliases',
    // Exact-SHA hosted job 91344680274 exceeded the former 300s outer floor. Keep that observed
    // lower bound for balancing and the source-level 600s watchdog for bounded cleanup headroom.
    seconds: 301,
    testTimeoutMs: 600_000,
    needsBrowser: true,
  },
  {
    id: 'island-derive-helper-preflight',
    file: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    testName: 'rejects unbound module-helper state derives',
    // CI-mode profiling on 2026-08-01 measured the non-browser build proof at 66.782s.
    seconds: 67,
    // The test uses PRODUCTION_ARTIFACT_TEST_TIMEOUT_MS (600s in CI); the supervisor must not
    // preempt that inner watchdog even though the scheduling weight remains evidence-based.
    testTimeoutMs: 600_000,
  },
];

export function percentile(values, ratio) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function unknownDurationSeconds(history, fallback = DEFAULT_DURATION_SECONDS) {
  const durations = Object.values(history ?? {}).map((entry) => Number(entry?.seconds ?? entry));
  return percentile(durations, 0.75) ?? percentile(durations, 0.5) ?? fallback;
}

export function balanceShards(files, history = {}, shardCount, options = {}) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, received ${String(shardCount)}`);
  }
  const defaultDuration = options.defaultDurationSeconds ?? unknownDurationSeconds(history);
  const estimates = [...files]
    .sort((a, b) => {
      const durationDelta =
        estimateSeconds(history, b, defaultDuration) - estimateSeconds(history, a, defaultDuration);
      return durationDelta || a.localeCompare(b);
    })
    .map((file) => ({ file, seconds: estimateSeconds(history, file, defaultDuration) }));
  const shards = Array.from({ length: shardCount }, () => ({ files: [], seconds: 0 }));

  for (const estimate of estimates) {
    const lightest = shards
      .map((shard, index) => ({ index, seconds: shard.seconds }))
      .sort((a, b) => a.seconds - b.seconds || a.index - b.index)[0];
    const shard = shards[lightest.index];
    shard.files.push(estimate.file);
    shard.seconds += estimate.seconds;
  }

  for (const shard of shards) {
    shard.files.sort((a, b) => a.localeCompare(b));
    shard.seconds = Math.round(shard.seconds * 1000) / 1000;
  }
  validateShardAssignment(files, shards);
  return shards;
}

export function starterEntries() {
  return STARTER_ENTRIES.map((entry) => ({
    ...entry,
    cadence: entry.cadence ?? 'per-pr',
    timeoutMs: starterEntryTimeoutMs(entry),
  }));
}

export function starterEntriesForMode(mode = 'all', cadence = 'all') {
  if (cadence !== 'all' && !STARTER_CADENCES.has(cadence)) {
    throw new Error(`Unknown starter cadence: ${cadence}`);
  }
  let entries = starterEntries();
  if (mode === 'packed') entries = entries.filter((entry) => entry.needsPacked);
  else if (mode === 'unpacked') entries = entries.filter((entry) => !entry.needsPacked);
  else if (mode !== 'all') throw new Error(`Unknown starter mode: ${mode}`);
  return cadence === 'all' ? entries : entries.filter((entry) => entry.cadence === cadence);
}

export function createKovoAcceptanceOwners() {
  return CREATE_KOVO_ACCEPTANCE_OWNERS.map((owner) => ({ ...owner }));
}

export async function discoverCreateKovoAcceptanceTests() {
  const files = await discoverFromRoot('packages/create-kovo/src', 'acceptance');
  return files.filter((file) => CREATE_KOVO_ACCEPTANCE_TEST_PATTERN.test(file));
}

export function validateCreateKovoAcceptanceOwnership(discoveredFiles, entries = starterEntries()) {
  const discovered = [...new Set(discoveredFiles)].sort();
  const ownerCounts = new Map();
  for (const owner of CREATE_KOVO_ACCEPTANCE_OWNERS) {
    ownerCounts.set(owner.file, (ownerCounts.get(owner.file) ?? 0) + 1);
  }
  const missing = discovered.filter((file) => !ownerCounts.has(file));
  const stale = [...ownerCounts.keys()].filter((file) => !discovered.includes(file));
  const duplicated = [...ownerCounts].filter(([, count]) => count !== 1).map(([file]) => file);
  if (missing.length > 0 || stale.length > 0 || duplicated.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing owners: ${missing.join(', ')}`);
    if (stale.length > 0) parts.push(`stale owners: ${stale.join(', ')}`);
    if (duplicated.length > 0) parts.push(`duplicated owners: ${duplicated.join(', ')}`);
    throw new Error(`Invalid create-kovo acceptance ownership (${parts.join('; ')})`);
  }

  const entryIds = new Set();
  for (const entry of entries) {
    if (entryIds.has(entry.id)) throw new Error(`Duplicate starter entry id: ${entry.id}`);
    entryIds.add(entry.id);
    if (!STARTER_CADENCES.has(entry.cadence)) {
      throw new Error(`Starter entry ${entry.id} has invalid cadence ${String(entry.cadence)}`);
    }
    if (!Number.isFinite(entry.seconds) || entry.seconds <= 0) {
      throw new Error(`Starter entry ${entry.id} has invalid seconds ${String(entry.seconds)}`);
    }
    if (entry.testName !== undefined && (typeof entry.testName !== 'string' || !entry.testName)) {
      throw new Error(`Starter entry ${entry.id} has an invalid testName selector`);
    }
    if (
      entry.expectedTestCount !== undefined &&
      (!Number.isInteger(entry.expectedTestCount) || entry.expectedTestCount < 1)
    ) {
      throw new Error(
        `Starter entry ${entry.id} has invalid expectedTestCount ${String(entry.expectedTestCount)}`,
      );
    }
    if (
      entry.testTimeoutMs !== undefined &&
      (!Number.isInteger(entry.testTimeoutMs) ||
        entry.testTimeoutMs <= 0 ||
        entry.testTimeoutMs + STARTER_OUTER_PROCESS_HEADROOM_MS > STARTER_MAX_TIMEOUT_MS)
    ) {
      throw new Error(
        `Starter entry ${entry.id} has invalid testTimeoutMs ${String(entry.testTimeoutMs)}`,
      );
    }
    if (
      !Number.isInteger(entry.timeoutMs) ||
      entry.timeoutMs < STARTER_MIN_TIMEOUT_MS ||
      entry.timeoutMs > STARTER_MAX_TIMEOUT_MS
    ) {
      throw new Error(`Starter entry ${entry.id} has invalid timeoutMs ${String(entry.timeoutMs)}`);
    }
    if (
      entry.testTimeoutMs !== undefined &&
      entry.timeoutMs < entry.testTimeoutMs + STARTER_OUTER_PROCESS_HEADROOM_MS
    ) {
      throw new Error(
        `Starter entry ${entry.id} outer timeout ${entry.timeoutMs} must retain ${STARTER_OUTER_PROCESS_HEADROOM_MS}ms beyond its test timeout ${entry.testTimeoutMs}`,
      );
    }
  }

  const ownersByFile = new Map(CREATE_KOVO_ACCEPTANCE_OWNERS.map((owner) => [owner.file, owner]));
  for (const owner of CREATE_KOVO_ACCEPTANCE_OWNERS) {
    const ownedEntries = entries.filter((entry) => entry.file === owner.file);
    const starterOwned = owner.lane === 'starter' || owner.lane === 'starter-packed';
    if (starterOwned && ownedEntries.length === 0) {
      throw new Error(`Starter-owned acceptance file has no entries: ${owner.file}`);
    }
    if (!starterOwned && ownedEntries.length > 0) {
      throw new Error(
        `${owner.lane}-owned acceptance file also has starter entries: ${owner.file}`,
      );
    }
    if (
      owner.lane === 'starter-packed' &&
      ownedEntries.some((entry) => entry.needsPacked !== true)
    ) {
      throw new Error(`Packed starter owner has an unpacked entry: ${owner.file}`);
    }
    if (owner.lane === 'starter' && ownedEntries.some((entry) => entry.needsPacked === true)) {
      throw new Error(`Unpacked starter owner has a packed entry: ${owner.file}`);
    }
  }
  for (const entry of entries) {
    if (!CREATE_KOVO_ACCEPTANCE_TEST_PATTERN.test(entry.file)) continue;
    if (!ownersByFile.has(entry.file)) {
      throw new Error(
        `Starter entry targets an unowned create-kovo acceptance file: ${entry.file}`,
      );
    }
  }
  return true;
}

export function balanceStarterShards(shardCount = STARTER_SHARD_COUNT, entries = starterEntries()) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, received ${String(shardCount)}`);
  }
  const estimates = [...entries]
    .sort((a, b) => b.seconds - a.seconds || a.id.localeCompare(b.id))
    .map((entry) => ({ ...entry }));
  const shards = Array.from({ length: shardCount }, () => ({ entries: [], seconds: 0 }));

  for (const estimate of estimates) {
    const lightest = shards
      .map((shard, index) => ({ index, seconds: shard.seconds }))
      .sort((a, b) => a.seconds - b.seconds || a.index - b.index)[0];
    const shard = shards[lightest.index];
    shard.entries.push(estimate);
    shard.seconds += estimate.seconds;
  }

  for (const shard of shards) {
    shard.entries.sort((a, b) => a.id.localeCompare(b.id));
    shard.seconds = roundSeconds(shard.seconds);
  }
  validateStarterShardAssignment(entries, shards);
  return shards;
}

export function validateStarterShardAssignment(entries, shards) {
  const expected = new Set(entries.map((entry) => entry.id));
  const seen = new Map();
  for (const shard of shards) {
    for (const entry of shard.entries) {
      if (!expected.has(entry.id))
        throw new Error(`Starter shard assigned unknown entry: ${entry.id}`);
      seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
    }
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([id]) => id);
  if (missing.length > 0 || duplicated.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
    if (duplicated.length > 0) parts.push(`duplicated: ${duplicated.join(', ')}`);
    throw new Error(`Invalid starter shard assignment (${parts.join('; ')})`);
  }
}

export function validateShardAssignment(discoveredFiles, shards) {
  const expected = new Set(discoveredFiles);
  const seen = new Map();
  for (const shard of shards) {
    for (const file of shard.files) {
      if (!expected.has(file)) {
        throw new Error(`Shard assigned undiscovered test file: ${file}`);
      }
      seen.set(file, (seen.get(file) ?? 0) + 1);
    }
  }
  const missing = [...expected].filter((file) => !seen.has(file));
  const duplicated = [...seen].filter(([, count]) => count > 1).map(([file]) => file);
  if (missing.length > 0 || duplicated.length > 0) {
    const parts = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
    if (duplicated.length > 0) parts.push(`duplicated: ${duplicated.join(', ')}`);
    throw new Error(`Invalid shard assignment (${parts.join('; ')})`);
  }
}

export function mergeDurationHistory(previous = {}, latest = {}, options = {}) {
  const previousWeight = options.previousWeight ?? 0.7;
  const latestWeight = options.latestWeight ?? 0.3;
  const merged = {};
  for (const [key, value] of Object.entries(previous)) {
    const seconds = Number(value?.seconds ?? value);
    if (Number.isFinite(seconds) && seconds > 0) merged[key] = { seconds };
  }
  for (const [key, value] of Object.entries(latest)) {
    const latestSeconds = Number(value?.seconds ?? value);
    if (!Number.isFinite(latestSeconds) || latestSeconds <= 0) continue;
    const previousSeconds = merged[key]?.seconds;
    merged[key] = {
      seconds:
        previousSeconds === undefined
          ? roundSeconds(latestSeconds)
          : roundSeconds(previousSeconds * previousWeight + latestSeconds * latestWeight),
    };
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

export function combineDurationHistories(histories = []) {
  const durationsByFile = new Map();
  for (const history of histories) {
    if (!history || Array.isArray(history) || typeof history !== 'object') {
      throw new Error('Timing history must be a JSON object.');
    }
    for (const [file, value] of Object.entries(history)) {
      const seconds = Number(value?.seconds ?? value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`Timing history has an invalid duration for ${file}.`);
      }
      const durations = durationsByFile.get(file) ?? [];
      durations.push(seconds);
      durationsByFile.set(file, durations);
    }
  }

  return Object.fromEntries(
    [...durationsByFile]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, durations]) => [
        file,
        {
          seconds: roundSeconds(
            durations.toSorted((a, b) => a - b).reduce((total, seconds) => total + seconds, 0) /
              durations.length,
          ),
        },
      ]),
  );
}

export async function combineTimingHistoryDirectory(inputDir, outputFile) {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const artifactDirectories = entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const histories = await Promise.all(
    artifactDirectories.map((entry) =>
      readJson(path.join(inputDir, entry.name, DEFAULT_HISTORY_NAME)),
    ),
  );
  const combined = combineDurationHistories(histories);
  await writeJson(outputFile, combined);
  return combined;
}

export async function discoverTests(kind, options = {}) {
  const roots = options.roots ?? DEFAULT_ROOTS[kind];
  if (!roots) throw new Error(`Unknown shard kind: ${kind}`);
  const files = [];
  for (const root of roots) {
    files.push(...(await discoverFromRoot(root, kind)));
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export function extractVitestDurations(report) {
  const durations = {};
  visit(report, (node) => {
    const file = normalizeRelativeFile(
      node?.filepath ?? node?.file?.filepath ?? node?.file ?? node?.name,
    );
    const assertionDurationMs = Array.isArray(node?.assertionResults)
      ? node.assertionResults.reduce((total, assertion) => {
          const duration = Number(assertion?.duration);
          return Number.isFinite(duration) && duration > 0 ? total + duration : total;
        }, 0)
      : undefined;
    const durationMs = Number(
      node?.duration ??
        node?.time ??
        node?.perfStats?.runtime ??
        (assertionDurationMs && assertionDurationMs > 0 ? assertionDurationMs : undefined) ??
        (Number.isFinite(Number(node?.endTime)) && Number.isFinite(Number(node?.startTime))
          ? Number(node.endTime) - Number(node.startTime)
          : undefined),
    );
    if (!file || !Number.isFinite(durationMs) || durationMs <= 0) return;
    durations[file] = {
      seconds: roundSeconds(Math.max(durations[file]?.seconds ?? 0, durationMs / 1000)),
    };
  });
  return durations;
}

export function extractPlaywrightDurations(report) {
  const durations = {};
  visit(report, (node) => {
    const file = normalizeRelativeFile(node?.location?.file ?? node?.file);
    const project = node?.projectName ?? node?.project?.name ?? node?.project;
    const durationMs = Number(node?.duration);
    if (!file || !Number.isFinite(durationMs) || durationMs <= 0) return;
    const key = project ? `${project}:${file}` : file;
    durations[key] = { seconds: roundSeconds((durations[key]?.seconds ?? 0) + durationMs / 1000) };
  });
  return durations;
}

export async function writeShardManifests({
  kind,
  shardCount,
  shardIndex,
  historyPath,
  outputDir,
  roots,
}) {
  const files = await discoverTests(kind, roots === undefined ? {} : { roots });
  const history = await readJsonIfExists(historyPath);
  const shards = balanceShards(files, history, shardCount);
  const root = outputDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-shards');
  assertRunnerTempScoped(root);
  await mkdir(root, { recursive: true });
  for (let index = 0; index < shards.length; index += 1) {
    const file = path.join(root, `${kind}-${index + 1}-of-${shards.length}.txt`);
    await writeFile(file, `${shards[index].files.join('\n')}\n`);
  }
  const selected = shards[shardIndex - 1];
  if (!selected) throw new Error(`Shard index ${shardIndex} is outside 1..${shards.length}`);
  const selectedPath = path.join(root, `${kind}-${shardIndex}-of-${shards.length}.txt`);
  return { files, selectedPath, selected, shards };
}

export async function writeStarterShardManifest({
  shardCount,
  shardIndex,
  outputDir,
  mode = 'all',
  cadence = 'all',
}) {
  const entries = starterEntriesForMode(mode, cadence);
  const shards = balanceStarterShards(shardCount, entries);
  const root =
    outputDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-starter-shards');
  assertRunnerTempScoped(root);
  await mkdir(root, { recursive: true });
  for (let index = 0; index < shards.length; index += 1) {
    const file = path.join(
      root,
      starterManifestName({ cadence, mode, index: index + 1, count: shards.length }),
    );
    await writeJson(file, {
      kind: 'starter',
      mode,
      cadence,
      shardIndex: index + 1,
      shardCount: shards.length,
      seconds: shards[index].seconds,
      entries: shards[index].entries,
    });
  }
  const selected = shards[shardIndex - 1];
  if (!selected) throw new Error(`Shard index ${shardIndex} is outside 1..${shards.length}`);
  const selectedPath = path.join(
    root,
    starterManifestName({ cadence, mode, index: shardIndex, count: shards.length }),
  );
  return { cadence, entries, mode, selectedPath, selected, shards };
}

export async function readStarterShardManifest(file) {
  const manifest = await readJsonIfExists(file);
  if (manifest?.kind !== 'starter' || !Array.isArray(manifest.entries)) {
    throw new Error(`Invalid starter shard manifest: ${file}`);
  }
  for (const entry of manifest.entries) {
    if (
      typeof entry?.id !== 'string' ||
      typeof entry?.file !== 'string' ||
      !STARTER_CADENCES.has(entry?.cadence) ||
      !Number.isFinite(entry?.seconds) ||
      entry.seconds <= 0 ||
      (entry.testName !== undefined &&
        (typeof entry.testName !== 'string' || entry.testName.length === 0)) ||
      (entry.expectedTestCount !== undefined &&
        (!Number.isInteger(entry.expectedTestCount) || entry.expectedTestCount < 1)) ||
      (entry.testTimeoutMs !== undefined &&
        (!Number.isInteger(entry.testTimeoutMs) ||
          entry.testTimeoutMs <= 0 ||
          entry.testTimeoutMs + STARTER_OUTER_PROCESS_HEADROOM_MS > STARTER_MAX_TIMEOUT_MS)) ||
      !Number.isInteger(entry?.timeoutMs) ||
      entry.timeoutMs < STARTER_MIN_TIMEOUT_MS ||
      entry.timeoutMs > STARTER_MAX_TIMEOUT_MS ||
      (entry.testTimeoutMs !== undefined &&
        entry.timeoutMs < entry.testTimeoutMs + STARTER_OUTER_PROCESS_HEADROOM_MS)
    ) {
      throw new Error(`Starter shard manifest has an invalid bounded entry: ${file}`);
    }
  }
  return manifest;
}

export async function starterShardNeedsBrowser(file) {
  const manifest = await readStarterShardManifest(file);
  return manifest.entries.some((entry) => entry.needsBrowser);
}

export async function starterShardNeedsPacked(file) {
  const manifest = await readStarterShardManifest(file);
  return manifest.entries.some((entry) => entry.needsPacked);
}

export async function starterShardNeedsPostgres(file) {
  const manifest = await readStarterShardManifest(file);
  return manifest.entries.some((entry) => entry.needsPostgres);
}

export async function runStarterShard(file, options = {}) {
  const manifest = await readStarterShardManifest(file);
  await runStarterEntries(manifest.entries, options);
}

export async function runStarterEntries(entries, options = {}) {
  const runProcess = resolveAcceptanceProcessRunner(options);
  const environment = options.env ?? process.env;
  const packedPackagesDir = environment.KOVO_PACKED_PACKAGES_DIR?.trim();
  if (
    environment.KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES === 'packed-current' ||
    entries.some((entry) => entry.needsPacked)
  ) {
    if (!packedPackagesDir) {
      throw new Error('Packed-current starter execution requires KOVO_PACKED_PACKAGES_DIR.');
    }
    await validatePackedStarterDirectory(packedPackagesDir, environment);
  }
  const collectedByFile = new Map();
  for (const group of groupStarterEntriesForExecution(entries)) {
    const needsPacked = group.some((entry) => entry.needsPacked);
    const needsPostgres = group.some((entry) => entry.needsPostgres);
    if (needsPacked && !packedPackagesDir) {
      throw new Error(
        'Packed starter entries require KOVO_PACKED_PACKAGES_DIR from scripts/ci-shards.mjs pack-starter.',
      );
    }
    const groupEnvironment = needsPacked
      ? {
          ...environment,
          KOVO_PACKED_PACKAGES_DIR: packedPackagesDir,
          KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
        }
      : environment;
    if (needsPostgres) assertPostgresToolchain(options.postgresSpawnSync ?? spawnSync);
    let collectedTestNames = collectedByFile.get(group[0].file);
    if (!collectedTestNames) {
      collectedTestNames = await collectStarterGroupTestNames(group, runProcess, {
        env: groupEnvironment,
      });
      collectedByFile.set(group[0].file, collectedTestNames);
    }
    validateStarterGroupTestFilters(group, collectedTestNames);
    const args = starterGroupVitestArgs(group);
    process.stderr.write(
      `\n[starter:${group.map((entry) => entry.id).join(',')}] vp ${args.join(' ')}\n`,
    );
    const result = await runProcess({
      command: 'vp',
      args,
      cwd: process.cwd(),
      env: groupEnvironment,
      supervisorTimeoutMs: group.reduce((total, entry) => total + entry.timeoutMs, 0),
      maxOutputBytes: MAX_LIVE_ACCEPTANCE_OUTPUT_BYTES,
      captureOutput: false,
      forwardOutput: true,
    });
    writeCapturedProcessOutput(result);
    if (result?.error && !result?.timedOut) {
      throw new Error(
        `Starter entries ${group.map((entry) => entry.id).join(', ')} could not start: ${String(result.error?.message ?? result.error)}`,
        { cause: result.error },
      );
    }
    if (acceptanceProcessExitCode(result) !== 0) {
      throw new Error(
        `Starter entries ${group.map((entry) => entry.id).join(', ')} failed with ${starterSpawnOutcome(result)}`,
      );
    }
  }
}

export async function collectStarterGroupTestNames(
  group,
  runProcess = runAcceptanceTestProcess,
  options = {},
) {
  if (group.length === 0) throw new Error('Starter execution group cannot be empty.');
  const file = group[0].file;
  const result = await runProcess({
    command: 'vp',
    args: ['exec', 'vitest', 'list', file, '--json'],
    cwd: process.cwd(),
    env: options.env,
    supervisorTimeoutMs: STARTER_LIST_TIMEOUT_MS,
    maxOutputBytes: 16 * 1024 * 1024,
    captureOutput: true,
    forwardOutput: false,
  });
  if (result?.error && !result?.timedOut) {
    throw new Error(
      `Starter test collection for ${file} could not start: ${String(result.error?.message ?? result.error)}`,
      {
        cause: result.error,
      },
    );
  }
  if (acceptanceProcessExitCode(result) !== 0) {
    throw new Error(
      `Starter test collection for ${file} failed with ${starterSpawnOutcome(result)}`,
    );
  }

  let collected;
  try {
    collected = JSON.parse(String(result.stdout ?? ''));
  } catch (error) {
    throw new Error(`Starter test collection for ${file} returned invalid JSON`, { cause: error });
  }
  if (
    !Array.isArray(collected) ||
    collected.some((test) => !test || typeof test !== 'object' || typeof test.name !== 'string')
  ) {
    throw new Error(`Starter test collection for ${file} returned an invalid test list`);
  }
  if (collected.length === 0) {
    throw new Error(`Starter test collection for ${file} returned zero tests`);
  }
  return collected.map((test) => test.name);
}

export function validateStarterGroupTestFilters(group, collectedTestNames) {
  if (group.length === 0) throw new Error('Starter execution group cannot be empty.');
  const file = group[0].file;
  const unmatched = [];
  const countMismatches = [];
  for (const entry of group) {
    if (!entry.testName) continue;
    const matches = collectedTestNames.filter((testName) => testName.includes(entry.testName));
    if (matches.length === 0) {
      unmatched.push(`${entry.id}=${JSON.stringify(entry.testName)}`);
      continue;
    }
    const expectedTestCount = entry.expectedTestCount ?? 1;
    if (matches.length !== expectedTestCount) {
      countMismatches.push(`${entry.id}=${matches.length}/${expectedTestCount}`);
    }
  }
  if (unmatched.length > 0) {
    throw new Error(
      `Starter test filters matched zero collected tests in ${file}: ${unmatched.join(', ')}`,
    );
  }
  if (countMismatches.length > 0) {
    throw new Error(
      `Starter test filters matched an unexpected number of collected tests in ${file}: ${countMismatches.join(', ')}`,
    );
  }
}

export function validateStarterFileTestCoverage(fileEntries, collectedTestNames) {
  if (fileEntries.length === 0)
    throw new Error('Starter file coverage requires at least one entry.');
  const file = fileEntries[0].file;
  if (fileEntries.some((entry) => entry.file !== file)) {
    throw new Error('Starter file coverage entries must target exactly one file.');
  }
  validateStarterGroupTestFilters(fileEntries, collectedTestNames);
  const uncovered = [];
  const multiplyOwned = [];
  for (const testName of collectedTestNames) {
    const matching = fileEntries.filter(
      (entry) => !entry.testName || testName.includes(entry.testName),
    );
    if (matching.length === 0) uncovered.push(testName);
    if (matching.length > 1) {
      multiplyOwned.push(`${testName} => ${matching.map((entry) => entry.id).join(', ')}`);
    }
  }
  if (uncovered.length > 0 || multiplyOwned.length > 0) {
    const parts = [];
    if (uncovered.length > 0) parts.push(`unmatched: ${uncovered.join(' | ')}`);
    if (multiplyOwned.length > 0) parts.push(`multiply owned: ${multiplyOwned.join(' | ')}`);
    throw new Error(
      `Starter selector ownership is not exactly one in ${file} (${parts.join('; ')})`,
    );
  }
}

export async function validateAcceptanceTopology(options = {}) {
  const entries = starterEntries();
  const discoveredFiles = await discoverCreateKovoAcceptanceTests();
  validateCreateKovoAcceptanceOwnership(discoveredFiles, entries);
  const runProcess = resolveAcceptanceProcessRunner(options);
  const selectorGroups = groupStarterEntriesByFile(entries).filter((group) =>
    group.some((entry) => entry.testName),
  );
  for (const group of selectorGroups) {
    const collectedTestNames = await collectStarterGroupTestNames(group, runProcess, {
      env: options.env ?? process.env,
    });
    validateStarterFileTestCoverage(group, collectedTestNames);
  }
  return { discoveredFiles, selectorFiles: selectorGroups.map((group) => group[0].file) };
}

export async function runLocalStarter(options = {}) {
  const mode = options.mode ?? 'unpacked';
  const cadence = options.cadence ?? 'all';
  const concurrency = Number(options.concurrency ?? 1);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error(
      `Local starter concurrency must be an integer from 1 through 4; received ${concurrency}`,
    );
  }
  const entries = starterEntriesForMode(mode, cadence);
  if (entries.length === 0) throw new Error(`No starter entries selected for ${mode}/${cadence}`);
  await validateAcceptanceTopology(options);

  let packedRoot;
  let environment = options.env ?? process.env;
  const tempParent = process.env.CI ? process.env.RUNNER_TEMP : os.tmpdir();
  if (!tempParent) throw new Error('RUNNER_TEMP is required for starter execution in CI.');
  await mkdir(tempParent, { recursive: true });
  packedRoot = await mkdtemp(path.join(tempParent, 'kovo-local-packed-starter-'));

  try {
    await packStarterPackages(packedRoot, { ...options, env: environment });
    environment = {
      ...environment,
      KOVO_PACKED_PACKAGES_DIR: packedRoot,
      KOVO_STARTER_SOURCE_FIXTURE_DEPENDENCIES: 'packed-current',
    };
    const shards = balanceStarterShards(Math.min(concurrency, entries.length), entries);
    await Promise.all(
      shards.map((shard) => runStarterEntries(shard.entries, { ...options, env: environment })),
    );
  } finally {
    if (packedRoot) await rm(packedRoot, { force: true, recursive: true });
  }
}

export async function runRootTests(options = {}) {
  await validateAcceptanceTopology(options);
  const files = await discoverTests('vitest');
  const runProcess = resolveAcceptanceProcessRunner(options);
  const result = await runProcess({
    command: 'vp',
    args: ['exec', 'vitest', '--run', '--maxWorkers=1', ...files],
    cwd: process.cwd(),
    env: options.env ?? process.env,
    supervisorTimeoutMs: 2 * 60 * 60_000,
    maxOutputBytes: MAX_LIVE_ACCEPTANCE_OUTPUT_BYTES,
    captureOutput: false,
    forwardOutput: true,
  });
  writeCapturedProcessOutput(result);
  if (acceptanceProcessExitCode(result) !== 0) {
    throw new Error(`Root-owned Vitest route failed with ${starterSpawnOutcome(result)}`);
  }
}

// Narrow integration seam: the marker-safe process-tree supervisor can be injected here without
// coupling routing policy to its implementation module.
export async function runAcceptanceTestProcess(invocation, dependencies = {}) {
  const runBoundedTestProcess =
    dependencies.runBoundedTestProcess ??
    (await import('../packages/create-kovo/src/index.test-process-supervisor.mjs'))
      .runBoundedTestProcess;
  return runBoundedTestProcess({
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.cwd,
    env: invocation.env,
    supervisorTimeoutMs: invocation.supervisorTimeoutMs,
    maxOutputBytes: invocation.maxOutputBytes,
    captureOutput: invocation.captureOutput,
    forwardOutput: invocation.forwardOutput,
  });
}

function resolveAcceptanceProcessRunner(options) {
  if (options.runProcess) return options.runProcess;
  if (!options.spawnSync) return runAcceptanceTestProcess;
  return async (invocation) => {
    if (invocation.captureOutput && invocation.forwardOutput) {
      throw new Error('The synchronous acceptance test seam cannot capture and forward output.');
    }
    const result = options.spawnSync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      encoding: invocation.captureOutput ? 'utf8' : undefined,
      env: invocation.env,
      maxBuffer: invocation.maxOutputBytes,
      stdio: invocation.forwardOutput ? 'inherit' : invocation.captureOutput ? undefined : 'ignore',
      timeout: invocation.supervisorTimeoutMs,
    });
    return { ...result, exitCode: result.status };
  };
}

function acceptanceProcessExitCode(result) {
  if (result?.timedOut || result?.outputOverflowed || result?.cleanupError || result?.error) {
    return 1;
  }
  return result?.exitCode ?? result?.status ?? 0;
}

function writeCapturedProcessOutput(result) {
  if (result?.stdout) process.stdout.write(String(result.stdout));
  if (result?.stderr) process.stderr.write(String(result.stderr));
}

function assertPostgresToolchain(spawn) {
  for (const command of ['initdb', 'postgres']) {
    const result = spawn(command, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (result.error || result.status !== 0) {
      throw new Error(
        `Starter entry requires real Postgres, but ${command} is unavailable. Install PostgreSQL and expose its bin directory on PATH.`,
      );
    }
  }
}

export async function packStarterPackages(outputDir, options = {}) {
  const root = path.resolve(
    outputDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-packed-starter'),
  );
  assertRunnerTempScoped(root);
  await rm(root, { force: true, recursive: true });
  await mkdir(root, { recursive: true });
  const tarballs = {};
  const sha256 = {};
  const runProcess = resolveAcceptanceProcessRunner(options);

  for (const pkg of packedStarterWorkspacePackages) {
    const packageRoot = path.join(process.cwd(), 'packages', pkg.dir);
    const before = new Set((await readdir(root)).filter((file) => file.endsWith('.tgz')));
    const result = await runProcess({
      command: 'vp',
      args: ['exec', 'pnpm', 'pack', '--pack-destination', root],
      cwd: packageRoot,
      env: options.env ?? process.env,
      supervisorTimeoutMs: 5 * 60_000,
      maxOutputBytes: MAX_LIVE_ACCEPTANCE_OUTPUT_BYTES,
      captureOutput: false,
      forwardOutput: true,
    });
    writeCapturedProcessOutput(result);
    if (acceptanceProcessExitCode(result) !== 0) {
      throw new Error(
        `vp exec pnpm pack failed for ${pkg.name} with ${starterSpawnOutcome(result)}`,
      );
    }
    const created = (await readdir(root))
      .filter((file) => file.endsWith('.tgz') && !before.has(file))
      .sort();
    if (created.length !== 1) {
      throw new Error(`Expected one tarball for ${pkg.name}; found ${created.length}.`);
    }
    const tarball = path.join(root, created[0]);
    canonicalizePackedTarball(tarball);
    tarballs[pkg.name] = created[0];
    sha256[pkg.name] = createHash('sha256')
      .update(await readFile(tarball))
      .digest('hex');
  }

  await writeJson(path.join(root, PACKED_STARTER_MANIFEST), {
    generatedBy: 'scripts/ci-shards.mjs pack-starter',
    producer: packedStarterProducer(options.env ?? process.env),
    sha256,
    tarballs,
  });
  return root;
}

export async function validatePackedStarterDirectory(root, environment = process.env) {
  const manifest = await readJson(path.join(root, PACKED_STARTER_MANIFEST));
  if (manifest.generatedBy !== 'scripts/ci-shards.mjs pack-starter') {
    throw new Error('Packed starter manifest has an untrusted producer.');
  }
  const expectedProducer = packedStarterProducer(environment);
  if (
    expectedProducer.kind === 'github-actions' &&
    (manifest.producer?.kind !== expectedProducer.kind ||
      manifest.producer?.repository !== expectedProducer.repository ||
      manifest.producer?.runId !== expectedProducer.runId ||
      manifest.producer?.runAttempt !== expectedProducer.runAttempt ||
      manifest.producer?.sha !== expectedProducer.sha)
  ) {
    throw new Error('Packed starter manifest was not produced by this GitHub Actions run and SHA.');
  }
  const files = new Set(await readdir(root));
  const expectedPackages = new Set(packedStarterWorkspacePackages.map((pkg) => pkg.name));
  const declaredPackages = Object.keys(manifest.tarballs ?? {});
  const digestPackages = Object.keys(manifest.sha256 ?? {});
  if (
    declaredPackages.length !== expectedPackages.size ||
    declaredPackages.some((name) => !expectedPackages.has(name)) ||
    digestPackages.length !== expectedPackages.size ||
    digestPackages.some((name) => !expectedPackages.has(name))
  ) {
    throw new Error('Packed starter manifest does not declare the exact workspace package set.');
  }
  for (const packageName of expectedPackages) {
    const tarball = manifest.tarballs[packageName];
    if (typeof tarball !== 'string' || !files.has(tarball)) {
      throw new Error(`Packed starter manifest is missing the tarball for ${packageName}.`);
    }
    const digest = createHash('sha256')
      .update(await readFile(path.join(root, tarball)))
      .digest('hex');
    if (manifest.sha256[packageName] !== digest) {
      throw new Error(`Packed starter manifest has a digest mismatch for ${packageName}.`);
    }
  }
  return manifest;
}

function packedStarterProducer(environment) {
  if (environment.GITHUB_ACTIONS === 'true') {
    return {
      kind: 'github-actions',
      repository: environment.GITHUB_REPOSITORY ?? '',
      runId: environment.GITHUB_RUN_ID ?? '',
      runAttempt: environment.GITHUB_RUN_ATTEMPT ?? '',
      sha: environment.GITHUB_SHA ?? '',
    };
  }
  return { kind: 'local' };
}

export function groupStarterEntriesForExecution(entries) {
  return [...entries].sort((a, b) => a.id.localeCompare(b.id)).map((entry) => [entry]);
}

export function groupStarterEntriesByFile(entries) {
  const groupsByFile = new Map();
  for (const entry of entries) {
    const group = groupsByFile.get(entry.file) ?? [];
    group.push(entry);
    groupsByFile.set(entry.file, group);
  }
  return [...groupsByFile.values()].map((group) => group.sort((a, b) => a.id.localeCompare(b.id)));
}

export function starterGroupVitestArgs(group) {
  if (group.length === 0) throw new Error('Starter execution group cannot be empty.');
  const [first] = group;
  const args = ['exec', 'vitest', '--run', first.file];
  if (group.every((entry) => entry.testName)) {
    args.push('-t', starterTestNamePattern(group.map((entry) => entry.testName)));
  }
  return args;
}

function starterTestNamePattern(testNames) {
  return testNames.map(escapeRegExp).join('|');
}

function starterSpawnOutcome(result) {
  if (result?.timedOut) return 'a bounded-process timeout';
  if (result?.outputOverflowed) return 'the bounded output limit';
  if (result?.cleanupError) {
    return `a process-tree cleanup failure: ${String(result.cleanupError?.message ?? result.cleanupError)}`;
  }
  const exitCode = result?.exitCode ?? result?.status;
  if (exitCode !== null && exitCode !== undefined) {
    return `exit code ${exitCode}`;
  }
  if (result?.signal) return `signal ${result.signal}`;
  if (result?.error) return String(result.error?.message ?? result.error);
  return 'an unknown process status';
}

function starterManifestName({ cadence = 'all', mode, index, count }) {
  const modePrefix = mode === 'all' ? 'starter' : `starter-${mode}`;
  const cadencePrefix = cadence === 'all' ? modePrefix : `${modePrefix}-${cadence}`;
  return `${cadencePrefix}-${index}-of-${count}.json`;
}

function escapeRegExp(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function estimateSeconds(history, file, fallback) {
  const exact = Number(history?.[file]?.seconds ?? history?.[file]);
  if (Number.isFinite(exact) && exact > 0) return exact;
  const suffixMatch = Object.entries(history ?? {}).find(([key]) => key.endsWith(`:${file}`));
  const suffixSeconds = Number(suffixMatch?.[1]?.seconds ?? suffixMatch?.[1]);
  return Number.isFinite(suffixSeconds) && suffixSeconds > 0 ? suffixSeconds : fallback;
}

async function discoverFromRoot(root, kind) {
  return (
    await collectFilesAsync(path.resolve(root), ['.'], {
      absolute: true,
      includeFile: ({ absolutePath }) => {
        const relativePath = normalizeRelativeFile(absolutePath);
        if (kind === 'integration') return /(?:^|\/)[^/]+\.spec\.ts$/.test(relativePath);
        if (kind === 'acceptance') return CREATE_KOVO_ACCEPTANCE_TEST_PATTERN.test(relativePath);
        return (
          kind === 'vitest' &&
          /(?:^|\/)[^/]+\.test\.(?:mjs|ts|tsx|js)$/.test(relativePath) &&
          includeVitest(relativePath)
        );
      },
      skipDirectory: ({ relativePath }) => shouldSkipDirectory(normalizeRelativeFile(relativePath)),
    })
  ).map((file) => normalizeRelativeFile(file));
}

export function includeVitest(file) {
  return (
    !file.startsWith('tests/integration/') &&
    !file.startsWith('conformance/') &&
    // These are intentionally incomplete package-boundary fixtures, not root-project tests.
    !file.startsWith('scripts/fixtures/') &&
    !file.endsWith('.browser.test.ts') &&
    !file.includes('/templates/') &&
    (!CREATE_KOVO_ACCEPTANCE_TEST_PATTERN.test(file) || CREATE_KOVO_ROOT_OWNED_FILES.has(file)) &&
    !CONSOLIDATED_VITEST_FILES.has(file) &&
    // `static-core` runs the complete C13 corpus, including named CPU proofs in fresh processes.
    // Keeping those exact files out of broad root shards prevents duplicate load from changing a
    // performance verdict while the required security gate remains the single fail-closed owner.
    !SECURITY_CLASSIFIER_CORPUS_FILES.has(file)
  );
}

function shouldSkipDirectory(file) {
  return /(?:^|\/)(?:node_modules|dist|coverage|\.git|\.playwright|\.kovo)(?:\/|$)/.test(file);
}

function normalizeRelativeFile(file) {
  if (!file || typeof file !== 'string') return '';
  const normalized = path.relative(process.cwd(), path.resolve(file)).replaceAll('\\', '/');
  return normalized.startsWith('..') ? file.replaceAll('\\', '/') : normalized;
}

function visit(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
    return;
  }
  for (const item of Object.values(value)) visit(item, fn);
}

async function readJsonIfExists(file) {
  if (!file) return {};
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function assertRunnerTempScoped(outputDir) {
  if (!process.env.CI) return;
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp) throw new Error('RUNNER_TEMP is required in CI');
  const relative = path.relative(path.resolve(runnerTemp), path.resolve(outputDir));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Shard manifests must be written under RUNNER_TEMP; received ${outputDir}`);
  }
}

function roundSeconds(seconds) {
  return Math.round(seconds * 1000) / 1000;
}

function starterEntryTimeoutMs(entry) {
  const estimateMs = Math.ceil(Number(entry.seconds) * 2_000);
  const testWatchdogFloorMs =
    entry.testTimeoutMs === undefined
      ? 0
      : Number(entry.testTimeoutMs) + STARTER_OUTER_PROCESS_HEADROOM_MS;
  return Math.min(
    STARTER_MAX_TIMEOUT_MS,
    Math.max(
      STARTER_MIN_TIMEOUT_MS,
      Number.isFinite(estimateMs) ? estimateMs : 0,
      Number.isFinite(testWatchdogFloorMs) ? testWatchdogFloorMs : 0,
    ),
  );
}

function durationHistoryEntries(report) {
  if (!report || Array.isArray(report) || typeof report !== 'object') return undefined;
  const entries = Object.entries(report);
  if (entries.length === 0) return undefined;
  const durations = {};
  for (const [key, value] of entries) {
    const seconds = Number(value?.seconds ?? value);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    durations[key] = { seconds };
  }
  return durations;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args._ = [...(args._ ?? []), arg];
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  if (command === 'generate') {
    const kind = String(args.kind ?? 'vitest');
    const shardCount = Number(args.shards);
    const shardIndex = Number(args.index);
    const outputDir = String(
      args.outDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-shards'),
    );
    const historyPath = String(args.history ?? path.join(outputDir, DEFAULT_HISTORY_NAME));
    const result = await writeShardManifests({
      kind,
      shardCount,
      shardIndex,
      historyPath,
      outputDir,
    });
    process.stdout.write(`${result.selectedPath}\n`);
    process.stderr.write(
      `Generated ${kind} shard ${shardIndex}/${shardCount}: ${result.selected.files.length}/${result.files.length} files, estimate ${result.selected.seconds}s\n`,
    );
    return;
  }

  if (command === 'generate-starter') {
    const shardCount = Number(args.shards ?? STARTER_SHARD_COUNT);
    const shardIndex = Number(args.index);
    const mode = String(args.mode ?? 'all');
    const cadence = String(args.cadence ?? 'all');
    const outputDir = String(
      args.outDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-starter-shards'),
    );
    const result = await writeStarterShardManifest({
      cadence,
      shardCount,
      shardIndex,
      outputDir,
      mode,
    });
    process.stdout.write(`${result.selectedPath}\n`);
    process.stderr.write(
      `Generated starter ${result.mode}/${result.cadence} shard ${shardIndex}/${shardCount}: ${result.selected.entries.length}/${result.entries.length} entries, estimate ${result.selected.seconds}s\n`,
    );
    return;
  }

  if (command === 'starter-needs-browser') {
    process.exitCode = (await starterShardNeedsBrowser(String(args.manifest))) ? 0 : 1;
    return;
  }

  if (command === 'starter-needs-packed') {
    process.exitCode = (await starterShardNeedsPacked(String(args.manifest))) ? 0 : 1;
    return;
  }

  if (command === 'starter-needs-postgres') {
    process.exitCode = (await starterShardNeedsPostgres(String(args.manifest))) ? 0 : 1;
    return;
  }

  if (command === 'pack-starter') {
    const outputDir = String(
      args.outDir ?? path.join(process.env.RUNNER_TEMP ?? process.cwd(), 'kovo-packed-starter'),
    );
    const packedDir = await packStarterPackages(outputDir);
    process.stdout.write(`${packedDir}\n`);
    return;
  }

  if (command === 'run-starter') {
    await runStarterShard(String(args.manifest));
    return;
  }

  if (command === 'validate-acceptance-topology') {
    const result = await validateAcceptanceTopology();
    process.stdout.write(
      `Validated ${result.discoveredFiles.length} create-kovo acceptance files and exact selector coverage in ${result.selectorFiles.length} files.\n`,
    );
    return;
  }

  if (command === 'run-local-starter') {
    await runLocalStarter({
      cadence: String(args.cadence ?? 'all'),
      concurrency: Number(args.concurrency ?? 1),
      mode: String(args.mode ?? 'unpacked'),
    });
    return;
  }

  if (command === 'run-root') {
    await runRootTests();
    return;
  }

  if (command === 'combine-histories') {
    await combineTimingHistoryDirectory(String(args.inputDir), String(args.out));
    return;
  }

  if (command === 'merge-vitest' || command === 'merge-playwright') {
    const previous = await readJsonIfExists(args.previous);
    const report = await readJsonIfExists(args.report);
    const latest =
      command === 'merge-vitest'
        ? extractVitestDurations(report)
        : (durationHistoryEntries(report) ?? extractPlaywrightDurations(report));
    if (Object.keys(latest).length === 0) {
      throw new Error(`${command} did not find any duration entries in ${String(args.report)}`);
    }
    await writeJson(String(args.out), mergeDurationHistory(previous, latest));
    return;
  }

  throw new Error(`Usage:
  node scripts/ci-shards.mjs generate --kind vitest|integration --shards N --index N --outDir "$RUNNER_TEMP/kovo-shards" [--history file]
  node scripts/ci-shards.mjs generate-starter --mode all|packed|unpacked --cadence all|per-pr|nightly --shards N --index N --outDir "$RUNNER_TEMP/kovo-starter-shards"
  node scripts/ci-shards.mjs starter-needs-browser --manifest starter-shard.json
  node scripts/ci-shards.mjs starter-needs-packed --manifest starter-shard.json
  node scripts/ci-shards.mjs starter-needs-postgres --manifest starter-shard.json
  node scripts/ci-shards.mjs pack-starter --outDir "$RUNNER_TEMP/kovo-packed-starter"
  node scripts/ci-shards.mjs run-starter --manifest starter-shard.json
  node scripts/ci-shards.mjs validate-acceptance-topology
  node scripts/ci-shards.mjs run-local-starter --mode all|packed|unpacked --cadence all|per-pr|nightly --concurrency 1..4
  node scripts/ci-shards.mjs run-root
  node scripts/ci-shards.mjs combine-histories --inputDir "$RUNNER_TEMP/kovo-prior-timing" --out timing-history.json
  node scripts/ci-shards.mjs merge-vitest --report vitest.json --out timing-history.json [--previous timing-history.json]
  node scripts/ci-shards.mjs merge-playwright --report playwright.json --out timing-history.json [--previous timing-history.json]`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exit(1);
  });
}
