import { boundedTestProcessCleanupBudgetMs } from './index.test-process-supervisor.mjs';

const LOCAL_STARTER_SERVER_READY_TIMEOUT_MS = 90_000;
const CI_STARTER_SERVER_READY_TIMEOUT_MS = 180_000;
const LOCAL_GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS = 240_000;
const CI_GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS = 420_000;
const LOCAL_GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS = 60_000;
const CI_GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS = 180_000;

export const GENERATED_STARTER_CLI_SIGNAL_GRACE_MS = 5_000;

export function starterServerReadyTimeoutMs({ ci = Boolean(process.env.CI) } = {}) {
  return ci ? CI_STARTER_SERVER_READY_TIMEOUT_MS : LOCAL_STARTER_SERVER_READY_TIMEOUT_MS;
}

export function generatedStarterCliProcessTimeoutMs({ ci = Boolean(process.env.CI) } = {}) {
  return ci
    ? CI_GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS
    : LOCAL_GENERATED_STARTER_CLI_PROCESS_TIMEOUT_MS;
}

export function generatedStarterFixtureSetupHeadroomMs({ ci = Boolean(process.env.CI) } = {}) {
  return ci
    ? CI_GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS
    : LOCAL_GENERATED_STARTER_FIXTURE_SETUP_HEADROOM_MS;
}

/**
 * Derive the outer Vitest deadline from the exact number of bounded child commands and servers.
 * Callers that generate hosted shard manifests pass `{ ci: true }` explicitly so local process
 * posture cannot silently understate the hosted watchdog.
 */
export function generatedStarterTestTimeoutMs(options, { ci = Boolean(process.env.CI) } = {}) {
  const serverProcessCount = options.serverProcessCount ?? 0;
  if (!Number.isSafeInteger(options.cliProcessCount) || options.cliProcessCount < 0) {
    throw new TypeError('cliProcessCount must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(serverProcessCount) || serverProcessCount < 0) {
    throw new TypeError('serverProcessCount must be a non-negative safe integer.');
  }
  const cleanupWindowMs = boundedTestProcessCleanupBudgetMs({
    killGraceMs: GENERATED_STARTER_CLI_SIGNAL_GRACE_MS,
    rootExitTimeoutMs: GENERATED_STARTER_CLI_SIGNAL_GRACE_MS,
    streamCloseTimeoutMs: GENERATED_STARTER_CLI_SIGNAL_GRACE_MS,
    terminationGraceMs: GENERATED_STARTER_CLI_SIGNAL_GRACE_MS,
  });
  return (
    generatedStarterFixtureSetupHeadroomMs({ ci }) +
    options.cliProcessCount * (generatedStarterCliProcessTimeoutMs({ ci }) + cleanupWindowMs) +
    serverProcessCount * (starterServerReadyTimeoutMs({ ci }) + cleanupWindowMs)
  );
}
