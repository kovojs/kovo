import { describe, expect, it } from 'vitest';

import {
  collectRawDiagnosticChannelsFromSource,
  rawDiagnosticChannelSchema,
  renderRawDiagnosticChannelInventory,
  validateRawDiagnosticChannelInventory,
} from './raw-diagnostic-channel-gate.mjs';

const diagnosticRows = [
  { code: 'KV414', enforcementClass: 'compile-error', severity: 'error' },
  { code: 'KV435', enforcementClass: 'compile-error', severity: 'error' },
  { code: 'KV450', enforcementClass: 'fail-closed-runtime', severity: 'error' },
];
const source = `
export function channels(reject) {
  const error = new TypeError('KV450: malformed scoped frame');
  if (error) throw new Error(diagnosticDefinitions.KV414.message);
  void Promise.reject(new Error('KV435: secret wire'));
  console.error('KV414: owner mismatch');
  const documentation = 'does not throw KV414';
  return documentation;
}
`;
const sites = collectRawDiagnosticChannelsFromSource('packages/server/src/channels.ts', source);
const artifact = renderRawDiagnosticChannelInventory({ diagnosticRows, sites });

describe('raw diagnostic channel gate', () => {
  it('collects Error, throw, rejection, and log channels without documentation strings', () => {
    expect(sites.map((site) => [site.channel, site.code])).toEqual([
      ['error-object', 'KV450'],
      ['throw', 'KV414'],
      ['rejection', 'KV435'],
      ['log', 'KV414'],
    ]);
  });

  it('enumerates each guard inside one generated runtime source literal', () => {
    const generated = collectRawDiagnosticChannelsFromSource(
      'packages/compiler/src/emit/generated.ts',
      `const source = "throw new TypeError('KV449: first'); throw new TypeError('KV449: second');";`,
    );
    expect(generated.map((site) => [site.channel, site.code])).toEqual([
      ['generated-runtime', 'KV449'],
      ['generated-runtime', 'KV449'],
    ]);
    expect(new Set(generated.map((site) => site.id)).size).toBe(2);
  });

  it('accepts the exact closed inventory', () => {
    expect(validateRawDiagnosticChannelInventory({ artifact, diagnosticRows, sites })).toEqual({
      findings: [],
      ok: true,
    });
  });

  it('rejects a new unclassified channel', () => {
    const changedSites = collectRawDiagnosticChannelsFromSource(
      'packages/server/src/channels.ts',
      `${source}\nthrow new Error('KV450: new channel');`,
    );
    expect(
      validateRawDiagnosticChannelInventory({ artifact, diagnosticRows, sites: changedSites })
        .findings,
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('unclassified raw diagnostic channel')]),
    );
  });

  it('rejects code/message identity changes', () => {
    const changed = structuredClone(artifact);
    changed.channels[0].expressionSha256 = '0'.repeat(64);
    expect(
      validateRawDiagnosticChannelInventory({ artifact: changed, diagnosticRows, sites }).findings,
    ).toEqual(expect.arrayContaining([expect.stringContaining('stale expressionSha256')]));
  });

  it('rejects registry enforcement-class relabeling', () => {
    const changedRows = diagnosticRows.map((row) =>
      row.code === 'KV450' ? { ...row, enforcementClass: 'compile-error' } : row,
    );
    expect(
      validateRawDiagnosticChannelInventory({ artifact, diagnosticRows: changedRows, sites })
        .findings,
    ).toEqual(expect.arrayContaining([expect.stringContaining('posture must be')]));
  });

  it('rejects an unsupported artifact schema', () => {
    expect(
      validateRawDiagnosticChannelInventory({
        artifact: { ...artifact, schema: `${rawDiagnosticChannelSchema}-future` },
        diagnosticRows,
        sites,
      }).findings,
    ).toContain(`schema must be ${rawDiagnosticChannelSchema}`);
  });
});
