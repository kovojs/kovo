import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  discoverCapabilityMintSites,
  evaluateCapabilityBoundaryPosture,
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

  const rawExport = evaluateCapabilityBoundaryPosture({
    readText: (file) =>
      file === 'packages/create-kovo/templates/src/_kovo/app-runtime-db.ts'
        ? `${readText(file)}\nexport const leakedSystemDb = authSystemDb;\n`
        : readText(file),
  });
  expect(rawExport).toContain('generated templates must not export raw systemDb capabilities');

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
