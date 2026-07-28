import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  contentSubjectDigest,
  repoRootPath,
  sha256,
  type ContentSubject,
  type FileSubject,
} from './artifacts-v5.ts';
import {
  declarationFamilies,
  matrixCaseNames,
  type AppContractArm,
  type PrototypeDiagnostic,
} from './fixture-v5.ts';
import type {
  ArmEvaluation,
  D1CriteriaV5,
  D1EvaluationV5,
  D1RawEvidenceV5,
  EvaluationGate,
} from './types-v5.ts';

const arms = ['arm-a', 'arm-b'] as const;
const exactRawKeys = [
  'compiler',
  'diagnostics',
  'evidenceBindings',
  'fixture',
  'generation',
  'matrix',
  'measurements',
  'provenance',
  'publicForgery',
  'receiverFlow',
  'resolverIntegrity',
  'runner',
  'runtime',
  'schedules',
  'schema',
  'semanticEquivalence',
] as const;

export async function evaluateD1V5(
  criteria: D1CriteriaV5,
  evidence: D1RawEvidenceV5,
): Promise<D1EvaluationV5> {
  assertExactKeys(evidence, exactRawKeys, 'raw evidence');
  if (
    criteria.schema !== 'kovo.app-contract-d1-criteria/v5' ||
    evidence.schema !== 'kovo.app-contract-d1-raw-evidence/v5'
  ) {
    throw new Error('D1 v5 malformed evidence: schema mismatch.');
  }
  assertExactKeySet(Object.keys(criteria.matrix), matrixCaseNames, 'criteria matrix cases');
  assertExactKeySet(Object.keys(evidence.matrix), matrixCaseNames, 'evidence matrix cases');
  assertExactKeySet(
    Object.keys(evidence.compiler.families),
    declarationFamilies,
    'compiler family subjects',
  );

  const artifacts = await artifactGate(criteria, evidence);
  const publicForgery = publicForgeryGate(evidence);
  const diagnostics = diagnosticGate(criteria, evidence);
  const ownershipAndBindings = ownershipGate(criteria, evidence);
  const performance = performanceGates(criteria, evidence);
  const evaluations = {} as Record<AppContractArm, ArmEvaluation>;
  for (const arm of arms) {
    const matrix = matrixGate(criteria, evidence, arm);
    const compilerAndGraph = compilerGate(criteria, evidence, arm);
    const gates = {
      artifacts,
      compilerAndGraph,
      diagnostics,
      matrix,
      ownershipAndBindings,
      performance: performance[arm],
      publicForgery,
    };
    evaluations[arm] = {
      eligible: Object.values(gates).every((gate) => gate.pass),
      gates,
    };
  }
  const decision = evaluations['arm-a'].eligible
    ? 'arm-a'
    : evaluations['arm-b'].eligible
      ? 'arm-b'
      : 'fallback';
  return {
    arms: evaluations,
    criteria: criteria.schema,
    decision,
    priorEvidenceDisposition: {
      v1: 'invalidated',
      v2: 'invalidated',
      v3: 'invalidated',
      v4: 'invalidated',
    },
    schema: 'kovo.app-contract-d1-evaluation/v5',
  };
}

