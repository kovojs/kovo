import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

const kv236 = 'Unsafe output context requires an explicit trusted Kovo escape hatch.';

describe('compiler output-context security', () => {
  it('keeps text and title/aria attributes in safe output contexts', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component({
  render: ({ product }) => (
    <article title={product.name} aria-label={product.name}>
      <h2>{product.name}</h2>
    </article>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';

    // SPEC §1/§5.2: text children are a text output context; title/aria stay attributes.
    expect(serverSource).toContain('{escapeText(product.name)}</h2>');
    expect(serverSource).toContain('title={product.name}');
    expect(serverSource).toContain('aria-label={product.name}');
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('rejects unsafe and implicit-external literal URL attributes', () => {
    const result = compileComponentModule({
      fileName: 'links.tsx',
      source: `
export const Links = component({
  render: () => (
    <nav>
      <a href="javascript:alert(1)">bad</a>
      <a href="https://example.com/pricing">external</a>
      <a href="https://trusted.example/docs" external>trusted external</a>
      <a href="/pricing">internal</a>
    </nav>
  ),
});
`,
      registryFacts: { routes: ['/pricing'] },
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
        }),
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="https://example.com/pricing" is an external literal URL without external`,
        }),
      ]),
    );
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('https://trusted.example/docs'),
        }),
      ]),
    );
  });

  it('rejects unsafe literal URLs but accepts trustedUrl-wrapped ones (SPEC §4.8 escape hatch)', () => {
    const unsafe = compileComponentModule({
      fileName: 'link.tsx',
      source: `
export const Link = component({
  render: () => <a href="javascript:alert(1)">bad</a>,
});
`,
    });
    const trusted = compileComponentModule({
      fileName: 'trusted-link.tsx',
      source: `
import { trustedUrl } from '@kovojs/browser';

export const TrustedLink = component({
  render: () => <a href={trustedUrl("javascript:alert(1)")}>vouched</a>,
});
`,
    });

    // Unwrapped unsafe scheme is KV236; the trustedUrl brand is the escape hatch.
    expect(unsafe.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
        }),
      ]),
    );
    expect(trusted.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
  });

  it('rejects arbitrary dynamic style text and unsafe static CSS urls', () => {
    const result = compileComponentModule({
      fileName: 'styled-card.tsx',
      source: `
export const StyledCard = component({
  styles: \`
    .card { background-image: url("javascript:alert(1)"); }
  \`,
  render: ({ product }) => <article class="card" style={product.css}>Card</article>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} dynamic style text`,
        }),
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} styles contains an unsafe CSS url()`,
        }),
      ]),
    );
  });

  it('emits generated style properties through the runtime output helper', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component({
  queries: { product: productQuery },
  render: ({ product }) => <img viewTransitionName={product.slug} src="/p1.png" />,
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain(
      `import { derive, kovoStyleProperty } from '@kovojs/browser/generated';`,
    );
    expect(serverSource).toContain(
      `derive(["product"], (product) => kovoStyleProperty("view-transition-name", product.slug));`,
    );
    expect(clientSource).toContain(
      `import { applyCompiledQueryUpdatePlan, derive, kovoStyleProperty } from '@kovojs/browser/generated';`,
    );
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
  });

  it('lowers state style objects through generated style-property derives', () => {
    const result = compileComponentModule({
      fileName: 'slider-demo.tsx',
      source: `
export const SliderDemo = component({
  state: () => ({ value: 50 }),
  render: (_queries, state) => (
    <slider-demo>
      <span style={{ width: \`\${state.value}%\` }} />
      <span style={{ left: \`\${state.value}%\`, top: '50%', transform: 'translate(-50%, -50%)' }} />
    </slider-demo>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect({
      clientSource: clientSource.replace(/\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\//g, '/c/__v/HASH/'),
      diagnostics: result.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236'),
      serverSource: serverSource.replace(/\/c\/__v\/[0-9a-f]{16}-[0-9a-f]{8}\//g, '/c/__v/HASH/'),
    }).toMatchInlineSnapshot(`
      {
        "clientSource": "// @kovojs-ir
      import { derive, kovoStyleProperty } from '@kovojs/browser/generated';

      export const SliderDemo$span_style_derive = derive(["state"], (state) => [kovoStyleProperty("width", \`\${state.value}%\`)].filter(Boolean).join('; '));
      export const SliderDemo$span_style_derive_2 = derive(["state"], (state) => [kovoStyleProperty("left", \`\${state.value}%\`), kovoStyleProperty("top", '50%'), kovoStyleProperty("transform", 'translate(-50%, -50%)')].filter(Boolean).join('; '));
      ",
        "diagnostics": [],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`import { derive, kovoStyleProperty } from '@kovojs/browser/generated';

      export const SliderDemo$span_style_derive = derive(["state"], (state: any) => [kovoStyleProperty("width", \\\`\\\${state.value}%\\\`)].filter(Boolean).join('; '));
      export const SliderDemo$span_style_derive_2 = derive(["state"], (state: any) => [kovoStyleProperty("left", \\\`\\\${state.value}%\\\`), kovoStyleProperty("top", '50%'), kovoStyleProperty("transform", 'translate(-50%, -50%)')].filter(Boolean).join('; '));


      export const SliderDemo = component({
        state: () => ({ value: 50 }),
        render: (_queries, state) => (
          <slider-demo kovo-state="{&quot;value&quot;:50}">
            <span style={{ width: \\\`\\\${state.value}%\\\` }} data-bind:style="/c/__v/HASH/slider-demo.client.js#SliderDemo$span_style_derive" />
            <span style={{ left: \\\`\\\${state.value}%\\\`, top: '50%', transform: 'translate(-50%, -50%)' }} data-bind:style="/c/__v/HASH/slider-demo.client.js#SliderDemo$span_style_derive_2" />
          </slider-demo>
        ),
      });
      SliderDemo.name = "slider-demo/slider-demo";
      \`;
      }
      ",
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('escapes list template stamps in the client HTML-fragment path', () => {
    const result = compileComponentModule({
      fileName: 'cart-list.tsx',
      source: `
export const CartList = component({
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <template kovo-stamp>
        <li title="Item"><span data-bind=".name">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });
    const serverSource = result.files.find((file) => file.kind === 'server')?.source ?? '';
    const clientSource = result.files.find((file) => file.kind === 'client')?.source ?? '';

    expect(serverSource).toContain('<span data-bind=".name">Item</span>');
    expect(clientSource).toContain('kovoEscapeHtml');
    expect(clientSource).toContain('return [');
    expect(result.queryUpdatePlans[0]?.templateStamps).toHaveLength(1);
  });

  it('escapes fragment-target text and rejects raw HTML strings unless wrapped', () => {
    const unsafe = compileComponentModule({
      fileName: 'promo.tsx',
      source: `
export const Promo = component({
  render: ({ promo }) => (
    <section>
      <h2>{promo.title}</h2>
      <div dangerouslySetInnerHTML={"<img src=x onerror=alert(1)>"} />
    </section>
  ),
});
`,
    });
    const safe = compileComponentModule({
      fileName: 'trusted-promo.tsx',
      source: `
import { trustedHtml } from '@kovojs/browser';

export const TrustedPromo = component({
  render: ({ promo }) => <div dangerouslySetInnerHTML={trustedHtml("<b>safe</b>")} />,
});
`,
    });

    expect(unsafe.files.find((file) => file.kind === 'server')?.source).toContain(
      '{escapeText(promo.title)}</h2>',
    );
    expect(unsafe.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} dangerouslySetInnerHTML receives a plain string; use Kovo TrustedHtml`,
        }),
      ]),
    );
    expect(safe.diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')).toEqual([]);
  });

  // F2: KV236 must flag on*, srcdoc, dynamic formaction sinks (KV236/SPEC §4.8:348)
  it('flags data-bind:onclick and data-bind:srcdoc as KV236 unsafe sinks', () => {
    const result = compileComponentModule({
      fileName: 'handler-sinks.tsx',
      source: `
export const HandlerSinks = component({
  render: ({ state }) => (
    <div>
      <button data-bind:onclick="state.h">click</button>
      <iframe data-bind:srcdoc="state.html"></iframe>
    </div>
  ),
});
`,
    });

    const kv236Diagnostics = result.diagnostics.filter((d) => d.code === 'KV236');
    expect(kv236Diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('data-bind:onclick is a dynamic event-handler sink'),
        }),
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('data-bind:srcdoc is a dynamic srcdoc sink'),
        }),
      ]),
    );
  });

  it('flags dynamic formaction binding as KV236 unsafe sink', () => {
    const result = compileComponentModule({
      fileName: 'form-sinks.tsx',
      source: `
export const FormSinks = component({
  render: ({ state }) => (
    <form>
      <button data-bind:formaction="state.url">submit</button>
    </form>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('data-bind:formaction is a dynamic formaction sink'),
        }),
      ]),
    );
  });

  // F4: ftp must be in the compiler URL-scheme allowlist (SPEC §4.8:347)
  it('allows ftp: literal URL attributes without KV236', () => {
    const result = compileComponentModule({
      fileName: 'ftp-link.tsx',
      source: `
export const FtpLink = component({
  render: () => (
    <a href="ftp://example.com/x" external>FTP resource</a>
  ),
});
`,
    });

    const kv236Diagnostics = result.diagnostics.filter((d) => d.code === 'KV236');
    expect(kv236Diagnostics).toEqual([]);
  });

  // A3 (SPEC §4.8 / §5.2 #10): static object spread into a URL/raw-HTML/srcdoc/on* sink must be
  // expanded and validated exactly like the directly-authored attribute — it is not a KV236 bypass.
  it('flags static object spread into an unsafe URL sink (A3)', () => {
    const result = compileComponentModule({
      fileName: 'spread-url.tsx',
      source: `
export const SpreadUrl = component({
  render: () => <a {...{ href: "javascript:alert(1)" }}>x</a>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
        }),
      ]),
    );
  });

  it('flags non-inline static object spread into an unsafe URL sink (KV236)', () => {
    const result = compileComponentModule({
      fileName: 'spread-url-const.tsx',
      source: `
const unsafeLinkAttrs = { href: "javascript:alert(1)" };

export const SpreadUrlConst = component({
  render: () => <a {...unsafeLinkAttrs}>x</a>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
        }),
      ]),
    );
  });

  it('flags statically resolvable computed object spread into an unsafe URL sink (KV236)', () => {
    const result = compileComponentModule({
      fileName: 'spread-url-computed.tsx',
      source: `
const urlAttr = "href";
const unsafeLinkAttrs = { [urlAttr]: "javascript:alert(1)" };

export const SpreadUrlComputed = component({
  render: () => <a {...unsafeLinkAttrs}>x</a>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
        }),
      ]),
    );
  });

  it('flags static object spread into srcdoc and dangerouslySetInnerHTML sinks (A3)', () => {
    const srcdoc = compileComponentModule({
      fileName: 'spread-srcdoc.tsx',
      source: `
export const SpreadSrcdoc = component({
  render: () => <iframe {...{ srcdoc: "<script>alert(1)</script>" }} />,
});
`,
    });
    const rawHtml = compileComponentModule({
      fileName: 'spread-rawhtml.tsx',
      source: `
export const SpreadRawHtml = component({
  render: () => <div {...{ dangerouslySetInnerHTML: "<img src=x onerror=alert(1)>" }} />,
});
`,
    });

    expect(srcdoc.diagnostics.filter((d) => d.code === 'KV236')).not.toEqual([]);
    expect(rawHtml.diagnostics.filter((d) => d.code === 'KV236')).not.toEqual([]);
  });

  it('flags direct lowercase onclick and srcdoc literal sinks as KV236', () => {
    const result = compileComponentModule({
      fileName: 'direct-unsafe-sinks.tsx',
      source: `
export const DirectUnsafeSinks = component({
  render: () => (
    <div>
      <button onclick="alert(1)">click</button>
      <iframe srcdoc={"<script>alert(1)</script>"} />
    </div>
  ),
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: expect.stringContaining('onclick is an event-handler sink'),
        }),
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} srcdoc receives a plain string; use Kovo TrustedHtml`,
        }),
      ]),
    );
  });

  it('keeps safe static object spreads (internal href, class) without KV236 (A3)', () => {
    const result = compileComponentModule({
      fileName: 'spread-safe.tsx',
      source: `
export const SpreadSafe = component({
  render: () => <a {...{ href: "/pricing", class: "btn" }}>x</a>,
});
`,
      registryFacts: { routes: ['/pricing'] },
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV236')).toEqual([]);
  });

  // B1 (SPEC §4.8:358 / §5.2 #10): dynamic <script> element text is an unsafe RAWTEXT context —
  // KV236 unless trustedHtml; escapeText (`&<>` only) is the wrong encoder for JS context.
  it('flags dynamic <script> element text as KV236, suppressed by trustedHtml (B1)', () => {
    const unsafe = compileComponentModule({
      fileName: 'script-text.tsx',
      source: `
export const ScriptText = component({
  queries: { cfg: () => ({ inline: "" }) },
  render: ({ cfg }) => <div><script>{cfg.inline}</script></div>,
});
`,
    });
    const trusted = compileComponentModule({
      fileName: 'script-text-trusted.tsx',
      source: `
import { trustedHtml } from '@kovojs/browser';

export const ScriptTextTrusted = component({
  queries: { cfg: () => ({ inline: "" }) },
  render: ({ cfg }) => <div><script>{trustedHtml(cfg.inline)}</script></div>,
});
`,
    });

    expect(unsafe.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} dynamic <script> element text`,
        }),
      ]),
    );
    expect(trusted.diagnostics.filter((d) => d.code === 'KV236')).toEqual([]);
  });

  // B2 (SPEC §4.8:356 / §5.2 #10): dynamic <style> element text is an unsafe RAWTEXT context.
  it('flags dynamic <style> element text as KV236 (B2)', () => {
    const result = compileComponentModule({
      fileName: 'style-text.tsx',
      source: `
export const StyleText = component({
  queries: { data: () => ({ css: "" }) },
  render: ({ data }) => <div><style>{data.css}</style></div>,
});
`,
    });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'KV236',
          message: `${kv236} dynamic <style> element text`,
        }),
      ]),
    );
  });

  it('allows static literal <script>/<style> element text without KV236 (B1/B2)', () => {
    const result = compileComponentModule({
      fileName: 'static-rawtext.tsx',
      source: `
export const StaticRawtext = component({
  render: () => (
    <div>
      <script>{"window.__kovo = 1"}</script>
      <style>{".a{color:red}"}</style>
    </div>
  ),
});
`,
    });

    expect(result.diagnostics.filter((d) => d.code === 'KV236')).toEqual([]);
  });

  // A1 (SPEC §4.8/§4.9): a derive must never reference an unbound query. Element/computed-access
  // reads (`rows[i].name`, `rows[0].name`) surface their reactive root so the derive-input
  // extractor either binds every root or refuses to lower (whole-component refresh), never emitting
  // a derive whose body reads a query that is not one of its declared inputs/params.
  it('does not emit a derive that references an unbound query for element-access reads (A1)', () => {
    const text = compileComponentModule({
      fileName: 'elem-text.tsx',
      source: `
export const ElemText = component({
  queries: { rows: () => [] },
  state: () => ({ i: 0 }),
  render: ({ rows }, state) => <p>{rows[state.i].name}</p>,
});
`,
    });
    const attr = compileComponentModule({
      fileName: 'elem-attr.tsx',
      source: `
export const ElemAttr = component({
  queries: { rows: () => [], meta: () => ({}) },
  render: ({ rows, meta }) => <span title={meta.label + rows[0].name}>x</span>,
});
`,
    });

    for (const result of [text, attr]) {
      const generated = result.files
        .filter((file) => file.kind === 'server' || file.kind === 'client')
        .map((file) => file.source)
        .join('\n');
      for (const derive of generated.matchAll(
        /derive\((\[[^\]]*\]),\s*\(([^)]*)\)\s*=>\s*([^;]*?)\)\s*;/g,
      )) {
        const inputs = derive[1] ?? '';
        const params = (derive[2] ?? '').split(',').map((p) => (p.split(':')[0] ?? '').trim());
        const body = derive[3] ?? '';
        // `rows` is referenced in both bodies; if a derive's body uses it, it MUST be a bound param.
        if (/\brows\b/.test(body)) {
          expect(params).toContain('rows');
          expect(inputs).toContain('rows');
        }
      }
    }
  });

  it('binds the query root for a single-query element-access attribute derive (A1)', () => {
    const result = compileComponentModule({
      fileName: 'single-elem-attr.tsx',
      source: `
export const SingleElemAttr = component({
  queries: { rows: () => [] },
  render: ({ rows }) => <span title={rows[0].name}>x</span>,
});
`,
    });
    const generated = result.files
      .filter((file) => file.kind === 'server' || file.kind === 'client')
      .map((file) => file.source)
      .join('\n');

    // The element-access root is now seen, so the attribute lowers to a correctly-bound derive
    // over `rows` (no unbound reference), not a silently stale whole-component fallback gap.
    expect(generated).toMatch(/derive\(\["rows"\],\s*\(rows[^)]*\)\s*=>\s*rows\[0\]\.name\)/);
  });
});

