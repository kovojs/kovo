import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { testCommandShell } from './commands/test.js';
import { mainAsync } from './index.js';

afterEach(() => vi.restoreAllMocks());

describe('kovo check endpoint-posture suite', () => {
  it('owns the test-to-fact orchestration behind one versioned Kovo command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-endpoint-posture-suite-'));
    mkdirSync(join(root, '.kovo'));
    writeFileSync(
      join(root, '.kovo/endpoint-posture.json'),
      `${JSON.stringify({
        endpoints: [{ method: 'GET', path: '/api/health' }],
        endpointPosture: [
          {
            endpoint: 'GET /api/health',
            failures: [],
            observed: true,
            site: 'src/endpoint-posture.test.ts',
          },
        ],
      })}\n`,
    );
    const spawn = vi.spyOn(testCommandShell, 'spawnSync').mockReturnValue({
      output: [],
      pid: 10,
      signal: null,
      status: 0,
      stderr: null,
      stdout: null,
    });
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk) => {
      stdout += String(chunk);
      return true;
    }) as typeof process.stdout.write);
    try {
      await expect(
        mainAsync(['check', 'endpoint-posture'], {
          invocationCwd: root,
          invocationEnv: {},
          paranoidStaticAdvisory: false,
        }),
      ).resolves.toBe(0);
      expect(spawn).toHaveBeenCalledOnce();
      expect(spawn.mock.calls[0]?.[1]).toEqual([
        expect.stringMatching(/node_modules[/\\]vite-plus[/\\]bin[/\\]vp$/u),
        'test',
        '--run',
        'src/endpoint-posture.test.ts',
      ]);
      expect(stdout).toBe(
        'kovo-check/v1\nOK ENDPOINT-POSTURE src/endpoint-posture.test.ts GET /api/health\n',
      );
    } finally {
      write.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('does not consume stale posture facts when the production probe fails', async () => {
    const spawn = vi.spyOn(testCommandShell, 'spawnSync').mockReturnValue({
      output: [],
      pid: 11,
      signal: null,
      status: 1,
      stderr: null,
      stdout: null,
    });
    let stderr = '';
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write);
    try {
      await expect(
        mainAsync(['check', 'endpoint-posture'], {
          invocationCwd: '/app',
          invocationEnv: {},
          paranoidStaticAdvisory: false,
        }),
      ).resolves.toBe(1);
      expect(stderr).toBe('kovo-test/v1\nFAIL tests\n');
    } finally {
      write.mockRestore();
    }
  });
});
