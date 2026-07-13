import { assertManagedSqlParserAuthorityReady } from '../sql-parser-authority-bootstrap.js';

assertManagedSqlParserAuthorityReady();

export {
  KovoReadonlyHandleError,
  createAuthorizationCensusDb,
  createDeclaredWriteDb,
  createPostgresReadonlyClient,
  createPostgresScopedClient,
  drainCrossOwnerReadAuditFacts,
  drainPostgresRlsSilentDenyDiagnostics,
  drainPublicReadAuditFacts,
  kovoDeclaredWriteDbHandle,
  kovoReadonlyDbHandle,
  managedDb,
  registerFrameworkManagedDbHooks,
  readonlyDb,
} from '../managed-db.js';
export type {
  AuthorizationCensusDbOptions,
  AuthorizationCensusMetadata,
  CrossOwnerReadAuditFact,
  DeclaredWriteDbOptions,
  DeclaredWriteSqliteAuthorizerConstants,
  DeclaredWriteSqliteAuthorizerDatabase,
  DeclaredWriteSqliteAuthorizerOptions,
  GovernedWriteMetadata,
  KovoDeclaredWriteDbCapable,
  KovoReadonlyDbCapable,
  ManagedDbMode,
  PostgresReadonlyClientOptions,
  PostgresRlsDiagnosticReadClient,
  PostgresRlsSilentDenyDiagnostic,
  PostgresRlsSilentDenyDiagnosticsOptions,
  PostgresScopedClientOptions,
  PublicReadAuditFact,
  Reader,
  SqliteAuthorizationClassification,
} from '../managed-db.js';
export {
  createFrameworkManagedSqlDispatchProxy,
  frameworkManagedDbRawTarget,
} from '../sql-safe-handle.js';
export { createSecretBoxingReadDb, declareSecretReadCapability } from '../secret-read-boundary.js';
export type {
  DeclaredSecretReadCapability,
  SecretReadBoundaryOptions,
  SecretReadColumnSource,
  SecretReadMetadata,
  SecretReadSqliteColumnOrigin,
  SecretReadSqliteColumnOriginClient,
} from '../secret-read-boundary.js';
