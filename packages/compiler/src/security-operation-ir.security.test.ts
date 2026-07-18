// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function compile(source: string) {
  return compileComponentModule({
    fileName: 'src/finite-security-ir.tsx',
    source,
  });
}

function kv449(source: string) {
  return compile(source).diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
}

function kv449Project(
  source: string,
  extraFiles: readonly { readonly fileName: string; readonly source: string }[],
) {
  return compileComponentModule({
    extraFiles,
    fileName: 'src/finite-security-ir.tsx',
    source,
  }).diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
}

describe('SPEC §4.3/§5.2 finite compiler-owned security IR', () => {
  it('carries exact compiler-derived operations in emitted browser and server artifacts', () => {
    const result = compile(`
import { component } from '@kovojs/core';
import { endpoint } from '@kovojs/server';
export const Demo = component({
  state: () => ({ count: 0 }),
  render: () => <button onClick={() => { event.preventDefault(); state.count += 1; }}>Run</button>,
});
export const api = endpoint('/api', {
  async handler(_input, ctx) {
    await ctx.fetch('https://api.example.test/report');
    ctx.headers.set('Cache-Control', 'no-store');
    return Response.json({ ok: true });
  },
});
`);
    const browserSource = result.files.find((file) => file.kind === 'client')?.source ?? '';
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(browserSource).toContain(
      'securityHandler([{"door":"delegated-event","kind":"browser.event.control","target":"event.preventDefault"},{"door":"compiler-state","kind":"browser.state.write","target":"state.count"}],',
    );
    expect(serverSource).toContain('__kovoSecurityOperationManifest_v1');
    expect(serverSource).toContain('kovo-security-operation-ir/v1');
    expect(serverSource).toContain(
      '{"door":"ctx.fetch","kind":"server.egress.request","target":"ctx.fetch"}',
    );
    expect(serverSource).toContain(
      '{"door":"structured-headers","kind":"server.response.header","target":"ctx.headers.set"}',
    );
    expect(serverSource).toContain(
      '{"door":"Response","kind":"server.response.raw","target":"Response.json","justification":"endpoint access/CSRF posture"}',
    );
    expect(serverSource).not.toContain('"span"');
    expect(result.componentGraphFacts[0]?.securityOperations).toEqual(
      expect.arrayContaining([
        {
          door: 'Response',
          justification: 'endpoint access/CSRF posture',
          kind: 'server.response.raw',
          target: 'Response.json',
        },
        {
          door: 'compiler-state',
          kind: 'browser.state.write',
          target: 'state.count',
        },
      ]),
    );
  });

  it('accepts realistic state, delegated-event, reviewed primitive, focus, form, and timer effects', () => {
    const result = compile(`
import { tabsTriggerClick } from '@kovojs/headless-ui/tabs';
export const Demo = component({
  state: () => ({ open: false, value: '' }),
  render: () => <form onSubmit={() => {
    const nextState = tabsTriggerClick(Object(event), { disabled: false, value: state.value });
    state.open = nextState?.selected === true;
    const root = Object(event)['target']?.closest?.('[data-demo]');
    const next = Object(root)?.querySelector?.('[data-next]');
    Object(next)['focus']?.call(next);
    Object(event)['target']?.requestSubmit?.();
    const timer = setTimeout(() => { state.value = 'ready'; }, 0);
    clearTimeout(timer);
  }}><button data-next>Save</button></form>,
});
`);

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
  });

  it.each([
    ['raw DOM property assignment', "event.target.innerHTML = '<img src=x onerror=alert(1)>'"],
    ['never-listed DOM method', "event.target.replaceChildren('owned')"],
    ['computed DOM method', 'event.target[action]()'],
    ['raw browser-global method', "document.body.insertAdjacentHTML('beforeend', html)"],
    ['raw storage capability', "localStorage.setItem('token', token)"],
  ])('rejects %s because it is outside the operation set', (_label, operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'Security-critical operation is outside the compiler-owned finite IR.',
    );
  });

  it.each([
    ['raw document alias', "const doc = document; doc.body.insertAdjacentHTML('beforeend', html)"],
    ['raw storage alias', "const storage = localStorage; storage.setItem('token', token)"],
    [
      'extracted DOM method alias',
      "const target = event.target; const replace = target.replaceChildren; replace('owned')",
    ],
    [
      'destructured DOM method alias',
      "const { replaceChildren } = event.target; replaceChildren('owned')",
    ],
    [
      'mutable DOM receiver transfer',
      "let target = {}; target = event.target; target.replaceChildren('owned')",
    ],
    [
      'container-carried DOM receiver',
      "const box = { target: event.target }; box.target.replaceChildren('owned')",
    ],
    [
      'constructor-carried DOM receiver',
      "const box = new Map([['target', event.target]]); box.get('target').replaceChildren('owned')",
    ],
    [
      'generic reflective DOM mutation',
      "Object.assign(event.target, { innerHTML: '<img src=x onerror=alert(1)>' })",
    ],
    [
      'unreviewed global namespace mutation',
      "Reflect.set(event.target, 'innerHTML', '<img src=x onerror=alert(1)>')",
    ],
    ['local helper authority transfer', 'function consume(_value) {} consume(event.target)'],
    [
      'local member-helper authority transfer',
      'const helper = { consume(_value) {} }; helper.consume(event.target)',
    ],
  ])('closes %s across browser authority aliases and containers', (_label, operation) => {
    expect(
      kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`),
    ).not.toEqual([]);
  });

  it('tracks finite timer operations while preserving scalar event reads', () => {
    const result = compile(`
export const Demo = component({
    state: () => ({ value: '' }),
    render: () => <input onInput={() => {
      const value = event.target?.value ?? '';
      setTimeout(() => { state.value = String(value); }, 0);
  }} />,
});
`);
    const browserSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(browserSource).toContain('"kind":"browser.timer.schedule"');
  });

  it.each([
    ['direct string timer', "setTimeout('owned()', 0)"],
    ['timer alias', 'const later = setInterval; later(`owned()`, 0)'],
    ['global timer member', 'globalThis.setTimeout(`owned-${input}`, 0)'],
  ])('closes %s through the finite browser timer operation', (_label, operation) => {
    const diagnostics = kv449(`
export const Demo = component({
  render: () => <button onClick={() => { ${operation}; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('semantic root=serialized-browser-handler:onClick@');
    expect(diagnostics[0]?.message).toContain('transfers=<direct>');
    expect(diagnostics[0]?.message).toContain('string timer callbacks execute source text');
    expect(diagnostics[0]?.message).toContain('verdict=closed:unsupported-authority-use');
  });

  it('closes a captured unknown receiver mutation instead of silently treating it as scalar code', () => {
    const diagnostics = kv449(`
const element = document.createElement('div');
export const Demo = component({
  render: () => <button onClick={() => { element.innerHTML = '<script>owned</script>'; }}>Run</button>,
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('browser assignment element.innerHTML');
    expect(diagnostics[0]?.message).toContain('verdict=closed:unknown-operation');
  });

  it('accepts exact structured server operations and named justified exceptional doors', () => {
    const diagnostics = kv449(`
import { trustedHtml } from '@kovojs/browser';
import { sql, trustedSql } from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';

export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await ctx.fetch('https://api.example.test/report');
    await ctx.db.execute(trustedSql(sql\`select 1\`, { justification: 'reviewed report query' }));
    ctx.headers.set('Cache-Control', 'no-store');
    ctx.setCookie('seen', '1');
    return Response.json({ html: trustedHtml('<strong>ok</strong>', { reason: 'static markup' }) });
  },
});
`);

    expect(diagnostics).toEqual([]);
  });

  it('treats an exact raw endpoint Response as a reviewed outcome, not escaped authority', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler() {
    const response = new Response('ok', {
      headers: { 'Cache-Control': 'no-store' },
    });
    return response;
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain(
      '{"door":"Response","kind":"server.response.raw","target":"new Response","justification":"endpoint access/CSRF posture"}',
    );
  });

  it('classifies exact module and global Response aliases as reviewed endpoint outcomes', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
const RawResponse = Response;
export const report = endpoint('/report', {
  handler(input) {
    return input.global
      ? globalThis.Response.json({ ok: true })
      : new RawResponse('ok');
  },
});
`);
    const rawOperations =
      result.componentGraphFacts[0]?.securityOperations?.filter(
        (operation) => operation.kind === 'server.response.raw',
      ) ?? [];

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(rawOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'globalThis.Response.json' }),
        expect.objectContaining({ target: 'new Response' }),
      ]),
    );
  });

  it.each([
    ['module Response alias', 'const RawResponse = Response;', "return new RawResponse('raw')"],
    [
      'zero-authority helper outcome',
      "function raw() { return new Response('raw'); }",
      'return raw()',
    ],
    [
      'module Response container',
      'const responses = { RawResponse: Response };',
      "return new responses.RawResponse('raw')",
    ],
    [
      'constructor-return helper',
      'function responseConstructor() { return Response; }',
      "return new (responseConstructor())('raw')",
    ],
    [
      'module constructor-return alias',
      'function identity(value) { return value; } const RawResponse = identity(Response);',
      "return new RawResponse('raw')",
    ],
    ['global Response member', '', "return new globalThis.Response('raw')"],
  ])('closes raw mutation Response through %s', (_label, prelude, outcome) => {
    const diagnostics = kv449(`
import { mutation } from '@kovojs/server';
${prelude}
export const update = mutation({
  handler() { ${outcome}; },
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('semantic root='))).toBe(
      true,
    );
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('verdict=closed:'))).toBe(
      true,
    );
  });

  it('keeps scalar request URL projections plain through a local URL parser and helper summary', () => {
    const diagnostics = kv449(`
import { query } from '@kovojs/server';
function page(url) {
  return { target: url.searchParams.get('target') ?? '/' };
}
export const report = query({
  reads: [],
  load(_input, context) {
    return page(new URL(context?.request.url ?? 'http://app.test/'));
  },
});
`);

    expect(diagnostics).toEqual([]);
  });

  it.each([
    ['raw Response from a mutation', "return new Response('raw')"],
    [
      'raw Response hidden in a structured endpoint outcome',
      "return { response: new Response('raw') }",
    ],
    ['raw Response thrown by an endpoint', "throw new Response('raw')"],
    ['server authority passed through a local constructor', 'return new Box(ctx.db)'],
  ])('keeps %s outside the reviewed response-outcome subset', (_label, handlerBody) => {
    const surface = _label.includes('mutation') ? 'mutation' : 'endpoint';
    expect(
      kv449(`
import { endpoint, mutation } from '@kovojs/server';
class Box { constructor(value) { this.value = value; } }
export const report = ${surface}(${surface === 'endpoint' ? "'/report', " : ''}{
  handler(_input, ctx) { ${handlerBody}; },
});
`),
    ).not.toEqual([]);
  });

  it('preserves exact framework identity through namespace exceptional-door imports', () => {
    const result = compile(`
import * as browser from '@kovojs/browser';
import * as drizzle from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await ctx.db.execute(drizzle.trustedSql(drizzle.sql\`select 1\`, {
      justification: 'reviewed namespace query',
    }));
    return Response.json({
      html: browser.trustedHtml('<strong>ok</strong>', { reason: 'static namespace markup' }),
    });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.database.trusted-sql"');
    expect(serverSource).toContain('"kind":"server.output.trusted-html"');
  });

  it('closes structured server authority across receiver, scope, and destructured-call aliases', () => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, request) {
    const contextAlias = request;
    const database = contextAlias.db;
    const scoped = contextAlias.actAs('owner-1');
    const { fetch: requestOut, headers: responseHeaders } = contextAlias;
    await requestOut('https://api.example.test/report');
    await database.execute('parameterized');
    await scoped.runQuery({ key: 'report/read' }, undefined);
    responseHeaders.set('Cache-Control', 'no-store');
    const RawResponse = Response;
    return RawResponse.json({ ok: true });
  },
});
`);

    expect(diagnostics).toEqual([]);

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, { fetch: requestOut, db: database, headers }) {
    await requestOut('https://api.example.test/report');
    await database.select();
    headers.append('Vary', 'Accept');
    return Response.json({ ok: true });
  },
});
`),
    ).toEqual([]);
  });

  it.each([
    ['mutable receiver alias', 'let database = ctx.db; await database.execute(query)'],
    [
      'conditional receiver alias',
      'const database = input.useManaged ? ctx.db : input.other; await database.execute(query)',
    ],
    ['computed method alias', 'const execute = ctx.db[input.operation]; await execute(query)'],
    [
      'computed method on a known alias',
      'const database = ctx.db; await database[input.operation]()',
    ],
    [
      'reassigned context alias',
      'let request = ctx; request = input.other; await request.fetch(input.url)',
    ],
  ])('fails closed for %s', (_label, handlerBody) => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(input, ctx) { ${handlerBody}; return Response.json({ ok: true }); },
});
`),
    ).not.toEqual([]);
  });

  it.each([
    [
      'authority assigned into a local alias',
      'let database; database = ctx.db; await database.execute(query)',
    ],
    [
      'authority carried through an object container',
      'const box = { database: ctx.db }; await box.database.execute(query)',
    ],
    ['authority passed to an imported helper', 'await importedHelper({ database: ctx.db })'],
    ['authority returned from a structured handler', 'return { database: ctx.db }'],
  ])('fails closed when %s', (_label, handlerBody) => {
    expect(
      kv449(`
import { importedHelper } from './helper.js';
import { endpoint } from '@kovojs/server';
function consume(_value) { return null; }
export const report = endpoint('/report', {
  async handler(_input, ctx) { ${handlerBody}; return Response.json({ ok: true }); },
});
`),
    ).not.toEqual([]);
  });

  it('enrolls exact same-file authority helpers as reviewed local call edges', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function consume(_value) { return null; }
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    consume(ctx.db);
    return Response.json({ ok: true });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain(
      '{"door":"local-call-edge","kind":"server.helper.call","root":"endpoint:/report","target":"local:consume"}',
    );
    expect(result.componentGraphFacts[0]?.securityOperations).toContainEqual({
      door: 'local-call-edge',
      kind: 'server.helper.call',
      root: 'endpoint:/report',
      target: 'local:consume',
    });
  });

  it('keeps authority-returning assertion helpers outside the normalized helper subset', () => {
    const diagnostics = kv449(`
import { query } from '@kovojs/server';
function requireDb(context) {
  if (!context.db) throw new Error('missing managed db');
  return context.db;
}
export const catalog = query('catalog/read', {
  load(_input, context) {
    const db = requireDb(context);
    return db.select();
  },
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(
      diagnostics.some((diagnostic) =>
        diagnostic.message.includes('server capability cannot escape a structured handler outcome'),
      ),
    ).toBe(true);
  });

  it('discharges multi-hop helper edges through bottom-up normalized summaries', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
async function dial(outbound) {
  return outbound('https://api.example.test/report');
}
async function consume(context) {
  const { fetch: outbound } = context;
  return dial(outbound);
}
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await consume(ctx);
    return Response.json({ ok: true });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const semanticGraph = result.componentGraphFacts[0]?.securitySemanticGraph;

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('kovo-security-semantic-graph/v2');
    expect(serverSource).toContain('local:consume[arg0=context]');
    expect(serverSource).toContain('local:dial[arg0=operation:server.egress.request]');
    expect(semanticGraph?.roots).toContainEqual(
      expect.objectContaining({
        binding: expect.objectContaining({
          callback: 'handler',
          callableSpan: expect.objectContaining({
            end: expect.any(Number),
            start: expect.any(Number),
          }),
          factory: 'endpoint',
          factoryCallSpan: expect.objectContaining({
            end: expect.any(Number),
            start: expect.any(Number),
          }),
          root: 'endpoint:/report',
        }),
        helperInvocations: expect.arrayContaining([
          expect.objectContaining({
            authorityInputs: ['arg0=context'],
            callable: 'local:consume',
            callSpan: expect.objectContaining({
              end: expect.any(Number),
              start: expect.any(Number),
            }),
            operationKinds: ['server.egress.request'],
            transfers: ['local:consume[arg0=context]'],
            verdict: 'proved',
          }),
          expect.objectContaining({
            authorityInputs: ['arg0=operation:server.egress.request'],
            callable: 'local:dial',
            operationKinds: ['server.egress.request'],
            transfers: [
              'local:consume[arg0=context]',
              'local:dial[arg0=operation:server.egress.request]',
            ],
            verdict: 'proved',
          }),
        ]),
        root: 'endpoint:/report',
        summaries: expect.arrayContaining([
          expect.objectContaining({
            authorityInputs: ['arg0=operation:server.egress.request'],
            callable: 'local:dial',
            operationKinds: ['server.egress.request'],
            verdict: 'proved',
          }),
          expect.objectContaining({
            authorityInputs: ['arg0=context'],
            callable: 'local:consume',
            operationKinds: ['server.egress.request'],
            verdict: 'proved',
          }),
        ]),
        traces: expect.arrayContaining([
          {
            root: 'endpoint:/report',
            sink: {
              door: 'ctx.fetch',
              kind: 'server.egress.request',
              target: 'outbound',
            },
            transfers: [
              'local:consume[arg0=context]',
              'local:dial[arg0=operation:server.egress.request]',
            ],
            verdict: 'proved',
          },
        ]),
      }),
    );
  });

  it('keeps helper summaries context-sensitive to exact authority inputs', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function inspect(_capability) { return 'ok'; }
export const report = endpoint('/report', {
  handler(_input, ctx) {
    inspect(ctx.db);
    inspect(ctx.storage);
    return Response.json({ ok: true });
  },
});
`);
    const summaries =
      result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.summaries ?? [];

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorityInputs: ['arg0=database'],
          callable: 'local:inspect',
          operationKinds: [],
          verdict: 'proved',
        }),
        expect.objectContaining({
          authorityInputs: ['arg0=storage'],
          callable: 'local:inspect',
          operationKinds: [],
          verdict: 'proved',
        }),
      ]),
    );
  });

  it('shows root, transfers, sink, and closed reason for helper alias mutation', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function consume(database, input) {
  let mutable = database;
  mutable = input.other;
  return mutable.select();
}
export const report = endpoint('/report', {
  handler(input, ctx) {
    consume(ctx.db, input);
    return Response.json({ ok: true });
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');
    const closed =
      result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.traces.filter(
        (trace) => trace.verdict === 'closed',
      ) ?? [];

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain('semantic root=endpoint:/report');
    expect(diagnostics[0]?.message).toContain('local:consume[arg0=database]');
    expect(diagnostics[0]?.message).toContain('sink=');
    expect(diagnostics[0]?.message).toContain('verdict=closed:');
    expect(closed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'unsupported-authority-use',
          root: 'endpoint:/report',
          transfers: ['local:consume[arg0=database]'],
          verdict: 'closed',
        }),
      ]),
    );
  });

  it('fails closed on recursive helper cycles with an explicit normalized verdict', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
function first(database) { return second(database); }
function second(database) { return first(database); }
export const report = endpoint('/report', {
  handler(_input, ctx) {
    first(ctx.db);
    return Response.json({ ok: true });
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('helper-cycle'))).toBe(
      true,
    );
    expect(result.componentGraphFacts[0]?.securitySemanticGraph?.roots[0]?.traces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'helper-cycle', verdict: 'closed' }),
      ]),
    );
  });

  it('propagates query no-write posture through summarized helpers', () => {
    const result = compile(`
import { query } from '@kovojs/server';
function write(database) { return database.insert('catalog'); }
export const catalog = query('catalog/read', {
  load(_input, ctx) { return write(ctx.db); },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'query loaders cannot perform a managed database write',
    );
    expect(diagnostics[0]?.message).toContain('semantic root=query:catalog/read');
  });

  it('closes arguments-object recovery and deterministic call-depth exhaustion', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function consume(_database) { return arguments[0].select(); }
export const report = endpoint('/report', {
  handler(_input, ctx) { consume(ctx.db); return Response.json({ ok: true }); },
});
`)[0]?.message,
    ).toContain('arguments-object authority recovery');

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function consumePlain(_plain) { return 'ok'; }
export const report = endpoint('/report', {
  handler(_input, ctx) { consumePlain('plain', ctx.db); return Response.json({ ok: true }); },
});
`)[0]?.message,
    ).toContain('authority-bearing extra argument');

    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function consumeRest(_plain, ..._rest) { return 'ok'; }
export const report = endpoint('/report', {
  handler(_input, ctx) { consumeRest('plain', 'also plain', ctx.db); return Response.json({ ok: true }); },
});
`)[0]?.message,
    ).toContain('authority-bearing rest argument');

    const helperCount = 18;
    const helpers = Array.from({ length: helperCount }, (_unused, index) =>
      index === helperCount - 1
        ? `function helper${index}(database) { return database.select(); }`
        : `function helper${index}(database) { return helper${index + 1}(database); }`,
    ).join('\n');
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
${helpers}
export const report = endpoint('/report', {
  handler(_input, ctx) { return helper0(ctx.db); },
});
`);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('budget-call-depth'))).toBe(
      true,
    );
  });

  it('closes the normalized semantic node budget with its exact reason', () => {
    const oversizedBody = Array.from({ length: 50_100 }, () => ';').join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler() { ${oversizedBody} return Response.json({ ok: true }); },
});
`).some((diagnostic) => diagnostic.message.includes('budget-node-count')),
    ).toBe(true);
  }, 60_000);

  it('closes the normalized semantic operation budget with its exact reason', () => {
    const operations = Array.from({ length: 4_097 }, () => 'ctx.db.select();').join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) { ${operations} return Response.json({ ok: true }); },
});
`).some((diagnostic) => diagnostic.message.includes('budget-operation-count')),
    ).toBe(true);
  }, 60_000);

  it('closes the normalized semantic summary budget with its exact reason', () => {
    const helperCount = 257;
    const helpers = Array.from(
      { length: helperCount },
      (_unused, index) => `function helper${index}(database) { return database.select(); }`,
    ).join('\n');
    const calls = Array.from(
      { length: helperCount },
      (_unused, index) => `helper${index}(ctx.db);`,
    ).join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
${helpers}
export const report = endpoint('/report', {
  handler(_input, ctx) { ${calls} return Response.json({ ok: true }); },
});
`).some((diagnostic) => diagnostic.message.includes('budget-summary-count')),
    ).toBe(true);
  }, 60_000);

  it('reuses normalized semantic summaries without exhausting the summary budget', () => {
    const repeatedCalls = Array.from({ length: 300 }, () => 'read(ctx.db);').join('\n');
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function read(database) { return database.select(); }
export const report = endpoint('/report', {
  handler(_input, ctx) { ${repeatedCalls} return Response.json({ ok: true }); },
});
`),
    ).toEqual([]);
  }, 60_000);

  it.each([
    [
      'operation-function member laundering',
      `const outbound = ctx.fetch.bind(null); await outbound('https://api.example.test')`,
    ],
    [
      'capability member mutation',
      `ctx.fetch.custom = () => null; await ctx.fetch('https://api.example.test')`,
    ],
    ['ignored authority container', `const hidden = { database: ctx.db }; void hidden`],
    [
      'nested callable authority capture',
      `const delayed = () => ctx.db.select(); return Response.json({ delayed: Boolean(delayed) })`,
    ],
  ])('fails closed for %s in normalized server semantics', (_label, handlerBody) => {
    const diagnostics = kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) { ${handlerBody}; return Response.json({ ok: true }); },
});
`);

    expect(diagnostics).not.toEqual([]);
  });

  it('allows nested plain-data transforms after a reviewed operation result', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    const rows = await ctx.db.select();
    const sizes = rows.map((row) => String(row).length);
    return Response.json({ sizes });
  },
});
`),
    ).toEqual([]);
  });

  it('enrolls inline and same-file referenced server roots in emitted manifests', () => {
    const result = compile(`
