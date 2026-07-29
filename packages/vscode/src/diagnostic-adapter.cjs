'use strict';

const path = require('node:path');

const KOVO_DIAGNOSTIC_VERSION = 'kovo-diagnostic/v1';
const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTICS = 4096;
const MAX_CODE_BYTES = 64;
const MAX_FILE_BYTES = 4096;
const MAX_HELP_BYTES = 256 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const codePattern = /^(?:KV[0-9]{3}|KOVO_[A-Z0-9_]{1,59})$/u;
const categories = new Set(['build', 'config', 'proof', 'runtime', 'usage']);
const severities = new Set(['error', 'warn', 'lint', 'notice']);

/**
 * Parse and snapshot one complete producer-owned diagnostic envelope.
 *
 * The adapter validates the versioned transport and resource bounds. It deliberately has no
 * diagnostic definition table: code, severity, help, and source remain producer facts
 * (SPEC §11.4).
 *
 * @param {string} text
 */
function parseDiagnosticEnvelopeText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('Kovo diagnostic envelope must be UTF-8 text.');
  }
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength === 0 || byteLength > MAX_ENVELOPE_BYTES) {
    throw new TypeError(
      `Kovo diagnostic envelope must contain 1..${String(MAX_ENVELOPE_BYTES)} UTF-8 bytes.`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('Kovo diagnostic envelope is not valid JSON.');
  }

  const fields = exactRecord(parsed, {
    allowed: ['diagnostics', 'result', 'version'],
    label: 'Kovo diagnostic envelope',
    required: ['diagnostics', 'version'],
  });
  if (fields.version !== KOVO_DIAGNOSTIC_VERSION) {
    throw new TypeError(`Kovo diagnostic envelope version must be ${KOVO_DIAGNOSTIC_VERSION}.`);
  }
  if (!Array.isArray(fields.diagnostics) || fields.diagnostics.length > MAX_DIAGNOSTICS) {
    throw new TypeError(
      `Kovo diagnostic envelope requires at most ${String(MAX_DIAGNOSTICS)} diagnostics.`,
    );
  }

  const diagnostics = fields.diagnostics.map((value, index) =>
    snapshotDiagnostic(value, `diagnostics[${String(index)}]`),
  );
  const result =
    fields.result === undefined ? undefined : snapshotCommandResult(fields.result, 'result');
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    ...(result === undefined ? {} : { result }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

/**
 * Create the exact fact projection and editor-only severity/range representation.
 *
 * @param {Readonly<Record<string, unknown>>} record
 * @param {{getText(): string, positionAt(offset: number): {line: number, character: number}}} document
 * @param {unknown} uri
 */
function createEditorDiagnosticProjection(record, document, uri) {
  const normalized = snapshotDiagnostic(record, 'diagnostic');
  if (normalized.source === undefined) {
    throw new TypeError('An editor Problem requires a producer-owned source anchor.');
  }
  if (
    document === null ||
    typeof document !== 'object' ||
    typeof document.getText !== 'function' ||
    typeof document.positionAt !== 'function'
  ) {
    throw new TypeError('Kovo editor projection requires an opened source document.');
  }
  const sourceText = document.getText();
  if (typeof sourceText !== 'string' || normalized.source.end > sourceText.length) {
    throw new TypeError('Kovo diagnostic source span is outside the opened source document.');
  }
  const start = editorPosition(document.positionAt(normalized.source.start), 'start');
  const end = editorPosition(document.positionAt(normalized.source.end), 'end');
  const facts = Object.freeze({
    code: normalized.code,
    ...(normalized.help === undefined ? {} : { help: normalized.help }),
    severity: normalized.severity,
    source: normalized.source,
  });
  return Object.freeze({
    facts,
    message: normalized.message,
    range: Object.freeze({ end, start }),
    uri,
    vscodeSeverity: vscodeSeverity(normalized.severity),
  });
}

/**
 * Convert a validated projection to VS Code's presentation object.
 *
 * Help remains an exact producer string in related information at the same producer-owned
 * location. No replacement location is invented.
 *
 * @param {Record<string, any>} vscode
 * @param {ReturnType<typeof createEditorDiagnosticProjection>} projection
 */
function createVscodeDiagnostic(vscode, projection) {
  const range = new vscode.Range(
    projection.range.start.line,
    projection.range.start.character,
    projection.range.end.line,
    projection.range.end.character,
  );
  const diagnostic = new vscode.Diagnostic(
    range,
    projection.message,
    vscodeDiagnosticSeverity(vscode, projection.vscodeSeverity),
  );
  diagnostic.code = projection.facts.code;
  diagnostic.source = 'Kovo';
  if (projection.facts.help !== undefined) {
    diagnostic.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(projection.uri, range),
        projection.facts.help,
      ),
    ];
  }
  return diagnostic;
}

