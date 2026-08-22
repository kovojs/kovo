import { describe, expect, it } from 'vitest';

import {
  BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS,
  BROWSER_COMPARISON_COLLECT_STEP_TIMEOUT_MS,
  BROWSER_COMPARISON_EXECUTION_ORDER,
  BROWSER_COMPARISON_JOB_TIMEOUT_MS,
  BROWSER_COMPARISON_LANES,
  BROWSER_PREPARATION_SUPERVISOR_TIMEOUT_MS,
  BROWSER_WORKFLOW_STEP_TIMEOUT_MINUTES,
  browserAdapterSupervisorTimeoutMs,
  browserComparisonTimeoutBudget,
} from './browser-timeout-policy.mjs';

describe('browser comparison timeout policy', () => {
  it('derives the exact three-lane K,N,N,K maximum below the collection-step cap', () => {
    const budget = browserComparisonTimeoutBudget();
    const scheduledAdapterMaximumMs =
      BROWSER_COMPARISON_LANES.length *
      budget.scheduledRepeats.reduce(
        (total, lighthouseRepeats) =>
          total +
          browserAdapterSupervisorTimeoutMs({ lighthouseRepeats }) +
          BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS,
        0,
      );

    expect(BROWSER_COMPARISON_EXECUTION_ORDER).toEqual(['kovo', 'nextjs', 'nextjs', 'kovo']);
    expect(budget.scheduledRepeats).toEqual([3, 3, 2, 2]);
    expect(browserAdapterSupervisorTimeoutMs({ lighthouseRepeats: 3 })).toBe(25 * 60_000);
    expect(browserAdapterSupervisorTimeoutMs({ lighthouseRepeats: 2 })).toBe(18 * 60_000);
    expect(BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS).toBe(17_000);
    expect(scheduledAdapterMaximumMs).toBe(261 * 60_000 + 24_000);
    expect(budget.adapterSupervisorMs + budget.adapterCleanupMs).toBe(scheduledAdapterMaximumMs);
    expect(BROWSER_PREPARATION_SUPERVISOR_TIMEOUT_MS).toBe(5 * 60_000);
    expect(budget.preparationSupervisorMs + budget.preparationCleanupMs).toBe(10 * 60_000 + 34_000);
    expect(budget.quietHostMs).toBe(30_000);
    expect(budget.throughCellsMaximumMs).toBe(272 * 60_000 + 28_000);
    expect(BROWSER_COMPARISON_COLLECT_STEP_TIMEOUT_MS).toBe(285 * 60_000);
    expect(budget.collectFinalizationHeadroomMs).toBe(12 * 60_000 + 32_000);
    expect(budget.collectFinalizationHeadroomMs).toBeGreaterThan(
      BROWSER_COMPARISON_CHILD_CLEANUP_BUDGET_MS,
    );
  });

  it('caps every browser workflow step below the six-hour job parent', () => {
    const budget = browserComparisonTimeoutBudget();
    expect(BROWSER_WORKFLOW_STEP_TIMEOUT_MINUTES).toEqual({
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
    expect(budget.workflowStepTotalMinutes).toBe(349);
    expect(BROWSER_COMPARISON_JOB_TIMEOUT_MS).toBe(360 * 60_000);
    expect(budget.jobOverheadHeadroomMs).toBe(11 * 60_000);
  });
});
