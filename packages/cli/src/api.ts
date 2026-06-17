/**
 * Public API of the `kovo` package.
 *
 * The `kovo` CLI is primarily a bin (`kovo check`, `kovo explain`, `kovo audit`,
 * `kovo export`, `kovo add`, `kovo mcp`). This module exposes only the small,
 * documented library surface for the two verifiers — `kovoCheck` and
 * `kovoExplain` — so callers can run them in-process against an extracted graph
 * (SPEC.md §11.4 verification surface; §1.1 proof claims). Everything else (the
 * argv dispatcher, MCP transport, compile facts, audit) is internal and reachable
 * only through the bin or the explicitly-internal `kovo/internal` subpath.
 */
export { kovoCheck, kovoExplain } from './index.js';

// Graph input shapes are owned and documented by @kovojs/core; re-export them
// directly so the verifier signatures stay self-contained for `.` consumers.
export type { DiagnosticCode } from '@kovojs/core';
export type { KovoCheckInput, KovoExplainInput } from '@kovojs/core/internal/graph';

export type {
  ExplainKind,
  KovoCheckResult,
  KovoEndpointExplainOptions,
  KovoExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
} from './index.js';
