import { describe, expect, it } from 'vitest';

import {
  cmd,
  commandAllowlist,
  isCommand,
  runCommand,
  type Command,
  type CommandAllowlist,
} from './command.js';

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
