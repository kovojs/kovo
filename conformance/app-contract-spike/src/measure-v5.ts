import { readFile, writeFile } from 'node:fs/promises';

import { evaluateD1V5 } from './evaluator-v5.ts';
import { runD1V5Experiment } from './experiment-v5.ts';
import type { D1CriteriaV5, D1EvaluationV5, D1RawEvidenceV5 } from './types-v5.ts';

const criteriaUrl = new URL('../criteria-v5.json', import.meta.url);
const evidenceUrl = new URL('../raw-evidence-v5.json', import.meta.url);
const resultsUrl = new URL('../results-v5.json', import.meta.url);

export async function runD1V5Measurement(mode: 'verify' | 'write'): Promise<void> {
  const criteria = await readJson<D1CriteriaV5>(criteriaUrl);
  const freshEvidence = await runD1V5Experiment(criteria);
  const freshEvaluation = await evaluateD1V5(criteria, freshEvidence);

  if (mode === 'write') {
    await writeJson(evidenceUrl, freshEvidence);
    await writeJson(resultsUrl, freshEvaluation);
    process.stdout.write(
      `${JSON.stringify(
        {
          decision: freshEvaluation.decision,
          evidence: evidenceUrl.pathname,
          results: resultsUrl.pathname,
          schema: 'kovo.app-contract-d1-measure-write/v5',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const committedEvidence = await readJson<D1RawEvidenceV5>(evidenceUrl);
  const committedEvaluation = await readJson<D1EvaluationV5>(resultsUrl);
  const reevaluatedCommitted = await evaluateD1V5(criteria, committedEvidence);
  assertEqual(
    reevaluatedCommitted,
    committedEvaluation,
    'committed evaluation is stale relative to v5 criteria/evidence',
  );
  assertEqual(
    evaluationVerdictSurface(freshEvaluation),
    evaluationVerdictSurface(committedEvaluation),
    'fresh eligibility/gates/decision differ from committed v5 result',
  );
  assertEqual(
    deterministicEvidenceSurface(freshEvidence),
    deterministicEvidenceSurface(committedEvidence),
    'fresh deterministic evidence differs from committed v5 evidence',
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        authenticatedPackedCompilerRerun: true,
        bothArmsRerun: true,
        committedEvidenceReevaluatesExactly: true,
        decision: freshEvaluation.decision,
        everyGateCompared: true,
        schema: 'kovo.app-contract-d1-measure-verify/v5',
        timingSamplesComparedByThresholds: true,
      },
      null,
      2,
    )}\n`,
  );
}

function evaluationVerdictSurface(evaluation: D1EvaluationV5): unknown {
  return {
    arms: Object.fromEntries(
      (['arm-a', 'arm-b'] as const).map((arm) => [
        arm,
        {
          eligible: evaluation.arms[arm].eligible,
          gatePasses: Object.fromEntries(
            Object.entries(evaluation.arms[arm].gates).map(([name, gate]) => [name, gate.pass]),
          ),
        },
      ]),
    ),
    decision: evaluation.decision,
    priorEvidenceDisposition: evaluation.priorEvidenceDisposition,
  };
}

function deterministicEvidenceSurface(evidence: D1RawEvidenceV5): unknown {
  return {
    compiler: evidence.compiler,
    completionContracts: Object.fromEntries(
      (['baseline', 'arm-a', 'arm-b'] as const).map((variant) => [
        variant,
        {
          completionCandidateCount: evidence.measurements[variant].completionCandidateCount,
          completionCandidateDigest: evidence.measurements[variant].completionCandidateDigest,
          completionCandidateNames: evidence.measurements[variant].completionCandidateNames,
          declarationBytes: evidence.measurements[variant].declarationBytes,
          typecheckDiagnosticCodes: evidence.measurements[variant].typecheckDiagnosticCodes,
        },
      ]),
    ),
    diagnostics: evidence.diagnostics,
    evidenceBindings: evidence.evidenceBindings,
    fixture: evidence.fixture,
    generation: evidence.generation,
    matrix: evidence.matrix,
    provenance: {
      frameworkSourceCommit: evidence.provenance.frameworkSourceCommit,
      frameworkSourceContents: evidence.provenance.frameworkSourceContents,
      frameworkSourceTreeClean: evidence.provenance.frameworkSourceTreeClean,
      packages: evidence.provenance.packages,
      packedCompiler: evidence.provenance.packedCompiler,
    },
    publicForgery: evidence.publicForgery,
    receiverFlow: evidence.receiverFlow,
    resolverIntegrity: evidence.resolverIntegrity,
    runtime: evidence.runtime,
    schedules: evidence.schedules,
    schema: evidence.schema,
    semanticEquivalence: evidence.semanticEquivalence,
  };
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `D1 v5 ${message}.\nFresh: ${JSON.stringify(actual, null, 2)}\nCommitted: ${JSON.stringify(
        expected,
        null,
        2,
      )}`,
    );
  }
}

async function readJson<Value>(url: URL): Promise<Value> {
  return JSON.parse(await readFile(url, 'utf8')) as Value;
}

async function writeJson(url: URL, value: unknown): Promise<void> {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}
