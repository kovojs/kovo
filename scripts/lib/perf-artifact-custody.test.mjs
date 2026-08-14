import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticatePerformanceArtifactEvidence,
  readZipMember,
} from './perf-artifact-custody.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('performance artifact custody', () => {
  it('binds the API record, ZIP digest, exact member, report, run, repository, and source', async () => {
    const fixture = writeArtifactFixture();

    const authenticated = await authenticatePerformanceArtifactEvidence(fixture.evidence, {
      baseDirectory: fixture.directory,
      expectedArtifactName: 'kovo-perf-browser-matrix',
      expectedReportMember: 'comparison.json',
      fetchArtifactApi: async () => fixture.liveApiBytes,
      now: '2026-08-14T00:00:00.000Z',
      repository: 'kovojs/kovo',
    });

    expect(authenticated.report).toEqual(fixture.report);
    expect(authenticated.rawText).toBe(fixture.reportText);
    expect(authenticated.custody).toMatchObject({
      apiUrl: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001',
      archiveDownloadUrl: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001/zip',
      artifactId: 2001,
      artifactName: 'kovo-perf-browser-matrix',
      location: 'https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001',
      reportMember: 'comparison.json',
      runUrl: 'https://github.com/kovojs/kovo/actions/runs/1001',
      workflowRunId: 1001,
    });
    expect(authenticated.contentDigest).toBe(digest(fixture.reportText));
    expect(authenticated.custody.archiveDigest).toBe(digest(readFileSync(fixture.archivePath)));
  });

  it.each([
    ['archive digest', (fixture) => ({ ...fixture.metadata, digest: `sha256:${'0'.repeat(64)}` })],
    ['API URL', (fixture) => ({ ...fixture.metadata, url: `${fixture.metadata.url}/wrong` })],
    ['artifact name', (fixture) => ({ ...fixture.metadata, name: 'wrong-name' })],
    [
      'workflow source',
      (fixture) => ({
        ...fixture.metadata,
        workflow_run: { ...fixture.metadata.workflow_run, head_sha: 'b'.repeat(40) },
      }),
    ],
    ['retention', (fixture) => ({ ...fixture.metadata, expired: true })],
  ])('rejects a mismatched %s', async (_label, mutate) => {
    const fixture = writeArtifactFixture();
    const mutatedBytes = Buffer.from(`${JSON.stringify(mutate(fixture))}\n`);
    writeFileSync(fixture.apiPath, mutatedBytes);
    fixture.liveApiBytes = mutatedBytes;

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        fetchArtifactApi: async () => fixture.liveApiBytes,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow();
  });

  it('fails closed when the saved API response is not byte-identical to the live response', async () => {
    const fixture = writeArtifactFixture();

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        fetchArtifactApi: async () => Buffer.from('{}\n'),
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow('differs byte-for-byte from the live response');
  });

  it('rejects extracted bytes that are not the authenticated ZIP member', async () => {
    const fixture = writeArtifactFixture();
    writeFileSync(fixture.reportPath, `${fixture.reportText} `);

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        fetchArtifactApi: async () => fixture.liveApiBytes,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow('extracted report bytes differ');
  });

  it('rejects an oversized sparse artifact before reading or parsing its bytes', async () => {
    const fixture = writeArtifactFixture();
    truncateSync(fixture.archivePath, 512 * 1024 * 1024 + 1);

    await expect(
      authenticatePerformanceArtifactEvidence(fixture.evidence, {
        baseDirectory: fixture.directory,
        expectedArtifactName: 'kovo-perf-browser-matrix',
        expectedReportMember: 'comparison.json',
        fetchArtifactApi: async () => fixture.liveApiBytes,
        now: '2026-08-14T00:00:00.000Z',
        repository: 'kovojs/kovo',
      }),
    ).rejects.toThrow('artifact ZIP is not a bounded regular file');
  });

  it('rejects unsafe or duplicate ZIP member identities', () => {
    expect(() =>
      readZipMember(
        storedZip([{ name: '../comparison.json', bytes: Buffer.from('{}') }]),
        '../comparison.json',
      ),
    ).toThrow('ZIP member name is unsafe');
    expect(() =>
      readZipMember(
        storedZip([
          { name: 'comparison.json', bytes: Buffer.from('{}') },
          { name: 'comparison.json', bytes: Buffer.from('{}') },
        ]),
        'comparison.json',
      ),
    ).toThrow('duplicate ZIP member');
  });
});

function writeArtifactFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'kovo-perf-custody-'));
  temporaryDirectories.push(directory);
  const sourceCommit = 'a'.repeat(40);
  const report = {
    execution: {
      github: {
        repository: 'kovojs/kovo',
        runId: '1001',
        runUrl: 'https://github.com/kovojs/kovo/actions/runs/1001',
        sha: sourceCommit,
      },
    },
    source: { commit: sourceCommit },
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const archive = storedZip([
    { name: 'comparison.json', bytes: Buffer.from(reportText) },
    { name: 'raw/extra.json', bytes: Buffer.from('{"ok":true}\n') },
  ]);
  const metadata = {
    archive_download_url: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001/zip',
    created_at: '2026-08-13T23:00:00Z',
    digest: digest(archive),
    expired: false,
    expires_at: '2026-11-11T23:00:00Z',
    id: 2001,
    name: 'kovo-perf-browser-matrix',
    size_in_bytes: archive.length,
    updated_at: '2026-08-13T23:01:00Z',
    url: 'https://api.github.com/repos/kovojs/kovo/actions/artifacts/2001',
    workflow_run: { head_sha: sourceCommit, id: 1001 },
  };
  const apiPath = path.join(directory, 'artifact.api.json');
  const archivePath = path.join(directory, 'artifact.zip');
  const reportPath = path.join(directory, 'comparison.json');
  writeFileSync(apiPath, `${JSON.stringify(metadata, null, 2)}\n`);
  writeFileSync(archivePath, archive);
  writeFileSync(reportPath, reportText);
  return {
    apiPath,
    archivePath,
    directory,
    evidence: {
      apiMetadata: path.basename(apiPath),
      archive: path.basename(archivePath),
      report: path.basename(reportPath),
    },
    liveApiBytes: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`),
    metadata,
    report,
    reportPath,
    reportText,
  };
}

function storedZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const bytes = Buffer.from(entry.bytes);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + name.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    bytes.copy(local, 30 + name.length);
    localRecords.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    name.copy(central, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }
  const centralOffset = localOffset;
  const centralSize = centralRecords.reduce((total, record) => total + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...localRecords, ...centralRecords, end]);
}

function digest(value) {
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
