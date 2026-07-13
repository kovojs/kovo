import {
  readonlyDb as readonlyDbImplementation,
  type CrossOwnerReadPolicyOptions,
  type RawReadPolicyOptions,
  type Reader,
} from './managed-db.js';
import { assertManagedSqlParserAuthorityReady } from './sql-parser-authority-bootstrap.js';

/**
 * Create the public read-only managed DB handle with its Node parser authority preloaded
 * (SPEC §6.6 rule 6, §9.4, §10.3).
 *
 * Keeping this explicit wrapper separate lets route-only/Cloudflare bundles discard the Node VM
 * branch when `readonlyDb` is not used. A retained managed-DB export evaluates its trusted parser
 * bootstrap before authored app code and also asserts readiness at construction.
 */
export function readonlyDb<Db extends object>(
  db: Db,
  options: { crossOwnerRead?: CrossOwnerReadPolicyOptions; rawRead?: RawReadPolicyOptions } = {},
): Reader<Db> {
  assertManagedSqlParserAuthorityReady();
  return readonlyDbImplementation(db, options);
}
