import type { DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions, isDiagnosticCode } from '@kovojs/core/internal/diagnostics';

/**
 * Stable version of the diagnostic record shared by CLI, editor, GitHub, MCP,
 * and devtool adapters.
 */
export const KOVO_DIAGNOSTIC_VERSION = 'kovo-diagnostic/v1' as const;

/** Exact authored-source anchor using zero-based UTF-16 offsets. */
export interface KovoDiagnosticSourceAnchor {
  readonly end: number;
  readonly file: string;
  readonly start: number;
}

/** Stable diagnostic categories used to choose process behavior. */
export type KovoDiagnosticCategory = 'build' | 'config' | 'proof' | 'runtime' | 'usage';

/**
 * One transport-neutral diagnostic. A KV code retains registry-owned
 * severity/help; CLI-owned codes use the `KOVO_*` namespace.
 */
export interface KovoDiagnosticRecord {
  readonly category: KovoDiagnosticCategory;
  readonly code: string;
  readonly help?: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly source?: KovoDiagnosticSourceAnchor;
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
}

/** Serialized diagnostic envelope for JSON/watch consumers. */
export interface KovoDiagnosticEnvelope {
  readonly diagnostics: readonly KovoDiagnosticRecord[];
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
}

/** Presentation adapters supported by the shared record. */
export type KovoDiagnosticFormat = 'github' | 'human' | 'json';

/** Inputs accepted by {@link createKovoDiagnostic}. */
export type KovoDiagnosticConstruction = Omit<
  KovoDiagnosticRecord,
  'help' | 'severity' | 'version'
> & {
  readonly help?: string;
  readonly severity?: DiagnosticSeverity;
};

/**
 * Construct and freeze one honest diagnostic record. Callers cannot smuggle
 * malformed source ranges into GitHub/editor adapters. Registered KV codes
 * always take severity/help from the owning diagnostic registry.
 */
export function createKovoDiagnostic(input: KovoDiagnosticConstruction): KovoDiagnosticRecord {
  if (!input.code || !/^(?:KV\d{3}|KOVO_[A-Z0-9_]+)$/u.test(input.code)) {
    throw new TypeError('Kovo diagnostic code must be KV### or KOVO_*.');
  }
  if (!input.message) throw new TypeError('Kovo diagnostic message must be non-empty.');
  const definition = isDiagnosticCode(input.code) ? diagnosticDefinitions[input.code] : undefined;
  const definitionHelp =
    definition !== undefined && 'help' in definition ? definition.help : undefined;
  if (
    definition !== undefined &&
    input.severity !== undefined &&
    input.severity !== definition.severity
  ) {
    throw new TypeError(`Kovo diagnostic ${input.code} severity is registry-owned.`);
  }
  if (definition !== undefined && input.help !== undefined && input.help !== definitionHelp) {
    throw new TypeError(`Kovo diagnostic ${input.code} help is registry-owned.`);
  }
  const severity = definition?.severity ?? input.severity;
  if (severity === undefined) {
    throw new TypeError('CLI-owned Kovo diagnostics must declare a severity.');
  }
  const help = definition === undefined ? input.help : definitionHelp;
  const source =
    input.source === undefined ? undefined : Object.freeze(validateSourceAnchor(input.source));
  return Object.freeze({
    ...input,
    ...(help === undefined ? {} : { help }),
    severity,
    ...(source === undefined ? {} : { source }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

/** Create a frozen JSON envelope without re-deriving any field. */
export function createKovoDiagnosticEnvelope(
  diagnostics: readonly KovoDiagnosticRecord[],
): KovoDiagnosticEnvelope {
  return Object.freeze({
    diagnostics: Object.freeze([...diagnostics]),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

/** Render records for one presentation surface without changing their decisions. */
export function formatKovoDiagnostics(
  diagnostics: readonly KovoDiagnosticRecord[],
  format: KovoDiagnosticFormat,
): string {
  const envelope = createKovoDiagnosticEnvelope(diagnostics);
  if (format === 'json') return `${JSON.stringify(envelope)}\n`;
  if (format === 'github') {
    return diagnostics.map(formatGithubDiagnostic).join('');
  }
  return diagnostics
    .map((diagnostic) => {
      const message = diagnostic.message.endsWith('\n')
        ? diagnostic.message
        : `${diagnostic.message}\n`;
      return message;
    })
    .join('');
}

/** @internal Create the standard invocation-error record used by argv adapters. */
export function usageDiagnostic(message: string): KovoDiagnosticRecord {
  return createKovoDiagnostic({
    category: 'usage',
    code: 'KOVO_USAGE',
    help: 'Run `kovo --help` or `kovo help <command>` for generated usage.',
    message,
    severity: 'error',
  });
}

/** @internal Create a transport-neutral record for a non-usage command finding. */
export function commandFindingDiagnostic(
  category: Exclude<KovoDiagnosticCategory, 'usage'>,
  message: string,
): KovoDiagnosticRecord {
  const code =
    category === 'build'
      ? 'KOVO_BUILD_FINDING'
      : category === 'config'
        ? 'KOVO_CONFIG_FINDING'
        : category === 'runtime'
          ? 'KOVO_RUNTIME_FINDING'
          : 'KOVO_PROOF_FINDING';
  return createKovoDiagnostic({
    category,
    code,
    help:
      category === 'proof'
        ? 'Inspect the cited source proof and rerun the command.'
        : 'Resolve the reported command finding and rerun the command.',
    message,
    severity: 'error',
  });
}

function validateSourceAnchor(source: KovoDiagnosticSourceAnchor): KovoDiagnosticSourceAnchor {
  if (!source.file) throw new TypeError('Kovo diagnostic source file must be non-empty.');
  if (
    !Number.isSafeInteger(source.start) ||
    !Number.isSafeInteger(source.end) ||
    source.start < 0 ||
    source.end < source.start
  ) {
    throw new TypeError('Kovo diagnostic source span must be a finite increasing range.');
  }
  return { end: source.end, file: source.file, start: source.start };
}

function formatGithubDiagnostic(diagnostic: KovoDiagnosticRecord): string {
  const level =
    diagnostic.severity === 'error'
      ? 'error'
      : diagnostic.severity === 'warn'
        ? 'warning'
        : 'notice';
  const source =
    diagnostic.source === undefined ? '' : ` file=${githubProperty(diagnostic.source.file)}`;
  const title = githubProperty(`${diagnostic.code} ${diagnostic.category}`);
  const body = githubMessage(
    `${diagnostic.message}${diagnostic.help === undefined ? '' : ` ${diagnostic.help}`}`,
  );
  return `::${level}${source},title=${title}::${body}\n`;
}

function githubProperty(value: string): string {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function githubMessage(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}
