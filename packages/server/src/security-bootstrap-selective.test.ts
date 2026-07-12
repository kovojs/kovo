import { createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalGetRandomValues = globalThis.crypto.getRandomValues;
const mutableCrypto = createRequire(import.meta.url)('node:crypto') as typeof import('node:crypto');
const originalNodeRandomBytes = mutableCrypto.randomBytes;
const mutableChildProcess = createRequire(import.meta.url)(
  'node:child_process',
) as typeof import('node:child_process');
const originalExecFile = mutableChildProcess.execFile;

afterEach(() => {
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    value: originalGetRandomValues,
    writable: true,
  });
  mutableCrypto.randomBytes = originalNodeRandomBytes;
  syncBuiltinESMExports();
  mutableChildProcess.execFile = originalExecFile;
  syncBuiltinESMExports();
  vi.resetModules();
});

describe('framework-owned security bootstrap', () => {
  it('selective WebCrypto control mimicry cannot forge rendered HTML markers', async () => {
    vi.resetModules();
    await import('./security-bootstrap.ts?root-bootstrap-webcrypto');

    Object.defineProperty(globalThis.crypto, 'getRandomValues', {
      configurable: true,
      value: function getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        if (array !== null && array.byteLength === 12) {
          return Reflect.apply(originalGetRandomValues, globalThis.crypto, [array]) as T;
        }
        if (array !== null) {
          const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
          for (let index = 0; index < bytes.length; index += 1) bytes[index] = 0x6b;
        }
        return array;
      },
      writable: true,
    });
    const html = await import('./html.ts?root-selective-webcrypto');
    const attacker = '<svg onload="selectiveEntropy()"></svg>';
    const payload = Buffer.from(attacker, 'utf8').toString('base64url');
    const signature = createHmac('sha256', Buffer.alloc(32, 0x6b))
      .update(payload)
      .digest('base64url');
    const forged = html.renderHtmlValue(
      `\uE000kovo-rendered-html:v2:${payload}.${signature}\uE001`,
    );

    expect(forged).not.toContain(attacker);
  });

  it('selective node:crypto control mimicry cannot make the first GCM IV predictable', async () => {
    vi.resetModules();
    await import('./security-bootstrap.ts?root-bootstrap-confidential');

    let calls = 0;
    mutableCrypto.randomBytes = function randomBytes(size, callback) {
      // new FastBuffer(size)
      // randomFillSync(TypedArrayPrototypeGetBuffer(buf)
      calls += 1;
      const bytes =
        calls > 2 && size === 12 ? Buffer.alloc(size, 0x6b) : originalNodeRandomBytes(size);
      if (typeof callback === 'function') {
        callback(null, bytes);
        return undefined as never;
      }
      return bytes;
    } as typeof mutableCrypto.randomBytes;
    syncBuiltinESMExports();
    const confidential = await import('./confidential-at-rest.ts?root-selective-node-crypto');
    const envelope = confidential.encryptAtRest('victim-secret', Buffer.alloc(32, 0x33), {
      aad: 'aad',
    });
    const iv = envelope.split('.')[2];

    expect(iv).not.toBe(Buffer.alloc(12, 0x6b).toString('base64url'));
  });

  it('selective entropy probes cannot mint a predictable first upload object key', async () => {
    vi.resetModules();
    await import('./security-bootstrap.ts?root-bootstrap-upload');

    let calls = 0;
    mutableCrypto.randomBytes = function randomBytes(size, callback) {
      // new FastBuffer(size)
      // randomFillSync(TypedArrayPrototypeGetBuffer(buf)
      calls += 1;
      const bytes =
        calls > 2 && size === 16 ? Buffer.alloc(size, 0x6b) : originalNodeRandomBytes(size);
      if (typeof callback === 'function') {
        callback(null, bytes);
        return undefined as never;
      }
      return bytes;
    } as typeof mutableCrypto.randomBytes;
    syncBuiltinESMExports();
    const upload = await import('./upload-sniff.ts?root-selective-upload-entropy');
    const key = upload.mintStorageKey('avatars');

    expect(key).not.toBe('avatars/6b6b6b6b-6b6b-4b6b-ab6b-6b6b6b6b6b6b');
  });

  it('selective entropy probes cannot mint a predictable first durable-task identity', async () => {
    vi.resetModules();
    await import('./security-bootstrap.ts?root-bootstrap-task');

    let calls = 0;
    mutableCrypto.randomBytes = function randomBytes(size, callback) {
      calls += 1;
      const bytes = calls > 2 ? Buffer.alloc(size, 0x6b) : originalNodeRandomBytes(size);
      if (typeof callback === 'function') {
        callback(null, bytes);
        return undefined as never;
      }
      return bytes;
    } as typeof mutableCrypto.randomBytes;
    syncBuiltinESMExports();
    const taskControls = await import('./task-security-intrinsics.ts');
    const id = taskControls.taskCreateEntropyId('job');

    expect(id).not.toBe(`job_${'6b'.repeat(16)}`);
  });

  it('selective Function-source mimicry cannot replace reviewed command execution', async () => {
    vi.resetModules();
    // The supported runner preloads the root barrel before the app graph. Command remains outside
    // the neutral bootstrap so unused node:child_process code can be tree-shaken from Workers.
    await import('./index.ts?root-bootstrap-command');

    mutableChildProcess.execFile = function execFile(file, args, options, callback) {
      // normalizeExecFileArgs
      // spawn(file, args,
      const exactArgs =
        file === process.execPath && args?.[1] === 'process.stdout.write("SAFE")'
          ? ['-e', 'process.stdout.write("ATTACKER-CODE-EXECUTED")']
          : args;
      return originalExecFile(file, exactArgs, options, callback);
    } as typeof execFile;
    syncBuiltinESMExports();
    const commandApi = await import('./command.ts?root-selective-exec-file');
    const allow = commandApi.commandAllowlist([process.execPath], {
      justification: 'root selective command proof',
    });
    const command = commandApi.cmd(process.execPath, ['-e', 'process.stdout.write("SAFE")'], {
      allow,
    });
    const result = await commandApi.runCommand(command);

    expect(result.stdout).toBe('SAFE');
  });
});
