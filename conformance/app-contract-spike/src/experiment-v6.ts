import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import {
  buildAndPackFresh,
  loadAuthenticatedPackedCompiler,
  sha256,
  type PackedCompilerEntrypoint,
} from './artifacts-v6.ts';
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
  matrixEvidenceForEntry,
  publicForgeryEvidence,
  semanticMutationSubjects,
} from './project-v6.ts';
import { runtimeEvidence } from './runtime-v6.ts';
import { measureTypeContracts } from './type-measurement-v6.ts';
import type { D1CriteriaV6, D1RawEvidenceV6, GeneratedManifestEvidence } from './types-v6.ts';

export async function runD1V6Experiment(criteria: D1CriteriaV6): Promise<D1RawEvidenceV6> {
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
      mutationDiagnostics: semanticMutationDiagnostics(
        families.query.baseline.canonicalIr,
        families.query.baseline.canonicalGraph,
      ),
    };
    const nestedAppDerived = await matrixEvidenceForEntry(
      fixture,
      project,
      'arm-a',
      fixture.nestedFlowProbe,
    );
    const unrelatedSameNamedMember = await matrixEvidenceForEntry(
      fixture,
      project,
      'arm-a',
      fixture.unrelatedMemberProbe,
    );

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
          configSubject: await fixtureFileSubject(fixture, contract.configFile),
          generatedModuleSubject: await fixtureFileSubject(fixture, contract.generatedFile),
          manifest: JSON.parse(
            await readFile(contract.manifestFile, 'utf8'),
          ) as GeneratedManifestEvidence,
          providerSubject: await fixtureFileSubject(fixture, contract.providerFile),
        };
      }),
    );
    const runtime = {
      'arm-a': await runtimeEvidence(fixture, 'arm-a'),
      'arm-b': await runtimeEvidence(fixture, 'arm-b'),
    } as const;
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
      };
    });
    const serverDigest = artifacts.packages.server.packedContents.digest;
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

    return {
      compiler: { combinedGraphs, families },
      diagnostics: typeEvidence.diagnostics,
      evidenceBindings,
      fixture: {
        counts: {
          declarationFamilies: declarationFamilies.length,
          familyVariants: declarationFamilies.length * 3,
          generatedBoundModules: fixture.generated.length,
          generatedFamilyFiles: declarationFamilies.length * 3,
          generatedMatrixFiles: matrixCaseNames.length * 2,
          generatedProviderFiles: 2,
          generatedRuntimeFiles: 2,
          generatedTypeDeclarationFiles: criteria.workload.declarationFilesPerVariant * 3,
          generatedTypeDeclarations:
            criteria.workload.declarationFilesPerVariant *
            criteria.workload.declarationsPerFile *
            3,
          matrixCases: matrixCaseNames.length,
          providerDefinitionCount: 2,
          sourceRewriteCount: 0,
        },
        ownerKey: fixture.ownerKey,
        serverCopies: [
          {
            basePackedContentsSha256: serverDigest,
            physicalRoot: stableFixturePath(fixture, fixture.serverA),
          },
          {
            basePackedContentsSha256: serverDigest,
            physicalRoot: stableFixturePath(fixture, fixture.serverB),
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
      receiverFlow: { nestedAppDerived, unrelatedSameNamedMember },
      resolverIntegrity,
      runner: typeEvidence.runner,
      runtime,
      schedules: typeEvidence.schedules,
      schema: 'kovo.app-contract-d1-raw-evidence/v6',
      semanticEquivalence,
    };
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

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
