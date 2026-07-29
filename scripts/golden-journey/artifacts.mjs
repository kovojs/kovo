import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const GOLDEN_FAILURE_ARTIFACT_SCHEMA = 'kovo.golden-journey/failure-artifact/v1';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_APP_BYTES = MAX_TOTAL_BYTES - 2 * MAX_FILE_BYTES;
const MAX_FILES = 4_096;
const METADATA_FILES = 2;
const MAX_TRANSCRIPTS = 32;
const MAX_OMISSION_RECORDS = 128;
const OMITTED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  '.vite',
  '.vitest',
  'pglite',
]);
const SECRET_ASSIGNMENT =
  /(^|[\s"'`])((?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|COOKIE)[A-Z0-9_]*)\s*[=:]\s*)([^\s"'`,;]+)/gimu;
const CREDENTIAL_URI =
  /\b((?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^:\s/@]+:)([^@\s/]+)(@)/giu;
const BEARER_VALUE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/giu;
const COOKIE_VALUE = /\b((?:set-cookie|cookie)\s*:\s*)[^\r\n]+/giu;

/**
 * Copy a failed generated app into a bounded artifact while removing every discovered `.env`
 * value and credential-shaped transcript value. The original secret file is never copied, and a
 * second scan rejects the artifact if an exact discovered value survived.
 */
export function preserveRedactedFailureArtifact({
  appRoot,
  artifactRoot,
  label,
  transcripts = [],
}) {
  const resolvedAppRoot = realDirectory(appRoot, 'failed app root');
  const resolvedArtifactRoot = path.resolve(artifactRoot);
  const safeLabel = safeArtifactLabel(label);
  const destination = path.join(resolvedArtifactRoot, 'failed', safeLabel);
  if (existsSync(destination)) {
    throw new Error(`failure artifact destination already exists: ${destination}`);
  }
  mkdirSync(destination, { recursive: true });
  const copiedApp = path.join(destination, 'app');
  mkdirSync(copiedApp);

  const secretInventory = discoverEnvSecrets(resolvedAppRoot);
  const records = [];
  const state = { files: 0, totalBytes: 0 };
  copyDirectory(resolvedAppRoot, copiedApp, '', {
    records,
    secretInventory,
    state,
  });
  assertArtifactFileBudget(state.files);

  const transcriptText = boundedTranscriptText(transcripts, secretInventory.values);
  assertWithinAggregateBound(state, Buffer.byteLength(transcriptText));
  writeFileSync(path.join(destination, 'command-transcripts.json'), transcriptText, {
    encoding: 'utf8',
    flag: 'wx',
  });
  state.files += 1;
  state.totalBytes += Buffer.byteLength(transcriptText);

  const manifest = {
    schema: GOLDEN_FAILURE_ARTIFACT_SCHEMA,
    appDirectory: 'app',
    copiedFiles: records.filter((record) => record.action === 'copied').length,
    omitted: boundedOmissionRecords(records),
    ...boundedEnvironmentKeyInventory(secretInventory.keys),
    transcript: 'command-transcripts.json',
    validation: {
      exactDiscoveredSecretsAbsent: true,
      credentialPatternsRedacted: true,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    },
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(manifestText) > MAX_FILE_BYTES) {
    throw new Error('failure artifact manifest cannot fit its per-file bound');
  }
  assertWithinAggregateBound(state, Buffer.byteLength(manifestText));
  writeFileSync(path.join(destination, 'redaction-manifest.json'), manifestText, {
    encoding: 'utf8',
    flag: 'wx',
  });

  assertRedactedArtifact(destination, secretInventory.values);
  return Object.freeze({
    directory: destination,
    manifest: path.join(destination, 'redaction-manifest.json'),
    redactedEnvironmentKeys: Object.freeze([...secretInventory.keys]),
    sha256: directoryDigest(destination),
  });
}

export function discoverEnvSecrets(appRoot) {
  const root = path.resolve(appRoot);
  const keys = new Set();
  const values = new Set();
  for (const name of readdirSync(root).sort(compareUtf8)) {
    if (name !== '.env' && !name.startsWith('.env.')) continue;
    if (name === '.env.example') continue;
    const file = path.join(root, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) continue;
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/u)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u.exec(rawLine);
      if (!match) continue;
      keys.add(match[1]);
      const value = unquoteEnvValue(match[2].trim());
      if (value.length >= 4) values.add(value);
    }
  }
  return Object.freeze({
    keys: Object.freeze([...keys].sort(compareUtf8)),
    values: Object.freeze([...values].sort((left, right) => right.length - left.length)),
  });
}

