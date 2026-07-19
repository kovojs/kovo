import { describe, expect, it } from 'vitest';

import {
  discoverCapabilityMintSites,
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
      witnessFactories: [{ exportName: 'createWitnessWeakMap', file: 'security-witness-intrinsics.ts' }],
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

it('fails closed when a discovered mint is absent, stale, or lacks a reviewed reason', () => {
  const discovered = discoverCapabilityMintSites({
    canonicalSymbols: {
      systemDbDeclarations: [{ file: 'runtime.ts', owner: 'Runtime' }],
      witnessFactories: [{ exportName: 'createWitnessWeakMap', file: 'security-witness-intrinsics.ts' }],
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
        rows: [
          { classification: 'unknown', id: 'consumer.ts#registry', reason: 'Not closed.' },
        ],
        schema: 'kovo-capability-surface-census/v2',
      },
    });
    expect(result.findings).toContain(
      'consumer.ts#registry: classification must be mint or internal-registry',
    );
  });
});
