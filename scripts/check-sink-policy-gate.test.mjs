import { describe, expect, it } from 'vitest';

import {
  blessedSinkKindsReferencedByFile,
  checkSinkPolicyGate,
  commandExecutionSinkFindings,
  commandPrimitiveInvariantFindings,
  dynamicCodeExecutionSinkFindings,
  exportedNames,
  extractRegisteredBlessedSinkKinds,
  publicSinkPolicyEscapeFindings,
} from './check-sink-policy-gate.mjs';

const validPolicy = `
export const FRAMEWORK_BLESSED_SINK_KINDS = [
  'core:route-redirect',
  'parameterized-sql',
] as const;
export type Blessed<Sink extends string> = { readonly __brand?: Sink };
export function blessSink(sink, value) { return value; }
export function isBlessedSink(sink, value) { return true; }
`;

function runFixture(files) {
  return checkSinkPolicyGate({
    blessedSinkFiles: Object.keys(files).filter((file) => file !== 'public.ts'),
    commandExecutionFiles: [],
    exists: (file) => Object.hasOwn(files, file),
    publicEntrypointFiles: Object.hasOwn(files, 'public.ts') ? ['public.ts'] : [],
    readText: (file) => files[file],
    sinkPolicyPath: 'sink-policy.ts',
  });
}

