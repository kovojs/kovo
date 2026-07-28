import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { sha256 } from './artifacts-v6.ts';
import {
  assertD1V6EvaluationShape,
  evaluateD1V6,
  type D1V6SealedAuthority,
} from './evaluator-v6.ts';
import { declarationFamilies, matrixCaseNames } from './fixture-v6.ts';
import { semanticCollisionEvidence } from './project-v6.ts';
import type { D1CriteriaV6, D1EvaluationV6, D1RawEvidenceV6 } from './types-v6.ts';

const artifactNames = [
  'compiler-packed.tgz',
  'server-overlay-packed.tgz',
  'config.ts',
  'provider.ts',
  'generated-app.ts',
] as const;

describe('D1 v6 authenticated app-contract evaluator', () => {
  let criteria: D1CriteriaV6;
  let evidence: D1RawEvidenceV6;
  let committed: D1EvaluationV6;
  let sealed: Record<(typeof artifactNames)[number], Buffer>;

  beforeAll(async () => {
    [criteria, evidence, committed] = await Promise.all([
      readJson<D1CriteriaV6>(new URL('../criteria-v6.json', import.meta.url)),
      readJson<D1RawEvidenceV6>(new URL('../raw-evidence-v6.json', import.meta.url)),
      readJson<D1EvaluationV6>(new URL('../results-v6.json', import.meta.url)),
    ]);
    sealed = Object.fromEntries(
      await Promise.all(
        artifactNames.map(async (name) => [
          name,
          await readFile(new URL(`../sealed-v6/${name}`, import.meta.url)),
        ]),
      ),
    ) as Record<(typeof artifactNames)[number], Buffer>;
  });

  it('recomputes both eligible arms, prefers Arm A, and keeps D1 open after invalidating v1-v5', async () => {
    const evaluated = await evaluateD1V6(criteria, evidence);
    expect(evaluated).toEqual(committed);
    expect(evaluated).toMatchObject({
      criteria: 'kovo.app-contract-d1-criteria/v6',
      decision: 'arm-a',
      priorEvidenceDisposition: {
        v1: 'invalidated',
        v2: 'invalidated',
        v3: 'invalidated',
        v4: 'invalidated',
        v5: 'invalidated',
      },
      schema: 'kovo.app-contract-d1-evaluation/v6',
    });
    expect(evaluated.arms['arm-a'].eligible).toBe(true);
    expect(evaluated.arms['arm-b'].eligible).toBe(true);
  });

  it('binds exact workload counts, generated factories, receiver flows, copies, and sealed bytes', () => {
    expect(Object.keys(evidence.matrix).sort()).toEqual([...matrixCaseNames].sort());
    expect(Object.keys(evidence.compiler.families).sort()).toEqual([...declarationFamilies].sort());
    expect(evidence.fixture.counts).toEqual({
      ...criteria.workload,
      providerDefinitionCount: criteria.semanticThresholds.providerDefinitionCountExact,
    });
    expect(Object.keys(evidence.receiverFlow.unsupported).sort()).toEqual(
      Object.keys(criteria.receiverFlowContract.unsupported).sort(),
    );
    expect(Object.keys(evidence.receiverFlow.controls).sort()).toEqual(
      [...criteria.receiverFlowContract.negativeControls].sort(),
    );
    expect(
      Object.values(evidence.receiverFlow.unsupported).map((entry) =>
        entry.diagnostics.map((diagnostic) => diagnostic.code),
      ),
    ).toHaveLength(12);
    expect(evidence.fixture.serverCopies).toHaveLength(2);
    expect(evidence.fixture.serverCopies[0]!.postWriteContents).toEqual(
      evidence.fixture.serverCopies[1]!.postWriteContents,
    );
    expect(evidence.generation.armB.compilerRecognitionDiagnostics).toEqual([]);
    expect(evidence.provenance.buildCommands).toEqual(criteria.buildCommands);
    expect(Object.keys(evidence.sealedArtifacts)).toHaveLength(5);
  });

  it('canonicalizes only exact imported factory callees and preserves all six collisions byte-for-byte', () => {
    const collisions = semanticCollisionEvidence();
    expect(Object.keys(collisions).sort()).toEqual(
      [...criteria.semanticEquivalenceContract.collisionFixtures].sort(),
    );
    for (const collision of Object.values(collisions)) {
      expect(collision.byteExact).toBe(true);
      expect(collision.canonicalSha256).toBe(collision.originalSha256);
    }
    expect(collisions).toEqual(evidence.semanticEquivalence.collisionSubjects);
  });

  it.each(oneSidedMutations())('rejects one-sided mutation %s', async (name, mutate) => {
    expect(criteria.mutationContract.oneSided).toContain(name);
    const mutated = clone(evidence);
    const authority = cloneAuthority(sealed);
    mutate(mutated, authority);
    await expectMutationDetected(mutated, authority);
  });

  it.each(correlatedMutations())('rejects correlated mutation %s', async (name, mutate) => {
    expect(criteria.mutationContract.correlated).toContain(name);
    const mutated = clone(evidence);
    const authority = cloneAuthority(sealed);
    mutate(mutated, authority);
    await expectMutationDetected(mutated, authority);
  });

  it('executes all four real selection branches', async () => {
    const both = await evaluateD1V6(criteria, evidence);
    expect({
      decision: both.decision,
      eligibleA: both.arms['arm-a'].eligible,
      eligibleB: both.arms['arm-b'].eligible,
    }).toEqual({ decision: 'arm-a', eligibleA: true, eligibleB: true });

    const aFails = clone(evidence);
    mutateSemantic(aFails, 'arm-a', 'canonicalIr');
    const selectB = await evaluateD1V6(criteria, aFails);
    expect(selectB.decision).toBe('arm-b');
    expect(selectB.arms['arm-b'].eligible).toBe(true);

    const bFails = clone(evidence);
    mutateSemantic(bFails, 'arm-b', 'canonicalIr');
    const selectA = await evaluateD1V6(criteria, bFails);
    expect(selectA.decision).toBe('arm-a');
    expect(selectA.arms['arm-a'].eligible).toBe(true);

    const neither = clone(evidence);
    mutateSemantic(neither, 'arm-a', 'canonicalIr');
    mutateSemantic(neither, 'arm-b', 'canonicalIr');
    expect((await evaluateD1V6(criteria, neither)).decision).toBe('fallback');
  });

  it('rejects surplus keys at every declared raw-evidence schema kind', async () => {
    for (const [name, mutate] of surplusRawMutations()) {
      const mutated = clone(evidence);
      mutate(mutated);
      await expect(
        evaluateD1V6(criteria, mutated),
        `surplus schema node ${name}`,
      ).rejects.toThrow('keys differ');
    }
  });

  it('rejects surplus criteria and result keys through immutable/deep-exact authority', async () => {
    const criteriaMutations: Array<(value: Mutable<D1CriteriaV6>) => void> = [
      (value) => addSurplus(value),
      (value) => addSurplus(value.artifactContract),
      (value) => addSurplus(value.matrix['ordinary-local-import']),
      (value) => addSurplus(value.performanceThresholds),
      (value) => addSurplus(value.workload),
    ];
    for (const mutate of criteriaMutations) {
      const value = clone(criteria);
      mutate(value);
      await expect(evaluateD1V6(value, evidence)).rejects.toThrow('criteria bytes');
    }

    const resultMutations: Array<(value: Mutable<D1EvaluationV6>) => void> = [
      (value) => addSurplus(value),
      (value) => addSurplus(value.arms),
      (value) => addSurplus(value.arms['arm-a']),
      (value) => addSurplus(value.arms['arm-a'].gates),
      (value) => addSurplus(value.arms['arm-a'].gates.artifacts),
      (value) => addSurplus(value.priorEvidenceDisposition),
    ];
    for (const mutate of resultMutations) {
      const value = clone(committed);
      mutate(value);
      expect(() => assertD1V6EvaluationShape(value)).toThrow('keys differ');
    }
  });

  it('contains no synthetic D1B201 path and records exact mutation coverage', async () => {
    const sources = await Promise.all(
      [
        './evaluator-v6.ts',
        './experiment-v6.ts',
        './fixture-v6.ts',
        './project-v6.ts',
      ].map((name) => readFile(new URL(name, import.meta.url), 'utf8')),
    );
    expect(sources.join('\n')).not.toContain('D1B201');
    expect(Object.keys(evidence.mutationCoverage.oneSided).sort()).toEqual(
      [...criteria.mutationContract.oneSided].sort(),
    );
    expect(Object.keys(evidence.mutationCoverage.correlated).sort()).toEqual(
      [...criteria.mutationContract.correlated].sort(),
    );
    expect(Object.keys(evidence.mutationCoverage.selectionBranches).sort()).toEqual(
      [...criteria.mutationContract.selectionBranchesRequired].sort(),
    );
  });

  async function expectMutationDetected(
    mutated: Mutable<D1RawEvidenceV6>,
    authority: D1V6SealedAuthority,
  ): Promise<void> {
    try {
      const evaluated = await evaluateD1V6(criteria, mutated, authority);
      expect(
        evaluated.arms['arm-a'].eligible && evaluated.arms['arm-b'].eligible,
      ).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  }
});

function oneSidedMutations(): Array<
  readonly [
    string,
    (evidence: Mutable<D1RawEvidenceV6>, authority: MutableAuthority) => void,
  ]
> {
  return [
    ['config-bytes', (_evidence, authority) => append(authority, 'config.ts')],
    ['provider-bytes', (_evidence, authority) => append(authority, 'provider.ts')],
    [
      'generated-module-bytes',
      (_evidence, authority) => append(authority, 'generated-app.ts'),
    ],
    [
      'compiler-entrypoint-bytes',
      (_evidence, authority) => flipByte(authority, 'compiler-packed.tgz'),
    ],
    [
      'server-artifact-bytes',
      (evidence) => {
        evidence.provenance.packages.find(
          (entry) => entry.name === '@kovojs/server',
        )!.packedContents.files[0]!.sha256 = '0'.repeat(64);
      },
    ],
    [
      'server-overlay-bytes',
      (_evidence, authority) => flipByte(authority, 'server-overlay-packed.tgz'),
    ],
    [
      'matrix-source-bytes',
      (evidence) => {
        evidence.matrix['ordinary-local-import']['arm-a'].sourceSha256 = '0'.repeat(64);
      },
    ],
    [
      'runtime-owner',
      (evidence) => {
        evidence.runtime['arm-a'].ownerKey += ':forged';
      },
    ],
    [
      'compiled-owner',
      (evidence) => {
        evidence.compiler.families.query['arm-a'].compiledOwnerKey = 'd1v6:forged';
      },
    ],
    [
      'generated-owner',
      (evidence) => {
        evidence.generation.armB.contracts[0]!.manifest.ownerKey = 'd1v6:forged';
      },
    ],
    [
      'build-command',
      (evidence) => {
        evidence.provenance.buildCommands[0] += ' --forged';
      },
    ],
    [
      'source-commit',
      (evidence) => {
        evidence.provenance.frameworkSourceCommit = '0'.repeat(40);
      },
    ],
    [
      'count',
      (evidence) => {
        evidence.fixture.counts.matrixCases =
          (evidence.fixture.counts.matrixCases ?? 0) + 1;
      },
    ],
    [
      'typescript-diagnostic',
      (evidence) => {
        evidence.diagnostics['arm-a'].code = 9999;
      },
    ],
    [
      'completion-sample-identity',
      (evidence) => {
        evidence.measurements['arm-a'].warmCompletionSamples[0]!.sampleId += ':forged';
      },
    ],
  ];
}

function correlatedMutations(): Array<
  readonly [
    string,
    (evidence: Mutable<D1RawEvidenceV6>, authority: MutableAuthority) => void,
  ]
> {
  return [
    [
      'config-bytes-and-claimed-digest',
      (evidence, authority) => {
        append(authority, 'config.ts');
        const digest = sha256(authority['config.ts']);
        evidence.sealedArtifacts.configSha256 = digest;
        evidence.generation.armB.contracts[0]!.configSubject.sha256 = digest;
        evidence.generation.armB.contracts[0]!.manifest.configSha256 = digest;
      },
    ],
    [
      'provider-bytes-and-claimed-digest',
      (evidence, authority) => {
        append(authority, 'provider.ts');
        const digest = sha256(authority['provider.ts']);
        evidence.sealedArtifacts.providerSha256 = digest;
        evidence.generation.armB.contracts[0]!.providerSubject.sha256 = digest;
        evidence.generation.armB.contracts[0]!.manifest.providerSourceSha256 = digest;
      },
    ],
    [
      'generated-bytes-manifest-and-claimed-digest',
      (evidence, authority) => {
        append(authority, 'generated-app.ts');
        const digest = sha256(authority['generated-app.ts']);
        evidence.sealedArtifacts.generatedAppSha256 = digest;
        evidence.generation.armB.contracts[0]!.generatedModuleSubject.sha256 = digest;
        evidence.generation.armB.contracts[0]!.manifest.generatedModuleSha256 = digest;
      },
    ],
    [
      'compiler-bytes-and-entrypoint-claims',
      (evidence, authority) => {
        flipByte(authority, 'compiler-packed.tgz');
        const digest = sha256(authority['compiler-packed.tgz']);
        evidence.sealedArtifacts.compilerPackedSha256 = digest;
        evidence.provenance.packages.find(
          (entry) => entry.name === '@kovojs/compiler',
        )!.tarballSha256 = digest;
        evidence.provenance.packedCompiler.entrypoints[0]!.resolvedSha256 = digest;
        evidence.provenance.packedCompiler.entrypoints[0]!.packedFile.sha256 = digest;
      },
    ],
    [
      'server-bytes-copy-and-packed-claims',
      (evidence, authority) => {
        flipByte(authority, 'server-overlay-packed.tgz');
        evidence.sealedArtifacts.serverOverlayPackedSha256 = sha256(
          authority['server-overlay-packed.tgz'],
        );
        for (const copy of evidence.fixture.serverCopies) {
          copy.postWriteContents.digest = 'f'.repeat(64);
        }
      },
    ],
    [
      'canonical-ir-and-digest',
      (evidence) => mutateSemantic(evidence, 'arm-a', 'canonicalIr'),
    ],
    [
      'canonical-graph-and-digest',
      (evidence) => mutateSemantic(evidence, 'arm-a', 'canonicalGraph'),
    ],
    [
      'owner-config-provider-generated-runtime-claims',
      (evidence) => {
        const owner = 'd1v6:correlated-forgery';
        evidence.fixture.ownerKey = owner;
        for (const arm of ['arm-a', 'arm-b'] as const) evidence.runtime[arm].ownerKey = owner;
        for (const family of declarationFamilies) {
          for (const arm of ['arm-a', 'arm-b'] as const) {
            evidence.compiler.families[family][arm].compiledOwnerKey = owner;
          }
        }
        for (const contract of evidence.generation.armB.contracts) {
          contract.manifest.ownerKey = owner;
        }
      },
    ],
    [
      'count-and-workload-claims',
      (evidence) => {
        evidence.fixture.counts.matrixCases =
          (evidence.fixture.counts.matrixCases ?? 0) + 1;
        addSurplus(evidence.matrix);
      },
    ],
    [
      'timing-samples-and-summary',
      (evidence) => {
        const measurement = evidence.measurements['arm-a'];
        for (const sample of measurement.coldTscSamples) sample.milliseconds += 1_000;
        measurement.coldTscP50Ms = percentile(
          measurement.coldTscSamples.map((sample) => sample.milliseconds),
          0.5,
        );
      },
    ],
  ];
}

function surplusRawMutations(): Array<
  readonly [string, (evidence: Mutable<D1RawEvidenceV6>) => void]
> {
  return [
    ['raw', (value) => addSurplus(value)],
    ['provenance', (value) => addSurplus(value.provenance)],
    ['package', (value) => addSurplus(value.provenance.packages[0]!)],
    ['content-subject', (value) => addSurplus(value.provenance.frameworkSourceContents)],
    ['file-subject', (value) => addSurplus(value.provenance.frameworkSourceContents.files[0]!)],
    ['packed-compiler', (value) => addSurplus(value.provenance.packedCompiler)],
    ['entrypoint', (value) => addSurplus(value.provenance.packedCompiler.entrypoints[0]!)],
    ['fixture', (value) => addSurplus(value.fixture)],
    ['counts', (value) => addSurplus(value.fixture.counts)],
    ['server-copy', (value) => addSurplus(value.fixture.serverCopies[0]!)],
    ['matrix-case', (value) => addSurplus(value.matrix['ordinary-local-import'])],
    [
      'matrix-evidence',
      (value) => addSurplus(value.matrix['ordinary-local-import']['arm-a']),
    ],
    [
      'diagnostic',
      (value) => addSurplus(value.matrix['destructured-factory']['arm-a'].diagnostics[0]!),
    ],
    ['compiler', (value) => addSurplus(value.compiler)],
    ['combined-graphs', (value) => addSurplus(value.compiler.combinedGraphs)],
    ['semantic-subject', (value) => addSurplus(value.compiler.combinedGraphs.baseline)],
    ['family-map', (value) => addSurplus(value.compiler.families.query)],
    ['family-evidence', (value) => addSurplus(value.compiler.families.query['arm-a'])],
    ['receiver-flow', (value) => addSurplus(value.receiverFlow)],
    [
      'receiver-flow-entry',
      (value) => addSurplus(value.receiverFlow.unsupported['nested-property']!),
    ],
    ['resolver-integrity', (value) => addSurplus(value.resolverIntegrity)],
    ['semantic-equivalence', (value) => addSurplus(value.semanticEquivalence)],
    [
      'semantic-mutation-diagnostics',
      (value) => addSurplus(value.semanticEquivalence.mutationDiagnostics),
    ],
    [
      'collision-subject',
      (value) => addSurplus(value.semanticEquivalence.collisionSubjects['comment-callee-text']!),
    ],
    ['evidence-bindings', (value) => addSurplus(value.evidenceBindings)],
    [
      'binding-mutation-diagnostics',
      (value) => addSurplus(value.evidenceBindings.mutationDiagnostics),
    ],
    ['generation', (value) => addSurplus(value.generation)],
    ['generation-arm', (value) => addSurplus(value.generation.armB)],
    [
      'generation-mutation-diagnostics',
      (value) => addSurplus(value.generation.armB.mutationDiagnostics),
    ],
    ['generated-contract', (value) => addSurplus(value.generation.armB.contracts[0]!)],
    ['generated-manifest', (value) => addSurplus(value.generation.armB.contracts[0]!.manifest)],
    ['runtime-map', (value) => addSurplus(value.runtime)],
    ['runtime-arm', (value) => addSurplus(value.runtime['arm-a'])],
    ['public-forgery', (value) => addSurplus(value.publicForgery)],
    ['public-forgery-leaf', (value) => addSurplus(value.publicForgery.fakeHtmlAsTrustedHtml)],
    ['diagnostics-map', (value) => addSurplus(value.diagnostics)],
    ['typescript-diagnostic', (value) => addSurplus(value.diagnostics['arm-a'])],
    ['measurements', (value) => addSurplus(value.measurements)],
    ['measurement', (value) => addSurplus(value.measurements['arm-a'])],
    ['timed-sample', (value) => addSurplus(value.measurements['arm-a'].coldTscSamples[0]!)],
    [
      'completion-sample',
      (value) => addSurplus(value.measurements['arm-a'].coldCompletionSamples[0]!),
    ],
    ['runner', (value) => addSurplus(value.runner)],
    ['schedules', (value) => addSurplus(value.schedules)],
    ['sealed-artifacts', (value) => addSurplus(value.sealedArtifacts)],
    ['mutation-coverage', (value) => addSurplus(value.mutationCoverage)],
    ['mutation-entry', (value) => addSurplus(value.mutationCoverage.oneSided['count']!)],
    [
      'selection-entry',
      (value) =>
        addSurplus(
          value.mutationCoverage.selectionBranches['arm-a-selected-when-both-pass']!,
        ),
    ],
  ];
}

function mutateSemantic(
  evidence: Mutable<D1RawEvidenceV6>,
  arm: 'arm-a' | 'arm-b',
  field: 'canonicalGraph' | 'canonicalIr',
): void {
  const subject = evidence.compiler.families.query[arm][field];
  subject.canonical = { original: subject.canonical, unexpected: true };
  subject.digest = sha256(JSON.stringify(subject.canonical));
}

function append(authority: MutableAuthority, name: keyof MutableAuthority): void {
  authority[name] = Buffer.concat([authority[name], Buffer.from('\n// forged\n')]);
}

function flipByte(authority: MutableAuthority, name: keyof MutableAuthority): void {
  const bytes = Buffer.from(authority[name]);
  bytes[Math.min(32, bytes.length - 1)]! ^= 1;
  authority[name] = bytes;
}

function cloneAuthority(
  authority: Readonly<Record<(typeof artifactNames)[number], Buffer>>,
): MutableAuthority {
  return Object.fromEntries(
    Object.entries(authority).map(([name, bytes]) => [name, Buffer.from(bytes)]),
  ) as MutableAuthority;
}

function addSurplus(value: object): void {
  (value as Record<string, unknown>).forgedSurplus = true;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const value = sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return Math.round(value * 100) / 100;
}

function clone<Value>(value: Value): Mutable<Value> {
  return structuredClone(value) as Mutable<Value>;
}

type MutableAuthority = Record<(typeof artifactNames)[number], Buffer>;
type Mutable<Value> = Value extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

async function readJson<Value>(url: URL): Promise<Value> {
  return JSON.parse(await readFile(url, 'utf8')) as Value;
}
