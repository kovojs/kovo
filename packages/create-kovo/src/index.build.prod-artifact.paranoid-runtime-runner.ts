import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  runBoundedTestProcess,
  type BoundedTestProcessInvocation,
  type BoundedTestProcessOutcome,
} from './index.test-process-supervisor.mjs';

export const PARANOID_RUNTIME_WORKER_CASE_ENV = 'KOVO_PARANOID_RUNTIME_CASE';

export const REQUIRED_PARANOID_POSTGRES_CASES = [
  'phase5-postgres-paranoid-dogfood',
  'paranoid-external-provision-check-boot',
  'paranoid-external-leak-refusal',
] as const;

export const REQUIRED_PARANOID_AUTHORIZATION_MATRIX_CASES = [
  'closure-safe-boot',
  'closure-cross-schema-definer-function-refusal',
  'closure-definer-view-refusal',
  'closure-matview-refusal',
  'closure-public-table-refusal',
] as const;

export type RequiredParanoidPostgresCase = (typeof REQUIRED_PARANOID_POSTGRES_CASES)[number];
export type RequiredParanoidAuthorizationMatrixCase =
  (typeof REQUIRED_PARANOID_AUTHORIZATION_MATRIX_CASES)[number];

interface ParanoidGateCaseDefinition {
  readonly file: string;
  readonly id: string;
  /** Vitest's per-test deadline inside the isolated process. */
  readonly testTimeoutMs: number;
  /** Parent-owned deadline for the complete Vitest process and its hooks. */
  readonly supervisorTimeoutMs: number;
  readonly workerCaseId?: string;
}

const PARANOID_RUNTIME_TEST_FILE =
  'packages/create-kovo/src/index.build.prod-artifact.paranoid-runtime.test.ts';

/**
 * The static-trust worker owns a 300s production deadline. The external boot proof can then spend
 * up to 180s waiting for the served artifact. Its 600s Vitest bound contains those inner phases.
 * Some callbacks enter synchronous build code that Vitest cannot interrupt, so the descendant-aware
 * process supervisor is the actual hard bound; 660s contains the callback and verified cleanup
 * without letting a timed-out worker leak into the next proof.
 */
export const PARANOID_RUNTIME_CASES = [
  {
    file: PARANOID_RUNTIME_TEST_FILE,
    id: 'phase5-postgres-paranoid-dogfood',
    supervisorTimeoutMs: 480_000,
    testTimeoutMs: 420_000,
    workerCaseId: 'phase5-postgres-paranoid-dogfood',
  },
  {
    file: PARANOID_RUNTIME_TEST_FILE,
    id: 'phase5-sqlite-paranoid-dogfood',
    supervisorTimeoutMs: 660_000,
    testTimeoutMs: 600_000,
    workerCaseId: 'phase5-sqlite-paranoid-dogfood',
  },
  {
    file: PARANOID_RUNTIME_TEST_FILE,
    id: 'paranoid-external-provision-check-boot',
    supervisorTimeoutMs: 660_000,
    testTimeoutMs: 600_000,
    workerCaseId: 'paranoid-external-provision-check-boot',
  },
  {
    file: PARANOID_RUNTIME_TEST_FILE,
    id: 'paranoid-external-leak-refusal',
    supervisorTimeoutMs: 660_000,
    testTimeoutMs: 600_000,
    workerCaseId: 'paranoid-external-leak-refusal',
  },
] as const satisfies readonly ParanoidGateCaseDefinition[];

export type ParanoidRuntimeCaseId = (typeof PARANOID_RUNTIME_CASES)[number]['id'];

export const REQUIRED_PARANOID_RUNTIME_CASES = [
  'phase5-postgres-paranoid-dogfood',
  'phase5-sqlite-paranoid-dogfood',
  'paranoid-external-provision-check-boot',
  'paranoid-external-leak-refusal',
] as const satisfies readonly ParanoidRuntimeCaseId[];

export const PARANOID_GATE_CASES = [
  ...PARANOID_RUNTIME_CASES,
  {
    file: 'packages/server/src/postgres-grant-shape-fuzzer.test.ts',
    id: 'postgres-grant-shape-fuzzer',
    // This file owns three 120s tests. Keep the file-level supervisor beyond their aggregate bound.
    supervisorTimeoutMs: 420_000,
    testTimeoutMs: 120_000,
  },
] as const satisfies readonly ParanoidGateCaseDefinition[];

export interface ParanoidRuntimeWorkerRequirements {
  readonly authorizationMatrixCases: readonly RequiredParanoidAuthorizationMatrixCase[];
  readonly postgresCases: readonly RequiredParanoidPostgresCase[];
  readonly runtimeCases: readonly ParanoidRuntimeCaseId[];
}

