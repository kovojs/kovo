import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  discoverCapabilityMintSites,
  evaluateCapabilityBoundaryPosture,
  evaluatePrincipalEpochCredentialDoors,
  evaluateRequestDeadlineEffectDoors,
  evaluateCapabilitySurfaceCensus,
} from './capability-surface-census-gate.mjs';

const sources = new Map([
  [
    'security-witness-intrinsics.ts',
    `export function createWitnessWeakMap() { return new WeakMap(); }`,
  ],
  [
    'runtime.ts',
    `export class Runtime {
      systemDb() { return {}; }
    }`,
  ],
  [
    'consumer.ts',
    `import { createWitnessWeakMap as makeRegistry } from './security-witness-intrinsics.js';
     import { Runtime } from './runtime.js';
     const registry = makeRegistry();
     const localLookalike = () => new WeakMap();
     const ignored = localLookalike();
     const runtime = new Runtime();
     const authSystemDb = runtime.systemDb();
     const lookalike = { systemDb() { return {}; } };
     const ignoredSystemDb = lookalike.systemDb();`,
  ],
]);

// @kovo-security-certifies C13 capability-mint-symbol-identity-census
it('discovers witness registries and systemDb mints by TypeScript symbol identity', () => {
  const sites = discoverCapabilityMintSites({
    canonicalSymbols: {
      systemDbDeclarations: [{ file: 'runtime.ts', owner: 'Runtime' }],
      witnessFactories: [
        { exportName: 'createWitnessWeakMap', file: 'security-witness-intrinsics.ts' },
      ],
    },
    sources,
  });

  expect(sites).toEqual([
    {
      api: 'createWitnessWeakMap',
      file: 'consumer.ts',
      id: 'consumer.ts#registry',
      symbol: 'security-witness-intrinsics.ts#createWitnessWeakMap',
    },
    {
      api: 'systemDb',
      file: 'consumer.ts',
      id: 'consumer.ts#authSystemDb',
      symbol: 'runtime.ts#Runtime.systemDb',
    },
  ]);
});

// @kovo-security-certifies C13 principal-epoch-credential-door-census
it('closes principal-epoch freshness over capability URL and mutation replay credential doors', () => {
  const credentialSources = new Map([
    [
      'principal-epoch.ts',
      `export function currentPrincipalEpoch() {}
       export function assertPrincipalEpochFresh() {}
       export function assertPrincipalEpochFreshForRequest() {}`,
    ],
    [
      'capability.ts',
      `import { currentPrincipalEpoch as current } from './principal-epoch.js';
       import { assertPrincipalEpochFresh as fresh } from './principal-epoch.js';
       export const mintCapability = () => current();
       export const verifyCapability = () => fresh();`,
    ],
    [
      'replay.ts',
      `import { currentPrincipalEpoch as current } from './principal-epoch.js';
       import { assertPrincipalEpochFresh as fresh } from './principal-epoch.js';
       import { assertPrincipalEpochFreshForRequest as freshForRequest } from './principal-epoch.js';
       export const reserveReplayReceipt = () => current();
       export const releaseReplayReceipt = () => fresh();
       export const settleReplayReceipt = () => freshForRequest();`,
    ],
    [
      'mutation.ts',
      `import { assertPrincipalEpochFresh as fresh } from './principal-epoch.js';
       import { assertPrincipalEpochFreshForRequest as freshForRequest } from './principal-epoch.js';
       export const admitReplayReceipt = () => fresh();
       export const completeReplayTransaction = () => freshForRequest();`,
    ],
    ['continuation.ts', `export const runInFrameContinuation = () => undefined;`],
  ]);
  const rows = [
    {
      consumes: 'currentPrincipalEpoch',
      credential: 'capability-url',
      id: 'capability-url.mint',
      owner: 'mintCapability',
      path: 'capability.ts',
      phase: 'mint',
      reason: 'Every principal-bound capability URL embeds the authoritative current epoch.',
    },
    {
      consumes: 'assertPrincipalEpochFresh',
      credential: 'capability-url',
      id: 'capability-url.verify',
      owner: 'verifyCapability',
      path: 'capability.ts',
      phase: 'verify',
      reason: 'The storage read stays unreachable until authoritative epoch freshness passes.',
    },
    {
      consumes: 'currentPrincipalEpoch',
      credential: 'mutation-replay-receipt',
      id: 'mutation-replay-receipt.mint',
      owner: 'reserveReplayReceipt',
      path: 'replay.ts',
      phase: 'mint',
      reason: 'Replay reservation identity embeds the authoritative current principal epoch.',
    },
    {
      consumes: 'assertPrincipalEpochFresh',
      credential: 'mutation-replay-receipt',
      id: 'mutation-replay-receipt.release',
      owner: 'releaseReplayReceipt',
      path: 'replay.ts',
      phase: 'verify',
      reason: 'A replay response is released only while its embedded epoch remains current.',
    },
    {
      consumes: 'assertPrincipalEpochFresh',
      credential: 'mutation-replay-receipt',
      id: 'mutation-replay-receipt.handler-admission',
      owner: 'admitReplayReceipt',
      path: 'mutation.ts',
      phase: 'verify',
      reason: 'The handler remains unreachable unless the epoch that won reservation is current.',
    },
    {
      consumes: 'assertPrincipalEpochFreshForRequest',
      credential: 'mutation-replay-receipt',
      id: 'mutation-replay-receipt.transaction-complete',
      owner: 'completeReplayTransaction',
      path: 'mutation.ts',
      phase: 'verify',
      reason: 'The transaction cannot complete after an out-of-band epoch change.',
    },
    {
      consumes: 'assertPrincipalEpochFreshForRequest',
      credential: 'mutation-replay-receipt',
      id: 'mutation-replay-receipt.settlement',
      owner: 'settleReplayReceipt',
      path: 'replay.ts',
      phase: 'verify',
      reason: 'A replay receipt cannot settle after its principal epoch becomes stale.',
    },
    {
      credential: 'continuation',
      id: 'continuation.in-frame',
      owner: 'runInFrameContinuation',
      path: 'continuation.ts',
      phase: 'inapplicable',
      reason:
        'This continuation is closed before its adapter frame returns and is never a durable credential.',
    },
  ];

  expect(
    evaluatePrincipalEpochCredentialDoors({
      canonicalModule: 'principal-epoch.ts',
      requiredIds: rows.map((row) => row.id),
      rows,
      sources: credentialSources,
    }),
  ).toMatchObject({ ok: true, summary: { inapplicable: 1, mint: 2, verify: 5 } });

  credentialSources.set(
    'capability.ts',
    `import { currentPrincipalEpoch as current } from './principal-epoch.js';
     import { assertPrincipalEpochFresh as fresh } from './principal-epoch.js';
     const lookalike = () => undefined;
     export const mintCapability = () => lookalike();
     export const verifyCapability = () => fresh();`,
  );
  expect(
    evaluatePrincipalEpochCredentialDoors({
      canonicalModule: 'principal-epoch.ts',
      requiredIds: rows.map((row) => row.id),
      rows,
      sources: credentialSources,
    }).findings,
  ).toContain(
    'capability-url.mint: mintCapability does not consume currentPrincipalEpoch from principal-epoch',
  );
});

