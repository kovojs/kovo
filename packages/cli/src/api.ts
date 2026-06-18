/**
 * Public API of the `@kovojs/cli` package.
 *
 * The `kovo` CLI is primarily a bin (`kovo check`, `kovo explain`, `kovo audit`,
 * `kovo export`, `kovo add`, `kovo mcp`). This module exposes only the small,
 * documented library surface for the two verifiers — `kovoCheck` and
 * `kovoExplain` — so callers can run them in-process against an extracted graph
 * (SPEC.md §11.4 verification surface; §1.1 proof claims). Everything else (the
 * argv dispatcher, MCP transport, compile facts, audit) is internal and reachable
 * only through the bin or the explicitly-internal `@kovojs/cli/internal` subpath.
 */
export { kovoCheck, kovoExplain } from './index.js';

export type { DiagnosticCode } from '@kovojs/core';
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