export function selectedParanoidRuntimeCaseId(
  value = process.env[PARANOID_RUNTIME_WORKER_CASE_ENV],
): ParanoidRuntimeCaseId | undefined {
  if (value === undefined) return undefined;
  if (isParanoidRuntimeCaseId(value)) return value;
  throw new Error(
    `${PARANOID_RUNTIME_WORKER_CASE_ENV} must name one isolated paranoid runtime case; received ${JSON.stringify(value)}; expected one of: ${PARANOID_RUNTIME_CASES.map((testCase) => testCase.id).join(', ')}`,
  );
}

export function paranoidRuntimeWorkerRequirements(
  selectedCase: ParanoidRuntimeCaseId | undefined,
  includePostgresRuntimeCases: boolean,
): ParanoidRuntimeWorkerRequirements {
  switch (selectedCase) {
    case undefined:
      return {
        authorizationMatrixCases: [],
        postgresCases: [],
        runtimeCases: [],
      };
    case 'phase5-postgres-paranoid-dogfood':
      return {
        authorizationMatrixCases: [],
        postgresCases: [selectedCase],
        runtimeCases: [selectedCase],
      };
    case 'phase5-sqlite-paranoid-dogfood':
      return { authorizationMatrixCases: [], postgresCases: [], runtimeCases: [selectedCase] };
    case 'paranoid-external-provision-check-boot':
      return {
        authorizationMatrixCases: ['closure-safe-boot'],
        postgresCases: [selectedCase],
        runtimeCases: [selectedCase],
      };
    case 'paranoid-external-leak-refusal':
      return {
        authorizationMatrixCases: [
          'closure-cross-schema-definer-function-refusal',
          'closure-definer-view-refusal',
          'closure-matview-refusal',
          'closure-public-table-refusal',
        ],
        postgresCases: [selectedCase],
        runtimeCases: [selectedCase],
      };
  }
}

export function assertParanoidRuntimeCasesExecuted(
  requiredCases: readonly ParanoidRuntimeCaseId[],
  executedCases: ReadonlySet<ParanoidRuntimeCaseId>,
): void {
  const missing = requiredCases.filter((caseId) => !executedCases.has(caseId));
  if (missing.length === 0) return;
  throw new Error(
    `paranoid runtime worker did not execute every selected runtime case; missing: ${missing.join(', ')}`,
  );
}

export function paranoidRuntimeTestTimeoutMs(id: ParanoidRuntimeCaseId): number {
  const testCase = PARANOID_RUNTIME_CASES.find((candidate) => candidate.id === id);
  if (testCase === undefined) throw new Error(`Unknown paranoid runtime case: ${id}`);
  return testCase.testTimeoutMs;
}

export type IsolatedProcessInvocation = BoundedTestProcessInvocation;
export type IsolatedProcessOutcome = BoundedTestProcessOutcome;

export interface ParanoidGateCaseOutcome extends IsolatedProcessOutcome {
  readonly id: string;
  readonly supervisorTimeoutMs: number;
}

export interface ParanoidGateRun {
  readonly failures: readonly ParanoidGateCaseOutcome[];
  readonly outcomes: readonly ParanoidGateCaseOutcome[];
  readonly passed: boolean;
}

interface RunParanoidGateOptions {
  readonly cases?: readonly ParanoidGateCaseDefinition[];
  readonly executeCase?: (testCase: ParanoidGateCaseDefinition) => Promise<IsolatedProcessOutcome>;
  readonly onProgress?: (message: string) => void;
}

export async function runParanoidRuntimeGate(
  options: RunParanoidGateOptions = {},
): Promise<ParanoidGateRun> {
  const cases = options.cases ?? PARANOID_GATE_CASES;
  validateParanoidGateCases(cases);
  const executeCase = options.executeCase ?? executeParanoidGateCase;
  const onProgress = options.onProgress ?? ((message: string) => process.stderr.write(message));
  const outcomes: ParanoidGateCaseOutcome[] = [];

  for (const testCase of cases) {
    onProgress(`\n[paranoid:${testCase.id}] START\n`);
    let outcome: IsolatedProcessOutcome;
    try {
      outcome = await executeCase(testCase);
    } catch (error) {
      outcome = {
        cleanupError: null,
        durationMs: 0,
        error: error instanceof Error ? error.message : String(error),
        exitCode: null,
        outputOverflowed: false,
        signal: null,
        stderr: '',
        stdout: '',
        timedOut: false,
      };
    }
    const caseOutcome = {
      ...outcome,
      id: testCase.id,
      supervisorTimeoutMs: testCase.supervisorTimeoutMs,
    };
    outcomes.push(caseOutcome);
    const label = isPassingOutcome(caseOutcome) ? 'PASS' : 'FAIL';
    onProgress(`[paranoid:${testCase.id}] ${label} (${Math.ceil(caseOutcome.durationMs)}ms)\n`);
    if (caseOutcome.cleanupError !== null) {
      throw new Error(
        `Paranoid runtime isolation cleanup failed for ${testCase.id}; refusing to overlap a later proof: ${caseOutcome.cleanupError}`,
      );
    }
  }

  const failures = outcomes.filter((outcome) => !isPassingOutcome(outcome));
  return { failures, outcomes, passed: failures.length === 0 };
}

