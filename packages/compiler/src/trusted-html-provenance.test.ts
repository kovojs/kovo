import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';

// SPEC §9.1 (sink renderer) / §5.2 #10 (output safety) / §4.8 (trustedHtml escape hatch), KV426
// (KV236/KV426 family): trustedHtml() is a pure brand that sanitizes nothing, so branding provably
// request/query-derived data is a by-construction XSS sink. The gate is modeled on the KV438
// mass-assignment write-provenance gate (SPEC §10.3/§11.1) and decides provenance from AST
// symbol-identity over the request/query source set, never source-text heuristics (SPEC §5.2 rule 9).

interface CompileComponentExtraFile {
  readonly fileName: string;
  readonly source: string;
}

function kv426(
  source: string,
  fileName = 'probe.tsx',
  extraFiles?: readonly CompileComponentExtraFile[],
): readonly string[] {
  const options = { ...(extraFiles ? { extraFiles } : {}), fileName, source };
  return compileComponentModule(options)
    .diagnostics.filter((diagnostic) => diagnostic.code === 'KV426')
    .map((diagnostic) => diagnostic.message);
}

describe('KV426 trustedHtml request/query provenance gate (SPEC §9.1/§5.2 #10/§4.8)', () => {
  it('flags trustedHtml() over a direct query-result field access', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(post.body)}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('flags trustedHtml() over a request input field access', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request: input }) => <div>{trustedHtml(input.body)}</div>,
});
`),
    ).toHaveLength(1);
  });

  it('flags trustedHtml() over a renamed request render parameter', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, r) => <div>{trustedHtml(r.body)}</div>,
});
`),
    ).toHaveLength(1);
  });

  it('flags trustedHtml() over a req.* request accessor chain', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: () => <div>{trustedHtml(req.params.html)}</div>,
});
`),
    ).toHaveLength(1);
  });

  it('flags trustedHtml() over a non-destructured render data query field access', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: (data) => <article>{trustedHtml(data.post.body)}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('flags trustedHtml() over taint-preserving local composition', () => {
    const cases = [
      "post.body ?? ''",
      "post.body || ''",
      "post.body && '<p>ok</p>'",
      "'<h1>' + post.body",
      '`${post.body}`',
    ];

    for (const expr of cases) {
      expect(
        kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(${expr})}</article>,
});
`),
      ).toHaveLength(1);
    }
  });

  it('flags a same-scope alias of a query field (const b = post.body; trustedHtml(b))', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => {
    const b = post.body;
    return <article>{trustedHtml(b)}</article>;
  },
});
`),
    ).toHaveLength(1);
  });

  it('flags an object-destructured alias of a query result field', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => {
    const { body } = post;
    return <article>{trustedHtml(body)}</article>;
  },
});
`),
    ).toHaveLength(1);
  });

  it('flags an object-destructured alias of request input', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request: input }) => {
    const { body } = input;
    return <div>{trustedHtml(body)}</div>;
  },
});
`),
    ).toHaveLength(1);
  });

  it('flags ternary branches that carry query-derived data', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => {
    const html = post.safe ? '<p>ok</p>' : post.body;
    return <article>{trustedHtml(html)}</article>;
  },
});
`),
    ).toHaveLength(1);
  });

  it('stays clean for a string literal brand', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({ render: () => <div>{trustedHtml('<b>safe</b>')}</div> });
`),
    ).toHaveLength(0);
  });

  it('stays clean for safeRichHtml() on query data (the sanitizing primitive)', () => {
    expect(
      kv426(`
import { safeRichHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{safeRichHtml(post.body)}</article>,
});
`),
    ).toHaveLength(0);
  });

  it('discharges with the audited escape trustedHtml(value, "<justification>")', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => (
    <article>{trustedHtml(post.body, 'admin-only field, sanitized upstream')}</article>
  ),
});
`),
    ).toHaveLength(0);
  });

  it('discharges with the audited escape trustedHtml(value, { reason })', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => (
    <article>{trustedHtml(post.body, { reason: 'server-rendered markup' })}</article>
  ),
});
`),
    ).toHaveLength(0);
  });

  it('does NOT discharge with an empty reason (fail-closed)', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(post.body, '')}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('stays clean for a function-call result (bounded: documented inter-procedural residue)', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(renderCard(post.body))}</article>,
});
`),
    ).toHaveLength(0);
  });

  it('does not treat a shadowing local trustedHtml as the brand (symbol identity, fail-closed)', () => {
    expect(
      kv426(`
const trustedHtml = (value) => value;
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(post.body)}</article>,
});
`),
    ).toHaveLength(0);
  });

  it('resolves an aliased import of the real brand (import { trustedHtml as th })', () => {
    expect(
      kv426(`
import { trustedHtml as th } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('resolves trustedHtml through the @kovojs/server rendering re-export', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/server';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(post.body)}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('resolves namespace trustedHtml without trusting local lookalikes', () => {
    expect(
      kv426(`
import * as browser from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{browser.trustedHtml(post.body)}</article>,
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
import * as kovo from '@kovojs/server';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{kovo.trustedHtml(post.body)}</article>,
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
const kovo = { trustedHtml: (value) => value };
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{kovo.trustedHtml(post.body)}</article>,
});
`),
    ).toHaveLength(0);
  });

  it('resolves a local const alias of the real trustedHtml binding', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
const th = trustedHtml;
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('resolves trustedHtml through a local re-export barrel', () => {
    expect(
      kv426(
        `
import { th } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
        'pages/probe.tsx',
        [
          {
            fileName: 'pages/browser-barrel.ts',
            source: "export { trustedHtml as th } from '@kovojs/browser';",
          },
        ],
      ),
    ).toHaveLength(1);
  });

  it('does not trust local barrel lookalikes or foreign re-exports', () => {
    expect(
      kv426(
        `
import { th } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
        'pages/probe.tsx',
        [
          {
            fileName: 'pages/browser-barrel.ts',
            source: 'export const th = (value: string) => value;',
          },
        ],
      ),
    ).toHaveLength(0);

    expect(
      kv426(
        `
import { th } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{th(post.body)}</article>,
});
`,
        'pages/probe.tsx',
        [
          {
            fileName: 'pages/browser-barrel.ts',
            source: "export { trustedHtml as th } from './lookalike';",
          },
          {
            fileName: 'pages/lookalike.ts',
            source: 'export const trustedHtml = (value: string) => value;',
          },
        ],
      ),
    ).toHaveLength(0);
  });

  it('flags a same-file wrapper helper that directly brands its argument as trustedHtml', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
const unsafeTrust = (value: string) => trustedHtml(value);
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{unsafeTrust(post.body)}</article>,
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
function unsafeTrust(value: string) {
  return trustedHtml(value);
}
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{unsafeTrust(post.body)}</article>,
});
`),
    ).toHaveLength(1);
  });
});