async function artifactGate(
  criteria: D1CriteriaV5,
  evidence: D1RawEvidenceV5,
): Promise<EvaluationGate> {
  const failures: string[] = [];
  const packageNames = evidence.provenance.packages.map((entry) => entry.name).sort();
  const expectedNames = [...criteria.artifactThresholds.exactPackageNames].sort();
  if (!equalJson(packageNames, expectedNames)) failures.push('packed package set is not exact');
  if (!evidence.provenance.frameworkSourceTreeClean) {
    failures.push('framework source tree was not clean');
  }
  const currentHead = runGit('rev-parse', 'HEAD').trim();
  const isAncestor = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', evidence.provenance.frameworkHeadCommit, currentHead],
    { cwd: repoRootPath() },
  ).status;
  if (isAncestor !== 0) {
    failures.push('framework build commit is not an ancestor of current HEAD');
  }
  await validateCurrentContentSubject(
    evidence.provenance.frameworkSourceContents,
    failures,
    'framework source',
  );
  for (const artifact of evidence.provenance.packages) {
    validateContentSubject(artifact.sourceContents, failures, `${artifact.name} source`);
    validateContentSubject(artifact.packedContents, failures, `${artifact.name} packed`);
    if (artifact.sourceSha256 !== artifact.sourceContents.digest) {
      failures.push(`${artifact.name} source digest is unbound`);
    }
  }
  const compilerArtifact = evidence.provenance.packages.find(
    (entry) => entry.name === '@kovojs/compiler',
  );
  const entrypoints = evidence.provenance.packedCompiler.entrypoints;
  if (
    evidence.provenance.packedCompiler.schema !== 'kovo.app-contract-d1-packed-compiler/v1' ||
    !evidence.provenance.packedCompiler.workspaceSourceResolutionForbidden ||
    entrypoints.length !== 2
  ) {
    failures.push('packed compiler contract is incomplete');
  }
  assertExactKeySet(
    entrypoints.map((entry) => entry.requested),
    ['@kovojs/compiler', '@kovojs/compiler/internal'],
    'packed compiler entrypoints',
  );
  for (const entrypoint of entrypoints) {
    const packed = compilerArtifact?.packedContents.files.find(
      (file) => file.path === entrypoint.packedFile.path,
    );
    if (
      !entrypoint.realpath.startsWith('<artifact>/compiler/dist/') ||
      entrypoint.realpath.includes('/packages/compiler/src/') ||
      !packed ||
      packed.sha256 !== entrypoint.packedFile.sha256 ||
      entrypoint.resolvedSha256 !== entrypoint.packedFile.sha256
    ) {
      failures.push(`${entrypoint.requested} is not bound to authenticated packed bytes`);
    }
  }
  return gate(failures);
}

function matrixGate(
  criteria: D1CriteriaV5,
  evidence: D1RawEvidenceV5,
  arm: AppContractArm,
): EvaluationGate {
  const failures: string[] = [];
  for (const name of matrixCaseNames) {
    const expected = criteria.matrix[name][arm];
    const observed = evidence.matrix[name][arm];
    validateFileBinding(observed.sourceSha256, observed.sourceSubject, failures, name);
    const codes = observed.diagnostics.map((entry) => entry.code);
    if (expected === 'accept') {
      if (
        codes.length !== 0 ||
        observed.recognizedFactoryCount <= 0 ||
        observed.ownerKey !== evidence.fixture.ownerKey
      ) {
        failures.push(`${name} did not accept through a recognized owned factory`);
      }
    } else {
      const expectedCode = expected.slice('reject:'.length);
      if (!equalJson(codes, [expectedCode])) {
        failures.push(`${name} expected ${expectedCode}, observed ${codes.join(',')}`);
      }
      if (observed.recognizedFactoryCount !== 0 || observed.ownerKey !== null) {
        failures.push(`${name} retained compiler identity after rejection`);
      }
      if (expectedCode === 'D1X001' && observed.serverPackageRoots.length !== 2) {
        failures.push(`${name} did not retain both physical server roots`);
      }
    }
    for (const diagnostic of observed.diagnostics) {
      if (
        diagnostic.length > criteria.diagnosticThresholds.matrixDiagnosticSpanCharactersMaximum ||
        diagnostic.message.length >
          criteria.diagnosticThresholds.matrixDiagnosticMessageCharactersMaximum
      ) {
        failures.push(`${name} diagnostic exceeds the bounded UX contract`);
      }
    }
  }
  return gate(failures);
}