export function redactSecrets(text, exactSecrets = []) {
  let redacted = String(text);
  for (const secret of [...exactSecrets].sort((left, right) => right.length - left.length)) {
    if (typeof secret !== 'string' || secret.length < 4) continue;
    redacted = redacted.replaceAll(secret, '[REDACTED:DISCOVERED]');
  }
  redacted = redacted.replace(
    SECRET_ASSIGNMENT,
    (_match, prefix, assignment) => `${prefix}${assignment}[REDACTED]`,
  );
  redacted = redacted.replace(
    CREDENTIAL_URI,
    (_match, prefix, _password, suffix) => `${prefix}[REDACTED]${suffix}`,
  );
  redacted = redacted.replace(BEARER_VALUE, '$1[REDACTED]');
  redacted = redacted.replace(COOKIE_VALUE, '$1[REDACTED]');
  return redacted;
}

export function assertRedactedArtifact(artifactRoot, exactSecrets = []) {
  const root = realDirectory(artifactRoot, 'failure artifact');
  const findings = [];
  let files = 0;
  let totalBytes = 0;
  walkRegularFiles(root, (file, relative) => {
    const stat = lstatSync(file);
    files += 1;
    totalBytes += stat.size;
    if (stat.size > MAX_FILE_BYTES) {
      findings.push(`${relative}: artifact file exceeds the per-file bound`);
      return;
    }
    const bytes = readFileSync(file);
    if (bytes.includes(0)) return;
    const text = bytes.toString('utf8');
    for (const secret of exactSecrets) {
      if (typeof secret === 'string' && secret.length >= 4 && text.includes(secret)) {
        findings.push(`${relative}: contains an exact discovered secret`);
      }
    }
    if (redactSecrets(text, []) !== text) {
      findings.push(`${relative}: contains an unredacted credential-shaped value`);
    }
  });
  if (files > MAX_FILES) findings.push(`artifact contains more than ${String(MAX_FILES)} files`);
  if (totalBytes > MAX_TOTAL_BYTES) {
    findings.push(`artifact exceeds ${String(MAX_TOTAL_BYTES)} aggregate bytes`);
  }
  if (findings.length > 0) {
    throw new Error(`failure artifact redaction failed:\n- ${findings.join('\n- ')}`);
  }
}

