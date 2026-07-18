import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalPostgresToolchainAvailable {
  available: true;
}

export interface LocalPostgresToolchainUnavailable {
  available: false;
  reason: string;
}

export type LocalPostgresToolchain =
  | LocalPostgresToolchainAvailable
  | LocalPostgresToolchainUnavailable;

/**
 * Decide whether real-Postgres acceptance cases can run. The dedicated paranoid authorization
 * gate is fail-closed; ordinary test runs may retain their local-tooling skip behavior.
 */
export function requireParanoidPostgresToolchain(
  toolchain: LocalPostgresToolchain,
  required: boolean,
): boolean {
  if (toolchain.available) return true;
  if (!required) return false;
  throw new Error(`test:authz-paranoid requires a local Postgres toolchain: ${toolchain.reason}`);
}

/** Fail the dedicated gate when Vitest filtered or skipped any required real-Postgres case. */
export function assertParanoidPostgresCasesExecuted<CaseId extends string>(
  requiredCases: readonly CaseId[],
  executedCases: ReadonlySet<CaseId>,
  required: boolean,
): void {
  if (!required) return;
  const missing = requiredCases.filter((caseId) => !executedCases.has(caseId));
  if (missing.length === 0) return;
  throw new Error(
    `test:authz-paranoid did not execute every required real-Postgres case; missing: ${missing.join(', ')}`,
  );
}

export interface ParanoidAuthorizationMatrixCase {
  readonly expected: string;
  readonly id: string;
  readonly operation: string;
  readonly ownership: readonly string[];
  readonly principal: readonly string[];
  readonly queryFamily: readonly string[];
  readonly surface: string;
}

export interface RunParanoidAuthorizationMatrixOptions {
  readonly cases: readonly ParanoidAuthorizationMatrixCase[];
  readonly executors: Readonly<Record<string, () => Promise<void>>>;
  readonly failureDirectory: string;
  readonly onExecuted?: (caseId: string) => void;
  readonly replayCommand: string;
  readonly seed: string;
}

const authorizationMatrixSeedAssignment = /(^|\s)KOVO_AUTHZ_MATRIX_SEED=[^\s]+(?=\s|$)/u;

/**
 * Pin a persisted replay command to the seed that actually selected this execution order.
 * The checked-in command names the default seed, while a release or investigation may override it.
 * Persisting the template unchanged would make that failure impossible to replay exactly.
 */
export function pinAuthorizationMatrixReplayCommand(replayCommand: string, seed: string): string {
  const match = authorizationMatrixSeedAssignment.exec(replayCommand);
  if (!match) {
    throw new Error('authorization matrix replay command must set KOVO_AUTHZ_MATRIX_SEED');
  }
  const leadingWhitespace = match[1] ?? '';
  const assignment = `${leadingWhitespace}KOVO_AUTHZ_MATRIX_SEED=${shellQuote(seed)}`;
  return `${replayCommand.slice(0, match.index)}${assignment}${replayCommand.slice(match.index + match[0].length)}`;
}

/**
 * Execute every SPEC §10.3 authorization cell in deterministic seeded order. A failed cell is
 * already the minimized reproducer: the persisted artifact contains only that cell, the exact
 * seed, and the command that replays the complete served-artifact matrix.
 */
export async function runParanoidAuthorizationMatrix({
  cases,
  executors,
  failureDirectory,
  onExecuted,
  replayCommand,
  seed,
}: RunParanoidAuthorizationMatrixOptions): Promise<void> {
  const pinnedReplayCommand = pinAuthorizationMatrixReplayCommand(replayCommand, seed);
  const orderedCases = seededAuthorizationMatrixOrder(cases, seed);
  const missingExecutors = orderedCases
    .filter((testCase) => executors[testCase.id] === undefined)
    .map((testCase) => testCase.id);
  if (missingExecutors.length > 0) {
    throw new Error(`authorization matrix has no executor for: ${missingExecutors.join(', ')}`);
  }

  for (const testCase of orderedCases) {
    if (process.env.KOVO_AUTHZ_MATRIX_TRACE === '1') {
      process.stderr.write(`authorization-matrix START ${testCase.id}\n`);
    }
    try {
      await executors[testCase.id]!();
      onExecuted?.(testCase.id);
      if (process.env.KOVO_AUTHZ_MATRIX_TRACE === '1') {
        process.stderr.write(`authorization-matrix PASS ${testCase.id}\n`);
      }
    } catch (error) {
      const artifactPath = persistAuthorizationMatrixFailure({
        error,
        failureDirectory,
        replayCommand: pinnedReplayCommand,
        seed,
        testCase,
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `authorization matrix cell ${testCase.id} failed; minimized replay saved to ${artifactPath}: ${message}`,
        { cause: error },
      );
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function seededAuthorizationMatrixOrder<
  TestCase extends Pick<ParanoidAuthorizationMatrixCase, 'id'>,
>(cases: readonly TestCase[], seed: string): readonly TestCase[] {
  return cases.toSorted((left, right) => {
    const leftOrder = authorizationMatrixOrderKey(seed, left.id);
    const rightOrder = authorizationMatrixOrderKey(seed, right.id);
    return leftOrder.localeCompare(rightOrder) || left.id.localeCompare(right.id);
  });
}

function authorizationMatrixOrderKey(seed: string, caseId: string): string {
  return createHash('sha256').update(`${seed}\0${caseId}`).digest('hex');
}

function persistAuthorizationMatrixFailure({
  error,
  failureDirectory,
  replayCommand,
  seed,
  testCase,
}: {
  readonly error: unknown;
  readonly failureDirectory: string;
  readonly replayCommand: string;
  readonly seed: string;
  readonly testCase: ParanoidAuthorizationMatrixCase;
}): string {
  mkdirSync(failureDirectory, { recursive: true });
  const artifactPath = join(
    failureDirectory,
    `${createHash('sha256').update(`${seed}\0${testCase.id}`).digest('hex').slice(0, 16)}.json`,
  );
  const errorMessage = error instanceof Error ? error.message : String(error);
  writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        error: errorMessage,
        minimizedRepro: testCase,
        replayCommand,
        schema: 'kovo.authorization-matrix-failure/v1',
        seed,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return artifactPath;
}
