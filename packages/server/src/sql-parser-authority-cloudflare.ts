/* oxlint-disable typescript/unbound-method -- The generated Worker locks the realm before import. */
import { parse } from 'pgsql-ast-parser';

import { parseAndSnapshotManagedSql } from './sql-parser-authority-snapshot.js';

/**
 * Workers-compatible SQL-parser authority (SPEC §6.6 rule 6, §10.3, §11.2).
 *
 * The generated Cloudflare entry locks the complete request-safe runtime realm before importing
 * the handler. This module then captures the exact reviewed parser dependency before authored app
 * code is evaluated. Workers do not expose Node's private VM API, so this is the rule-6
 * bootstrap-order posture—not an app-code-independent isolation claim. The shared snapshot
 * boundary still reconstructs bounded host-owned facts and never exports parser errors or objects.
 */
const lockedRealmParse = parse;

/** Parse SQL through the boot-captured Workers authority and return only host-owned AST facts. */
export function parseWithIsolatedSqlParser(sql: string) {
  return parseAndSnapshotManagedSql(lockedRealmParse, sql);
}
