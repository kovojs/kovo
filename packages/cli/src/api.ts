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

import type {
  KovoCheckInput as CoreKovoCheckInput,
  KovoExplainInput as CoreKovoExplainInput,
} from '@kovojs/core/internal/graph';

/**
 * Input graph accepted by `kovoCheck`.
 *
 * The shape is the committed verifier graph produced by Kovo's compiler/tooling
 * pipeline (SPEC.md §11.4). It is re-declared here as the public `@kovojs/cli`
 * verifier contract while the lower-level graph declarations remain under
 * `@kovojs/core/internal/graph`.
 */
export interface KovoCheckInput extends CoreKovoCheckInput {}

/**
 * Input graph accepted by `kovoExplain`.
 *
 * This extends the public `kovoCheck` graph with explain-only metadata used to
 * render verifier reports in-process (SPEC.md §11.4).
 */
export interface KovoExplainInput extends CoreKovoExplainInput {}

export type {
  ExplainKind,
  KovoCheckResult,
  KovoEndpointExplainOptions,
  KovoExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
} from './index.js';