import { endpoint, mutation, query, task, webhook } from '@kovojs/server';

async function loadCatalog(_input, ctx) {
  return ctx.db.select();
}
const saveCatalog = async (_input, request) => {
  await request.db.insert('catalog');
  return { ok: true };
};
function handleStatus() {
  return Response.json({ ok: true });
}
function handleWebhook() {
  return { ok: true };
}
const runCleanup = async () => ({ ok: true });

export const catalog = query('catalog/read', { load: loadCatalog });
export const status = query('status/read', { load() { return { ok: true }; } });
export const save = mutation('catalog/save', { handler: saveCatalog });
export const statusApi = endpoint('/status', { handler: handleStatus });
export const inbound = webhook('/events', { handler: handleWebhook });
export const cleanup = task('catalog/cleanup', { run: runCleanup });
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    for (const target of [
      'query:catalog/read',
      'query:status/read',
      'mutation:catalog/save',
      'endpoint:/status',
      'webhook:/events',
      'task:catalog/cleanup',
    ]) {
      expect(serverSource).toContain(
        `{"door":"handler-root","kind":"server.handler.root","target":"${target}"}`,
      );
    }
    expect(serverSource).toContain('"kind":"server.database.read"');
    expect(serverSource).toContain('"kind":"server.database.write"');
  });

  it.each([
    [
      'imported query load',
      `import { load } from './foreign.js'; export const root = query({ load });`,
    ],
    [
      'reassigned query load',
      `let load = (_input, _ctx) => null; load = (_input, _ctx) => 1; export const root = query({ load });`,
    ],
    [
      'dynamic query definition',
      `const definition = { load(_input, _ctx) { return null; } }; export const root = query(definition);`,
    ],
    [
      'spread mutation definition',
      `const base = {}; function handler() { return null; } export const root = mutation({ ...base, handler });`,
    ],
    ['missing mutation handler', `export const root = mutation({});`],
  ])('fails closed instead of silently dropping an %s root', (_label, declaration) => {
    expect(
      kv449(`
import { mutation, query } from '@kovojs/server';
${declaration}
`),
    ).not.toEqual([]);
  });

  it('rejects managed database writes from an enrolled query root', () => {
    const result = compile(`
import { query } from '@kovojs/server';
export const root = query('catalog/read', {
  async load(_input, ctx) {
    await ctx.db.insert('catalog');
    await ctx.db.write('catalog', { refreshed: true });
    return null;
  },
});
`);
    const diagnostics = result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449');

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'query loaders cannot perform a managed database write',
    );
    expect(result.componentGraphFacts[0]?.securityOperations).toEqual(
      expect.arrayContaining([
        {
          door: 'managed-db',
          kind: 'server.database.write',
          target: 'ctx.db.insert',
        },
        {
          door: 'managed-db',
          kind: 'server.database.write',
          target: 'ctx.db.write',
        },
      ]),
    );
  });

  it('keeps reviewed operation results as plain helper data rather than capabilities', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
function summarize(rows) { return { count: rows.length }; }
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    const rows = await ctx.db.select();
    return Response.json(summarize(rows));
  },
});
`),
    ).toEqual([]);
  });

  it('does not confuse input and local lookalikes with the second-parameter context capability', () => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(ctx, request) {
    const context = { db: { dropEverything() {} } };
    ctx.db.dropEverything();
    context.db.dropEverything();
    await request.db.select();
    return Response.json({ ok: true });
  },
});
`),
    ).toEqual([]);
  });

  it('uses the third mutation parameter as context and keeps the request parameter distinct', () => {
    const result = compile(`
import { mutation } from '@kovojs/server';
export const save = mutation('save', {
  handler(_input, request, context) {
    const requestValue = request.headers.get('x-request-value');
    context.setCookie('seen', '1');
    return requestValue;
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.response.cookie"');
    expect(serverSource).not.toContain('"kind":"server.response.header"');
  });

  it('classifies managed mutation-request and explicit principal-scope database operations', () => {
    const result = compile(`
import { endpoint, mutation } from '@kovojs/server';
export const save = mutation('save', {
  handler(_input, request, context) {
    const found = request.db.products.get('p1');
    request.db.read('products', 'p1');
    request.db.write('products', { ...found, stock: 1 });
    context.invalidate(products);
    return found;
  },
});
export const report = endpoint('/report', {
  db: true,
  async handler(_request, context) {
    const scope = await context.actAs('owner-1');
    const rows = await scope.db.read.select().from(products);
    await scope.db.write.insert(products).values({ ownerId: 'owner-1' });
    return Response.json({ rows });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.authority.scope"');
    expect(serverSource).toContain('"kind":"server.database.read"');
    expect(serverSource).toContain('"kind":"server.database.write"');
    expect(serverSource).toContain('"kind":"server.task.compose"');
  });

  it('accepts the starter database chains and exact plain-data identities without widening the finite IR', () => {
    expect(
      kv449Project(
        `
import { mutation, query, trustedAssign } from '@kovojs/server';
import { eq } from 'drizzle-orm';
import { contacts } from './schema.js';

async function writeContact(db, row) {
  const id = crypto.randomUUID();
  await db.insert(contacts).values({
    id: trustedAssign(id, 'framework-generated opaque identifier'),
    email: row.email,
  });
}

export const save = mutation('contacts/save', {
  async handler(input, request) {
    const [existing] = await request.db
      .select()
      .from(contacts)
      .where(eq(contacts.email, input.email))
      .limit(1);
    if (!existing) await writeContact(request.db, input);
    return { id: existing?.id ?? null };
  },
});

export const list = query('contacts/list', {
  async load(_input, context) {
    const db = context?.db;
    if (!db) throw new Error('missing managed database');
    return {
      items: await db.select({ id: contacts.id }).from(contacts).orderBy(contacts.id),
    };
  },
});
`,
        [
          {
            fileName: 'src/schema.ts',
            source: `
import { pgTable, text } from 'drizzle-orm/pg-core';
export const contacts = pgTable('contacts', {
  email: text('email').notNull(),
  id: text('id').primaryKey(),
});
`,
          },
        ],
      ),
    ).toEqual([]);
  });

  it.each([
    [
      'a same-named imported trustedAssign',
      `import { trustedAssign } from './lookalike.js';`,
      `return trustedAssign(input.id, 'not a framework identity');`,
    ],
    [
      'a same-named local trustedAssign that returns a privileged outcome',
      ``,
      `function trustedAssign() { return new Response('raw'); }
       return trustedAssign();`,
    ],
    [
      'a getter-carried trustedAssign lookalike',
      ``,
      `const helpers = { get trustedAssign() { return () => new Response('raw'); } };
       return helpers.trustedAssign(input.id, 'getter');`,
    ],
    [
      'a replaced exact trustedAssign binding',
      `import { trustedAssign } from '@kovojs/server';`,
      `trustedAssign = () => new Response('raw');
       return trustedAssign(input.id, 'replaced');`,
    ],
    [
      'a mutable trustedAssign container',
      `import { trustedAssign } from '@kovojs/server';`,
      `const helpers = { trustedAssign };
       helpers.trustedAssign = () => new Response('raw');
       return helpers.trustedAssign(input.id, 'container');`,
    ],
    [
      'an exact trustedAssign call carrying managed authority',
      `import { trustedAssign } from '@kovojs/server';`,
      `return trustedAssign(request.db, 'authority laundering');`,
    ],
  ])(
    'does not grant reviewed data-helper identity through %s',
    (_label, moduleDeclarations, handlerBody) => {
      expect(
        kv449(`
import { mutation } from '@kovojs/server';
${moduleDeclarations}
export const save = mutation('contacts/save', {
  handler(input, request) {
    ${handlerBody}
  },
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    [
      'a same-named imported crypto object',
      `import { crypto } from './lookalike.js';`,
      `return crypto.randomUUID();`,
    ],
    [
      'a same-named local crypto object',
      ``,
      `const crypto = { randomUUID() { return new Response('raw'); } };
       return crypto.randomUUID();`,
    ],
    [
      'a getter-carried randomUUID lookalike',
      ``,
      `const entropy = { get randomUUID() { return () => new Response('raw'); } };
       return entropy.randomUUID();`,
    ],
    [
      'an ambient crypto container alias',
      ``,
      `const entropy = crypto;
       return entropy.randomUUID();`,
    ],
    [
      'a replaced ambient crypto member',
      ``,
      `crypto.randomUUID = () => 'fixed';
       return crypto.randomUUID();`,
    ],
  ])('keeps randomUUID closed through %s', (_label, moduleDeclarations, handlerBody) => {
    expect(
      kv449(`
import { mutation } from '@kovojs/server';
${moduleDeclarations}
export const save = mutation('contacts/save', {
  handler() {
    ${handlerBody}
  },
});
`),
    ).not.toEqual([]);
  });

  it.each([
    [
      'an imported Error lookalike',
      `import { Error } from './lookalike.js';`,
      `throw new Error('raw');`,
    ],
    [
      'a local Error lookalike',
      ``,
      `class Error { constructor() { return new Response('raw'); } } throw new Error();`,
    ],
    ['an Error constructor alias', ``, `const Failure = Error; throw new Failure('aliased');`],
    ['a replaced ambient Error binding', ``, `Error = class {}; throw new Error('replaced');`],
  ])(
    'keeps the ambient Error constructor closed through %s',
    (_label, moduleDeclarations, handlerBody) => {
      expect(
        kv449(`
import { query } from '@kovojs/server';
${moduleDeclarations}
export const list = query('contacts/list', {
  load() { ${handlerBody} },
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    [
      'an imported same-named builder method',
      `import { builder } from './lookalike.js';`,
      `return builder.from(contacts);`,
    ],
    [
      'a same-named local builder method that returns a privileged outcome',
      ``,
      `const builder = { from() { return new Response('raw'); } };
       return builder.from(contacts);`,
    ],
    [
      'a getter-carried builder method',
      ``,
      `const builder = { get from() { return () => new Response('raw'); } };
       return builder.from(contacts);`,
    ],
    [
      'a mutable managed-builder container',
      `import { foreignFrom } from './lookalike.js';`,
      `const builder = request.db.select();
       builder.from = foreignFrom;
       return builder.from(contacts);`,
    ],
    [
      'an unreviewed managed-builder continuation',
      ``,
      `return request.db.select().dropEverything();`,
    ],
    [
      'a reviewed managed-builder continuation carrying authority',
      ``,
      `return request.db.select().where(request.db);`,
    ],
  ])(
    'does not recognize finite database continuations through %s',
    (_label, moduleDeclarations, handlerBody) => {
      expect(
        kv449(`
import { mutation } from '@kovojs/server';
import { contacts } from './schema.js';
${moduleDeclarations}
export const save = mutation('contacts/save', {
  handler(_input, request) {
    ${handlerBody}
  },
});
`),
      ).not.toEqual([]);
    },
  );

  it.each([
    [
      'a getter-backed export passed to from',
      `export const contacts = { get id() { return new Response('getter'); } };`,
      `return request.db.select().from(contacts);`,
    ],
    [
      'a Proxy export passed to where',
      `export const contacts = new Proxy({}, { get() { return new Response('proxy'); } });`,
      `return request.db.select().where(contacts);`,
    ],
    [
      'a callable export passed to orderBy',
      `export function contacts() { return new Response('callable'); }`,
      `return request.db.select().orderBy(contacts);`,
    ],
    [
      'a reassigned table export passed to limit',
      `import { pgTable } from 'drizzle-orm/pg-core';
       export const contacts = pgTable('contacts', {});
       contacts = new Proxy({}, {});`,
      `return request.db.select().limit(contacts);`,
    ],
  ])('rejects imported executable database data through %s', (_label, schemaSource, call) => {
    expect(
      kv449Project(
        `
import { mutation } from '@kovojs/server';
import { contacts } from './schema.js';
export const save = mutation('contacts/save', {
  handler(_input, request) { ${call} },
});
`,
        [{ fileName: 'src/schema.ts', source: schemaSource }],
      ),
    ).not.toEqual([]);
  });

  it('classifies exact static managed relational reads through direct and scoped read handles', () => {
    const result = compile(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  db: true,
  async handler(_request, context) {
    const direct = await context.db.query.accounts.findFirst({
      columns: { id: true },
    });
    const scope = await context.actAs('owner-1');
    const reader = scope.db.read;
    const rows = await reader.query.orders.findMany({
      columns: { id: true },
    });
    return Response.json({ direct, rows });
  },
});
`);
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV449')).toEqual([]);
    expect(serverSource).toContain('"kind":"server.database.read"');
    expect(serverSource).toContain('"target":"context.db.query.accounts.findFirst"');
    expect(serverSource).toContain('"target":"reader.query.orders.findMany"');
  });

  it.each([
    ['computed relational table', 'await ctx.db.query[table].findMany()'],
    ['computed relational terminal', 'await ctx.db.query.accounts[method]()'],
    ['unknown relational terminal', 'await ctx.db.query.accounts.removeEverything()'],
    ['extra relational namespace', 'await ctx.db.query.schema.accounts.findMany()'],
    ['unknown managed namespace chain', 'await ctx.db.schema.accounts.findMany()'],
    ['computed read-namespace terminal', 'await ctx.db.read[operation]()'],
    ['extra read namespace', 'await ctx.db.read.schema.accounts.findMany()'],
    ['extra write namespace', 'await ctx.db.write.schema.insert()'],
    ['raw-driver-shaped namespace', 'await ctx.db.driver.execute("drop table accounts")'],
    ['raw-pool-shaped namespace', 'await ctx.db.pool.query("select 1")'],
    ['table-namespace write terminal', 'await ctx.db.products.delete("p1")'],
  ])('rejects %s instead of widening managed relational reads', (_label, operation) => {
    expect(
      kv449(`
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    ${operation};
    return Response.json({ ok: true });
  },
});
`),
    ).not.toEqual([]);
  });

  it.each([
    ['unknown managed database method', 'await ctx.db.dropEverything()'],
    ['computed managed database method', 'await ctx.db[operation]()'],
    ['raw Response from mutation', "return new Response('raw')"],
  ])('rejects %s', (_label, operation) => {
    expect(
      kv449(`
import { mutation } from '@kovojs/server';
export const save = mutation('save', { handler: async (_input, _request, ctx) => { ${operation}; } });
`),
    ).not.toEqual([]);
  });

  it('requires static justifications on the trustedSql and trustedHtml exceptional doors', () => {
    expect(
      kv449(`
import { trustedHtml } from '@kovojs/browser';
import { sql, trustedSql } from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  handler(_input, ctx) {
    ctx.db.execute(trustedSql(sql\`select 1\`, { justification: reason }));
    return Response.json({ html: trustedHtml('<strong>ok</strong>') });
  },
});
`),
    ).toHaveLength(2);
  });

  it('rejects standalone CSRF helpers targeting mutations but not same-named local lookalikes', () => {
    expect(
      kv449(`
import { csrfField as field, mutation } from '@kovojs/server';
export const save = mutation('save', { handler() {} });
export function render(context) { return field(context, { mutation: save }); }
`),
    ).toHaveLength(1);

    expect(
      kv449(`
function csrfField(_context, _options) { return '<input>'; }
export const value = csrfField({}, { mutation: 'lookalike' });
`),
    ).toEqual([]);
  });
});