function compilerGate(
  criteria: D1CriteriaV5,
  evidence: D1RawEvidenceV5,
  arm: AppContractArm,
): EvaluationGate {
  const failures: string[] = [];
  if (arm === 'arm-b') {
    if (
      !equalJson(
        evidence.generation.armB.compilerRecognitionDiagnostics.map((entry) => entry.code),
        ['D1B201'],
      )
    ) {
      failures.push('genuine generated bound module was not tested through existing identity');
    } else {
      failures.push('existing free-function identity did not recognize generated binding');
    }
    return gate(failures);
  }

  for (const family of declarationFamilies) {
    const baseline = evidence.compiler.families[family].baseline;
    const candidate = evidence.compiler.families[family]['arm-a'];
    validateSemanticSubject(baseline.canonicalIr, failures, `${family} baseline IR`);
    validateSemanticSubject(candidate.canonicalIr, failures, `${family} Arm A IR`);
    validateSemanticSubject(baseline.canonicalGraph, failures, `${family} baseline graph`);
    validateSemanticSubject(candidate.canonicalGraph, failures, `${family} Arm A graph`);
    if (
      !candidate.recognized ||
      !equalJson(baseline.canonicalIr.canonical, candidate.canonicalIr.canonical) ||
      baseline.canonicalIr.digest !== candidate.canonicalIr.digest ||
      !equalJson(baseline.canonicalGraph.canonical, candidate.canonicalGraph.canonical) ||
      baseline.canonicalGraph.digest !== candidate.canonicalGraph.digest
    ) {
      failures.push(`${family} full canonical IR/graph differs from baseline`);
    }
  }
  const baselineGraph = evidence.compiler.combinedGraphs.baseline;
  const armGraph = evidence.compiler.combinedGraphs['arm-a'];
  validateSemanticSubject(baselineGraph, failures, 'combined baseline graph');
  validateSemanticSubject(armGraph, failures, 'combined Arm A graph');
  if (
    baselineGraph.digest !== armGraph.digest ||
    !equalJson(baselineGraph.canonical, armGraph.canonical)
  ) {
    failures.push('combined Arm A graph differs from independently assembled baseline graph');
  }
  validateDiagnosticMap(
    evidence.semanticEquivalence.mutationDiagnostics,
    criteria.semanticEquivalenceContract.mutations,
    failures,
    'semantic mutation',
  );
  return gate(failures);
}

function ownershipGate(criteria: D1CriteriaV5, evidence: D1RawEvidenceV5): EvaluationGate {
  const failures: string[] = [];
  for (const arm of arms) {
    const runtime = evidence.runtime[arm];
    if (
      runtime.ownerKey !== evidence.fixture.ownerKey ||
      runtime.assembledHandleCount !== 6 ||
      !equalJson(runtime.ownedFamilies, declarationFamilies) ||
      runtime.providerEvaluationCount !== 0 ||
      !runtime.crossAppError.includes(criteria.diagnosticThresholds.crossAppDiagnosticCode)
    ) {
      failures.push(`${arm} runtime ownership/assembly contract failed`);
    }
  }
  for (const family of declarationFamilies) {
    const entry = evidence.compiler.families[family]['arm-a'];
    validateFileBinding(entry.sourceSha256, entry.sourceSubject, failures, `${family} source`);
    if (entry.compiledOwnerKey !== evidence.runtime['arm-a'].ownerKey) {
      failures.push(`${family} compiled owner differs from runtime owner`);
    }
  }
  for (const name of matrixCaseNames) {
    for (const arm of arms) {
      const entry = evidence.matrix[name][arm];
      validateFileBinding(entry.sourceSha256, entry.sourceSubject, failures, `${name}/${arm}`);
    }
  }
  const serverArtifact = evidence.provenance.packages.find(
    (entry) => entry.name === '@kovojs/server',
  );
  if (
    evidence.fixture.serverCopies.length !== 2 ||
    !serverArtifact ||
    evidence.fixture.serverCopies.some(
      (copy) => copy.basePackedContentsSha256 !== serverArtifact.packedContents.digest,
    ) ||
    new Set(evidence.fixture.serverCopies.map((copy) => copy.physicalRoot)).size !== 2
  ) {
    failures.push('physical server copy digests are not bound to packed server bytes');
  }
  const compilerArtifact = evidence.provenance.packages.find(
    (entry) => entry.name === '@kovojs/compiler',
  );
  for (const contract of evidence.generation.armB.contracts) {
    const { manifest } = contract;
    const required = criteria.artifactThresholds.generatedManifestDigestFieldsRequired;
    if (
      manifest.ownerKey !== evidence.runtime['arm-b'].ownerKey ||
      manifest.completed !== 'complete' ||
      manifest.schema !== 'kovo.generated-app-contract/v5' ||
      required.some(
        (field) =>
          typeof manifest[field as keyof typeof manifest] !== 'string' ||
          String(manifest[field as keyof typeof manifest]).length === 0,
      ) ||
      manifest.compilerSourceSha256 !== compilerArtifact?.sourceSha256 ||
      manifest.serverPackedContentsSha256 !== serverArtifact?.packedContents.digest ||
      manifest.configSha256 !== contract.configSubject.sha256 ||
      manifest.providerSourceSha256 !== contract.providerSubject.sha256 ||
      manifest.generatedModuleSha256 !== contract.generatedModuleSubject.sha256
    ) {
      failures.push('generated manifest is incomplete or unbound');
    }
    validateFileBinding(
      manifest.configSha256,
      contract.configSubject,
      failures,
      'generated config',
    );
    validateFileBinding(
      manifest.providerSourceSha256,
      contract.providerSubject,
      failures,
      'generated provider',
    );
    validateFileBinding(
      manifest.generatedModuleSha256,
      contract.generatedModuleSubject,
      failures,
      'generated module',
    );
  }
  validateDiagnosticMap(
    evidence.resolverIntegrity,
    criteria.resolverIntegrityMutations,
    failures,
    'resolver mutation',
  );
  validateDiagnosticMap(
    evidence.generation.armB.mutationDiagnostics,
    {
      'compiler-source-digest': 'D1B103',
      'completion-token': 'D1B106',
      'config-source-digest': 'D1B102',
      'generated-module-digest': 'D1B105',
      'provider-source-digest': 'D1B101',
      'server-packed-contents-digest': 'D1B104',
    },
    failures,
    'generated mutation',
  );
  validateDiagnosticMap(
    evidence.evidenceBindings.mutationDiagnostics,
    criteria.evidenceBindingContract.mutations,
    failures,
    'evidence-binding mutation',
  );
  if (
    criteria.immutableReceiverContract.unprovedAppDerivedCallMustDiagnose &&
    !equalJson(
      evidence.receiverFlow.nestedAppDerived.diagnostics.map((entry) => entry.code),
      ['D1A007'],
    )
  ) {
    failures.push('nested app-derived receiver did not fail closed');
  }
  const unrelated = evidence.receiverFlow.unrelatedSameNamedMember;
  if (
    criteria.immutableReceiverContract.unrelatedSameNamedMemberMustRemainUnrecognized &&
    (unrelated.diagnostics.length !== 0 ||
      unrelated.recognizedFactoryCount !== 0 ||
      unrelated.ownerKey !== null)
  ) {
    failures.push('unrelated same-named member was recognized');
  }
  return gate(failures);
}

