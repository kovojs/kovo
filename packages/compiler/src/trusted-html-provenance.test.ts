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

interface GeneratedTrustSinkCase {
  readonly brand: 'trustedHtml' | 'trustedUrl';
  readonly expression: string;
  readonly prelude: string;
}

function generatedTrustSinkCases(count = 210): readonly GeneratedTrustSinkCase[] {
  const cases: GeneratedTrustSinkCase[] = [];
  const brands = ['trustedHtml', 'trustedUrl'] as const;
  for (let index = 0; cases.length < count; index += 1) {
    for (const brand of brands) {
      const member = brand === 'trustedHtml' ? 'html' : 'url';
      const variant = index % 5;
      const id = `${brand}_${index}`;
      if (variant === 0) {
        cases.push({
          brand,
          prelude: `const trust_${id} = { ${member}: ${brand} };`,
          expression: `({ ...trust_${id} }).${member}`,
        });
      } else if (variant === 1) {
        cases.push({ brand, prelude: '', expression: `([${brand}] as const)[0]` });
      } else if (variant === 2) {
        cases.push({ brand, prelude: '', expression: `(() => ${brand})()` });
      } else if (variant === 3) {
        cases.push({
          brand,
          prelude: `function pick_${id}() { return ${brand}; }`,
          expression: `pick_${id}()`,
        });
      } else {
        cases.push({
          brand,
          prelude: `class Trust_${id} { ${member} = ${brand}; }`,
          expression: `new Trust_${id}().${member}`,
        });
      }
      if (cases.length >= count) break;
    }
  }
  return cases;
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

  it('flags trustedHtml() over request reached through a renamed render slots parameter', () => {
    const messages = kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, slots) => <div>{trustedHtml(slots.request.body)}</div>,
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('request-derived data');
  });

  it('flags trustedHtml() over an aliased request render slot by position', () => {
    const messages = kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request: inbound }) => <div>{trustedHtml(inbound.body)}</div>,
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('request-derived data');
  });

  it('does not treat a render slots parameter named request as the request object by name', () => {
    const messages = kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, request) => <div>{trustedHtml(request.body)}</div>,
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('provenance cannot be proven locally');
  });

  it('does not classify shadowed render data or slot names by text', () => {
    expect(
      kv426(`
import { trustedHtml, trustedUrl } from '@kovojs/browser';
export const C = component({
  queries: { contacts: contactsQuery },
  render: (data, _state, slots) => {
    const renderLocal = () => {
      const data = { contacts: { items: [{ email: '/reviewed' }] } };
      const slots = { request: { body: '<b>static helper</b>' } };
      return (
        <main>
          <a href={trustedUrl(data.contacts.items[0].email)}>safe</a>
          {trustedHtml(slots.request.body)}
        </main>
      );
    };
    return renderLocal();
  },
});
`),
    ).toHaveLength(0);
  });

  it('fails closed when a nested callback parameter shadows a query binding', () => {
    const messages = kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => {
    const format = (post: { body: string }) => trustedHtml(post.body);
    return <article>{format({ body: '<p>local</p>' })}</article>;
  },
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('provenance cannot be proven locally');
  });

  it('does not treat a local object named request as request provenance', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: () => {
    const request = { body: '<b>static helper</b>' };
    return <div>{trustedHtml(request.body)}</div>;
  },
});
`),
    ).toHaveLength(0);
  });

  it('fails closed for an unbound req.* accessor without treating the name as proof', () => {
    const messages = kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: () => <div>{trustedHtml(req.params.html)}</div>,
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('provenance cannot be proven locally');
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

  it('flags trustedHtml() over a numeric query key reached through element access', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { 0: postQuery },
  render: (data) => <article>{trustedHtml(data[0].body)}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('flags trustedUrl() in a JSX URL attribute over non-destructured render data', () => {
    expect(
      kv426(`
