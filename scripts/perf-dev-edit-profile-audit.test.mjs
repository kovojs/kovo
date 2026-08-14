import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEV_LOOP_REPORT_SCHEMA } from '../benchmarks/corpora/dev-loop.mjs';
import { createDevEditProfiler } from './perf-dev-edit-profile.mjs';
import {
  auditDevEditProfileReport,
  DEV_EDIT_PROFILE_ARTIFACT_AUDIT_SCHEMA,
  parseDevEditProfileAuditArgs,
} from './perf-dev-edit-profile-audit.mjs';
import { performanceExecutionIdentity } from './lib/perf-execution.mjs';
import { performanceHostFingerprint } from './lib/perf-host.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('dev edit profile artifact audit', () => {
  it('reauthenticates every raw file and reproduces the retained classifier summary', async () => {
    const root = await temporaryRoot();
    const profileDir = path.join(root, 'raw');
    const profiles = syntheticProfiles();
    const session = {
      close() {},
      async send(method) {
        if (method === 'Profiler.stop') return { profile: profiles.cpu };
        if (method === 'HeapProfiler.stopSampling') return { profile: profiles.heap };
        return {};
      },
    };
    const profiler = await createDevEditProfiler(
      { framework: 'kovo', inspectorPort: 49_211, modules: 24, profileDir },
      { connectInspector: async () => session },
    );
    for (const editClass of ['leaf', 'entry', 'data', 'syntaxError', 'recovery']) {
      await profiler.startWindow({ editClass, iteration: 0 });
      await profiler.stopWindow({ editClass, iteration: 0 });
    }
    const diagnostic = profiler.summary();
    await profiler.close();
    const source = {
      commit: 'a'.repeat(40),
      dirty: false,
      dirtyPaths: [],
      locks: { 'pnpm-lock.yaml': `sha256:${'b'.repeat(64)}` },
    };
    const report = {
      corpus: { modules: 24 },
      execution: performanceExecutionIdentity({
        env: {},
        nonce: 'c'.repeat(32),
        pid: 1,
        startedAt: '2026-08-14T00:00:00.000Z',
      }),
      framework: 'kovo',
      host: performanceHostFingerprint({ browserVersions: ['chromium@fixture'] }),
      integrity: { complete: true, iterations: 1, source: { stable: true } },
      profile: { diagnostic },
      schema: DEV_LOOP_REPORT_SCHEMA,
      source,
      sourceAfter: source,
      verdict: { status: 'diagnostic-only' },
    };
    const reportPath = path.join(root, 'report.json');
    await writeFile(reportPath, `${JSON.stringify(report)}\n`);

    await expect(auditDevEditProfileReport({ profileDir, reportPath })).resolves.toMatchObject({
      complete: true,
      profile: { authenticatedFiles: { length: 10 }, complete: true, windowCount: 5 },
      schema: DEV_EDIT_PROFILE_ARTIFACT_AUDIT_SCHEMA,
    });

    report.verdict.status = 'measured';
    await writeFile(reportPath, `${JSON.stringify(report)}\n`);
    await expect(auditDevEditProfileReport({ profileDir, reportPath })).rejects.toThrow(
      'does not refuse timing claims',
    );
  });

  it('parses an explicit hosted-provider requirement', () => {
    expect(
      parseDevEditProfileAuditArgs([
        '--report',
        '/tmp/report.json',
        '--profile-dir',
        '/tmp/raw',
        '--out',
        '/tmp/audit.json',
        '--require-provider',
        'github-actions',
      ]),
    ).toMatchObject({ requireProvider: 'github-actions' });
  });
});

function syntheticProfiles() {
  const frame = (functionName, url) => ({
    columnNumber: 1,
    functionName,
    lineNumber: 1,
    scriptId: '1',
    url,
  });
  return {
    cpu: {
      endTime: 20,
      nodes: [
        { callFrame: frame('(root)', ''), children: [2], hitCount: 0, id: 1 },
        {
          callFrame: frame(
            'runDevWholeProjectAnalysis',
            'file:///repo/packages/server/src/vite.ts',
          ),
          children: [],
          hitCount: 0,
          id: 2,
        },
      ],
      samples: [2, 2],
      startTime: 10,
      timeDeltas: [500, 500],
    },
    heap: {
      head: {
        callFrame: frame('(root)', ''),
        children: [
          {
            callFrame: frame(
              'runDevWholeProjectAnalysis',
              'file:///repo/packages/server/src/vite.ts',
            ),
            children: [],
            id: 2,
            selfSize: 65_536,
          },
        ],
        id: 1,
        selfSize: 0,
      },
      samples: [],
    },
  };
}

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kovo-dev-profile-audit-test-'));
  roots.push(root);
  return root;
}
