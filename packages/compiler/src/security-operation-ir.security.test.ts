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

  it.each([
    ['unknown managed database method', 'await ctx.db.dropEverything()'],
    ['computed managed database method', 'await ctx.db[operation]()'],
    ['raw Response from mutation', "return new Response('raw')"],
  ])('rejects %s', (_label, operation) => {
    expect(
      kv449(`
import { mutation } from '@kovojs/server';
export const save = mutation('save', { handler: async (_input, ctx) => { ${operation}; } });
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