import { trustedUrl } from '@kovojs/browser';
export const C = component({
  queries: { contacts: contactsQuery },
  render: (data) => <a href={trustedUrl(data.contacts.items[0]?.email ?? '/')}>first</a>,
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
      'String(post.body)',
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

  it('propagates or fails closed for C2 operator and local-helper value-flow forms', () => {
    const cases = [
      "'<h1>' + post.body",
      '`${post.body}`',
      "post.body ?? '<p>fallback</p>'",
      "post.body || '<p>fallback</p>'",
      "post.body && '<p>present</p>'",
      "post.safe ? '<p>ok</p>' : post.body",
      'renderCard(post.body)',
      'renderStaticCard()',
      '([...safeParts] as unknown as string)',
      '({ ...safeByKey }.body as string)',
      "({ [post.body]: '<p>safe</p>' } as unknown as string)",
    ];

    for (const expr of cases) {
      expect(
        kv426(`
import { trustedHtml } from '@kovojs/browser';
const safeParts = ['<p>static</p>'];
const safeByKey = { body: '<p>static</p>' };
const renderCard = (value: string) => '<article>' + value + '</article>';
const renderStaticCard = () => '<article>static</article>';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(${expr})}</article>,
});
`),
      ).toHaveLength(1);
    }
  });

  it('fails closed for operator forms whose result cannot be locally proven clean', () => {
    const cases = [
      'post.body.trim()',
      'html`<p>${post.body}</p>`',
      '({ body: post.body }).body',
      '({ ...post }).body',
      '[...post.items].join("")',
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

  it('fails closed for expression forms that are not explicitly proven clean', () => {
    const cases = [
      "((() => '<p>static</p>') as unknown as string)",
      "((function () { return '<p>static</p>'; }) as unknown as string)",
      "((class { static html = '<p>static</p>'; }) as unknown as string)",
      '(/static/ as unknown as string)',
    ];

    for (const expr of cases) {
      expect(
        kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  render: () => <article>{trustedHtml(${expr})}</article>,
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

  it('stays clean for primitive safe constants through explicit string operators', () => {
    expect(
      kv426(`
import { trustedHtml, trustedUrl } from '@kovojs/browser';
import { renderedHtml } from '@kovojs/server/internal/html';
const body = '<b>safe</b>';
const suffix = '<i>also safe</i>';
export const C = component({
  render: () => (
    <main>
      {trustedHtml('<section>' + body + suffix)}
      {trustedHtml(\`${'${body}'}${'${suffix}'}\`)}
      <a href={trustedUrl('/docs/' + 'intro')}>docs</a>
      {renderedHtml(true ? '<main>static</main>' : '<main>fallback</main>')}
    </main>
  ),
});
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

  it('fails closed for a function-call result that carries query data', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{trustedHtml(renderCard(post.body))}</article>,
});
`),
    ).toHaveLength(1);
  });

  it('fails closed for unprovable function-call, spread, object, and array values', () => {
    const cases = [
      'renderStaticCard()',
      '... [post.body]',
      '({ ...post }).body',
      '["safe", post.body].join("")',
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

  it('resolves trustedHtml through a local object-literal member alias', () => {
    expect(
      kv426(`
import { trustedHtml } from '@kovojs/browser';
const trust = { html: trustedHtml };
export const C = component({
  render: ({}, _state, { request }) => {
    const reflected = request.headers.get('x-xss') ?? '';
    return <article>{trust.html(reflected)}</article>;
  },
});
`),
    ).toHaveLength(1);
  });

  it('flags the round-6 hidden trustedHtml/trustedUrl callee shapes at the sink', () => {
    const cases = [
      {
        expected: 'trustedHtml() sends query-derived data',
        source: `
import { trustedHtml } from '@kovojs/browser';
const trust = { html: trustedHtml };
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{({ ...trust }).html(post.body)}</article>,
});
`,
      },
      {
        expected: 'trustedHtml() sends query-derived data',
        source: `
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{[trustedHtml][0](post.body)}</article>,
});
`,
      },
      {
        expected: 'trustedHtml() sends query-derived data',
        source: `
import { trustedHtml } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{(() => trustedHtml)()(post.body)}</article>,
});
`,
      },
      {
        expected: 'trustedHtml() sends query-derived data',
        source: `
import { trustedHtml } from '@kovojs/browser';
class R { h = trustedHtml; }
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{new R().h(post.body)}</article>,
});
`,
      },
      {
        expected: 'trustedUrl() sends query-derived data',
        source: `
import { trustedUrl } from '@kovojs/browser';
const trust = { url: trustedUrl };
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <a href={({ ...trust }).url(post.href)}>read</a>,
});
`,
      },
    ];

    for (const item of cases) {
      const messages = kv426(item.source);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(item.expected);
    }
  });

  it('keeps resolver-traced literal trust sinks clean', () => {
    expect(
      kv426(`
import { trustedHtml, trustedUrl } from '@kovojs/browser';
const trust = { html: trustedHtml, url: trustedUrl };
class R { html = trustedHtml; url = trustedUrl; }
export const C = component({
  render: () => (
    <main>
      {({ ...trust }).html('<b>safe</b>')}
      {[trustedHtml][0]('<i>safe</i>')}
      {(() => trustedHtml)()('<em>safe</em>')}
      {new R().html('<strong>safe</strong>')}
      <a href={new R().url('/docs')}>docs</a>
    </main>
  ),
});
`),
    ).toHaveLength(0);
  });

  it('generates broad callee-shape coverage for hidden trustedHtml/trustedUrl sinks', () => {
    const cases = generatedTrustSinkCases();
    expect(cases).toHaveLength(210);

    for (const item of cases) {
      const expression =
        item.brand === 'trustedHtml'
          ? `<article>{${item.expression}(post.body)}</article>`
          : `<a href={${item.expression}(post.href)}>read</a>`;
      const messages = kv426(`
import { trustedHtml, trustedUrl } from '@kovojs/browser';
${item.prelude}
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => ${expression},
});
`);
      expect(messages, `${item.brand} via ${item.expression}`).toHaveLength(1);
    }
  });

  it('resolves literal element access and fails closed for computed Kovo namespace keys', () => {
    expect(
      kv426(`
import * as browser from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{browser['trustedHtml'](post.body)}</article>,
});
`),
    ).toHaveLength(1);

    const messages = kv426(`
import * as browser from '@kovojs/browser';
const key = 'trustedHtml';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <article>{browser[key](post.body)}</article>,
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('trustedHtml() sends query-derived data');
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

  it('resolves trustedHtml and trustedUrl through export-star barrels', () => {
    expect(
      kv426(
        `
import { th, tu } from './browser-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => (
    <article>
      {th(post.body)}
      <a href={tu(post.href)}>read</a>
    </article>
  ),
});
`,
        'pages/probe.tsx',
        [
          {
            fileName: 'pages/browser-root.ts',
            source: "export { trustedHtml as th, trustedUrl as tu } from '@kovojs/browser';",
          },
          {
            fileName: 'pages/browser-barrel.ts',
            source: "export * from './browser-root';",
          },
        ],
      ),
    ).toHaveLength(2);
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
    ).toHaveLength(2);

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
    ).toHaveLength(2);
  });

  it('flags trustedUrl over request/query-derived data and supports audited reasons', () => {
    expect(
      kv426(`
import { trustedUrl } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <a href={trustedUrl(post.href)}>read</a>,
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
import { trustedUrl } from '@kovojs/browser';
export const C = component({
  render: ({}, _state, { request }) => <a href={trustedUrl(request.query.next)}>next</a>,
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
import { trustedUrl } from '@kovojs/browser';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <a href={trustedUrl(post.href, 'admin-curated redirect')}>read</a>,
});
`),
    ).toHaveLength(0);
  });

  it('fails closed for computed trustedUrl namespace calls in JSX attributes', () => {
    const messages = kv426(`
import * as browser from '@kovojs/browser';
const key = 'trustedUrl';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <a href={browser[key](post.href)}>read</a>,
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('trustedUrl() sends query-derived data');
  });

  it('resolves trustedUrl through @kovojs/server and keeps local lookalikes clean', () => {
    expect(
      kv426(`
import { trustedUrl } from '@kovojs/server';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <a href={trustedUrl(post.href)}>read</a>,
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
const trustedUrl = (value) => value;
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => <a href={trustedUrl(post.href)}>read</a>,
});
`),
    ).toHaveLength(0);
  });

  it('flags @internal renderedHtml over request/query-derived raw bytes', () => {
    expect(
      kv426(`
import { renderedHtml } from '@kovojs/server/internal/html';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => renderedHtml(post.body),
});
`),
    ).toHaveLength(1);

    expect(
      kv426(`
import { renderedHtml } from '@kovojs/server/internal/html';
export const C = component({
  render: () => renderedHtml('<main>static</main>'),
});
`),
    ).toHaveLength(0);
  });

  it('resolves @internal renderedHtml through local aliases and re-export barrels', () => {
    expect(
      kv426(`
import { renderedHtml } from '@kovojs/server/internal/html';
const raw = renderedHtml;
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => raw(post.body),
});
`),
    ).toHaveLength(1);

    expect(
      kv426(
        `
import { raw } from './raw-barrel';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => raw(post.body),
});
`,
        'pages/probe.tsx',
        [
          {
            fileName: 'pages/raw-root.ts',
            source: "export { renderedHtml as raw } from '@kovojs/server/internal/html';",
          },
          {
            fileName: 'pages/raw-barrel.ts',
            source: "export * from './raw-root';",
          },
        ],
      ),
    ).toHaveLength(1);
  });

  it('fails closed for @internal renderedHtml over unprovable raw bytes', () => {
    const messages = kv426(`
import { renderedHtml } from '@kovojs/server/internal/html';
export const C = component({
  render: () => renderedHtml(renderShell()),
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('renderedHtml() sends data whose provenance cannot be proven');
  });

  it('flags a same-file wrapper helper that directly mints renderedHtml', () => {
    expect(
      kv426(`
import { renderedHtml } from '@kovojs/server/internal/html';
const unsafeRender = (value: string) => renderedHtml(value);
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => unsafeRender(post.body),
});
`),
    ).toHaveLength(2);
  });

  it('fails closed for computed @internal renderedHtml namespace calls', () => {
    const messages = kv426(`
import * as html from '@kovojs/server/internal/html';
const key = 'renderedHtml';
export const C = component({
  queries: { post: postQuery },
  render: ({ post }) => html[key](post.body),
});
`);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('renderedHtml() sends query-derived data');
  });
});