/**
 * Resolve a producer source path under exactly one workspace folder.
 *
 * @param {string} workspaceRootPath
 * @param {string} sourceFile
 */
function resolveWorkspaceSourcePath(workspaceRootPath, sourceFile) {
  const root = nonEmptyString(workspaceRootPath, 'Kovo workspace root', MAX_FILE_BYTES);
  const file = nonEmptyString(sourceFile, 'Kovo diagnostic source file', MAX_FILE_BYTES);
  if (file.includes('\0')) {
    throw new TypeError('Kovo diagnostic source file must not contain NUL.');
  }
  const canonicalRoot = path.resolve(root);
  const candidate = path.resolve(canonicalRoot, file);
  const relative = path.relative(canonicalRoot, candidate);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new TypeError('Kovo diagnostic source file resolves outside the workspace folder.');
  }
  return candidate;
}

/**
 * Resolve the configured watched artifact. Configuration is intentionally workspace-relative.
 *
 * @param {string} workspaceRootPath
 * @param {string} configuredPath
 */
function resolveDiagnosticArtifactPath(workspaceRootPath, configuredPath) {
  const value = nonEmptyString(configuredPath, 'Kovo diagnostics file setting', MAX_FILE_BYTES);
  if (path.isAbsolute(value)) {
    throw new TypeError('Kovo diagnostics file setting must be workspace-relative.');
  }
  return resolveWorkspaceSourcePath(workspaceRootPath, value);
}

/**
 * Construct the only source-changing command the extension can invoke.
 *
 * There is no diagnostic-code dispatch here: `kovo fix` owns and re-proves its closed safe recipe
 * set. ProcessExecution receives this tuple with no shell.
 *
 * @param {{pnpmPath: string, sourceFilePath: string, workspaceRootPath: string}} input
 */
function safeFixInvocation(input) {
  const command = nonEmptyString(input.pnpmPath, 'Kovo diagnostics pnpm path', 4096);
  if (command.includes('\0')) {
    throw new TypeError('Kovo diagnostics pnpm path must not contain NUL.');
  }
  const sourceFilePath = resolveWorkspaceSourcePath(input.workspaceRootPath, input.sourceFilePath);
  const extension = path.extname(sourceFilePath).toLowerCase();
  if (extension !== '.tsx' && extension !== '.jsx') {
    throw new TypeError('Kovo safe fixes accept only app-authored TSX or JSX files.');
  }
  const root = path.resolve(input.workspaceRootPath);
  const relative = path.relative(root, sourceFilePath).split(path.sep).join('/');
  return Object.freeze({
    args: Object.freeze(['exec', 'kovo', 'fix', relative]),
    command,
    cwd: root,
  });
}

/** @param {Readonly<Record<string, unknown>>} record */
function formatSourceLessDiagnostic(record) {
  const normalized = snapshotDiagnostic(record, 'diagnostic');
  if (normalized.source !== undefined) {
    throw new TypeError('Source-less diagnostic formatting received a source anchor.');
  }
  return `${normalized.severity.toUpperCase()} ${normalized.code} ${normalized.message}${
    normalized.help === undefined ? '' : `\nHELP ${normalized.help}`
  }`;
}

function snapshotDiagnostic(value, label) {
  const fields = exactRecord(value, {
    allowed: ['category', 'code', 'help', 'message', 'severity', 'source', 'version'],
    label: `Kovo ${label}`,
    required: ['category', 'code', 'message', 'severity', 'version'],
  });
  if (fields.version !== KOVO_DIAGNOSTIC_VERSION) {
    throw new TypeError(`Kovo ${label}.version must be ${KOVO_DIAGNOSTIC_VERSION}.`);
  }
  if (!categories.has(fields.category)) {
    throw new TypeError(`Kovo ${label}.category is invalid.`);
  }
  const code = nonEmptyString(fields.code, `Kovo ${label}.code`, MAX_CODE_BYTES);
  if (!codePattern.test(code)) {
    throw new TypeError(`Kovo ${label}.code is invalid.`);
  }
  if (!severities.has(fields.severity)) {
    throw new TypeError(`Kovo ${label}.severity is invalid.`);
  }
  const message = nonEmptyString(fields.message, `Kovo ${label}.message`, MAX_MESSAGE_BYTES);
  const help =
    fields.help === undefined
      ? undefined
      : nonEmptyString(fields.help, `Kovo ${label}.help`, MAX_HELP_BYTES);
  const source =
    fields.source === undefined ? undefined : snapshotSource(fields.source, `${label}.source`);
  return Object.freeze({
    category: fields.category,
    code,
    ...(help === undefined ? {} : { help }),
    message,
    severity: fields.severity,
    ...(source === undefined ? {} : { source }),
    version: KOVO_DIAGNOSTIC_VERSION,
  });
}

