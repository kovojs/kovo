// Presentation-only snapshot of producer-owned kovo-diagnostic/v1 facts.
//
// The devtool deliberately has no diagnostic registry or source analyzer. It accepts the same
// bounded envelope records as the editor adapter, copies only the versioned presentation fields,
// and carries the producer's exact source span into UI/MCP cards (SPEC §5.3 / §11.4).
import {
  arrayAppend,
  arrayIncludes,
  arrayLength,
  arrayValue,
  assertPlainCarrier,
  freeze,
  isArray,
  isSafeInteger,
  objectKeys,
  regexpTest,
  stableOwnData,
  stringIncludes,
} from './output-security.mjs';

export const KOVO_DIAGNOSTIC_VERSION = 'kovo-diagnostic/v1';

const CODE_PATTERN = /^(?:KV[0-9]{3}|KOVO_[A-Z0-9_]{1,59})$/u;
const CATEGORIES = freeze(['build', 'config', 'proof', 'runtime', 'usage']);
const SEVERITIES = freeze(['error', 'warn', 'lint', 'notice']);
const DIAGNOSTIC_FIELDS = freeze([
  'category',
  'code',
  'help',
  'message',
  'severity',
  'source',
  'version',
]);
const SOURCE_FIELDS = freeze(['end', 'file', 'start']);
const MAX_DIAGNOSTICS = 4_096;
const MAX_CODE_LENGTH = 64;
const MAX_FILE_LENGTH = 4_096;
const MAX_HELP_LENGTH = 256 * 1_024;
const MAX_MESSAGE_LENGTH = 64 * 1_024;

function own(record, key, label, required = false) {
  const property = stableOwnData(record, key, label);
  if (required && !property.found) throw new TypeError(`${label}.${key} is required.`);
  return property.value;
}

function boundedText(value, label, maximum, required = true) {
  if (typeof value !== 'string' || (required && value.length === 0) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded${required ? ' non-empty' : ''} string.`);
  }
  return value;
}

function enumText(value, vocabulary, label) {
  const candidate = boundedText(value, label, MAX_CODE_LENGTH);
  for (let index = 0; index < arrayLength(vocabulary, `${label} vocabulary`); index += 1) {
    if (candidate === arrayValue(vocabulary, index, `${label} vocabulary`)) return candidate;
  }
  throw new TypeError(`${label} is invalid.`);
}

function assertExactFields(record, allowed, label) {
  const keys = objectKeys(record, label);
  for (let index = 0; index < arrayLength(keys, `${label} keys`); index += 1) {
    const key = arrayValue(keys, index, `${label} keys`);
    if (!arrayIncludes(allowed, key, `${label} allowed fields`)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

export function snapshotDiagnosticSource(value, label = 'Kovo diagnostic source') {
  const record = assertPlainCarrier(value, label);
  assertExactFields(record, SOURCE_FIELDS, label);
  const file = boundedText(own(record, 'file', label, true), `${label}.file`, MAX_FILE_LENGTH);
  const start = own(record, 'start', label, true);
  const end = own(record, 'end', label, true);
  if (stringIncludes(file, '\0')) throw new TypeError(`${label}.file must not contain NUL.`);
  if (!isSafeInteger(start) || !isSafeInteger(end) || start < 0 || end < start) {
    throw new TypeError(`${label} offsets must be ordered safe integers.`);
  }
  return freeze({ end, file, start });
}

export function snapshotDiagnostic(value, label = 'Kovo diagnostic') {
  const record = assertPlainCarrier(value, label);
  assertExactFields(record, DIAGNOSTIC_FIELDS, label);
  const version = own(record, 'version', label, true);
  if (version !== KOVO_DIAGNOSTIC_VERSION) {
    throw new TypeError(`${label}.version must be ${KOVO_DIAGNOSTIC_VERSION}.`);
  }
  const code = boundedText(own(record, 'code', label, true), `${label}.code`, MAX_CODE_LENGTH);
  if (!regexpTest(CODE_PATTERN, code)) throw new TypeError(`${label}.code is invalid.`);
  const helpValue = own(record, 'help', label);
  const sourceValue = own(record, 'source', label);
  return freeze({
    category: enumText(own(record, 'category', label, true), CATEGORIES, `${label}.category`),
    code,
    ...(helpValue === undefined
      ? {}
      : { help: boundedText(helpValue, `${label}.help`, MAX_HELP_LENGTH) }),
    message: boundedText(
      own(record, 'message', label, true),
      `${label}.message`,
      MAX_MESSAGE_LENGTH,
    ),
    severity: enumText(own(record, 'severity', label, true), SEVERITIES, `${label}.severity`),
    ...(sourceValue === undefined
      ? {}
      : { source: snapshotDiagnosticSource(sourceValue, `${label}.source`) }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

export function snapshotDiagnostics(value, label = 'Kovo diagnostics') {
  if (!isArray(value)) throw new TypeError(`${label} must be an array.`);
  const length = arrayLength(value, label);
  if (length > MAX_DIAGNOSTICS) {
    throw new TypeError(`${label} exceeds the ${MAX_DIAGNOSTICS}-record budget.`);
  }
  const diagnostics = [];
  for (let index = 0; index < length; index += 1) {
    arrayAppend(
      diagnostics,
      snapshotDiagnostic(arrayValue(value, index, label), `${label}[${index}]`),
      label,
    );
  }
  return freeze(diagnostics);
}