function publicForgeryGate(evidence: D1RawEvidenceV5): EvaluationGate {
  const failures: string[] = [];
  if (
    evidence.publicForgery.fakeAccessAsPublicAccess.componentPublicAccess ||
    evidence.publicForgery.fakeAccessAsPublicAccess.routePublicAccess
  ) {
    failures.push('caller-forged access became public');
  }
  if (
    evidence.publicForgery.fakeHtmlAsTrustedHtml.recognizedTrustedHtml ||
    !equalJson(evidence.publicForgery.fakeHtmlAsTrustedHtml.diagnosticCodes, ['KV236', 'KV426'])
  ) {
    failures.push('caller-forged HTML became trusted');
  }
  if (evidence.publicForgery.forbiddenOptionNamesPresent.length > 0) {
    failures.push('forbidden public identity override symbol is present');
  }
  return gate(failures);
}

function diagnosticGate(criteria: D1CriteriaV5, evidence: D1RawEvidenceV5): EvaluationGate {
  const failures: string[] = [];
  for (const variant of ['baseline', 'arm-a', 'arm-b'] as const) {
    const diagnostic = evidence.diagnostics[variant];
    if (
      diagnostic.code !== criteria.diagnosticThresholds.typescriptCode ||
      diagnostic.length !== criteria.diagnosticThresholds.spanLength ||
      diagnostic.start !== diagnostic.expectedStart ||
      diagnostic.message.length > criteria.diagnosticThresholds.messageCharactersMaximum ||
      !diagnostic.message.includes(criteria.diagnosticThresholds.suggestedProperty)
    ) {
      failures.push(`${variant} TypeScript diagnostic contract failed`);
    }
  }
  return gate(failures);
}

