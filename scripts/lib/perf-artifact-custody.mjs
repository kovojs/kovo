import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_API_RESPONSE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_REPORT_BYTES = 128 * 1024 * 1024;
const execFileAsync = promisify(execFile);

/**
 * Authenticate one extracted performance report through the saved GitHub artifact API response,
 * the exact downloaded ZIP bytes, and the exact report member bytes. This is evidence custody, not
 * a claim that repository-controlled JSON can replace GitHub's external authority boundary.
 */
export async function authenticatePerformanceArtifactEvidence(
  evidence,
  {
    baseDirectory = process.cwd(),
    expectedArtifactName,
    expectedReportMember,
    fetchArtifactApi = fetchGitHubArtifactApiResponse,
    now,
    repository,
  },
) {
  validateEvidenceDescriptor(evidence);
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  if (!nonEmptyString(expectedArtifactName) || !safeZipPath(expectedReportMember)) {
    throw new TypeError('expected artifact name and report member are required');
  }

  const apiPath = path.resolve(baseDirectory, evidence.apiMetadata);
  const archivePath = path.resolve(baseDirectory, evidence.archive);
  const reportPath = path.resolve(baseDirectory, evidence.report);
  const [apiBytes, archiveBytes, reportBytes] = await Promise.all([
    readBoundedRegularFile(apiPath, MAX_API_RESPONSE_BYTES, 'artifact API metadata'),
    readBoundedRegularFile(archivePath, MAX_ARCHIVE_BYTES, 'artifact ZIP'),
    readBoundedRegularFile(reportPath, MAX_REPORT_BYTES, 'extracted performance report'),
  ]);
  let metadata;
  let report;
  try {
    metadata = JSON.parse(apiBytes.toString('utf8'));
  } catch {
    throw new TypeError('artifact API metadata is not valid JSON');
  }
  try {
    report = JSON.parse(reportBytes.toString('utf8'));
  } catch {
    throw new TypeError('extracted performance report is not valid JSON');
  }

  const archiveDigest = sha256Bytes(archiveBytes);
  const reportContentDigest = sha256Bytes(reportBytes);
  const memberBytes = readZipMember(archiveBytes, expectedReportMember);
  if (!memberBytes.equals(reportBytes)) {
    throw new TypeError(`extracted report bytes differ from ZIP member ${expectedReportMember}`);
  }

  const artifactId = positiveInteger(metadata?.id, 'artifact API id');
  if (typeof fetchArtifactApi !== 'function') {
    throw new TypeError('live artifact API fetch is required');
  }
  let liveApiBytes;
  try {
    liveApiBytes = Buffer.from(await fetchArtifactApi({ artifactId, repository }));
  } catch (error) {
    throw new TypeError(
      `live artifact API verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (liveApiBytes.length > MAX_API_RESPONSE_BYTES) {
    throw new TypeError('live artifact API response exceeds the safety bound');
  }
  if (!liveApiBytes.equals(apiBytes)) {
    throw new TypeError('saved artifact API response differs byte-for-byte from the live response');
  }
  const workflowRunId = positiveInteger(metadata?.workflow_run?.id, 'artifact workflow run id');
  const apiUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${String(artifactId)}`;
  const archiveDownloadUrl = `${apiUrl}/zip`;
  const runUrl = `https://github.com/${repository}/actions/runs/${String(workflowRunId)}`;
  const location = `${runUrl}/artifacts/${String(artifactId)}`;
  const findings = [];
  if (metadata?.name !== expectedArtifactName) {
    findings.push(`artifact name is ${String(metadata?.name)}, expected ${expectedArtifactName}`);
  }
  if (metadata?.url !== apiUrl) findings.push('artifact API URL is not derived from its identity');
  if (metadata?.archive_download_url !== archiveDownloadUrl) {
    findings.push('artifact archive API URL is not derived from its identity');
  }
  if (metadata?.expired !== false) findings.push('artifact API record is expired');
  if (metadata?.digest !== archiveDigest || !DIGEST_PATTERN.test(metadata?.digest ?? '')) {
    findings.push('downloaded artifact ZIP digest differs from the GitHub artifact API digest');
  }
  if (metadata?.size_in_bytes !== archiveBytes.length) {
    findings.push('downloaded artifact ZIP size differs from the GitHub artifact API size');
  }
  if (report?.execution?.github?.runUrl !== runUrl) {
    findings.push('report execution run URL differs from the artifact workflow run');
  }
  if (String(report?.execution?.github?.runId ?? '') !== String(workflowRunId)) {
    findings.push('report execution run ID differs from the artifact workflow run');
  }
  if (report?.execution?.github?.repository !== repository) {
    findings.push('report execution repository differs from the artifact repository');
  }
  if (!COMMIT_PATTERN.test(metadata?.workflow_run?.head_sha ?? '')) {
    findings.push('artifact workflow source commit is unavailable');
  }
  if (
    metadata?.workflow_run?.head_sha !== report?.source?.commit ||
    metadata?.workflow_run?.head_sha !== report?.execution?.github?.sha
  ) {
    findings.push('artifact workflow source commit differs from the report source identity');
  }
  const createdAt = validTimestamp(metadata?.created_at, 'artifact created_at', findings);
  const updatedAt = validTimestamp(metadata?.updated_at, 'artifact updated_at', findings);
  const expiresAt = validTimestamp(metadata?.expires_at, 'artifact expires_at', findings);
  if (
    Number.isFinite(createdAt) &&
    Number.isFinite(updatedAt) &&
    Number.isFinite(expiresAt) &&
    (createdAt > updatedAt || updatedAt > expiresAt)
  ) {
    findings.push('artifact API timestamps are not monotonic');
  }
  const observedNow =
    now instanceof Date ? now.getTime() : Date.parse(now ?? new Date().toISOString());
  if (!Number.isFinite(observedNow)) throw new TypeError('now must be a valid timestamp');
  if (Number.isFinite(expiresAt) && observedNow >= expiresAt) {
    findings.push('artifact retention expired before publication verification');
  }
  if (findings.length > 0) throw new TypeError(findings.join('\n'));

  return {
    contentDigest: reportContentDigest,
    custody: {
      apiResponseDigest: sha256Bytes(apiBytes),
      apiUrl,
      archiveDigest,
      archiveDownloadUrl,
      artifactId,
      artifactName: metadata.name,
      createdAt: metadata.created_at,
      expiresAt: metadata.expires_at,
      liveApiResponseDigest: sha256Bytes(liveApiBytes),
      liveApiVerifiedAt: new Date(observedNow).toISOString(),
      location,
      reportContentDigest,
      reportMember: expectedReportMember,
      runUrl,
      updatedAt: metadata.updated_at,
      workflowRunId,
    },
    location,
    rawText: reportBytes.toString('utf8'),
    report,
  };
}

/** Fetch the canonical API record through the authenticated GitHub CLI. No offline CLI mode exists. */
export async function fetchGitHubArtifactApiResponse({ artifactId, repository }) {
  if (!REPOSITORY_PATTERN.test(repository ?? '')) {
    throw new TypeError('repository must be an exact owner/name identity');
  }
  positiveInteger(artifactId, 'artifact API id');
  const endpoint = `repos/${repository}/actions/artifacts/${String(artifactId)}`;
  const { stdout } = await execFileAsync('gh', ['api', endpoint], {
    encoding: 'buffer',
    maxBuffer: MAX_API_RESPONSE_BYTES,
    timeout: 30_000,
  });
  if (!Buffer.isBuffer(stdout) || stdout.length === 0) {
    throw new TypeError('GitHub artifact API returned no bytes');
  }
  return stdout;
}

/** Read and authenticate one bounded regular-file member from a single-disk ZIP archive. */
export function readZipMember(archiveBytes, memberName) {
  if (!Buffer.isBuffer(archiveBytes)) throw new TypeError('ZIP archive must be a Buffer');
  if (archiveBytes.length > MAX_ARCHIVE_BYTES) {
    throw new TypeError('ZIP archive exceeds the safety bound');
  }
  if (!safeZipPath(memberName)) throw new TypeError('ZIP member name is unsafe');
  const eocdOffset = findEndOfCentralDirectory(archiveBytes);
  const diskNumber = archiveBytes.readUInt16LE(eocdOffset + 4);
  const centralDisk = archiveBytes.readUInt16LE(eocdOffset + 6);
  const diskEntries = archiveBytes.readUInt16LE(eocdOffset + 8);
  const totalEntries = archiveBytes.readUInt16LE(eocdOffset + 10);
  const centralSize = archiveBytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = archiveBytes.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new TypeError('ZIP64 or multi-disk artifacts are unsupported');
  }
  if (totalEntries < 1 || totalEntries > MAX_ZIP_ENTRIES) {
    throw new TypeError('ZIP entry census is empty or exceeds the safety bound');
  }
  if (centralOffset + centralSize !== eocdOffset) {
    throw new TypeError('ZIP central directory bounds are inconsistent');
  }

  const names = new Set();
  let selected = null;
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    requireBounds(archiveBytes, offset, 46, 'ZIP central directory entry');
    if (archiveBytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new TypeError('ZIP central directory signature is invalid');
    }
    const flags = archiveBytes.readUInt16LE(offset + 8);
    const method = archiveBytes.readUInt16LE(offset + 10);
    const checksum = archiveBytes.readUInt32LE(offset + 16);
    const compressedSize = archiveBytes.readUInt32LE(offset + 20);
    const uncompressedSize = archiveBytes.readUInt32LE(offset + 24);
    const nameLength = archiveBytes.readUInt16LE(offset + 28);
    const extraLength = archiveBytes.readUInt16LE(offset + 30);
    const commentLength = archiveBytes.readUInt16LE(offset + 32);
    const startDisk = archiveBytes.readUInt16LE(offset + 34);
    const localOffset = archiveBytes.readUInt32LE(offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    requireBounds(archiveBytes, offset, recordLength, 'ZIP central directory record');
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      startDisk !== 0
    ) {
      throw new TypeError('ZIP64 or multi-disk entries are unsupported');
    }
    if ((flags & 0x0001) !== 0) throw new TypeError('encrypted ZIP entries are unsupported');
    const nameBytes = archiveBytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = decodeZipName(nameBytes);
    if (!safeZipPath(name)) throw new TypeError(`unsafe ZIP member path ${JSON.stringify(name)}`);
    if (names.has(name)) throw new TypeError(`duplicate ZIP member ${name}`);
    names.add(name);
    if (name === memberName) {
      selected = { checksum, compressedSize, flags, localOffset, method, name, uncompressedSize };
    }
    offset += recordLength;
  }
  if (offset !== eocdOffset) throw new TypeError('ZIP central directory census is inconsistent');
  if (selected === null) throw new TypeError(`ZIP member ${memberName} is unavailable`);
  if (selected.uncompressedSize > MAX_REPORT_BYTES) {
    throw new TypeError(`ZIP member ${memberName} exceeds the report size bound`);
  }
  return inflateSelectedMember(archiveBytes, selected);
}

