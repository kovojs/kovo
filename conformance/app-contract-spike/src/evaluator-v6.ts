import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import ts from 'typescript';

import {
  contentSubjectDigest,
  repoRootPath,
  sha256,
  type ContentSubject,
  type FileSubject,
} from './artifacts-v6.ts';
import {
  declarationFamilies,
  matrixCaseNames,
  type AppContractArm,
  type MatrixCaseName,
  type PrototypeDiagnostic,
} from './fixture-v6.ts';
import type {
  ArmEvaluation,
  D1CriteriaV6,
  D1EvaluationV6,
  D1RawEvidenceV6,
  EvaluationGate,
} from './types-v6.ts';

const arms = ['arm-a', 'arm-b'] as const;
const criteriaSha256 = 'd05ffa8fe6182e6ffbf69619af15bf64aa5f0788a58f554c80e09f885bf87a98';
const sealedArtifactNames = [
  'compiler-packed.tgz',
  'server-overlay-packed.tgz',
  'config.ts',
  'provider.ts',
  'generated-app.ts',
] as const;
const sealedArtifactSha256 = {
  'compiler-packed.tgz': 'a48785aec7e1d8cf3c9d5ccf400e7c7b2ead26dfc109c716363d5804638f3d28',
  'config.ts': 'ef1ddc51c0246b6e4b510c25fc0f1c4ed5fc2335e144aa1de177fa232e39f761',
  'generated-app.ts': '0b04785f1063c7583236301a2958396f30e9a6cf741dd70154c42dcc4c229ff1',
  'provider.ts': '7fe04d65fad502f337b2fe85a40968d425aaaa712721233aae827c23001b8e8d',
  'server-overlay-packed.tgz': '4ba64583eb16d3db1bab7198f7a014a026212d2d04be5574d122841a89d24576',
} as const satisfies Readonly<Record<(typeof sealedArtifactNames)[number], string>>;
const resolverMutationCodes = {
  'blank-consumer-file-name': 'D1A107',
  'blank-owner-key': 'D1A105',
  'blank-server-package-root': 'D1A106',
  'duplicate-span': 'D1A101',
  'overlapping-span': 'D1A102',
  'stale-source-reparse': 'D1A104',
  'wrong-node-span': 'D1A103',
} as const;
const generatedMutationCodes = {
  'compiler-source-digest': 'D1B103',
  'completion-token': 'D1B106',
  'config-source-digest': 'D1B102',
  'generated-module-digest': 'D1B105',
  'provider-source-digest': 'D1B101',
  'server-packed-contents-digest': 'D1B104',
} as const;
const evidenceBindingMutationCodes = {
  'matrix-source': 'D1E202',
  'packed-compiler-entrypoint': 'D1E204',
  'runtime-owner': 'D1E201',
  'server-copy-digest': 'D1E203',
} as const;
type SealedArtifactName = (typeof sealedArtifactNames)[number];
export type D1V6SealedAuthority = Partial<Readonly<Record<SealedArtifactName, string | Buffer>>>;
const exactRawKeys = [
  'compiler',
  'diagnostics',
  'evidenceBindings',
  'fixture',
  'generation',
  'matrix',
  'measurements',
  'mutationCoverage',
  'provenance',
  'publicForgery',
  'receiverFlow',
  'resolverIntegrity',
  'runner',
  'runtime',
  'schedules',
  'sealedArtifacts',
  'schema',
  'semanticEquivalence',
  'workloadSubjects',
] as const;

export async function evaluateD1V6(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  sealedOverrides: D1V6SealedAuthority = {},
): Promise<D1EvaluationV6> {
  await assertCriteriaAuthority(criteria);
  assertRawEvidenceShape(criteria, evidence);
  if (
    criteria.schema !== 'kovo.app-contract-d1-criteria/v6' ||
    evidence.schema !== 'kovo.app-contract-d1-raw-evidence/v6'
  ) {
    throw new Error('D1 v6 malformed evidence: schema mismatch.');
  }
  assertExactKeySet(Object.keys(criteria.matrix), matrixCaseNames, 'criteria matrix cases');
  assertExactKeySet(Object.keys(evidence.matrix), matrixCaseNames, 'evidence matrix cases');
  assertExactKeySet(
    Object.keys(evidence.compiler.families),
    declarationFamilies,
    'compiler family subjects',
  );

  const sealed = await readSealedAuthority(sealedOverrides);
  const artifacts = await artifactGate(criteria, evidence, sealed);
  const publicForgery = publicForgeryGate(evidence);
  const diagnostics = diagnosticGate(criteria, evidence);
  const ownershipAndBindings = ownershipGate(criteria, evidence, sealed);
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
  const evaluation: D1EvaluationV6 = {
    arms: evaluations,
    criteria: criteria.schema,
    decision,
    priorEvidenceDisposition: {
      v1: 'invalidated',
      v2: 'invalidated',
      v3: 'invalidated',
      v4: 'invalidated',
      v5: 'invalidated',
    },
    schema: 'kovo.app-contract-d1-evaluation/v6',
  };
  assertD1V6EvaluationShape(evaluation);
  return evaluation;
}

async function artifactGate(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  sealed: Readonly<Record<SealedArtifactName, Buffer>>,
): Promise<EvaluationGate> {
  const failures: string[] = [];
  for (const name of sealedArtifactNames) {
    if (sha256(sealed[name]) !== sealedArtifactSha256[name]) {
      failures.push(`${name} differs from the independently sealed v6 authority`);
    }
  }
  assertExactKeySet(
    Object.keys(evidence.mutationCoverage.oneSided),
    criteria.mutationContract.oneSided,
    'one-sided mutation coverage',
  );
  assertExactKeySet(
    Object.keys(evidence.mutationCoverage.correlated),
    criteria.mutationContract.correlated,
    'correlated mutation coverage',
  );
  assertExactKeySet(
    Object.keys(evidence.mutationCoverage.selectionBranches),
    criteria.mutationContract.selectionBranchesRequired,
    'selection branch coverage',
  );
  if (
    [
      ...Object.values(evidence.mutationCoverage.oneSided),
      ...Object.values(evidence.mutationCoverage.correlated),
    ].some((entry) => !entry.detected) ||
    !equalJson(
      Object.fromEntries(
        Object.entries(evidence.mutationCoverage.selectionBranches).map(([name, entry]) => [
          name,
          entry.decision,
        ]),
      ),
      {
        'arm-a-selected-when-both-pass': 'arm-a',
        'arm-a-selected-when-arm-b-fails': 'arm-a',
        'arm-b-selected-when-arm-a-fails': 'arm-b',
        'fallback-when-both-fail': 'fallback',
      },
    )
  ) {
    failures.push('mutation/selection coverage is incomplete');
  }
  if (!equalJson(criteria.buildCommands, evidence.provenance.buildCommands)) {
    failures.push('build commands differ from the immutable preregistration');
  }
  const currentSourceCommit = runGit(
    'log',
    '-1',
    '--format=%H',
    '--',
    'packages/browser/package.json',
    'packages/browser/src',
    'packages/compiler/package.json',
    'packages/compiler/src',
    'packages/core/package.json',
    'packages/core/src',
    'packages/server/package.json',
    'packages/server/src',
  ).trim();
  if (evidence.provenance.frameworkSourceCommit !== currentSourceCommit) {
    failures.push('framework source commit was not recomputed from git');
  }
  const packageNames = evidence.provenance.packages.map((entry) => entry.name).sort();
  const expectedNames = [...criteria.artifactContract.exactPackageNames].sort();
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
  const compilerTar = tarEntries(sealed['compiler-packed.tgz'], failures, 'compiler tarball');
  if (
    sha256(sealed['compiler-packed.tgz']) !== evidence.sealedArtifacts.compilerPackedSha256 ||
    evidence.sealedArtifacts.compilerPackedSha256 !== compilerArtifact?.tarballSha256
  ) {
    failures.push('sealed compiler tarball digest is unbound');
  }
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
    const tarEntry = compilerTar.get(`package/${entrypoint.packedFile.path}`);
    if (
      !entrypoint.realpath.startsWith('<artifact>/compiler/dist/') ||
      entrypoint.realpath.includes('/packages/compiler/src/') ||
      !packed ||
      packed.sha256 !== entrypoint.packedFile.sha256 ||
      entrypoint.resolvedSha256 !== entrypoint.packedFile.sha256 ||
      !tarEntry ||
      sha256(tarEntry) !== entrypoint.packedFile.sha256
    ) {
      failures.push(`${entrypoint.requested} is not bound to authenticated packed bytes`);
    }
  }
  const serverTar = tarEntries(
    sealed['server-overlay-packed.tgz'],
    failures,
    'server overlay tarball',
  );
  if (
    sha256(sealed['server-overlay-packed.tgz']) !==
    evidence.sealedArtifacts.serverOverlayPackedSha256
  ) {
    failures.push('sealed server overlay tarball digest is unbound');
  }
  const overlayFiles = evidence.fixture.serverCopies[0]?.overlayFiles ?? [];
  if (
    overlayFiles.length !== criteria.workload.serverOverlayFileCount ||
    overlayFiles.length !== criteria.artifactContract.overlayFilesExact
  ) {
    failures.push('server overlay file count differs');
  }
  for (const file of overlayFiles) {
    const actual = serverTar.get(`package/${file.path}`);
    if (!actual || actual.byteLength !== file.bytes || sha256(actual) !== file.sha256) {
      failures.push(`sealed server overlay differs at ${file.path}`);
    }
  }
  const postWriteFiles = evidence.fixture.serverCopies[0]?.postWriteContents.files ?? [];
  if (serverTar.size !== postWriteFiles.length) {
    failures.push('sealed server overlay file set differs from the post-write copy');
  }
  for (const file of postWriteFiles) {
    const actual = serverTar.get(`package/${file.path}`);
    if (!actual || actual.byteLength !== file.bytes || sha256(actual) !== file.sha256) {
      failures.push(`sealed post-write server copy differs at ${file.path}`);
    }
  }
  const serverArtifact = evidence.provenance.packages.find(
    (entry) => entry.name === '@kovojs/server',
  );
  const overlayPaths = new Set(overlayFiles.map((file) => file.path));
  const packedBaseFiles =
    serverArtifact?.packedContents.files.filter((file) => !overlayPaths.has(file.path)) ?? [];
  const postWriteBaseFiles = postWriteFiles.filter((file) => !overlayPaths.has(file.path));
  if (!equalJson(packedBaseFiles, postWriteBaseFiles)) {
    failures.push('sealed post-write server bytes do not authenticate the claimed packed base');
  }
  const sealedClaims = {
    'config.ts': evidence.sealedArtifacts.configSha256,
    'generated-app.ts': evidence.sealedArtifacts.generatedAppSha256,
    'provider.ts': evidence.sealedArtifacts.providerSha256,
  } as const;
  for (const [name, claimed] of Object.entries(sealedClaims) as [
    keyof typeof sealedClaims,
    string,
  ][]) {
    if (sha256(sealed[name]) !== claimed) {
      failures.push(`sealed ${name} digest is unbound`);
    }
  }
  return gate(failures);
}

