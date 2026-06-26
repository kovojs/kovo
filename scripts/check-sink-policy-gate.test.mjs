import { describe, expect, it } from 'vitest';

import {
  blessedSinkKindsReferencedByFile,
  checkSinkPolicyGate,
  commandExecutionSinkFindings,
  commandPrimitiveInvariantFindings,
  deserializationSinkFindings,
  dynamicCodeExecutionSinkFindings,
  exportedNames,
  extractRegisteredBlessedSinkKinds,
  logChannelNeutralizerInvariantFindings,
  logChannelSinkFindings,
  publicSinkPolicyEscapeFindings,
  responseFragmentApplyInvariantFindings,
  rootedFileServeRawSinkFindings,
  rootedFileServeInvariantFindings,
  sqlBlessedBrandLaunderingFindings,
  sqlBlessedBrandStampFindings,
  sqlGuardDowngradeFindings,
  sqlSafetyInvariantFindings,
} from './check-sink-policy-gate.mjs';

const validPolicy = `
export const FRAMEWORK_BLESSED_SINK_KINDS = [
  'browser:response-fragment-html',
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
    deserializationFiles: [],
    logChannelFiles: [],
    exists: (file) => Object.hasOwn(files, file),
    publicEntrypointFiles: Object.hasOwn(files, 'public.ts') ? ['public.ts'] : [],
    readText: (file) => files[file],
    responseFragmentApplyPath: undefined,
    rootedFileServeSinkFiles: [],
    sinkPolicyPath: 'sink-policy.ts',
    sqlBlessedBrandFiles: [],
    sqlGuardDowngradeFiles: [],
    sqlSafetyInvariantFiles: [],
  });
}

describe('sink-policy gate', () => {
  it('extracts the central blessed sink registry', () => {
    expect([...extractRegisteredBlessedSinkKinds(validPolicy)]).toEqual([
      'browser:response-fragment-html',
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

  it('asserts rootedFiles keeps constructor-owned root and witness checks', () => {
    expect(
      rootedFileServeInvariantFindings(
        'packages/server/src/file.ts',
        `
          const ROOTED_FILE_SERVE_SINK = 'rooted-file-serve';
          export async function rootedFiles(root) {
            const realRoot = await realpath(root);
            const capability = {
              root: realRoot,
              serve: (path, options) => serveRootedFile(realRoot, path, options),
            };
            return blessSink(ROOTED_FILE_SERVE_SINK, Object.freeze(capability));
          }
          export function isRootedFileServeCapability(value) {
            return isBlessedSink(ROOTED_FILE_SERVE_SINK, value);
          }
          async function serveRootedFile(realRoot, requestedPath, options) {
            const candidate = rootedCandidate(realRoot, requestedPath);
            const resolved = await safeRealpath(candidate);
            if (!containsPath(realRoot, resolved)) return undefined;
            const handle = await safeOpen(resolved);
            const [stat, postOpenResolved] = await Promise.all([
              handle.stat(),
              safeRealpath(resolved),
            ]);
            if (!stat.isFile() || !containsPath(realRoot, postOpenResolved)) return undefined;
            return respond.stream(await handle.readFile(), options);
          }
        `,
      ),
    ).toEqual([]);

    expect(
      rootedFileServeInvariantFindings(
        'packages/server/src/file.ts',
        `
          export async function rootedFiles(root) {
            const capability = {
              root,
              serve: (path, options) => serveRootedFile(root, path, options),
            };
            return capability;
          }
          export function isRootedFileServeCapability(_value) {
            return true;
          }
          async function serveRootedFile(realRoot, requestedPath, options) {
            const candidate = rootedCandidate(realRoot, requestedPath);
            const handle = await safeOpen(candidate);
            const stat = await handle.stat();
            if (!stat.isFile()) return undefined;
            return respond.stream(await handle.readFile(), options);
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/file.ts: rooted file primitive must declare the registered rooted-file-serve sink kind',
      'packages/server/src/file.ts: rootedFiles() must normalize the constructor root through realpath() before minting a capability',
      'packages/server/src/file.ts: rootedFiles() must close serve() over the constructor-owned realRoot',
      'packages/server/src/file.ts: rootedFiles() must mint a frozen RootedFiles capability with the registered sink witness',
      'packages/server/src/file.ts: isRootedFileServeCapability() must re-check the registered rooted-file-serve witness',
      'packages/server/src/file.ts: rooted file serving must realpath the candidate before opening it',
      'packages/server/src/file.ts: rooted file serving must reject candidate realpaths outside the constructor root',
      'packages/server/src/file.ts: rooted file serving must re-stat and re-realpath after open',
      'packages/server/src/file.ts: rooted file serving must reject post-open realpaths outside the constructor root',
    ]);
  });

  it('runs the rooted file-serve ownership gate over the configured sink file', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: [],
        deserializationFiles: [],
        exists: (file) => file === 'sink-policy.ts' || file === 'packages/server/src/file.ts',
        logChannelFiles: [],
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : `
              const ROOTED_FILE_SERVE_SINK = 'rooted-file-serve';
              export async function rootedFiles(root) {
                const capability = {
                  root,
                  serve: (path, options) => serveRootedFile(root, path, options),
                };
                return blessSink(ROOTED_FILE_SERVE_SINK, capability);
              }
            `,
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: ['packages/server/src/file.ts'],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'packages/server/src/file.ts: rootedFiles() must normalize the constructor root through realpath() before minting a capability',
      'packages/server/src/file.ts: rootedFiles() must close serve() over the constructor-owned realRoot',
      'packages/server/src/file.ts: rootedFiles() must mint a frozen RootedFiles capability with the registered sink witness',
      'packages/server/src/file.ts: isRootedFileServeCapability() must re-check the registered rooted-file-serve witness',
      'packages/server/src/file.ts: rooted file serving must realpath the candidate before opening it',
      'packages/server/src/file.ts: rooted file serving must reject candidate realpaths outside the constructor root',
      'packages/server/src/file.ts: rooted file serving must re-stat and re-realpath after open',
      'packages/server/src/file.ts: rooted file serving must reject post-open realpaths outside the constructor root',
    ]);
  });

  it('rejects raw filesystem file-serve sinks outside the rooted file primitive', () => {
    expect(
      rootedFileServeRawSinkFindings(
        'packages/server/src/unsafe-file.ts',
        `
          import { createReadStream, open as rawOpen } from "node:fs";
          import fs from "fs";
          import * as fsPromises from "node:fs/promises";
          export { open as rawOpenPromise } from "node:fs/promises";
          export * from "fs";
          export * as fsPromisesRaw from "node:fs/promises";
          const stream = createReadStream(requestedPath);
          fs.createWriteStream(requestedPath);
          rawOpen(requestedPath, "r", () => {});
          await fsPromises.open(requestedPath);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem createReadStream import is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem createReadStream call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem open import is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem open call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem createWriteStream call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem open re-export is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem wildcard re-export from fs is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem wildcard re-export from node:fs/promises is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
    ]);
  });

  it('allows non-sink wildcard exports beside quiet filesystem use', () => {
    expect(
      rootedFileServeRawSinkFindings(
        'packages/server/src/safe-file.ts',
        `
          export * from "./safe-paths.js";
          export * as helpers from "./helpers.js";
          import { stat } from "node:fs/promises";
          const meta = await stat(root);
        `,
      ),
    ).toEqual([]);
  });

  it('rejects static dynamic-import raw filesystem file-serve sinks', () => {
    expect(
      rootedFileServeRawSinkFindings(
        'packages/server/src/unsafe-file.ts',
        `
          const fs = await import("node:fs");
          const fsPromises = await import("node:fs/promises");
          fs.createReadStream(requestedPath);
          await fsPromises.open(requestedPath);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem createReadStream call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem open call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
    ]);
  });

  it('allows non-sink static dynamic filesystem imports', () => {
    expect(
      rootedFileServeRawSinkFindings(
        'packages/server/src/read-file.ts',
        `
          const fs = await import("node:fs/promises");
          const childProcess = await import("node:child_process");
          const bytes = await fs.readFile(manifestPath);
          childProcess.spawn("git", ["status"]);
        `,
      ),
    ).toEqual([]);
  });

  it('allows raw filesystem file-serve sinks only in the rooted file primitive owner', () => {
    expect(
      rootedFileServeRawSinkFindings(
        'packages/server/src/file.ts',
        `
          import { open } from "node:fs/promises";
          export async function safeOpen(path) {
            return await open(path);
          }
        `,
        { allowedFileServeSink: true },
      ),
    ).toEqual([]);
  });

  it('runs the raw filesystem file-serve sink gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: ['packages/server/src/unsafe-file.ts'],
        deserializationFiles: [],
        exists: (file) =>
          file === 'packages/server/src/unsafe-file.ts' || file === 'sink-policy.ts',
        logChannelFiles: [],
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'import { createWriteStream } from "node:fs"; createWriteStream(path);',
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem createWriteStream import is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
      'packages/server/src/unsafe-file.ts: KV424 raw filesystem createWriteStream call is outside the rooted file-serve primitive; use rootedFiles().serve() so file/path sinks stay rooted and witnessed',
    ]);
  });

  it('runs the command execution gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: ['packages/server/src/unsafe.ts'],
        deserializationFiles: [],
        logChannelFiles: [],
        exists: (file) => file === 'packages/server/src/unsafe.ts' || file === 'sink-policy.ts',
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'import { execSync } from "node:child_process";',
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
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

  it('rejects indirect, member, and aliased eval dynamic code execution in server source', () => {
    const finding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink eval(); server source must not execute generated code';

    for (const source of [
      'export const run = (0, eval)(code);',
      'export const run = globalThis.eval(code);',
      'const run = eval; export const result = run(code);',
      'const run = (eval); export const result = (run)(code);',
      'const run = globalThis.eval; export const result = run(code);',
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        finding,
      ]);
    }
  });

  it('rejects literal bracket global eval dynamic code execution in server source', () => {
    const finding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink eval(); server source must not execute generated code';

    for (const source of [
      'export const run = globalThis["eval"](code);',
      "export const run = (globalThis['eval'])(code);",
      'const run = globalThis["eval"]; export const result = run(code);',
      "const run = (globalThis['eval']); export const result = (run)(code);",
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        finding,
      ]);
    }
  });

  it('rejects eval dynamic code execution through call, apply, and bind laundering', () => {
    const finding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink eval(); server source must not execute generated code';

    for (const source of [
      'export const run = eval.call(globalThis, code);',
      'export const run = eval.apply(null, [code]);',
      'export const run = globalThis.eval.call(globalThis, code);',
      'export const run = globalThis["eval"].apply(null, [code]);',
      "export const run = (globalThis['eval']).call(globalThis, code);",
      'const run = globalThis.eval; export const result = run.call(null, code);',
      'const run = globalThis["eval"]; export const result = run.apply(null, [code]);',
      'const run = globalThis.eval.bind(globalThis); export const result = run(code);',
      'const run = globalThis["eval"].bind(globalThis); export const result = (run)(code);',
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        finding,
      ]);
    }
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

  it('rejects member and aliased Function constructor dynamic code execution in server source', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          const Make = Function;
          const MakeGlobal = globalThis.Function;
          export const made = new Make(code);
          export const called = MakeGlobal(code);
          export const globalMade = new globalThis.Function(code);
          export const globalCalled = globalThis.Function(code);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink new Function(); server source must not execute generated code',
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code',
    ]);
  });

  it('keeps new Function aliases classified as constructor findings', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          const Make = Function;
          export const direct = new Function(code);
          export const aliased = new Make(code);
          export const member = new globalThis.Function(code);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink new Function(); server source must not execute generated code',
    ]);
  });

  it('rejects literal bracket global Function dynamic code execution in server source', () => {
    const constructorFinding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink new Function(); server source must not execute generated code';
    const callFinding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code';

    for (const source of [
      'export const made = new globalThis["Function"](code);',
      "export const made = new (globalThis['Function'])(code);",
      'const Make = globalThis["Function"]; export const made = new Make(code);',
      "const Make = (globalThis['Function']); export const made = new (Make)(code);",
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        constructorFinding,
      ]);
    }

    for (const source of [
      'export const call = globalThis["Function"](code);',
      "export const call = (globalThis['Function'])(code);",
      'const Make = globalThis["Function"]; export const call = Make(code);',
      "const Make = (globalThis['Function']); export const call = (Make)(code);",
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        callFinding,
      ]);
    }
  });

  it('rejects Function dynamic code execution through call, apply, and bind laundering', () => {
    const constructorFinding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink new Function(); server source must not execute generated code';
    const callFinding =
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code';

    for (const source of [
      'export const call = Function.call(null, "return 1");',
      'export const call = Function.apply(null, ["return 1"]);',
      'export const call = globalThis.Function.call(null, code);',
      'export const call = globalThis["Function"].apply(null, [code]);',
      "export const call = (globalThis['Function']).call(null, code);",
      'const Make = globalThis.Function; export const call = Make.call(null, code);',
      'const Make = globalThis["Function"]; export const call = Make.apply(null, [code]);',
      'const Make = globalThis.Function.bind(globalThis); export const call = Make("return 1");',
      'const Make = globalThis["Function"].bind(globalThis); export const call = (Make)(code);',
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        callFinding,
      ]);
    }

    for (const source of [
      'const Make = globalThis.Function.bind(globalThis); export const made = new Make("return 1");',
      'const Make = globalThis["Function"].bind(globalThis); export const made = new (Make)(code);',
    ]) {
      expect(dynamicCodeExecutionSinkFindings('packages/server/src/unsafe.ts', source)).toEqual([
        constructorFinding,
      ]);
    }
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

  it('allows locally shadowed dynamic-code names and explanatory strings/comments', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/safe.ts',
        `
          // (0, eval)(code); globalThis.Function(code); globalThis["eval"](code);
          const note =
            "eval(code); new Function(code); globalThis.eval(code); globalThis['Function'](code)";
          export function safe(eval, globalThis) {
            const run = eval;
            function Function(value) {
              return value;
            }
            const Make = Function;
            const bracketRun = globalThis["eval"];
            const bracketMake = globalThis["Function"];
            return [
              run("value"),
              new Make("value"),
              globalThis.eval("value"),
              bracketRun("value"),
              new bracketMake("value"),
              eval.call(null, "value"),
              globalThis["eval"].apply(null, ["value"]),
              Function.call(null, "value"),
              globalThis.Function.bind(null)("value"),
            ];
          }
        `,
      ),
    ).toEqual([]);
  });

  it('allows locally rebound aliases from literal bracket dynamic-code globals', () => {
    expect(
      dynamicCodeExecutionSinkFindings(
        'packages/server/src/safe.ts',
        `
          const run = globalThis["eval"];
          const Make = globalThis["Function"];
          export function safe(code) {
            const run = (value) => value;
            let Make = class SafeFunction {};
            Make = class SaferFunction {};
            return [run(code), new Make(code)];
          }
        `,
      ),
    ).toEqual([]);
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
        deserializationFiles: [],
        logChannelFiles: [],
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
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code',
    ]);
  });

  it('rejects JSON.parse revivers as unsafe deserialization sinks', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-deserialize.ts',
        `
          export function decode(bytes) {
            return JSON.parse(new TextDecoder().decode(bytes), (_key, value) => value);
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization sink JSON.parse reviver; keep body/wire decode reviver-free and route request shapes through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          export function matchesRequest(request) {
            return [
              new RegExp(request.headers.get("x-pattern") ?? ""),
              RegExp(request.url),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);

    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          export function matchesRequest(request) {
            const fromQuery = request.query.get("pattern");
            const fromContext = \`\${request.url}\`;
            const oneHop = fromQuery;
            return [new RegExp(oneHop, "i"), new RegExp(fromContext)];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('dedupes request-derived dynamic RegExp constructor and function call findings', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          export function matchesRequest(request) {
            return [RegExp(request.url), new RegExp(request.url)];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction through a local constructor alias', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          const Pattern = RegExp;
          export function matchesRequest(request) {
            return [Pattern(request.url), new Pattern(request.headers.get("x-pattern") ?? "")];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction through global constructor members', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          export function matchesRequest(request) {
            return [
              globalThis.RegExp(request.url),
              new globalThis.RegExp(request.headers.get("x-pattern") ?? ""),
              globalThis["RegExp"](request.query.get("pattern")),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction through optional constructor calls', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          const Pattern = RegExp;
          const GlobalPattern = globalThis.RegExp;
          export function matchesRequest(request) {
            return [
              RegExp?.(request.url),
              globalThis.RegExp?.(request.headers.get("x-pattern") ?? ""),
              globalThis["RegExp"]?.(request.query.get("pattern")),
              Pattern?.(request.url),
              GlobalPattern?.(request.url),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects parenthesized request-derived dynamic RegExp constructor forms', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          export function matchesRequest(request) {
            return [
              (RegExp)(request.url),
              new (RegExp)(request.headers.get("x-pattern") ?? ""),
              (globalThis.RegExp)(request.query.get("pattern")),
              new (globalThis["RegExp"])(request.url),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction through a global constructor alias', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          const Pattern = globalThis.RegExp;
          const BracketPattern = globalThis["RegExp"];
          export function matchesRequest(request) {
            return [
              Pattern(request.url),
              new BracketPattern(request.headers.get("x-pattern") ?? ""),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction through destructured global constructor aliases', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          const { RegExp: Pattern } = globalThis;
          const { RegExp } = globalThis;
          const { ["RegExp"]: BracketPattern } = globalThis;
          const { "RegExp": QuotedPattern } = (globalThis);
          export function matchesRequest(request) {
            return [
              RegExp(request.url),
              Pattern(request.url),
              new BracketPattern(request.headers.get("x-pattern") ?? ""),
              QuotedPattern?.(request.query.get("pattern")),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects request-derived dynamic RegExp construction through parenthesized constructor aliases', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-match.ts',
        `
          const Pattern = (RegExp);
          const GlobalPattern = (globalThis.RegExp);
          const BracketPattern = (globalThis["RegExp"]);
          export function matchesRequest(request) {
            return [
              (Pattern)(request.url),
              new (GlobalPattern)(request.headers.get("x-pattern") ?? ""),
              BracketPattern(request.query.get("pattern")),
            ];
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-match.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('allows static RegExp construction and reviver-free JSON decode', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/safe-match.ts',
        `
          const STATIC_PATTERN = "^[a-z0-9_-]+$";
          const RAW_STATIC_PATTERN = String.raw\`^/assets/[a-z]+$\`;
          const input = STATIC_PATTERN;
          const { RegExp } = globalThis;
          const { RegExp: Pattern } = globalThis;
          const { ["RegExp"]: BracketPattern } = globalThis;
          export function decodeAndMatch(raw) {
            const parsed = JSON.parse(raw);
            return [
              parsed,
              new RegExp("^[a-z]+$", "i"),
              new RegExp(\`^kovo-[a-z]+$\`),
              new RegExp(STATIC_PATTERN),
              new RegExp(RAW_STATIC_PATTERN),
              new RegExp(input),
              RegExp("^[a-z]+$", "i"),
              RegExp(STATIC_PATTERN),
              globalThis.RegExp("^[a-z]+$", "i"),
              new globalThis.RegExp(STATIC_PATTERN),
              (RegExp)(STATIC_PATTERN),
              (RegExp)?.(STATIC_PATTERN),
              RegExp?.("^[a-z]+$", "i"),
              new (RegExp)(RAW_STATIC_PATTERN),
              (globalThis.RegExp)("^[a-z]+$", "i"),
              globalThis.RegExp?.("^[a-z]+$", "i"),
              globalThis["RegExp"]?.(STATIC_PATTERN),
              new (globalThis["RegExp"])(STATIC_PATTERN),
              RegExp(STATIC_PATTERN),
              Pattern("^[a-z]+$", "i"),
              new BracketPattern(STATIC_PATTERN),
            ];
          }
        `,
      ),
    ).toEqual([]);
  });

  it('allows safe and shadowed RegExp-like aliases outside request-derived dynamic construction', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/safe-match.ts',
        `
          const Pattern = RegExp;
          const StaticPattern = RegExp;
          const { RegExp: DestructuredPattern } = globalThis;
          let { RegExp: ReboundRegExp } = globalThis;
          const Parser = URLPattern;
          export function decodeAndMatch(request) {
            function Pattern(value) {
              return value;
            }
            function DestructuredPattern(value) {
              return value;
            }
            ReboundRegExp = (value) => value;
            return [
              Pattern(request.url),
              Pattern?.(request.url),
              (Pattern)(request.url),
              StaticPattern("^[a-z]+$"),
              StaticPattern?.("^[a-z]+$"),
              DestructuredPattern(request.url),
              ReboundRegExp(request.url),
              Parser(request.url),
              new RegExp("^[a-z]+$", "i"),
            ];
          }
        `,
      ),
    ).toEqual([]);
  });

  it('allows locally shadowed parenthesized RegExp constructor names', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/safe-match.ts',
        `
          export function decodeAndMatch(request) {
            const RegExp = (value) => value;
            const Pattern = (RegExp);
            return [
              (RegExp)(request.url),
              RegExp?.(request.url),
              new (Pattern)(request.headers.get("x-pattern") ?? ""),
              Pattern?.(request.headers.get("x-pattern") ?? ""),
            ];
          }
        `,
      ),
    ).toEqual([]);
  });

  it('allows locally shadowed global RegExp member forms', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/safe-match.ts',
        `
          export function decodeAndMatch(globalThis, request) {
            const Pattern = globalThis.RegExp;
            const { RegExp: DestructuredPattern } = globalThis;
            const { RegExp } = globalThis;
            return [
              RegExp(request.url),
              globalThis.RegExp(request.url),
              globalThis.RegExp?.(request.url),
              globalThis["RegExp"]?.(request.headers.get("x-pattern") ?? ""),
              new globalThis["RegExp"](request.headers.get("x-pattern") ?? ""),
              Pattern?.(request.url),
              Pattern(request.url),
              DestructuredPattern(request.url),
            ];
          }
        `,
      ),
    ).toEqual([]);
  });

  it('allows locally rebound unrenamed destructured RegExp aliases', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/safe-match.ts',
        `
          let { RegExp } = globalThis;
          RegExp = (value) => value;
          export function decodeAndMatch(request) {
            return RegExp(request.url);
          }
        `,
      ),
    ).toEqual([]);
  });

  it('rejects deserialize and unserialize imports and calls', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-deserialize.ts',
        `
          import { deserialize as thaw } from "node:v8";
          import * as serializer from "serialize-javascript";
          const { unserialize } = require("php-serialize");
          thaw(bytes);
          serializer.deserialize(blob);
          unserialize(payload);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization import deserialize; avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization call thaw(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization import unserialize; avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization call unserialize(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization call serializer.deserialize(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
    ]);
  });

  it('rejects dynamic imports of known deserializer module APIs', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/unsafe-deserialize.ts',
        `
          const v8 = await import("node:v8");
          const { unserialize: thaw } = await import("php-serialize");
          v8.deserialize(bytes);
          thaw(payload);
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization import unserialize; avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization call thaw(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization call v8.deserialize(); avoid unowned deserialize/unserialize APIs and use JSON.parse without reviver plus schema validation',
    ]);
  });

  it('allows reviver-free JSON decode before schema/body validation', () => {
    expect(
      deserializationSinkFindings(
        'packages/server/src/safe-body.ts',
        `
          import { parseSchemaAsync } from "./schema.js";
          export async function decodeBody(schema, request) {
            const raw = await request.text();
            const parsed = JSON.parse(raw);
            const safeSchema = await import("./schema.js");
            return parseSchemaAsync(schema, parsed);
          }
        `,
      ),
    ).toEqual([]);
  });

  it('runs the deserialization gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: [],
        deserializationFiles: ['packages/server/src/unsafe-deserialize.ts'],
        exists: (file) =>
          file === 'packages/server/src/unsafe-deserialize.ts' || file === 'sink-policy.ts',
        logChannelFiles: [],
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : `
              export function unsafe(request) {
                const decoded = JSON.parse(payload, revivePayload);
                return new RegExp(request.url);
              }
            `,
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe deserialization sink JSON.parse reviver; keep body/wire decode reviver-free and route request shapes through schema validation',
      'packages/server/src/unsafe-deserialize.ts: KV442 unsafe dynamic RegExp sink from request/input-derived value; keep pattern construction static or route matching through schema validation',
    ]);
  });

  it('rejects raw console logging of request-derived values', () => {
    expect(
      logChannelSinkFindings(
        'packages/server/src/unsafe.ts',
        `
          export function handle(request) {
            console.warn(\`failed \${request.url}\`);
            console.error('method', request.method);
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe.ts: raw console.warn of request-derived values is a KV439 log sink; route values through neutralizeLogValue()/formatLogMessage() before logging',
      'packages/server/src/unsafe.ts: raw console.error of request-derived values is a KV439 log sink; route values through neutralizeLogValue()/formatLogMessage() before logging',
    ]);
  });

  it('allows request-derived console logging through the central neutralizer path', () => {
    expect(
      logChannelSinkFindings(
        'packages/server/src/safe.ts',
        `
          import { formatLogMessage, neutralizeLogValue } from './logging.js';
          export function handle(ctx) {
            console.warn(formatLogMessage\`failed \${ctx.request.url}\`);
            console.error('method', neutralizeLogValue(ctx.request.method));
          }
        `,
      ),
    ).toEqual([]);
  });

  it('runs the log-channel gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: [],
        deserializationFiles: [],
        exists: (file) => file === 'sink-policy.ts' || file === 'packages/server/src/unsafe.ts',
        logChannelFiles: ['packages/server/src/unsafe.ts'],
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'export function handle(request) { console.info(request.url); }',
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'packages/server/src/unsafe.ts: raw console.info of request-derived values is a KV439 log sink; route values through neutralizeLogValue()/formatLogMessage() before logging',
    ]);
  });

  it('pins the log-channel neutralizer to visible control-character escaping', () => {
    expect(
      logChannelNeutralizerInvariantFindings(
        'packages/server/src/logging.ts',
        `
          const CONTROL_CHARACTER_PATTERN = /[\\u0000-\\u001f\\u007f-\\u009f]/g;
          function visibleControlEscape(char: string): string {
            return \`\\\\u\${char.charCodeAt(0).toString(16).padStart(4, '0')}\`;
          }
          export function neutralizeLogValue(value: unknown): string {
            return String(value).replace(CONTROL_CHARACTER_PATTERN, visibleControlEscape);
          }
          export function formatLogMessage(strings: TemplateStringsArray, ...values: unknown[]): string {
            return neutralizeLogValue(String.raw(strings, ...values));
          }
        `,
      ),
    ).toEqual([]);
  });

  it('rejects fail-open SQL guard env and config downgrade paths in production source', () => {
    expect(
      sqlGuardDowngradeFindings(
        'packages/server/src/sql-safe-handle.ts',
        `
          export function resolveSqlGuard() {
            if (process.env.KOVO_SQL_GUARD === 'off') return 'off';
            return { sqlSafetyMode: 'warn' };
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/sql-safe-handle.ts: SQL safety must remain default-deny; remove SQL guard downgrade path (KOVO_SQL_GUARD env knob)',
      'packages/server/src/sql-safe-handle.ts: SQL safety must remain default-deny; remove SQL guard downgrade path (SQL-related process.env guard)',
      'packages/server/src/sql-safe-handle.ts: SQL safety must remain default-deny; remove SQL guard downgrade path (sql guard warn/off config)',
    ]);
  });

  it('rejects a fake SqlSafetyMode warn/off union', () => {
    expect(
      sqlGuardDowngradeFindings(
        'packages/core/src/internal/sql-safety.ts',
        `export type SqlSafetyMode = 'enforce' | 'warn' | 'off';`,
      ),
    ).toEqual([
      'packages/core/src/internal/sql-safety.ts: SQL safety must remain default-deny; remove SQL guard downgrade path (SqlSafetyMode warn/off union)',
    ]);
  });

  it('allows explanatory SQL guard text in comments, tests, and plans', () => {
    expect(
      sqlGuardDowngradeFindings(
        'packages/server/src/sql-safe-handle.ts',
        `
          // KOVO_SQL_GUARD=warn/off used to fail open; this comment must stay legal.
          export const mode = 'enforce';
        `,
      ),
    ).toEqual([]);
    expect(
      sqlGuardDowngradeFindings(
        'packages/server/src/sql-safe-handle.test.ts',
        `
          process.env.KOVO_SQL_GUARD = 'warn';
          const sqlSafetyMode = 'off';
        `,
      ),
    ).toEqual([]);
    expect(
      sqlGuardDowngradeFindings(
        'plans/most-secure-web-framework.md',
        'KOVO_SQL_GUARD warn/off must stay forbidden in production source.',
      ),
    ).toEqual([]);
  });

  it('pins SQL-safety diagnostics and managed-handle behavior to error/default-deny', () => {
    expect(
      sqlSafetyInvariantFindings(
        'packages/core/src/diagnostics.ts',
        `
          export const diagnosticDefinitions = {
            KV422: {
              code: 'KV422',
              severity: 'error',
              message: 'SQL text injection risk.',
            },
          };
        `,
      ),
    ).toEqual([]);

    expect(
      sqlSafetyInvariantFindings(
        'packages/core/src/internal/sql-safety.ts',
        `
          export type SqlSafetyMode = 'enforce';
          function unsafeSqlResult(message: string): SqlStatementValidationResult {
            return { ok: false, message };
          }
        `,
      ),
    ).toEqual([]);

    expect(
      sqlSafetyInvariantFindings(
        'packages/server/src/sql-safe-handle.ts',
        `
          function assertManagedSqlStatement(statement: unknown): void {
            const validation = validateManagedSqlStatement(statement);
            if (validation.ok) return;
            throw new Error(validation.message);
          }
        `,
      ),
    ).toEqual([]);
  });

  it('flags SQL-safety invariant drift toward warn or pass-through', () => {
    expect(
      sqlSafetyInvariantFindings(
        'packages/core/src/diagnostics.ts',
        `export const diagnosticDefinitions = { KV422: { severity: 'warn' } };`,
      ),
    ).toEqual([
      'packages/core/src/diagnostics.ts: KV422 SQL-safety diagnostic severity must remain error',
    ]);

    expect(
      sqlSafetyInvariantFindings(
        'packages/core/src/internal/sql-safety.ts',
        `
          export type SqlSafetyMode = 'enforce' | 'warn';
          function unsafeSqlResult(message: string): SqlStatementValidationResult {
            return { ok: true, message };
          }
        `,
      ),
    ).toEqual([
      'packages/core/src/internal/sql-safety.ts: SqlSafetyMode must remain the single enforce mode',
      'packages/core/src/internal/sql-safety.ts: unsafe SQL validation results must remain fail-closed',
    ]);

    expect(
      sqlSafetyInvariantFindings(
        'packages/server/src/sql-safe-handle.ts',
        `
          function assertManagedSqlStatement(statement: unknown): void {
            const validation = validateManagedSqlStatement(statement);
            if (validation.ok) return;
            console.warn(validation.message);
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/sql-safe-handle.ts: managed DB handle must throw on failed SQL validation',
    ]);
  });

  it('requires the browser response-fragment HTML sink kind to be centrally registered', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: [],
        deserializationFiles: [],
        logChannelFiles: [],
        exists: (file) => file === 'sink-policy.ts',
        publicEntrypointFiles: [],
        readText: () => `
          export const FRAMEWORK_BLESSED_SINK_KINDS = ['parameterized-sql'] as const;
          export type Blessed<Sink extends string> = { readonly __brand?: Sink };
          export function blessSink(sink, value) { return value; }
          export function isBlessedSink(sink, value) { return true; }
        `,
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'sink-policy.ts: FRAMEWORK_BLESSED_SINK_KINDS must register "browser:response-fragment-html" for the browser response-fragment raw HTML sink',
    ]);
  });

  it('rejects SQL blessed-brand laundering through any/unknown assertion chains', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/server/src/sql-safe-handle.ts',
        `
          import type { ParameterizedSql, TrustedSql } from '@kovojs/core/internal/sql-safety';
          const one = request.url as unknown as ParameterizedSql;
          const two = raw as any as TrustedSql;
        `,
      ),
    ).toEqual([
      'packages/server/src/sql-safe-handle.ts: KV440 SQL blessed-brand laundering via any/unknown assertion chain; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
    ]);
  });

  it('rejects direct SQL blessed-brand assertions outside the owning constructor module', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/drizzle/src/unsafe.ts',
        `
          import type { KovoSqlIdentifier, KovoTrustedSql } from './runtime.js';
          const column = value as KovoSqlIdentifier;
          const clause = value satisfies KovoTrustedSql;
        `,
      ),
    ).toEqual([
      'packages/drizzle/src/unsafe.ts: KV440 SQL blessed-brand laundering via direct type assertion; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
      'packages/drizzle/src/unsafe.ts: KV440 SQL blessed-brand laundering via satisfies assertion; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
    ]);
  });

  it('rejects TS-only angle-bracket SQL blessed-brand assertions outside the owning constructor module', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/drizzle/src/unsafe.ts',
        `
          import type { KovoStaticSql, KovoTrustedSql } from './runtime.js';
          const statement = <KovoTrustedSql>raw;
          return <KovoStaticSql & { readonly text: string }>raw;
        `,
      ),
    ).toEqual([
      'packages/drizzle/src/unsafe.ts: KV440 SQL blessed-brand laundering via angle-bracket type assertion; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
    ]);
  });

  it('rejects direct SQL blessed-brand field laundering outside the owning constructor module', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/server/src/unsafe-sql.ts',
        `
          const statement = { text: raw, __kovoSqlBrand: 'parameterized' };
          const identifier = { "__kovoSqlIdentifierBrand": 'identifier', text: column };
          const keyword = {};
          keyword.__kovoSqlKeywordBrand = 'keyword';
          statement['__kovoSqlBrand'] = 'trusted';
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand laundering via __kovoSqlBrand object field; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand laundering via __kovoSqlIdentifierBrand object field; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand laundering via SQL brand property assignment; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
    ]);
  });

  it('rejects SQL blessed-brand laundering through object spreads outside constructors', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/server/src/unsafe-sql.ts',
        `
          import type { TrustedSql } from '@kovojs/core/internal/sql-safety';
          const statement: TrustedSql = { ...requestBody };
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand laundering via object-spread contextual brand; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
    ]);

    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/server/src/unsafe-sql.ts',
        `
          import type { StaticSqlText } from '@kovojs/core/internal/sql-safety';
          function clause(): StaticSqlText & { readonly text: string } {
            return { ...runtimeConfig };
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand laundering via object-spread contextual brand; use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) so the runtime witness is minted by the owning constructor',
    ]);
  });

  it('allows ordinary object spreads and constructor-owned SQL brand spreads', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/server/src/safe-config.ts',
        `
          import type { TrustedSql } from '@kovojs/core/internal/sql-safety';
          type View = { readonly text: string };
          const view: View = { ...source };
          const statement = makeSql<TrustedSql>({ text: 'select 1' });
        `,
      ),
    ).toEqual([]);

    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/core/src/internal/sql-safety.ts',
        'const statement: TrustedSql = { ...value };',
        { allowedConstructorFile: true },
      ),
    ).toEqual([]);
  });

  it('does not treat generic type arguments or TSX tags as SQL blessed-brand assertions', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/drizzle/src/generic.ts',
        `
          import type { KovoTrustedSql } from './runtime.js';
          const statement = identity<KovoTrustedSql>(raw);
        `,
      ),
    ).toEqual([]);

    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/server/src/component.tsx',
        `
          import type { TrustedSql } from '@kovojs/core/internal/sql-safety';
          export function View() {
            return <TrustedSql>{label}</TrustedSql>;
          }
        `,
      ),
    ).toEqual([]);
  });

  it('does not treat SQL blessed-brand interface declarations as value laundering', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/drizzle/src/runtime.ts',
        `
          export interface KovoParameterizedSql {
            readonly __kovoSqlBrand?: 'parameterized';
          }
          export interface KovoSqlIdentifier {
            readonly __kovoSqlIdentifierBrand?: 'identifier';
          }
          export interface KovoSqlKeyword {
            readonly __kovoSqlKeywordBrand?: 'keyword';
          }
        `,
      ),
    ).toEqual([]);
  });

  it('allows SQL blessed-brand assertions only in the owning constructor module', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/core/src/internal/sql-safety.ts',
        'return value as T & ParameterizedSql;',
        { allowedConstructorFile: true },
      ),
    ).toEqual([]);
  });

  it('allows SQL stamp helpers only in owned constructor modules', () => {
    expect(
      sqlBlessedBrandStampFindings(
        'packages/core/src/internal/sql-safety.ts',
        'export function stampParameterizedSql(value) { return value; }',
        { allowedStampFile: true },
      ),
    ).toEqual([]);

    expect(
      sqlBlessedBrandStampFindings(
        'packages/drizzle/src/runtime.ts',
        `
          import { stampParameterizedSql, stampStaticSql } from '@kovojs/core/internal/sql-safety';
          export function sql(strings) {
            return stampParameterizedSql({ strings });
          }
          export function staticSql(value) {
            return stampStaticSql({ value });
          }
        `,
        { allowedStampFile: true },
      ),
    ).toEqual([]);
  });

  it('rejects SQL stamp helper import and call drift outside owned constructor modules', () => {
    expect(
      sqlBlessedBrandStampFindings(
        'packages/server/src/unsafe-sql.ts',
        `
          import { stampParameterizedSql as stampQuery, stampTrustedSql } from '@kovojs/core/internal/sql-safety';
          export function launder(value) {
            stampTrustedSql(value, 'runtime');
            return stampQuery(value);
          }
        `,
      ),
    ).toEqual([
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand constructor ownership drift via stampParameterizedSql import; keep SQL stamp helpers confined to core sql-safety.ts and the reviewed Drizzle runtime adapter',
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand constructor ownership drift via stampQuery(); use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) instead of minting stamps outside owned constructors',
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand constructor ownership drift via stampTrustedSql import; keep SQL stamp helpers confined to core sql-safety.ts and the reviewed Drizzle runtime adapter',
      'packages/server/src/unsafe-sql.ts: KV440 SQL blessed-brand constructor ownership drift via stampTrustedSql(); use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) instead of minting stamps outside owned constructors',
    ]);
  });

  it('rejects SQL stamp helper namespace calls and re-exports outside owned constructor modules', () => {
    expect(
      sqlBlessedBrandStampFindings(
        'packages/core/src/unsafe.ts',
        `
          import * as sqlSafety from './internal/sql-safety.js';
          export { stampStaticSql } from './internal/sql-safety.js';
          export * as unsafeSqlSafety from './internal/sql-safety.js';
          const statement = sqlSafety.stampStaticSql({});
        `,
      ),
    ).toEqual([
      'packages/core/src/unsafe.ts: KV440 SQL blessed-brand constructor ownership drift via sqlSafety.stampStaticSql(); use sql`...`, staticSql`...`, sql.identifier(..., { allow }), sql.allow(...), or trustedSql(...) instead of minting stamps outside owned constructors',
      'packages/core/src/unsafe.ts: KV440 SQL blessed-brand constructor ownership drift via stampStaticSql re-export; do not expose SQL stamp helpers outside owned constructors',
      'packages/core/src/unsafe.ts: KV440 SQL blessed-brand constructor ownership drift via sql-safety wildcard re-export; do not expose SQL stamp helpers outside owned constructors',
    ]);
  });

  it('runs the SQL stamp ownership gate over configured source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: [],
        deserializationFiles: [],
        exists: (file) => file === 'sink-policy.ts' || file === 'packages/server/src/unsafe.ts',
        logChannelFiles: [],
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'import { stampStaticSql } from "@kovojs/core/internal/sql-safety";',
        responseFragmentApplyPath: undefined,
        rootedFileServeSinkFiles: [],
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: ['packages/server/src/unsafe.ts'],
        sqlBlessedBrandStampFiles: [],
        sqlGuardDowngradeFiles: [],
        sqlSafetyInvariantFiles: [],
      }),
    ).toEqual([
      'packages/server/src/unsafe.ts: KV440 SQL blessed-brand constructor ownership drift via stampStaticSql import; keep SQL stamp helpers confined to core sql-safety.ts and the reviewed Drizzle runtime adapter',
    ]);
  });

  it('pins response-fragment raw HTML writes to the Trusted Types and sanitizer path', () => {
    const validResponseApply = `
      function trustedHtml(h: string): string {
        const t = (globalThis as any).trustedTypes;
        return t ? t.createPolicy('kovo', { createHTML: (s: string) => s }).createHTML(h) : h;
      }
      export function p(fs, f) {
        for (const x of fs) {
          const e = f(x.target);
          const t = document.createElement('template');
          t.innerHTML = trustedHtml(x.html);
          for (const n of t.content.children) g(n);
          e.append(...t.content.childNodes);
        }
      }
      function d(e, h) {
        const t = document.createElement('template');
        t.innerHTML = trustedHtml(h);
        const n = firstMorphElement(t.content);
        if (n) m(e, g(n));
      }
      function r(n: string): boolean {
        return /^on[^:]|^(srcdoc|dangerouslysetinnerhtml|innerhtml|outerhtml|inserthtml|insertadjacenthtml)$/.test(n);
      }
    `;

    expect(
      responseFragmentApplyInvariantFindings('response-fragment-apply.ts', validResponseApply),
    ).toEqual([]);

    const findings = responseFragmentApplyInvariantFindings(
      'response-fragment-apply.ts',
      validResponseApply
        .replace('t.innerHTML = trustedHtml(x.html);', 't.innerHTML = x.html;')
        .replace('for (const n of t.content.children) g(n);', '')
        .replace('if (n) m(e, g(n));', 'if (n) m(e, n);')
        .replace(
          'return /^on[^:]|^(srcdoc|dangerouslysetinnerhtml|innerhtml|outerhtml|inserthtml|insertadjacenthtml)$/.test(n);',
          'return /^on[^:]|^(srcdoc)$/.test(n);',
        )
        .concat('\ne.insertAdjacentHTML("beforeend", html);'),
    );

    expect(findings).toEqual([
      'response-fragment-apply.ts: response-fragment HTML sink must not use insertAdjacentHTML; parse through the template sanitizer path',
      'response-fragment-apply.ts: response-fragment HTML sink must route exactly two template.innerHTML writes through trustedHtml(); found 1',
      'response-fragment-apply.ts: append-mode response fragments must sanitize parsed children before DOM insertion',
      'response-fragment-apply.ts: replace-mode response fragments must sanitize the parsed morph root before DOM insertion',
      'response-fragment-apply.ts: response-fragment sanitizer denylist must keep event, srcdoc, and raw HTML attributes blocked',
    ]);
  });
});
