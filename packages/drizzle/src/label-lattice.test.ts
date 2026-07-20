import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  joinSymbolProvenance,
  type SymbolProvenance,
  type SymbolProvenanceKind,
} from './static/symbol-provenance.js';

const labelMap = JSON.parse(
  readFileSync(new URL('../../../security/label-clause-map.json', import.meta.url), 'utf8'),
) as {
  dimensions: { integrity: SymbolProvenanceKind[] };
  integrityJoin: Record<SymbolProvenanceKind, Record<SymbolProvenanceKind, SymbolProvenanceKind>>;
};

function provenance(kind: SymbolProvenanceKind): SymbolProvenance {
  return kind === 'input' || kind === 'server' ? { kind, path: 'same.path' } : { kind };
}

describe('SPEC section 10.3 integrity lattice', () => {
  it('binds every normative kind-level join to joinSymbolProvenance', () => {
    for (const left of labelMap.dimensions.integrity) {
      for (const right of labelMap.dimensions.integrity) {
        expect(joinSymbolProvenance(provenance(left), provenance(right)).kind).toBe(
          labelMap.integrityJoin[left][right],
        );
      }
    }
  });

  it('retains equal source paths and erases mismatched paths at the same kind', () => {
    expect(
      joinSymbolProvenance({ kind: 'input', path: 'args.id' }, { kind: 'input', path: 'args.id' }),
    ).toEqual({ kind: 'input', path: 'args.id' });
    expect(
      joinSymbolProvenance(
        { kind: 'server', path: 'session.userId' },
        { kind: 'server', path: 'db.ownerId' },
      ),
    ).toEqual({ kind: 'server' });
  });
});