function matrixGate(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
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
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  arm: AppContractArm,
): EvaluationGate {
  const failures: string[] = [];
  for (const family of declarationFamilies) {
    const baseline = evidence.compiler.families[family].baseline;
    const candidate = evidence.compiler.families[family][arm];
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
      failures.push(`${family} ${arm} full canonical IR/graph differs from baseline`);
    }
  }
  const baselineGraph = evidence.compiler.combinedGraphs.baseline;
  const armGraph = evidence.compiler.combinedGraphs[arm];
  validateSemanticSubject(baselineGraph, failures, 'combined baseline graph');
  validateSemanticSubject(armGraph, failures, 'combined Arm A graph');
  if (
    baselineGraph.digest !== armGraph.digest ||
    !equalJson(baselineGraph.canonical, armGraph.canonical)
  ) {
    failures.push(`combined ${arm} graph differs from independently assembled baseline graph`);
  }
  validateDiagnosticMap(
    evidence.semanticEquivalence.mutationDiagnostics,
    criteria.semanticEquivalenceContract.semanticMutations,
    failures,
    'semantic mutation',
  );
  assertExactKeySet(
    Object.keys(evidence.semanticEquivalence.collisionSubjects),
    criteria.semanticEquivalenceContract.collisionFixtures,
    'semantic collision fixtures',
  );
  for (const [name, collision] of Object.entries(evidence.semanticEquivalence.collisionSubjects)) {
    if (!collision.byteExact || collision.originalSha256 !== collision.canonicalSha256) {
      failures.push(`${name} was changed outside an exact factory-callee AST node`);
    }
  }
  return gate(failures);
}

