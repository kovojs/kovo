import * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import { builtinModules as nodeBuiltinModules } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
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
          return respond.file('safe', { contentType: 'text/plain' });
        },
      });
    `);

    expect(facts).toEqual([]);
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
      import { endpoint, respond } from '@kovojs/server';
      export const direct = endpoint('/direct', { handler() {
        return respond.file('direct', { contentType: 'text/plain' });
      } });
      export const conditional = endpoint('/conditional', { handler() {
        return true
          ? respond.file('file', { contentType: 'text/plain' })
          : respond.stream('stream', { contentType: 'text/plain' });
      } });
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

  it('closes createApp renderRoute while treating error-shell request metadata as authority-neutral', () => {
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
      ]),
    );
    expect(facts.map((fact) => fact.sink)).not.toContain(
      'client-wire.request.header.Authorization',
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
            handler() { return { ok: true }; },
          });
        `,
      },
    ]);
    expect(safe).toEqual([]);

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

  it('does not bless composite or proxied guard construction', () => {
    // SPEC §6.6: only the finite, exact guard constructors reviewed by the classifier are
    // closed. Composition and Proxy preserve arbitrary callback/protocol execution surfaces.
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
          sink: 'request-handler.opaque-source',
          source: '<dynamic-callback>',
        }),
      ]),
    );

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
});
