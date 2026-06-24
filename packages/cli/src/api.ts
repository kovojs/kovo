/**
 * Public API of the `@kovojs/cli` package.
 *
 * The `kovo` CLI is primarily a bin (`kovo check`, `kovo explain`, `kovo audit`,
 * `kovo export`, `kovo add`, `kovo mcp`). This module exposes the small
 * documented library surface for verifiers plus `runKovoCommand`, the
 * command-equivalent facade used by generated app maintenance scripts that need
 * to run the same export/build path in process.
 */
export { kovoCheck, kovoExplain, runKovoCommand } from './index.js';

export type {
  ExplainKind,
  KovoAccessExplainOptions,
  KovoCheckFamily,
  KovoCheckInput,
  KovoCheckResult,
  KovoEndpointExplainOptions,
  KovoExplainInput,
  KovoExplainOptions,
  KovoRevealedExplainOptions,
  KovoSourcesSinksExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
} from './index.js';
