/**
 * Private install capability for the managed-SQL parser authority (SPEC §6.6 rule 6).
 *
 * This symbol is intentionally absent from every package export. Identity comparison makes the
 * install call unforgeable; the root/bootstrap seals the registry before authored app evaluation,
 * so retaining or structurally imitating an installer call cannot replace classifier truth later.
 */
export const managedSqlParserAuthorityInstallCapability: unique symbol = Symbol(
  'kovo.private.managed-sql-parser-authority-install',
);
