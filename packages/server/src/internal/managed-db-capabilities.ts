/**
 * @internal Lightweight adapter identity bridge.
 *
 * Test/runtime adapters that only attach managed-DB capability symbols must not import the
 * boot-asserting `internal/managed-db` aggregate. The consuming managed-DB path still owns SQL
 * parser readiness and runtime enforcement (SPEC §6.6/§10.3).
 */
export { kovoDeclaredWriteDbHandle, kovoReadonlyDbHandle } from '../managed-db.js';
