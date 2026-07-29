#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicApiInventory } from './public-api-inventory.mjs';

const BATCH_ID = 'server-task-topology-v1';
const PACKAGE = '@kovojs/server';
const RELEASE_NOTE = 'docs/releases/server-task-topology-v1.md';
const CONTRACT_TEST = 'packages/server/src/api-topology.test.ts';
const NON_TEST_EXAMPLE = 'packages/server/README.md';
const TOPOLOGY_EVIDENCE = 'server-task-topology-contract';
const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const FROZEN_SERVER_SUBPATHS = [
  PACKAGE,
  `${PACKAGE}/build`,
  `${PACKAGE}/runtime-bootstrap`,
  `${PACKAGE}/sqlite`,
  `${PACKAGE}/testing`,
  `${PACKAGE}/vite`,
];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const decisionsPath = path.join(repoRoot, 'api-surface-decisions.json');
const migrationsPath = path.join(repoRoot, 'api-migrations.json');
const packagesPath = path.join(repoRoot, 'public-packages.json');

const decisions = readJson(decisionsPath);
const migrations = readJson(migrationsPath);
const packages = readJson(packagesPath);
const inventory = buildPublicApiInventory({ repoRoot });
const serverPackage = packages.packages.find((entry) => entry.name === PACKAGE);
if (!serverPackage) throw new Error(`${PACKAGE} is missing from public-packages.json`);

const publicSubpaths = serverPackage.apiBoundary.public.map((subpath) =>
  subpath === '.' ? PACKAGE : `${PACKAGE}/${subpath.slice(2)}`,
);
const apiRefBySpecifier = new Map(
  serverPackage.apiRef.entries.map((entry) => [
    entry.path === '.' ? PACKAGE : `${PACKAGE}/${entry.path.slice(2)}`,
    entry,
  ]),
);
const currentDeclarations = inventory.exportedDeclarations.filter(
  (entry) => entry.package === PACKAGE && publicSubpaths.includes(entry.specifier),
);
const currentIds = new Set(currentDeclarations.map(declarationId));
const currentRootSymbols = new Set(
  currentDeclarations.filter((entry) => entry.specifier === PACKAGE).map((entry) => entry.symbol),
);
const originalRows = new Map(decisions.symbols.map((entry) => [entry.id, entry]));
// The frozen baseline predates this breaking batch. Reconstruct its server segment from rows that
// do not carry introduced evidence so rerunning this updater cannot accidentally bless growth.
const frozenServerDeclarations = decisions.symbols
  .filter(
    (entry) =>
      entry.package === PACKAGE &&
      !entry.introduced &&
      !(entry.specifier === PACKAGE && entry.symbol === 'AppMutationAdapter'),
  )
  .map((entry) => entry.id);
const frozenBaseline = new Set(frozenServerDeclarations);
const frozenSubpaths = new Set(FROZEN_SERVER_SUBPATHS);

decisions.evidence[TOPOLOGY_EVIDENCE] = {
  packedExample: 'generated:api-surface-packed-example/v1',
  contractTests: [CONTRACT_TEST, 'scripts/migrate-server-api-v1.test.mjs'],
};

const storyBySpecifier = new Map();
for (const specifier of publicSubpaths) {
  const story = storyId(specifier);
  storyBySpecifier.set(specifier, story);
  const existingStory = decisions.stories[story];
  if (existingStory && existingStory.evidence !== TOPOLOGY_EVIDENCE) continue;
  const apiRef = apiRefBySpecifier.get(specifier);
  decisions.stories[story] = {
    ...existingStory,
    userStory:
      existingStory?.userStory ?? apiRef?.description ?? `Use the ${specifier} task surface.`,
    owner: existingStory?.owner ?? ownerForSpecifier(specifier),
    spec: specForSpecifier(specifier),
    evidence: TOPOLOGY_EVIDENCE,
  };
}

const retainedRows = decisions.symbols.filter((entry) => entry.package !== PACKAGE);
const retiredRootRows = decisions.symbols
  .filter(
    (entry) =>
      entry.package === PACKAGE &&
      entry.specifier === PACKAGE &&
      !currentRootSymbols.has(entry.symbol),
  )
  .map((entry) => retiredRow(entry));

// The app-contract landing postdated the original audit ledger, but AppMutationAdapter was part of
// the actual pre-cut root and therefore still needs a migration decision.
if (!retiredRootRows.some((entry) => entry.symbol === 'AppMutationAdapter')) {
  retiredRootRows.push(
    retiredRow({
      id: `${PACKAGE}#AppMutationAdapter`,
      package: PACKAGE,
      specifier: PACKAGE,
      symbol: 'AppMutationAdapter',
      story: 'server-authoring',
      evidence: 'server-authoring-contract',
    }),
  );
}