export function formatParanoidGateFailures(run: ParanoidGateRun): string {
  if (run.passed) return '';
  const lines = [
    `Paranoid runtime gate attempted all ${String(run.outcomes.length)} isolated cases; ${String(run.failures.length)} failed.`,
  ];
  for (const failure of run.failures) {
    lines.push('', `- ${failure.id}: ${failureReason(failure)}`);
    if (failure.stderr.trim() !== '') lines.push(`  stderr:\n${indent(failure.stderr)}`);
    if (failure.stdout.trim() !== '') lines.push(`  stdout:\n${indent(failure.stdout)}`);
  }
  return `${lines.join('\n')}\n`;
}

export const runIsolatedProcess: (
  invocation: IsolatedProcessInvocation,
) => Promise<IsolatedProcessOutcome> = runBoundedTestProcess;

async function executeParanoidGateCase(
  testCase: ParanoidGateCaseDefinition,
): Promise<IsolatedProcessOutcome> {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0', KOVO_PARANOID: '1' };
  if (testCase.workerCaseId === undefined) {
    delete env[PARANOID_RUNTIME_WORKER_CASE_ENV];
  } else {
    env[PARANOID_RUNTIME_WORKER_CASE_ENV] = testCase.workerCaseId;
  }
  const args = [
    resolve(process.cwd(), 'node_modules/vitest/vitest.mjs'),
    '--run',
    '--no-file-parallelism',
    testCase.file,
    '--reporter=dot',
    `--testTimeout=${String(testCase.testTimeoutMs)}`,
  ];
  return runIsolatedProcess({
    args,
    command: process.execPath,
    cwd: process.cwd(),
    env,
    supervisorTimeoutMs: testCase.supervisorTimeoutMs,
  });
}

function validateParanoidGateCases(cases: readonly ParanoidGateCaseDefinition[]): void {
  if (cases.length === 0) throw new TypeError('paranoid runtime gate requires at least one case');
  const seen = new Set<string>();
  for (const testCase of cases) {
    if (testCase.id === '' || seen.has(testCase.id)) {
      throw new TypeError(
        `paranoid runtime gate case ids must be non-empty and unique: ${testCase.id}`,
      );
    }
    seen.add(testCase.id);
    positiveInteger(testCase.testTimeoutMs, `${testCase.id} test timeout`);
    positiveInteger(testCase.supervisorTimeoutMs, `${testCase.id} supervisor timeout`);
    if (testCase.supervisorTimeoutMs <= testCase.testTimeoutMs) {
      throw new TypeError(`${testCase.id} supervisor timeout must exceed its inner Vitest timeout`);
    }
    if (
      testCase.workerCaseId !== undefined &&
      (testCase.workerCaseId !== testCase.id || !isParanoidRuntimeCaseId(testCase.workerCaseId))
    ) {
      throw new TypeError(
        `${testCase.id} worker selector must equal a declared paranoid runtime case id`,
      );
    }
  }
}

function isPassingOutcome(outcome: IsolatedProcessOutcome): boolean {
  return (
    !outcome.timedOut &&
    !outcome.outputOverflowed &&
    outcome.cleanupError === null &&
    outcome.error === null &&
    outcome.exitCode === 0 &&
    outcome.signal === null
  );
}

function failureReason(outcome: ParanoidGateCaseOutcome): string {
  const reasons: string[] = [];
  if (outcome.timedOut) {
    reasons.push(
      `supervisor deadline ${String(outcome.supervisorTimeoutMs)}ms exceeded; child process tree was terminated before the next case`,
    );
  }
  if (outcome.outputOverflowed) {
    reasons.push('combined child output exceeded its bounded diagnostic allowance');
  }
  if (outcome.error !== null) reasons.push(`could not run child: ${outcome.error}`);
  if (outcome.exitCode !== null && outcome.exitCode !== 0) {
    reasons.push(`child exited with code ${String(outcome.exitCode)}`);
  }
  if (outcome.signal !== null) reasons.push(`child exited on ${outcome.signal}`);
  if (outcome.cleanupError !== null)
    reasons.push(`isolation cleanup failed: ${outcome.cleanupError}`);
  return reasons.join('; ') || 'child produced no successful exit outcome';
}

function indent(value: string): string {
  return value
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function isParanoidRuntimeCaseId(value: string): value is ParanoidRuntimeCaseId {
  return PARANOID_RUNTIME_CASES.some((testCase) => testCase.id === value);
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

async function main(): Promise<void> {
  const run = await runParanoidRuntimeGate();
  if (run.passed) return;
  process.stderr.write(`\n${formatParanoidGateFailures(run)}`);
  process.exitCode = 1;
}

if (isDirectExecution()) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Paranoid runtime supervisor failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
