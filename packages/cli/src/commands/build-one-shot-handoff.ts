import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA = 'kovo-build-one-shot-handoff/v1';
const handoffDirectoryPrefix = '.kovo-one-shot-';
const handoffMaxBytes = 128 * 1024 * 1024;
const digestPattern = /^sha256:([0-9a-f]{64})$/u;

export interface KovoBuildOneShotIdentity {
  readonly appModulePath: string;
  readonly compilerProvenanceDigest: string;
  readonly configSourceDigest: string | null;
  readonly invocationRoot: string;
  readonly optionsDigest: string;
  readonly sourceSetDigest: string;
}

export interface KovoBuildOneShotPayload {
  readonly analysis: unknown;
  readonly identity: KovoBuildOneShotIdentity;
  readonly schema: 'kovo-build-one-shot-analysis/v1';
}

interface KovoBuildOneShotEnvelope {
  readonly digest: string;
  readonly payload: string;
  readonly schema: typeof KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA;
}

export interface KovoBuildOneShotHandoffReference {
  readonly digest: string;
  readonly file: string;
}

export interface KovoBuildOneShotProducerControl {
  readonly identity: KovoBuildOneShotIdentity;
  readonly reference: KovoBuildOneShotHandoffReference;
  readonly schema: 'kovo-build-one-shot-producer/v1';
}

/** Create one unique, non-symlink handoff root directly beneath the real project root. */
export function createKovoBuildOneShotHandoffDirectory(invocationRoot: string): string {
  const root = realProjectRoot(invocationRoot);
  return mkdtempSync(join(root, handoffDirectoryPrefix));
}

/** Persist one immutable content-addressed envelope with owner-only permissions. */
export function writeKovoBuildOneShotHandoff(
  directory: string,
  payload: KovoBuildOneShotPayload,
): KovoBuildOneShotHandoffReference {
  assertHandoffDirectory(directory, payload.identity.invocationRoot);
  const payloadText = JSON.stringify(payload);
  const digest = sha256(payloadText);
  const match = digestPattern.exec(digest);
  if (match === null) throw new TypeError('Kovo build handoff digest construction failed.');
  const file = join(directory, `${match[1]}.json`);
  const envelope: KovoBuildOneShotEnvelope = {
    digest,
    payload: payloadText,
    schema: KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA,
  };
  const bytes = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(bytes) > handoffMaxBytes) {
    throw new TypeError('Kovo build handoff exceeded its byte limit.');
  }
  writeFileSync(file, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return Object.freeze({ digest, file });
}

/**
 * Authenticate and parse one producer-owned handoff.
 *
 * The caller supplies the digest received over the child-process pipe and the independently
 * reconstructed invocation identity. Project files can race the pathname, but cannot change
 * either authenticated value without detection.
 */
export function readKovoBuildOneShotHandoff(
  reference: KovoBuildOneShotHandoffReference,
  expectedIdentity: KovoBuildOneShotIdentity,
): KovoBuildOneShotPayload {
  assertDigest(reference.digest, 'expected');
  assertHandoffFile(reference.file, expectedIdentity.invocationRoot, reference.digest);
  const bytes = readFileSync(reference.file);
  if (bytes.byteLength > handoffMaxBytes) {
    throw new TypeError('Kovo build handoff exceeded its byte limit.');
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError('Kovo build handoff is malformed.');
  }
  if (!exactRecord(envelope, ['digest', 'payload', 'schema'])) {
    throw new TypeError('Kovo build handoff envelope is incomplete.');
  }
  if (
    envelope.schema !== KOVO_BUILD_ONE_SHOT_HANDOFF_SCHEMA ||
    typeof envelope.digest !== 'string' ||
    typeof envelope.payload !== 'string' ||
    envelope.digest !== reference.digest ||
    sha256(envelope.payload) !== reference.digest
  ) {
    throw new TypeError('Kovo build handoff envelope is unauthenticated.');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(envelope.payload);
  } catch {
    throw new TypeError('Kovo build handoff payload is malformed.');
  }
  if (!exactRecord(payload, ['analysis', 'identity', 'schema'])) {
    throw new TypeError('Kovo build handoff payload is incomplete.');
  }
  if (
    payload.schema !== 'kovo-build-one-shot-analysis/v1' ||
    !validIdentity(payload.identity) ||
    JSON.stringify(payload.identity) !== JSON.stringify(expectedIdentity)
  ) {
    throw new TypeError('Kovo build handoff identity is stale or belongs to another invocation.');
  }
  return payload as unknown as KovoBuildOneShotPayload;
}