// @kovo-security-certifies C13 request-deadline-effect-door-census
it('requires every owned request effect door to consume the canonical deadline capability', () => {
  const effectSources = new Map([
    [
      'request-deadline.ts',
      `export function composeCurrentRequestDeadlineSignal() { return undefined; }`,
    ],
    [
      'egress.ts',
      `import { composeCurrentRequestDeadlineSignal as consumeDeadline } from './request-deadline.js';
       function localLookalike() { return undefined; }
       export const frameworkEgressFetch = () => consumeDeadline();`,
    ],
  ]);
  const rows = [
    {
      consumes: ['composeCurrentRequestDeadlineSignal'],
      evidence: 'Focused egress test observes deadline cancellation at the native transport.',
      id: 'test.egress',
      owner: 'frameworkEgressFetch',
      path: 'egress.ts',
      purpose: 'The framework network door composes its caller signal with the request deadline.',
    },
  ];

  expect(
    evaluateRequestDeadlineEffectDoors({
      requiredIds: ['test.egress'],
      rows,
      sources: effectSources,
    }),
  ).toMatchObject({ ok: true, summary: { effectDoors: 1 } });

  effectSources.set(
    'egress.ts',
    `import { composeCurrentRequestDeadlineSignal as consumeDeadline } from './request-deadline.js';
     function localLookalike() { return undefined; }
     export const frameworkEgressFetch = () => localLookalike();`,
  );
  expect(
    evaluateRequestDeadlineEffectDoors({
      requiredIds: ['test.egress'],
      rows,
      sources: effectSources,
    }).findings,
  ).toContain(
    'test.egress: frameworkEgressFetch does not consume composeCurrentRequestDeadlineSignal from request-deadline',
  );

  effectSources.set(
    'egress.ts',
    `import { composeCurrentRequestDeadlineSignal as consumeDeadline } from './request-deadline.js';
     export const frameworkEgressFetch = () => {
       function deadLookalike() { return consumeDeadline(); }
       return undefined;
     };`,
  );
  expect(
    evaluateRequestDeadlineEffectDoors({
      requiredIds: ['test.egress'],
      rows,
      sources: effectSources,
    }).findings,
  ).toContain(
    'test.egress: frameworkEgressFetch does not consume composeCurrentRequestDeadlineSignal from request-deadline',
  );
});

