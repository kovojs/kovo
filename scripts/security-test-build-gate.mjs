#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(thisFile), '..');

export const SECURITY_BUILD_CERTIFICATION_CODES = [
  'KV235',
  'KV414',
  'KV422',
  'KV424',
  'KV426',
  'KV433',
  'KV435',
  'KV438',
  'KV449',
  'KV406',
  'KV311',
  'KV330',
];

export const DEFAULT_TRUSTED_OUTPUT_SINK_POSITION_SEED = 'dec-g:kv426:trusted-output:v1';
export const DEFAULT_READ_SOURCE_FAMILY_SEED = 'dec-g:read-source:v1';
export const DEFAULT_WRAPPING_GRAMMAR_SEED = 'dec-g:wrapping:v1';
export const DEFAULT_PARANOID_GENERATOR_ACCEPTANCE_SEED = 'dec-h:phase-5-1:paranoid:v1';

export const TRUSTED_OUTPUT_SINK_POSITION_GRAMMAR = Object.freeze({
  sinks: Object.freeze([
    {
      helper: 'trustedUrl',
      position: 'url-brand',
    },
    {
      helper: 'trustedHtml',
      position: 'html-brand',
    },
  ]),
  sources: Object.freeze([
    {
      evidence: 'request-derived data',
      source: 'request',
    },
    {
      evidence: 'query-derived data',
      source: 'query',
    },
  ]),
  wrapping: Object.freeze(['direct-call', 'helper-call', 'component-prop']),
});

const TRUSTED_OUTPUT_CERTIFICATION_CASES = [
  {
    sink: 'trustedUrl',
    source: 'query',
    wrapping: 'direct-call',
  },
  {
    sink: 'trustedUrl',
    source: 'query',
    wrapping: 'helper-call',
  },
  {
    sink: 'trustedHtml',
    source: 'request',
    wrapping: 'component-prop',
  },
];

export const READ_SOURCE_FAMILY_GRAMMAR = Object.freeze({
  families: Object.freeze([
    {
      family: 'request',
      needle: 'trustedHtml() sends request-derived data',
      surface: 'KV426 trusted output request source',
    },
    {
      family: 'query',
      needle: 'trustedUrl() sends query-derived data',
      surface: 'KV426 trusted output query source',
    },
    {
      family: 'db-read',
      needle: 'query="secrets0" path="secrets0\\.accessToken"',
      surface: 'KV435 direct secret DB-read source',
    },
  ]),
});

export const SECURITY_WRAPPING_GRAMMAR = Object.freeze({
  forms: Object.freeze([
    {
      form: 'alias',
      needle: 'query="secrets2" path="secrets2\\.renderPassword"',
      surface: 'KV435 renamed secret projection alias',
    },
    {
      form: 'component-prop',
      needle: 'trustedHtml() sends request-derived data',
      surface: 'KV426 component prop request slot',
    },
    {
      form: 'direct',
      needle: 'query="secrets0" path="secrets0\\.accessToken"',
      surface: 'KV435 direct query projection',
    },
    {
      form: 'helper',
      needle: 'query="secrets1" path="secrets1\\.password"',
      surface: 'KV435 local helper transformation',
    },
    {
      form: 'local-wrapper',
      needle: 'trustedHtml() sends request-derived data',
      surface: 'KV426 local trustedHtml wrapper',
    },
  ]),
});

export const PARANOID_GENERATOR_ACCEPTANCE_GRAMMAR = Object.freeze({
  cases: Object.freeze([
    {
      expectation: 'blocked-read',
      kind: 'query-route',
      route: '/_q/queries/sqlite-secret-alias-query',
      surface: 'SQLite secret alias read stays boxed',
    },
    {
      expectation: 'blocked-read',
      kind: 'query-route',
      route: '/_q/queries/sqlite-secret-cte-query',
      surface: 'SQLite secret CTE read stays boxed',
    },
    {
      expectation: 'allowed-read',
      kind: 'query-route',
      route: '/_q/queries/sqlite-secret-reveal-query',
      surface: 'audited SQLite secret reveal stays allowed',
    },
    {
      expectation: 'allowed-write',
      kind: 'mutation-route',
      route: '/_m/mutations/add-contact',
      surface: 'declared starter contact write stays allowed',
    },
    {
      expectation: 'blocked-write',
      kind: 'mutation-route',
      route: '/_m/paranoid-phase5-write-boundary-proof/phase5-boxed-secret-raw-write-proof',
      surface: 'boxed secret raw write stays blocked',
    },
    {
      expectation: 'status-clean',
      kind: 'api-route',
      route: '/api/phase5-write-boundary-proof',
      surface: 'blocked writes leave no persisted rows',
    },
  ]),
});