function copyDirectory(sourceRoot, destinationRoot, relativeRoot, context) {
  const source = relativeRoot ? path.join(sourceRoot, ...relativeRoot.split('/')) : sourceRoot;
  for (const entry of readdirSync(source, { withFileTypes: true }).sort((left, right) =>
    compareUtf8(left.name, right.name),
  )) {
    const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    if (entry.isDirectory() && omittedDirectory(relative, entry.name)) {
      context.records.push({ action: 'omitted-directory', path: relative });
      continue;
    }
    if (
      entry.name === '.env' ||
      (entry.name.startsWith('.env.') && entry.name !== '.env.example')
    ) {
      context.records.push({ action: 'redacted-secret-file', path: relative });
      continue;
    }
    const sourceEntry = path.join(sourceRoot, ...relative.split('/'));
    const destinationEntry = path.join(destinationRoot, ...relative.split('/'));
    const stat = lstatSync(sourceEntry);
    if (stat.isSymbolicLink()) {
      context.records.push({ action: 'omitted-symlink', path: relative });
      continue;
    }
    if (stat.isDirectory()) {
      mkdirSync(destinationEntry);
      copyDirectory(sourceRoot, destinationRoot, relative, context);
      continue;
    }
    if (!stat.isFile()) {
      context.records.push({ action: 'omitted-non-regular', path: relative });
      continue;
    }
    const bytes = readFileSync(sourceEntry);
    if (bytes.byteLength > MAX_FILE_BYTES) {
      context.records.push({
        action: 'omitted-oversized',
        bytes: bytes.byteLength,
        path: relative,
        sha256: sha256(bytes),
      });
      continue;
    }
    const output = bytes.includes(0)
      ? Buffer.from(
          `${JSON.stringify({
            binaryOmitted: true,
            bytes: bytes.byteLength,
            sha256: sha256(bytes),
          })}\n`,
        )
      : Buffer.from(redactSecrets(bytes.toString('utf8'), context.secretInventory.values), 'utf8');
    if (output.byteLength > MAX_FILE_BYTES) {
      context.records.push({
        action: 'omitted-redacted-oversized',
        bytes: output.byteLength,
        path: relative,
        sha256: sha256(output),
      });
      continue;
    }
    if (!fitsArtifactAppByteBudget(context.state.totalBytes, output.byteLength)) {
      context.records.push({
        action: 'omitted-aggregate-bound',
        bytes: output.byteLength,
        path: relative,
        sha256: sha256(output),
      });
      continue;
    }
    if (!fitsArtifactFileBudget(context.state.files + 1)) {
      context.records.push({
        action: 'omitted-file-bound',
        bytes: output.byteLength,
        path: relative,
        sha256: sha256(output),
      });
      continue;
    }
    context.state.files += 1;
    assertWithinAggregateBound(context.state, output.byteLength);
    mkdirSync(path.dirname(destinationEntry), { recursive: true });
    writeFileSync(destinationEntry, output, { flag: 'wx', mode: 0o644 });
    context.state.totalBytes += output.byteLength;
    context.records.push({
      action: 'copied',
      bytes: output.byteLength,
      path: relative,
      sha256: sha256(output),
    });
  }
}

export function assertArtifactFileBudget(appFiles) {
  if (!fitsArtifactFileBudget(appFiles)) {
    throw new Error(
      `failed app cannot fit with artifact metadata inside the ${String(MAX_FILES)}-file bound`,
    );
  }
}

export function fitsArtifactFileBudget(appFiles) {
  if (!Number.isSafeInteger(appFiles) || appFiles < 0) return false;
  return appFiles + METADATA_FILES <= MAX_FILES;
}

export function fitsArtifactAppByteBudget(currentBytes, additionalBytes) {
  if (
    !Number.isSafeInteger(currentBytes) ||
    currentBytes < 0 ||
    !Number.isSafeInteger(additionalBytes) ||
    additionalBytes < 0
  ) {
    throw new TypeError('artifact app byte counts must be non-negative safe integers');
  }
  return currentBytes + additionalBytes <= MAX_APP_BYTES;
}

function omittedDirectory(relative, name) {
  if (OMITTED_DIRECTORIES.has(name)) return true;
  return (
    relative === '.kovo/cache' ||
    relative.startsWith('.kovo/cache/') ||
    relative === '.kovo/pglite' ||
    relative.startsWith('.kovo/pglite/')
  );
}

function walkRegularFiles(root, visit, relativeRoot = '') {
  const directory = relativeRoot ? path.join(root, ...relativeRoot.split('/')) : root;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    compareUtf8(left.name, right.name),
  )) {
    const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    const file = path.join(root, ...relative.split('/'));
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      throw new Error(`failure artifact contains a symlink: ${relative}`);
    }
    if (stat.isDirectory()) walkRegularFiles(root, visit, relative);
    else if (stat.isFile()) visit(file, relative);
    else throw new Error(`failure artifact contains a non-regular entry: ${relative}`);
  }
}

