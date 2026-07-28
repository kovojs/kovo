/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import type { DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions, isDiagnosticCode } from '@kovojs/core/internal/diagnostics';

/** @internal Stable CLI diagnostic wire version. The eventual public owner is core/diagnostics. */
export const KOVO_DIAGNOSTIC_VERSION = 'kovo-diagnostic/v1' as const;

/** @internal Exact authored-source anchor using zero-based UTF-16 offsets. */
export interface KovoDiagnosticSourceAnchor {
  readonly end: number;
  readonly file: string;
  readonly start: number;
}

/** @internal Stable categories used to classify CLI process behavior. */
export type KovoDiagnosticCategory = 'build' | 'config' | 'proof' | 'runtime' | 'usage';

/** @internal One registry-authenticated, transport-neutral CLI record. */
export interface KovoDiagnosticRecord {
  readonly category: KovoDiagnosticCategory;
  readonly code: string;
  readonly help?: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly source?: KovoDiagnosticSourceAnchor;
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
}

/** @internal Serialized diagnostic envelope for CLI adapters. */
export interface KovoDiagnosticEnvelope {
  readonly diagnostics: readonly KovoDiagnosticRecord[];
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
}

/** @internal Presentation adapters supported by the private CLI record. */
export type KovoDiagnosticFormat = 'github' | 'human' | 'json';

/** @internal Inputs accepted by the realm-local diagnostic constructor. */
export type KovoDiagnosticConstruction = {
  readonly category: KovoDiagnosticCategory;
  readonly code: string;
  readonly help?: string;
  readonly message: string;
  readonly severity?: DiagnosticSeverity;
  readonly source?: KovoDiagnosticSourceAnchor;
};

const nativeObjectFreeze = Object.freeze;
const nativeObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const nativeObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const nativeObjectGetPrototypeOf = Object.getPrototypeOf;
const nativeReflectApply = Reflect.apply;
const nativeWeakSetAdd = WeakSet.prototype.add;
const nativeWeakSetHas = WeakSet.prototype.has;
const diagnosticRegistry = new WeakSet<object>();
const envelopeRegistry = new WeakSet<object>();

/**
 * @internal Construct one realm-local CLI record from exact own data.
 *
 * The returned object's authority is its membership in `diagnosticRegistry`, not
 * its structural fields. Copies and lookalikes cannot cross this boundary.
 */
