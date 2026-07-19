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

  it('C13 canaries: rejects local shadows, namespace lookalikes, and fake diagnostics.at', () => {
    const canaries = [
      [
        'local shadow',
        "const createRegisteredDiagnostic = () => undefined; createRegisteredDiagnostic('KV415');",
      ],
      [
        'parameter shadow',
        [
          "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
          "export function fake(createRegisteredDiagnostic) { createRegisteredDiagnostic('KV415'); }",
        ].join('\n'),
      ],
      [
        'namespace lookalike',
        [
          "import * as diagnosticDoor from '@kovojs/core/internal/diagnostics';",
          "diagnosticDoor.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'member lookalike',
        "const fake = { drizzleDiagnostic() {} }; fake.drizzleDiagnostic({ code: 'KV415' });",
      ],
      ['fake factory', "const diagnostics = { at() {} }; diagnostics.at('KV415');"],
      [
        'fake typed factory',
        [
          'interface DiagnosticFactory { at(code: string): void }',
          "export function fake(diagnostics: DiagnosticFactory) { diagnostics.at('KV415'); }",
        ].join('\n'),
      ],
    ];

    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.siteCount, name).toBe(0);
      expect(result.findings.join('\n'), name).toContain('untrusted diagnostic emitter binding');
    }
  });

  it('C13 canaries: rejects import/local aliases and generated-constructor namespace drift', () => {
    const canaries = [
      [
        'import alias',
        [
          "import { createRegisteredDiagnostic as emit } from '@kovojs/core/internal/diagnostics';",
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'local alias',
        [
          "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
          'const emit = createRegisteredDiagnostic;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'assignment alias',
        [
          "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
          'let emit;',
          'emit = createRegisteredDiagnostic;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'constructor alias',
        [
          "import { diagnosticConstructors as constructors } from '@kovojs/core/internal/diagnostics';",
          'constructors.KV313();',
        ].join('\n'),
      ],
      [
        'constructor namespace',
        [
          "import * as diagnostics from '@kovojs/core/internal/diagnostics';",
          'diagnostics.diagnosticConstructors.KV313();',
        ].join('\n'),
      ],
      [
        'namespace member alias',
        [
          "import * as diagnostics from '@kovojs/core/internal/diagnostics';",
          'const emit = diagnostics.createRegisteredDiagnostic;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'namespace destructuring alias',
        [
          "import * as diagnostics from '@kovojs/core/internal/diagnostics';",
          'const { createRegisteredDiagnostic: emit } = diagnostics;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'factory type alias',
        [
          "import type { DiagnosticFactory as Factory } from '../../compiler/src/diagnostics.js';",
          "export function emit(diagnostics: Factory) { diagnostics.at('KV415'); }",
        ].join('\n'),
      ],
      [
        'factory capability reassignment',
        [
          "import type { DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          'export function emit(diagnostics: DiagnosticFactory) {',
          '  diagnostics = { at() {} } as DiagnosticFactory;',
          "  diagnostics.at('KV415');",
          '}',
        ].join('\n'),
      ],
    ];

    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.siteCount, name).toBe(0);
      expect(result.findings.join('\n'), name).toContain('forbidden');
    }
  });

  it('accepts only exact named root, generated-constructor, and DiagnosticFactory bindings', () => {
    const direct = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-exact-root.ts',
        text: [
          "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
          "createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      },
      {
        path: 'packages/browser/src/conformance-exact-constructor.ts',
        text: [
          "import { diagnosticConstructors } from '@kovojs/core/internal/diagnostics';",
          'diagnosticConstructors.KV313();',
        ].join('\n'),
      },
      {
        path: 'packages/compiler/src/validate/conformance-exact-factory.ts',
        text: [
          "import type { DiagnosticFactory } from '../diagnostics.js';",
          "export function emit(diagnostics: DiagnosticFactory) { diagnostics.at('KV415'); }",
        ].join('\n'),
      },
    ]);
    expect(direct.findings).toEqual([]);
    expect(direct.siteCount).toBe(3);
  });

  it('C13 canary: rejects a nested same-file shadow of a reviewed wrapper', () => {
    const result = scanDiagnosticProductionSources([
      {
        path: 'packages/compiler/src/diagnostics.ts',
        text: [
          'export function diagnosticFor() { return undefined; }',
          'export function fake() {',
          '  function diagnosticFor() { return undefined; }',
          "  return diagnosticFor('KV415');",
          '}',
        ].join('\n'),
      },
    ]);
    expect(result.siteCount).toBe(0);
    expect(result.findings.join('\n')).toContain('local function shadows a reviewed emitter name');
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
      'reviewed diagnostic wrapper has no exact path',
    );
  });

  it('C13 mutation: a wrapper-local root lookalike cannot satisfy the reviewed call graph', () => {
    const productionFiles = replaceProductionFile('packages/compiler/src/diagnostics.ts', (text) =>
      text.replace(
        "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
        'function createRegisteredDiagnostic() { return undefined; }',
      ),
    );
    const findings = evaluate({ productionFiles }).findings.join('\n');
    expect(findings).toContain('reviewed wrapper uses untrusted emitter');
    expect(findings).toContain('reviewed diagnostic wrapper has no exact path');
  });

  it('C13 mutation: rejects alias drift even when it still reaches the real root function', () => {
    const productionFiles = replaceProductionFile('packages/server/src/build.ts', (text) =>
      text
        .replace(
          'import { createRegisteredDiagnostic }',
          'import { createRegisteredDiagnostic as emitDiagnostic }',
        )
        .replaceAll('createRegisteredDiagnostic(', 'emitDiagnostic('),
    );
    expect(evaluate({ productionFiles }).findings.join('\n')).toContain(
      'alias drift emitDiagnostic -> createRegisteredDiagnostic is forbidden',
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
