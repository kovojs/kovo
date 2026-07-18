import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUDITED_CAPABILITY_KINDS,
  AUDITED_TRUST_ESCAPE_KINDS,
} from '../packages/core/src/graph.js';
import { frameworkSourceSinkInventory } from '../packages/core/src/internal/source-sink-registry.js';
import { validateThreatMatrixCoverage } from './threat-matrix-gate.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = readJson('../security/threat-matrix-coverage.json');
const capabilityCensus = readJson('./capability-surface-census.manifest.json');
const rootPackage = readJson('../package.json');
const matrixDocument = readFileSync(
  new URL('../docs/security-threat-matrix.md', import.meta.url),
  'utf8',
);

function readJson(relativeUrl: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
}

function cloneManifest(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
}

function documentedSurfaceLabels(): string[] {
  const matrix = matrixDocument.split('## The matrix\n')[1]?.split('\n## ')[0] ?? '';
  return [...matrix.matchAll(/^\| \*\*([^*]+)\*\*/gmu)].map((match) => match[1]!);
}

function publicSecuritySurfaceIds(): string[] {
  const rows = capabilityCensus.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) =>
    typeof row === 'object' && row !== null && typeof row.id === 'string' ? [row.id] : [],
  );
}

function validationOptions(overrides: Record<string, unknown> = {}) {
  return {
    auditedCapabilityKinds: [...AUDITED_CAPABILITY_KINDS],
    auditedTrustEscapeKinds: [...AUDITED_TRUST_ESCAPE_KINDS],
    documentedSurfaceLabels: documentedSurfaceLabels(),
    manifest,
    publicSecuritySurfaceIds: publicSecuritySurfaceIds(),
    repoRoot,
    rootScripts:
      typeof rootPackage.scripts === 'object' && rootPackage.scripts !== null
        ? rootPackage.scripts
        : {},
    sourceSinkInventory: frameworkSourceSinkInventory(),
    ...overrides,
  };
}

describe('threat-matrix liveness gate', () => {
  it('maps every authoritative sink, escape kind, and public security surface to live cells', () => {
    expect(validateThreatMatrixCoverage(validationOptions())).toEqual([]);
    expect(frameworkSourceSinkInventory()).toHaveLength(13);
    expect(AUDITED_TRUST_ESCAPE_KINDS).toHaveLength(7);
    expect(AUDITED_CAPABILITY_KINDS).toHaveLength(18);
    expect(publicSecuritySurfaceIds()).toHaveLength(11);
  });

  it('is enrolled as a direct, non-skippable root check gate', () => {
    const scripts = rootPackage.scripts as Record<string, string>;
    expect(scripts['check:threat-matrix']).toBe(
      'vitest --run scripts/threat-matrix-gate.test.ts --reporter=dot',
    );
    expect(scripts.check).toContain('pnpm run check:threat-matrix');
  });

  it('kills drift from a newly registered C9 sink or escape hatch', () => {
    const sinks = frameworkSourceSinkInventory();
    expect(
      validateThreatMatrixCoverage(
        validationOptions({
          sourceSinkInventory: [...sinks, { escapeHatch: 'none', sink: 'mutant.unmapped.output' }],
        }),
      ),
    ).toContain('C9 sink mappings missing: mutant.unmapped.output');

    const first = sinks[0]!;
    expect(
      validateThreatMatrixCoverage(
        validationOptions({
          sourceSinkInventory: [
            { ...first, escapeHatch: `${first.escapeHatch}|mutantEscape` },
            ...sinks.slice(1),
          ],
        }),
      ).join('\n'),
    ).toContain(
      'html.dom.output mapped escape hatches missing from html.dom.output registry escape hatches: mutantEscape',
    );
  });

  it('kills drift from a new audited escape kind or public security surface', () => {
    expect(
      validateThreatMatrixCoverage(
        validationOptions({
          auditedCapabilityKinds: [...AUDITED_CAPABILITY_KINDS, 'mutantCapability'],
        }),
      ).join('\n'),
    ).toContain('audited escape mappings missing: capability:mutantCapability');

    expect(
      validateThreatMatrixCoverage(
        validationOptions({
          publicSecuritySurfaceIds: [...publicSecuritySurfaceIds(), 'mutant-public-door'],
        }),
      ).join('\n'),
    ).toContain('public security surface mappings missing: mutant-public-door');
  });

  it('rejects stale mappings, unknown cells, and stale evidence instead of padding the denominator', () => {
    const stale = cloneManifest();
    const sinkMappings = stale.sinkMappings as Record<string, unknown>[];
    sinkMappings.push({
      cells: { I: 'c9-control' },
      escapeHatches: [],
      sink: 'stale.removed.sink',
      surface: 'render-browser',
    });
    expect(
      validateThreatMatrixCoverage(validationOptions({ manifest: stale })).join('\n'),
    ).toContain('stale/unknown C9 sink mapping: stale.removed.sink');

    const unknownCell = cloneManifest();
    const firstMapping = (unknownCell.sinkMappings as Record<string, unknown>[])[0]!;
    firstMapping.surface = 'unknown-surface';
    firstMapping.cells = { Execute: 'c9-control' };
    expect(
      validateThreatMatrixCoverage(validationOptions({ manifest: unknownCell })).join('\n'),
    ).toMatch(
      /unknown threat-matrix surface unknown-surface[\s\S]*unknown threat category Execute/u,
    );

    const staleEvidence = cloneManifest();
    const proofs = staleEvidence.proofs as Record<string, Record<string, unknown>>;
    proofs['c9-control']!.evidence = ['security/removed-threat-proof.test.ts'];
    expect(
      validateThreatMatrixCoverage(validationOptions({ manifest: staleEvidence })).join('\n'),
    ).toContain('c9-control: stale evidence path: security/removed-threat-proof.test.ts');
  });

  it('rejects deleted mappings rather than allowing a partial matrix', () => {
    const missing = cloneManifest();
    (missing.auditedEscapeMappings as Record<string, unknown>[]).shift();
    expect(
      validateThreatMatrixCoverage(validationOptions({ manifest: missing })).join('\n'),
    ).toContain('audited escape mappings missing:');
  });

  it('rejects duplicate mappings and stale documented surface labels', () => {
    const duplicate = cloneManifest();
    const publicMappings = duplicate.publicSurfaceMappings as Record<string, unknown>[];
    publicMappings.push({
      cells: { Au: 'public-security-surface-control' },
      ids: ['storage-download-signer'],
      surface: 'runtime-infra',
    });
    expect(
      validateThreatMatrixCoverage(validationOptions({ manifest: duplicate })).join('\n'),
    ).toContain('duplicate public security surface mapping: storage-download-signer');

    expect(
      validateThreatMatrixCoverage(
        validationOptions({
          documentedSurfaceLabels: [
            ...documentedSurfaceLabels().filter((label) => label !== 'Runtime / infra'),
            'Retired / stale surface',
          ],
        }),
      ).join('\n'),
    ).toMatch(
      /Retired \/ stale surface[\s\S]*Runtime \/ infra|Runtime \/ infra[\s\S]*Retired \/ stale surface/u,
    );
  });
});
