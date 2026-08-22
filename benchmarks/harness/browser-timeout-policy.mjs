import { boundedTestProcessCleanupBudgetMs } from '../../packages/create-kovo/src/index.test-process-supervisor.mjs';

import { lighthouseInvocationPhaseMaximumMs } from './lighthouse-policy.mjs';

const MINUTE_MS = 60_000;

export const BROWSER_COMPARISON_LANES = Object.freeze(['default', 'matched-l0', 'matched-l1']);
export const BROWSER_COMPARISON_EXECUTION_ORDER = Object.freeze([
  'kovo',
  'nextjs',
  'nextjs',
  'kovo',
]);
export const BROWSER_ADAPTER_NON_LIGHTHOUSE_HEADROOM_MS = 4 * MINUTE_MS;
export const BROWSER_PREPARATION_SUPERVISOR_TIMEOUT_MS = 5 * MINUTE_MS;
export const BROWSER_COMPARISON_QUIET_HOST_MAX_MS = 30_000;
export const BROWSER_COMPARISON_COLLECT_STEP_TIMEOUT_MS = 285 * MINUTE_MS;
export const BROWSER_COMPARISON_JOB_TIMEOUT_MS = 360 * MINUTE_MS;
export const BROWSER_COMPARISON_CHILD_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS = boundedTestProcessCleanupBudgetMs();

// The 285-minute workflow step is a final parent fallback, not the process-tree cleanup mechanism.
// The exact child schedule plus marker-owned cleanup ends by 272m28s, leaving 12m32s before that
// parent can deliver SIGTERM for comparison finalization and report serialization with no child
// expected to remain live.

export const BROWSER_WORKFLOW_STEP_TIMEOUT_MINUTES = Object.freeze({
  authenticate: 1,
  bindRunner: 1,
  checkout: 3,
  collect: 285,
  cpuAdmission: 1,
  isolatedDependencies: 5,
  kovoSetup: 5,
  playwright: 45,
  upload: 3,
});

/**
 * The comparison's outer cell supervisor is authoritative over nested Lighthouse deadlines. It
 * grants the exact four-cell Lighthouse maximum plus four minutes for the ordinary scenarios,
 * bfcache probe, server lifecycle, and raw-report write. Near-cap nested work is rejected rather
 * than allowed to consume the workflow's finalization/upload reserve.
 */
export function browserAdapterSupervisorTimeoutMs({ lighthouseRepeats, skipLighthouse = false }) {
  if (skipLighthouse) return BROWSER_ADAPTER_NON_LIGHTHOUSE_HEADROOM_MS;
  return (
    lighthouseInvocationPhaseMaximumMs(positiveInteger(lighthouseRepeats, 'Lighthouse repeats')) +
    BROWSER_ADAPTER_NON_LIGHTHOUSE_HEADROOM_MS
  );
}

export function browserComparisonTimeoutBudget({
  lanes = BROWSER_COMPARISON_LANES,
  lighthouseRuns = 5,
  skipLighthouse = false,
} = {}) {
  const selectedLanes = exactLanes(lanes);
  const [firstRepeats, secondRepeats] = splitAcrossOccurrences(
    positiveInteger(lighthouseRuns, 'comparison Lighthouse runs'),
  ).map((value) => Math.max(1, value));
  const occurrenceRepeats = [firstRepeats, secondRepeats];
  const frameworkOccurrences = { kovo: 0, nextjs: 0 };
  const scheduledRepeats = BROWSER_COMPARISON_EXECUTION_ORDER.map(
    (framework) => occurrenceRepeats[frameworkOccurrences[framework]++],
  );
  const adapterSupervisorMs =
    selectedLanes.length *
    scheduledRepeats.reduce(
      (total, lighthouseRepeats) =>
        total + browserAdapterSupervisorTimeoutMs({ lighthouseRepeats, skipLighthouse }),
      0,
    );
  const adapterProcesses = selectedLanes.length * BROWSER_COMPARISON_EXECUTION_ORDER.length;
  const adapterCleanupMs = adapterProcesses * BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS;
  const preparationProcesses = 2;
  const preparationSupervisorMs = preparationProcesses * BROWSER_PREPARATION_SUPERVISOR_TIMEOUT_MS;
  const preparationCleanupMs = preparationProcesses * BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS;
  const throughCellsMaximumMs =
    adapterSupervisorMs +
    adapterCleanupMs +
    preparationSupervisorMs +
    preparationCleanupMs +
    BROWSER_COMPARISON_QUIET_HOST_MAX_MS;
  const workflowStepTotalMinutes = Object.values(BROWSER_WORKFLOW_STEP_TIMEOUT_MINUTES).reduce(
    (total, value) => total + value,
    0,
  );
  return {
    adapterCleanupMs,
    adapterProcesses,
    adapterSupervisorMs,
    collectFinalizationHeadroomMs:
      BROWSER_COMPARISON_COLLECT_STEP_TIMEOUT_MS - throughCellsMaximumMs,
    collectStepTimeoutMs: BROWSER_COMPARISON_COLLECT_STEP_TIMEOUT_MS,
    jobOverheadHeadroomMs: BROWSER_COMPARISON_JOB_TIMEOUT_MS - workflowStepTotalMinutes * MINUTE_MS,
    jobTimeoutMs: BROWSER_COMPARISON_JOB_TIMEOUT_MS,
    preparationCleanupMs,
    preparationProcesses,
    preparationSupervisorMs,
    quietHostMs: BROWSER_COMPARISON_QUIET_HOST_MAX_MS,
    scheduledRepeats,
    throughCellsMaximumMs,
    workflowStepTotalMinutes,
  };
}

function exactLanes(value) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    new Set(value).size !== value.length ||
    value.some((lane) => !BROWSER_COMPARISON_LANES.includes(lane))
  ) {
    throw new TypeError('browser timeout policy lanes must be a unique non-empty supported set');
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new TypeError(`${label} must be an integer from 1 through 100`);
  }
  return value;
}

function splitAcrossOccurrences(total) {
  return [Math.ceil(total / 2), Math.floor(total / 2)];
}
