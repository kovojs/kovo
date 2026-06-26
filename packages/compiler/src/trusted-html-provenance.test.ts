import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './compile.js';

// SPEC §9.1 (sink renderer) / §5.2 #10 (output safety) / §4.8 (trustedHtml escape hatch), KV426
// (KV236/KV426 family): trustedHtml() is a pure brand that sanitizes nothing, so branding provably
// request/query-derived data is a by-construction XSS sink. The gate is modeled on the KV438
// mass-assignment write-provenance gate (SPEC §10.3/§11.1) and decides provenance from AST
// symbol-identity over the request/query source set, never source-text heuristics (SPEC §5.2 rule 9).

function kv426(source: string, fileName = 'probe.tsx'): readonly string[] {
  return compileComponentModule({ fileName, source })
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
});
