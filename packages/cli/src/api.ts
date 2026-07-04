/**
 * Public API of the `@kovojs/cli` package.
 *
 * The `kovo` CLI is primarily a bin (`kovo check`, `kovo explain`, `kovo audit`,
 * `kovo export`, `kovo add`, `kovo mcp`). This module exposes the small
 * documented library surface for verifiers. Generated app maintenance scripts
 * that need the command-equivalent facade use the internal subpath instead of
 * widening the app-facing root API.
 */
export { kovoCheck, kovoExplain } from './index.js';

export type {
  ExplainKind,
  KovoAccessExplainOptions,
  KovoCheckFamily,
  KovoCheckInput,
  KovoCheckResult,
  KovoDocumentExplainOptions,
  KovoEndpointExplainOptions,
  KovoExplainInput,
  KovoExplainOptions,
  KovoRevealedExplainOptions,
  KovoSourcesSinksExplainOptions,
  KovoTasksExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
} from './index.js';
