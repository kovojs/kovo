#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeFrameworkRuntimeSurface } from './framework-export-posture-gate.mjs';

const BATCH_ID = 'better-auth-generated-assembly-v1';
const PACKAGE = '@kovojs/better-auth';
const RELEASE_NOTE = 'docs/releases/better-auth-generated-assembly-v1.md';
const RESULT_SCHEMA = 'kovo-api-migration-result/v1';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const decisionsPath = path.join(repoRoot, 'api-surface-decisions.json');
const migrationsPath = path.join(repoRoot, 'api-migrations.json');
const posturePath = path.join(repoRoot, 'security/framework-public-runtime-export-posture.json');
const decisionsSource = readFileSync(decisionsPath, 'utf8');
const migrationsSource = readFileSync(migrationsPath, 'utf8');
const postureSource = readFileSync(posturePath, 'utf8');
const decisions = JSON.parse(decisionsSource);
const migrations = JSON.parse(migrationsSource);
const posture = JSON.parse(postureSource);

const replacements = new Map([
  [
    'BetterAuthBindingRequest',
    {
      decision: 'internalize',
      canonicalHome: `internal:${PACKAGE}`,
      rewrite: {
        specifier: `${PACKAGE}/generated`,
        symbol: 'BetterAuthGeneratedRequest',
      },
    },
  ],
  [
    'BetterAuthCredentialMutationValue',
    {
      decision: 'internalize',
      canonicalHome: `internal:${PACKAGE}`,
      refusal: {
        category: 'app-context',
        reason:
          'The credential mutation wire carrier was framework-owned; app-authored uses need an explicit local result contract rather than a guessed replacement.',
      },
    },
  ],
  [
    'BetterAuthDevelopmentSeed',
    {
      decision: 'move',
      canonicalHome: `${PACKAGE}/generated`,
    },
  ],
  ...moveEntries(
    [
      'BetterAuthPostgresBindings',
      'BetterAuthPostgresBindingsOptions',
      'BetterAuthPostgresEnvironmentBindingsOptions',
      'BetterAuthPostgresSecret',
      'betterAuthPostgresSecret',
      'createBetterAuthPostgresBindings',
      'createBetterAuthPostgresBindingsFromEnvironment',
    ],
    `${PACKAGE}/generated/postgres`,
  ),
  ...moveEntries(
    [
      'BetterAuthSqliteBindings',
      'BetterAuthSqliteBindingsOptions',
      'BetterAuthSqliteDevelopmentSeed',
      'BetterAuthSqliteEnvironmentBindingsOptions',
      'BetterAuthSqliteSecret',
      'betterAuthSqliteSecret',
      'createBetterAuthSqliteBindings',
      'createBetterAuthSqliteBindingsFromEnvironment',
    ],
    `${PACKAGE}/generated/sqlite`,
  ),
]);

const updatedSymbols = new Set();
const updatedRows = [];
decisions.symbols = decisions.symbols.map((entry) => {
  if (entry.package !== PACKAGE || entry.specifier !== PACKAGE) return entry;
  const replacement = replacements.get(entry.symbol);
  if (!replacement) return entry;
  updatedSymbols.add(entry.symbol);
  const updated = {
    ...entry,
    state: 'removed',
    decision: replacement.decision,
    canonicalHome: replacement.canonicalHome,
    migrationBatch: BATCH_ID,
  };
  updatedRows.push(updated);
  return updated;
});

const missing = [...replacements.keys()].filter((symbol) => !updatedSymbols.has(symbol));
if (missing.length > 0) {
  throw new Error(`Better Auth decision rows are missing: ${missing.join(', ')}`);
}

const contractEvidence = {
  packedExample: 'generated:api-surface-packed-example/v1',
  contractTests: [
    'packages/better-auth/src/generated.api.test.ts',
    'packages/better-auth/src/index.session.test.ts',
    'scripts/check-packed-better-auth-consumer.test.mjs',
    'scripts/migrate-better-auth-api-v1.test.mjs',
  ],
};
decisions.evidence['better-auth-contract'] = contractEvidence;

const migrationDecisions = [...replacements.keys()]
  .map((symbol) => `${PACKAGE}#${symbol}`)
  .sort((left, right) => left.localeCompare(right));