function performanceGates(
  criteria: D1CriteriaV5,
  evidence: D1RawEvidenceV5,
): Readonly<Record<AppContractArm, EvaluationGate>> {
  const scheduleFailures: string[] = [];
  if (criteria.performanceThresholds.completeSixOrderBlocksRequired) {
    validateSixOrderBlocks(
      evidence.schedules.tsc,
      criteria.performanceThresholds.coldTscRepeats,
      scheduleFailures,
      'tsc',
    );
    validateSixOrderBlocks(
      evidence.schedules.coldCompletion,
      criteria.performanceThresholds.coldCompletionRepeats,
      scheduleFailures,
      'cold completion',
    );
    validateSixOrderBlocks(
      evidence.schedules.warmCompletion,
      criteria.performanceThresholds.warmCompletionRepeats,
      scheduleFailures,
      'warm completion',
    );
  }
  for (const field of criteria.performanceThresholds.runnerMetadataRequired) {
    if (
      typeof evidence.runner[field as keyof typeof evidence.runner] !== 'string' ||
      String(evidence.runner[field as keyof typeof evidence.runner]).trim().length === 0
    ) {
      scheduleFailures.push(`runner metadata ${field} is missing`);
    }
  }
  const baseline = evidence.measurements.baseline;
  validateMeasurementSummary(
    baseline,
    criteria.performanceThresholds,
    scheduleFailures,
    'baseline',
  );
  const result = {} as Record<AppContractArm, EvaluationGate>;
  for (const arm of arms) {
    const failures = [...scheduleFailures];
    const candidate = evidence.measurements[arm];
    validateMeasurementSummary(candidate, criteria.performanceThresholds, failures, arm);
    if (
      deltaPercent(candidate.coldTscP50Ms, baseline.coldTscP50Ms) >
      criteria.performanceThresholds.coldTscP50DeltaPercentMaximum
    ) {
      failures.push('cold tsc delta exceeds threshold');
    }
    if (
      deltaPercent(candidate.warmTscP50Ms, baseline.warmTscP50Ms) >
      criteria.performanceThresholds.warmTscP50DeltaPercentMaximum
    ) {
      failures.push('warm tsc delta exceeds threshold');
    }
    if (
      deltaPercent(candidate.coldCompletionP50Ms, baseline.coldCompletionP50Ms) >
      criteria.performanceThresholds.coldCompletionP50DeltaPercentMaximum
    ) {
      failures.push('cold completion delta exceeds threshold');
    }
    if (
      candidate.warmCompletionP95Ms >
        criteria.performanceThresholds.warmCompletionP95MillisecondsMaximum ||
      deltaPercent(candidate.warmCompletionP95Ms, baseline.warmCompletionP95Ms) >
        criteria.performanceThresholds.warmCompletionP95DeltaPercentMaximum
    ) {
      failures.push('warm completion p95 exceeds threshold');
    }
    if (
      deltaPercent(candidate.declarationBytes, baseline.declarationBytes) >
      criteria.performanceThresholds.declarationBytesDeltaPercentMaximum
    ) {
      failures.push('declaration bytes delta exceeds threshold');
    }
    if (
      criteria.performanceThresholds.completionCandidateCountMustEqualBaseline &&
      candidate.completionCandidateCount !== baseline.completionCandidateCount
    ) {
      failures.push('completion candidate count differs');
    }
    if (
      criteria.performanceThresholds.completionCandidateDigestMustEqualBaseline &&
      candidate.completionCandidateDigest !== baseline.completionCandidateDigest
    ) {
      failures.push('completion candidate digest differs');
    }
    result[arm] = gate(failures);
  }
  return result;
}

function validateMeasurementSummary(
  measurement: D1RawEvidenceV5['measurements']['baseline'],
  thresholds: D1CriteriaV5['performanceThresholds'],
  failures: string[],
  name: string,
): void {
  if (
    measurement.coldTscMs.length !== thresholds.coldTscRepeats ||
    measurement.warmTscMs.length !== thresholds.warmTscRepeats ||
    measurement.coldCompletionMs.length !== thresholds.coldCompletionRepeats ||
    measurement.warmCompletionMs.length !== thresholds.warmCompletionRepeats ||
    measurement.coldTscP50Ms !== round(percentile(measurement.coldTscMs, 0.5)) ||
    measurement.warmTscP50Ms !== round(percentile(measurement.warmTscMs, 0.5)) ||
    measurement.coldCompletionP50Ms !== round(percentile(measurement.coldCompletionMs, 0.5)) ||
    measurement.warmCompletionP95Ms !== round(percentile(measurement.warmCompletionMs, 0.95))
  ) {
    failures.push(`${name} timing samples and summaries are inconsistent`);
  }
  if (
    measurement.completionCandidateCount !== measurement.completionCandidateNames.length ||
    measurement.completionCandidateDigest !==
      sha256(measurement.completionCandidateNames.join('\n'))
  ) {
    failures.push(`${name} completion candidate subject is inconsistent`);
  }
}

