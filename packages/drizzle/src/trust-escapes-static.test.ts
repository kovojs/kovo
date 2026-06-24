import { describe, expect, it } from 'vitest';

import {
  collectTrustEscapesFromProject,
  collectUnregisteredSinksFromProject,
} from '@kovojs/drizzle/internal/static';

function trustEscapesFor(source: string, fileName = 'app.tsx') {
  return collectTrustEscapesFromProject({ files: [{ fileName, source }] });
}

function sinksFor(source: string, fileName = 'app.tsx') {
  return collectUnregisteredSinksFromProject({ files: [{ fileName, source }] });
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
});
