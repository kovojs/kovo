import { beforeAll, describe, expect, it } from 'vitest';

import {
  evaluateSpecConformanceClosure,
  loadSpecConformanceInput,
  scanDiagnosticProductionSources,
} from './check-spec-conformance-closure.mjs';

let baseline;

beforeAll(async () => {
  baseline = await loadSpecConformanceInput();
});

function evaluate(overrides = {}) {
  return evaluateSpecConformanceClosure({ ...baseline, ...overrides });
}

function replaceProductionFile(fileName, replace) {
  return baseline.productionFiles.map((file) =>
    file.path === fileName ? { ...file, text: replace(file.text) } : file,
  );
}

describe('SPEC↔implementation diagnostic conformance closure (SPEC §2/§11)', () => {
  it('binds the live registry, generated constructors, production sites, and evidence ledger', () => {
    expect(evaluate()).toMatchObject({ codes: 90, errorCodes: 70, findings: [], ok: true });
  });

  it('C13 mutation: rejects a SPEC row whose enforcement-class column disappears', () => {
    const specMarkdown = baseline.specMarkdown.replace(
      /^\| KV201 \| error\s+\| compile-error\s+\|/mu,
      '| KV201 | error |',
    );
    expect(evaluate({ specMarkdown }).findings.join('\n')).toContain(
      'diagnosticDefinitions: unexpected KV201',
    );
  });

  it('C13 mutation: rejects a stale generated constructor map', () => {
    const generatedSource = baseline.generatedSource.replace(
      "  KV201: createDiagnosticConstructor('KV201'),\n",
      '',
    );
    expect(evaluate({ generatedSource }).findings.join('\n')).toContain('stale or incomplete');
  });

  it('C13 mutation: rejects severity and enforcement-class drift', () => {
    const runtimeRegistry = {
      ...baseline.runtimeRegistry,
      KV201: {
        ...baseline.runtimeRegistry.KV201,
        enforcementClass: 'audited-escape',
        severity: 'warn',
      },
    };
    const findings = evaluate({ runtimeRegistry }).findings.join('\n');
    expect(findings).toContain('generated registry severity warn disagrees');
    expect(findings).toContain('generated registry enforcement audited-escape disagrees');
  });

  it('C13 mutation: rejects deletion of a registered production enforcement site', () => {
    const productionFiles = replaceProductionFile('packages/server/src/build.ts', (text) =>
      text.replaceAll("'KV445'", "'KV446'"),
    );
    expect(evaluate({ productionFiles }).findings).toContain(
      'KV445: no derived production enforcement site',
    );
  });

  it('C13 mutation: rejects a deleted red fixture and missing own-layer evidence', () => {
    const redName = baseline.evidence.diagnostics.KV229.red.test;
    const file = baseline.evidence.diagnostics.KV229.red.file;
    const fixtureFiles = {
      ...baseline.fixtureFiles,
      [file]: baseline.fixtureFiles[file].replace(redName, `${redName} deleted`),
    };
    const evidence = {
      ...baseline.evidence,
      diagnostics: {
        ...baseline.evidence.diagnostics,
        KV415: { ...baseline.evidence.diagnostics.KV415, ownLayer: undefined },
      },
    };
    const findings = evaluate({ evidence, fixtureFiles }).findings.join('\n');
    expect(findings).toContain(`KV229: red fixture test "${redName}" is missing`);
    expect(findings).toContain('KV415: own-layer fixture reference is incomplete');
  });

  it('C13 mutation: rejects ad hoc production diagnostic literals but allows test fixtures', () => {
    const literal =
      "export const diagnostic = { code: 'KV415', message: 'bad', severity: 'notice' };";
    expect(
      scanDiagnosticProductionSources([
        { path: 'packages/server/src/conformance-ad-hoc.ts', text: literal },
      ]).findings,
    ).toEqual([expect.stringContaining('ad hoc KV415 production diagnostic literal')]);
    expect(
      scanDiagnosticProductionSources([
        { path: 'packages/server/src/conformance-ad-hoc.test.ts', text: literal },
      ]).findings,
    ).toEqual([]);
  });

  it('C13 mutation: requires an explicit reviewed applicability reason for zero emission', () => {
    const productionFiles = replaceProductionFile('packages/server/src/build.ts', (text) =>
      text.replaceAll("'KV445'", "'KV446'"),
    );
    const evidence = {
      ...baseline.evidence,
      diagnostics: {
        ...baseline.evidence.diagnostics,
        KV445: {
          kind: 'reviewed-zero-emission',
          mutation: baseline.evidence.diagnostics.KV445.red,
          reason: '',
          reviewer: '',
        },
      },
    };
    const findings = evaluate({ evidence, productionFiles }).findings.join('\n');
    expect(findings).toContain('zero-emission applicability needs a reviewed, explicit reason');
    expect(findings).toContain('zero-emission applicability needs a named reviewer role');
  });

  it('accepts a zero-emission row only with reviewed reason, reviewer, and mutation evidence', () => {
    const productionFiles = replaceProductionFile('packages/server/src/build.ts', (text) =>
      text.replaceAll("'KV445'", "'KV446'"),
    );
    const evidence = {
      ...baseline.evidence,
      diagnostics: {
        ...baseline.evidence.diagnostics,
        KV445: {
          kind: 'reviewed-zero-emission',
          mutation: baseline.evidence.diagnostics.KV445.red,
          reason:
            'Reviewed platform-only diagnostic is not applicable to this checked target and has no synthetic emission call.',
          reviewer: 'security-conformance-owner',
        },
      },
    };
    expect(evaluate({ evidence, productionFiles }).findings).toEqual([]);
  });

  it('C13 mutation: keeps approved wrappers bound to the validating registry door', () => {
    const productionFiles = replaceProductionFile('packages/compiler/src/diagnostics.ts', (text) =>
      text.replaceAll('createRegisteredDiagnostic(', 'removedRegistryDoor('),
    );
    expect(evaluate({ productionFiles }).findings.join('\n')).toContain(
      'approved diagnostic wrapper lost registry-door anchor',
    );
  });

  it('promotes diagnostics-ref registry equality into the root closure', () => {
    expect(
      evaluate({
        diagnosticsRefResult: { codes: 0, findings: ['mutated diagnostics catalog'], ok: false },
      }).findings,
    ).toContain('diagnostics-ref registry equality failed: mutated diagnostics catalog');
  });
});