const publicRows = currentDeclarations.map((entry) => {
  const id = declarationId(entry);
  const previous = originalRows.get(id);
  const story = storyBySpecifier.get(entry.specifier) ?? 'server-authoring';
  const evidence = decisions.stories[story]?.evidence ?? TOPOLOGY_EVIDENCE;
  return {
    ...previous,
    id,
    package: PACKAGE,
    specifier: entry.specifier,
    symbol: entry.symbol,
    state: 'public',
    decision: 'keep',
    canonicalHome: entry.specifier,
    story,
    evidence,
    ...(!frozenBaseline.has(id)
      ? {
          introduced: {
            releaseNote: RELEASE_NOTE,
            contractTest: CONTRACT_TEST,
            nonTestExample: NON_TEST_EXAMPLE,
          },
        }
      : {}),
  };
});

const retiredIds = new Set(retiredRootRows.map((entry) => entry.id));
decisions.symbols = [
  ...retainedRows.filter((entry) => !currentIds.has(entry.id) && !retiredIds.has(entry.id)),
  ...retiredRootRows,
  ...publicRows,
].sort(compareId);

decisions.subpaths = [
  ...decisions.subpaths.filter((entry) => !entry.specifier.startsWith(PACKAGE)),
  ...publicSubpaths.map((specifier) => {
    const story = storyBySpecifier.get(specifier) ?? 'server-authoring';
    const apiRef = apiRefBySpecifier.get(specifier);
    return {
      specifier,
      task: `Use ${specifier} to ${sentence(apiRef?.description ?? 'work with this server task')}`,
      owner: decisions.stories[story].owner,
      story,
      state: 'public',
      ...(!frozenSubpaths.has(specifier)
        ? {
            introduced: {
              releaseNote: RELEASE_NOTE,
            },
          }
        : {}),
    };
  }),
].sort((left, right) => left.specifier.localeCompare(right.specifier));

decisions.baseline.declarations = [
  ...decisions.baseline.declarations.filter((id) => !id.startsWith(PACKAGE)),
  ...frozenServerDeclarations,
].sort((left, right) => left.localeCompare(right));
decisions.baseline.subpaths = [
  ...decisions.baseline.subpaths.filter((specifier) => !specifier.startsWith(PACKAGE)),
  ...FROZEN_SERVER_SUBPATHS,
].sort((left, right) => left.localeCompare(right));

const migrationDecisions = retiredRootRows
  .map((entry) => entry.id)
  .sort((left, right) => left.localeCompare(right));
const rules = retiredRootRows
  .sort((left, right) => left.symbol.localeCompare(right.symbol))
  .map((entry, index) => migrationRule(entry, index));
const batch = {
  id: BATCH_ID,
  state: 'removed',
  owner: 'server-api',
  decisions: migrationDecisions,
  tool: {
    path: 'scripts/migrate-server-api-v1.mjs',
    resultSchema: RESULT_SCHEMA,
    checkArgs: ['--check'],
    writeArgs: ['--write'],
  },
  releaseNote: RELEASE_NOTE,
  rollback:
    'From a clean worktree, restore the prior Kovo package versions and reverse only files reported as rewritten by the structured server migration result.',
  rules,
  fixtures: {
    rewrites: ['scripts/fixtures/api-migrations/server-task-topology-v1/task-imports.input.ts'],
    refusals: [
      'scripts/fixtures/api-migrations/server-task-topology-v1/internal-carrier.refusal.ts',
    ],
  },
  exercised: {
    resultSchema: RESULT_SCHEMA,
    command:
      'node scripts/migrate-server-api-v1.mjs --check scripts/fixtures/api-migrations/server-task-topology-v1',
  },
};
const existingBatch = migrations.batches.findIndex((entry) => entry.id === BATCH_ID);
if (existingBatch === -1) migrations.batches.push(batch);
else migrations.batches[existingBatch] = batch;

writeJson(decisionsPath, decisions);
writeJson(migrationsPath, migrations);

function retiredRow(entry) {
  if (entry.symbol === 'committedSecretWaiver') {
    return {
      ...entry,
      state: 'removed',
      decision: 'remove',
      canonicalHome: 'none',
      story: 'server-security',
      evidence: decisions.stories['server-security'].evidence,
      migrationBatch: BATCH_ID,
    };
  }
  const canonical = canonicalHome(entry.symbol);
  if (canonical) {
    const canonicalRow = originalRows.get(`${canonical}#${entry.symbol}`);
    const story = canonical.startsWith(PACKAGE)
      ? (storyBySpecifier.get(canonical) ?? 'server-authoring')
      : (canonicalRow?.story ?? entry.story ?? 'server-authoring');
    return {
      ...entry,
      state: 'removed',
      decision: 'move',
      canonicalHome: canonical,
      story,
      evidence: canonicalRow?.evidence ?? decisions.stories[story]?.evidence ?? TOPOLOGY_EVIDENCE,
      migrationBatch: BATCH_ID,
    };
  }
  return {
    ...entry,
    state: 'removed',
    decision: 'internalize',
    canonicalHome: `internal:${PACKAGE}`,
    story: entry.story ?? 'server-authoring',
    evidence: entry.evidence ?? TOPOLOGY_EVIDENCE,
    migrationBatch: BATCH_ID,
  };
}