export function createKovoDiagnostic(input: KovoDiagnosticConstruction): KovoDiagnosticRecord {
  const fields = exactOwnDataFields(input, {
    allowed: ['category', 'code', 'help', 'message', 'severity', 'source'],
    label: 'Kovo diagnostic construction',
    required: ['category', 'code', 'message'],
  });
  const category = diagnosticCategory(fields.category);
  const code = diagnosticCode(fields.code);
  const message = nonEmptyString(fields.message, 'Kovo diagnostic message');
  const providedHelp =
    fields.help === undefined ? undefined : nonEmptyString(fields.help, 'Kovo diagnostic help');
  const providedSeverity =
    fields.severity === undefined ? undefined : diagnosticSeverity(fields.severity);
  const source =
    fields.source === undefined ? undefined : validateSourceAnchor(fields.source, 'source');

  let help: string | undefined;
  let severity: DiagnosticSeverity;
  if (code.startsWith('KV')) {
    if (!isDiagnosticCode(code)) {
      throw new TypeError(`Kovo diagnostic code ${JSON.stringify(code)} is not registered.`);
    }
    const definition = diagnosticDefinitions[code];
    const registryHelp = 'help' in definition ? definition.help : undefined;
    if (providedSeverity !== undefined && providedSeverity !== definition.severity) {
      throw new TypeError(`Kovo diagnostic ${code} severity is registry-owned.`);
    }
    if (providedHelp !== undefined && providedHelp !== registryHelp) {
      throw new TypeError(`Kovo diagnostic ${code} help is registry-owned.`);
    }
    help = registryHelp;
    severity = definition.severity;
  } else {
    if (providedSeverity === undefined) {
      throw new TypeError('CLI-owned Kovo diagnostics must declare a severity.');
    }
    help = providedHelp;
    severity = providedSeverity;
  }

  const record: KovoDiagnosticRecord = nativeObjectFreeze({
    category,
    code,
    ...(help === undefined ? {} : { help }),
    message,
    severity,
    ...(source === undefined ? {} : { source }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
  registryAdd(diagnosticRegistry, record);
  return record;
}

/** @internal Create a registry-authenticated frozen envelope. */
export function createKovoDiagnosticEnvelope(
  diagnostics: readonly KovoDiagnosticRecord[],
): KovoDiagnosticEnvelope {
  if (!Array.isArray(diagnostics)) {
    throw new TypeError('Kovo diagnostic envelope requires an array.');
  }
  const records = diagnostics.map((diagnostic, index) =>
    assertKovoDiagnosticRecord(diagnostic, `diagnostics[${index}]`),
  );
  const envelope = nativeObjectFreeze({
    diagnostics: nativeObjectFreeze(records),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
  registryAdd(envelopeRegistry, envelope);
  return envelope;
}

/** @internal Assert that an envelope was constructed in this exact module realm. */
export function assertKovoDiagnosticEnvelope(value: unknown): KovoDiagnosticEnvelope {
  if (!isObject(value) || !registryHas(envelopeRegistry, value)) {
    throw new TypeError('Kovo diagnostic envelope lacks local registry identity.');
  }
  return value as KovoDiagnosticEnvelope;
}

/** @internal Render only records authenticated by this module's private registry. */
export function formatKovoDiagnostics(
  diagnostics: readonly KovoDiagnosticRecord[],
  format: KovoDiagnosticFormat,
): string {
  const normalizedFormat = diagnosticFormat(format);
  const envelope = createKovoDiagnosticEnvelope(diagnostics);
  assertKovoDiagnosticEnvelope(envelope);
  if (normalizedFormat === 'json') return `${JSON.stringify(envelope)}\n`;
  if (normalizedFormat === 'github') {
    return envelope.diagnostics.map(formatGithubDiagnostic).join('');
  }
  return envelope.diagnostics
    .map((diagnostic) =>
      diagnostic.message.endsWith('\n') ? diagnostic.message : `${diagnostic.message}\n`,
    )
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

function assertKovoDiagnosticRecord(value: unknown, label: string): KovoDiagnosticRecord {
  if (!isObject(value) || !registryHas(diagnosticRegistry, value)) {
    throw new TypeError(`${label} lacks local Kovo diagnostic registry identity.`);
  }
  return value as KovoDiagnosticRecord;
}

function exactOwnDataFields(
  value: unknown,
  options: {
    readonly allowed: readonly string[];
    readonly label: string;
    readonly required: readonly string[];
  },
): Readonly<Record<string, unknown>> {
  if (!isObject(value) || Array.isArray(value)) {
    throw new TypeError(`${options.label} must be an exact own-data object.`);
  }
  const prototype = nativeReflectApply(nativeObjectGetPrototypeOf, Object, [value]) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${options.label} must not carry a custom prototype.`);
  }
  const symbols = nativeReflectApply(nativeObjectGetOwnPropertySymbols, Object, [
    value,
  ]) as symbol[];
  if (symbols.length > 0) throw new TypeError(`${options.label} must not contain symbol fields.`);
  const descriptors = nativeReflectApply(nativeObjectGetOwnPropertyDescriptors, Object, [
    value,
  ]) as Record<string, PropertyDescriptor>;
  const keys = Object.keys(descriptors);
  const admitted = new Set(options.allowed);
  for (const key of keys) {
    if (!admitted.has(key)) {
      throw new TypeError(`${options.label} contains surplus field ${JSON.stringify(key)}.`);
    }
    if (!('value' in descriptors[key]!)) {
      throw new TypeError(`${options.label}.${key} must be an own data field.`);
    }
  }
  for (const key of options.required) {
    if (!(key in descriptors)) {
      throw new TypeError(`${options.label} is missing field ${JSON.stringify(key)}.`);
    }
  }
  return nativeObjectFreeze(Object.fromEntries(keys.map((key) => [key, descriptors[key]!.value])));
}

function validateSourceAnchor(value: unknown, label: string): KovoDiagnosticSourceAnchor {
  const fields = exactOwnDataFields(value, {
    allowed: ['end', 'file', 'start'],
    label: `Kovo diagnostic ${label}`,
    required: ['end', 'file', 'start'],
  });
  const file = nonEmptyString(fields.file, 'Kovo diagnostic source file');
  const start = sourceOffset(fields.start);
  const end = sourceOffset(fields.end);
  if (end < start) {
    throw new TypeError('Kovo diagnostic source span must be a finite increasing range.');
  }
  return nativeObjectFreeze({ end, file, start });
}

function diagnosticCategory(value: unknown): KovoDiagnosticCategory {
  if (
    value !== 'build' &&
    value !== 'config' &&
    value !== 'proof' &&
    value !== 'runtime' &&
    value !== 'usage'
  ) {
    throw new TypeError('Kovo diagnostic category is invalid.');
  }
  return value;
}

function diagnosticCode(value: unknown): string {
  const code = nonEmptyString(value, 'Kovo diagnostic code');
  if (!/^(?:KV\d{3}|KOVO_[A-Z0-9_]+)$/u.test(code)) {
    throw new TypeError('Kovo diagnostic code must be KV### or KOVO_*.');
  }
  return code;
}

function diagnosticSeverity(value: unknown): DiagnosticSeverity {
  if (value !== 'error' && value !== 'warn' && value !== 'lint' && value !== 'notice') {
    throw new TypeError('Kovo diagnostic severity is invalid.');
  }
  return value;
}

function diagnosticFormat(value: unknown): KovoDiagnosticFormat {
  if (value !== 'github' && value !== 'human' && value !== 'json') {
    throw new TypeError('Kovo diagnostic format is invalid.');
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function sourceOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Kovo diagnostic source span must be a finite increasing range.');
  }
  return value;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function registryAdd(registry: WeakSet<object>, value: object): void {
  nativeReflectApply(nativeWeakSetAdd, registry, [value]);
}

function registryHas(registry: WeakSet<object>, value: object): boolean {
  return nativeReflectApply(nativeWeakSetHas, registry, [value]) as boolean;
}

function formatGithubDiagnostic(diagnostic: KovoDiagnosticRecord): string {
  assertKovoDiagnosticRecord(diagnostic, 'diagnostic');
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
