import { describe, expect, it } from 'vitest';

import {
  blessedSinkKindsReferencedByFile,
  checkSinkPolicyGate,
  commandExecutionSinkFindings,
  commandPrimitiveInvariantFindings,
  dynamicCodeExecutionSinkFindings,
  exportedNames,
  extractRegisteredBlessedSinkKinds,
  logChannelNeutralizerInvariantFindings,
  logChannelSinkFindings,
  publicSinkPolicyEscapeFindings,
  responseFragmentApplyInvariantFindings,
  sqlBlessedBrandLaunderingFindings,
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
    logChannelFiles: [],
    exists: (file) => Object.hasOwn(files, file),
    publicEntrypointFiles: Object.hasOwn(files, 'public.ts') ? ['public.ts'] : [],
    readText: (file) => files[file],
    responseFragmentApplyPath: undefined,
    sinkPolicyPath: 'sink-policy.ts',
    sqlBlessedBrandFiles: [],
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

  it('runs the command execution gate over configured server source files', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: ['packages/server/src/unsafe.ts'],
        logChannelFiles: [],
        exists: (file) => file === 'packages/server/src/unsafe.ts' || file === 'sink-policy.ts',
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'import { execSync } from "node:child_process";',
        responseFragmentApplyPath: undefined,
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
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
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
      }),
    ).toEqual([
      'packages/server/src/unsafe.ts: forbidden dynamic code execution sink Function(); server source must not execute generated code',
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
        exists: (file) => file === 'sink-policy.ts' || file === 'packages/server/src/unsafe.ts',
        logChannelFiles: ['packages/server/src/unsafe.ts'],
        publicEntrypointFiles: [],
        readText: (file) =>
          file === 'sink-policy.ts'
            ? validPolicy
            : 'export function handle(request) { console.info(request.url); }',
        responseFragmentApplyPath: undefined,
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
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

  it('requires the browser response-fragment HTML sink kind to be centrally registered', () => {
    expect(
      checkSinkPolicyGate({
        blessedSinkFiles: [],
        commandExecutionFiles: [],
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
        sinkPolicyPath: 'sink-policy.ts',
        sqlBlessedBrandFiles: [],
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

  it('allows SQL blessed-brand assertions only in the owning constructor module', () => {
    expect(
      sqlBlessedBrandLaunderingFindings(
        'packages/core/src/internal/sql-safety.ts',
        'return value as T & ParameterizedSql;',
        { allowedConstructorFile: true },
      ),
    ).toEqual([]);
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
