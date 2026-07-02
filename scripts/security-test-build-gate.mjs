#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(thisFile), '..');

export const SECURITY_BUILD_CERTIFICATION_CODES = [
  'KV414',
  'KV422',
  'KV426',
  'KV433',
  'KV435',
  'KV311',
  'KV330',
];

export const DEFAULT_TRUSTED_OUTPUT_SINK_POSITION_SEED = 'dec-g:kv426:trusted-output:v1';
export const DEFAULT_READ_SOURCE_FAMILY_SEED = 'dec-g:read-source:v1';
export const DEFAULT_WRAPPING_GRAMMAR_SEED = 'dec-g:wrapping:v1';
export const DEFAULT_PARANOID_GENERATOR_ACCEPTANCE_SEED = 'dec-h:round-8:paranoid:v1';

export const TRUSTED_OUTPUT_SINK_POSITION_GRAMMAR = Object.freeze({
  sinks: Object.freeze([
    {
      helper: 'trustedUrl',
      position: 'url-brand',
    },
    {
      helper: 'renderedHtml',
      position: 'rendered-html-brand',
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
    sink: 'renderedHtml',
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
      needle: 'queries/auth-secret-direct-leak-query.accessToken',
      surface: 'KV435 direct secret DB-read source',
    },
  ]),
});

export const SECURITY_WRAPPING_GRAMMAR = Object.freeze({
  forms: Object.freeze([
    {
      form: 'alias',
      needle: 'queries/auth-secret-leak-query.accessToken',
      surface: 'KV435 cross-select alias/value merge',
    },
    {
      form: 'component-prop',
      needle: 'trustedHtml() sends request-derived data',
      surface: 'KV426 component prop request slot',
    },
    {
      form: 'direct',
      needle: 'queries/auth-secret-direct-leak-query.accessToken',
      surface: 'KV435 direct query projection',
    },
    {
      form: 'helper',
      needle: 'queries/auth-secret-transformed-leak-query.password',
      surface: 'KV435 local helper transformation',
    },
    {
      form: 'local-wrapper',
      needle: 'renderedHtml() sends query-derived data',
      surface: 'KV426 server wrapper renderedHtml',
    },
  ]),
});

