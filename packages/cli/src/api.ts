/**
 * Public API of the `@kovojs/cli` package.
 *
 * The `kovo` CLI is primarily a bin. This curated module exposes its semantic
 * command facade, versioned diagnostic record, and in-process graph verifiers;
 * it never exposes the argv dispatcher or transport internals.
 */
export { kovoCheck, kovoExplain, runKovoCommand } from './index.js';
export {
  createKovoDiagnostic,
  formatKovoDiagnostics,
  KOVO_DIAGNOSTIC_VERSION,
} from './diagnostic.js';

export type {
  ExplainKind,
  KovoAccessExplainOptions,
  KovoAgentExplainOptions,
  KovoAuthLifecycleExplainOptions,
  KovoAuthorizationExplainOptions,
  KovoCheckFamily,
  KovoCheckInput,
  KovoCheckResult,
  KovoCommandExitCode,
  KovoDocumentExplainOptions,
  KovoEndpointExplainOptions,
  KovoExplainInput,
  KovoExplainOptions,
  KovoGrantExplainOptions,
  KovoRevealedExplainOptions,
  KovoSourcesSinksExplainOptions,
  KovoTasksExplainOptions,
  KovoTargetExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
  KovoSemanticCommandRequest,
} from './index.js';
export type {
  KovoDiagnosticCategory,
  KovoDiagnosticConstruction,
  KovoDiagnosticEnvelope,
  KovoDiagnosticFormat,
  KovoDiagnosticRecord,
  KovoDiagnosticSourceAnchor,
} from './diagnostic.js';
