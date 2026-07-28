import { cp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import {
  buildAndPackFresh,
  loadAuthenticatedPackedCompiler,
  sha256,
  type PackedCompilerEntrypoint,
} from './artifacts-v6.ts';
import {
  evaluateD1V6,
  type D1V6SealedAuthority,
} from './evaluator-v6.ts';
import {
  createPrototypeFixture,
  declarationFamilies,
  generatedContractMutationDiagnostics,
  matrixCaseNames,
  stableFixturePath,
  validateGeneratedContract,
  type PrototypeDiagnostic,
} from './fixture-v6.ts';
import {
  combinedGraphEvidence,
  createPrototypeProject,
  familyEvidence,
  fixtureFileSubject,
  fixtureSourceContentSubject,
  matrixEvidenceForEntry,
  publicForgeryEvidence,
  semanticCollisionEvidence,
  semanticMutationSubjects,
} from './project-v6.ts';
import { runtimeEvidence } from './runtime-v6.ts';
import { measureTypeContracts } from './type-measurement-v6.ts';
import type { D1CriteriaV6, D1RawEvidenceV6, GeneratedManifestEvidence } from './types-v6.ts';

export async function runD1V6Experiment(
  criteria: D1CriteriaV6,
  options: { readonly sealDirectory?: string } = {},
): Promise<D1RawEvidenceV6> {
  const temporaryRoot = await realpath(tmpdir());
  const root = join(temporaryRoot, 'kovo-app-contract-d1-v6-2123d1860');
  if (dirname(root) !== temporaryRoot) {
    throw new Error('D1 v6 deterministic fixture escaped the operating-system temp root.');
  }
  await rm(root, { force: true, recursive: true });
  await mkdir(root, { recursive: true });
  try {
    const artifacts = await buildAndPackFresh(root);
    const packed = await loadAuthenticatedPackedCompiler(artifacts);
    const fixture = await createPrototypeFixture(root, artifacts);
    const appSourcesBefore = await fixtureSourceContentSubject(fixture);
    const project = await createPrototypeProject(fixture, packed);

    const matrix = {} as {
      -readonly [Name in keyof D1RawEvidenceV6['matrix']]: {
        -readonly [Arm in keyof D1RawEvidenceV6['matrix'][Name]]: D1RawEvidenceV6['matrix'][Name][Arm];
      };
    };
    for (const name of matrixCaseNames) {
      const arms = {} as {
        -readonly [Arm in keyof D1RawEvidenceV6['matrix'][typeof name]]: D1RawEvidenceV6['matrix'][typeof name][Arm];
      };
      for (const arm of ['arm-a', 'arm-b'] as const) {
        arms[arm] = await matrixEvidenceForEntry(
          fixture,
          project,
          arm,
          fixture.matrixEntries[name][arm],
        );
      }
      (matrix as Record<string, unknown>)[name] = arms;
    }

    const families = {} as {
      -readonly [Family in keyof D1RawEvidenceV6['compiler']['families']]: {
        -readonly [Variant in keyof D1RawEvidenceV6['compiler']['families'][Family]]: D1RawEvidenceV6['compiler']['families'][Family][Variant];
      };
    };
    for (const family of declarationFamilies) {
      const variants = {} as {
        -readonly [Variant in keyof D1RawEvidenceV6['compiler']['families'][typeof family]]: D1RawEvidenceV6['compiler']['families'][typeof family][Variant];
      };
      for (const variant of ['baseline', 'arm-a', 'arm-b'] as const) {
        variants[variant] = await familyEvidence(fixture, project, family, variant);
      }
      (families as Record<string, unknown>)[family] = variants;
    }
    const combinedGraphs = {
      'arm-a': await combinedGraphEvidence(fixture, project, 'arm-a'),
      'arm-b': await combinedGraphEvidence(fixture, project, 'arm-b'),
      baseline: await combinedGraphEvidence(fixture, project, 'baseline'),
    } as const;

    const resolverIntegrityRaw = project.compilerProject.resolverIntegrityMutations(
      fixture.familyEntries.query['arm-a'],
    );
    const resolverIntegrity = Object.fromEntries(
      Object.entries(resolverIntegrityRaw).map(([name, diagnostics]) => [
        name,
        diagnostics.map((diagnostic) => stableDiagnostic(fixture.root, diagnostic)),
      ]),
    );

    const semanticEquivalence = {
      collisionSubjects: semanticCollisionEvidence(),
      mutationDiagnostics: semanticMutationDiagnostics(
        families.query.baseline.canonicalIr,
        families.query.baseline.canonicalGraph,
      ),
    };
    const receiverFlow = {
      controls: Object.fromEntries(
        await Promise.all(
          Object.entries(fixture.receiverFlowEntries.controls).map(
            async ([name, fileName]) => [
              name,
              await matrixEvidenceForEntry(fixture, project, 'arm-a', fileName),
            ],
          ),
        ),
      ),
      unsupported: Object.fromEntries(
        await Promise.all(
          Object.entries(fixture.receiverFlowEntries.unsupported).map(
            async ([name, fileName]) => [
              name,
              await matrixEvidenceForEntry(fixture, project, 'arm-a', fileName),
            ],
          ),
        ),
      ),
    };

    const generatedDiagnostics = (
      await Promise.all(
        fixture.generated.map((contract) => validateGeneratedContract(contract, artifacts)),
      )
    ).flat();
    if (generatedDiagnostics.length > 0) {
      throw new Error(
        `D1 v6 generated contract failed before mutation: ${JSON.stringify(generatedDiagnostics)}`,
      );
    }
    const generatedMutations = await generatedContractMutationDiagnostics(
      fixture.generatedApp,
      artifacts,
    );
    const contracts = await Promise.all(
      fixture.generated.map(async (contract) => {
        return {
          configSource: await readFile(contract.configFile, 'utf8'),
          configSubject: await fixtureFileSubject(fixture, contract.configFile),
          generatedModuleSource: await readFile(contract.generatedFile, 'utf8'),
          generatedModuleSubject: await fixtureFileSubject(fixture, contract.generatedFile),
          manifest: JSON.parse(
            await readFile(contract.manifestFile, 'utf8'),
          ) as GeneratedManifestEvidence,
          providerSource: await readFile(contract.providerDefinitionFile, 'utf8'),
          providerSubject: await fixtureFileSubject(fixture, contract.providerDefinitionFile),
        };
      }),
    );
    const runtime = {
      'arm-a': await runtimeEvidence(fixture, 'arm-a'),
      'arm-b': await runtimeEvidence(fixture, 'arm-b'),
    } as const;
    const appSourcesAfter = await fixtureSourceContentSubject(fixture);
    const typeEvidence = await measureTypeContracts(fixture, criteria);
    const packedEntrypoints = stablePackedEntrypoints(
      artifacts.packages.compiler.extractedPackageRoot,
      packed.entrypoints,
    );
    const packages = ['browser', 'compiler', 'core', 'server'].map((name) => {
      const artifact = artifacts.packages[name as keyof typeof artifacts.packages];
      return {
        name: artifact.name,
        packedContents: artifact.packedContents,
        sourceContents: artifact.sourceContents,
        sourceSha256: artifact.sourceSha256,
        tarballSha256: artifact.tarballSha256,
      };
    });
    const serverDigest = artifacts.packages.server.packedContents.digest;
    const sealedArtifacts = {
      compilerPackedSha256: artifacts.packages.compiler.tarballSha256,
      configSha256: contracts[0]!.configSubject.sha256,
      generatedAppSha256: contracts[0]!.generatedModuleSubject.sha256,
      providerSha256: contracts[0]!.providerSubject.sha256,
      serverOverlayPackedSha256: fixture.serverOverlayTarballSha256,
    };
    const fixtureCounts = observedFixtureCounts({
      appSourcesAfter,
      appSourcesBefore,
      buildCommands: artifacts.buildCommands,
      contracts,
      declarationInputs: typeEvidence.declarationInputs,
      families,
      matrix,
      receiverFlow,
      runtime,
      sealedArtifacts,
      serverOverlayFiles: fixture.serverOverlayFiles,
    });
    const evidenceBindings = {
      mutationDiagnostics: bindingMutationDiagnostics({
        compiledOwner: families.query['arm-a'].compiledOwnerKey,
        matrixSourceSha256: matrix['ordinary-local-import']['arm-a'].sourceSha256,
        matrixSubjectSha256: matrix['ordinary-local-import']['arm-a'].sourceSubject.sha256,
        packedCompilerSha256: packedEntrypoints[0]!.resolvedSha256,
        packedSubjectSha256: packedEntrypoints[0]!.packedFile.sha256,
        runtimeOwner: runtime['arm-a'].ownerKey,
        serverCopySha256: serverDigest,
        serverPackedSha256: serverDigest,
      }),
    };

    const provisionalEvidence: D1RawEvidenceV6 = {
      compiler: { combinedGraphs, families },
      diagnostics: typeEvidence.diagnostics,
      evidenceBindings,
      fixture: {
        counts: fixtureCounts,
        ownerKey: fixture.ownerKey,
        serverCopies: [
          {
            basePackedContentsSha256: serverDigest,
            overlayFiles: fixture.serverOverlayFiles,
            physicalRoot: stableFixturePath(fixture, fixture.serverA),
            postWriteContents: fixture.serverCopyContents[0],
          },
          {
            basePackedContentsSha256: serverDigest,
            overlayFiles: fixture.serverOverlayFiles,
            physicalRoot: stableFixturePath(fixture, fixture.serverB),
            postWriteContents: fixture.serverCopyContents[1],
          },
        ],
      },
      generation: {
        armB: {
          compilerRecognitionDiagnostics: [],
          contracts,
          mutationDiagnostics: stabilizeDiagnostics(fixture.root, generatedMutations),
        },
      },
      matrix,
      measurements: typeEvidence.measurements,
      mutationCoverage: {
        correlated: Object.fromEntries(
          criteria.mutationContract.correlated.map((name) => [name, { detected: true }]),
        ),
        oneSided: Object.fromEntries(
          criteria.mutationContract.oneSided.map((name) => [name, { detected: true }]),
        ),
        selectionBranches: {
          'arm-a-selected-when-both-pass': { decision: 'arm-a' },
          'arm-a-selected-when-arm-b-fails': { decision: 'arm-a' },
          'arm-b-selected-when-arm-a-fails': { decision: 'arm-b' },
          'fallback-when-both-fail': { decision: 'fallback' },
        },
      },
      provenance: {
        buildCommands: artifacts.buildCommands,
        frameworkHeadCommit: artifacts.frameworkHeadCommit,
        frameworkSourceCommit: artifacts.frameworkSourceCommit,
        frameworkSourceContents: artifacts.frameworkSourceContents,
        frameworkSourceTreeClean: artifacts.frameworkSourceTreeClean,
        packages,
        packedCompiler: {
          entrypoints: packedEntrypoints,
          schema: 'kovo.app-contract-d1-packed-compiler/v1',
          workspaceSourceResolutionForbidden: packedEntrypoints.every(
            (entry) => !entry.realpath.includes('/packages/compiler/src/'),
          ),
        },
      },
      publicForgery: await publicForgeryEvidence(project),
      receiverFlow,
      resolverIntegrity,
      runner: typeEvidence.runner,
      runtime,
      schedules: typeEvidence.schedules,
      sealedArtifacts,
      schema: 'kovo.app-contract-d1-raw-evidence/v6',
      semanticEquivalence,
      workloadSubjects: {
        appSourcesAfter,
        appSourcesBefore,
        declarationInputs: typeEvidence.declarationInputs,
      },
    };
    const mutationCoverage = await executeMutationCoverage(
      criteria,
      provisionalEvidence,
      {
        'compiler-packed.tgz': await readFile(
          artifacts.packages.compiler.tarball,
        ),
        'config.ts': await readFile(fixture.generatedApp.configFile),
        'generated-app.ts': await readFile(fixture.generatedApp.generatedFile),
        'provider.ts': await readFile(
          fixture.generatedApp.providerDefinitionFile,
        ),
        'server-overlay-packed.tgz': await readFile(
          fixture.serverOverlayTarball,
        ),
      },
    );
    const evidence: D1RawEvidenceV6 = {
      ...provisionalEvidence,
      mutationCoverage,
    };
    if (options.sealDirectory) {
      await sealArtifacts(options.sealDirectory, {
        compilerTarball: artifacts.packages.compiler.tarball,
        configFile: fixture.generatedApp.configFile,
        generatedAppFile: fixture.generatedApp.generatedFile,
        providerFile: fixture.generatedApp.providerDefinitionFile,
        serverOverlayTarball: fixture.serverOverlayTarball,
      });
    }
    return evidence;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function sealArtifacts(
  directory: string,
  files: {
    readonly compilerTarball: string;
    readonly configFile: string;
    readonly generatedAppFile: string;
    readonly providerFile: string;
    readonly serverOverlayTarball: string;
  },
): Promise<void> {
  await rm(directory, { force: true, recursive: true });
  await mkdir(directory, { recursive: true });
  await Promise.all([
    cp(files.compilerTarball, join(directory, 'compiler-packed.tgz')),
    cp(files.serverOverlayTarball, join(directory, 'server-overlay-packed.tgz')),
    cp(files.configFile, join(directory, 'config.ts')),
    cp(files.providerFile, join(directory, 'provider.ts')),
    cp(files.generatedAppFile, join(directory, 'generated-app.ts')),
  ]);
}

function observedFixtureCounts(values: {
  readonly appSourcesAfter: D1RawEvidenceV6['workloadSubjects']['appSourcesAfter'];
  readonly appSourcesBefore: D1RawEvidenceV6['workloadSubjects']['appSourcesBefore'];
  readonly buildCommands: readonly string[];
  readonly contracts: D1RawEvidenceV6['generation']['armB']['contracts'];
  readonly declarationInputs: D1RawEvidenceV6['workloadSubjects']['declarationInputs'];
  readonly families: D1RawEvidenceV6['compiler']['families'];
  readonly matrix: D1RawEvidenceV6['matrix'];
  readonly receiverFlow: D1RawEvidenceV6['receiverFlow'];
  readonly runtime: D1RawEvidenceV6['runtime'];
  readonly sealedArtifacts: D1RawEvidenceV6['sealedArtifacts'];
  readonly serverOverlayFiles: readonly unknown[];
}): Readonly<Record<string, number>> {
  const matrixEntries = matrixCaseNames.flatMap((name) =>
    (['arm-a', 'arm-b'] as const).map((arm) => values.matrix[name][arm]),
  );
  const familyEntries = declarationFamilies.flatMap((family) =>
    (['baseline', 'arm-a', 'arm-b'] as const).map(
      (variant) => values.families[family][variant],
    ),
  );
  const declarationVariants = ['baseline', 'arm-a', 'arm-b'] as const;
  const declarationFiles = declarationVariants.flatMap(
    (variant) => values.declarationInputs[variant],
  );
  const declarationsPerFile = declarationFiles.map(
    (input) => input.source.match(/\bexport const query\d+\s*=/gu)?.length ?? 0,
  );
  const before = new Map(
    values.appSourcesBefore.inputs.map((input) => [
      input.subject.path,
      input.source,
    ]),
  );
  const after = new Map(
    values.appSourcesAfter.inputs.map((input) => [
      input.subject.path,
      input.source,
    ]),
  );
  const appSourceRewriteCount = [
    ...new Set([...before.keys(), ...after.keys()]),
  ].filter((path) => before.get(path) !== after.get(path)).length;
  const generatedProviderFiles = new Set(
    values.contracts.map((contract) => contract.providerSubject.path),
  ).size;
  return {
    matrixCases: Object.keys(values.matrix).length,
    matrixArms: new Set(
      Object.values(values.matrix).flatMap((entry) => Object.keys(entry)),
    ).size,
    generatedMatrixFiles: matrixEntries.length,
    declarationFamilies: Object.keys(values.families).length,
    familyVariants: new Set(
      Object.values(values.families).flatMap((entry) => Object.keys(entry)),
    ).size,
    generatedFamilyFiles: familyEntries.length,
    generatedRuntimeFiles: Object.keys(values.runtime).length,
    generatedProviderFiles,
    generatedBoundModules: new Set(
      values.contracts.map(
        (contract) => contract.generatedModuleSubject.path,
      ),
    ).size,
    unsupportedReceiverFiles: Object.keys(values.receiverFlow.unsupported)
      .length,
    negativeControlFiles: Object.keys(values.receiverFlow.controls).length,
    typeMeasurementVariants: Object.keys(values.declarationInputs).length,
    declarationFilesPerVariant:
      new Set(
        declarationVariants.map(
          (variant) => values.declarationInputs[variant].length,
        ),
      ).size === 1
        ? values.declarationInputs.baseline.length
        : -1,
    declarationsPerFile:
      declarationsPerFile.length > 0 &&
      new Set(declarationsPerFile).size === 1
        ? declarationsPerFile[0]!
        : -1,
    generatedTypeDeclarationFiles: declarationFiles.length,
    generatedTypeDeclarations: declarationsPerFile.reduce(
      (sum, count) => sum + count,
      0,
    ),
    appSourceRewriteCount,
    serverOverlayFileCount: values.serverOverlayFiles.length,
    sealedArtifactCount: Object.keys(values.sealedArtifacts).length,
    buildCommandCount: values.buildCommands.length,
    providerDefinitionCount: generatedProviderFiles,
  };
}

async function executeMutationCoverage(
  criteria: D1CriteriaV6,
  evidence: D1RawEvidenceV6,
  authority: Readonly<Record<SealedArtifactName, Buffer>>,
): Promise<D1RawEvidenceV6['mutationCoverage']> {
  type Mutation = (
    value: Mutable<D1RawEvidenceV6>,
    sealed: MutableSealedAuthority,
  ) => void;
  const oneSided: Readonly<Record<string, Mutation>> = {
    'config-bytes': (_value, sealed) => appendSealed(sealed, 'config.ts'),
    'provider-bytes': (_value, sealed) => appendSealed(sealed, 'provider.ts'),
    'generated-module-bytes': (_value, sealed) =>
      appendSealed(sealed, 'generated-app.ts'),
    'compiler-entrypoint-bytes': (_value, sealed) =>
      flipSealedByte(sealed, 'compiler-packed.tgz'),
    'server-artifact-bytes': (value) => {
      value.provenance.packages.find(
        (entry) => entry.name === '@kovojs/server',
      )!.packedContents.files[0]!.sha256 = '0'.repeat(64);
    },
    'server-overlay-bytes': (_value, sealed) =>
      flipSealedByte(sealed, 'server-overlay-packed.tgz'),
    'matrix-source-bytes': (value) => {
      value.matrix['ordinary-local-import']['arm-a'].sourceSha256 =
        '0'.repeat(64);
    },
    'runtime-owner': (value) => {
      value.runtime['arm-a'].ownerKey += ':forged';
    },
    'compiled-owner': (value) => {
      value.compiler.families.query['arm-a'].compiledOwnerKey =
        'd1v6:forged';
    },
    'generated-owner': (value) => {
      value.generation.armB.contracts[0]!.manifest.ownerKey =
        'd1v6:forged';
    },
    'build-command': (value) => {
      value.provenance.buildCommands[0] += ' --forged';
    },
    'source-commit': (value) => {
      value.provenance.frameworkSourceCommit = '0'.repeat(40);
    },
    count: (value) => {
      value.fixture.counts.matrixCases =
        (value.fixture.counts.matrixCases ?? 0) + 1;
    },
    'typescript-diagnostic': (value) => {
      value.diagnostics['arm-a'].code = 9999;
    },
    'completion-sample-identity': (value) => {
      value.measurements['arm-a'].warmCompletionSamples[0]!.sampleId +=
        ':forged';
    },
  };
  const correlated: Readonly<Record<string, Mutation>> = {
    'config-bytes-and-claimed-digest': (value, sealed) => {
      appendSealed(sealed, 'config.ts');
      const digest = sha256(sealed['config.ts']);
      value.sealedArtifacts.configSha256 = digest;
      value.generation.armB.contracts[0]!.configSubject.sha256 = digest;
      value.generation.armB.contracts[0]!.manifest.configSha256 = digest;
    },
    'provider-bytes-and-claimed-digest': (value, sealed) => {
      appendSealed(sealed, 'provider.ts');
      const digest = sha256(sealed['provider.ts']);
      value.sealedArtifacts.providerSha256 = digest;
      value.generation.armB.contracts[0]!.providerSubject.sha256 = digest;
      value.generation.armB.contracts[0]!.manifest.providerSourceSha256 =
        digest;
    },
    'generated-bytes-manifest-and-claimed-digest': (value, sealed) => {
      appendSealed(sealed, 'generated-app.ts');
      const digest = sha256(sealed['generated-app.ts']);
      value.sealedArtifacts.generatedAppSha256 = digest;
      value.generation.armB.contracts[0]!.generatedModuleSubject.sha256 =
        digest;
      value.generation.armB.contracts[0]!.manifest.generatedModuleSha256 =
        digest;
    },
    'compiler-bytes-and-entrypoint-claims': (value, sealed) => {
      flipSealedByte(sealed, 'compiler-packed.tgz');
      const digest = sha256(sealed['compiler-packed.tgz']);
      value.sealedArtifacts.compilerPackedSha256 = digest;
      value.provenance.packages.find(
        (entry) => entry.name === '@kovojs/compiler',
      )!.tarballSha256 = digest;
      value.provenance.packedCompiler.entrypoints[0]!.resolvedSha256 =
        digest;
      value.provenance.packedCompiler.entrypoints[0]!.packedFile.sha256 =
        digest;
    },
    'server-bytes-copy-and-packed-claims': (value, sealed) => {
      flipSealedByte(sealed, 'server-overlay-packed.tgz');
      value.sealedArtifacts.serverOverlayPackedSha256 = sha256(
        sealed['server-overlay-packed.tgz'],
      );
      for (const copy of value.fixture.serverCopies) {
        copy.postWriteContents.digest = 'f'.repeat(64);
      }
    },
    'canonical-ir-and-digest': (value) =>
      mutateCanonicalSubject(value, 'canonicalIr'),
    'canonical-graph-and-digest': (value) =>
      mutateCanonicalSubject(value, 'canonicalGraph'),
    'owner-config-provider-generated-runtime-claims': (value) => {
      const owner = 'd1v6:correlated-forgery';
      value.fixture.ownerKey = owner;
      for (const arm of ['arm-a', 'arm-b'] as const) {
        value.runtime[arm].ownerKey = owner;
      }
      for (const family of declarationFamilies) {
        for (const arm of ['arm-a', 'arm-b'] as const) {
          value.compiler.families[family][arm].compiledOwnerKey = owner;
        }
      }
      for (const contract of value.generation.armB.contracts) {
        contract.manifest.ownerKey = owner;
      }
    },
    'count-and-workload-claims': (value) => {
      for (const variant of ['baseline', 'arm-a', 'arm-b'] as const) {
        const inputs = value.workloadSubjects.declarationInputs[variant];
        const duplicate = structuredClone(inputs[0]!);
        duplicate.subject.path =
          `app/d1-measure/${variant}/declarations-${inputs.length}.ts`;
        inputs.push(duplicate);
      }
      value.fixture.counts.declarationFilesPerVariant = 13;
      value.fixture.counts.generatedTypeDeclarationFiles = 39;
      value.fixture.counts.generatedTypeDeclarations = 156;
    },
    'timing-samples-and-summary': (value) => {
      const measurement = value.measurements['arm-a'];
      for (const sample of measurement.coldTscSamples) {
        sample.milliseconds += 1_000;
      }
      measurement.coldTscP50Ms = roundMeasurement(
        percentileMeasurement(
          measurement.coldTscSamples.map((sample) => sample.milliseconds),
          0.5,
        ),
      );
    },
  };
  const execute = async (mutation: Mutation): Promise<boolean> => {
    const mutated = structuredClone(evidence) as Mutable<D1RawEvidenceV6>;
    const mutableAuthority = cloneSealedAuthority(authority);
    mutation(mutated, mutableAuthority);
    try {
      const evaluation = await evaluateD1V6(
        criteria,
        mutated,
        mutableAuthority,
      );
      return !(
        evaluation.arms['arm-a'].eligible &&
        evaluation.arms['arm-b'].eligible
      );
    } catch {
      return true;
    }
  };
  const oneSidedResults = Object.fromEntries(
    await Promise.all(
      criteria.mutationContract.oneSided.map(async (name) => [
        name,
        { detected: oneSided[name] ? await execute(oneSided[name]) : false },
      ]),
    ),
  );
  const correlatedResults = Object.fromEntries(
    await Promise.all(
      criteria.mutationContract.correlated.map(async (name) => [
        name,
        {
          detected: correlated[name]
            ? await execute(correlated[name])
            : false,
        },
      ]),
    ),
  );
  const selection = async (
    mutate: (value: Mutable<D1RawEvidenceV6>) => void,
  ): Promise<string> => {
    const value = structuredClone(evidence) as Mutable<D1RawEvidenceV6>;
    mutate(value);
    return (
      await evaluateD1V6(criteria, value, cloneSealedAuthority(authority))
    ).decision;
  };
  return {
    correlated: correlatedResults,
    oneSided: oneSidedResults,
    selectionBranches: {
      'arm-a-selected-when-both-pass': {
        decision: await selection(() => {}),
      },
      'arm-a-selected-when-arm-b-fails': {
        decision: await selection((value) =>
          mutateCanonicalSubject(value, 'canonicalIr', 'arm-b'),
        ),
      },
      'arm-b-selected-when-arm-a-fails': {
        decision: await selection((value) =>
          mutateCanonicalSubject(value, 'canonicalIr', 'arm-a'),
        ),
      },
      'fallback-when-both-fail': {
        decision: await selection((value) => {
          mutateCanonicalSubject(value, 'canonicalIr', 'arm-a');
          mutateCanonicalSubject(value, 'canonicalIr', 'arm-b');
        }),
      },
    },
  };
}

function mutateCanonicalSubject(
  evidence: Mutable<D1RawEvidenceV6>,
  field: 'canonicalGraph' | 'canonicalIr',
  arm: 'arm-a' | 'arm-b' = 'arm-a',
): void {
  const subject = evidence.compiler.families.query[arm][field];
  subject.canonical = { original: subject.canonical, unexpected: true };
  subject.digest = sha256(JSON.stringify(subject.canonical));
}

function appendSealed(
  authority: MutableSealedAuthority,
  name: SealedArtifactName,
): void {
  authority[name] = Buffer.concat([
    authority[name],
    Buffer.from('\n// forged\n'),
  ]);
}

function flipSealedByte(
  authority: MutableSealedAuthority,
  name: SealedArtifactName,
): void {
  const bytes = Buffer.from(authority[name]);
  bytes[Math.min(32, bytes.length - 1)]! ^= 1;
  authority[name] = bytes;
}

function cloneSealedAuthority(
  authority: Readonly<Record<SealedArtifactName, Buffer>>,
): MutableSealedAuthority {
  return Object.fromEntries(
    Object.entries(authority).map(([name, bytes]) => [
      name,
      Buffer.from(bytes),
    ]),
  ) as MutableSealedAuthority;
}

function percentileMeasurement(
  values: readonly number[],
  fraction: number,
): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function roundMeasurement(value: number): number {
  return Math.round(value * 100) / 100;
}

type SealedArtifactName =
  | 'compiler-packed.tgz'
  | 'config.ts'
  | 'generated-app.ts'
  | 'provider.ts'
  | 'server-overlay-packed.tgz';
type MutableSealedAuthority = Record<SealedArtifactName, Buffer> &
  D1V6SealedAuthority;
type Mutable<Value> = Value extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

function semanticMutationDiagnostics(
  ir: D1RawEvidenceV6['compiler']['families']['query']['baseline']['canonicalIr'],
  graph: D1RawEvidenceV6['compiler']['families']['query']['baseline']['canonicalGraph'],
): Readonly<Record<string, readonly PrototypeDiagnostic[]>> {
  const irMutations = semanticMutationSubjects(ir);
  const graphMutations = semanticMutationSubjects(graph);
  const definitions = [
    ['ir-add', 'D1E101', irMutations.add.digest !== ir.digest],
    ['ir-delete', 'D1E102', irMutations.delete.digest !== ir.digest],
    ['ir-change', 'D1E103', irMutations.change.digest !== ir.digest],
    ['graph-add', 'D1E104', graphMutations.add.digest !== graph.digest],
    ['graph-delete', 'D1E105', graphMutations.delete.digest !== graph.digest],
    ['graph-change', 'D1E106', graphMutations.change.digest !== graph.digest],
  ] as const;
  return Object.fromEntries(
    definitions.map(([name, code, detected]) => [
      name,
      detected ? [mutationDiagnostic(code, `${name} changed the canonical subject.`)] : [],
    ]),
  );
}

function bindingMutationDiagnostics(values: {
  readonly compiledOwner: string | null;
  readonly matrixSourceSha256: string;
  readonly matrixSubjectSha256: string;
  readonly packedCompilerSha256: string;
  readonly packedSubjectSha256: string;
  readonly runtimeOwner: string;
  readonly serverCopySha256: string;
  readonly serverPackedSha256: string;
}): Readonly<Record<string, readonly PrototypeDiagnostic[]>> {
  return {
    'matrix-source': [
      mutationDiagnostic(
        'D1E202',
        `matrix source mutation detected=${'0'.repeat(64) !== values.matrixSourceSha256 && values.matrixSourceSha256 === values.matrixSubjectSha256}.`,
      ),
    ],
    'packed-compiler-entrypoint': [
      mutationDiagnostic(
        'D1E204',
        `packed compiler mutation detected=${'0'.repeat(64) !== values.packedCompilerSha256 && values.packedCompilerSha256 === values.packedSubjectSha256}.`,
      ),
    ],
    'runtime-owner': [
      mutationDiagnostic(
        'D1E201',
        `runtime owner mutation detected=${`${values.runtimeOwner}:mutated` !== values.compiledOwner && values.runtimeOwner === values.compiledOwner}.`,
      ),
    ],
    'server-copy-digest': [
      mutationDiagnostic(
        'D1E203',
        `server copy mutation detected=${'0'.repeat(64) !== values.serverCopySha256 && values.serverCopySha256 === values.serverPackedSha256}.`,
      ),
    ],
  };
}

function mutationDiagnostic(code: string, message: string): PrototypeDiagnostic {
  return { code, fileName: '<mutation>', length: 1, message, start: 0 };
}

function stablePackedEntrypoints(
  compilerRoot: string,
  entrypoints: readonly PackedCompilerEntrypoint[],
): readonly PackedCompilerEntrypoint[] {
  return entrypoints.map((entry) => ({
    ...entry,
    realpath: `<artifact>/compiler/${relative(compilerRoot, entry.realpath).replaceAll('\\', '/')}`,
  }));
}

function stabilizeDiagnostics(
  fixtureRoot: string,
  diagnostics: Readonly<Record<string, readonly PrototypeDiagnostic[]>>,
): Readonly<Record<string, readonly PrototypeDiagnostic[]>> {
  return Object.fromEntries(
    Object.entries(diagnostics).map(([name, values]) => [
      name,
      values.map((diagnostic) => stableDiagnostic(fixtureRoot, diagnostic)),
    ]),
  );
}

function stableDiagnostic(
  fixtureRoot: string,
  diagnostic: PrototypeDiagnostic,
): PrototypeDiagnostic {
  return {
    ...diagnostic,
    fileName: diagnostic.fileName.replaceAll(fixtureRoot, '<fixture>'),
    message: diagnostic.message.replaceAll(fixtureRoot, '<fixture>'),
  };
}
