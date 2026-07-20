import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseDiagnosticSpecRegistry } from './generate-diagnostic-registry.mjs';
import { validateLabelClauseMap } from './label-clause-map-gate.mjs';

const artifact = JSON.parse(
  readFileSync(new URL('../security/label-clause-map.json', import.meta.url), 'utf8'),
);
const spec = readFileSync(new URL('../spec/10-data-plane.md', import.meta.url), 'utf8');
const diagnosticRows = parseDiagnosticSpecRegistry(
  readFileSync(new URL('../spec/11-diagnostics.md', import.meta.url), 'utf8'),
);

function clone(value) {
  return structuredClone(value);
}

function validate(overrides = {}) {
  return validateLabelClauseMap({ artifact, diagnosticRows, spec, ...overrides });
}

describe('label clause map gate', () => {
  it('accepts the closed normative map', () => {
    expect(validate()).toEqual({ findings: [], ok: true });
  });

  it('rejects a missing diagnostic mapping', () => {
    const changed = clone(artifact);
    changed.diagnostics = changed.diagnostics.filter((entry) => entry.code !== 'KV438');
    expect(validate({ artifact: changed }).findings).toContain(
      'diagnostic codes must equal [KV410, KV411, KV414, KV426, KV435, KV438, KV439] in normative order',
    );
  });

  it('rejects an unknown theorem clause', () => {
    const changed = clone(artifact);
    changed.diagnostics[0].clauses = ['NI-C9'];
    expect(validate({ artifact: changed }).findings).toContain(
      'KV410 references unknown clause NI-C9',
    );
  });

  it('rejects diagnostic enforcement-class relabeling', () => {
    const changedRows = diagnosticRows.map((row) =>
      row.code === 'KV414' ? { ...row, enforcementClass: 'fail-closed-runtime' } : row,
    );
    expect(validate({ diagnosticRows: changedRows }).findings).toContain(
      'KV414 must remain error/compile-error, found error/fail-closed-runtime',
    );
  });

  it('rejects SPEC clause deletion', () => {
    expect(validate({ spec: spec.replace('**NI-O1 —', '**removed —') }).findings).toContain(
      'NI-O1 has no normative SPEC clause',
    );
  });

  it('rejects integrity-join drift', () => {
    const changed = clone(artifact);
    changed.integrityJoin.literal.input = 'server';
    expect(validate({ artifact: changed }).findings).toContain(
      'integrityJoin.literal.input must be input',
    );
  });
});