it('fails closed when a discovered mint is absent, stale, or lacks a reviewed reason', () => {
  const discovered = discoverCapabilityMintSites({
    canonicalSymbols: {
      systemDbDeclarations: [{ file: 'runtime.ts', owner: 'Runtime' }],
      witnessFactories: [
        { exportName: 'createWitnessWeakMap', file: 'security-witness-intrinsics.ts' },
      ],
    },
    sources,
  });
  const result = evaluateCapabilitySurfaceCensus({
    discovered,
    manifest: {
      rows: [
        {
          classification: 'internal-registry',
          id: 'consumer.ts#registry',
          reason: '',
        },
        {
          classification: 'mint',
          id: 'consumer.ts#stale',
          reason: 'Stale row.',
        },
      ],
      schema: 'kovo-capability-surface-census/v2',
    },
  });

  expect(result.findings).toEqual(
    expect.arrayContaining([
      'consumer.ts#registry: classification requires a substantive reviewed reason',
      'missing capability census row consumer.ts#authSystemDb',
      'stale capability census row consumer.ts#stale',
    ]),
  );
});

describe('closed capability classifications', () => {
  it('rejects classifications outside mint or internal-registry', () => {
    const result = evaluateCapabilitySurfaceCensus({
      discovered: [
        {
          api: 'createWitnessWeakMap',
          file: 'consumer.ts',
          id: 'consumer.ts#registry',
          symbol: 'security-witness-intrinsics.ts#createWitnessWeakMap',
        },
      ],
      manifest: {
        rows: [{ classification: 'unknown', id: 'consumer.ts#registry', reason: 'Not closed.' }],
        schema: 'kovo-capability-surface-census/v2',
      },
    });
    expect(result.findings).toContain(
      'consumer.ts#registry: classification must be mint or internal-registry',
    );
  });
});

it('retains structural closed verdicts for raw exports, internal consumers, and SQL snapshots', () => {
  const readText = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  expect(evaluateCapabilityBoundaryPosture({ readText })).toEqual([]);

  const leakedCredentialAuthority = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/better-auth/src/postgres.ts'
        ? readText(file).replace(
            '...(requestPasswordReset === undefined ? {} : { requestPasswordReset }),',
            'rawAuth,',
          )
        : readText(file),
  });
  expect(leakedCredentialAuthority).toContain(
    'Better Auth Postgres constructor must return only the frozen sanitized binding record and opaque mount adapter',
  );

  const rawExport = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/create-kovo/templates/src/_kovo/app-runtime-db.ts'
        ? `${readText(file)}\nexport const leakedDatabase = appDatabase;\n`
        : readText(file),
  });
  expect(rawExport).toContain(
    'generated runtime modules must export only opaque app providers, readiness, stores, and the sanitized auth-binding factory',
  );

  const directInternalConsumer = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/better-auth/src/public-postgres.ts'
        ? `${readText(file)}\nimport { usePostgresSystemDb } from '@kovojs/server/internal/postgres-capability';\n`
        : readText(file),
  });
  expect(directInternalConsumer).toContain(
    'public Better Auth app doors must not import raw system capability consumers',
  );

  const forgedRuntimeDoor = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/better-auth/src/public-sqlite.ts'
        ? readText(file).replace(
            'sqliteSystemDbForGeneratedIntegration(runtime, {',
            'sqliteSystemDbForGeneratedIntegration({}, {',
          )
        : readText(file),
  });
  expect(forgedRuntimeDoor).toContain(
    'Better Auth SQLite public door must recover system authority only from its exact app runtime',
  );

  const bypassedPublicDoor = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/create-kovo/templates/src/_kovo/app-runtime-db.sqlite.ts'
        ? readText(file).replaceAll(
            'createBetterAuthSqliteAppBindings',
            'createBetterAuthSqliteBindingsFromEnvironment',
          )
        : readText(file),
  });
  expect(bypassedPublicDoor).toEqual(
    expect.arrayContaining([
      'generated SQLite runtime must import only the public SQLite app-binding door',
      'generated SQLite runtime must pass only its exact app runtime into the public binding door',
    ]),
  );

  const unsnapshottedOptions = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/better-auth/src/public-postgres.ts'
        ? readText(file).replace('csrf: snapshot.csrf,', 'csrf: options.csrf,')
        : readText(file),
  });
  expect(unsnapshottedOptions).toContain(
    'Better Auth Postgres public door must forward only its snapshotted options and minted capability',
  );

  const publicConsumer = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/server/src/index.ts'
        ? `${readText(file)}\nexport { usePostgresSystemDb } from './internal/postgres-capability.js';\n`
        : readText(file),
  });
  expect(publicConsumer).toContain(
    'the public @kovojs/server root must not export the raw Postgres capability consumer',
  );

  const mutableSql = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/server/src/sql-safe-handle.ts'
        ? readText(file).replaceAll(
            'prependSqlSafetyArgument(snapshot, args)',
            'prependSqlSafetyArgument(statement, args)',
          )
        : readText(file),
  });
  expect(mutableSql).toEqual(
    expect.arrayContaining([
      'managed SQL direct execution must pass the frozen snapshot to the driver',
      'managed SQL prepare execution must pass the frozen snapshot to the driver',
      'managed SQL execution must not pass the original mutable statement to the driver',
    ]),
  );
});
