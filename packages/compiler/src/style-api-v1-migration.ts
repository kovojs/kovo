/**
 * @internal Author-invoked source migration. The parser implementation lives at the scanner
 * boundary so SPEC.md §5.2 rule 9 remains true for every app-source parse.
 */
export { analyzeStyleApiV1Migration } from './scan/style-api-v1-migration.js';
export type {
  StyleApiV1MigrationAnalysis,
  StyleApiV1MigrationEdit,
  StyleApiV1MigrationRefusal,
} from './scan/style-api-v1-migration.js';
