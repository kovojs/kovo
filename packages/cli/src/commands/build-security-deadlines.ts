/**
 * Fail-closed wall deadline for the disposable static-trust process required by SPEC §§2 and
 * 6.6. Hosted SQLite exhausted the former 420s bound; the same isolated case passed locally in
 * 240.29s and adjacent hosted cases completed in 415.9–417.9s. Retain roughly 40% measured headroom
 * (420s × 1.4 = 588s, rounded up) without weakening process-tree cleanup, authenticated output
 * validation, or the prohibition on partial trust acceptance.
 */
export const STATIC_TRUST_WORKER_TIMEOUT_MS = 600_000;

/**
 * A build-analysis one-shot can serially run both config and app static-trust preflights.
 */
export const KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES = ['config', 'app'] as const;

/** Fixed allowance after both nested trust workers for orchestration, handoff I/O, and close. */
export const KOVO_BUILD_ONE_SHOT_ORCHESTRATION_HEADROOM_MS = 60_000;

export const KOVO_BUILD_ONE_SHOT_WORKER_TIMEOUT_MS =
  STATIC_TRUST_WORKER_TIMEOUT_MS * KOVO_BUILD_ONE_SHOT_STATIC_TRUST_PHASES.length +
  KOVO_BUILD_ONE_SHOT_ORCHESTRATION_HEADROOM_MS;
