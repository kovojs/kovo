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

      export const safe = mutation({ handler() { return runCommand(command); } });
      export const unsafe = mutation({ handler() { return localRunCommand(); } });
    `);

    expect(facts).toEqual([
      expect.objectContaining({
        sink: 'child_process.execFileSync',
        source: "'/usr/bin/true'",
      }),
    ]);
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
    const safeBuiltins = new Set([
      'assert',
      'assert/strict',
      'buffer',
      'events',
      'querystring',
      'string_decoder',
      'url',
      'util',
      'util/types',
    ]);
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
      import { query } from '@kovojs/server';

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
      export const hook = webhook('/hook', { handler(_input, { request }) {
        return { headers: request.headers };
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
          return runCommand(command);
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
});
