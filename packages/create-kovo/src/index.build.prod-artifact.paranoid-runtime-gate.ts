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
