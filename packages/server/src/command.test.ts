import { execFile, spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  cmd,
  commandAllowlist,
  isCommand,
  runCommand,
  type Command,
  type CommandAllowlist,
} from './command.js';

const commandModuleUrl = new URL('./command.ts', import.meta.url).href;
const securityBootstrapModuleUrl = new URL('./security-bootstrap.ts', import.meta.url).href;
const mutableChildProcess = createRequire(import.meta.url)('node:child_process') as {
  execFile: typeof execFile;
};

describe('server command primitive', () => {
  const nodeCommands = () =>
    commandAllowlist([process.execPath], {
      justification: 'test subprocess boundary executes the current Node binary',
    });

  it('mints a frozen runtime witness and rejects forged command objects', async () => {
    const command = cmd(process.execPath, ['-e', 'console.log("ok")'], {
      allow: nodeCommands(),
    });
    const forged = {
      argv: command.argv,
      program: command.program,
      __kovoBlessedSink: 'server:command-exec-file',
    };

    expect(isCommand(command)).toBe(true);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.argv)).toBe(true);
    expect(Reflect.set(command, 'program', 'sh')).toBe(false);
    expect(isCommand({ ...command })).toBe(false);
    expect(isCommand(forged)).toBe(false);
    expect(() => runCommand(forged as unknown as Command)).toThrow(
      /requires a Command minted by cmd/,
    );
  });

  it('runs argv through execFile without shell interpretation', async () => {
    const command = cmd(
      process.execPath,
      ['-e', 'console.log(process.argv.slice(1).join("\\n"))', 'semi;colon', '$(echo injected)'],
      {
        allow: nodeCommands(),
      },
    );

    await expect(runCommand(command)).resolves.toEqual({
      stderr: '',
      stdout: 'semi;colon\n$(echo injected)\n',
    });
  });

  it('reconstructs exact argv without consulting a late Array iterator', async () => {
    const command = cmd(process.execPath, ['-e', 'process.stdout.write("SAFE")'], {
      allow: nodeCommands(),
    });
    const originalIterator = Array.prototype[Symbol.iterator];
    try {
      Array.prototype[Symbol.iterator] = function () {
        if (this === command.argv) {
          return originalIterator.call(['-e', 'process.stdout.write("ATTACKER-CODE-EXECUTED")']);
        }
        return originalIterator.call(this);
      };

      await expect(runCommand(command)).resolves.toEqual({ stderr: '', stdout: 'SAFE' });
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }
  });

  it('keeps execFile, Promise, and command-result text controls pinned after late replacement', async () => {
    const command = cmd(process.execPath, ['-e', 'process.stdout.write("SAFE")'], {
      allow: nodeCommands(),
    });
    const originalExecFile = mutableChildProcess.execFile;
    const OriginalPromise = globalThis.Promise;
    const OriginalString = globalThis.String;
    let poisonedExecCalls = 0;
    let resultPromise: Promise<{ stderr: string; stdout: string }> | undefined;
    try {
      mutableChildProcess.execFile = ((
        _file: string,
        _args: readonly string[],
        options: Parameters<typeof execFile>[2],
        callback: Parameters<typeof execFile>[3],
      ) => {
        poisonedExecCalls += 1;
        return originalExecFile(
          process.execPath,
          ['-e', 'process.stdout.write("ATTACKER-CODE-EXECUTED")'],
          options,
          callback,
        );
      }) as typeof execFile;
      syncBuiltinESMExports();
      globalThis.Promise = class PoisonedPromise {
        constructor() {
          throw new Error('poisoned Promise reached');
        }
      } as unknown as PromiseConstructor;
      try {
        resultPromise = runCommand(command);
      } finally {
        globalThis.Promise = OriginalPromise;
      }
      globalThis.String = ((value?: unknown) =>
        value === 'SAFE' || value === '' ? 'FORGED' : OriginalString(value)) as StringConstructor;
      const result = await resultPromise;
      expect(result).toEqual({ stderr: '', stdout: 'SAFE' });
    } finally {
      mutableChildProcess.execFile = originalExecFile;
      syncBuiltinESMExports();
      globalThis.Promise = OriginalPromise;
      globalThis.String = OriginalString;
    }
    expect(poisonedExecCalls).toBe(0);
  });

  it('rejects accessor-backed argv, allowlists, and execution options before the sink', () => {
    const argv: string[] = [];
    Object.defineProperty(argv, 0, {
      configurable: true,
      enumerable: true,
      get: () => '-e',
    });
    Object.defineProperty(argv, 'length', { value: 1 });
    const allow = nodeCommands();

    expect(() => cmd(process.execPath, argv, { allow })).toThrow(/stable own string value/);
    expect(() =>
      commandAllowlist([process.execPath], {
        get justification() {
          return 'accessor-backed audit text';
        },
      }),
    ).toThrow(/changed while|own data property/);

    const command = cmd(process.execPath, ['--version'], { allow });
    expect(() =>
      runCommand(command, {
        get cwd() {
          return process.cwd();
        },
      }),
    ).toThrow(/changed while|own data property/);
  });

  it('executes reviewed argv through boot-pinned execFile after a selective late replacement', () => {
    const script = `
      const { existsSync } = await import('node:fs');
      const { createRequire, registerHooks, syncBuiltinESMExports } = await import('node:module');
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
          const candidate = new URL(specifier.replace(/\\.js$/, '.ts'), context.parentURL);
          if (existsSync(candidate)) return nextResolve(candidate.href, context);
        }
        return nextResolve(specifier, context);
      }});
      await import(${JSON.stringify(`${securityBootstrapModuleUrl}?command-runner`)});
      const mutable = createRequire(import.meta.url)('node:child_process');
      const original = mutable.execFile;
      let poisonedCalls = 0;
      mutable.execFile = (...args) => {
        poisonedCalls += 1;
        return original(...args);
      };
      syncBuiltinESMExports();
      const api = await import(${JSON.stringify(`${commandModuleUrl}?post-bootstrap-exec-file`)});
      const allow = api.commandAllowlist([process.execPath], { justification: 'bootstrap regression' });
      const command = api.cmd(process.execPath, ['-e', 'process.stdout.write("SAFE")'], { allow });
      const result = await api.runCommand(command);
      process.exit(result.stdout === 'SAFE' && poisonedCalls === 0 ? 0 : 3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('denies command construction unless the program is explicitly allowed', () => {
    const allow = commandAllowlist(['node'], {
      justification: 'test boundary permits the node executable token',
    });

    expect(() => cmd('node', [], undefined as unknown as { allow: CommandAllowlist })).toThrow(
      /requires commandAllowlist/,
    );
    expect(() => cmd(process.execPath, [], { allow })).toThrow(/not in the explicit allowlist/);
    expect(() => cmd('node', [''], { allow })).not.toThrow();
  });

  it('rejects empty program, shell command strings, controls, unsafe argv, and bad allowlists', () => {
    const allow = commandAllowlist(['node'], {
      justification: 'test boundary permits the node executable token',
    });

    expect(() => commandAllowlist([], { justification: 'empty program list' })).toThrow(
      /at least one program/,
    );
    expect(() => commandAllowlist(['node'], { justification: '' })).toThrow(
      /justification must be non-empty/,
    );
    expect(() =>
      commandAllowlist(['node', 'node'], { justification: 'duplicate command token' }),
    ).toThrow(/duplicate programs/);
    expect(() => commandAllowlist(['node -e'], { justification: 'shell command string' })).toThrow(
      /one executable token/,
    );
    expect(() => cmd('', [], { allow })).toThrow(/program must be non-empty/);
    expect(() => cmd('node -e', [], { allow })).toThrow(/one executable token/);
    expect(() => cmd('node\n', [], { allow })).toThrow(/ASCII control/);
    expect(() => cmd('node', ['ok', 'bad\rarg'], { allow })).toThrow(/ASCII control/);
    expect(() => cmd('node', 'not-array' as unknown as string[], { allow })).toThrow(
      /argv must be an array/,
    );
  });

  it('keeps the Command brand type-only at TypeScript call sites', () => {
    const command = cmd(process.execPath, ['--version'], {
      allow: nodeCommands(),
    });
    const acceptsCommand = (_command: Command) => true;

    expect(acceptsCommand(command)).toBe(true);
    // @ts-expect-error raw structural objects do not satisfy the private command brand.
    acceptsCommand({ program: process.execPath, argv: [] });
    if (false) {
      // @ts-expect-error command construction requires an explicit allowlist.
      cmd(process.execPath, []);
    }
  });
});