function ownershipGate(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  sealed: Readonly<Record<SealedArtifactName, Buffer>>,
): EvaluationGate {
  const failures: string[] = [];
  const sealedIdentity = deriveSealedOwnerIdentity(sealed, failures);
  if (
    sealedIdentity &&
    (sealedIdentity.appId !== criteria.ownerContract.expectedAppId ||
      sealedIdentity.providerKey !== criteria.ownerContract.expectedProviderKey ||
      sealedIdentity.ownerKey !== evidence.fixture.ownerKey ||
      sealedIdentity.generatedOwnerKey !== sealedIdentity.ownerKey)
  ) {
    failures.push('sealed config/provider/generated owner identity differs');
  }
  if (sealed['config.ts'].includes('d1v6:') || sealed['provider.ts'].includes('d1v6:')) {
    failures.push('authored source contains a forbidden owner literal');
  }
  validateWorkloadSubjects(criteria, evidence, failures);
  validateGeneratedContractSet(criteria, evidence, failures);
  if (evidence.generation.armB.compilerRecognitionDiagnostics.length !== 0) {
    failures.push('generated Arm B recognition emitted a forbidden compiler diagnostic');
  }
  for (const arm of arms) {
    const runtime = evidence.runtime[arm];
    if (
      runtime.ownerKey !== evidence.fixture.ownerKey ||
      (sealedIdentity !== undefined && runtime.ownerKey !== sealedIdentity.ownerKey) ||
      runtime.assembledHandleCount !== 6 ||
      !equalJson(runtime.ownedFamilies, declarationFamilies) ||
      runtime.providerEvaluationCount !== 0 ||
      !runtime.crossAppError.includes('D1OWN001')
    ) {
      failures.push(`${arm} runtime ownership/assembly contract failed`);
    }
  }
  for (const family of declarationFamilies) {
    for (const arm of arms) {
      const entry = evidence.compiler.families[family][arm];
      validateFileBinding(
        entry.sourceSha256,
        entry.sourceSubject,
        failures,
        `${family}/${arm} source`,
      );
      if (entry.compiledOwnerKey !== evidence.runtime[arm].ownerKey) {
        failures.push(`${family}/${arm} compiled owner differs from runtime owner`);
      }
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
  if (
    evidence.fixture.serverCopies[0]?.postWriteContents.digest !==
      evidence.fixture.serverCopies[1]?.postWriteContents.digest ||
    !equalJson(
      evidence.fixture.serverCopies[0]?.postWriteContents,
      evidence.fixture.serverCopies[1]?.postWriteContents,
    ) ||
    evidence.fixture.serverCopies.some((copy) => {
      const failuresForCopy: string[] = [];
      validateContentSubject(copy.postWriteContents, failuresForCopy, 'post-write server copy');
      return (
        failuresForCopy.length > 0 ||
        !equalJson(copy.overlayFiles, evidence.fixture.serverCopies[0]?.overlayFiles)
      );
    })
  ) {
    failures.push('post-write server copies are not byte-identical');
  }
  const compilerArtifact = evidence.provenance.packages.find(
    (entry) => entry.name === '@kovojs/compiler',
  );
  if (
    sealedIdentity &&
    (sealedIdentity.compilerSourceSha256 !== compilerArtifact?.sourceSha256 ||
      sealedIdentity.serverPackedContentsSha256 !== serverArtifact?.packedContents.digest)
  ) {
    failures.push(
      'sealed generated AST compiler/server digests differ from authenticated package subjects',
    );
  }
  for (const contract of evidence.generation.armB.contracts) {
    const { manifest } = contract;
    const required = [
      'compilerSourceSha256',
      'configSha256',
      'generatedModuleSha256',
      'providerSourceSha256',
      'serverPackedContentsSha256',
    ] as const;
    if (
      manifest.ownerKey !== evidence.runtime['arm-b'].ownerKey ||
      (sealedIdentity !== undefined && manifest.ownerKey !== sealedIdentity.ownerKey) ||
      (sealedIdentity !== undefined &&
        (manifest.appId !== sealedIdentity.appId ||
          manifest.providerKey !== sealedIdentity.providerKey ||
          manifest.providerExportBinding !== sealedIdentity.providerExportBinding ||
          manifest.providerImportSpecifier !== sealedIdentity.providerImportSpecifier)) ||
      manifest.completed !== 'complete' ||
      manifest.schema !== 'kovo.generated-app-contract/v6' ||
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
  const primaryContract = evidence.generation.armB.contracts[0];
  if (
    !primaryContract ||
    primaryContract.configSubject.sha256 !== sha256(sealed['config.ts']) ||
    primaryContract.providerSubject.sha256 !== sha256(sealed['provider.ts']) ||
    primaryContract.generatedModuleSubject.sha256 !== sha256(sealed['generated-app.ts']) ||
    primaryContract.configSource !== sealed['config.ts'].toString('utf8') ||
    primaryContract.providerSource !== sealed['provider.ts'].toString('utf8') ||
    primaryContract.generatedModuleSource !== sealed['generated-app.ts'].toString('utf8')
  ) {
    failures.push('primary generated contract is not bound to sealed source bytes');
  }
  validateDiagnosticMap(
    evidence.resolverIntegrity,
    resolverMutationCodes,
    failures,
    'resolver mutation',
  );
  validateDiagnosticMap(
    evidence.generation.armB.mutationDiagnostics,
    generatedMutationCodes,
    failures,
    'generated mutation',
  );
  validateDiagnosticMap(
    evidence.evidenceBindings.mutationDiagnostics,
    evidenceBindingMutationCodes,
    failures,
    'evidence-binding mutation',
  );
  assertExactKeySet(
    Object.keys(evidence.receiverFlow.unsupported),
    Object.keys(criteria.receiverFlowContract.unsupported),
    'unsupported receiver flows',
  );
  for (const [name, expectedCode] of Object.entries(criteria.receiverFlowContract.unsupported)) {
    const observed = evidence.receiverFlow.unsupported[name];
    if (
      !observed ||
      !equalJson(
        observed.diagnostics.map((entry) => entry.code),
        [expectedCode],
      ) ||
      observed.recognizedFactoryCount !== 0 ||
      observed.ownerKey !== null
    ) {
      failures.push(`${name} app-derived receiver did not fail closed`);
    }
  }
  assertExactKeySet(
    Object.keys(evidence.receiverFlow.controls),
    criteria.receiverFlowContract.negativeControls,
    'receiver-flow controls',
  );
  for (const [name, unrelated] of Object.entries(evidence.receiverFlow.controls)) {
    if (
      criteria.receiverFlowContract.unrelatedSameNamedMemberMustRemainUnrecognized &&
      (unrelated.diagnostics.length !== 0 ||
        unrelated.recognizedFactoryCount !== 0 ||
        unrelated.ownerKey !== null)
    ) {
      failures.push(`${name} unrelated same-named member was recognized`);
    }
  }
  return gate(failures);
}

function validateWorkloadSubjects(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  failures: string[],
): void {
  validateSourceSnapshot(
    evidence.workloadSubjects.appSourcesBefore,
    failures,
    'app sources before',
  );
  validateSourceSnapshot(evidence.workloadSubjects.appSourcesAfter, failures, 'app sources after');

  const before = new Map(
    evidence.workloadSubjects.appSourcesBefore.inputs.map((entry) => [entry.subject.path, entry]),
  );
  const after = new Map(
    evidence.workloadSubjects.appSourcesAfter.inputs.map((entry) => [entry.subject.path, entry]),
  );
  const sourcePaths = new Set([...before.keys(), ...after.keys()]);
  const appSourceRewriteCount = [...sourcePaths].filter((path) => {
    const left = before.get(path);
    const right = after.get(path);
    return (
      !left || !right || left.source !== right.source || !equalJson(left.subject, right.subject)
    );
  }).length;

  const matrixEntries = matrixCaseNames.flatMap((name) =>
    arms.map((arm) => evidence.matrix[name][arm]),
  );
  const matrixSubjectIdentities = new Set(
    matrixEntries.map((entry) => JSON.stringify(entry.sourceSubject)),
  );
  const matrixPaths = new Set(matrixEntries.map((entry) => entry.sourceSubject.path));
  if (
    matrixSubjectIdentities.size !==
      criteria.semanticThresholds.matrixDistinctSourceSubjectsExact ||
    matrixPaths.size !== criteria.semanticThresholds.matrixDistinctSourceSubjectsExact
  ) {
    failures.push('matrix source subjects are not exact and physically distinct');
  }

  const declarationVariants = ['baseline', 'arm-a', 'arm-b'] as const;
  const declarationCounts: number[] = [];
  let generatedTypeDeclarationFiles = 0;
  let generatedTypeDeclarations = 0;
  for (const variant of declarationVariants) {
    const inputs = evidence.workloadSubjects.declarationInputs[variant];
    generatedTypeDeclarationFiles += inputs.length;
    for (const [index, input] of inputs.entries()) {
      validateSourceInput(input, failures, `${variant} declaration input ${index}`);
      if (input.subject.path !== `app/d1-measure/${variant}/declarations-${index}.ts`) {
        failures.push(`${variant} declaration input ${index} path/order differs`);
      }
      const declarationCount = countGeneratedTypeDeclarations(
        input.source,
        failures,
        `${variant} declaration input ${index}`,
      );
      declarationCounts.push(declarationCount);
      generatedTypeDeclarations += declarationCount;
    }
    if (new Set(inputs.map((input) => input.subject.path)).size !== inputs.length) {
      failures.push(`${variant} declaration input paths are not distinct`);
    }
  }
  const declarationsPerFile =
    declarationCounts.length > 0 && new Set(declarationCounts).size === 1
      ? declarationCounts[0]!
      : -1;
  if (declarationsPerFile < 0) {
    failures.push('generated declaration files do not have one exact declaration count');
  }

  const familyEntries = declarationFamilies.flatMap((family) =>
    (['baseline', 'arm-a', 'arm-b'] as const).map(
      (variant) => evidence.compiler.families[family][variant],
    ),
  );
  const generatedProviderFiles = new Set(
    evidence.generation.armB.contracts.map((contract) => contract.providerSubject.path),
  ).size;
  const generatedBoundModules = new Set(
    evidence.generation.armB.contracts.map((contract) => contract.generatedModuleSubject.path),
  ).size;
  const recomputedCounts = {
    matrixCases: Object.keys(evidence.matrix).length,
    matrixArms: new Set(Object.values(evidence.matrix).flatMap((entry) => Object.keys(entry))).size,
    generatedMatrixFiles: matrixEntries.length,
    declarationFamilies: Object.keys(evidence.compiler.families).length,
    familyVariants: new Set(
      Object.values(evidence.compiler.families).flatMap((entry) => Object.keys(entry)),
    ).size,
    generatedFamilyFiles: familyEntries.length,
    generatedRuntimeFiles: Object.keys(evidence.runtime).length,
    generatedProviderFiles,
    generatedBoundModules,
    unsupportedReceiverFiles: Object.keys(evidence.receiverFlow.unsupported).length,
    negativeControlFiles: Object.keys(evidence.receiverFlow.controls).length,
    typeMeasurementVariants: Object.keys(evidence.workloadSubjects.declarationInputs).length,
    declarationFilesPerVariant:
      new Set(
        declarationVariants.map(
          (variant) => evidence.workloadSubjects.declarationInputs[variant].length,
        ),
      ).size === 1
        ? evidence.workloadSubjects.declarationInputs.baseline.length
        : -1,
    declarationsPerFile,
    generatedTypeDeclarationFiles,
    generatedTypeDeclarations,
    appSourceRewriteCount,
    serverOverlayFileCount: evidence.fixture.serverCopies[0]?.overlayFiles.length ?? 0,
    sealedArtifactCount: Object.keys(evidence.sealedArtifacts).length,
    buildCommandCount: evidence.provenance.buildCommands.length,
    providerDefinitionCount: generatedProviderFiles,
  };
  const preregisteredCounts = {
    ...criteria.workload,
    providerDefinitionCount: criteria.semanticThresholds.providerDefinitionCountExact,
  };
  if (
    !equalJson(recomputedCounts, preregisteredCounts) ||
    !equalJson(evidence.fixture.counts, recomputedCounts)
  ) {
    failures.push('fixture counts do not independently recompute from raw subjects');
  }
}

function validateSourceSnapshot(
  snapshot: D1RawEvidenceV6['workloadSubjects']['appSourcesBefore'],
  failures: string[],
  label: string,
): void {
  validateContentSubject(snapshot.content, failures, `${label} content`);
  for (const [index, input] of snapshot.inputs.entries()) {
    validateSourceInput(input, failures, `${label} input ${index}`);
  }
  const subjects = snapshot.inputs.map((entry) => entry.subject);
  if (
    snapshot.schema !== 'kovo.app-contract-d1-source-snapshot/v1' ||
    new Set(subjects.map((subject) => subject.path)).size !== subjects.length ||
    !equalJson(subjects, snapshot.content.files)
  ) {
    failures.push(`${label} source bytes are not exactly bound to its content subject`);
  }
}

function validateSourceInput(
  input: {
    readonly source: string;
    readonly subject: FileSubject;
  },
  failures: string[],
  label: string,
): void {
  validateFileBinding(input.subject.sha256, input.subject, failures, label);
  if (
    Buffer.byteLength(input.source) !== input.subject.bytes ||
    sha256(input.source) !== input.subject.sha256
  ) {
    failures.push(`${label} bytes differ from its file subject`);
  }
}

function countGeneratedTypeDeclarations(source: string, failures: string[], label: string): number {
  const sourceFile = ts.createSourceFile(
    `${label}.ts`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let count = 0;
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer
        ? evaluatorUnwrap(declaration.initializer)
        : undefined;
      if (
        !ts.isIdentifier(declaration.name) ||
        !/^query\d+$/u.test(declaration.name.text) ||
        !initializer ||
        !ts.isCallExpression(initializer)
      ) {
        failures.push(`${label} contains a noncanonical generated declaration`);
        continue;
      }
      count += 1;
    }
  }
  return count;
}

function validateGeneratedContractSet(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  failures: string[],
): void {
  const contracts = evidence.generation.armB.contracts;
  const generatedPaths = new Set(contracts.map((contract) => contract.generatedModuleSubject.path));
  const providerPaths = new Set(contracts.map((contract) => contract.providerSubject.path));
  if (
    contracts.length !== criteria.workload.generatedBoundModules ||
    generatedPaths.size !== criteria.workload.generatedBoundModules ||
    providerPaths.size !== criteria.workload.generatedProviderFiles
  ) {
    failures.push('generated contracts do not have the exact module/provider cardinality');
  }
  for (const [index, contract] of contracts.entries()) {
    validateSourceInput(
      { source: contract.configSource, subject: contract.configSubject },
      failures,
      `generated contract ${index} config`,
    );
    validateSourceInput(
      {
        source: contract.providerSource,
        subject: contract.providerSubject,
      },
      failures,
      `generated contract ${index} provider`,
    );
    validateSourceInput(
      {
        source: contract.generatedModuleSource,
        subject: contract.generatedModuleSubject,
      },
      failures,
      `generated contract ${index} module`,
    );
    if (
      contract.manifest.configSha256 !== contract.configSubject.sha256 ||
      contract.manifest.providerSourceSha256 !== contract.providerSubject.sha256 ||
      contract.manifest.generatedModuleSha256 !== contract.generatedModuleSubject.sha256
    ) {
      failures.push(`generated contract ${index} manifest is not bound to captured bytes`);
    }
    const identity = deriveOwnerIdentityFromSources(
      contract.configSource,
      contract.providerSource,
      contract.generatedModuleSource,
      failures,
    );
    if (
      !identity ||
      identity.appId !== contract.manifest.appId ||
      identity.providerKey !== contract.manifest.providerKey ||
      identity.providerExportBinding !== contract.manifest.providerExportBinding ||
      identity.providerImportSpecifier !== contract.manifest.providerImportSpecifier ||
      identity.ownerKey !== contract.manifest.ownerKey ||
      identity.generatedOwnerKey !== contract.manifest.ownerKey ||
      identity.compilerSourceSha256 !== contract.manifest.compilerSourceSha256 ||
      identity.serverPackedContentsSha256 !== contract.manifest.serverPackedContentsSha256
    ) {
      failures.push(
        `generated contract ${index} identity does not derive from its config/provider/generated AST`,
      );
    }
  }
}

function publicForgeryGate(evidence: D1RawEvidenceV6): EvaluationGate {
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

function diagnosticGate(criteria: D1CriteriaV6, evidence: D1RawEvidenceV6): EvaluationGate {
  const failures: string[] = [];
  const recomputed = recomputeTypescriptDiagnostic(criteria);
  if (
    recomputed.code !== criteria.diagnosticThresholds.typescriptCode ||
    recomputed.length !== criteria.diagnosticThresholds.spanLength ||
    !recomputed.message.includes(criteria.diagnosticThresholds.suggestedProperty)
  ) {
    failures.push('independently recomputed TypeScript diagnostic differs from criteria');
  }
  for (const variant of ['baseline', 'arm-a', 'arm-b'] as const) {
    const diagnostic = evidence.diagnostics[variant];
    if (
      diagnostic.code !== criteria.diagnosticThresholds.typescriptCode ||
      diagnostic.length !== criteria.diagnosticThresholds.spanLength ||
      diagnostic.start !== diagnostic.expectedStart ||
      diagnostic.message.length >
        criteria.diagnosticThresholds.matrixDiagnosticMessageCharactersMaximum ||
      !diagnostic.message.includes(criteria.diagnosticThresholds.suggestedProperty)
    ) {
      failures.push(`${variant} TypeScript diagnostic contract failed`);
    }
    if (
      diagnostic.code !== recomputed.code ||
      diagnostic.length !== recomputed.length ||
      diagnostic.message !== recomputed.message
    ) {
      failures.push(`${variant} TypeScript diagnostic differs from independent recomputation`);
    }
  }
  return gate(failures);
}

function recomputeTypescriptDiagnostic(criteria: D1CriteriaV6): {
  readonly code: number;
  readonly length: number;
  readonly message: string;
} {
  const source = [
    'type ExpectedDefinition = {',
    '  readonly access: { readonly kind: "public" };',
    '  load(): { readonly ok: boolean };',
    '};',
    'const definition: ExpectedDefinition = {',
    '  access: { kind: "public" },',
    `  ${criteria.diagnosticThresholds.misspelledProperty}() { return { ok: true }; },`,
    '};',
    'void definition;',
    '',
  ].join('\n');
  const fileName = '/d1-v6-independent-diagnostic.ts';
  const options: ts.CompilerOptions = {
    exactOptionalPropertyTypes: true,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2024,
  };
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (candidate) => candidate === fileName || base.fileExists(candidate),
    getSourceFile: (candidate, languageVersion, onError, shouldCreateNewSourceFile) =>
      candidate === fileName
        ? sourceFile
        : base.getSourceFile(candidate, languageVersion, onError, shouldCreateNewSourceFile),
    readFile: (candidate) => (candidate === fileName ? source : base.readFile(candidate)),
  };
  const diagnostic = ts
    .getPreEmitDiagnostics(ts.createProgram({ host, options, rootNames: [fileName] }))
    .find((entry) => entry.file?.fileName === fileName && entry.code === 2561);
  if (!diagnostic) {
    throw new Error('D1 v6 independent TypeScript diagnostic did not produce TS2561.');
  }
  return {
    code: diagnostic.code,
    length: diagnostic.length ?? 0,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  };
}

function performanceGates(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
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
  if (evidence.runner.runnerName !== criteria.performanceThresholds.runnerName) {
    scheduleFailures.push('runner name differs from preregistration');
  }
  if (
    evidence.runner.schema !== 'kovo.app-contract-d1-runner/v1' ||
    evidence.runner.architecture !== 'arm64' ||
    evidence.runner.cpuModel !== 'Apple M4' ||
    !evidence.runner.nodeVersion.startsWith('v24.') ||
    !evidence.runner.operatingSystem.startsWith('darwin ') ||
    !evidence.runner.typescriptVersion.startsWith('6.')
  ) {
    scheduleFailures.push('runner metadata is inconsistent with the named runner');
  }
  const baseline = evidence.measurements.baseline;
  validateMeasurementSummary(
    baseline,
    criteria.performanceThresholds,
    scheduleFailures,
    'baseline',
  );
  validateSampleIdentities(baseline, 'baseline', evidence.schedules, scheduleFailures);
  const result = {} as Record<AppContractArm, EvaluationGate>;
  for (const arm of arms) {
    const failures = [...scheduleFailures];
    const candidate = evidence.measurements[arm];
    validateMeasurementSummary(candidate, criteria.performanceThresholds, failures, arm);
    validateSampleIdentities(candidate, arm, evidence.schedules, failures);
    if (
      pairedDeltaPercent(candidate.coldTscSamples, baseline.coldTscSamples, 0.5) >
      criteria.performanceThresholds.coldTscPairedP50DeltaPercentMaximum
    ) {
      failures.push('cold tsc delta exceeds threshold');
    }
    if (
      pairedDeltaPercent(candidate.warmTscSamples, baseline.warmTscSamples, 0.5) >
      criteria.performanceThresholds.warmTscPairedP50DeltaPercentMaximum
    ) {
      failures.push('warm tsc delta exceeds threshold');
    }
    if (
      pairedDeltaPercent(candidate.coldCompletionSamples, baseline.coldCompletionSamples, 0.5) >
      criteria.performanceThresholds.coldCompletionPairedP50DeltaPercentMaximum
    ) {
      failures.push('cold completion delta exceeds threshold');
    }
    if (
      candidate.warmCompletionP95Ms >
        criteria.performanceThresholds.warmCompletionP95MillisecondsMaximum ||
      pairedDeltaPercent(candidate.warmCompletionSamples, baseline.warmCompletionSamples, 0.95) >
        criteria.performanceThresholds.warmCompletionPairedP95DeltaPercentMaximum
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

function validateSampleIdentities(
  measurement: D1RawEvidenceV6['measurements']['baseline'],
  variant: 'arm-a' | 'arm-b' | 'baseline',
  schedules: D1RawEvidenceV6['schedules'],
  failures: string[],
): void {
  const groups = [
    ['cold-tsc', measurement.coldTscSamples, schedules.tsc],
    ['warm-tsc', measurement.warmTscSamples, schedules.tsc],
    ['cold-completion', measurement.coldCompletionSamples, schedules.coldCompletion],
    ['warm-completion', measurement.warmCompletionSamples, schedules.warmCompletion],
  ] as const;
  for (const [kind, samples, schedule] of groups) {
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const order = schedule[index];
      if (
        !order ||
        sample.iteration !== index ||
        sample.blockIndex !== Math.floor(index / 6) ||
        sample.variant !== variant ||
        sample.orderIndex !== order.indexOf(variant) ||
        sample.sampleId !== `${kind}:${index}:${order.join('>')}:${variant}`
      ) {
        failures.push(`${variant} ${kind} sample identity is inconsistent`);
        break;
      }
    }
  }
}

function validateMeasurementSummary(
  measurement: D1RawEvidenceV6['measurements']['baseline'],
  thresholds: D1CriteriaV6['performanceThresholds'],
  failures: string[],
  name: string,
): void {
  const coldTscMs = measurement.coldTscSamples.map((sample) => sample.milliseconds);
  const warmTscMs = measurement.warmTscSamples.map((sample) => sample.milliseconds);
  const coldCompletionMs = measurement.coldCompletionSamples.map((sample) => sample.milliseconds);
  const warmCompletionMs = measurement.warmCompletionSamples.map((sample) => sample.milliseconds);
  if (
    coldTscMs.length !== thresholds.coldTscRepeats ||
    warmTscMs.length !== thresholds.warmTscRepeats ||
    coldCompletionMs.length !== thresholds.coldCompletionRepeats ||
    warmCompletionMs.length !== thresholds.warmCompletionRepeats ||
    measurement.coldTscP50Ms !== round(percentile(coldTscMs, 0.5)) ||
    measurement.warmTscP50Ms !== round(percentile(warmTscMs, 0.5)) ||
    measurement.coldCompletionP50Ms !== round(percentile(coldCompletionMs, 0.5)) ||
    measurement.warmCompletionP95Ms !== round(percentile(warmCompletionMs, 0.95))
  ) {
    failures.push(`${name} timing samples and summaries are inconsistent`);
  }
  const allSamples = [
    ...measurement.coldTscSamples,
    ...measurement.warmTscSamples,
    ...measurement.coldCompletionSamples,
    ...measurement.warmCompletionSamples,
  ];
  if (
    allSamples.some(
      (sample) =>
        !Number.isFinite(sample.milliseconds) ||
        sample.milliseconds <= 0 ||
        !Number.isSafeInteger(sample.blockIndex) ||
        sample.blockIndex < 0 ||
        !Number.isSafeInteger(sample.iteration) ||
        sample.iteration < 0 ||
        !Number.isSafeInteger(sample.orderIndex) ||
        sample.orderIndex < 0,
    ) ||
    !Number.isSafeInteger(measurement.declarationBytes) ||
    measurement.declarationBytes <= 0 ||
    !Number.isSafeInteger(measurement.completionCandidateCount) ||
    measurement.completionCandidateCount <= 0 ||
    [
      measurement.coldTscP50Ms,
      measurement.warmTscP50Ms,
      measurement.coldCompletionP50Ms,
      measurement.warmCompletionP95Ms,
    ].some((value) => !Number.isFinite(value) || value <= 0) ||
    !equalJson(measurement.typecheckDiagnosticCodes, [])
  ) {
    failures.push(`${name} measurement values are outside the valid domain`);
  }
  if (
    measurement.completionCandidateCount !== measurement.completionCandidateNames.length ||
    measurement.completionCandidateDigest !==
      sha256(measurement.completionCandidateNames.join('\n')) ||
    new Set(measurement.completionCandidateNames).size !==
      measurement.completionCandidateNames.length ||
    !equalJson(
      measurement.completionCandidateNames,
      [...measurement.completionCandidateNames].sort(),
    )
  ) {
    failures.push(`${name} completion candidate subject is inconsistent`);
  }
  for (const sample of [
    ...measurement.coldCompletionSamples,
    ...measurement.warmCompletionSamples,
  ]) {
    if (
      sample.candidateCount !== measurement.completionCandidateCount ||
      sample.candidateDigest !== measurement.completionCandidateDigest
    ) {
      failures.push(`${name} per-sample completion identity is inconsistent`);
      break;
    }
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
  subject: D1RawEvidenceV6['compiler']['combinedGraphs']['baseline'],
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

async function assertCriteriaAuthority(criteria: D1CriteriaV6): Promise<void> {
  const actual = await readFile(new URL('../criteria-v6.json', import.meta.url));
  if (
    sha256(actual) !== criteriaSha256 ||
    sha256(`${JSON.stringify(criteria, null, 2)}\n`) !== criteriaSha256
  ) {
    throw new Error('D1 v6 malformed evidence: criteria bytes differ from preregistration.');
  }
}

async function readSealedAuthority(
  overrides: D1V6SealedAuthority,
): Promise<Readonly<Record<SealedArtifactName, Buffer>>> {
  assertExactKeySet(
    Object.keys(overrides),
    Object.keys(overrides).filter((name) =>
      sealedArtifactNames.includes(name as SealedArtifactName),
    ),
    'sealed authority overrides',
  );
  const entries = await Promise.all(
    sealedArtifactNames.map(async (name) => {
      const override = overrides[name];
      const bytes =
        override === undefined
          ? await readFile(new URL(`../sealed-v6/${name}`, import.meta.url))
          : Buffer.isBuffer(override)
            ? Buffer.from(override)
            : Buffer.from(override);
      return [name, bytes] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<SealedArtifactName, Buffer>;
}

function tarEntries(
  compressed: Buffer,
  failures: string[],
  label: string,
): ReadonlyMap<string, Buffer> {
  let tar: Buffer;
  try {
    tar = gunzipSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
  } catch {
    failures.push(`${label} is not bounded gzip`);
    return new Map();
  }
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return entries;
    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 500);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = tarOctal(header, 124, 136);
    const start = offset + 512;
    const end = start + size;
    if (
      path.length === 0 ||
      path.includes('..') ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      end > tar.byteLength ||
      entries.has(path)
    ) {
      failures.push(`${label} has an invalid tar entry`);
      return new Map();
    }
    entries.set(path, Buffer.from(tar.subarray(start, end)));
    offset = start + Math.ceil(size / 512) * 512;
  }
  failures.push(`${label} has no zero-block terminator`);
  return new Map();
}

function tarText(bytes: Buffer, start: number, end: number): string {
  const zero = bytes.indexOf(0, start);
  return bytes.subarray(start, zero >= start && zero < end ? zero : end).toString('utf8');
}

function tarOctal(bytes: Buffer, start: number, end: number): number {
  const value = tarText(bytes, start, end).trim();
  return value.length === 0 || !/^[0-7]+$/u.test(value) ? 0 : Number.parseInt(value, 8);
}

function deriveSealedOwnerIdentity(
  sealed: Readonly<Record<SealedArtifactName, Buffer>>,
  failures: string[],
):
  | {
      readonly appId: string;
      readonly compilerSourceSha256: string;
      readonly generatedOwnerKey: string;
      readonly ownerKey: string;
      readonly providerExportBinding: string;
      readonly providerImportSpecifier: string;
      readonly providerKey: string;
      readonly serverPackedContentsSha256: string;
    }
  | undefined {
  return deriveOwnerIdentityFromSources(
    sealed['config.ts'].toString('utf8'),
    sealed['provider.ts'].toString('utf8'),
    sealed['generated-app.ts'].toString('utf8'),
    failures,
  );
}

function deriveOwnerIdentityFromSources(
  configSource: string,
  providerSource: string,
  generatedSource: string,
  failures: string[],
):
  | {
      readonly appId: string;
      readonly compilerSourceSha256: string;
      readonly generatedOwnerKey: string;
      readonly ownerKey: string;
      readonly providerExportBinding: string;
      readonly providerImportSpecifier: string;
      readonly providerKey: string;
      readonly serverPackedContentsSha256: string;
    }
  | undefined {
  const configFile = ts.createSourceFile(
    'sealed/config.ts',
    configSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exportAssignment = configFile.statements.find(ts.isExportAssignment);
  const configObject = exportAssignment
    ? evaluatorObjectLiteral(exportAssignment.expression, 'Object', 'freeze')
    : undefined;
  if (!configObject) {
    failures.push('sealed config AST is not an exact frozen object');
    return undefined;
  }
  const appId = evaluatorStringProperty(configObject, 'appId');
  const providerExportBinding = evaluatorStringProperty(configObject, 'providerExportBinding');
  const providerImportSpecifier = evaluatorStringProperty(configObject, 'providerImportSpecifier');
  const providerKey = evaluatorStringProperty(configObject, 'providerKey');
  const providerReference = evaluatorIdentifierProperty(configObject, 'provider');
  if (
    !appId ||
    !providerExportBinding ||
    !providerImportSpecifier ||
    !providerKey ||
    providerReference !== providerExportBinding
  ) {
    failures.push('sealed config AST identity fields are incomplete');
    return undefined;
  }
  const configImport = configFile.statements
    .filter(ts.isImportDeclaration)
    .find(
      (statement) =>
        ts.isStringLiteralLike(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === providerImportSpecifier &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (specifier) =>
            (specifier.propertyName?.text ?? specifier.name.text) === providerExportBinding &&
            specifier.name.text === providerExportBinding,
        ),
    );
  const providerFile = ts.createSourceFile(
    'sealed/provider.ts',
    providerSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const providerDeclaration = providerFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === providerExportBinding,
    );
  const providerObject = providerDeclaration?.initializer
    ? evaluatorUnwrap(providerDeclaration.initializer)
    : undefined;
  if (
    !configImport ||
    !providerObject ||
    !ts.isObjectLiteralExpression(providerObject) ||
    evaluatorStringProperty(providerObject, 'key') !== providerKey
  ) {
    failures.push('sealed provider AST does not authenticate the config identity');
    return undefined;
  }
  const generatedFile = ts.createSourceFile(
    'sealed/generated-app.ts',
    generatedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const generatedDeclaration = generatedFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === '__kovoGeneratedContract',
    );
  const generatedObject = generatedDeclaration?.initializer
    ? evaluatorObjectLiteral(generatedDeclaration.initializer, 'Object', 'freeze')
    : undefined;
  const generatedOwnerKey = generatedObject
    ? evaluatorStringProperty(generatedObject, 'ownerKey')
    : undefined;
  const compilerSourceSha256 = generatedObject
    ? evaluatorStringProperty(generatedObject, 'compilerSourceSha256')
    : undefined;
  const serverPackedContentsSha256 = generatedObject
    ? evaluatorStringProperty(generatedObject, 'serverPackedContentsSha256')
    : undefined;
  if (
    !generatedObject ||
    evaluatorStringProperty(generatedObject, 'appId') !== appId ||
    evaluatorStringProperty(generatedObject, 'providerExportBinding') !== providerExportBinding ||
    evaluatorStringProperty(generatedObject, 'providerImportSpecifier') !==
      providerImportSpecifier ||
    evaluatorStringProperty(generatedObject, 'providerKey') !== providerKey ||
    !generatedOwnerKey ||
    !compilerSourceSha256 ||
    !serverPackedContentsSha256
  ) {
    failures.push('sealed generated AST does not bind the provider/config identity');
    return undefined;
  }
  const ownerKey = `d1v6:${sha256(
    JSON.stringify({
      appId,
      providerExportBinding,
      providerImportSpecifier,
      providerKey,
    }),
  )}`;
  return {
    appId,
    compilerSourceSha256,
    generatedOwnerKey,
    ownerKey,
    providerExportBinding,
    providerImportSpecifier,
    providerKey,
    serverPackedContentsSha256,
  };
}

function evaluatorObjectLiteral(
  expression: ts.Expression,
  receiver: string,
  member: string,
): ts.ObjectLiteralExpression | undefined {
  const value = evaluatorUnwrap(expression);
  if (
    !ts.isCallExpression(value) ||
    value.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(value.expression) ||
    !ts.isIdentifier(value.expression.expression) ||
    value.expression.expression.text !== receiver ||
    value.expression.name.text !== member
  ) {
    return undefined;
  }
  const argument = evaluatorUnwrap(value.arguments[0]!);
  return ts.isObjectLiteralExpression(argument) ? argument : undefined;
}

function evaluatorStringProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = evaluatorProperty(object, name);
  const value = property ? evaluatorUnwrap(property.initializer) : undefined;
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

function evaluatorIdentifierProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): string | undefined {
  const property = evaluatorProperty(object, name);
  const value = property ? evaluatorUnwrap(property.initializer) : undefined;
  return value && ts.isIdentifier(value) ? value.text : undefined;
}

function evaluatorProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) && property.name.text === name)),
  );
}

function evaluatorUnwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isSatisfiesExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isTypeAssertionExpression(value)
  ) {
    value = value.expression;
  }
  return value;
}

function gate(failures: readonly string[]): EvaluationGate {
  return { details: [...failures], pass: failures.length === 0 };
}

function assertRawEvidenceShape(criteria: D1CriteriaV6, evidence: D1RawEvidenceV6): void {
  assertExactKeys(evidence, exactRawKeys, 'raw evidence');
  assertExactKeys(
    evidence.provenance,
    [
      'buildCommands',
      'frameworkHeadCommit',
      'frameworkSourceCommit',
      'frameworkSourceContents',
      'frameworkSourceTreeClean',
      'packages',
      'packedCompiler',
    ],
    'raw evidence.provenance',
  );
  assertContentSubjectShape(evidence.provenance.frameworkSourceContents, 'framework source');
  for (const [index, artifact] of evidence.provenance.packages.entries()) {
    assertExactKeys(
      artifact,
      ['name', 'packedContents', 'sourceContents', 'sourceSha256', 'tarballSha256'],
      `package[${index}]`,
    );
    assertContentSubjectShape(artifact.packedContents, `package[${index}].packedContents`);
    assertContentSubjectShape(artifact.sourceContents, `package[${index}].sourceContents`);
  }
  assertExactKeys(
    evidence.provenance.packedCompiler,
    ['entrypoints', 'schema', 'workspaceSourceResolutionForbidden'],
    'packedCompiler',
  );
  for (const entry of evidence.provenance.packedCompiler.entrypoints) {
    assertExactKeys(
      entry,
      ['packedFile', 'realpath', 'requested', 'resolvedSha256'],
      'packedCompiler.entrypoint',
    );
    assertFileSubjectShape(entry.packedFile, 'packedCompiler.entrypoint.packedFile');
  }

  assertExactKeys(evidence.fixture, ['counts', 'ownerKey', 'serverCopies'], 'fixture');
  assertExactKeySet(
    Object.keys(evidence.fixture.counts),
    [...Object.keys(criteria.workload), 'providerDefinitionCount'],
    'fixture.counts',
  );
  for (const copy of evidence.fixture.serverCopies) {
    assertExactKeys(
      copy,
      ['basePackedContentsSha256', 'overlayFiles', 'physicalRoot', 'postWriteContents'],
      'fixture.serverCopy',
    );
    for (const file of copy.overlayFiles) assertFileSubjectShape(file, 'overlay file');
    assertContentSubjectShape(copy.postWriteContents, 'post-write copy');
  }

  assertExactKeys(
    evidence.workloadSubjects,
    ['appSourcesAfter', 'appSourcesBefore', 'declarationInputs'],
    'workloadSubjects',
  );
  assertSourceSnapshotShape(
    evidence.workloadSubjects.appSourcesBefore,
    'workloadSubjects.appSourcesBefore',
  );
  assertSourceSnapshotShape(
    evidence.workloadSubjects.appSourcesAfter,
    'workloadSubjects.appSourcesAfter',
  );
  assertExactKeys(
    evidence.workloadSubjects.declarationInputs,
    ['arm-a', 'arm-b', 'baseline'],
    'workloadSubjects.declarationInputs',
  );
  for (const [variant, inputs] of Object.entries(evidence.workloadSubjects.declarationInputs)) {
    for (const input of inputs) {
      assertExactKeys(input, ['source', 'subject'], `${variant} declaration input`);
      assertFileSubjectShape(input.subject, `${variant} declaration input subject`);
    }
  }

  assertExactKeys(evidence.matrix, matrixCaseNames, 'matrix');
  for (const name of matrixCaseNames) {
    assertExactKeys(evidence.matrix[name], arms, `matrix.${name}`);
    for (const arm of arms) assertMatrixEvidenceShape(evidence.matrix[name][arm], `${name}.${arm}`);
  }
  assertExactKeys(evidence.compiler, ['combinedGraphs', 'families'], 'compiler');
  assertExactKeys(
    evidence.compiler.combinedGraphs,
    ['arm-a', 'arm-b', 'baseline'],
    'compiler.combinedGraphs',
  );
  for (const subject of Object.values(evidence.compiler.combinedGraphs)) {
    assertSemanticSubjectShape(subject, 'combined graph');
  }
  assertExactKeys(evidence.compiler.families, declarationFamilies, 'compiler.families');
  for (const family of declarationFamilies) {
    assertExactKeys(
      evidence.compiler.families[family],
      ['arm-a', 'arm-b', 'baseline'],
      `compiler.families.${family}`,
    );
    for (const variant of ['arm-a', 'arm-b', 'baseline'] as const) {
      const entry = evidence.compiler.families[family][variant];
      assertExactKeys(
        entry,
        [
          'arm',
          'canonicalGraph',
          'canonicalIr',
          'compiledOwnerKey',
          'family',
          'recognized',
          'serverPackageRoots',
          'sourceSha256',
          'sourceSubject',
        ],
        `compiler.families.${family}.${variant}`,
      );
      assertSemanticSubjectShape(entry.canonicalGraph, 'family graph');
      assertSemanticSubjectShape(entry.canonicalIr, 'family IR');
      assertFileSubjectShape(entry.sourceSubject, 'family source');
    }
  }

  assertExactKeys(evidence.receiverFlow, ['controls', 'unsupported'], 'receiverFlow');
  assertExactKeys(
    evidence.receiverFlow.unsupported,
    Object.keys(criteria.receiverFlowContract.unsupported),
    'receiverFlow.unsupported',
  );
  assertExactKeys(
    evidence.receiverFlow.controls,
    criteria.receiverFlowContract.negativeControls,
    'receiverFlow.controls',
  );
  for (const value of Object.values(evidence.receiverFlow.unsupported)) {
    assertMatrixEvidenceShape(value, 'receiverFlow.unsupported entry');
  }
  for (const value of Object.values(evidence.receiverFlow.controls)) {
    assertMatrixEvidenceShape(value, 'receiverFlow.control entry');
  }
  assertExactKeys(
    evidence.resolverIntegrity,
    Object.keys(resolverMutationCodes),
    'resolverIntegrity',
  );
  assertDiagnosticRecordShape(evidence.resolverIntegrity, 'resolverIntegrity');
  assertExactKeys(
    evidence.semanticEquivalence,
    ['collisionSubjects', 'mutationDiagnostics'],
    'semanticEquivalence',
  );
  assertExactKeys(
    evidence.semanticEquivalence.collisionSubjects,
    criteria.semanticEquivalenceContract.collisionFixtures,
    'semanticEquivalence.collisionSubjects',
  );
  for (const collision of Object.values(evidence.semanticEquivalence.collisionSubjects)) {
    assertExactKeys(
      collision,
      ['byteExact', 'canonicalSha256', 'originalSha256'],
      'semantic collision',
    );
  }
  assertExactKeys(
    evidence.semanticEquivalence.mutationDiagnostics,
    Object.keys(criteria.semanticEquivalenceContract.semanticMutations),
    'semantic mutation diagnostics',
  );
  assertDiagnosticRecordShape(
    evidence.semanticEquivalence.mutationDiagnostics,
    'semantic mutation diagnostics',
  );
  assertExactKeys(evidence.evidenceBindings, ['mutationDiagnostics'], 'evidenceBindings');
  assertExactKeys(
    evidence.evidenceBindings.mutationDiagnostics,
    Object.keys(evidenceBindingMutationCodes),
    'binding mutation diagnostics',
  );
  assertDiagnosticRecordShape(
    evidence.evidenceBindings.mutationDiagnostics,
    'binding mutation diagnostics',
  );

  assertExactKeys(evidence.generation, ['armB'], 'generation');
  assertExactKeys(
    evidence.generation.armB,
    ['compilerRecognitionDiagnostics', 'contracts', 'mutationDiagnostics'],
    'generation.armB',
  );
  for (const diagnostic of evidence.generation.armB.compilerRecognitionDiagnostics) {
    assertDiagnosticShape(diagnostic, 'generation compiler diagnostic');
  }
  assertExactKeys(
    evidence.generation.armB.mutationDiagnostics,
    Object.keys(generatedMutationCodes),
    'generation mutation diagnostics',
  );
  assertDiagnosticRecordShape(
    evidence.generation.armB.mutationDiagnostics,
    'generation mutation diagnostics',
  );
  for (const contract of evidence.generation.armB.contracts) {
    assertExactKeys(
      contract,
      [
        'configSource',
        'configSubject',
        'generatedModuleSource',
        'generatedModuleSubject',
        'manifest',
        'providerSource',
        'providerSubject',
      ],
      'generated contract',
    );
    assertFileSubjectShape(contract.configSubject, 'generated config');
    assertFileSubjectShape(contract.generatedModuleSubject, 'generated module');
    assertFileSubjectShape(contract.providerSubject, 'generated provider');
    assertExactKeys(
      contract.manifest,
      [
        'appId',
        'compilerSourceSha256',
        'completed',
        'configSha256',
        'generatedModuleSha256',
        'ownerKey',
        'providerExportBinding',
        'providerImportSpecifier',
        'providerKey',
        'providerSourceSha256',
        'schema',
        'serverPackedContentsSha256',
      ],
      'generated manifest',
    );
  }

  assertExactKeys(evidence.runtime, arms, 'runtime');
  for (const runtime of Object.values(evidence.runtime)) {
    assertExactKeys(
      runtime,
      [
        'assembledHandleCount',
        'crossAppError',
        'ownedFamilies',
        'ownerKey',
        'providerEvaluationCount',
      ],
      'runtime arm',
    );
  }
  assertExactKeys(
    evidence.publicForgery,
    ['fakeAccessAsPublicAccess', 'fakeHtmlAsTrustedHtml', 'forbiddenOptionNamesPresent'],
    'publicForgery',
  );
  assertExactKeys(
    evidence.publicForgery.fakeAccessAsPublicAccess,
    ['componentPublicAccess', 'routePublicAccess'],
    'publicForgery.access',
  );
  assertExactKeys(
    evidence.publicForgery.fakeHtmlAsTrustedHtml,
    ['diagnosticCodes', 'recognizedTrustedHtml'],
    'publicForgery.html',
  );

  assertExactKeys(evidence.diagnostics, ['arm-a', 'arm-b', 'baseline'], 'diagnostics');
  for (const diagnostic of Object.values(evidence.diagnostics)) {
    assertExactKeys(
      diagnostic,
      ['code', 'expectedStart', 'fileName', 'length', 'message', 'start'],
      'TypeScript diagnostic',
    );
  }
  assertExactKeys(evidence.measurements, ['arm-a', 'arm-b', 'baseline'], 'measurements');
  for (const measurement of Object.values(evidence.measurements)) {
    assertExactKeys(
      measurement,
      [
        'coldCompletionP50Ms',
        'coldCompletionSamples',
        'coldTscP50Ms',
        'coldTscSamples',
        'completionCandidateCount',
        'completionCandidateDigest',
        'completionCandidateNames',
        'declarationBytes',
        'typecheckDiagnosticCodes',
        'warmCompletionP95Ms',
        'warmCompletionSamples',
        'warmTscP50Ms',
        'warmTscSamples',
      ],
      'measurement',
    );
    for (const sample of [...measurement.coldTscSamples, ...measurement.warmTscSamples]) {
      assertTimedSampleShape(sample, false);
    }
    for (const sample of [
      ...measurement.coldCompletionSamples,
      ...measurement.warmCompletionSamples,
    ]) {
      assertTimedSampleShape(sample, true);
    }
  }
  assertExactKeys(
    evidence.mutationCoverage,
    ['correlated', 'oneSided', 'selectionBranches'],
    'mutationCoverage',
  );
  assertExactKeys(
    evidence.mutationCoverage.oneSided,
    criteria.mutationContract.oneSided,
    'mutationCoverage.oneSided',
  );
  assertExactKeys(
    evidence.mutationCoverage.correlated,
    criteria.mutationContract.correlated,
    'mutationCoverage.correlated',
  );
  assertExactKeys(
    evidence.mutationCoverage.selectionBranches,
    criteria.mutationContract.selectionBranchesRequired,
    'mutationCoverage.selectionBranches',
  );
  for (const entry of [
    ...Object.values(evidence.mutationCoverage.oneSided),
    ...Object.values(evidence.mutationCoverage.correlated),
  ]) {
    assertExactKeys(entry, ['detected'], 'mutation coverage entry');
  }
  for (const entry of Object.values(evidence.mutationCoverage.selectionBranches)) {
    assertExactKeys(entry, ['decision'], 'selection branch entry');
  }
  assertExactKeys(
    evidence.runner,
    [
      'architecture',
      'cpuModel',
      'nodeVersion',
      'operatingSystem',
      'runnerName',
      'schema',
      'typescriptVersion',
    ],
    'runner',
  );
  assertExactKeys(evidence.schedules, ['coldCompletion', 'tsc', 'warmCompletion'], 'schedules');
  assertExactKeys(
    evidence.sealedArtifacts,
    [
      'compilerPackedSha256',
      'configSha256',
      'generatedAppSha256',
      'providerSha256',
      'serverOverlayPackedSha256',
    ],
    'sealedArtifacts',
  );
}

function assertContentSubjectShape(subject: ContentSubject, label: string): void {
  assertExactKeys(subject, ['digest', 'files', 'schema'], label);
  for (const file of subject.files) assertFileSubjectShape(file, `${label}.file`);
}

function assertSourceSnapshotShape(
  snapshot: D1RawEvidenceV6['workloadSubjects']['appSourcesBefore'],
  label: string,
): void {
  assertExactKeys(snapshot, ['content', 'inputs', 'schema'], label);
  assertContentSubjectShape(snapshot.content, `${label}.content`);
  for (const input of snapshot.inputs) {
    assertExactKeys(input, ['source', 'subject'], `${label}.input`);
    assertFileSubjectShape(input.subject, `${label}.input.subject`);
  }
}

function assertFileSubjectShape(subject: FileSubject, label: string): void {
  assertExactKeys(subject, ['bytes', 'executable', 'path', 'schema', 'sha256'], label);
}

function assertMatrixEvidenceShape(
  value: D1RawEvidenceV6['matrix'][MatrixCaseName][AppContractArm],
  label: string,
): void {
  assertExactKeys(
    value,
    [
      'diagnostics',
      'ownerKey',
      'recognizedFactoryCount',
      'resolverSchema',
      'serverPackageRoots',
      'sourceSha256',
      'sourceSubject',
      'typescriptDiagnosticCodes',
    ],
    label,
  );
  for (const diagnostic of value.diagnostics)
    assertDiagnosticShape(diagnostic, `${label}.diagnostic`);
  assertFileSubjectShape(value.sourceSubject, `${label}.source`);
}

function assertSemanticSubjectShape(
  value: D1RawEvidenceV6['compiler']['combinedGraphs']['baseline'],
  label: string,
): void {
  assertExactKeys(value, ['canonical', 'digest', 'schema'], label);
}

function assertDiagnosticRecordShape(
  value: Readonly<Record<string, readonly PrototypeDiagnostic[]>>,
  label: string,
): void {
  for (const [name, diagnostics] of Object.entries(value)) {
    for (const diagnostic of diagnostics) assertDiagnosticShape(diagnostic, `${label}.${name}`);
  }
}

function assertDiagnosticShape(value: PrototypeDiagnostic, label: string): void {
  assertExactKeys(value, ['code', 'fileName', 'length', 'message', 'start'], label);
}

function assertTimedSampleShape(sample: object, completion: boolean): void {
  assertExactKeys(
    sample,
    completion
      ? [
          'blockIndex',
          'candidateCount',
          'candidateDigest',
          'iteration',
          'milliseconds',
          'orderIndex',
          'sampleId',
          'variant',
        ]
      : ['blockIndex', 'iteration', 'milliseconds', 'orderIndex', 'sampleId', 'variant'],
    'timed sample',
  );
}

export function assertD1V6EvaluationShape(evaluation: D1EvaluationV6): void {
  assertExactKeys(
    evaluation,
    ['arms', 'criteria', 'decision', 'priorEvidenceDisposition', 'schema'],
    'evaluation',
  );
  assertExactKeys(evaluation.arms, arms, 'evaluation.arms');
  for (const arm of arms) {
    assertExactKeys(evaluation.arms[arm], ['eligible', 'gates'], `evaluation.${arm}`);
    assertExactKeys(
      evaluation.arms[arm].gates,
      [
        'artifacts',
        'compilerAndGraph',
        'diagnostics',
        'matrix',
        'ownershipAndBindings',
        'performance',
        'publicForgery',
      ],
      `evaluation.${arm}.gates`,
    );
    for (const gateValue of Object.values(evaluation.arms[arm].gates)) {
      assertExactKeys(gateValue, ['details', 'pass'], 'evaluation gate');
    }
  }
  assertExactKeys(
    evaluation.priorEvidenceDisposition,
    ['v1', 'v2', 'v3', 'v4', 'v5'],
    'evaluation.priorEvidenceDisposition',
  );
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
    throw new Error(`D1 v6 malformed evidence: ${label} keys differ (${actual.join(', ')}).`);
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

function pairedDeltaPercent(
  candidate: readonly { readonly iteration: number; readonly milliseconds: number }[],
  baseline: readonly { readonly iteration: number; readonly milliseconds: number }[],
  fraction: number,
): number {
  if (candidate.length !== baseline.length) return Number.POSITIVE_INFINITY;
  const baselineByIteration = new Map(
    baseline.map((sample) => [sample.iteration, sample.milliseconds] as const),
  );
  const deltas = candidate.map((sample) => {
    const paired = baselineByIteration.get(sample.iteration);
    return paired === undefined
      ? Number.POSITIVE_INFINITY
      : deltaPercent(sample.milliseconds, paired);
  });
  return percentile(deltas, fraction);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