function snapshotSource(value, label) {
  const fields = exactRecord(value, {
    allowed: ['end', 'file', 'start'],
    label: `Kovo ${label}`,
    required: ['end', 'file', 'start'],
  });
  const file = nonEmptyString(fields.file, `Kovo ${label}.file`, MAX_FILE_BYTES);
  if (file.includes('\0')) {
    throw new TypeError(`Kovo ${label}.file must not contain NUL.`);
  }
  const start = sourceOffset(fields.start, label);
  const end = sourceOffset(fields.end, label);
  if (end < start) {
    throw new TypeError(`Kovo ${label} must be an increasing range.`);
  }
  return Object.freeze({ end, file, start });
}

function snapshotCommandResult(value, label) {
  const fields = exactRecord(value, {
    allowed: ['command', 'exitCode', 'protocol', 'text'],
    label: `Kovo diagnostic ${label}`,
    required: ['command', 'exitCode', 'protocol', 'text'],
  });
  if (fields.exitCode !== 0 && fields.exitCode !== 1 && fields.exitCode !== 2) {
    throw new TypeError(`Kovo diagnostic ${label}.exitCode is invalid.`);
  }
  return Object.freeze({
    command: nonEmptyString(fields.command, `Kovo diagnostic ${label}.command`, 4096),
    exitCode: fields.exitCode,
    protocol: nonEmptyString(fields.protocol, `Kovo diagnostic ${label}.protocol`, 4096),
    text: nonEmptyString(fields.text, `Kovo diagnostic ${label}.text`, MAX_ENVELOPE_BYTES),
  });
}

function exactRecord(value, options) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${options.label} must be an ordinary object.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length !== 0) {
    throw new TypeError(`${options.label} must not contain symbol fields.`);
  }
  const keys = Object.keys(descriptors);
  const allowed = new Set(options.allowed);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (
      !allowed.has(key) ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      throw new TypeError(`${options.label} contains an unsupported field.`);
    }
  }
  for (const key of options.required) {
    if (!Object.hasOwn(descriptors, key)) {
      throw new TypeError(`${options.label}.${key} is required.`);
    }
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function nonEmptyString(value, label, maxBytes) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new TypeError(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function sourceOffset(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Kovo ${label} offsets must be non-negative safe integers.`);
  }
  return value;
}

function editorPosition(value, label) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Number.isSafeInteger(value.line) ||
    value.line < 0 ||
    !Number.isSafeInteger(value.character) ||
    value.character < 0
  ) {
    throw new TypeError(`Kovo editor ${label} position is invalid.`);
  }
  return Object.freeze({ character: value.character, line: value.line });
}

function vscodeSeverity(severity) {
  if (severity === 'error') return 'error';
  if (severity === 'warn') return 'warning';
  if (severity === 'lint') return 'information';
  return 'hint';
}

function vscodeDiagnosticSeverity(vscode, severity) {
  if (severity === 'error') return vscode.DiagnosticSeverity.Error;
  if (severity === 'warning') return vscode.DiagnosticSeverity.Warning;
  if (severity === 'information') return vscode.DiagnosticSeverity.Information;
  return vscode.DiagnosticSeverity.Hint;
}

module.exports = Object.freeze({
  KOVO_DIAGNOSTIC_VERSION,
  MAX_DIAGNOSTICS,
  MAX_ENVELOPE_BYTES,
  createEditorDiagnosticProjection,
  createVscodeDiagnostic,
  formatSourceLessDiagnostic,
  parseDiagnosticEnvelopeText,
  resolveDiagnosticArtifactPath,
  resolveWorkspaceSourcePath,
  safeFixInvocation,
});
