import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEC8_SECURITY_MATRIX,
  GATE_ADVERSARY_MAP,
  gateDecisionKey,
  type GateAdversaryMapEntry,
} from './gate-adversary-map.js';

interface RequiredSecurityDecision {
  file: string;
  kind: 'classifier' | 'wire-emitter';
  names: readonly string[];
}

describe('gate adversary map', () => {
  it('encodes the DEC8 preset x dialect security matrix', () => {
    expect(DEC8_SECURITY_MATRIX).toEqual([
      { preset: 'node', dialect: 'pglite' },
      { preset: 'node', dialect: 'better-sqlite3' },
      { preset: 'cloudflare', dialect: 'pglite' },
      { preset: 'cloudflare', dialect: 'better-sqlite3' },
      { preset: 'vercel', dialect: 'pglite' },
      { preset: 'vercel', dialect: 'better-sqlite3' },
    ]);
  });

  it('assigns a DEC9 adversary and hostile test to every branded security gate', async () => {
    const { requiredSecurityDecisions } =
      // @ts-expect-error The security-brand gate is a repository script without TS declarations.
      (await import('../../../scripts/check-security-brands.mjs')) as {
        requiredSecurityDecisions: readonly RequiredSecurityDecision[];
      };
    const requiredKeys = requiredSecurityDecisions
      .flatMap((decision) => decision.names.map((name) => gateDecisionKey(decision.file, name)))
      .sort();
    const mappedKeys = Object.keys(GATE_ADVERSARY_MAP).sort();

    expect(mappedKeys).toEqual(requiredKeys);

    const invalidEntries = Object.entries(GATE_ADVERSARY_MAP)
      .filter(([, entry]) => !hasRequiredCoverage(entry))
      .map(([key]) => key);
    expect(invalidEntries).toEqual([]);

    const missingHostileTests = Array.from(
      new Set(Object.values(GATE_ADVERSARY_MAP).map((entry) => entry.hostileTest)),
    )
      .filter((hostileTest) => !existsSync(resolve(hostileTest)))
      .sort();
    expect(missingHostileTests).toEqual([]);
  });
});

function hasRequiredCoverage(entry: GateAdversaryMapEntry): boolean {
  return (
    entry.adversaries.length > 0 &&
    (entry.hostileTest.endsWith('.test.ts') ||
      entry.hostileTest.endsWith('.test.tsx') ||
      entry.hostileTest.endsWith('.test.mjs'))
  );
}
