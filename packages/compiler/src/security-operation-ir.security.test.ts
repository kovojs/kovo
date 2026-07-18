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

  it('accepts exact structured server operations and named justified exceptional doors', () => {
    const diagnostics = kv449(`
import { trustedHtml } from '@kovojs/browser';
import { trustedSql } from '@kovojs/drizzle';
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

  it('preserves exact framework identity through namespace exceptional-door imports', () => {
    const result = compile(`
import * as browser from '@kovojs/browser';
import * as drizzle from '@kovojs/drizzle';
import { endpoint } from '@kovojs/server';
export const report = endpoint('/report', {
  async handler(_input, ctx) {
    await ctx.db.execute(drizzle.trustedSql(sql\`select 1\`, {
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
    const diagnostics = kv449(`
import { query } from '@kovojs/server';
export const root = query('catalog/read', {
  async load(_input, ctx) {
    await ctx.db.insert('catalog');
    return null;
  },
});
`);

    expect(diagnostics).not.toEqual([]);
    expect(diagnostics[0]?.message).toContain(
      'query loaders cannot perform a managed database write',
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
import { trustedSql } from '@kovojs/drizzle';
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