const rules = [...replacements]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([symbol, replacement], index) => migrationRule(symbol, replacement, index));
const batch = {
  id: BATCH_ID,
  state: 'removed',
  owner: 'better-auth-api',
  decisions: migrationDecisions,
  tool: {
    path: 'scripts/migrate-better-auth-api-v1.mjs',
    resultSchema: RESULT_SCHEMA,
    checkArgs: ['--check'],
    writeArgs: ['--write'],
  },
  releaseNote: RELEASE_NOTE,
  rollback:
    'From a clean worktree, restore the prior Kovo package versions and reverse only files reported as rewritten by the structured Better Auth migration result.',
  rules,
  fixtures: {
    rewrites: [
      'scripts/fixtures/api-migrations/better-auth-generated-assembly-v1/generated-bindings.input.ts',
    ],
    refusals: [
      'scripts/fixtures/api-migrations/better-auth-generated-assembly-v1/internal-carrier.refusal.ts',
    ],
  },
  exercised: {
    resultSchema: RESULT_SCHEMA,
    command:
      'node scripts/migrate-better-auth-api-v1.mjs --check scripts/fixtures/api-migrations/better-auth-generated-assembly-v1',
  },
};
const existingBatch = migrations.batches.findIndex((entry) => entry.id === BATCH_ID);
if (existingBatch === -1) migrations.batches.push(batch);
else migrations.batches[existingBatch] = batch;

let nextDecisionsSource = decisionsSource;
nextDecisionsSource = replacePropertyObject(
  nextDecisionsSource,
  'better-auth-contract',
  contractEvidence,
);
for (const row of updatedRows) {
  nextDecisionsSource = replaceObjectByField(nextDecisionsSource, 'id', row.id, row);
}

const nextMigrationsSource =
  existingBatch === -1
    ? appendArrayObject(migrationsSource, 'batches', batch)
    : replaceObjectByField(migrationsSource, 'id', BATCH_ID, batch);

const actualBetterAuth = computeFrameworkRuntimeSurface().packages.find(
  (entry) => entry.packageName === PACKAGE,
);
const reviewedBetterAuth = posture.packages.find((entry) => entry.packageName === PACKAGE);
if (!actualBetterAuth || !reviewedBetterAuth) {
  throw new Error(`${PACKAGE} is missing from the framework runtime posture inventory`);
}
const actualMembers = new Set(
  Object.entries(actualBetterAuth.members).flatMap(([subpath, names]) =>
    names.map((name) => `${subpath}\0${name}`),
  ),
);
const postureGroups = reviewedBetterAuth.postureGroups
  .map((group) => ({
    ...group,
    members: Object.fromEntries(
      Object.entries(group.members)
        .map(([subpath, names]) => [
          subpath,
          names.filter((name) => actualMembers.has(`${subpath}\0${name}`)),
        ])
        .filter(([, names]) => names.length > 0),
    ),
  }))
  .filter((group) => Object.keys(group.members).length > 0);
const reviewedMembers = new Set(
  postureGroups.flatMap((group) =>
    Object.entries(group.members).flatMap(([subpath, names]) =>
      names.map((name) => `${subpath}\0${name}`),
    ),
  ),
);
if (
  [...actualMembers].some((member) => !reviewedMembers.has(member)) ||
  [...reviewedMembers].some((member) => !actualMembers.has(member))
) {
  throw new Error(`${PACKAGE} runtime posture groups do not cover the exact current runtime API`);
}
const updatedPosture = {
  ...reviewedBetterAuth,
  manifestVariants: actualBetterAuth.manifestVariants,
  packageVersion: actualBetterAuth.packageVersion,
  postureGroups,
  sourceTreeSha256: actualBetterAuth.sourceTreeSha256,
};
const nextPostureSource = replaceObjectByField(
  postureSource,
  'packageName',
  PACKAGE,
  updatedPosture,
);

writeFileSync(decisionsPath, nextDecisionsSource, 'utf8');
writeFileSync(migrationsPath, nextMigrationsSource, 'utf8');
writeFileSync(posturePath, nextPostureSource, 'utf8');

function moveEntries(symbols, canonicalHome) {
  return symbols.map((symbol) => [
    symbol,
    {
      decision: 'move',
      canonicalHome,
    },
  ]);
}