export function generateTrustedOutputSinkPositionCases({
  seed = DEFAULT_TRUSTED_OUTPUT_SINK_POSITION_SEED,
} = {}) {
  const grammar = TRUSTED_OUTPUT_SINK_POSITION_GRAMMAR;
  const sinkByHelper = new Map(grammar.sinks.map((sink) => [sink.helper, sink]));
  const sourceByName = new Map(grammar.sources.map((source) => [source.source, source]));
  const allowedWrapping = new Set(grammar.wrapping);

  return TRUSTED_OUTPUT_CERTIFICATION_CASES.map((shape) => {
    const sink = sinkByHelper.get(shape.sink);
    const source = sourceByName.get(shape.source);
    if (!sink || !source || !allowedWrapping.has(shape.wrapping)) {
      throw new Error(`invalid trusted-output generator shape ${JSON.stringify(shape)}`);
    }
    return {
      id: `${sink.helper}:${source.source}:${shape.wrapping}`,
      needle: `${sink.helper}() sends ${source.evidence}`,
      sink: sink.helper,
      source: source.source,
      sinkPosition: sink.position,
      wrapping: shape.wrapping,
    };
  }).sort((left, right) => seededCaseOrder(seed, left.id) - seededCaseOrder(seed, right.id));
}

export function trustedOutputSinkPositionProofNeedles(options) {
  // DEC-G/A6: this proof surface is intentionally produced from a deterministic
  // grammar over sink position, source family, and wrapping shape rather than a
  // hand-maintained index list. The seed only changes stable order, not coverage.
  return generateTrustedOutputSinkPositionCases(options).map((testCase) => testCase.needle);
}

export function generateReadSourceFamilyCases({ seed = DEFAULT_READ_SOURCE_FAMILY_SEED } = {}) {
  return seededGrammarCases(
    seed,
    READ_SOURCE_FAMILY_GRAMMAR.families,
    (testCase) => testCase.family,
  );
}

export function readSourceFamilyProofNeedles(options) {
  // DEC-G/A6: read SOURCE proof coverage is generated over source families
  // rather than maintained as a per-regression proof index.
  return generateReadSourceFamilyCases(options).map((testCase) => testCase.needle);
}

export function generateSecurityWrappingCases({ seed = DEFAULT_WRAPPING_GRAMMAR_SEED } = {}) {
  return seededGrammarCases(seed, SECURITY_WRAPPING_GRAMMAR.forms, (testCase) => testCase.form);
}

export function securityWrappingProofNeedles(options) {
  // DEC-G/A6: wrapping coverage is generated across security proof surfaces so
  // aliases/helpers/wrappers/component props cannot silently fall out of scope.
  return generateSecurityWrappingCases(options).map((testCase) => testCase.needle);
}

export function generateParanoidGeneratorAcceptanceCases({
  seed = DEFAULT_PARANOID_GENERATOR_ACCEPTANCE_SEED,
} = {}) {
  return seededGrammarCases(
    seed,
    PARANOID_GENERATOR_ACCEPTANCE_GRAMMAR.cases,
    (testCase) => `${testCase.expectation}:${testCase.sink ?? testCase.kind}`,
  );
}

export function paranoidGeneratorAcceptanceProofNeedles(options) {
  // DEC-H/A9: Phase 5.1 acceptance is generated across read/write
  // paranoid-mode shapes, not a single hand-enrolled adversarial fixture.
  void options;
  return [
    'writeKovoProject(root, {',
    "dialect: 'sqlite'",
    'addSqliteRuntimeSecretProvenanceProof(root)',
    'pruneParanoidPhase5SqliteReadSet(root)',
    "addStarterMutationDbScopeProof(root, { mode: 'runtime-table-choke' })",
    'addParanoidPhase5WriteBoundaryProof(root)',
    'buildParanoidProductionArtifact(root)',
    'expectBlockedReadShapes(origin, jar)',
    'expectAllowedReadShapes(origin, jar, output)',
    'expectStarterInScopeWrite(origin, jar, output)',
    'expectBlockedWrites(origin, jar, output)',
    'expectWriteStatus(origin, output)',
    "expect(output()).toContain('KV435')",
    "expect(output()).toContain('KV406')",
    "KOVO_PARANOID: '1'",
  ];
}