async function readBoundedRegularFile(file, maximumBytes, label) {
  const facts = await stat(file);
  if (!facts.isFile() || facts.size < 1 || facts.size > maximumBytes) {
    throw new TypeError(`${label} is not a bounded regular file`);
  }
  const bytes = await readFile(file);
  if (bytes.length < 1 || bytes.length > maximumBytes) {
    throw new TypeError(`${label} exceeds the safety bound while being read`);
  }
  return bytes;
}

function inflateSelectedMember(archiveBytes, entry) {
  requireBounds(archiveBytes, entry.localOffset, 30, 'ZIP local header');
  if (archiveBytes.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new TypeError('ZIP local header signature is invalid');
  }
  const localFlags = archiveBytes.readUInt16LE(entry.localOffset + 6);
  const localMethod = archiveBytes.readUInt16LE(entry.localOffset + 8);
  const localChecksum = archiveBytes.readUInt32LE(entry.localOffset + 14);
  const localCompressedSize = archiveBytes.readUInt32LE(entry.localOffset + 18);
  const localUncompressedSize = archiveBytes.readUInt32LE(entry.localOffset + 22);
  const nameLength = archiveBytes.readUInt16LE(entry.localOffset + 26);
  const extraLength = archiveBytes.readUInt16LE(entry.localOffset + 28);
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  requireBounds(archiveBytes, entry.localOffset, 30 + nameLength + extraLength, 'ZIP local record');
  const localName = decodeZipName(
    archiveBytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + nameLength),
  );
  if (
    localName !== entry.name ||
    localFlags !== entry.flags ||
    localMethod !== entry.method ||
    ((entry.flags & 0x0008) === 0 &&
      (localChecksum !== entry.checksum ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize))
  ) {
    throw new TypeError('ZIP local and central member identities differ');
  }
  requireBounds(archiveBytes, dataOffset, entry.compressedSize, 'ZIP member data');
  const compressed = archiveBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  let bytes;
  try {
    if (entry.method === 0) bytes = Buffer.from(compressed);
    else if (entry.method === 8) {
      bytes = inflateRawSync(compressed, { maxOutputLength: MAX_REPORT_BYTES });
    } else throw new TypeError(`unsupported ZIP compression method ${String(entry.method)}`);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`ZIP member ${entry.name} cannot be decompressed`);
  }
  if (bytes.length !== entry.uncompressedSize) {
    throw new TypeError(`ZIP member ${entry.name} uncompressed size differs`);
  }
  if (crc32(bytes) !== entry.checksum) {
    throw new TypeError(`ZIP member ${entry.name} CRC-32 differs`);
  }
  return bytes;
}

