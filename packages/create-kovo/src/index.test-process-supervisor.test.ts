import { resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { runBoundedTestProcessForTest } from './index.test-process-supervisor.mjs';

const itIfPosix = process.platform === 'win32' ? it.skip : it;

describe('bounded test process output', () => {
  itIfPosix(
    'keeps concurrent cleanup marker identities distinct without credential entropy',
    async () => {
      const markerNames = new Set<string>();
      const run = () =>
        runBoundedTestProcessForTest(
          {
            args: ['-e', ''],
            command: process.execPath,
            cwd: resolve('.'),
            supervisorTimeoutMs: 5_000,
          },
          {
            snapshotProcessTable: async (markerName) => {
              markerNames.add(markerName);
              return new Map();
            },
          },
        );

      const outcomes = await Promise.all([run(), run()]);

      expect(outcomes.every((outcome) => outcome.cleanupError === null)).toBe(true);
      expect([...markerNames]).toHaveLength(2);
      expect(
        [...markerNames].every((name) => /^KOVO_TEST_PROCESS_MARKER_[0-9A-Z_]+$/u.test(name)),
      ).toBe(true);
    },
  );

  itIfPosix('forwards live output with pipe backpressure without retaining it', async () => {
    const stdout = new SlowRecordingStream();
    const stderr = new SlowRecordingStream();
    const outcome = await runBoundedTestProcessForTest(
      {
        args: [
          '-e',
          "process.stdout.write('o'.repeat(256 * 1024)); process.stderr.write('live-stderr');",
        ],
        captureOutput: false,
        command: process.execPath,
        cwd: resolve('.'),
        forwardOutput: true,
        maxOutputBytes: 512 * 1024,
        supervisorTimeoutMs: 5_000,
      },
      { parentStderr: stderr, parentStdout: stdout },
    );

    expect(outcome).toMatchObject({
      cleanupError: null,
      exitCode: 0,
      outputOverflowed: false,
      stderr: '',
      stdout: '',
      timedOut: false,
    });
    expect(stdout.text()).toBe('o'.repeat(256 * 1024));
    expect(stderr.text()).toBe('live-stderr');
    expect(stdout.writableEnded).toBe(false);
    expect(stderr.writableEnded).toBe(false);
  });

  itIfPosix(
    'unpipes both child channels during timeout cleanup and leaves parent streams open',
    async () => {
      const stdout = recordingPassThrough();
      const stderr = recordingPassThrough();
      let stdoutUnpipes = 0;
      let stderrUnpipes = 0;
      stdout.stream.on('unpipe', () => {
        stdoutUnpipes += 1;
      });
      stderr.stream.on('unpipe', () => {
        stderrUnpipes += 1;
      });

      const outcome = await runBoundedTestProcessForTest(
        {
          args: ['-e', "process.stdout.write('ready\\n'); setInterval(() => undefined, 1_000);"],
          captureOutput: false,
          command: process.execPath,
          cwd: resolve('.'),
          forwardOutput: true,
          killGraceMs: 500,
          rootExitTimeoutMs: 500,
          streamCloseTimeoutMs: 500,
          supervisorTimeoutMs: 100,
          terminationGraceMs: 500,
        },
        { parentStderr: stderr.stream, parentStdout: stdout.stream },
      );

      expect(outcome.timedOut).toBe(true);
      expect(outcome.cleanupError).toBeNull();
      expect(stdoutUnpipes).toBe(1);
      expect(stderrUnpipes).toBe(1);
      expect(stdout.stream.writableEnded).toBe(false);
      expect(stderr.stream.writableEnded).toBe(false);
      stdout.stream.write('parent-still-open');
      stderr.stream.write('parent-stderr-still-open');
      expect(stdout.text()).toContain('ready\nparent-still-open');
      expect(stderr.text()).toBe('parent-stderr-still-open');
    },
  );

  itIfPosix('keeps machine-readable JSON capture-only', async () => {
    const stdout = recordingPassThrough();
    const stderr = recordingPassThrough();
    const outcome = await runBoundedTestProcessForTest(
      {
        args: [
          '-e',
          "process.stdout.write(JSON.stringify([{ name: 'proof' }])); process.stderr.write('diagnostic');",
        ],
        captureOutput: true,
        command: process.execPath,
        cwd: resolve('.'),
        forwardOutput: false,
        maxOutputBytes: 1_024,
        supervisorTimeoutMs: 5_000,
      },
      { parentStderr: stderr.stream, parentStdout: stdout.stream },
    );

    expect(JSON.parse(outcome.stdout)).toEqual([{ name: 'proof' }]);
    expect(outcome.stderr).toBe('diagnostic');
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toBe('');
  });

  itIfPosix('fails closed on combined-output overflow while forwarding live output', async () => {
    const stdout = recordingPassThrough();
    const stderr = recordingPassThrough();
    const outcome = await runBoundedTestProcessForTest(
      {
        args: [
          '-e',
          [
            "process.on('SIGTERM', () => undefined);",
            "process.stdout.write('o'.repeat(800));",
            "process.stderr.write('e'.repeat(800));",
            'setInterval(() => undefined, 1_000);',
          ].join(''),
        ],
        captureOutput: true,
        command: process.execPath,
        cwd: resolve('.'),
        forwardOutput: true,
        killGraceMs: 500,
        maxOutputBytes: 1_024,
        rootExitTimeoutMs: 500,
        streamCloseTimeoutMs: 500,
        supervisorTimeoutMs: 5_000,
        terminationGraceMs: 20,
      },
      { parentStderr: stderr.stream, parentStdout: stdout.stream },
    );

    expect(outcome.timedOut).toBe(false);
    expect(outcome.outputOverflowed).toBe(true);
    expect(outcome.cleanupError).toBeNull();
    expect(Buffer.byteLength(outcome.stdout) + Buffer.byteLength(outcome.stderr)).toBe(1_024);
    expect(stdout.text()).toBe('o'.repeat(800));
    expect(stderr.text()).toBe('e'.repeat(800));
    expect(stdout.stream.writableEnded).toBe(false);
    expect(stderr.stream.writableEnded).toBe(false);
  });
});

class SlowRecordingStream extends Writable {
  readonly #chunks: Buffer[] = [];

  constructor() {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.#chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, encoding));
    setImmediate(callback);
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString('utf8');
  }
}

function recordingPassThrough(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}
