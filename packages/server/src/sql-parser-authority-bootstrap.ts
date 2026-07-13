import { managedSqlParserAuthorityInstallCapability } from './sql-parser-authority-install-capability.js';
import { parseWithIsolatedSqlParser } from './sql-parser-authority.js';
import {
  installManagedSqlParserAuthority,
  sealManagedSqlParserAuthorityRegistry,
} from './sql-write-allowlist.js';

/**
 * Node managed-database parser bootstrap (SPEC §6.6 rule 6, §10.3, §11.2).
 *
 * Node SQLite/Postgres roots retain this module through an explicit readiness dependency. Their
 * module graph evaluates it before authored app code, while non-DB/Cloudflare bundles can remove
 * the complete node:fs/node:vm branch. The registry is sealed immediately after the one
 * capability-authenticated install.
 */
let parserAuthorityReady = false;
installManagedSqlParserAuthority(
  managedSqlParserAuthorityInstallCapability,
  parseWithIsolatedSqlParser,
);
sealManagedSqlParserAuthorityRegistry();
parserAuthorityReady = true;

/** @internal Keep Node DB entrypoints explicitly dependent on the boot-installed authority. */
export function assertManagedSqlParserAuthorityReady(): void {
  if (!parserAuthorityReady) {
    throw new TypeError('Kovo managed SQL parser authority did not complete trusted bootstrap.');
  }
}
