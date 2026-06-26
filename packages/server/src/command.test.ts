import { describe, expect, it } from 'vitest';

import { cmd, isCommand, runCommand, type Command } from './command.js';

describe('server command primitive', () => {
  it('mints a frozen runtime witness and rejects forged command objects', async () => {
    const command = cmd(process.execPath, ['-e', 'console.log("ok")']);
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
    const command = cmd(process.execPath, [
      '-e',
      'console.log(process.argv.slice(1).join("\\n"))',
      'semi;colon',
      '$(echo injected)',
    ]);

    await expect(runCommand(command)).resolves.toEqual({
      stderr: '',
      stdout: 'semi;colon\n$(echo injected)\n',
    });
  });

  it('rejects empty program, shell command strings, controls, and unsafe argv', () => {
    expect(() => cmd('', [])).toThrow(/program must be non-empty/);
    expect(() => cmd('node -e', [])).toThrow(/one executable token/);
    expect(() => cmd('node\n', [])).toThrow(/ASCII control/);
    expect(() => cmd('node', ['ok', 'bad\rarg'])).toThrow(/ASCII control/);
    expect(() => cmd('node', 'not-array' as unknown as string[])).toThrow(/argv must be an array/);
    expect(() => cmd('node', [''])).not.toThrow();
  });

  it('keeps the Command brand type-only at TypeScript call sites', () => {
    const command = cmd(process.execPath, ['--version']);
    const acceptsCommand = (_command: Command) => true;

    expect(acceptsCommand(command)).toBe(true);
    // @ts-expect-error raw structural objects do not satisfy the private command brand.
    acceptsCommand({ program: process.execPath, argv: [] });
  });
});
