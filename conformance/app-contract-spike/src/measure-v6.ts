import { readFile, writeFile } from 'node:fs/promises';

import { evaluateD1V6 } from './evaluator-v6.ts';
import { runD1V6Experiment } from './experiment-v6.ts';
import type { D1CriteriaV6, D1EvaluationV6, D1RawEvidenceV6 } from './types-v6.ts';

const criteriaUrl = new URL('../criteria-v6.json', import.meta.url);
const evidenceUrl = new URL('../raw-evidence-v6.json', import.meta.url);
const resultsUrl = new URL('../results-v6.json', import.meta.url);
const sealedUrl = new URL('../sealed-v6/', import.meta.url);

export async function runD1V6Measurement(mode: 'verify' | 'write'): Promise<void> {
  const criteria = await readJson<D1CriteriaV6>(criteriaUrl);
  const freshEvidence = await runD1V6Experiment(criteria, {
    ...(mode === 'write' ? { sealDirectory: sealedUrl.pathname } : {}),
  });
  const freshEvaluation = await evaluateD1V6(criteria, freshEvidence);

  if (mode === 'write') {
    await writeJson(evidenceUrl, freshEvidence);
    await writeJson(resultsUrl, freshEvaluation);
    process.stdout.write(
      `${JSON.stringify(
        {
          decision: freshEvaluation.decision,
          evidence: evidenceUrl.pathname,
          results: resultsUrl.pathname,
          schema: 'kovo.app-contract-d1-measure-write/v6',
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const committedEvidence = await readJson<D1RawEvidenceV6>(evidenceUrl);
  const committedEvaluation = await readJson<D1EvaluationV6>(resultsUrl);
  const reevaluatedCommitted = await evaluateD1V6(criteria, committedEvidence);
  assertEqual(
    reevaluatedCommitted,
    committedEvaluation,
    'committed evaluation is stale relative to v6 criteria/evidence',
  );
  assertEqual(
    evaluationVerificationSurface(freshEvaluation),
    evaluationVerificationSurface(committedEvaluation),
    'fresh decision-relevant eligibility/gates differ from committed v6 result',
  );
  assertEqual(
    deterministicEvidenceSurface(freshEvidence),
    deterministicEvidenceSurface(committedEvidence),
    'fresh deterministic evidence differs from committed v6 evidence',
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        authenticatedPackedCompilerRerun: true,
        bothArmsRerun: true,
        committedEvidenceReevaluatesExactly: true,
        decision: freshEvaluation.decision,
        everyDecisionRelevantGateCompared: true,
        schema: 'kovo.app-contract-d1-measure-verify/v6',
        timingSamplesReevaluatedByThresholds: true,
      },
      null,
      2,
    )}\n`,
  );
}

export function evaluationVerificationSurface(evaluation: D1EvaluationV6): unknown {
  return {
    arms: Object.fromEntries(
      (['arm-a', 'arm-b'] as const).map((arm) => [
        arm,
        {
          eligible: evaluation.arms[arm].eligible,
          gatePasses: decisionRelevantGatePasses(evaluation.arms[arm].gates),
        },
      ]),
    ),
    decision: evaluation.decision,
    priorEvidenceDisposition: evaluation.priorEvidenceDisposition,
  };
}

function decisionRelevantGatePasses(
  gates: D1EvaluationV6['arms']['arm-a']['gates'],
): Readonly<Record<string, boolean>> {
  const deterministicGates = Object.fromEntries(
    Object.entries(gates)
      .filter(([name]) => name !== 'performance')
      .map(([name, gate]) => [name, gate.pass]),
  );
  const canPerformanceAffectEligibility = Object.values(deterministicGates).every(Boolean);
  return canPerformanceAffectEligibility
    ? { ...deterministicGates, performance: gates.performance.pass }
    : deterministicGates;
}

function deterministicEvidenceSurface(evidence: D1RawEvidenceV6): unknown {
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
    const difference = firstDifference(actual, expected);
    throw new Error(
      `D1 v6 ${message} at ${difference.path}.\nFresh: ${formatDifference(
        difference.actual,
      )}\nCommitted: ${formatDifference(difference.expected)}`,
    );
  }
}

function firstDifference(
  actual: unknown,
  expected: unknown,
  path = '$',
): { readonly actual: unknown; readonly expected: unknown; readonly path: string } {
  if (Object.is(actual, expected)) return { actual, expected, path };
  if (
    typeof actual !== 'object' ||
    actual === null ||
    typeof expected !== 'object' ||
    expected === null
  ) {
    return { actual, expected, path };
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) {
      return { actual, expected, path };
    }
    for (let index = 0; index < actual.length; index += 1) {
      if (JSON.stringify(actual[index]) !== JSON.stringify(expected[index])) {
        return firstDifference(actual[index], expected[index], `${path}[${index}]`);
      }
    }
    return { actual, expected, path };
  }
  const actualRecord = actual as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const actualKeys = Object.keys(actualRecord);
  const expectedKeys = Object.keys(expectedRecord);
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    return { actual: actualKeys, expected: expectedKeys, path: `${path}.[[keys]]` };
  }
  for (const key of actualKeys) {
    if (JSON.stringify(actualRecord[key]) !== JSON.stringify(expectedRecord[key])) {
      return firstDifference(actualRecord[key], expectedRecord[key], `${path}.${key}`);
    }
  }
  return { actual, expected, path };
}

function formatDifference(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? String(value)
    : serialized.length <= 500
      ? serialized
      : `${serialized.slice(0, 500)}…`;
}

async function readJson<Value>(url: URL): Promise<Value> {
  return JSON.parse(await readFile(url, 'utf8')) as Value;
}

async function writeJson(url: URL, value: unknown): Promise<void> {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}
