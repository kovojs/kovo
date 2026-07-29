/**
 * Public API of the `@kovojs/cli` package.
 *
 * The `kovo` CLI is primarily a bin. This curated module exposes its semantic
 * command facade and in-process graph verifiers; it never exposes the argv
 * dispatcher, diagnostic construction internals, or transport internals.
 */
export { kovoCheck, kovoExplain, runKovoCommand } from './index.js';
export { KOVO_DIAGNOSTIC_VERSION } from './diagnostic.js';

export type {
  KovoCliDiagnosticCode,
  KovoDiagnosticCategory,
  KovoDiagnosticCommandResult,
  KovoDiagnosticEnvelope,
  KovoDiagnosticFormat,
  KovoDiagnosticRecord,
  KovoDiagnosticSourceAnchor,
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