export const PARANOID_GENERATOR_ACCEPTANCE_GRAMMAR = Object.freeze({
  cases: Object.freeze([
    {
      expectation: 'legitimate-build-green',
      kind: 'runtime-route',
      route: '/paranoid-runtime-safe.txt',
      sink: 'respond.file header',
      surface: 'legitimate response-file route stays green',
    },
    {
      expectation: 'static-classifiers-stubbed',
      kind: 'build-env',
      surface: 'KOVO_PARANOID production artifact build',
    },
    {
      expectation: 'unsafe-runtime-choke',
      kind: 'runtime-route',
      route: '/paranoid-runtime-unsafe-header.txt',
      sink: 'response header CRLF direct',
      surface: 'direct response header runtime choke',
    },
    {
      expectation: 'unsafe-runtime-choke',
      kind: 'runtime-route',
      route: '/paranoid-runtime-unsafe-helper.txt',
      sink: 'response header CRLF helper',
      surface: 'helper-wrapped response header runtime choke',
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
  // DEC-H/A9: round-8 acceptance is a generated unsafe/legit/paranoid-mode
  // proof shape, not a single hand-enrolled adversarial fixture.
  void options;
  return [
    'generateParanoidGeneratorAcceptanceCases()',
    'addParanoidRuntimeProofRoutes(root, paranoidCases)',
    'expectParanoidRuntimeCase(origin, testCase)',
    'buildParanoidProductionArtifact(root)',
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

export const SECURITY_BUILD_PROOFS = [
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
      'blocks local-helper Better Auth credential laundering from the production build artifact',
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
      'blocks local-helper Better Auth credential laundering from the production build artifact',
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
      ...readSourceFamilyProofNeedles().filter((needle) =>
        needle.startsWith('queries/auth-secret-direct-leak-query.'),
      ),
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper Better Auth credential laundering from the production build artifact',
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
      ...securityWrappingProofNeedles().filter((needle) =>
        needle.startsWith('queries/auth-secret-transformed-leak-query.'),
      ),
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper Better Auth credential laundering from the production build artifact',
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
      'queries/auth-secret-render-leak-query.renderPassword',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper Better Auth credential laundering from the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'cross-select-laundering',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addAuthSecretLeakProof(unsafeRoot)',
      'buildProductionArtifact(unsafeRoot)',
      'KV435',
      'Secret query value reaches the client wire',
      ...securityWrappingProofNeedles().filter((needle) =>
        needle.startsWith('queries/auth-secret-leak-query.'),
      ),
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'blocks local-helper Better Auth credential laundering from the production build artifact',
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
      'blocks local-helper Better Auth credential laundering from the production build artifact',
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
    claimId: 'round-8-paranoid-generator-acceptance',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    requiredNeedles: paranoidGeneratorAcceptanceProofNeedles().filter(
      (needle) => needle !== "KOVO_PARANOID: '1'",
    ),
    requiredProofFileNeedles: paranoidGeneratorAcceptanceProofNeedles().filter(
      (needle) => needle === "KOVO_PARANOID: '1'",
    ),
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts',
    testName: 'runs generated paranoid acceptance cases with static classifiers advisory',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-db-read-boundary',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'KV435',
      'Secret runtime value cannot cross',
      'runtime-secret-column-egress',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'", 'classified: runtimeSecretProof.classified'],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-raw-sql-read-boundary',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'KV435',
      'Secret runtime value cannot cross',
      'runtime-secret-raw-egress',
    ],
    requiredProofFileNeedles: [
      "KOVO_PARANOID: '1'",
      'classified as leaked from "runtime_secret_proof"',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-computed-read-boundary',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'KV435',
      'Secret runtime value cannot cross',
      'runtime-secret-computed-egress',
      'leaked: row.classified',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'", 'runtimeSecretComputedEgressQuery'],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-reader-raw-sql-refusal',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'runtime-secret-default-raw-refusal',
      'default reader raw secret-column refusal proof',
      'declared secret-read capability',
      'expect(refusalResponse.status, refusalBody).toBe(200)',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'", 'runtimeSecretDefaultRawRefusalQuery'],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-declared-read-capability',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'runtime-secret-declared-raw-egress',
      'runtime-secret-declared-raw-reveal',
      'declareSecretReadCapability(',
      'audited declared raw secret-read reveal acceptance proof',
      'expect(declaredRevealResponse.status, declaredRevealBody).toBe(200)',
      'runtime-secret-value:declared',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'", 'runtimeSecretDeclaredRawEgressQuery'],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'runtime-secret-audited-reveal-egress',
    code: 'KV435',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    requiredNeedles: [
      'addRuntimeSecretBoundaryProof(root)',
      'buildParanoidProductionArtifact(root)',
      'runtime-secret-reveal-egress',
      'trustedReveal(row.classified as unknown as Secret<string>',
      'audited runtime query-wire reveal acceptance proof',
      'expect(revealResponse.status, revealBody).toBe(200)',
      'runtime-secret-value:computed',
    ],
    requiredProofFileNeedles: ["KOVO_PARANOID: '1'"],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.security.test.ts',
    testName:
      'boxes schema-declared secret reads, raw SQL aliases, and computed values before query-wire egress in paranoid mode while allowing audited reveals',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'readonly-managed-handle-prod-artifact',
    code: 'KV433',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    requiredNeedles: [
      'includeReadonlyMutationAttempt: true',
      'includeWebhookTransactionProof: true',
      'buildReusableProductionArtifact(root)',
      'expectReadonlyAttemptBlocked(origin)',
    ],
    requiredProofFileNeedles: ['/api/readonly-mutation-attempt', 'futureStatement'],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName:
      'rolls back default mutation transactions and executes webhooks in the production build artifact',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'managed-write-raw-driver-escape-prod-artifact',
    code: 'KV422',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    requiredNeedles: [
      'addRuntimeMutationSafetyProofs(root, { includeManagedWriteEscapeAttempt: true })',
      'buildProductionArtifact(root)',
      'Expected kovo build --no-cache to fail for managed raw-driver escape.',
      'KV406',
      'runtime-safety-proofs.ts',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'blocks managed write raw-driver escapes before $label artifact emission',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'webhook-transaction-raw-driver-escape-prod-artifact',
    code: 'KV330',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    requiredNeedles: [
      'addRuntimeMutationSafetyProofs(root, { includeWebhookTxEscapeAttempt: true })',
      'buildProductionArtifact(root)',
      'Expected kovo build --no-cache to fail for webhook tx raw-driver escape.',
      'KV330',
      'Direct db access in a webhook handler',
      'runtime-safety-proofs.ts',
    ],
    requiredProofFileNeedles: [
      'includeWebhookTransactionProof',
      'txProofWebhook',
      'context.tx as unknown as { $client: unknown }',
      'context.tx as unknown as { session: unknown }',
    ],
    sourceFile: 'packages/create-kovo/src/index.build.prod-artifact.transactions.test.ts',
    testName: 'blocks $label webhook transaction raw-driver escapes before artifact emission',
  },
  {
    buildInvocation: 'starter-build-production-artifact',
    claimId: 'raw-sql-owner-write-prod-artifact',
    code: 'KV414',
    proofFile: 'packages/create-kovo/src/index.build.prod-artifact.raw-sql.test.ts',
    requiredNeedles: [
      'addRawSqlOwnerWriteProof(root)',
      'buildProductionArtifact(root)',
      'Expected kovo build --no-cache to fail for raw owner-table write.',
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
      'operation=store',
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