export function kovoBuildOneShotDigest(value: unknown): string {
  return sha256(JSON.stringify(value));
}

export function parseKovoBuildOneShotProducerControl(
  output: string,
): KovoBuildOneShotProducerControl {
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new TypeError('Kovo build analysis worker returned malformed control output.');
  }
  if (!exactRecord(value, ['identity', 'reference', 'schema'])) {
    throw new TypeError('Kovo build analysis worker returned incomplete control output.');
  }
  if (
    value.schema !== 'kovo-build-one-shot-producer/v1' ||
    !validIdentity(value.identity) ||
    !exactRecord(value.reference, ['digest', 'file']) ||
    typeof value.reference.digest !== 'string' ||
    typeof value.reference.file !== 'string'
  ) {
    throw new TypeError('Kovo build analysis worker returned invalid control output.');
  }
  assertDigest(value.reference.digest, 'producer');
  return value as unknown as KovoBuildOneShotProducerControl;
}

function assertHandoffDirectory(directory: string, invocationRoot: string): void {
  const root = realProjectRoot(invocationRoot);
  const lexical = resolve(directory);
  const status = lstatSync(lexical);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new TypeError('Kovo build handoff root must be a non-symlink directory.');
  }
  const real = realpathSync(lexical);
  if (!isDirectHandoffChild(root, real)) {
    throw new TypeError('Kovo build handoff root is outside the project.');
  }
}

function assertHandoffFile(file: string, invocationRoot: string, digest: string): void {
  const match = digestPattern.exec(digest);
  if (match === null) throw new TypeError('Kovo build handoff expected digest is invalid.');
  assertHandoffDirectory(dirname(file), invocationRoot);
  if (basename(file) !== `${match[1]}.json`) {
    throw new TypeError('Kovo build handoff filename is not content-addressed.');
  }
  const status = lstatSync(file);
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new TypeError('Kovo build handoff must be a regular non-symlink file.');
  }
}

function realProjectRoot(invocationRoot: string): string {
  const status = lstatSync(invocationRoot);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new TypeError('Kovo build invocation root must be a non-symlink directory.');
  }
  return realpathSync(invocationRoot);
}

function isDirectHandoffChild(root: string, directory: string): boolean {
  const child = relative(root, directory);
  return (
    child !== '' &&
    !child.startsWith(`..${sep}`) &&
    child !== '..' &&
    !child.includes(sep) &&
    child.startsWith(handoffDirectoryPrefix)
  );
}

function validIdentity(value: unknown): value is KovoBuildOneShotIdentity {
  return (
    exactRecord(value, [
      'appModulePath',
      'compilerProvenanceDigest',
      'configSourceDigest',
      'invocationRoot',
      'optionsDigest',
      'sourceSetDigest',
    ]) &&
    typeof value.appModulePath === 'string' &&
    typeof value.compilerProvenanceDigest === 'string' &&
    (value.configSourceDigest === null || typeof value.configSourceDigest === 'string') &&
    typeof value.invocationRoot === 'string' &&
    typeof value.optionsDigest === 'string' &&
    typeof value.sourceSetDigest === 'string'
  );
}

function exactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function assertDigest(value: string, label: string): void {
  if (!digestPattern.test(value)) {
    throw new TypeError(`Kovo build handoff ${label} digest is invalid.`);
  }
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