function seededGrammarCases(seed, cases, idForCase) {
  return [...cases]
    .map((testCase) => ({
      ...testCase,
      id: idForCase(testCase),
    }))
    .sort((left, right) => seededCaseOrder(seed, left.id) - seededCaseOrder(seed, right.id));
}

function seededCaseOrder(seed, id) {
  let hash = 0x811c9dc5;
  for (const character of `${seed}:${id}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export const SECURITY_BUILD_CERTIFICATION_SOURCES = [
  {
    claimExtractor: 'metamorphic-seed-codes',
    description: 'Phase 0 metamorphic fixture-only security seeds',
    file: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact security proof-scope enrollment tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact island derive proof-scope enrollment tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact transaction proof-scope enrollment tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact raw SQL proof-scope enrollment tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'Production artifact paranoid runtime generated acceptance tests',
    file: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
  },
  {
    claimExtractor: 'security-certification-markers',
    description: 'CLI build preflight security proof-scope enrollment tests',
    file: 'packages/cli/src/index.kovo-build.test.ts',
  },
];

const RUNTIME_SECRET_ENGINE_FLOOR_TEST_NAME =
  'distinguishes Postgres reader-role denials from runtime Secret wire refusal and audited reveal acceptance';

export const SECURITY_BUILD_PROOFS = [
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'analyzer-summary-carrier-laundering',
    code: 'KV438',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      "join(root, 'src', 'summary-carrier-proof.ts')",
      'kovoAnalyzerSummary(exactGuard',
      'await nestedWrite(request.db, input)',
      'buildProductionArtifact(root)',
      'KV438',
      'provenance=unknown',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'rejects summarized mutation input laundering through the real production build preflight',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'internal-raw-html-import',
    code: 'KV235',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addInternalHtmlImportProof(root)',
      'buildProductionArtifact(root)',
      'KV235',
      'App source imports a non-public Kovo subpath',
      'raw-helper.ts',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks internal raw-HTML helper imports from authored .ts modules in production build',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV414',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName: 'runs Drizzle security extractors before artifact emission',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV422',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'fails project-mode data-plane analysis for JS source without Drizzle import spellings',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV426',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName: 'resolves local trustedHtml/trustedUrl barrels during production build preflight',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV426',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    requiredProofFileNeedles: ["import * as safeHtml from './safe-html.js';"],
    requiredNeedles: [
      'KV426',
      "export * from './safe-html-root'",
      'trustedHtmlStarBarrelElementAccessPreflightComponentSource()',
    ],
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'resolves star trustedHtml/trustedUrl barrels and literal element access during production build preflight',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'local-helper-credential-laundering',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'KV435',
      'Secret query value reaches the client wire',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'direct-secret-projection-to-query-wire',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'KV435',
      'Secret query value reaches the client wire',
      ...readSourceFamilyProofNeedles().filter((needle) => needle.startsWith('query="secrets0"')),
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'transformed-query-loader-return-laundering',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'KV435',
      'Secret query value reaches the client wire',
      ...securityWrappingProofNeedles().filter((needle) => needle.startsWith('query="secrets1"')),
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'render-value-flow-laundering',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'KV435',
      'Secret query value reaches the client wire',
      'query="secrets2" path="secrets2\\.renderPassword"',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'value-flow-sibling-laundering',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'addAuthSecretLeakProof(safeRoot, { leakToWire: false })',
      'buildReusableProductionArtifact(safeRoot)',
      'KV435',
      'Secret query value reaches the client wire',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper credential-shaped secret laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-view-egress',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addSecretViewEgressProof(root)',
      'buildParanoidProductionArtifact(root)',
      'KV435',
      '/_q/secret-view-egress',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'refuses a runtime Secret read through a Drizzle view at query-wire egress in paranoid mode',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'phase-5-postgres-paranoid-dogfood-read-acceptance',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    requiredNeedles: [
      "dialect: 'postgres'",
      'addPostgresParanoidPhase5DogfoodProof(root)',
      'buildParanoidProductionArtifact(root)',
      'expectPostgresEndpoint(origin, output)',
      'expectPostgresReadonlyRowsEmpty(origin)',
      'expectPostgresReadonlySecretsDenied(origin)',
      'expectPostgresTask(origin, jar, marker, output, publicOrigin)',
      'expectPostgresWebhook(origin, marker, output)',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    testName: 'runs the Phase 5 Postgres paranoid dogfood harness from the production artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'phase-5-postgres-paranoid-dogfood-write-acceptance',
    code: 'KV406',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    requiredNeedles: [
      "dialect: 'postgres'",
      'addPostgresParanoidPhase5DogfoodProof(root)',
      'buildParanoidProductionArtifact(root)',
      'expectPostgresOwnWrite(origin, jar, publicOrigin)',
      'expectPostgresCrossOwnerWrite(origin, jar, output, publicOrigin)',
      'expectPostgresRawCrossOwnerWrite(origin, jar, output, publicOrigin)',
      'expectPostgresTask(origin, jar, marker, output, publicOrigin)',
      'expectPostgresWebhook(origin, marker, output)',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    testName: 'runs the Phase 5 Postgres paranoid dogfood harness from the production artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'phase-5-1-full-paranoid-dogfood-read-acceptance',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    requiredNeedles: paranoidGeneratorAcceptanceProofNeedles().filter(
      (needle) => needle !== "KOVO_PARANOID: '1'",
    ),
    requiredProofFileNeedles: paranoidGeneratorAcceptanceProofNeedles().filter(
      (needle) => needle === "KOVO_PARANOID: '1'",
    ),
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    testName:
      'rejects the single-principal SQLite runtime in production, then runs Phase 5.1 sink acceptance under test posture',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'phase-5-1-full-paranoid-dogfood-write-acceptance',
    code: 'KV406',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    requiredNeedles: paranoidGeneratorAcceptanceProofNeedles().filter((needle) => {
      return needle !== "KOVO_PARANOID: '1'";
    }),
    requiredProofFileNeedles: paranoidGeneratorAcceptanceProofNeedles().filter((needle) => {
      return needle === "KOVO_PARANOID: '1'";
    }),
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    testName:
      'rejects the single-principal SQLite runtime in production, then runs Phase 5.1 sink acceptance under test posture',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'postgres-reader-role-secret-grant-floor',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'migrateRuntimeSecretBoundaryProof(root, dataDir)',
      'queries/runtime-secret-column-engine-denial-query',
      '/permission denied for table runtime_secret_proof/u',
      "expect(requestOutput).not.toContain('KV435')",
      "expect(readerRoleBody).toContain('kovo_reader')",
      'expect(publicRawResponse.status, publicRawBody).toBe(200)',
      "expect(publicRawBody).not.toContain('runtime-secret-value')",
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: RUNTIME_SECRET_ENGINE_FLOOR_TEST_NAME,
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'postgres-reader-role-secret-view-floor',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'migrateRuntimeSecretBoundaryProof(root, dataDir)',
      'CREATE VIEW runtime_secret_proof_view WITH (security_invoker=true)',
      'queries/runtime-secret-view-engine-denial-query',
      '/permission denied for view runtime_secret_proof_view/u',
      "expect(requestOutput).not.toContain('KV435')",
      "expect(requestOutput).not.toContain('runtime-secret-value')",
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: RUNTIME_SECRET_ENGINE_FLOOR_TEST_NAME,
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-explicit-box-egress',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      "const boxed = secret('runtime-secret-value')",
      'queries/runtime-secret-explicit-box-egress-query',
      'expect(boxResponse.status, boxBody).toBe(500)',
      'expect(boxBody).toBe(\'{"code":"SERVER_ERROR","payload":{}}\')',
      'Secret runtime value cannot cross',
      "expect(requestOutput).toContain('KV435')",
      "expect(requestOutput).not.toContain('runtime-secret-value')",
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: RUNTIME_SECRET_ENGINE_FLOOR_TEST_NAME,
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-audited-reveal-acceptance',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      "trustedReveal(secret('runtime-secret-value'), {",
      'audited runtime query-wire reveal acceptance proof',
      'queries/runtime-secret-reveal-acceptance-query',
      'expect(revealResponse.status, revealBody).toBe(200)',
      "expect(revealBody).toContain('runtime-secret-value')",
      "expect(output().slice(revealOutputOffset)).not.toContain('KV435')",
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: RUNTIME_SECRET_ENGINE_FLOOR_TEST_NAME,
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'starter-auth-table-scope-static-gate',
    code: 'KV414',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      "addStarterMutationDbScopeProof(root, { mode: 'static-structured' })",
      'buildProductionArtifact(root)',
      'captureBuildFailure(() => buildProductionArtifact(root))',
      'KV414 WRITE starterAuthUserTableWrite',
      'KV414 WRITE starterAuthSessionTableWrite',
      'KV402 starter-mutation-db-scope-proof/starter-auth-user-table-write-proof',
      "expect(output).not.toContain('KV424')",
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'rejects statically visible starter DB scope drift before artifact emission',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'starter-mutation-db-scope-prod-artifact',
    code: 'KV406',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      "addStarterMutationDbScopeProof(root, { mode: 'runtime-table-choke' })",
      'buildParanoidProductionArtifact(root)',
      'starter-mutation-db-scope-proof/starter-absent-tables-contact-write-proof',
      'starter-mutation-db-scope-proof/starter-raw-auth-table-write-proof',
      'contactRows: 1',
      "expect(output()).toContain('KV406')",
      "expect(output()).toContain('declared mutation registry tables')",
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'enforces starter mutation DB table scope in paranoid production artifacts',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'sqlite-runtime-secret-source-provenance',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      "dialect: 'sqlite'",
      'addSqliteRuntimeSecretProvenanceProof(root)',
      'buildParanoidProductionArtifact(root)',
      'queries/sqlite-secret-alias-query',
      'queries/sqlite-secret-join-alias-query',
      'queries/sqlite-secret-cte-query',
      'queries/sqlite-secret-mixed-chunk-query',
      'queries/sqlite-secret-mixed-chunk-builder-query',
      'expect(response.status',
      "expect(body).not.toContain('runtime-secret-value')",
      'queries/sqlite-secret-non-secret-projection-query',
      'queries/sqlite-secret-reveal-query',
    ],
    requiredProofFileNeedles: [
      "KOVO_PARANOID: '1'",
      'company: proof.classified',
      'classified as leaked from secret_cte',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes SQLite secret reads by source provenance while serving proven non-secret projections in paranoid mode',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'sqlite-runtime-secret-expression-provenance',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      "dialect: 'sqlite'",
      'addSqliteRuntimeSecretProvenanceProof(root)',
      'buildParanoidProductionArtifact(root)',
      'queries/sqlite-secret-derivation-query',
      'queries/sqlite-secret-non-secret-projection-query',
      'queries/sqlite-secret-reveal-query',
      'runtime-secret-value:revealed',
    ],
    requiredProofFileNeedles: [
      "KOVO_PARANOID: '1'",
      'substr(classified, 1, 7) as leaked',
      '(select classified from runtime_secret_proof) as leaked',
      'drizzleSql<string>`upper(${contacts.name})',
      'label: proof.label',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes SQLite secret reads by source provenance while serving proven non-secret projections in paranoid mode',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'finite-ir-query-write-prod-artifact',
    code: 'KV449',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    requiredNeedles: [
      'includeReadonlyRuntimeChokeProbe: true',
      'buildParanoidProductionArtifact(root)',
      'captureProductionBuildFailure',
      'ERROR KV449',
      'query loaders cannot perform a managed database write',
      'KV433',
      "existsSync(join(root, 'dist/server/server.mjs'))",
    ],
    requiredProofFileNeedles: [
      'blocks $label readonly DB computed-method escapes before artifact emission',
      'source=sqlMethod',
      'managed-db.test.ts',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'keeps query writes KV449-closed when the dedicated KV433 finding is advisory',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'managed-write-raw-driver-escape-prod-artifact',
    code: 'KV424',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    requiredNeedles: [
      'addRuntimeMutationSafetyProofs(root, { includeManagedWriteEscapeAttempt: true })',
      'captureProductionBuildFailure(() => buildProductionArtifact(root))',
      'KV424',
      'sink=request-handler.opaque-call',
      'source=closeRawClient',
      'sink=request-handler.opaque-protocol',
      'runtime-safety-proofs.ts',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'blocks managed write raw-driver escapes before $label artifact emission',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'webhook-context-tx-raw-driver-escape-prod-artifact',
    code: 'KV330',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    requiredNeedles: [
      'addRuntimeMutationSafetyProofs(root, { includeWebhookTxEscapeAttempt: true })',
      'captureProductionBuildFailure(() => buildProductionArtifact(root))',
      'KV330',
      'Direct db access in a webhook handler',
      'runtime-safety-proofs.ts',
    ],
    requiredProofFileNeedles: [
      'context.tx as unknown as { $client: unknown }',
      'context.tx as unknown as { session: unknown }',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'blocks $label webhook context.tx raw-driver escapes before artifact emission',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'raw-sql-owner-write-prod-artifact',
    code: 'KV414',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
    requiredNeedles: [
      'addRawSqlOwnerWriteProof(root, { staticStatement: true })',
      'captureProductionBuildFailure(() => buildProductionArtifact(root))',
      'KV414',
      'domain=raw-owner',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
    testName: 'blocks raw owner-table db.execute writes from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'storage-query-write-prod-artifact',
    code: 'KV433',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addStorageQueryWriteProof(root)',
      'buildProductionArtifact(root)',
      'KV433',
      'operation=put',
      'operation=delete',
      'operation=upload',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'blocks storage writes from query loaders in the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'trusted-output-prod-artifact',
    code: 'KV426',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addTrustedOutputProvenanceBuildProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'addTrustedOutputProvenanceBuildProof(safeRoot, { unsafe: false })',
      'buildReusableProductionArtifact(safeRoot)',
      'KV426',
      ...trustedOutputSinkPositionProofNeedles(),
      ...readSourceFamilyProofNeedles().filter((needle) => needle.includes('derived data')),
      ...securityWrappingProofNeedles().filter((needle) => needle.includes('derived data')),
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'blocks trusted output provenance leaks through the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'trusted-url-attribute-type-gate',
    code: 'KV426',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addTrustedUrlAttributeTypeGateProof(root)',
      'buildProductionArtifact(root)',
      'TrustedUrl',
      'AttributeValue',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName: 'blocks TrustedUrl values in non-URL JSX attributes during production build',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    code: 'KV311',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    requiredNeedles: [
      'buildReusableProductionArtifact(root)',
      'expect(pageErrors).toEqual([])',
      'expect(consoleErrors).toEqual([])',
    ],
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName:
      'hydrates destructured state aliases from the production artifact without stale or throwing derives',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'island-derive-prod-artifact',
    code: 'KV311',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    requiredNeedles: [
      'buildReusableProductionArtifact(root)',
      'assertProdArtifactSinkCensus(root',
      'state.count',
      'state.items[0]',
      'state.extra["computed-key"]',
      'frameworkDataRequestsAfterInteraction',
      'expect(pageErrors).toEqual([])',
      'expect(consoleErrors).toEqual([])',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    testName:
      'hydrates destructured state aliases from the production artifact without stale or throwing derives',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'module-helper-derive-prod-artifact',
    code: 'KV311',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    requiredNeedles: [
      'buildReusableProductionArtifact(root)',
      'clientArtifactSources(root)',
      'format(state.count)',
      "not.toContain('format(state.count)')",
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.island-derive.test.ts',
    testName: 'rejects unbound module-helper state derives during production build preflight',
  },
  {
    buildInvocation: 'cli-main-build',
    code: 'KV330',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    sourceFile: 'packages/conformance-fixtures/src/metamorphic-recognition-fixtures.ts',
    testName: 'blocks task and webhook direct DB writes during build check preflight',
  },
  {
    buildInvocation: 'cli-main-build',
    claimId: 'handler-direct-db-build-preflight',
    code: 'KV330',
    proofFile: 'packages/cli/src/index.kovo-build.test.ts',
    requiredNeedles: [
      'handlerWriteSinkPreflightAppModuleSource()',
      "mainAsync(['build', './app.ts', '--out', './dist', '--no-cache'])",
      'Direct db access in a mutation handler',
      'Direct db access in a task run body',
      'Direct db access in a webhook handler',
    ],
    sourceFile: 'packages/cli/src/index.kovo-build.test.ts',
    testName: 'blocks task and webhook direct DB writes during build check preflight',
  },
];

export const PRODUCTION_BUILD_HELPERS = {
  'starter-build-production-artifact': {
    file: 'packages/create-kovo/src/index.build.test-support.ts',
    requiredNeedles: [
      'export function buildProductionArtifact',
      'export function buildReusableProductionArtifact',
      'export function buildParanoidProductionArtifact',
      'execFileSync',
      "['build', './src/app.tsx', '--no-cache']",
      "['build', './src/app.tsx']",
      "KOVO_PARANOID: '1'",
    ],
  },
};

const BUILD_INVOCATION_PATTERNS = {
  'cli-main-build': [/mainAsync\(\s*\[\s*['"]build['"]/],
  'starter-build-production-artifact': [
    /\bbuildProductionArtifact\(/,
    /\bbuildReusableProductionArtifact\(/,
    /\bbuildParanoidProductionArtifact\(/,
  ],
};

export function securityTestBuildGateViolations({
  certificationSources = SECURITY_BUILD_CERTIFICATION_SOURCES,
  proofs = SECURITY_BUILD_PROOFS,
  repoRoot = defaultRepoRoot,
  securityCodes = SECURITY_BUILD_CERTIFICATION_CODES,
} = {}) {
  const violations = [];
  const enrolledSecurityCodes = new Set(securityCodes);
  const sourceClaims = new Map();
  const knownSources = new Set(certificationSources.map((source) => source.file));

  for (const source of certificationSources) {
    const sourcePath = path.join(repoRoot, source.file);
    if (!existsSync(sourcePath)) {
      violations.push(`${source.file}: certification source does not exist`);
      continue;
    }
    const sourceText = readFileSync(sourcePath, 'utf8');
    const claims = extractCertificationClaims(source, sourceText, violations).filter((claim) =>
      enrolledSecurityCodes.has(claim.code),
    );
    sourceClaims.set(source.file, claims);
    for (const claim of claims) {
      if (!proofs.some((proof) => proofMatchesClaim(proof, source.file, claim))) {
        violations.push(
          `${formatClaimLabel(source.file, claim)}: security proof-scope enrollment has no real kovo build proof`,
        );
      }
    }
  }

  for (const proof of proofs) {
    validateProof(proof, {
      enrolledSecurityCodes,
      knownSources,
      repoRoot,
      sourceClaims,
      violations,
    });
  }

  return violations;
}

export function extractMetamorphicSeedCodes(sourceText) {
  return [
    ...new Set([...sourceText.matchAll(/\bcode:\s*['"](KV\d{3})['"]/g)].map((match) => match[1])),
  ].sort((left, right) => left.localeCompare(right));
}

export function extractSecurityCertificationMarkers(sourceText) {
  return [
    ...sourceText.matchAll(/@kovo-security-certifies\s+(KV\d{3})(?:\s+([A-Za-z0-9_.:/-]+))?/g),
  ]
    .map((match) => ({
      claimId: match[2] ?? 'source-marker',
      code: match[1],
    }))
    .sort((left, right) =>
      left.code === right.code
        ? left.claimId.localeCompare(right.claimId)
        : left.code.localeCompare(right.code),
    );
}

export function extractNamedTestBlock(sourceText, testName) {
  const nameIndex = sourceText.indexOf(testName);
  if (nameIndex === -1) return undefined;

  const testStartPattern = /(^|\n)\s*(?:it|test)(?:\.(?:skip|todo|only))?\s*\(/g;
  const starts = [...sourceText.matchAll(testStartPattern)].map((match) => match.index ?? 0);
  const start = starts.filter((index) => index <= nameIndex).at(-1) ?? nameIndex;
  const end = starts.find((index) => index > nameIndex) ?? sourceText.length;
  return sourceText.slice(start, end);
}

function validateProof(
  proof,
  { enrolledSecurityCodes, knownSources, repoRoot, sourceClaims, violations },
) {
  const label = formatProofLabel(proof);
  if (!enrolledSecurityCodes.has(proof.code)) {
    violations.push(
      `${label}: proof code is not enrolled as a security proof-scope enrollment code`,
    );
  }
  if (!knownSources.has(proof.sourceFile)) {
    violations.push(`${label}: proof references an unknown proof-scope enrollment source`);
  }
  if (
    sourceClaims.has(proof.sourceFile) &&
    !sourceClaims
      .get(proof.sourceFile)
      .some((claim) => proofMatchesClaim(proof, proof.sourceFile, claim))
  ) {
    violations.push(`${label}: proof is stale; source does not enroll ${formatProofClaim(proof)}`);
  }

  const proofPath = path.join(repoRoot, proof.proofFile);
  if (!existsSync(proofPath)) {
    violations.push(`${label}: proof file does not exist`);
    return;
  }

  const proofText = readFileSync(proofPath, 'utf8');
  const testBlock = extractNamedTestBlock(proofText, proof.testName);
  if (testBlock === undefined) {
    violations.push(`${label}: proof test "${proof.testName}" was not found`);
    return;
  }

  if (proofTestIsSkippedOrTodo(testBlock)) {
    violations.push(`${label}: proof test is skipped or todo`);
  }

  const requiredNeedles = proof.requiredNeedles ?? [proof.code];
  for (const needle of requiredNeedles) {
    if (!testBlock.includes(needle)) {
      violations.push(
        `${label}: proof test is missing required evidence ${JSON.stringify(needle)}`,
      );
    }
  }
  for (const needle of proof.requiredProofFileNeedles ?? []) {
    if (!proofText.includes(needle)) {
      violations.push(
        `${label}: proof file is missing required evidence ${JSON.stringify(needle)}`,
      );
    }
  }
  if (!testBlockHasBuildInvocation(testBlock, proof.buildInvocation)) {
    violations.push(
      `${label}: proof test does not exercise the declared production build path (${proof.buildInvocation})`,
    );
  }
  validateBuildHelper(proof.buildInvocation, { repoRoot, violations });
}

function extractCertificationClaims(source, sourceText, violations) {
  const extractor = source.claimExtractor ?? 'metamorphic-seed-codes';
  if (extractor === 'metamorphic-seed-codes') {
    return extractMetamorphicSeedCodes(sourceText).map((code) => ({
      claimId: undefined,
      code,
    }));
  }
  if (extractor === 'security-certification-markers') {
    return extractSecurityCertificationMarkers(sourceText);
  }
  violations.push(
    `${source.file}: unknown security proof-scope enrollment claim extractor ${extractor}`,
  );
  return [];
}

function proofMatchesClaim(proof, sourceFile, claim) {
  if (proof.sourceFile !== sourceFile || proof.code !== claim.code) return false;
  return claim.claimId === undefined || proof.claimId === claim.claimId;
}

function formatClaimLabel(sourceFile, claim) {
  return `${sourceFile} ${formatClaim(claim)}`;
}

function formatProofLabel(proof) {
  return `${proof.sourceFile} ${formatProofClaim(proof)} -> ${proof.proofFile}`;
}

function formatProofClaim(proof) {
  return proof.claimId === undefined ? proof.code : `${proof.code}/${proof.claimId}`;
}

function formatClaim(claim) {
  return claim.claimId === undefined ? claim.code : `${claim.code}/${claim.claimId}`;
}

function proofTestIsSkippedOrTodo(testBlock) {
  return /(^|\n)\s*(?:it|test)\.(?:skip|todo)\s*\(/.test(testBlock);
}

function testBlockHasBuildInvocation(testBlock, buildInvocation) {
  const patterns = BUILD_INVOCATION_PATTERNS[buildInvocation];
  return patterns?.some((pattern) => pattern.test(testBlock)) ?? false;
}

function validateBuildHelper(buildInvocation, { repoRoot, violations }) {
  const helper = PRODUCTION_BUILD_HELPERS[buildInvocation];
  if (!helper) return;

  const helperPath = path.join(repoRoot, helper.file);
  if (!existsSync(helperPath)) {
    violations.push(`${helper.file}: production build helper does not exist`);
    return;
  }
  const helperText = readFileSync(helperPath, 'utf8');
  for (const needle of helper.requiredNeedles) {
    if (!helperText.includes(needle)) {
      violations.push(
        `${helper.file}: ${buildInvocation} helper is missing required build evidence ${JSON.stringify(
          needle,
        )}`,
      );
    }
  }
}

function main() {
  const violations = securityTestBuildGateViolations();
  if (violations.length > 0) {
    process.stderr.write(`Security test build gate failed:\n`);
    for (const violation of violations) process.stderr.write(`  - ${violation}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Security test build gate passed (${SECURITY_BUILD_PROOFS.length} build/runtime proof-scope entries).\n`,
  );
}

if (process.argv[1] === thisFile) main();