function directoryDigest(root) {
  const hash = createHash('sha256');
  walkRegularFiles(root, (file, relative) => {
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  });
  return `sha256:${hash.digest('hex')}`;
}

function realDirectory(value, label) {
  const resolved = realpathSync(path.resolve(value));
  const stat = lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new TypeError(`${label} must be a regular non-symlink directory`);
  }
  return resolved;
}

function assertWithinAggregateBound(state, additionalBytes) {
  if (state.totalBytes + additionalBytes > MAX_TOTAL_BYTES) {
    throw new Error(`failure artifact exceeds ${String(MAX_TOTAL_BYTES)} bytes`);
  }
}

function boundedTranscriptText(transcripts, exactSecrets) {
  const admitted = transcripts.slice(0, MAX_TRANSCRIPTS);
  const omitted = Math.max(0, transcripts.length - admitted.length);
  let fieldBytes = 64 * 1024;
  for (;;) {
    const payload = admitted.map((entry, index) => ({
      index,
      phase: boundedLabel(entry?.phase ?? `phase-${String(index + 1)}`),
      status: Number.isInteger(entry?.status) ? entry.status : null,
      signal: typeof entry?.signal === 'string' ? boundedLabel(entry.signal) : null,
      stdout: boundedText(redactSecrets(String(entry?.stdout ?? ''), exactSecrets), fieldBytes),
      stderr: boundedText(redactSecrets(String(entry?.stderr ?? ''), exactSecrets), fieldBytes),
    }));
    if (omitted > 0) {
      payload.push({
        index: admitted.length,
        phase: 'artifact-truncation',
        status: null,
        signal: null,
        stdout: `${String(omitted)} transcript record(s) omitted`,
        stderr: '',
      });
    }
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (Buffer.byteLength(text) <= MAX_FILE_BYTES) return text;
    if (fieldBytes <= 256) {
      throw new Error('failure artifact transcript metadata cannot fit its per-file bound');
    }
    fieldBytes = Math.floor(fieldBytes / 2);
  }
}

function boundedOmissionRecords(records) {
  const omitted = records.filter((record) => record.action !== 'copied');
  if (omitted.length <= MAX_OMISSION_RECORDS) return omitted;
  const serialized = Buffer.from(JSON.stringify(omitted));
  return [
    ...omitted.slice(0, MAX_OMISSION_RECORDS - 1),
    {
      action: 'omitted-summary',
      omittedRecords: omitted.length - (MAX_OMISSION_RECORDS - 1),
      sha256: sha256(serialized),
    },
  ];
}

function boundedEnvironmentKeyInventory(keys) {
  const admitted = keys.slice(0, 512).map((key) => boundedText(key, 128));
  return {
    redactedEnvironmentKeys: admitted,
    redactedEnvironmentKeyCount: keys.length,
    ...(keys.length > admitted.length
      ? { redactedEnvironmentKeysSha256: sha256(Buffer.from(JSON.stringify(keys))) }
      : {}),
  };
}

function boundedText(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const marker = '\n[TRUNCATED]';
  const contentBytes = Math.max(0, maxBytes - Buffer.byteLength(marker));
  let truncated = Buffer.from(text).subarray(0, contentBytes).toString('utf8');
  while (Buffer.byteLength(truncated) > contentBytes) truncated = truncated.slice(0, -1);
  return `${truncated}${marker}`;
}

function safeArtifactLabel(value) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)) {
    throw new TypeError('failure artifact label must be a bounded lowercase identifier');
  }
  return value;
}

function boundedLabel(value) {
  const normalized = String(value)
    .replaceAll(/[\r\n\t]/gu, ' ')
    .slice(0, 128);
  return normalized.length === 0 ? 'unknown' : normalized;
}

function unquoteEnvValue(value) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
