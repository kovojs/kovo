/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */
import type { DiagnosticCode, DiagnosticSeverity, RegisteredDiagnostic } from '@kovojs/core';
import {
  assertRegisteredDiagnostic,
  diagnosticDefinitions,
  isDiagnosticCode,
} from '@kovojs/core/internal/diagnostics';

/** Stable wire version accepted by Kovo's public human, JSON, and GitHub renderers. */
export const KOVO_DIAGNOSTIC_VERSION = 'kovo-diagnostic/v1' as const;

/** Exact authored-source anchor using zero-based UTF-16 offsets and an exclusive end. */
export interface KovoDiagnosticSourceAnchor {
  readonly end: number;
  readonly file: string;
  readonly start: number;
}

/** Stable categories used to classify CLI process behavior. */
export type KovoDiagnosticCategory = 'build' | 'config' | 'proof' | 'runtime' | 'usage';

const CLI_DIAGNOSTIC_DEFINITIONS = {
  KOVO_DOCTOR_CACHE: {
    category: 'config',
    help: 'Run `kovo doctor --fix` to remove only the stale derived cache, then rerun `kovo check`.',
    severity: 'error',
  },
  KOVO_DOCTOR_CONFIG: {
    category: 'config',
    help: 'Create or correct `kovo.config.ts`, select one supported preset, then rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_DOCTOR_DATABASE: {
    category: 'config',
    help: 'Configure the named database roles and run `kovo db check` before starting the app.',
    severity: 'error',
  },
  KOVO_DOCTOR_DUPLICATE_PACKAGE: {
    category: 'config',
    help: 'Run `pnpm dedupe`, reinstall from the lockfile, and rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_DOCTOR_MIGRATIONS: {
    category: 'config',
    help: 'Run `kovo db generate` and `kovo db migrate`, then rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_DOCTOR_NODE: {
    category: 'config',
    help: 'Install the Node version required by package.json and rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_DOCTOR_ORIGIN: {
    category: 'config',
    help: 'Use automatic loopback development origin, or set one fixed HTTPS deployment origin.',
    severity: 'error',
  },
  KOVO_DOCTOR_PACKAGE_MANAGER: {
    category: 'config',
    help: 'Install and use the exact pnpm version declared by package.json, then rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_DOCTOR_PEER: {
    category: 'config',
    help: 'Align the declared peer and installed package versions, reinstall, then rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_DOCTOR_RETENTION: {
    category: 'config',
    help: 'Declare the preset retention proof in `kovo.config.ts`, then run `kovo build`.',
    severity: 'error',
  },
  KOVO_DOCTOR_WRITABLE: {
    category: 'config',
    help: 'Restore write access to the project and `.kovo` paths, then rerun `kovo doctor`.',
    severity: 'error',
  },
  KOVO_BUILD_FINDING: {
    category: 'build',
    help: 'Resolve the reported build finding and rerun the command.',
    severity: 'error',
  },
  KOVO_CONFIG_FINDING: {
    category: 'config',
    help: 'Correct the reported configuration and rerun the command.',
    severity: 'error',
  },
  KOVO_DIAGNOSTIC_CONTRACT: {
    category: 'runtime',
    help: 'Report this framework defect; the command must return authenticated diagnostic facts.',
    severity: 'error',
  },
  KOVO_PROOF_FINDING: {
    category: 'proof',
    help: 'Inspect the cited source proof and rerun the command.',
    severity: 'error',
  },
  KOVO_RUNTIME_FINDING: {
    category: 'runtime',
    help: 'Resolve the reported runtime finding and rerun the command.',
    severity: 'error',
  },
  KOVO_USAGE: {
    category: 'usage',
    help: 'Run `kovo --help` or `kovo help <command>` for generated usage.',
    severity: 'error',
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly category: KovoDiagnosticCategory;
      readonly help: string;
      readonly severity: DiagnosticSeverity;
    }
  >
>;

/** Finite framework-owned code vocabulary for CLI/process facts. */
export type KovoCliDiagnosticCode = keyof typeof CLI_DIAGNOSTIC_DEFINITIONS;

/** @internal Doctor-owned subset of the finite CLI diagnostic registry. */
export type KovoDoctorDiagnosticCode = Extract<KovoCliDiagnosticCode, `KOVO_DOCTOR_${string}`>;

/**
 * One registry-authenticated, transport-neutral diagnostic record.
 *
 * `KV###` records can only be projected from an exact core-registry object. CLI/process records
 * can only be minted by the private finite registry above. The serialized fields are evidence,
 * not authority: copies and cross-realm lookalikes are never accepted by local renderers.
 */
export interface KovoDiagnosticRecord {
  readonly category: KovoDiagnosticCategory;
  readonly code: DiagnosticCode | KovoCliDiagnosticCode;
  readonly help?: string;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
  readonly source?: KovoDiagnosticSourceAnchor;
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
}

/** Serialized `kovo-diagnostic/v1` envelope emitted by machine-readable adapters. */
export interface KovoDiagnosticEnvelope {
  readonly diagnostics: readonly KovoDiagnosticRecord[];
  /** Present when a command adapter also preserves its existing fact protocol. */
  readonly result?: KovoDiagnosticCommandResult;
  readonly version: typeof KOVO_DIAGNOSTIC_VERSION;
}

/** Existing command result carried intact beside the shared diagnostics. */
export interface KovoDiagnosticCommandResult {
  readonly command: string;
  readonly exitCode: 0 | 1 | 2;
  readonly protocol: string;
  readonly text: string;
}

/** Presentation adapters supported by {@link formatKovoDiagnostics}. */
export type KovoDiagnosticFormat = 'github' | 'human' | 'json';

const nativeArrayIsArray = Array.isArray;
const nativeObjectFreeze = Object.freeze;
const nativeObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const nativeObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const nativeObjectGetPrototypeOf = Object.getPrototypeOf;
const nativeObjectKeys = Object.keys;
const nativeObjectPrototype = Object.prototype;
const nativeReflectApply = Reflect.apply;
const nativeWeakSetAdd = WeakSet.prototype.add;
const nativeWeakSetHas = WeakSet.prototype.has;
const diagnosticRegistry = new WeakSet<object>();
const envelopeRegistry = new WeakSet<object>();

/**
 * Project one constructor-authenticated core diagnostic into the stable CLI wire record.
 *
 * This is deliberately not a structural constructor. Code, severity, message, and contextual
 * help cross only after the originating core realm proves exact WeakSet membership (SPEC §11).
 */
export function projectKovoDiagnostic(
  diagnostic: RegisteredDiagnostic,
  category: Exclude<KovoDiagnosticCategory, 'usage'>,
): KovoDiagnosticRecord {
  assertRegisteredDiagnostic(diagnostic, 'Kovo diagnostic projection source');
  const normalizedCategory = diagnosticCategory(category);
  if (normalizedCategory === 'usage') {
    throw new TypeError('Registered KV diagnostics cannot be projected as usage errors.');
  }

  const code = ownDataValue(diagnostic, 'code', 'Kovo diagnostic projection');
  const severity = ownDataValue(diagnostic, 'severity', 'Kovo diagnostic projection');
  const message = ownDataValue(diagnostic, 'message', 'Kovo diagnostic projection');
  const help = ownDataValue(diagnostic, 'help', 'Kovo diagnostic projection');
  const sourceValue = ownDataValue(diagnostic, 'source', 'Kovo diagnostic projection');
  if (!isDiagnosticCode(code)) {
    throw new TypeError('Kovo diagnostic projection source has an unregistered code.');
  }
  const normalizedSeverity = diagnosticSeverity(severity);
  if (normalizedSeverity !== diagnosticDefinitions[code].severity) {
    throw new TypeError(`Kovo diagnostic ${code} severity does not match its registry.`);
  }
  const normalizedMessage = nonEmptyString(message, 'Kovo diagnostic message');
  const normalizedHelp =
    help === undefined ? undefined : nonEmptyString(help, 'Kovo diagnostic help');
  const source =
    sourceValue === undefined ? undefined : validateSourceAnchor(sourceValue, 'projection source');

  return enrollDiagnostic({
    category: normalizedCategory,
    code,
    ...(normalizedHelp === undefined ? {} : { help: normalizedHelp }),
    message: normalizedMessage,
    severity: normalizedSeverity,
    ...(source === undefined ? {} : { source }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

/** @internal Create a registry-authenticated frozen envelope. */
export function createKovoDiagnosticEnvelope(
  diagnostics: readonly KovoDiagnosticRecord[],
): KovoDiagnosticEnvelope {
  if (!nativeReflectApply(nativeArrayIsArray, Array, [diagnostics])) {
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

/**
 * Render records created by this module as human text, the versioned JSON envelope, or escaped
 * GitHub workflow commands. Every adapter reads the already-projected fields; none consults the
 * diagnostic definition registry or reparses command text.
 */
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
  return envelope.diagnostics.map(formatHumanDiagnostic).join('');
}

/**
 * @internal Render one command's authenticated diagnostics and exact versioned result facts.
 *
 * JSON and GitHub are adapters over the same records. GitHub annotations are followed by the
 * unchanged command fact text so CI logs do not lose a successful or failed proof protocol.
 */
export function formatKovoDiagnosticCommandResult(
  diagnostics: readonly KovoDiagnosticRecord[],
  result: KovoDiagnosticCommandResult,
  format: Exclude<KovoDiagnosticFormat, 'human'>,
): string {
  const envelope = createKovoDiagnosticEnvelope(diagnostics);
  if (
    result.command.length === 0 ||
    result.protocol.length === 0 ||
    (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) ||
    result.text.length === 0
  ) {
    throw new TypeError('Kovo diagnostic command result facts are invalid.');
  }
  if (format === 'github') {
    return `${formatKovoDiagnostics(envelope.diagnostics, 'github')}${result.text}`;
  }
  return `${JSON.stringify({
    diagnostics: envelope.diagnostics,
    result: Object.freeze({ ...result }),
    version: envelope.version,
  })}\n`;
}

/** @internal Snapshot one exact source anchor before enrolling it in a trusted producer catalog. */
export function snapshotKovoDiagnosticSourceAnchor(
  value: unknown,
  label = 'source',
): KovoDiagnosticSourceAnchor {
  return validateSourceAnchor(value, label);
}

/** @internal Create the standard invocation-error record used by argv adapters. */
export function usageDiagnostic(message: string): KovoDiagnosticRecord {
  return createCliDiagnostic('KOVO_USAGE', message);
}

/** @internal Create a finite CLI-owned record for a non-usage command finding. */
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
  return createCliDiagnostic(code, message);
}

/** @internal Mint one doctor finding from the finite doctor registry. */
export function doctorFindingDiagnostic(
  code: KovoDoctorDiagnosticCode,
  message: string,
  source?: KovoDiagnosticSourceAnchor,
): KovoDiagnosticRecord {
  return createCliDiagnostic(code, message, source);
}

/**
 * @internal Fail visibly when a legacy producer returned prose without authenticated facts.
 *
 * The prose is intentionally not copied into this record: parsing or relabeling a transcript
 * would manufacture diagnostic authority and collapse multiple facts into one.
 */
export function diagnosticContractDiagnostic(
  category: Exclude<KovoDiagnosticCategory, 'usage'>,
): KovoDiagnosticRecord {
  return createCliDiagnostic(
    'KOVO_DIAGNOSTIC_CONTRACT',
    `Kovo ${category} command returned a failing result without structured diagnostics.`,
  );
}

function createCliDiagnostic(
  code: KovoCliDiagnosticCode,
  message: string,
  sourceValue?: KovoDiagnosticSourceAnchor,
): KovoDiagnosticRecord {
  const definition = CLI_DIAGNOSTIC_DEFINITIONS[code];
  const source =
    sourceValue === undefined ? undefined : validateSourceAnchor(sourceValue, 'CLI source');
  return enrollDiagnostic({
    category: definition.category,
    code,
    help: definition.help,
    message: cliDiagnosticMessage(message),
    severity: definition.severity,
    ...(source === undefined ? {} : { source }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

function enrollDiagnostic(record: KovoDiagnosticRecord): KovoDiagnosticRecord {
  const enrolled = nativeObjectFreeze(record);
  registryAdd(diagnosticRegistry, enrolled);
  return enrolled;
}

function assertKovoDiagnosticRecord(value: unknown, label: string): KovoDiagnosticRecord {
  if (!isObject(value) || !registryHas(diagnosticRegistry, value)) {
    throw new TypeError(`${label} lacks local Kovo diagnostic registry identity.`);
  }
  return value as KovoDiagnosticRecord;
}

function ownDataValue(value: object, key: string, label: string): unknown {
  const descriptors = nativeReflectApply(nativeObjectGetOwnPropertyDescriptors, Object, [
    value,
  ]) as Record<string, PropertyDescriptor>;
  const descriptor = descriptors[key];
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${key} must be an own data field.`);
  }
  return descriptor.value;
}

function exactOwnDataFields(
  value: unknown,
  options: {
    readonly allowed: readonly string[];
    readonly label: string;
    readonly required: readonly string[];
  },
): Readonly<Record<string, unknown>> {
  if (!isObject(value) || nativeReflectApply(nativeArrayIsArray, Array, [value])) {
    throw new TypeError(`${options.label} must be an exact own-data object.`);
  }
  const prototype = nativeReflectApply(nativeObjectGetPrototypeOf, Object, [value]) as unknown;
  if (prototype !== nativeObjectPrototype && prototype !== null) {
    throw new TypeError(`${options.label} must not carry a custom prototype.`);
  }
  const symbols = nativeReflectApply(nativeObjectGetOwnPropertySymbols, Object, [
    value,
  ]) as symbol[];
  if (symbols.length > 0) throw new TypeError(`${options.label} must not contain symbol fields.`);
  const descriptors = nativeReflectApply(nativeObjectGetOwnPropertyDescriptors, Object, [
    value,
  ]) as Record<string, PropertyDescriptor>;
  const keys = nativeReflectApply(nativeObjectKeys, Object, [descriptors]) as string[];
  for (const key of keys) {
    if (!options.allowed.includes(key)) {
      throw new TypeError(`${options.label} contains surplus field ${JSON.stringify(key)}.`);
    }
    if (!('value' in descriptors[key]!)) {
      throw new TypeError(`${options.label}.${key} must be an own data field.`);
    }
  }
  for (const key of options.required) {
    if (descriptors[key] === undefined) {
      throw new TypeError(`${options.label} is missing field ${JSON.stringify(key)}.`);
    }
  }
  const fields: Record<string, unknown> = {};
  for (const key of keys) fields[key] = descriptors[key]!.value;
  return nativeObjectFreeze(fields);
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

function diagnosticFormat(value: unknown): KovoDiagnosticFormat {
  if (value !== 'github' && value !== 'human' && value !== 'json') {
    throw new TypeError('Kovo diagnostic format is invalid.');
  }
  return value;
}

function diagnosticSeverity(value: unknown): DiagnosticSeverity {
  if (value !== 'error' && value !== 'warn' && value !== 'lint' && value !== 'notice') {
    throw new TypeError('Kovo diagnostic severity is invalid.');
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function cliDiagnosticMessage(value: unknown): string {
  const message = nonEmptyString(value, 'Kovo diagnostic message').replace(/(?:\r?\n)+$/u, '');
  if (message.length === 0) {
    throw new TypeError('Kovo diagnostic message must contain non-line-break text.');
  }
  return message;
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

function sourceLabel(source: KovoDiagnosticSourceAnchor | undefined): string {
  return source === undefined ? '' : ` ${source.file}[${source.start}:${source.end}]`;
}

function formatHumanDiagnostic(diagnostic: KovoDiagnosticRecord): string {
  assertKovoDiagnosticRecord(diagnostic, 'diagnostic');
  const header = `${diagnostic.severity.toUpperCase()} ${diagnostic.code}${sourceLabel(diagnostic.source)} ${diagnostic.message}\n`;
  return diagnostic.help === undefined ? header : `${header}HELP ${diagnostic.help}\n`;
}

function formatGithubDiagnostic(diagnostic: KovoDiagnosticRecord): string {
  assertKovoDiagnosticRecord(diagnostic, 'diagnostic');
  const level =
    diagnostic.severity === 'error'
      ? 'error'
      : diagnostic.severity === 'warn'
        ? 'warning'
        : 'notice';
  const properties: string[] = [];
  if (diagnostic.source !== undefined) {
    properties.push(`file=${githubProperty(diagnostic.source.file)}`);
  }
  const range =
    diagnostic.source === undefined ? '' : ` [${diagnostic.source.start}:${diagnostic.source.end}]`;
  const title = githubProperty(`${diagnostic.code} ${diagnostic.category}${range}`);
  properties.push(`title=${title}`);
  const body = githubMessage(
    `${diagnostic.message}${diagnostic.help === undefined ? '' : ` ${diagnostic.help}`}`,
  );
  return `::${level} ${properties.join(',')}::${body}\n`;
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
