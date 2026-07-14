/**
 * Package-internal SQLite adapter door for first-party Kovo integrations.
 *
 * App-authored imports from this subpath are forbidden by SPEC §5.2. The public
 * `@kovojs/server/sqlite` entry exposes only the opaque capability type and safe runtime
 * constructor; it never exposes the raw-capability consumer.
 *
 * @internal
 */
export { snapshotSqliteSchemaRecord } from '../sqlite-schema-record.js';
export { useSqliteSystemDb } from '@kovojs/server/internal/sqlite-capability';