function migrationRule(symbol, replacement, index) {
  const prefix = `${String(index + 1).padStart(3, '0')}-${slug(symbol)}`;
  if (replacement.refusal) {
    return {
      id: `${prefix}-refusal`,
      action: 'refuse',
      from: { specifier: PACKAGE, symbol },
      ...replacement.refusal,
    };
  }
  return {
    id: `${prefix}-${replacement.decision === 'move' ? 'move' : 'replacement'}`,
    action: 'rewrite',
    from: { specifier: PACKAGE, symbol },
    to: replacement.rewrite ?? {
      specifier: replacement.canonicalHome,
      symbol,
    },
  };
}

function slug(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^A-Za-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase();
}

function replacePropertyObject(source, property, value) {
  const marker = `${JSON.stringify(property)}:`;
  const markerIndex = uniqueIndex(source, marker);
  const start = source.indexOf('{', markerIndex + marker.length);
  if (start === -1) throw new Error(`${property} must contain an object`);
  const end = matchingBrace(source, start);
  return replaceRange(
    source,
    start,
    end + 1,
    renderObject(value, leadingIndentationAt(source, markerIndex)),
  );
}

function replaceObjectByField(source, field, value, replacement) {
  const marker = `${JSON.stringify(field)}: ${JSON.stringify(value)}`;
  const markerIndex = uniqueIndex(source, marker);
  const ranges = objectRanges(source)
    .filter((range) => range.start <= markerIndex && range.end >= markerIndex)
    .sort((left, right) => right.start - left.start);
  const range = ranges[0];
  if (!range) throw new Error(`could not locate object containing ${field}=${value}`);
  return replaceRange(
    source,
    range.start,
    range.end + 1,
    renderObject(replacement, indentationAt(source, range.start)),
  );
}

function appendArrayObject(source, property, value) {
  const marker = `${JSON.stringify(property)}:`;
  const markerIndex = uniqueIndex(source, marker);
  const start = source.indexOf('[', markerIndex + marker.length);
  if (start === -1) throw new Error(`${property} must contain an array`);
  const end = matchingBracket(source, start);
  const beforeEnd = source.slice(0, end).trimEnd();
  const whitespace = source.slice(beforeEnd.length, end);
  const needsComma = beforeEnd.at(-1) !== '[';
  const itemIndentation = leadingIndentationAt(source, markerIndex) + 2;
  const replacement = `${beforeEnd}${needsComma ? ',' : ''}\n${' '.repeat(
    itemIndentation,
  )}${renderObject(value, itemIndentation)}${whitespace}]`;
  return `${replacement}${source.slice(end + 1)}`;
}

function uniqueIndex(source, marker) {
  const first = source.indexOf(marker);
  if (first === -1) throw new Error(`missing ledger marker ${marker}`);
  if (source.indexOf(marker, first + marker.length) !== -1) {
    throw new Error(`ledger marker is not unique: ${marker}`);
  }
  return first;
}

function objectRanges(source) {
  const ranges = [];
  const stack = [];
  scanJson(source, (character, index) => {
    if (character === '{') stack.push(index);
    if (character === '}') {
      const start = stack.pop();
      if (start === undefined) throw new Error('unbalanced JSON object');
      ranges.push({ start, end: index });
    }
  });
  return ranges;
}

function matchingBrace(source, start) {
  return matchingDelimiter(source, start, '{', '}');
}

function matchingBracket(source, start) {
  return matchingDelimiter(source, start, '[', ']');
}

function matchingDelimiter(source, start, opening, closing) {
  let depth = 0;
  let answer = -1;
  scanJson(source, (character, index) => {
    if (index < start || answer !== -1) return;
    if (character === opening) depth += 1;
    if (character === closing) {
      depth -= 1;
      if (depth === 0) answer = index;
    }
  });
  if (answer === -1) throw new Error(`unbalanced ${opening}${closing} JSON delimiter`);
  return answer;
}

function scanJson(source, visit) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    visit(character, index);
  }
}

function indentationAt(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  return index - lineStart;
}

function leadingIndentationAt(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const firstNonSpace = source.slice(lineStart).search(/\S/u);
  if (firstNonSpace === -1) throw new Error('ledger marker must be on a non-empty line');
  return firstNonSpace;
}

function renderObject(value, indentation) {
  const padding = ' '.repeat(indentation);
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${padding}${line}`))
    .join('\n');
}

function replaceRange(source, start, end, replacement) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}
