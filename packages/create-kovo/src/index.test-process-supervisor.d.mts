export interface BoundedTestProcessInvocation {
  readonly args: readonly string[];
  readonly censusIntervalMs?: number;
  readonly censusTimeoutMs?: number;
  readonly command: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly killGraceMs?: number;
  readonly maxOutputBytes?: number;
  readonly rootExitTimeoutMs?: number;
  readonly streamCloseTimeoutMs?: number;
  readonly supervisorTimeoutMs: number;
  readonly terminationGraceMs?: number;
}

export interface BoundedTestProcessOutcome {
  readonly cleanupError: string | null;
  readonly durationMs: number;
  readonly error: string | null;
  readonly exitCode: number | null;
  readonly outputOverflowed: boolean;
  readonly signal: string | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly timedOut: boolean;
}

export interface BoundedTestProcessCleanupOptions {
  readonly killGraceMs?: number;
  readonly rootExitTimeoutMs?: number;
  readonly streamCloseTimeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export interface BoundedTestProcessRecordForTest {
  readonly marked: boolean;
  readonly pgid: number;
  readonly pid: number;
  readonly ppid: number;
  readonly state: string;
}

export interface BoundedTestProcessDependenciesForTest {
  readonly delay?: (milliseconds: number) => Promise<unknown>;
  readonly now?: () => number;
  readonly signalProcess?: (pid: number, signal: NodeJS.Signals) => void;
  readonly signalProcessGroup?: (pgid: number, signal: NodeJS.Signals) => void;
  readonly snapshotProcessTable?: (
    markerName: string,
    deadlineAtMs: number,
  ) => Promise<Map<number, BoundedTestProcessRecordForTest>>;
}

export const DEFAULT_TEST_PROCESS_MAX_OUTPUT_BYTES: number;
export const DEFAULT_TEST_PROCESS_TERMINATION_GRACE_MS: number;
export const DEFAULT_TEST_PROCESS_KILL_GRACE_MS: number;
export const DEFAULT_TEST_PROCESS_ROOT_EXIT_TIMEOUT_MS: number;
export const DEFAULT_TEST_PROCESS_STREAM_CLOSE_TIMEOUT_MS: number;

export function boundedTestProcessCleanupBudgetMs(
  options?: BoundedTestProcessCleanupOptions,
): number;

export function runBoundedTestProcess(
  invocation: BoundedTestProcessInvocation,
): Promise<BoundedTestProcessOutcome>;

export function runBoundedTestProcessForTest(
  invocation: BoundedTestProcessInvocation,
  overrides?: BoundedTestProcessDependenciesForTest,
): Promise<BoundedTestProcessOutcome>;

export function assertSupportedTestProcessPlatform(platform?: NodeJS.Platform): void;