function findEndOfCentralDirectory(bytes) {
  if (bytes.length < 22) throw new TypeError('ZIP archive is truncated');
  const first = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= first; offset -= 1) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      return offset;
    }
  }
  throw new TypeError('ZIP end-of-central-directory record is unavailable');
}

function requireBounds(bytes, offset, length, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.length
  ) {
    throw new TypeError(`${label} exceeds archive bounds`);
  }
}

function decodeZipName(bytes) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes))
    throw new TypeError('ZIP member name is not UTF-8');
  return value;
}

function safeZipPath(value) {
  return (
    nonEmptyString(value) &&
    value.trim() === value &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function validateEvidenceDescriptor(value) {
  if (!ownRecord(value)) throw new TypeError('artifact evidence descriptor must be an object');
  const expected = ['apiMetadata', 'archive', 'report'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new TypeError(
      'artifact evidence descriptor must contain only apiMetadata, archive, report',
    );
  }
  for (const key of expected) {
    if (!nonEmptyString(value[key]) || value[key].trim() !== value[key]) {
      throw new TypeError(`${key} must be a non-empty path`);
    }
  }
}

function validTimestamp(value, label, findings) {
  const milliseconds = Date.parse(value ?? '');
  if (!nonEmptyString(value) || !Number.isFinite(milliseconds)) {
    findings.push(`${label} is unavailable`);
    return Number.NaN;
  }
  return milliseconds;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is unavailable`);
  return value;
}

function ownRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sha256Bytes(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
