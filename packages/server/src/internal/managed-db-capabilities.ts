/**
 * @internal Lightweight adapter identity bridge.
 *
 * Test/runtime adapters that only construct managed-DB capability handles and dispatch proxies
 * must not import the boot-asserting `internal/managed-db` aggregate. The consuming managed-DB
 * path still owns SQL parser readiness and runtime enforcement (SPEC §6.6/§10.3).
 */
export {
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  registerFrameworkManagedDbHooks,
  type KovoDeclaredWriteDbCapable,
  type KovoReadonlyDbCapable,
} from '../managed-db.js';
export { createFrameworkManagedSqlDispatchProxy } from '../sql-safe-handle.js';