function validateSixOrderBlocks(
  schedule: readonly (readonly string[])[],
  expectedLength: number,
  failures: string[],
  name: string,
): void {
  const expectedOrders = new Set(
    permutations(['baseline', 'arm-a', 'arm-b']).map((order) => order.join('|')),
  );
  if (schedule.length !== expectedLength || schedule.length % 6 !== 0) {
    failures.push(`${name} schedule does not contain complete six-order blocks`);
    return;
  }
  for (let offset = 0; offset < schedule.length; offset += 6) {
    const observed = new Set(schedule.slice(offset, offset + 6).map((order) => order.join('|')));
    if (!equalJson([...observed].sort(), [...expectedOrders].sort())) {
      failures.push(`${name} schedule block ${offset / 6} is incomplete`);
    }
  }
}

async function validateCurrentContentSubject(
  subject: ContentSubject,
  failures: string[],
  label: string,
): Promise<void> {
  validateContentSubject(subject, failures, label);
  for (const file of subject.files) {
    const bytes = await readFile(join(repoRootPath(), file.path));
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      failures.push(`${label} current file differs: ${file.path}`);
    }
  }
}

function validateContentSubject(subject: ContentSubject, failures: string[], label: string): void {
  const ordered = [...subject.files].sort((left, right) => left.path.localeCompare(right.path));
  if (
    subject.schema !== 'kovo.app-contract-d1-content-subject/v1' ||
    !equalJson(subject.files, ordered) ||
    subject.digest !== contentSubjectDigest(subject.files)
  ) {
    failures.push(`${label} content subject digest/order is invalid`);
  }
}

function validateFileBinding(
  digest: string,
  subject: FileSubject,
  failures: string[],
  label: string,
): void {
  if (
    subject.schema !== 'kovo.app-contract-d1-file-subject/v1' ||
    subject.sha256 !== digest ||
    !/^[a-f0-9]{64}$/u.test(subject.sha256) ||
    subject.bytes <= 0
  ) {
    failures.push(`${label} source file subject is unauthenticated`);
  }
}

function validateSemanticSubject(
  subject: D1RawEvidenceV5['compiler']['combinedGraphs']['baseline'],
  failures: string[],
  label: string,
): void {
  if (
    subject.schema !== 'kovo.app-contract-d1-canonical-semantics/v1' ||
    subject.digest !== sha256(JSON.stringify(subject.canonical))
  ) {
    failures.push(`${label} digest is inconsistent`);
  }
}

function validateDiagnosticMap(
  observed: Readonly<Record<string, readonly PrototypeDiagnostic[]>>,
  expected: Readonly<Record<string, string>>,
  failures: string[],
  label: string,
): void {
  if (!equalJson(Object.keys(observed).sort(), Object.keys(expected).sort())) {
    failures.push(`${label} names differ`);
    return;
  }
  for (const [name, code] of Object.entries(expected)) {
    if (!equalJson(observed[name]?.map((entry) => entry.code) ?? [], [code])) {
      failures.push(`${label} ${name} did not produce ${code}`);
    }
  }
}

function gate(failures: readonly string[]): EvaluationGate {
  return { details: [...failures], pass: failures.length === 0 };
}

function assertExactKeys(value: object, expected: readonly string[], label: string): void {
  assertExactKeySet(Object.keys(value), expected, label);
}

function assertExactKeySet(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (!equalJson([...actual].sort(), [...expected].sort())) {
    throw new Error(`D1 v5 malformed evidence: ${label} keys differ (${actual.join(', ')}).`);
  }
}

function runGit(...arguments_: readonly string[]): string {
  const result = spawnSync('git', [...arguments_], {
    cwd: repoRootPath(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${arguments_.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function permutations(values: readonly string[]): string[][] {
  if (values.length <= 1) return [[...values]];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [
      value,
      ...tail,
    ]),
  );
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function deltaPercent(candidate: number, baseline: number): number {
  if (baseline === 0) return candidate === 0 ? 0 : Number.POSITIVE_INFINITY;
  return ((candidate - baseline) / baseline) * 100;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
