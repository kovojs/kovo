import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createDiagnosticFactory, diagnosticAt } from '../packages/compiler/src/diagnostics.ts';

import {
  evaluateSpecConformanceClosure,
  loadSpecConformanceInput,
  scanDiagnosticProductionSources as scanProductionSources,
  validateDiagnosticEmissionDoorBindings,
} from './check-spec-conformance-closure.mjs';

let baseline;

vi.setConfig({ testTimeout: 600_000 });

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

function productionText(fileName) {
  const file = baseline.productionFiles.find((candidate) => candidate.path === fileName);
  if (file === undefined) throw new Error(`Missing production file ${fileName}`);
  return file.text;
}

function diagnosticDoorFiles(replacements = {}) {
  const paths = new Set([
    'packages/core/src/diagnostics.ts',
    'packages/core/src/internal/diagnostics.ts',
    'packages/core/src/internal/diagnostic-registry.generated.ts',
    'packages/compiler/src/diagnostics.ts',
    'packages/cli/src/commands/build-export.ts',
    ...Object.keys(replacements),
  ]);
  return [...paths].map((fileName) => ({
    path: fileName,
    text: replacements[fileName] ?? productionText(fileName),
  }));
}

function scanDiagnosticProductionSources(files) {
  const provided = new Set(files.map((file) => file.path));
  const required = [
    {
      path: 'packages/core/src/diagnostics.ts',
      text: 'export function createRegisteredDiagnostic() {}',
    },
    {
      path: 'packages/core/src/internal/diagnostics.ts',
      text: [
        "export * from '../diagnostics.ts';",
        "export * from './diagnostic-registry.generated.js';",
      ].join('\n'),
    },
    {
      path: 'packages/core/src/internal/diagnostic-registry.generated.ts',
      text: 'export const diagnosticConstructors = {};',
    },
  ];
  return scanProductionSources([...required.filter((file) => !provided.has(file.path)), ...files]);
}

function replaceFunctionDeclaration(text, signature, replacement) {
  const start = text.indexOf(signature);
  if (start < 0) throw new Error(`Missing function signature ${signature}`);
  const end = text.indexOf('\n}\n', start);
  if (end < 0) throw new Error(`Missing function end ${signature}`);
  return `${text.slice(0, start)}${replacement}${text.slice(end + 2)}`;
}

