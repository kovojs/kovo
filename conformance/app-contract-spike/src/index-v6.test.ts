import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { sha256 } from './artifacts-v6.ts';
import { evaluateD1V6 } from './evaluator-v6.ts';
import { declarationFamilies, matrixCaseNames } from './fixture-v6.ts';
import { evaluationVerificationSurface } from './measure-v6.ts';
import type { D1CriteriaV6, D1EvaluationV6, D1RawEvidenceV6 } from './types-v6.ts';

describe('D1 v6 authenticated app-contract evaluator', () => {
  let criteria: D1CriteriaV6;
  let evidence: D1RawEvidenceV6;
  let committed: D1EvaluationV6;

  beforeAll(async () => {
    [criteria, evidence, committed] = await Promise.all([
      readJson<D1CriteriaV6>(new URL('../criteria-v6.json', import.meta.url)),
      readJson<D1RawEvidenceV6>(new URL('../raw-evidence-v6.json', import.meta.url)),
      readJson<D1EvaluationV6>(new URL('../results-v6.json', import.meta.url)),
    ]);
  });

  it('recomputes the exact committed decision and invalidates v1-v4', async () => {
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
      },
      schema: 'kovo.app-contract-d1-evaluation/v6',
    });
    expect(evaluated.arms['arm-a'].eligible).toBe(true);
    expect(evaluated.arms['arm-b'].eligible).toBe(false);
    expect(evaluated.arms['arm-b'].gates.compilerAndGraph.pass).toBe(false);
  });

  it('compares timing outcomes exactly only when they can affect eligibility', () => {
    const irrelevantTimingFlip = clone(committed);
    irrelevantTimingFlip.arms['arm-b'].gates.performance.pass =
      !irrelevantTimingFlip.arms['arm-b'].gates.performance.pass;
    irrelevantTimingFlip.arms['arm-b'].gates.performance.details = [];
    expect(evaluationVerificationSurface(irrelevantTimingFlip)).toEqual(
      evaluationVerificationSurface(committed),
    );

    const relevantTimingFlip = clone(committed);
    relevantTimingFlip.arms['arm-a'].gates.performance.pass = false;
    relevantTimingFlip.arms['arm-a'].gates.performance.details = ['timing threshold failed'];
    expect(evaluationVerificationSurface(relevantTimingFlip)).not.toEqual(
      evaluationVerificationSurface(committed),
    );
  });

  it('binds all 38 matrix runs, six families, two packed compiler entrypoints, and two probes', () => {
    expect(Object.keys(evidence.matrix).sort()).toEqual([...matrixCaseNames].sort());
    expect(Object.keys(evidence.compiler.families).sort()).toEqual([...declarationFamilies].sort());
    expect(evidence.fixture.counts).toMatchObject({
      declarationFamilies: 6,
      generatedBoundModules: 3,
      generatedFamilyFiles: 18,
      generatedMatrixFiles: 38,
      generatedProviderFiles: 2,
      generatedRuntimeFiles: 2,
      generatedTypeDeclarationFiles: 36,
      generatedTypeDeclarations: 144,
      matrixCases: 19,
      sourceRewriteCount: 0,
    });
    expect(evidence.provenance.packedCompiler.entrypoints.map((entry) => entry.requested)).toEqual([
      '@kovojs/compiler',
      '@kovojs/compiler/internal',
    ]);
    expect(evidence.receiverFlow.nestedAppDerived.diagnostics.map((entry) => entry.code)).toEqual([
      'D1A007',
    ]);
    expect(evidence.receiverFlow.unrelatedSameNamedMember).toMatchObject({
      diagnostics: [],
      ownerKey: null,
      recognizedFactoryCount: 0,
    });
  });

  it('exercises all resolver, generator, semantic, and binding mutations exactly', () => {
    expect(codes(evidence.resolverIntegrity)).toEqual({
      'blank-owner-key': ['D1A105'],
      'blank-server-package-root': ['D1A106'],
      'duplicate-span': ['D1A101'],
      'overlapping-span': ['D1A102'],
      'stale-source-reparse': ['D1A104'],
      'wrong-node-span': ['D1A103'],
    });
    expect(codes(evidence.generation.armB.mutationDiagnostics)).toEqual({
      'compiler-source-digest': ['D1B103'],
      'completion-token': ['D1B106'],
      'config-source-digest': ['D1B102'],
      'generated-module-digest': ['D1B105'],
      'provider-source-digest': ['D1B101'],
      'server-packed-contents-digest': ['D1B104'],
    });
    expect(codes(evidence.semanticEquivalence.mutationDiagnostics)).toEqual({
      'graph-add': ['D1E104'],
      'graph-change': ['D1E106'],
      'graph-delete': ['D1E105'],
      'ir-add': ['D1E101'],
      'ir-change': ['D1E103'],
      'ir-delete': ['D1E102'],
    });
    expect(codes(evidence.evidenceBindings.mutationDiagnostics)).toEqual({
      'matrix-source': ['D1E202'],
      'packed-compiler-entrypoint': ['D1E204'],
      'runtime-owner': ['D1E201'],
      'server-copy-digest': ['D1E203'],
    });
  });

  it.each([
    ['IR add', 'canonicalIr', 'add'],
    ['IR delete', 'canonicalIr', 'delete'],
    ['IR change', 'canonicalIr', 'change'],
    ['graph add', 'canonicalGraph', 'add'],
    ['graph delete', 'canonicalGraph', 'delete'],
    ['graph change', 'canonicalGraph', 'change'],
  ] as const)(
    'makes Arm A ineligible for an exact semantic %s mutation',
    async (_label, subjectName, mutation) => {
      const mutated = clone(evidence);
      const subject = mutated.compiler.families.query['arm-a'][subjectName];
      subject.canonical =
        mutation === 'add'
          ? { original: subject.canonical, unexpected: true }
          : mutation === 'delete'
            ? {}
            : { changed: subject.canonical };
      subject.digest = sha256(JSON.stringify(subject.canonical));

      const evaluated = await evaluateD1V6(criteria, mutated);
      expect(evaluated.arms['arm-a'].gates.compilerAndGraph.pass).toBe(false);
      expect(evaluated.arms['arm-a'].eligible).toBe(false);
    },
  );

  it.each([
    [
      'runtime owner',
      (mutated: Mutable<D1RawEvidenceV6>) => {
        mutated.runtime['arm-a'].ownerKey = `${mutated.runtime['arm-a'].ownerKey}:forged`;
      },
      'ownershipAndBindings',
    ],
    [
      'matrix source',
      (mutated: Mutable<D1RawEvidenceV6>) => {
        mutated.matrix['ordinary-local-import']['arm-a'].sourceSha256 = '0'.repeat(64);
      },
      'ownershipAndBindings',
    ],
    [
      'server copy digest',
      (mutated: Mutable<D1RawEvidenceV6>) => {
        mutated.fixture.serverCopies[0]!.basePackedContentsSha256 = '0'.repeat(64);
      },
      'ownershipAndBindings',
    ],
    [
      'packed compiler entrypoint',
      (mutated: Mutable<D1RawEvidenceV6>) => {
        mutated.provenance.packedCompiler.entrypoints[0]!.resolvedSha256 = '0'.repeat(64);
      },
      'artifacts',
    ],
  ] as const)('rejects a forged %s binding', async (_label, mutate, gateName) => {
    const mutated = clone(evidence);
    mutate(mutated);
    const evaluated = await evaluateD1V6(criteria, mutated);
    expect(evaluated.arms['arm-a'].gates[gateName].pass).toBe(false);
    expect(evaluated.arms['arm-a'].eligible).toBe(false);
  });

  it('makes config and packed-server digest claims enforcement-bearing', async () => {
    const configMutation = clone(evidence);
    configMutation.generation.armB.contracts[0]!.manifest.configSha256 = '0'.repeat(64);
    expect(
      (await evaluateD1V6(criteria, configMutation)).arms['arm-a'].gates.ownershipAndBindings.pass,
    ).toBe(false);

    const serverMutation = clone(evidence);
    serverMutation.generation.armB.contracts[0]!.manifest.serverPackedContentsSha256 = '0'.repeat(
      64,
    );
    expect(
      (await evaluateD1V6(criteria, serverMutation)).arms['arm-a'].gates.ownershipAndBindings.pass,
    ).toBe(false);
  });

  it('rejects nested-flow fail-open, unrelated-member false positive, and re-export duplicate bypasses', async () => {
    const nested = clone(evidence);
    nested.receiverFlow.nestedAppDerived.diagnostics = [];
    expect(
      (await evaluateD1V6(criteria, nested)).arms['arm-a'].gates.ownershipAndBindings.pass,
    ).toBe(false);

    const unrelated = clone(evidence);
    unrelated.receiverFlow.unrelatedSameNamedMember.recognizedFactoryCount = 1;
    expect(
      (await evaluateD1V6(criteria, unrelated)).arms['arm-a'].gates.ownershipAndBindings.pass,
    ).toBe(false);

    for (const name of [
      'duplicate-named-reexport-copies',
      'duplicate-star-reexport-copies',
      'duplicate-same-owner-key-copies',
    ] as const) {
      const duplicate = clone(evidence);
      duplicate.matrix[name]['arm-a'].serverPackageRoots.splice(1, 1);
      expect((await evaluateD1V6(criteria, duplicate)).arms['arm-a'].gates.matrix.pass).toBe(false);
    }
  });

  it('rejects an incomplete six-order block and forged timing summary', async () => {
    const orderMutation = clone(evidence);
    orderMutation.schedules.warmCompletion[5] = orderMutation.schedules.warmCompletion[0]!;
    expect((await evaluateD1V6(criteria, orderMutation)).arms['arm-a'].gates.performance.pass).toBe(
      false,
    );

    const timingMutation = clone(evidence);
    timingMutation.measurements['arm-a'].coldTscP50Ms += 1;
    expect(
      (await evaluateD1V6(criteria, timingMutation)).arms['arm-a'].gates.performance.pass,
    ).toBe(false);
  });

  it('rejects surplus raw and criteria keys', async () => {
    const raw = clone(evidence);
    (raw as unknown as Record<string, unknown>).forged = true;
    await expect(evaluateD1V6(criteria, raw)).rejects.toThrow('raw evidence keys');

    const criteriaMutation = clone(criteria);
    (criteriaMutation.matrix as unknown as Record<string, unknown>).forged = {};
    await expect(evaluateD1V6(criteriaMutation, evidence)).rejects.toThrow('criteria matrix cases');
  });
});

function codes(
  diagnostics: Readonly<Record<string, readonly { readonly code: string }[]>>,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(diagnostics).map(([name, values]) => [name, values.map((entry) => entry.code)]),
  );
}

function clone<Value>(value: Value): Mutable<Value> {
  return structuredClone(value) as Mutable<Value>;
}

type Mutable<Value> = Value extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : Value extends object
    ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
    : Value;

async function readJson<Value>(url: URL): Promise<Value> {
  return JSON.parse(await readFile(url, 'utf8')) as Value;
}