function canonicalHome(symbol) {
  const candidates = inventory.exportedDeclarations
    .filter(
      (entry) =>
        entry.symbol === symbol &&
        entry.specifier !== PACKAGE &&
        (entry.package === PACKAGE ||
          entry.package === '@kovojs/core' ||
          entry.package === '@kovojs/browser'),
    )
    .map((entry) => entry.specifier);
  const homes = [...new Set(candidates)].sort((left, right) => left.localeCompare(right));
  return homes.find((specifier) => specifier.startsWith(`${PACKAGE}/`)) ?? homes[0];
}

function migrationRule(entry, index) {
  const prefix = `${String(index + 1).padStart(3, '0')}-${slug(entry.symbol)}`;
  if (entry.decision === 'move') {
    return {
      id: `${prefix}-move`,
      action: 'rewrite',
      from: { specifier: PACKAGE, symbol: entry.symbol },
      to: { specifier: entry.canonicalHome, symbol: entry.symbol },
    };
  }
  return {
    id: `${prefix}-refusal`,
    action: 'refuse',
    from: { specifier: PACKAGE, symbol: entry.symbol },
    category:
      entry.symbol === 'committedSecretWaiver'
        ? 'trust-decision'
        : entry.symbol === 'MutationCsrfDeclaration'
          ? 'csrf-posture'
          : 'app-context',
    reason:
      entry.symbol === 'committedSecretWaiver'
        ? 'The discarded process-global waiver had no enforceable compiler evidence and has no replacement.'
        : entry.symbol === 'MutationCsrfDeclaration'
          ? 'MutationCsrfDeclaration was framework-owned CSRF protocol state; the app must select its route verifier or reviewed exemption explicitly.'
          : `${entry.symbol} is framework-owned implementation or generated protocol state; selecting an app-local replacement requires application context.`,
  };
}

function declarationId(entry) {
  return `${entry.specifier}#${entry.symbol}`;
}

function storyId(specifier) {
  if (specifier === PACKAGE) return 'server-authoring';
  if (specifier === `${PACKAGE}/build` || specifier === `${PACKAGE}/vite`) return 'server-build';
  if (specifier === `${PACKAGE}/testing`) return 'server-testing';
  return `server-${specifier.slice(PACKAGE.length + 1).replaceAll('/', '-')}`;
}

function ownerForSpecifier(specifier) {
  if (specifier.endsWith('/build') || specifier.endsWith('/vite')) return 'build-runtime';
  if (specifier.endsWith('/testing')) return 'testing';
  if (/(?:data|postgres|replay|sqlite|storage|tasks|webhooks|write-safety)$/u.test(specifier)) {
    return 'data-plane';
  }
  return 'server-runtime';
}

function specForSpecifier(specifier) {
  if (specifier.endsWith('/diagnostics')) return 'spec/11-diagnostics.md §11.3';
  if (specifier.endsWith('/render-tree')) return 'spec/04-component-model.md §4.10';
  if (specifier.endsWith('/rendering')) return 'spec/04-component-model.md §4.2';
  if (specifier.endsWith('/routing')) return 'spec/06-type-system.md §6.4';
  if (specifier.endsWith('/client-modules')) return 'spec/09-wire-protocol.md §9.5';
  if (specifier.endsWith('/tasks')) return 'spec/09-wire-protocol.md §9.6';
  if (specifier.endsWith('/derived-data')) return 'spec/10-data-plane.md §10.5';
  if (specifier.endsWith('/postgres') || specifier.endsWith('/sqlite')) {
    return 'spec/10-data-plane.md §10.1';
  }
  if (/(?:data|principal-erasure|replay|webhooks|write-safety)$/u.test(specifier)) {
    return 'spec/10-data-plane.md §10.3';
  }
  if (specifier === PACKAGE || specifier.endsWith('/custom-adapters')) {
    return 'spec/09-wire-protocol.md §9.5';
  }
  return 'spec/06-type-system.md §6.6';
}

function sentence(value) {
  const trimmed = value.trim();
  return `${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1).replace(/[.]$/u, '')}.`;
}

function slug(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase();
}

function compareId(left, right) {
  return left.id.localeCompare(right.id);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