// P2-1 / S4 (SPEC §4.8 / §5.2 #10, KV236): output safety is contextual and default-on, and the
// compile-time gate must be COMPLETE across every channel a static sink can reach a lowered
// attribute by. A directly-authored attribute, a static object spread (`{...{…}}`), and a
// primitive-composition `attrs={{…}}` merge bag all lower to the same authored sink, so all three
// must raise an identical KV236 — otherwise the spread/attrs channels are a silent bypass that
// breaks the audit-visible-brand guarantee (only the runtime sink-policy floor would catch them).
describe('KV236 direct ≡ spread ≡ attrs-merge channel symmetry (P2-1 / S4)', () => {
  const kv236Messages = (source: string): string[] =>
    compileComponentModule({ fileName: 'symmetry.tsx', source })
      .diagnostics.filter((diagnostic) => diagnostic.code === 'KV236')
      .map((diagnostic) => diagnostic.message);

  // Each entry renders the same sink three ways; all three MUST produce the same KV236 message.
  const unsafeChannels: ReadonlyArray<{
    name: string;
    expected: string;
    direct: string;
    spread: string;
    attrs: string;
  }> = [
    {
      name: 'javascript: CSS url() in a style sink',
      expected: `${kv236} style attribute contains an unsafe CSS url()`,
      direct: `<div style="background:url('javascript:alert(1)')">x</div>`,
      spread: `<div {...{ style: "background:url('javascript:alert(1)')" }}>x</div>`,
      attrs: `<Tooltip.Trigger asChild attrs={{ style: "background:url('javascript:alert(1)')" }}><div>x</div></Tooltip.Trigger>`,
    },
    {
      name: 'javascript: URL scheme in an href sink',
      expected: `${kv236} href="javascript:alert(1)" uses an unsafe URL scheme`,
      direct: `<a href="javascript:alert(1)">x</a>`,
      spread: `<a {...{ href: "javascript:alert(1)" }}>x</a>`,
      attrs: `<Tooltip.Trigger asChild attrs={{ href: "javascript:alert(1)" }}><a>x</a></Tooltip.Trigger>`,
    },
    {
      name: 'plain string into a raw-HTML sink',
      expected: `${kv236} dangerouslySetInnerHTML receives a plain string; use Kovo TrustedHtml`,
      direct: `<div dangerouslySetInnerHTML="<img src=x onerror=alert(1)>">x</div>`,
      spread: `<div {...{ dangerouslySetInnerHTML: "<img src=x onerror=alert(1)>" }}>x</div>`,
      attrs: `<Tooltip.Trigger asChild attrs={{ dangerouslySetInnerHTML: "<img src=x onerror=alert(1)>" }}><div>x</div></Tooltip.Trigger>`,
    },
    {
      name: 'lowercase onclick event-handler sink',
      expected: `${kv236} onclick is an event-handler sink (on* attribute)`,
      direct: `<button onclick="alert(1)">x</button>`,
      spread: `<button {...{ onclick: "alert(1)" }}>x</button>`,
      attrs: `<Tooltip.Trigger asChild attrs={{ onclick: "alert(1)" }}><button>x</button></Tooltip.Trigger>`,
    },
  ];

  it.each(unsafeChannels)(
    'raises an identical KV236 for $name across direct, spread, and attrs-merge',
    ({ expected, direct, spread, attrs }) => {
      const wrap = (markup: string) =>
        `export const Sym = component({ render: () => (${markup}) });`;
      const directMessages = kv236Messages(wrap(direct));
      const spreadMessages = kv236Messages(wrap(spread));
      const attrsMessages = kv236Messages(wrap(attrs));

      expect(directMessages).toContain(expected);
      expect(spreadMessages).toContain(expected);
      expect(attrsMessages).toContain(expected);
    },
  );

  it('keeps safe values green in every channel (direct ≡ spread ≡ attrs-merge)', () => {
    const wrap = (markup: string) =>
      `export const Safe = component({ render: () => (${markup}) });`;
    const safeChannels = [
      `<div style="background: red; color: blue">x</div>`,
      `<div {...{ style: "background: red; color: blue" }}>x</div>`,
      `<Tooltip.Trigger asChild attrs={{ style: "color: red", class: "btn" }}><div>x</div></Tooltip.Trigger>`,
      // `on:click` is Kovo's handler-ref binding, not a raw HTML on* sink — every channel must
      // leave it green, exactly like the direct form's `isDirectHtmlEventHandlerAttribute` gate.
      `<Tooltip.Trigger asChild attrs={{ 'on:click': '/c/handler#click', style: 'color: red' }}><button>x</button></Tooltip.Trigger>`,
    ];

    for (const markup of safeChannels) {
      expect(kv236Messages(wrap(markup))).toEqual([]);
    }
  });

  it('does not flag a plain (non-component) element attrs attribute (false-positive guard)', () => {
    // The `attrs={{…}}` merge channel only exists for component tags; a plain element's unrelated
    // `attrs` value never lowers to a child sink, so it must stay green even with an unsafe scheme.
    const messages = kv236Messages(
      `export const Plain = component({ render: () => <div attrs={{ href: "javascript:alert(1)" }}>x</div> });`,
    );
    expect(messages).toEqual([]);
  });
});