describe('SPEC↔implementation diagnostic conformance closure (SPEC §2/§11)', () => {
  it('binds the live registry, generated constructors, production sites, and evidence ledger', () => {
    expect(evaluate()).toMatchObject({
      codes: 92,
      errorCodes: 72,
      findings: [],
      ok: true,
      sites: 202,
    });
  }, 600_000);

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

  it('C13 anchor: rejects coherent compile/runtime relabels against actual-layer evidence', () => {
    const mutants = [
      {
        code: 'KV201',
        from: 'compile-error',
        to: 'fail-closed-runtime',
      },
      {
        code: 'KV415',
        from: 'fail-closed-runtime',
        to: 'compile-error',
      },
    ];

    for (const mutant of mutants) {
      const specMarkdown = baseline.specMarkdown.replace(
        new RegExp(`^(\\| ${mutant.code} \\| error\\s+\\| )${mutant.from}(\\s+\\|)`, 'mu'),
        `$1${mutant.to}$2`,
      );
      const generatedSource = baseline.generatedSource.replace(
        `createRegisteredDiagnosticDefinition('${mutant.code}', '${mutant.from}')`,
        `createRegisteredDiagnosticDefinition('${mutant.code}', '${mutant.to}')`,
      );
      const runtimeRegistry = {
        ...baseline.runtimeRegistry,
        [mutant.code]: {
          ...baseline.runtimeRegistry[mutant.code],
          enforcementClass: mutant.to,
        },
      };

      expect(
        evaluate({ generatedSource, runtimeRegistry, specMarkdown }).findings.join('\n'),
      ).toContain(
        `${mutant.code}: independently bound primary actual layer ${mutant.from} disagrees with SPEC enforcement ${mutant.to}`,
      );
    }
  });

  it('binds mixed compile/runtime backstops without overriding the reviewed primary layer', () => {
    const bindings = baseline.evidence.actualLayerBindings;
    expect(bindings.primary['compile-error']).toContain('KV236');
    expect(bindings.productionSites['fail-closed-runtime']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('KV236|packages/core/src/internal/sink-policy.ts:'),
        expect.stringContaining('KV236|packages/server/src/html.ts:'),
      ]),
    );
    expect(bindings.primary['fail-closed-runtime']).toContain('KV402');
    expect(bindings.productionSites['compile-error']).toEqual(
      expect.arrayContaining([
        expect.stringContaining('KV402|packages/compiler/src/validate/component-contracts.ts:'),
      ]),
    );
    expect(evaluate().findings).toEqual([]);
  });

  it('C13 mutation: actual-layer review and exact witness bodies cannot be relabeled', () => {
    const bindings = structuredClone(baseline.evidence.actualLayerBindings);
    const runtimeIndex = bindings.productionSites['fail-closed-runtime'].findIndex((identity) =>
      identity.startsWith('KV236|packages/core/src/internal/sink-policy.ts:'),
    );
    const [runtimeFloor] = bindings.productionSites['fail-closed-runtime'].splice(runtimeIndex, 1);
    bindings.productionSites['compile-error'].push(runtimeFloor);
    const relabeledEvidence = { ...baseline.evidence, actualLayerBindings: bindings };
    expect(evaluate({ evidence: relabeledEvidence }).findings.join('\n')).toContain(
      'independently reviewed actual-layer binding manifest drifted',
    );

    const row = baseline.evidence.diagnostics.KV415;
    const fixtureFiles = {
      ...baseline.fixtureFiles,
      [row.ownLayer.file]: baseline.fixtureFiles[row.ownLayer.file].replace(
        "'X Kovo Header Proof': 'unsafe'",
        "'X Kovo Header Proof': 'mutated'",
      ),
    };
    expect(evaluate({ fixtureFiles }).findings.join('\n')).toContain(
      'witness actual-layer bindings',
    );
  });

  it('C13 mutation: executes every runtime registry row and requires exact frozen semantics', () => {
    const findings = evaluate({
      runtimeDefinitionFactory(code) {
        return Object.freeze({
          ...baseline.definitions[code],
          code: 'KV415',
          enforcementClass: 'audited-escape',
        });
      },
    }).findings.join('\n');
    expect(findings).toContain(
      'KV201: runtime diagnostic registry definition disagrees with the exact frozen SPEC row',
    );
    expect(findings).toContain(
      'KV415: runtime diagnostic registry definition disagrees with the exact frozen SPEC row',
    );
  });

  it('C13 mutations: the runtime source registry remains an exact deeply frozen own-data map', () => {
    const mutableDefinitions = Object.fromEntries(
      Object.entries(baseline.definitions).map(([code, definition]) => [code, { ...definition }]),
    );
    expect(evaluate({ definitions: mutableDefinitions }).findings.join('\n')).toContain(
      'runtime registry map must be the exact deeply frozen own-data code map',
    );

    const hiddenExtra = Object.create(
      Object.getPrototypeOf(baseline.definitions),
      Object.getOwnPropertyDescriptors(baseline.definitions),
    );
    Object.defineProperty(hiddenExtra, 'KV999', {
      configurable: false,
      enumerable: false,
      value: Object.freeze({ code: 'KV999', message: 'forged', severity: 'error' }),
      writable: false,
    });
    Object.freeze(hiddenExtra);
    const hiddenFindings = evaluate({ definitions: hiddenExtra }).findings.join('\n');
    expect(hiddenFindings).toContain('diagnosticDefinitions: unexpected KV999');
    expect(hiddenFindings).toContain(
      'runtime registry map must be the exact deeply frozen own-data code map',
    );

    const productionFiles = replaceProductionFile('packages/core/src/diagnostics.ts', (text) =>
      text.replace('freezeDiagnosticRegistryValue(diagnosticDefinitions);\n', ''),
    );
    expect(evaluate({ productionFiles }).findings.join('\n')).toContain(
      'registry must pass exactly once through the reviewed deep-freeze initialization',
    );
  });

  it('C13 mutation: binds source and published package exports to the exact diagnostics bridge', () => {
    const sourceRemap = structuredClone(baseline.corePackageManifest);
    sourceRemap.exports['./internal/diagnostics'] = './src/internal/forged.ts';
    expect(evaluate({ corePackageManifest: sourceRemap }).findings.join('\n')).toContain(
      'source ./internal/diagnostics export must resolve to the exact reviewed bridge',
    );

    const publishRemap = structuredClone(baseline.corePackageManifest);
    publishRemap.publishConfig.exports['./internal/diagnostics'].default =
      './dist/internal/forged.mjs';
    expect(evaluate({ corePackageManifest: publishRemap }).findings.join('\n')).toContain(
      'published ./internal/diagnostics export must resolve to the exact built bridge',
    );

    const conditionalShadow = structuredClone(baseline.corePackageManifest);
    conditionalShadow.publishConfig.exports['./internal/diagnostics'] = {
      node: './dist/internal/forged.mjs',
      ...conditionalShadow.publishConfig.exports['./internal/diagnostics'],
    };
    expect(evaluate({ corePackageManifest: conditionalShadow }).findings.join('\n')).toContain(
      'published ./internal/diagnostics export must resolve to the exact built bridge',
    );

    const forgedBuild = structuredClone(baseline.corePackageManifest);
    forgedBuild.scripts['build:dist'] = 'node forged-build.mjs src/internal/diagnostics.ts';
    expect(evaluate({ corePackageManifest: forgedBuild }).findings.join('\n')).toContain(
      'build:dist must compile the exact reviewed diagnostics bridge',
    );
  });

  it('C13 mutation: rejects deletion of a registered production enforcement site', () => {
    const productionFiles = replaceProductionFile('packages/server/src/build.ts', (text) =>
      text.replaceAll("'KV445'", "'KV446'"),
    );
    expect(evaluate({ productionFiles }).findings).toContain(
      'KV445: no derived production enforcement site',
    );
  });

  it('C13 mutation: rejects paired diagnostic-code drift that preserves the site count', () => {
    const productionFiles = replaceProductionFile(
      'packages/cli/src/graph-explain-format.ts',
      (text) =>
        text.replace(
          "return createRegisteredDiagnostic('KV406', fields, options);",
          "return createRegisteredDiagnostic('KV416', fields, options);",
        ),
    );
    const result = evaluate({ productionFiles });
    expect(result.sites).toBe(202);
    expect(result.findings.join('\n')).toContain(
      'production diagnostic emission site manifest drifted',
    );
  });

  it('C13 mutations: counted sites cannot be dead fallbacks or identity-laundered clones', () => {
    const fileName = 'packages/cli/src/graph-output.ts';
    const exact =
      "const diagnostic = createRegisteredDiagnostic('KV418', {}, { includeHelp: true });";
    const mutants = [
      `const diagnostic = JSON.parse('{"code":"KV418","message":"forged","severity":"error"}') ?? createRegisteredDiagnostic('KV418', {}, { includeHelp: true });`,
      `const diagnostic = JSON.parse(JSON.stringify(createRegisteredDiagnostic('KV418', {}, { includeHelp: true })));`,
    ];
    for (const replacement of mutants) {
      const productionFiles = replaceProductionFile(fileName, (text) =>
        text.replace(exact, replacement),
      );
      const result = evaluate({ productionFiles });
      expect(result.sites).toBe(202);
      expect(result.findings.join('\n')).toContain(
        'production diagnostic emission site manifest drifted',
      );
    }

    const outerControlFiles = replaceProductionFile('packages/drizzle/src/graph.ts', (text) =>
      text.replace(
        ".filter((touch) => touch.predicate === 'non-eq')",
        ".filter((touch) => false && touch.predicate === 'non-eq')",
      ),
    );
    expect(evaluate({ productionFiles: outerControlFiles }).findings.join('\n')).toContain(
      'production diagnostic emission site manifest drifted',
    );
  }, 600_000);

  it('C13 mutation: production posture cannot disable the compiler validator dispatcher', () => {
    const productionFiles = replaceProductionFile(
      'packages/compiler/src/validate/pipeline.ts',
      (text) =>
        text.replace(
          "const validatorLength = compilerArrayLength(compilerValidators, 'Compiler validators');",
          "const validatorLength = process.env.NODE_ENV === 'production' ? 0 : compilerArrayLength(compilerValidators, 'Compiler validators');",
        ),
    );
    const result = evaluate({ productionFiles });
    expect(result.sites).toBe(202);
    expect(result.findings.join('\n')).toContain(
      'reviewed validator registry and dispatch summary drifted',
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

  it('C13 mutation: a green witness cannot positively assert its own diagnostic', () => {
    const row = baseline.evidence.diagnostics.KV415;
    const file = row.green.file;
    const marker = `it('${row.green.test}', () => {`;
    const fixtureFiles = {
      ...baseline.fixtureFiles,
      [file]: baseline.fixtureFiles[file].replace(
        marker,
        `${marker}\n    expect('KV415').toContain('KV415');`,
      ),
    };
    expect(evaluate({ fixtureFiles }).findings.join('\n')).toContain(
      'KV415: green fixture test "accepts a whole dynamic bag when every name is directly allowlisted" positively asserts the diagnostic instead of an accepted path',
    );
  });

  it('C13 mutations: fixture witnesses cannot be vacuous or reused across roles', () => {
    const row = baseline.evidence.diagnostics.KV415;
    const file = row.red.file;
    const fixtureFiles = {
      ...baseline.fixtureFiles,
      [file]: baseline.fixtureFiles[file].replace(
        /it\('fails a whole dynamic bag when any name falls outside the direct allowlist', \(\) => \{[\s\S]*?\n  \}\);/u,
        "it('fails a whole dynamic bag when any name falls outside the direct allowlist', () => {\n    expect(true).toBe(true);\n  });",
      ),
    };
    const evidence = {
      ...baseline.evidence,
      diagnostics: {
        ...baseline.evidence.diagnostics,
        KV415: { ...row, ownLayer: row.red },
      },
    };
    const findings = evaluate({ evidence, fixtureFiles }).findings.join('\n');
    expect(findings).toContain('has no non-vacuous assertion');
    expect(findings).toContain('no longer asserts the diagnostic code in its callback');
    expect(findings).toContain('red, green, and own-layer fixtures must be three distinct tests');
    expect(findings).toContain('exact fixture witness manifest drifted');
  });

  it('C13 mutation: referenced evidence cannot live under a disabled or exclusive suite', () => {
    const row = baseline.evidence.diagnostics.KV229;
    const file = row.red.file;
    const mutants = [
      baseline.fixtureFiles[file].replace(
        "describe('server static export'",
        "describe.skip('server static export'",
      ),
      baseline.fixtureFiles[file].replace(
        "import { describe, expect, it } from 'vitest';",
        "import { describe as realDescribe, expect, it } from 'vitest';\nconst describe = realDescribe.skip;",
      ),
      baseline.fixtureFiles[file].replace(
        "describe('server static export'",
        "false && describe('server static export'",
      ),
      `${baseline.fixtureFiles[file]}\nit['only']('exclusive placeholder', () => expect(true).toBe(true));\n`,
    ];
    for (const text of mutants) {
      const fixtureFiles = { ...baseline.fixtureFiles, [file]: text };
      const findings = evaluate({ fixtureFiles }).findings.join('\n');
      expect(findings).toContain(`KV229: red fixture test "${row.red.test}" is missing`);
      expect(findings).toContain('exact fixture witness manifest drifted');
    }
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

  it('C13 canaries: dynamic diagnostic-shaped construction cannot bypass the registry door', () => {
    const canaries = [
      [
        'joined code',
        "const code=['K','V415'].join(''); export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'raw template code',
        "const code=String.raw`KV${415}`; export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'character code',
        "const code=String.fromCharCode(75,86,52,49,53); export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'iife code',
        "const code=(()=> 'KV415')(); export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'identity code',
        "const id=(value)=>value; const code=id('KV415'); export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'String coercion code',
        "const code=String('KV415'); export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'concat code',
        "const code='KV'.concat('415'); export const fake={code,message:'fake',severity:'error'};",
      ],
      [
        'incremental assignments',
        "export const fake={}; fake.code='KV415'; fake.message='fake'; fake.severity='error';",
      ],
      [
        'define properties',
        "export const fake=Object.defineProperties({}, {code:{value:'KV415'},message:{value:'fake'},severity:{value:'error'}});",
      ],
      [
        'from entries',
        "export const fake=Object.fromEntries([['code','KV415'],['message','fake'],['severity','error']]);",
      ],
      [
        'aliased from entries',
        "const make=Object.fromEntries; export const fake=make([['code','KV415'],['message','fake'],['severity','error']]);",
      ],
      [
        'spread helper result',
        "const identity=()=>({code:'KV415'}); export const fake={...identity(),message:'fake',severity:'error'};",
      ],
      [
        'constructor assignments',
        "export class Fake { constructor(){this.code='KV415';this.message='fake';this.severity='error';} }",
      ],
      [
        'Reflect assignments',
        "export const fake={}; Reflect.set(fake,'code','KV415'); Reflect.set(fake,'message','fake'); Reflect.set(fake,'severity','error');",
      ],
      [
        'class getter fields',
        "export class Fake { get code(){return 'KV415'} get message(){return 'fake'} get severity(){return 'error'} }",
      ],
    ];
    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.findings.join('\n'), name).toMatch(/ad hoc (?:dynamic-code|KV415)/u);
    }
  });

  it('C13 mutation: reviewed dynamic structured-shape summaries are exact and complete', () => {
    const changed = replaceProductionFile('packages/server/src/env.ts', (text) =>
      text.replace(
        'must be at least ${FRAMEWORK_SECRET_MIN_LENGTH} bytes',
        'must contain at least ${FRAMEWORK_SECRET_MIN_LENGTH} bytes',
      ),
    );
    const findings = evaluate({ productionFiles: changed }).findings.join('\n');
    expect(findings).toContain('unreviewed dynamic structured diagnostic literal');
    expect(findings).toContain('stale reviewed dynamic diagnostic-shape summary');
  });

  it('C13 canaries: excluded test and conformance sources cannot re-enter production', () => {
    const literal =
      "export const diagnostic = { code: 'KV415', message: 'bad', severity: 'notice' };";
    for (const [name, excludedPath, importPath] of [
      ['test source', 'packages/server/src/forged.test.ts', './forged.test.js'],
      [
        'conformance package',
        'packages/conformance-fixtures/src/forged.ts',
        '../../conformance-fixtures/src/forged.js',
      ],
      ['test directory', 'packages/server/test/forged.ts', '../test/forged.js'],
      ['template directory', 'packages/server/templates/forged.ts', '../templates/forged.js'],
    ]) {
      const result = scanDiagnosticProductionSources([
        { path: excludedPath, text: literal },
        {
          path: 'packages/server/src/runtime.ts',
          text: `export { diagnostic } from '${importPath}';`,
        },
      ]);
      expect(result.findings.join('\n'), name).toContain(
        'production source may not reach excluded framework source',
      );
    }

    for (const [name, dynamicImport] of [
      [
        'aliased dynamic import',
        "const target='./forged.test.js'; export const diagnostic=await import(target);",
      ],
      [
        'concatenated dynamic import',
        "export const diagnostic=await import('./forged.'.concat('test.js'));",
      ],
    ]) {
      const result = scanDiagnosticProductionSources([
        { path: 'packages/server/src/forged.test.ts', text: literal },
        { path: `packages/server/src/${name.replaceAll(' ', '-')}.ts`, text: dynamicImport },
      ]);
      expect(result.findings.join('\n'), name).toContain(
        'production source may not reach excluded framework source',
      );
    }

    const rootSource = scanDiagnosticProductionSources([
      { path: 'packages/server/runtime.ts', text: literal },
    ]);
    expect(rootSource.findings.join('\n')).toContain('ad hoc KV415 production diagnostic literal');
  });

  it('C13 mutation: reviewed excluded-source edges fail when either endpoint disappears', () => {
    const deletedImporter = baseline.productionFiles.filter(
      (file) => file.path !== 'packages/browser/src/inline-loader-response-apply-fixture.ts',
    );
    expect(
      scanProductionSources(deletedImporter, {
        validateSummaryCompleteness: true,
      }).findings.join('\n'),
    ).toContain('stale reviewed excluded-source reachability summary');
  });

  it('C13 canaries: syntax-derived admission includes escaped spellings and TS module extensions', () => {
    for (const extension of ['mts', 'cts']) {
      const result = scanDiagnosticProductionSources([
        {
          path: `packages/server/src/conformance-escaped.${extension}`,
          text: [
            "import { create\\u0052egisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
            "create\\u0052egisteredDiagnostic('\\x4bV415');",
          ].join('\n'),
        },
      ]);
      expect(result.siteCount, extension).toBe(1);
      expect([...result.emissionSites.keys()], extension).toEqual(['KV415']);
    }

    const literal = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-escaped-literal.mts',
        text: "export const d={code:'\\x4bV415',message:'forged',severity:'error'};",
      },
    ]);
    expect(literal.findings.join('\n')).toContain('ad hoc KV415 production diagnostic literal');
  });

  it('C13 canaries: production-looking helper and coverage names cannot escape the census', () => {
    for (const file of [
      'packages/server/src/test-helpers.ts',
      'packages/server/src/forged.test-helper.ts',
      'packages/server/src/diagnostic-coverage/forged.ts',
      'packages/server/src/diagnostic-coverage-matrix.data.ts',
      'packages/server/src/spec-coverage-map.ts',
    ]) {
      const result = scanDiagnosticProductionSources([
        {
          path: file,
          text: "export const forged={code:'KV415',message:'forged',severity:'notice'};",
        },
      ]);
      expect(result.findings.join('\n'), file).toContain(
        'ad hoc KV415 production diagnostic literal',
      );
    }
  });

  it('C13 mutations: registry literal exemptions are exact full-file capabilities', () => {
    for (const fileName of [
      'packages/core/src/diagnostics.ts',
      'packages/core/src/internal/diagnostic-registry.generated.ts',
      'packages/core/src/internal/security-markers.ts',
      'packages/core/src/internal/source-sink-registry.ts',
    ]) {
      const result = evaluate({
        productionFiles: replaceProductionFile(
          fileName,
          (text) =>
            `${text}\nexport const forged={code:'KV415',message:'forged',severity:'error'};\n`,
        ),
      });
      expect(result.findings.join('\n'), fileName).toContain(
        'diagnostic registry literal exemption requires its exact reviewed full-file digest',
      );
    }

    const deleted = baseline.productionFiles.filter(
      (file) => file.path !== 'packages/core/src/internal/security-markers.ts',
    );
    expect(
      scanProductionSources(deleted, {
        validateSummaryCompleteness: true,
      }).findings.join('\n'),
    ).toContain('reviewed diagnostic registry literal exemption source is missing');
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

  it('C13 canaries: emitter capabilities cannot escape through indirect aliases, objects, members, bind, or destructuring', () => {
    const rootImport =
      "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';";
    const canaries = [
      [
        'second-hop alias',
        [
          rootImport,
          'const first = createRegisteredDiagnostic;',
          'const second = first;',
          "second('KV415');",
        ].join('\n'),
      ],
      [
        'object member',
        [
          rootImport,
          'const emitters = { emit: createRegisteredDiagnostic };',
          "emitters.emit('KV415');",
        ].join('\n'),
      ],
      [
        'member assignment',
        [
          rootImport,
          'const emitters = { emit: undefined };',
          'emitters.emit = createRegisteredDiagnostic;',
          "emitters.emit('KV415');",
        ].join('\n'),
      ],
      [
        'bind',
        [
          rootImport,
          'const emit = createRegisteredDiagnostic.bind(undefined);',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'call member',
        [rootImport, "createRegisteredDiagnostic.call(undefined, 'KV415');"].join('\n'),
      ],
      [
        'destructuring',
        [
          rootImport,
          'const holder = { emit: createRegisteredDiagnostic };',
          'const { emit } = holder;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'unreviewed wrapper',
        [
          rootImport,
          'function emit(code) { return createRegisteredDiagnostic(code); }',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'constructor member escape',
        [
          "import { diagnosticConstructors } from '@kovojs/core/internal/diagnostics';",
          'const holder = { emit: diagnosticConstructors.KV415 };',
          'holder.emit();',
        ].join('\n'),
      ],
      [
        'factory sink bind',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          'export function fake(diagnostics: DiagnosticFactory) {',
          '  const emit = diagnosticAt.bind(undefined, diagnostics);',
          "  return emit('KV415');",
          '}',
        ].join('\n'),
      ],
      [
        'reviewed wrapper object indirection',
        [
          "import { drizzleDiagnostic } from '../../drizzle/src/static/diagnostics.js';",
          "const input = { code: 'KV406', detail: 'hidden' };",
          'drizzleDiagnostic(input);',
        ].join('\n'),
      ],
      ['re-export laundering', [rootImport, 'export { createRegisteredDiagnostic };'].join('\n')],
    ];

    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.siteCount, name).toBe(0);
      expect(result.findings.join('\n'), name).toMatch(
        /direct callee|exact call position|must bind its code|forbidden/u,
      );
    }
  });

  it('C13 canaries: reviewed diagnostic modules cannot be acquired dynamically', () => {
    const canaries = [
      [
        'dynamic import with folded module name',
        [
          "const prefix = '@kovojs/core/internal/';",
          "const diagnostics = await import(prefix + 'diagnostics');",
          "const member = 'create' + 'RegisteredDiagnostic';",
          "diagnostics[member]('KV415');",
        ].join('\n'),
      ],
      [
        'require with folded module name',
        [
          "const suffix = 'diagnostics';",
          "const diagnostics = require('@kovojs/core/internal/' + suffix);",
          "diagnostics['create' + 'RegisteredDiagnostic']('KV415');",
        ].join('\n'),
      ],
      [
        'template expression module name',
        [
          "const diagnostics = await import(`@kovojs/core/internal/${'diagnostics'}`);",
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'conditional module name',
        [
          'declare const useDiagnostics: boolean;',
          "const diagnostics = await import(useDiagnostics ? '@kovojs/core/internal/diagnostics' : './safe.js');",
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'zero argument module helper',
        [
          "function moduleName() { return '@kovojs/core/internal/diagnostics'; }",
          'const diagnostics = await import(moduleName());',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'object method module helper',
        [
          "const holder = { path() { return '@kovojs/core/internal/diagnostics'; } };",
          'const diagnostics = await import(holder.path());',
          "diagnostics['create' + 'RegisteredDiagnostic']('KV415');",
        ].join('\n'),
      ],
      [
        'object property module helper',
        [
          "const holder = { path: () => '@kovojs/core/internal/diagnostics' };",
          'const diagnostics = await import(holder.path());',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'class module helper',
        [
          "class Holder { static path() { return '@kovojs/core/internal/diagnostics'; } }",
          'const diagnostics = await import(Holder.path());',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'direct module helper IIFE',
        [
          "const diagnostics = await import((() => '@kovojs/core/internal/diagnostics')());",
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'bound module helper',
        [
          "function path() { return '@kovojs/core/internal/diagnostics'; }",
          'const bound = path.bind(null);',
          'const diagnostics = await import(bound());',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'object member module value',
        [
          "const holder = { path: '@kovojs/core/internal/diagnostics' };",
          'const diagnostics = await import(holder.path);',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'array module value',
        [
          "const paths = ['@kovojs/core/internal/diagnostics'];",
          'const diagnostics = await import(paths[0]);',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'destructured module value',
        [
          "const holder = { path: '@kovojs/core/internal/diagnostics' };",
          'const { path } = holder;',
          'const diagnostics = await import(path);',
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'createRequire loader',
        [
          "import { createRequire } from 'node:module';",
          'const req = createRequire(import.meta.url);',
          "const diagnostics = req('@kovojs/core/internal/diagnostics');",
          "diagnostics['create' + 'RegisteredDiagnostic']('KV415');",
        ].join('\n'),
      ],
      [
        'bound require loader',
        [
          'const req = require.bind(null);',
          "const diagnostics = req('@kovojs/core/internal/diagnostics');",
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'local require wrapper',
        [
          'function load(specifier) { return require(specifier); }',
          "const diagnostics = load('@kovojs/core/internal/diagnostics');",
          "diagnostics.createRegisteredDiagnostic('KV415');",
        ].join('\n'),
      ],
      [
        'computed destructured emitter',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const diagnostics = await import(paths.value());',
          'const { [members.value()]: emit } = diagnostics;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'computed destructuring assignment emitter',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const diagnostics = await import(paths.value());',
          'let emit;',
          '({ [members.value()]: emit } = diagnostics);',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'Reflect.get emitter extraction',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const diagnostics = await import(paths.value());',
          'const emit = Reflect.get(diagnostics, members.value());',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'object carrier module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const diagnostics = await import(paths.value());',
          'const box = { diagnostics };',
          'const { [members.value()]: emit } = box.diagnostics;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'array carrier module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const diagnostics = await import(paths.value());',
          'const box = [diagnostics];',
          'const { [members.value()]: emit } = box[0];',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'helper carrier module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const identity = (value) => value;',
          'const diagnostics = await import(paths.value());',
          'const { [members.value()]: emit } = identity(diagnostics);',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'map carrier module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'const diagnostics = await import(paths.value());',
          "const { [members.value()]: emit } = new Map([['x', diagnostics]]).get('x');",
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'assignment and conditional module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'declare const flag: boolean;',
          'const diagnostics = await import(paths.value());',
          'let box;',
          'box = flag ? diagnostics : {};',
          'const { [members.value()]: emit } = box;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'function return module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'async function load() { return import(paths.value()); }',
          'const diagnostics = await load();',
          'const { [members.value()]: emit } = diagnostics;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'promise callback module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'await import(paths.value()).then((diagnostics) => {',
          '  const { [members.value()]: emit } = diagnostics;',
          "  emit('KV415');",
          '});',
        ].join('\n'),
      ],
      [
        'class method module result',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const members = { value() { return 'createRegisteredDiagnostic'; } };",
          'class Loader { async load() { return import(paths.value()); } }',
          'const diagnostics = await new Loader().load();',
          'const { [members.value()]: emit } = diagnostics;',
          "emit('KV415');",
        ].join('\n'),
      ],
      [
        'aliased global require with unresolved target',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const load = require;',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'parenthesized global require with unresolved target',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const diagnostics = (require)(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'ambient type declaration cannot shadow CJS require',
        [
          'declare const require: (specifier: string) => unknown;',
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const load = require;',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'CJS destructured createRequire',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const { createRequire } = require('node:module');",
          'const load = createRequire(__filename);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'CJS main module require',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const load = require.main.require;',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'ambient module declaration cannot shadow CJS require',
        [
          'declare const module: { require(specifier: string): unknown };',
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const load = module['require'].bind(module);",
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'computed CJS main module require',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const load = require['ma' + 'in']['require'];",
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'Node builtin module createRequire',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const load = process.getBuiltinModule('node:module').createRequire(import.meta.url);",
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'default Node module import',
        [
          "import M from 'node:module';",
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'named Module import',
        [
          "import { Module as M } from 'node:module';",
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'dynamic Node module import',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const M = await import('node:module');",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'globalThis require carrier',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const box = { load: globalThis.require };',
          'const diagnostics = box.load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'computed globalThis require carrier',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const box = { load: globalThis['require'] };",
          'const diagnostics = box.load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'aliased process getBuiltinModule',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const gbm = process.getBuiltinModule;',
          "const M = gbm('node:module');",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'computed process getBuiltinModule',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const M = process['getBuiltinModule']('node:module');",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'folded computed process loader chain',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const gbm=process[['get','BuiltinModule'].join('')];",
          "const M=gbm('node:'+'module');",
          "const make=M[['create','Require'].join('')];",
          'const load=make(import.meta.url);',
          'const diagnostics=load(paths.value());',
          "diagnostics[['create','RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'unresolved computed process authority',
        ['declare const member: string;', 'export const authority = process[member];'].join('\n'),
      ],
      [
        'destructured process getBuiltinModule',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const { getBuiltinModule } = process;',
          "const M = getBuiltinModule('node:module');",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'globalThis process getBuiltinModule',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          "const M = globalThis.process.getBuiltinModule('node:module');",
          'const load = M.createRequire(import.meta.url);',
          'const diagnostics = load(paths.value());',
          "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
      [
        'for-await module carrier',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'for await (const diagnostics of [import(paths.value())]) {',
          "  diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
          '}',
        ].join('\n'),
      ],
      [
        'mutable property carrier',
        [
          "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
          'const box = {};',
          'box.value = await import(paths.value());',
          "box.value[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
        ].join('\n'),
      ],
    ];
    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.siteCount, name).toBe(0);
      expect(result.findings.join('\n'), name).toMatch(
        /acquisition of reviewed diagnostic module|exact reviewed capability summary|reviewed diagnostic module specifier|full-file capability summary/u,
      );
    }

    for (const [name, authorityText] of [
      ['default re-export', "export { default as M } from 'node:module';"],
      ['named Module re-export', "export { Module as M } from 'node:module';"],
      ['namespace re-export', "export * as M from 'node:module';"],
    ]) {
      const slug = name.replaceAll(' ', '-');
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/${slug}-authority.ts`, text: authorityText },
        {
          path: `packages/server/src/${slug}-consumer.ts`,
          text: [
            `import { M } from './${slug}-authority';`,
            "const paths = { value() { return '@kovojs/core/internal/diagnostics'; } };",
            'const load = M.createRequire(import.meta.url);',
            'const diagnostics = load(paths.value());',
            "diagnostics[['create', 'RegisteredDiagnostic'].join('')]('KV415');",
          ].join('\n'),
        },
      ]);
      expect(result.siteCount, name).toBe(0);
      expect(result.findings.join('\n'), name).toContain(
        'runtime module loader authority requires an exact full-file capability summary',
      );
    }
  });

  it('C13 mutations: runtime loader authority census rejects changed and stale owners', () => {
    const changed = replaceProductionFile('packages/cli/src/add-catalog.ts', (text) => `${text}\n`);
    expect(evaluate({ productionFiles: changed }).findings.join('\n')).toContain(
      'runtime module loader authority requires an exact full-file capability summary',
    );

    const removed = replaceProductionFile('packages/cli/src/add-catalog.ts', (text) =>
      text
        .replace("import { createRequire } from 'node:module';\n", '')
        .replace(
          'const catalogRequire = createRequire(import.meta.url);',
          'const catalogRequire = () => undefined;',
        ),
    );
    expect(evaluate({ productionFiles: removed }).findings.join('\n')).toContain(
      'stale runtime module loader authority summary has no owned capability',
    );

    const deleted = baseline.productionFiles.filter(
      (file) => file.path !== 'packages/cli/src/add-catalog.ts',
    );
    expect(evaluate({ productionFiles: deleted }).findings.join('\n')).toContain(
      'packages/cli/src/add-catalog.ts: reviewed runtime module loader authority source is missing',
    );
  });

  it('C13 canaries: registered diagnostic identity cannot be spread-overridden or mutated', () => {
    const rootImport =
      "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';";
    const canaries = [
      [
        'code spread override',
        [
          rootImport,
          "export const diagnostic = { ...createRegisteredDiagnostic('KV415'), code: 'KV416' };",
        ].join('\n'),
      ],
      [
        'severity spread override',
        [
          rootImport,
          "export const diagnostic = { ...createRegisteredDiagnostic('KV415'), severity: 'notice' };",
        ].join('\n'),
      ],
      [
        'derived local mutation',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          "diagnostic['co' + 'de'] = 'KV416';",
        ].join('\n'),
      ],
      [
        'intrinsic mutation',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          "Object.assign(diagnostic, { severity: 'notice' });",
        ].join('\n'),
      ],
      [
        'object carrier mutation',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          'const holder = { diagnostic };',
          "holder.diagnostic.code = 'KV416';",
        ].join('\n'),
      ],
      [
        'array carrier mutation',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          "[diagnostic][0].severity = 'notice';",
        ].join('\n'),
      ],
      [
        'binary carrier spread override',
        [
          rootImport,
          "const fake = { code: 'KV416', message: 'fake', severity: 'error' };",
          "export const diagnostic = { ...(createRegisteredDiagnostic('KV415') || fake), code: 'KV416' };",
        ].join('\n'),
      ],
      [
        'defineProperties mutation',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          "Object.defineProperties(diagnostic, { code: { value: 'KV416' } });",
        ].join('\n'),
      ],
      [
        'Reflect.deleteProperty mutation',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          "Reflect.deleteProperty(diagnostic, 'code');",
        ].join('\n'),
      ],
      [
        'aliased Object.assign override',
        [
          rootImport,
          "const diagnostic = createRegisteredDiagnostic('KV415');",
          'const assign = Object.assign;',
          "export const forged = assign({}, diagnostic, { code: 'KV416' });",
        ].join('\n'),
      ],
    ];
    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.findings.join('\n'), name).toMatch(
        /registered diagnostic .* (?:override|mutation)|spread after a registered diagnostic/u,
      );
    }
  });

  it('C13 canaries: adjacent ad-hoc diagnostic encodings are rejected', () => {
    const canaries = [
      [
        'computed code property',
        "export const fake = { ['co' + 'de']: 'KV415', message: 'fake', severity: 'error' };",
      ],
      [
        'split identity and payload',
        [
          "const identity = { code: 'KV415' };",
          "export const fake = { ...identity, message: 'fake', severity: 'error' };",
        ].join('\n'),
      ],
      [
        'default parameter code',
        "export function fake(code = 'KV415') { return { code, message: 'fake', severity: 'error' }; }",
      ],
      [
        'conditional code alias',
        [
          "const code = flag ? 'KV415' : 'KV416';",
          "export const fake = { code, message: 'fake', severity: 'error' };",
        ].join('\n'),
      ],
      [
        'destructured default code',
        "export function fake({ code = 'KV415' } = {}) { return { code, message: 'fake', severity: 'error' }; }",
      ],
      [
        'Object.assign composition',
        "export const fake = Object.assign({ code: 'KV415' }, { message: 'fake', severity: 'error' });",
      ],
      [
        'class fields',
        "export class Fake { code = 'KV415'; message = 'fake'; severity = 'error'; }",
      ],
    ];
    for (const [name, text] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.siteCount, name).toBe(0);
      expect(result.findings.join('\n'), name).toContain('ad hoc KV415 production diagnostic');
    }
  });

  it('C13 canary: rejected emitter bindings fail even when their code is dynamic', () => {
    const result = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-dynamic-shadow.ts',
        text: [
          "function createRegisteredDiagnostic(value) { return { code: value, message: 'fake', severity: 'error' }; }",
          "const code = 'KV' + '415';",
          'createRegisteredDiagnostic(code);',
        ].join('\n'),
      },
    ]);
    expect(result.siteCount).toBe(0);
    expect(result.findings.join('\n')).toContain('untrusted diagnostic emitter binding');
  });

  it('derives a literal only from the emitter exact code position, never another argument', () => {
    const result = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-exact-code-position.ts',
        text: [
          "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
          "createRegisteredDiagnostic('KV415', {}, { detail: 'KV416' });",
        ].join('\n'),
      },
    ]);
    expect(result.findings).toEqual([]);
    expect([...result.emissionSites]).toEqual(
      [
        [
          'KV415',
          [
            {
              emitter: 'createRegisteredDiagnostic',
              file: 'packages/server/src/conformance-exact-code-position.ts',
              line: 2,
            },
          ],
        ],
      ].map(([code, sites]) => [code, sites.map((site) => expect.objectContaining(site))]),
    );
    expect(result.siteCount).toBe(1);

    const dynamic = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-dynamic-code.ts',
        text: [
          "import { createRegisteredDiagnostic } from '@kovojs/core/internal/diagnostics';",
          "const code = 'KV415';",
          "createRegisteredDiagnostic(code, {}, { detail: 'KV416' });",
        ].join('\n'),
      },
    ]);
    expect(dynamic.siteCount).toBe(0);
    expect(dynamic.findings.join('\n')).toContain(
      'must bind its code at the exact reviewed code position',
    );

    const spreadAfterCode = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-code-spread-after.ts',
        text: [
          "import { drizzleDiagnostic } from '../../drizzle/src/static/diagnostics.js';",
          "const override = { code: 'KV415' };",
          "drizzleDiagnostic({ code: 'KV406', detail: 'KV416', ...override });",
        ].join('\n'),
      },
    ]);
    expect(spreadAfterCode.siteCount).toBe(0);
    expect(spreadAfterCode.findings.join('\n')).toContain(
      'must bind its code at the exact reviewed code position',
    );

    const explicitCodeAfterSpread = scanDiagnosticProductionSources([
      {
        path: 'packages/server/src/conformance-code-spread-before.ts',
        text: [
          "import { drizzleDiagnostic } from '../../drizzle/src/static/diagnostics.js';",
          "const defaults = { code: 'KV415' };",
          "drizzleDiagnostic({ ...defaults, code: 'KV406', detail: 'KV416' });",
        ].join('\n'),
      },
    ]);
    expect(explicitCodeAfterSpread.findings).toEqual([]);
    expect([...explicitCodeAfterSpread.emissionSites.keys()]).toEqual(['KV406']);
    expect(explicitCodeAfterSpread.siteCount).toBe(1);
  });

  it('runtime DiagnosticFactory capabilities are frozen, identity-owned, and unforgeable', () => {
    const factory = createDiagnosticFactory('src/example.tsx', 'first\nsecond');
    expect(Object.isFrozen(factory)).toBe(true);
    expect(Reflect.set(factory, 'fileName', 'forged.tsx')).toBe(false);
    expect(Reflect.set(factory, 'at', () => undefined)).toBe(false);
    const diagnostic = diagnosticAt(factory, 'KV415', { start: 6 });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Reflect.set(diagnostic, 'code', 'KV416')).toBe(false);
    expect(Reflect.set(diagnostic, 'severity', 'notice')).toBe(false);
    expect(diagnostic).toMatchObject({
      code: 'KV415',
      fileName: 'src/example.tsx',
      start: { column: 1, line: 2 },
    });
    expect(() => diagnosticAt({ ...factory }, 'KV415')).toThrow(
      'DiagnosticFactory must be created by createDiagnosticFactory',
    );
    expect(() => diagnosticAt({ fileName: 'forged.tsx' }, 'KV415')).toThrow(
      'DiagnosticFactory must be created by createDiagnosticFactory',
    );
  });

  it('C13 canaries: forged factory arguments and capability property reassignment fail the gate', () => {
    const canaries = [
      [
        'local interface parameter',
        [
          "import { diagnosticAt } from '../../compiler/src/diagnostics.js';",
          'interface DiagnosticFactory { readonly fileName: string }',
          'export function emit(diagnostics: DiagnosticFactory) {',
          "  return diagnosticAt(diagnostics, 'KV415');",
          '}',
        ].join('\n'),
        'annotation-only, forged, or not minted',
      ],
      [
        'object cast',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          "diagnosticAt(({ fileName: 'fake' } as unknown as DiagnosticFactory), 'KV415');",
        ].join('\n'),
        'must be one exact runtime-owned capability binding',
      ],
      [
        'fake creator',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          "function createDiagnosticFactory() { return { fileName: 'fake' } as DiagnosticFactory; }",
          'const diagnostics = createDiagnosticFactory();',
          "diagnosticAt(diagnostics, 'KV415');",
        ].join('\n'),
        'annotation-only, forged, or not minted',
      ],
      [
        'property reassignment',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          'export function emit(diagnostics: DiagnosticFactory) {',
          '  diagnostics.at = () => undefined;',
          "  return diagnosticAt(diagnostics, 'KV415');",
          '}',
        ].join('\n'),
        'DiagnosticFactory capability property reassignment',
      ],
      [
        'direct binding reassignment',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          'export function emit(diagnostics: DiagnosticFactory) {',
          "  diagnostics = { fileName: 'fake' } as DiagnosticFactory;",
          "  return diagnosticAt(diagnostics, 'KV415');",
          '}',
        ].join('\n'),
        'was reassigned before emission',
      ],
      [
        'destructuring binding reassignment',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          'export function emit(diagnostics: DiagnosticFactory) {',
          "  const forged = { fileName: 'fake' } as DiagnosticFactory;",
          '  [diagnostics] = [forged];',
          "  return diagnosticAt(diagnostics, 'KV415');",
          '}',
        ].join('\n'),
        'was reassigned before emission',
      ],
      [
        'compound binding reassignment',
        [
          "import { diagnosticAt, type DiagnosticFactory } from '../../compiler/src/diagnostics.js';",
          'export function emit(diagnostics: DiagnosticFactory) {',
          "  diagnostics &&= { fileName: 'fake' } as DiagnosticFactory;",
          "  return diagnosticAt(diagnostics, 'KV415');",
          '}',
        ].join('\n'),
        'was reassigned before emission',
      ],
    ];

    for (const [name, text, finding] of canaries) {
      const result = scanDiagnosticProductionSources([
        { path: `packages/server/src/conformance-factory-${name.replaceAll(' ', '-')}.ts`, text },
      ]);
      expect(result.findings.join('\n'), name).toContain(finding);
    }
  });

  it('accepts only exact named root, generated-constructor, and runtime DiagnosticFactory bindings', () => {
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
          "import { diagnosticAt, type DiagnosticFactory } from '../diagnostics.js';",
          "export function emit(diagnostics: DiagnosticFactory) { diagnosticAt(diagnostics, 'KV415'); }",
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
    expect(
      evaluate({ evidence, productionFiles }).findings.filter(
        (finding) =>
          !finding.includes('production diagnostic emission site manifest drifted') &&
          !finding.includes('exact fixture witness manifest drifted') &&
          !finding.includes('actual-layer binding'),
      ),
    ).toEqual([]);
  });

  it('C13 mutation: keeps approved wrappers bound to the validating registry door', () => {
    const productionFiles = replaceProductionFile('packages/compiler/src/diagnostics.ts', (text) =>
      text.replaceAll('createRegisteredDiagnostic(', 'removedRegistryDoor('),
    );
    expect(evaluate({ productionFiles }).findings.join('\n')).toContain(
      'reviewed diagnostic wrapper has no exact path',
    );
  });

  it('C13 canaries: transferred diagnostic authority keeps its code and severity guards', () => {
    const fileName = 'packages/server/src/internal/data-plane-static-analysis.ts';
    const source = productionText(fileName);
    const mutations = [
      [
        'code guard',
        source.replace(
          "if (!isDiagnosticCode(code) || typeof message !== 'string' || typeof site !== 'string')",
          "if (typeof message !== 'string' || typeof site !== 'string')",
        ),
      ],
      [
        'registry severity guard',
        source.replace('if (severity !== diagnostic.severity)', 'if (false)'),
      ],
    ];
    for (const [name, mutated] of mutations) {
      expect(mutated, name).not.toBe(source);
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
          '\n',
        ),
        name,
      ).toContain('transferred diagnostic constructor capability drifted');
    }
  });

  it('C13 canary: transferred diagnostic authority cannot escape its exact registrar slot', () => {
    const fileName = 'packages/server/src/internal/data-plane-static-analysis.ts';
    const source = productionText(fileName);
    const mutated = source.replace(
      'extractStaticBuildAnalysisFactsFromProject({ files }, registerTransferredSqlSafetyDiagnostic)',
      'extractStaticBuildAnalysisFactsFromProject({ files }, (registerTransferredSqlSafetyDiagnostic))',
    );
    expect(mutated).not.toBe(source);
    expect(
      scanDiagnosticProductionSources([{ path: fileName, text: mutated }]).findings.join('\n'),
    ).toContain('may only appear as the direct callee');
    const bindingFindings = validateDiagnosticEmissionDoorBindings(
      diagnosticDoorFiles({ [fileName]: mutated }),
    ).join('\n');
    expect(bindingFindings).toContain('constructor capability transfer owner drifted');
  });

  it('C13 canaries: the transferred diagnostic recipient cannot forge or retain authority', () => {
    const fileName = 'packages/drizzle/src/static.ts';
    const source = productionText(fileName);
    const mutations = [
      [
        'substituted registry fields',
        source.replace(
          'registrar(diagnostic.code, diagnostic.message, diagnostic.severity, diagnostic.site)',
          "registrar('KV201', 'forged', 'error', diagnostic.site)",
        ),
        'transferStaticBuildDiagnostics',
      ],
      [
        'retained callback',
        source.replace(
          'const facts = extractStaticBuildAnalysisFactsFromAnalysisContext(',
          'globalThis.__kovoRegistrar = diagnosticRegistrar;\n      const facts = extractStaticBuildAnalysisFactsFromAnalysisContext(',
        ),
        'extractStaticBuildAnalysisFactsFromProject',
      ],
    ];
    for (const [name, mutated, recipient] of mutations) {
      expect(mutated, name).not.toBe(source);
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
          '\n',
        ),
        name,
      ).toContain(`${recipient}: transferred diagnostic capability recipient drifted`);
    }
  });

  it('C13 mutation: a wrapper-local root lookalike cannot satisfy the reviewed call graph', () => {
    const productionFiles = replaceProductionFile(
      'packages/compiler/src/diagnostics.ts',
      (text) =>
        `${text.replace('  createRegisteredDiagnostic,\n', '')}\nfunction createRegisteredDiagnostic() { return undefined; }\n`,
    );
    const findings = evaluate({ productionFiles }).findings.join('\n');
    expect(findings).toContain('reviewed wrapper uses untrusted emitter');
    expect(findings).toContain('reviewed diagnostic wrapper has no exact path');
  });

  it('C13 canaries: every reviewed wrapper return branch is root-derived and cannot fall through', () => {
    const fileName = 'packages/server/src/static-export-diagnostics.ts';
    const signature = 'export function staticExportDiagnostic(';
    const canaries = [
      [
        'false branch',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
  concretePath?: string,
): StaticExportDiagnostic {
  return concretePath === undefined
    ? createRegisteredDiagnostic('KV229', { routePath }, { message })
    : ({ code: 'KV229', message, routePath, severity: 'error' } as StaticExportDiagnostic);
}`,
      ],
      [
        'reachable fallthrough',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
  concretePath?: string,
): StaticExportDiagnostic {
  if (concretePath !== undefined) {
    return createRegisteredDiagnostic('KV229', { concretePath, routePath }, { message });
  }
}`,
      ],
      [
        'existential side effect plus fake return',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  createRegisteredDiagnostic('KV229', { routePath }, { message });
  return { code: 'KV229', message, routePath, severity: 'error' } as StaticExportDiagnostic;
}`,
      ],
      [
        'reserved own override',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  return {
    ...createRegisteredDiagnostic('KV229', { routePath }, { message }),
    code: 'KV999',
  } as StaticExportDiagnostic;
}`,
      ],
      [
        'reserved severity override',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  return {
    ...createRegisteredDiagnostic('KV229', { routePath }, { message }),
    severity: 'warning',
  } as StaticExportDiagnostic;
}`,
      ],
      [
        'binary fallback',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  return createRegisteredDiagnostic('KV229', { routePath }, { message }) ||
    ({ code: 'KV229', message, routePath, severity: 'error' } as StaticExportDiagnostic);
}`,
      ],
      [
        'property extraction',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  return createRegisteredDiagnostic('KV229', { routePath }, { message }).message as unknown as StaticExportDiagnostic;
}`,
      ],
      [
        'returned thunk',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  return (() => createRegisteredDiagnostic('KV229', { routePath }, { message })) as unknown as StaticExportDiagnostic;
}`,
      ],
      [
        'mutable derived local',
        `export function staticExportDiagnostic(
  routePath: string,
  message: string,
): StaticExportDiagnostic {
  let result = createRegisteredDiagnostic('KV229', { routePath }, { message });
  result = { code: 'KV229', message, routePath, severity: 'error' } as StaticExportDiagnostic;
  return result;
}`,
      ],
    ];

    for (const [name, replacement] of canaries) {
      const mutated = replaceFunctionDeclaration(productionText(fileName), signature, replacement);
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
          '\n',
        ),
        name,
      ).toContain('every reachable return must derive');
    }
  });

  it('C13 canary: a reviewed dynamic wrapper cannot replace its caller code with a fixed literal', () => {
    const fileName = 'packages/compiler/src/diagnostics.ts';
    const compilerDiagnostics = productionText(fileName).replace(
      '  return createRegisteredDiagnostic(\n    code,\n    {\n      fileName: factory.fileName,',
      "  return createRegisteredDiagnostic(\n    'KV415',\n    {\n      fileName: factory.fileName,",
    );
    expect(
      validateDiagnosticEmissionDoorBindings(
        diagnosticDoorFiles({ [fileName]: compilerDiagnostics }),
      ).join('\n'),
    ).toContain('dynamic diagnostic code');
  });

  it('C13 canary: reviewed wrapper code flow rejects unprovable object forwarding', () => {
    const fileName = 'packages/drizzle/src/static/diagnostics.ts';
    const signature = 'export function drizzleDiagnosticWithoutSite(';
    const replacement = `export function drizzleDiagnosticWithoutSite(input: {
  code: DiagnosticCode;
  detail?: string;
  preferHelp?: boolean;
}): TouchGraphDiagnostic {
  return drizzleDiagnostic(input as DrizzleDiagnosticInput);
}`;
    const mutated = replaceFunctionDeclaration(productionText(fileName), signature, replacement);
    expect(
      validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
        '\n',
      ),
    ).toContain('dynamic diagnostic code <unproven>');
  });

  it('C13 canary: reviewed dynamic wrappers cannot select a fixed generated constructor', () => {
    const fileName = 'packages/compiler/src/diagnostics.ts';
    let mutated = productionText(fileName).replace(
      '  createRegisteredDiagnostic,\n',
      '  createRegisteredDiagnostic,\n  diagnosticConstructors,\n',
    );
    mutated = replaceFunctionDeclaration(
      mutated,
      'export function diagnosticFor(',
      `export function diagnosticFor(
  fileName: string,
  code: DiagnosticCode,
): CompilerDiagnostic {
  return diagnosticConstructors.KV415({ fileName });
}`,
    );
    expect(
      validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
        '\n',
      ),
    ).toContain('dynamic diagnostic code KV415 does not derive from reviewed source code');
  });

  it('C13 canaries: reviewed wrapper code flow is symbol-bound and immutable', () => {
    const compilerFile = 'packages/compiler/src/diagnostics.ts';
    const shadowedCode = replaceFunctionDeclaration(
      productionText(compilerFile),
      'export function diagnosticFor(',
      `export function diagnosticFor(
  fileName: string,
  code: DiagnosticCode,
): CompilerDiagnostic {
  {
    const code: DiagnosticCode = 'KV415';
    return createRegisteredDiagnostic(code, { fileName });
  }
}`,
    );
    expect(
      validateDiagnosticEmissionDoorBindings(
        diagnosticDoorFiles({ [compilerFile]: shadowedCode }),
      ).join('\n'),
    ).toContain('does not derive from reviewed source code');

    const drizzleFile = 'packages/drizzle/src/static/diagnostics.ts';
    const reassignedProperty = replaceFunctionDeclaration(
      productionText(drizzleFile),
      'export function drizzleDiagnosticWithoutSite(',
      `export function drizzleDiagnosticWithoutSite(input: {
  code: DiagnosticCode;
  detail?: string;
  preferHelp?: boolean;
}): TouchGraphDiagnostic {
  input.code = 'KV415';
  return createRegisteredDiagnostic(input.code, { site: NO_DIAGNOSTIC_SITE });
}`,
    );
    expect(
      validateDiagnosticEmissionDoorBindings(
        diagnosticDoorFiles({ [drizzleFile]: reassignedProperty }),
      ).join('\n'),
    ).toContain('reviewed wrapper code source is not exact');
  });

  it('C13 canary: diagnosticMessage requires its exact reviewed formatter', () => {
    const fileName = 'packages/test/src/verifier-diagnostics.ts';
    const replacement = `export function diagnosticMessage(code: DiagnosticCode, detail: string): string {
  const diagnostic = createRegisteredDiagnostic(code);
  function fake(_message: string): string { return 'KV999'; }
  return \`${'${diagnostic.code}'} ${'${fake(diagnostic.message)}'}: ${'${detail}'}\`;
}`;
    const mutated = replaceFunctionDeclaration(
      productionText(fileName),
      'export function diagnosticMessage(',
      replacement,
    );
    expect(
      validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
        '\n',
      ),
    ).toContain('every reachable return must derive');
  });

  it('C13 canary: blocking diagnostic forwarding must use the immutable snapshotted element', () => {
    const fileName = 'packages/server/src/static-export-diagnostics.ts';
    const mutated = productionText(fileName)
      .replace('const diagnostic = source[index]!;', 'let diagnostic = source[index]!;')
      .replace(
        "if (diagnosticDefinitions[diagnostic.code].severity !== 'error') continue;",
        "if (diagnosticDefinitions[diagnostic.code].severity !== 'error') continue;\n    diagnostic = { ...diagnostic, code: 'KV415' } as StaticExportCompileDiagnostic;",
      );
    const result = scanProductionSources(diagnosticDoorFiles({ [fileName]: mutated }));
    expect(result.findings.join('\n')).toContain(
      'must bind its code at the exact reviewed code position',
    );

    const forgedCollectionValue = productionText(fileName).replace(
      '      blockingStaticExportDiagnostic(diagnostic),',
      "      Object.fromEntries([['code', 'KV415'], ['routePath', diagnostic.fileName], ['message', 'forged'], ['severity', 'error']]) as unknown as StaticExportDiagnostic,",
    );
    expect(
      validateDiagnosticEmissionDoorBindings(
        diagnosticDoorFiles({ [fileName]: forgedCollectionValue }),
      ).join('\n'),
    ).toContain('collection control flow drifted from its reviewed exact body');

    const controlFlowMutants = [
      productionText(fileName).replace(
        "diagnosticDefinitions[diagnostic.code].severity !== 'error'",
        "diagnosticDefinitions[diagnostic.code].severity === 'error'",
      ),
      productionText(fileName).replace(
        '    witnessArrayAppend(\n      blocking,',
        '    if (false)\n      witnessArrayAppend(\n        blocking,',
      ),
    ];
    for (const mutant of controlFlowMutants) {
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutant })).join(
          '\n',
        ),
      ).toContain('collection control flow drifted from its reviewed exact body');
    }
  });

  it('C13 canary: serialized SQL-safety diagnostics retain exact registry rehydration', () => {
    const fileName = 'packages/server/src/internal/data-plane-static-analysis.ts';
    const canaries = [
      (text) =>
        text.replace(
          "if (!isDiagnosticCode(code) || typeof message !== 'string' || typeof site !== 'string') {\n    throw new TypeError('Serialized SQL-safety diagnostic has malformed authority fields.');",
          "if (typeof code !== 'string' || typeof message !== 'string' || typeof site !== 'string') {\n    throw new TypeError('Serialized SQL-safety diagnostic has malformed authority fields.');",
        ),
      (text) =>
        text.replace(
          "if (severity !== diagnostic.severity) {\n    throw new TypeError('Serialized SQL-safety diagnostic severity does not match the registry.');",
          "if (false && severity !== diagnostic.severity) {\n    throw new TypeError('Serialized SQL-safety diagnostic severity does not match the registry.');",
        ),
    ];
    for (const mutate of canaries) {
      const source = productionText(fileName);
      const mutated = mutate(source);
      expect(mutated).not.toBe(source);
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
          '\n',
        ),
      ).toContain(
        'serialized SQL-safety diagnostic rehydration door drifted from its reviewed exact body',
      );
    }
  });

  it('C13 canaries: the internal bridge rejects wrong targets and explicit shadow exports', () => {
    const fileName = 'packages/core/src/internal/diagnostics.ts';
    const canaries = [
      [
        'explicit foreign re-export',
        (text) =>
          `${text}\nexport { fakeDiagnostic as createRegisteredDiagnostic } from '../fake.js';\n`,
        'explicit shadow export for createRegisteredDiagnostic is forbidden',
      ],
      [
        'explicit local constructor shadow',
        (text) => `${text}\nexport const diagnosticConstructors = {};\n`,
        'explicit shadow export for diagnosticConstructors is forbidden',
      ],
      [
        'export import shadow',
        (text) =>
          `${text}\nnamespace Fake { export const emit = (code: string) => ({ code }); }\nexport import createRegisteredDiagnostic = Fake.emit;\n`,
        'explicit shadow export for createRegisteredDiagnostic is forbidden',
      ],
      [
        'exported destructuring shadow',
        (text) =>
          `${text}\nconst fake = { createRegisteredDiagnostic() {} };\nexport const { createRegisteredDiagnostic } = fake;\n`,
        'explicit shadow export for createRegisteredDiagnostic is forbidden',
      ],
      [
        'wrong root target',
        (text) => text.replace("export * from '../diagnostics.ts';", "export * from '../fake.ts';"),
        'must have exactly one star re-export from packages/core/src/diagnostics.ts',
      ],
      [
        'extra star source',
        (text) => `${text}\nexport * from '../fake.ts';\n`,
        'bridge must contain only the reviewed star re-exports',
      ],
    ];
    for (const [name, mutate, finding] of canaries) {
      const mutated = mutate(productionText(fileName));
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
          '\n',
        ),
        name,
      ).toContain(finding);
    }
  });

  it('C13 canaries: each protected bridge export has one exact source owner', () => {
    const rootPath = 'packages/core/src/diagnostics.ts';
    const generatedPath = 'packages/core/src/internal/diagnostic-registry.generated.ts';
    const movedRootDoor = {
      [rootPath]: productionText(rootPath).replaceAll(
        'export function createRegisteredDiagnostic<',
        'function createRegisteredDiagnostic<',
      ),
      [generatedPath]: `${productionText(generatedPath)}\nexport function createRegisteredDiagnostic() {}\n`,
    };
    expect(
      validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles(movedRootDoor)).join('\n'),
    ).toContain(
      'reviewed createRegisteredDiagnostic must be exported only by packages/core/src/diagnostics.ts',
    );

    const movedConstructors = {
      [rootPath]: `${productionText(rootPath)}\nexport const diagnosticConstructors = {};\n`,
      [generatedPath]: productionText(generatedPath).replace(
        'export const diagnosticConstructors',
        'const diagnosticConstructors',
      ),
    };
    expect(
      validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles(movedConstructors)).join('\n'),
    ).toContain(
      'reviewed diagnosticConstructors must be exported only by packages/core/src/internal/diagnostic-registry.generated.ts',
    );
  });

  it('C13 canaries: the runtime factory sink retains its private sentinel, freeze, and ownership check', () => {
    const fileName = 'packages/compiler/src/diagnostics.ts';
    const canaries = [
      [
        'exported sentinel',
        (text) =>
          text.replace('const diagnosticFactoryBrand:', 'export const diagnosticFactoryBrand:'),
        'module-private unique Symbol sentinel',
      ],
      [
        'removed nominal witness',
        (text) => text.replace('  readonly [diagnosticFactoryBrand]: true;\n', ''),
        'type must carry the module-private runtime brand',
      ],
      [
        'sentinel alias export',
        (text) => `${text}\nexport { diagnosticFactoryBrand as diagnosticFactoryBrandForTests };\n`,
        'private DiagnosticFactory sentinel and ownership state must not escape',
      ],
      [
        'ownership accessor escape',
        (text) =>
          `${text}\nexport function diagnosticFactoryOwnershipForTests() { return diagnosticFactoryStates; }\n`,
        'private DiagnosticFactory sentinel and ownership state must not escape',
      ],
      [
        'mutable shell',
        (text) => text.replace('const factory = Object.freeze(', 'const factory = ('),
        'constructor must brand, freeze, and register',
      ],
      [
        'forged file binding',
        (text) =>
          text.replace(
            '{ fileName }, diagnosticFactoryBrand',
            "{ fileName: 'forged.tsx' }, diagnosticFactoryBrand",
          ),
        'constructor must brand, freeze, and register',
      ],
      [
        'caller owned branded shell',
        (text) =>
          text.replace(
            '{ fileName }, diagnosticFactoryBrand',
            'offsetMap as unknown as DiagnosticFactory, diagnosticFactoryBrand',
          ),
        'constructor must brand, freeze, and register',
      ],
      [
        'false runtime brand',
        (text) => text.replace('      value: true,', '      value: false,'),
        'constructor must brand, freeze, and register',
      ],
      [
        'removed ownership lookup',
        (text) => text.replace('diagnosticFactoryStates.get(factory)', 'new Map().get(factory)'),
        'sink must reject every capability absent from the private ownership map',
      ],
      [
        'fallback ownership lookup',
        (text) =>
          text.replace(
            'const state = diagnosticFactoryStates.get(factory);',
            "const state = diagnosticFactoryStates.get(factory) ?? Object.freeze({ offsetMap: undefined, positionFor: createOffsetToPosition('') });",
          ),
        'sink must reject every capability absent from the private ownership map',
      ],
      [
        'remint before ownership guard',
        (text) =>
          text.replace(
            '  const state = diagnosticFactoryStates.get(factory);',
            "  factory = createDiagnosticFactory(factory.fileName, '');\n  const state = diagnosticFactoryStates.get(factory);",
          ),
        'sink must reject every capability absent from the private ownership map',
      ],
      [
        'forged sink file binding',
        (text) => text.replace('fileName: factory.fileName,', "fileName: 'forged.tsx',"),
        'implementation drifted from its reviewed exact body after the ownership guard',
      ],
      [
        'forged sink source position',
        (text) =>
          text.replace('start: state.positionFor(offset),', 'start: { line: 99, column: 99 },'),
        'implementation drifted from its reviewed exact body after the ownership guard',
      ],
      [
        'caller-owned capability registration',
        (text) =>
          text
            .replace(
              'diagnosticFactoryStates.set(factory, state);',
              'diagnosticFactoryStates.set(offsetMap as unknown as DiagnosticFactory, state);',
            )
            .replace('return factory;', 'return offsetMap as unknown as DiagnosticFactory;'),
        'constructor must brand, freeze, and register the exact capability',
      ],
      [
        'unreviewed state registration',
        (text) =>
          text.replace(
            'diagnosticFactoryStates.set(factory, state);',
            'diagnosticFactoryStates.set(factory, Object.freeze({ offsetMap: undefined, positionFor: createOffsetToPosition(source) }));',
          ),
        'constructor must brand, freeze, and register the exact capability',
      ],
      [
        'structural at restored',
        (text) =>
          text.replace(
            'readonly fileName: string;',
            'readonly fileName: string;\n  at(code: DiagnosticCode): CompilerDiagnostic;',
          ),
        'structural at methods are forbidden',
      ],
    ];
    for (const [name, mutate, finding] of canaries) {
      const mutated = mutate(productionText(fileName));
      expect(
        validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
          '\n',
        ),
        name,
      ).toContain(finding);
    }
  });

  it('C13 canary: the root diagnostic door cannot return mutable identity fields', () => {
    const fileName = 'packages/core/src/diagnostics.ts';
    const mutated = productionText(fileName).replace(
      '  const registered = freezeSecurityValue(diagnostic);',
      '  const registered = diagnostic;',
    );
    expect(
      validateDiagnosticEmissionDoorBindings(diagnosticDoorFiles({ [fileName]: mutated })).join(
        '\n',
      ),
    ).toContain(
      'root must freeze, privately enroll, and return the same exact diagnostic identity',
    );
  });

  it('C13 canaries: diagnostic provenance remains private, identity-based, and constructor-owned', () => {
    const fileName = 'packages/core/src/diagnostics.ts';
    const canaries = [
      [
        'exported registry',
        (text) =>
          text.replace(
            'const registeredDiagnosticRegistry = securityWeakSet<object>();',
            'export const registeredDiagnosticRegistry = securityWeakSet<object>();',
          ),
        'provenance registry must be a module-private captured WeakSet',
      ],
      [
        'removed enrollment',
        (text) =>
          text.replace('  securityWeakSetAdd(registeredDiagnosticRegistry, registered);\n', ''),
        'only the validating constructor may enroll diagnostic identity',
      ],
      [
        'structural guard',
        (text) =>
          text.replace(
            '    securityWeakSetHas(registeredDiagnosticRegistry, value)',
            "    'code' in value",
          ),
        'provenance checks must use the private captured WeakSet',
      ],
      [
        'unvalidated derivation',
        (text) =>
          text.replace(
            "  assertRegisteredDiagnostic(source, 'Registered diagnostic derivation source');\n",
            '',
          ),
        'runtime provenance implementation drifted from its reviewed exact body',
      ],
    ];
    for (const [name, mutate, finding] of canaries) {
      expect(
        validateDiagnosticEmissionDoorBindings(
          diagnosticDoorFiles({ [fileName]: mutate(productionText(fileName)) }),
        ).join('\n'),
        name,
      ).toContain(finding);
    }
  });

  it('C13 canaries: the root diagnostic door stays bound to registry code and severity', () => {
    const fileName = 'packages/core/src/diagnostics.ts';
    const canaries = [
      (text) =>
        text.replace(
          '  const definition = diagnosticDefinitions[code];\n  const detail = ownOptionalDiagnosticConstructionString',
          '  const definition = diagnosticDefinitions.KV415;\n  const detail = ownOptionalDiagnosticConstructionString',
        ),
      (text) => text.replace('    severity: definition.severity,', "    severity: 'notice',"),
    ];
    for (const mutate of canaries) {
      expect(
        validateDiagnosticEmissionDoorBindings(
          diagnosticDoorFiles({ [fileName]: mutate(productionText(fileName)) }),
        ).join('\n'),
      ).toContain('validating implementation drifted from its reviewed exact body');
    }
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