describe('sink-policy gate', () => {
  it('extracts the central blessed sink registry', () => {
    expect([...extractRegisteredBlessedSinkKinds(validPolicy)]).toEqual([
      'core:route-redirect',
      'parameterized-sql',
    ]);
  });

  it('collects literal, const-backed, and typed-union blessed sink use', () => {
    expect([
      ...blessedSinkKindsReferencedByFile(`
        type SqlBlessedSink = 'parameterized-sql' | 'static-sql';
        const ROUTE_REDIRECT_SINK = 'core:route-redirect';
        blessSink(ROUTE_REDIRECT_SINK, value);
        isBlessedSink('server:redirect-location', value);
      `),
    ]).toEqual([
      'parameterized-sql',
      'static-sql',
      'core:route-redirect',
      'server:redirect-location',
    ]);
  });

  it('rejects blessed sink use that is not centrally declared', () => {
    expect(
      runFixture({
        'sink-policy.ts': validPolicy,
        'uses.ts': `blessSink('server:redirect-location', response);`,
      }),
    ).toEqual([
      'uses.ts: blessed sink kind "server:redirect-location" is used but not declared in FRAMEWORK_BLESSED_SINK_KINDS',
    ]);
  });

  it('rejects Symbol.for witnesses in the shared substrate', () => {
    expect(
      runFixture({
        'sink-policy.ts': `${validPolicy}\nconst witness = Symbol.for('kovo.bless.any');`,
      }),
    ).toEqual(['sink-policy.ts: shared Blessed<Sink> witness substrate must not use Symbol.for()']);
  });

  it('rejects new generic trust or bless exports', () => {
    expect(exportedNames('export { hidden as trustSink };')).toEqual(new Set(['trustSink']));
    expect(
      runFixture({
        'sink-policy.ts': `${validPolicy}\nexport function trustSink(value) { return value; }`,
        'public.ts': 'export { blessSink } from "./internal/sink-policy.js";',
      }),
    ).toEqual([
      'sink-policy.ts: unexpected sink-policy export trustSink; avoid generic trust/bless escape hatches',
      'public.ts: public export blessSink would create a generic blessed-sink escape hatch',
    ]);
  });

  it('rejects aliased and wildcard public re-exports from the sink-policy module', () => {
    expect(
      publicSinkPolicyEscapeFindings(
        'public.ts',
        `
          export { blessSink as unsafeBless } from "./internal/sink-policy.js";
          export * as sinkPolicy from "./internal/sink-policy.js";
        `,
      ),
    ).toEqual([
      'public.ts: public re-export blessSink from internal sink-policy would create a generic blessed-sink escape hatch',
      'public.ts: public wildcard re-export from internal sink-policy would create a generic blessed-sink escape hatch',
    ]);
  });

  it('rejects public aliases of imported sink-policy escape hatches', () => {
    expect(
      publicSinkPolicyEscapeFindings(
        'public.ts',
        `
          import { blessSink as mintSink, isBlessedSink } from "./internal/sink-policy.js";
          export { mintSink as reviewedSinkFactory, isBlessedSink as checkedSink };
        `,
      ),
    ).toEqual([
      'public.ts: public export reviewedSinkFactory aliases internal sink-policy blessSink and would create a generic blessed-sink escape hatch',
      'public.ts: public export checkedSink aliases internal sink-policy isBlessedSink and would create a generic blessed-sink escape hatch',
    ]);
  });

  it('rejects command execution imports outside the server command primitive', () => {
    expect(
      commandExecutionSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          import { exec as shell, execFile } from "node:child_process";
          shell("git status");
          execFile("git", ["status"]);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden child_process.exec import; use cmd()/runCommand() so command execution stays shell-free and witnessed',
      'packages/server/src/unsafe.ts: raw child_process.execFile import is outside the command primitive; use cmd()/runCommand()',
      'packages/server/src/unsafe.ts: raw child_process.execFile call is outside the command primitive; use cmd()/runCommand()',
    ]);

    expect(
      commandExecutionSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          import * as childProcess from "child_process";
          childProcess.execSync("git status");
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: raw child_process.execSync call is outside the command primitive; use cmd()/runCommand()',
    ]);
  });

  it('allows only the command primitive to hold execFile while keeping shell sinks forbidden', () => {
    expect(
      commandExecutionSinkFindings(
        'packages/server/src/command.ts',
        'import { execFile } from "node:child_process";',
        { allowedExecutionSink: true },
      ),
    ).toEqual([]);

    expect(
      commandExecutionSinkFindings(
        'packages/server/src/command.ts',
        'import { execSync } from "node:child_process";',
        { allowedExecutionSink: true },
      ),
    ).toEqual([
      'packages/server/src/command.ts: forbidden child_process.execSync import; use cmd()/runCommand() so command execution stays shell-free and witnessed',
    ]);
  });

  it('asserts runCommand keeps its witness check and shell-free execFile options', () => {
    expect(
      commandPrimitiveInvariantFindings(
        'packages/server/src/command.ts',
        `
          const COMMAND_EXEC_FILE_SINK = 'server:command-exec-file';
          export function cmd(value) {
            return blessSink(COMMAND_EXEC_FILE_SINK, value);
          }
          export function isCommand(value) {
            return isBlessedSink(COMMAND_EXEC_FILE_SINK, value);
          }
          export function runCommand(command) {
            if (!isCommand(command)) throw new TypeError();
            const execOptions = { shell: false };
            execFile(command.program, [...command.argv], execOptions, () => {});
          }
        `,
      ),
    ).toEqual([]);

    expect(
      commandPrimitiveInvariantFindings(
        'packages/server/src/command.ts',
        `
          const COMMAND_EXEC_FILE_SINK = 'server:command-exec-file';
          export function cmd(value) {
            return value;
          }
          export function runCommand(command) {
            execFile(command.program, command.argv, {}, () => {});
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/command.ts: cmd() must mint Command values with the registered command execution witness',
      'packages/server/src/command.ts: runCommand() must re-check the registered command execution witness',
      'packages/server/src/command.ts: runCommand() must execute the minted program/argv through execFile with explicit options',
      'packages/server/src/command.ts: runCommand() execFile options must set shell: false',
    ]);
  });

  it('runs the command execution gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: ['packages/server/src/unsafe.ts'],
        exists: (file) => file === 'packages/server/src/unsafe.ts' || file === 'sink-policy.ts',
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'import { execSync } from "node:child_process";',
        sinkPolicyPath: 'sink-policy.ts',
      }),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden child_process.execSync import; use cmd()/runCommand() so command execution stays shell-free and witnessed',
    ]);
  });

  it('rejects direct eval dynamic code execution in server source', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          // eval("ignored comment");
          export function run(source) {
            return eval(source);
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink eval(); server source must not execute generated code',
    ]);
  });

  it('rejects Function constructor and call dynamic code execution in server source', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          export const make = new Function("return 1");
          export const call = Function("return 2");
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink new Function(); server source must not execute generated code',
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code',
    ]);
  });

  it('rejects vm imports and requires in server source', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/unsafe-import.ts',
        `
          import { Script } from "node:vm";
          const vm = require("vm");
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-import.ts: forbidden dynamic code execution sink node:vm/vm import or require; server source must not execute generated code',
    ]);
  });

  it('allows benign server source without dynamic code sinks', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/safe.ts',
        `
          export function render(value) {
            return String(value);
          }
        `,
      ),
    ).toEqual([]);
  });

  it('runs the dynamic code execution gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: ['packages/server/src/unsafe.ts', 'packages/server/src/safe.ts'],
        exists: (file) =>
          file === 'packages/server/src/unsafe.ts' ||
          file === 'packages/server/src/safe.ts' ||
          file === 'sink-policy.ts',
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : file === 'packages/server/src/unsafe.ts'
              ? 'export const run = Function("return 1");'
              : 'export const ok = 1;',
        sinkPolicyPath: 'sink-policy.ts',
      }),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code',
    ]);
  });
});
