export interface GeneratedStarterProcessCounts {
  readonly cliProcessCount: number;
  readonly serverProcessCount?: number;
}

export interface GeneratedStarterDeadlinePosture {
  readonly ci?: boolean;
}

export const GENERATED_STARTER_CLI_SIGNAL_GRACE_MS: number;

export function starterServerReadyTimeoutMs(posture?: GeneratedStarterDeadlinePosture): number;

export function generatedStarterCliProcessTimeoutMs(
  posture?: GeneratedStarterDeadlinePosture,
): number;

export function generatedStarterFixtureSetupHeadroomMs(
  posture?: GeneratedStarterDeadlinePosture,
): number;

export function generatedStarterTestTimeoutMs(
  options: GeneratedStarterProcessCounts,
  posture?: GeneratedStarterDeadlinePosture,
): number;
