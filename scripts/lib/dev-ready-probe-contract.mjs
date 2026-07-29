/**
 * The packed process can take substantially longer to acquire its listener on a contended CI
 * runner than the product is allowed to take on the ratified G2 runner. This ceiling exists only
 * to let the probe reach the socket-bind observation; it is not a startup-performance budget.
 */
export const DEV_READY_LISTENER_INFRASTRUCTURE_TIMEOUT_MS = 120_000;

/**
 * KF-DEVEX-002 observes the reporter after the socket is listening. Keep this behavioral contract
 * independent from both the infrastructure ceiling above and the separately ratified G2 budgets.
 */
export const DEV_READY_POST_BIND_BUDGET_MS = 5_000;

/**
 * The register's outer process deadline must leave cleanup headroom after listener acquisition.
 */
export const DEV_READY_PROBE_PROCESS_TIMEOUT_MS = 180_000;
