import { execFile } from 'node:child_process';

import { blessSink, isBlessedSink } from '@kovojs/core/internal/sink-policy';

declare const commandBrand: unique symbol;

type CommandExecFileSink = 'server:command-exec-file';

const COMMAND_EXEC_FILE_SINK: CommandExecFileSink = 'server:command-exec-file';

/** A shell-free command minted by {@link cmd}. */
export interface Command {
  /** Executable path or program name passed as `file` to `child_process.execFile`. */
  readonly program: string;
  /** Arguments passed as the `args` array to `child_process.execFile`. */
  readonly argv: readonly string[];
  readonly [commandBrand]: true;
}

/** Options for executing a shell-free {@link Command}. */
export interface CommandRunOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Maximum bytes buffered for stdout/stderr. Defaults to Node's `execFile` default. */
  maxBufferBytes?: number;
  /** Abort signal forwarded to `execFile`. */
  signal?: AbortSignal;
  /** Timeout in milliseconds before Node terminates the child process. */
  timeoutMs?: number;
}

/** Completed stdout/stderr from a shell-free {@link Command}. */
export interface CommandResult {
  readonly stderr: string;
  readonly stdout: string;
}

/**
 * Create a framework-owned, shell-free command capability.
 *
 * SPEC §6.6 / KV424 and `plans/most-secure-web-framework.md` SINK-02: this is a
 * runtime-DiD floor plus a type-only surface, not a proof that raw `child_process`
 * imports elsewhere are impossible. The only execution helper Kovo exposes for
 * this value uses `execFile(..., { shell: false })`.
 */
export function cmd(program: string, argv: readonly string[] = []): Command {
  assertSafeCommandText(program, 'program', { rejectWhitespace: true });
  if (!Array.isArray(argv)) {
    throw new TypeError('Command argv must be an array of strings (SPEC.md §6.6, KV424).');
  }

  const normalizedArgv = argv.map((arg, index) => {
    assertSafeCommandText(arg, `argv[${index}]`, { allowEmpty: true });
    return arg;
  });
  const command = {
    argv: Object.freeze([...normalizedArgv]),
    program,
  } as Command;

  return blessSink<CommandExecFileSink, Command>(COMMAND_EXEC_FILE_SINK, Object.freeze(command));
}

/**
 * Execute a shell-free command minted by {@link cmd}.
 *
 * The runtime witness is re-checked here so `any` casts or structurally forged
 * objects fail closed before reaching `child_process.execFile`.
 */
export function runCommand(
  command: Command,
  options: CommandRunOptions = {},
): Promise<CommandResult> {
  if (!isCommand(command)) {
    throw new TypeError('runCommand requires a Command minted by cmd() (SPEC.md §6.6, KV424).');
  }
  const execOptions = commandExecOptions(options);

  return new Promise((resolve, reject) => {
    execFile(command.program, [...command.argv], execOptions, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        stderr: String(stderr),
        stdout: String(stdout),
      });
    });
  });
}

/** @internal Test/audit hook for the shared Blessed<Sink> witness substrate. */
export function isCommand(value: unknown): value is Command {
  return isBlessedSink(COMMAND_EXEC_FILE_SINK, value);
}

function commandExecOptions(options: CommandRunOptions) {
  if (options.cwd !== undefined) {
    assertSafeCommandText(options.cwd, 'cwd', { allowWhitespace: true });
  }
  if (options.timeoutMs !== undefined) {
    assertNonNegativeInteger(options.timeoutMs, 'timeoutMs');
  }
  if (options.maxBufferBytes !== undefined) {
    assertNonNegativeInteger(options.maxBufferBytes, 'maxBufferBytes');
  }

  return {
    cwd: options.cwd,
    maxBuffer: options.maxBufferBytes,
    shell: false,
    signal: options.signal,
    timeout: options.timeoutMs,
  };
}

function assertSafeCommandText(
  value: string,
  field: string,
  options: {
    allowEmpty?: boolean;
    allowWhitespace?: boolean;
    rejectWhitespace?: boolean;
  } = {},
): void {
  if (typeof value !== 'string') {
    throw new TypeError(`Command ${field} must be a string (SPEC.md §6.6, KV424).`);
  }
  if (value.length === 0 && options.allowEmpty !== true) {
    throw new TypeError(`Command ${field} must be non-empty (SPEC.md §6.6, KV424).`);
  }
  if (hasAsciiControl(value)) {
    throw new TypeError(
      `Command ${field} must not contain NUL, DEL, or ASCII control characters (SPEC.md §6.6, KV424).`,
    );
  }
  if (value !== value.trim()) {
    throw new TypeError(
      `Command ${field} must not contain leading or trailing whitespace (SPEC.md §6.6, KV424).`,
    );
  }
  if (options.rejectWhitespace === true && /\s/.test(value)) {
    throw new TypeError(
      `Command ${field} must be one executable token, not a shell command string (SPEC.md §6.6, KV424).`,
    );
  }
  if (options.allowWhitespace !== true && /\r|\n/.test(value)) {
    throw new TypeError(`Command ${field} must not contain line breaks (SPEC.md §6.6, KV424).`);
  }
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Command ${field} must be a non-negative integer.`);
  }
}
