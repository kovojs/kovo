import { runInNewContext } from 'node:vm';

import {
  applyCompiledQueryUpdatePlan,
  derive,
  kovoEscapeHtml,
  kovoStyleProperty,
} from '@kovojs/browser/generated';
import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

describe('compiler output-context payload matrix', () => {
  it('snapshots text payload server escaping and client updates', () => {
    const serverResult = compileComponentModule({
      fileName: 'server-payload-card.tsx',
      source: `
export const ServerPayloadCard = component({
  render: ({ product }) => (
    <article>
      <h2>{product.name}</h2>
      <p>{product.summary}</p>
    </article>
  ),
});
`,
    });
    const clientResult = compileComponentModule({
      fileName: 'client-payload-card.tsx',
      source: `
export const ClientPayloadCard = component({
  queries: { product: productQuery },
  render: ({ product }) => (
    <article>
      <h2 data-bind="product.name">Name</h2>
      <p data-bind="product.summary">Summary</p>
    </article>
  ),
});
`,
    });
    const clientModule = executeClientModule(fileByKind(clientResult, 'client').source);
    const updatePlans = clientModule.ClientPayloadCard$queryUpdatePlans as QueryUpdatePlanExports;
    const name = new FakeElement({ 'data-bind': 'product.name' }, { textContent: 'server' });
    const summary = new FakeElement({ 'data-bind': 'product.summary' }, { textContent: 'server' });
    const root = new FakeRoot([name, summary], []);
    const payload = {
      name: '<img src=x onerror=alert(1)> & "quoted"',
      summary: "5 > 4 & 3 < 6 'single'",
    };
    const applied = runQueryPlan(updatePlans, 'product', root, payload);

    expect({
      applied,
      clientText: {
        name: name.textContent,
        summary: summary.textContent,
      },
      clientDiagnostics: clientResult.diagnostics,
      clientSource: normalizeArtifact(fileByKind(clientResult, 'client').source),
      serverDiagnostics: serverResult.diagnostics,
      serverSource: normalizeArtifact(fileByKind(serverResult, 'server').source),
    }).toMatchInlineSnapshot(`
      {
        "applied": {
          "bindings": [
            "product.name",
            "product.summary",
          ],
          "derives": [],
          "stamps": [],
          "templateStamps": [],
        },
        "clientDiagnostics": [],
        "clientSource": "// @kovojs-ir
      import { applyCompiledQueryUpdatePlan } from '@kovojs/browser/generated';

      export const ClientPayloadCard$queryUpdatePlans = {
        "product"(root, value) {
          return applyCompiledQueryUpdatePlan(root, "product", value, { bindings: true, derives: [], stamps: [], templateStamps: [] });
        },
      };",
        "clientText": {
          "name": "<img src=x onerror=alert(1)> & "quoted"",
          "summary": "5 > 4 & 3 < 6 'single'",
        },
        "serverDiagnostics": [],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`import { escapeText } from '@kovojs/server/internal/html';

      export const ServerPayloadCard = component({
        render: ({ product }) => (
          <article kovo-c="server-payload-card">
            <h2>{escapeText(product.name)}</h2>
            <p>{escapeText(product.summary)}</p>
          </article>
        ),
      });
      ServerPayloadCard.name = "server-payload-card/server-payload-card";
      \`;
      }",
      }
    `);
    expect(() => assertFixpoint(serverResult)).not.toThrow();
    expect(() => assertFixpoint(clientResult)).not.toThrow();
  });

  it('snapshots title and ARIA attribute payload behavior', () => {
    const result = compileComponentModule({
      fileName: 'payload-card.tsx',
      source: `
export const PayloadCard = component({
  queries: { product: productQuery },
  render: ({ product }) => (
    <article
      title={product.name}
      aria-label={product.label}
      aria-description={product.summary}
    >
      <h2>{product.name}</h2>
    </article>
  ),
});
`,
    });
    const clientModule = executeClientModule(fileByKind(result, 'client').source);
    const updatePlans = clientModule.PayloadCard$queryUpdatePlans as QueryUpdatePlanExports;
    const text = new FakeElement({ 'data-bind': 'product.name' }, { textContent: 'server' });
    const article = new FakeElement(
      Object.fromEntries(
        (result.queryUpdatePlans[0]?.stamps ?? []).map((stamp) => [
          `data-bind:${stamp.attr}`,
          selectorAttributeValue(stamp.derive.selector),
        ]),
      ),
    );
    const root = new FakeRoot([text], [article]);
    const payload = {
      label: 'Label <svg onload=alert(1)> & "quoted"',
      name: '<img src=x onerror=alert(1)> & "quoted"',
      summary: "Summary > details & <more> 'single'",
    };
    const applied = runQueryPlan(updatePlans, 'product', root, payload);

    expect({
      applied,
      clientAttributes: article.attributeRecord(),
      clientText: text.textContent,
      clientSource: normalizeArtifact(fileByKind(result, 'client').source),
      diagnostics: result.diagnostics,
      queryUpdatePlans: result.queryUpdatePlans,
      serverSource: normalizeArtifact(fileByKind(result, 'server').source),
    }).toMatchInlineSnapshot(`
      {
        "applied": {
          "bindings": [
            "product.name",
            "product.PayloadCard$article_aria_description_derive",
            "product.PayloadCard$article_aria_label_derive",
            "product.PayloadCard$article_title_derive",
          ],
          "derives": [],
          "stamps": [
            "aria-description",
            "aria-label",
            "title",
          ],
          "templateStamps": [],
        },
        "clientAttributes": {
          "aria-description": "Summary > details & <more> 'single'",
          "aria-label": "Label <svg onload=alert(1)> & "quoted"",
          "data-bind:aria-description": "product.PayloadCard$article_aria_description_derive",
          "data-bind:aria-label": "product.PayloadCard$article_aria_label_derive",
          "data-bind:title": "product.PayloadCard$article_title_derive",
          "title": "<img src=x onerror=alert(1)> & "quoted"",
        },
        "clientSource": "// @kovojs-ir
      import { applyCompiledQueryUpdatePlan, derive } from '@kovojs/browser/generated';

      export const PayloadCard$article_aria_description_derive = derive(["product"], (product) => product.summary);
      export const PayloadCard$article_aria_label_derive = derive(["product"], (product) => product.label);
      export const PayloadCard$article_title_derive = derive(["product"], (product) => product.name);

      export const PayloadCard$queryUpdatePlans = {
        "product"(root, value) {
          return applyCompiledQueryUpdatePlan(root, "product", value, { bindings: true, derives: [], stamps: [{ attr: "aria-description", selector: "[data-bind:aria-description=\\"product.PayloadCard$article_aria_description_derive\\"]", select(value) { return PayloadCard$article_aria_description_derive.run(value); } }, { attr: "aria-label", selector: "[data-bind:aria-label=\\"product.PayloadCard$article_aria_label_derive\\"]", select(value) { return PayloadCard$article_aria_label_derive.run(value); } }, { attr: "title", selector: "[data-bind:title=\\"product.PayloadCard$article_title_derive\\"]", select(value) { return PayloadCard$article_title_derive.run(value); } }], templateStamps: [] });
        },
      };",
        "clientText": "<img src=x onerror=alert(1)> & "quoted"",
        "diagnostics": [],
        "queryUpdatePlans": [
          {
            "componentName": "PayloadCard",
            "outputContexts": [
              {
                "context": "attribute",
                "expression": "product.PayloadCard$article_title_derive",
                "sink": "title",
                "source": "client-query",
                "writer": "query attribute binding",
              },
              {
                "context": "attribute",
                "expression": "product.PayloadCard$article_aria_label_derive",
                "sink": "aria-label",
                "source": "client-query",
                "writer": "query attribute binding",
              },
              {
                "context": "attribute",
                "expression": "product.PayloadCard$article_aria_description_derive",
                "sink": "aria-description",
                "source": "client-query",
                "writer": "query attribute binding",
              },
              {
                "context": "text",
                "expression": "product.name",
                "sink": "textContent",
                "source": "client-query",
                "writer": "query text binding",
              },
              {
                "context": "attribute",
                "expression": "product.name",
                "sink": "title",
                "source": "client-query",
                "writer": "query attribute binding",
              },
              {
                "context": "attribute",
                "expression": "product.label",
                "sink": "aria-label",
                "source": "client-query",
                "writer": "query attribute binding",
              },
              {
                "context": "attribute",
                "expression": "product.summary",
                "sink": "aria-description",
                "source": "client-query",
                "writer": "query attribute binding",
              },
            ],
            "paths": [
              "product.PayloadCard$article_aria_description_derive",
              "product.PayloadCard$article_aria_label_derive",
              "product.PayloadCard$article_title_derive",
              "product.name",
            ],
            "query": "product",
            "stamps": [
              {
                "attr": "aria-description",
                "derive": {
                  "exportName": "PayloadCard$article_aria_description_derive",
                  "expression": "product.summary",
                  "input": "product",
                  "name": "PayloadCard$article_aria_description_derive",
                  "param": "product",
                  "selector": "[data-bind:aria-description="product.PayloadCard$article_aria_description_derive"]",
                },
                "selector": "[data-bind:aria-description="product.PayloadCard$article_aria_description_derive"]",
              },
              {
                "attr": "aria-label",
                "derive": {
                  "exportName": "PayloadCard$article_aria_label_derive",
                  "expression": "product.label",
                  "input": "product",
                  "name": "PayloadCard$article_aria_label_derive",
                  "param": "product",
                  "selector": "[data-bind:aria-label="product.PayloadCard$article_aria_label_derive"]",
                },
                "selector": "[data-bind:aria-label="product.PayloadCard$article_aria_label_derive"]",
              },
              {
                "attr": "title",
                "derive": {
                  "exportName": "PayloadCard$article_title_derive",
                  "expression": "product.name",
                  "input": "product",
                  "name": "PayloadCard$article_title_derive",
                  "param": "product",
                  "selector": "[data-bind:title="product.PayloadCard$article_title_derive"]",
                },
                "selector": "[data-bind:title="product.PayloadCard$article_title_derive"]",
              },
            ],
          },
        ],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`import { derive } from '@kovojs/browser/generated';
      import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


      export const PayloadCard$article_title_derive = derive(["product"], (product) => product.name);
      export const PayloadCard$article_aria_label_derive = derive(["product"], (product) => product.label);
      export const PayloadCard$article_aria_description_derive = derive(["product"], (product) => product.summary);


      export const PayloadCard = component({
        queries: { product: productQuery },
        render: ({ product }) => (
          <article data-bind:title="product.PayloadCard$article_title_derive" data-bind:aria-label="product.PayloadCard$article_aria_label_derive" data-bind:aria-description="product.PayloadCard$article_aria_description_derive" kovo-c="payload-card" kovo-deps="product" kovo-fragment-target="payload-card" kovo-live-component="payload-card/payload-card">
            <h2 data-bind="product.name">{product.name}</h2>
          </article>
        ),
      });
      PayloadCard.name = "payload-card/payload-card";

      export const PayloadCard$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
        component: PayloadCard,
        componentId: "payload-card/payload-card",
      }));
      \`;
      }",
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('snapshots literal URL attributes across internal, external, and unsafe schemes', () => {
    const result = compileComponentModule({
      fileName: 'literal-url-payloads.tsx',
      registryFacts: {
        routes: ['/products/:id'],
      },
      source: `
export const LiteralUrlPayloads = component({
  render: () => (
    <nav>
      <a href="/products/p1?ref=%3Ctag%3E">Internal</a>
      <a href="https://example.com/docs?q=%3Ctag%3E" external>External</a>
      <a href="https://example.com/missing-external">Missing external marker</a>
      <a href="javascript:alert(1)">Unsafe</a>
    </nav>
  ),
});
`,
    });

    expect({
      diagnostics: result.diagnostics,
      serverSource: normalizeArtifact(fileByKind(result, 'server').source),
    }).toMatchInlineSnapshot(`
      {
        "diagnostics": [
          {
            "code": "KV220",
            "fileName": "literal-url-payloads.tsx",
            "help": "Would lower to: a route-checked href/action that participates in the typed route registry.
      Blocked reason: the literal target does not match any declared canonical route path.
      Fixes: use a typed route helper, declare the route, correct the literal path, or mark an intentional full-origin/external navigation with the external escape hatch.
      SPEC §6.4 and §9.5 require navigation targets to stay type-checked against the route table.
      Escape: external/full-origin URLs opt out because they are outside the app route graph.",
            "length": 26,
            "message": "Literal href or form action matches no declared route. javascript:alert(1)",
            "severity": "error",
            "start": {
              "column": 10,
              "line": 8,
            },
          },
          {
            "code": "KV236",
            "fileName": "literal-url-payloads.tsx",
            "help": "Blocked reason: the output context can execute script, navigate unexpectedly, inject unsafe CSS, or bypass normal JSX escaping.
      Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.
      SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.",
            "length": 43,
            "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. href="https://example.com/missing-external" is an external literal URL without external",
            "severity": "error",
            "start": {
              "column": 10,
              "line": 7,
            },
          },
          {
            "code": "KV236",
            "fileName": "literal-url-payloads.tsx",
            "help": "Blocked reason: the output context can execute script, navigate unexpectedly, inject unsafe CSS, or bypass normal JSX escaping.
      Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.
      SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.",
            "length": 26,
            "message": "Unsafe output context requires an explicit trusted Kovo escape hatch. href="javascript:alert(1)" uses an unsafe URL scheme",
            "severity": "error",
            "start": {
              "column": 10,
              "line": 8,
            },
          },
        ],
        "serverSource": "// @kovojs-ir
      export function renderSource() {
        return \`
      export const LiteralUrlPayloads = component({
        render: () => (
          <nav kovo-c="literal-url-payloads">
            <a href="/products/p1?ref=%3Ctag%3E">Internal</a>
            <a href="https://example.com/docs?q=%3Ctag%3E" external>External</a>
            <a href="https://example.com/missing-external">Missing external marker</a>
            <a href="javascript:alert(1)">Unsafe</a>
          </nav>
        ),
      });
      LiteralUrlPayloads.name = "literal-url-payloads/literal-url-payloads";
      \`;
      }",
      }
    `);
  });

  it('snapshots dynamic URL attribute updates through URL-bound sanitizers', () => {
    const result = compileComponentModule({
      fileName: 'dynamic-url-payloads.tsx',
      source: `
export const DynamicUrlPayloads = component({
  queries: { product: productQuery },
  render: ({ product }) => (
    <article>
      <a href={product.href}>Product</a>
      <img src={product.image} />
    </article>
  ),
});
`,
    });
    const clientModule = executeClientModule(fileByKind(result, 'client').source);
    const updatePlans = clientModule.DynamicUrlPayloads$queryUpdatePlans as QueryUpdatePlanExports;
    const anchor = new FakeElement(selectorAttributeRecord(result, 'href'));
    const image = new FakeElement(selectorAttributeRecord(result, 'src'));
    const root = new FakeRoot([], [anchor, image]);
    const applied = runQueryPlan(updatePlans, 'product', root, {
      href: 'javascript:alert(1)',
      image: '/images/p1.png?caption=%3Ctag%3E',
    });

    expect({
      applied,
      clientSource: normalizeArtifact(fileByKind(result, 'client').source),
      diagnostics: result.diagnostics,
      updatedAttributes: {
        anchor: anchor.attributeRecord(),
        image: image.attributeRecord(),
      },
    }).toMatchInlineSnapshot(`
      {
        "applied": {
          "bindings": [],
          "derives": [],
          "stamps": [
            "href",
            "src",
          ],
          "templateStamps": [],
        },
        "clientSource": "// @kovojs-ir
      import { applyCompiledQueryUpdatePlan, derive } from '@kovojs/browser/generated';

      export const DynamicUrlPayloads$a_href_derive = derive(["product"], (product) => product.href);
      export const DynamicUrlPayloads$img_src_derive = derive(["product"], (product) => product.image);

      export const DynamicUrlPayloads$queryUpdatePlans = {
        "product"(root, value) {
          return applyCompiledQueryUpdatePlan(root, "product", value, { bindings: true, derives: [], stamps: [{ attr: "href", selector: "[data-derive=\\"product.DynamicUrlPayloads$a_href_derive\\"]", select(value) { return DynamicUrlPayloads$a_href_derive.run(value); } }, { attr: "src", selector: "[data-derive=\\"product.DynamicUrlPayloads$img_src_derive\\"]", select(value) { return DynamicUrlPayloads$img_src_derive.run(value); } }], templateStamps: [] });
        },
      };",
        "diagnostics": [],
        "updatedAttributes": {
          "anchor": {
            "data-derive": "product.DynamicUrlPayloads$a_href_derive",
            "href": "#",
          },
          "image": {
            "data-derive": "product.DynamicUrlPayloads$img_src_derive",
            "src": "/images/p1.png?caption=%3Ctag%3E",
          },
        },
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('snapshots template stamp item payload escaping', () => {
    const result = compileComponentModule({
      fileName: 'template-payloads.tsx',
      source: `
export const TemplatePayloads = component({
  queries: { cart: cartQuery },
  render: () => (
    <ul data-bind-list="cart.items" kovo-key="sku">
      <template kovo-stamp>
        <li><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li>
      </template>
    </ul>
  ),
});
`,
    });
    const clientModule = executeClientModule(fileByKind(result, 'client').source);
    const updatePlans = clientModule.TemplatePayloads$queryUpdatePlans as QueryUpdatePlanExports;
    const list = new FakeTemplateStampHost({
      'data-bind-list': 'cart.items',
      'kovo-key': 'sku',
    });
    const root = new FakeRoot([], [list]);
    const applied = runQueryPlan(updatePlans, 'cart', root, {
      items: [
        {
          name: '<img src=x onerror=alert(1)> & "quoted"',
          qty: "5 > 4 & 3 < 6 'single'",
          sku: 'p1',
        },
      ],
    });

    expect({
      applied,
      clientSource: normalizeArtifact(fileByKind(result, 'client').source),
      diagnostics: result.diagnostics,
      renderedItems: list.items,
      renderedText: list.textContent,
    }).toMatchInlineSnapshot(`
      {
        "applied": {
          "bindings": [],
          "derives": [],
          "stamps": [],
          "templateStamps": [
            "[data-bind-list="cart.items"]",
          ],
        },
        "clientSource": "// @kovojs-ir
      import { applyCompiledQueryUpdatePlan, kovoEscapeHtml } from '@kovojs/browser/generated';

      export const TemplatePayloads$queryUpdatePlans = {
        "cart"(root, value) {
          return applyCompiledQueryUpdatePlan(root, "cart", value, { bindings: true, derives: [], stamps: [], templateStamps: [{ key: "sku", list: "items", selector: "[data-bind-list=\\"cart.items\\"]", render(item) {
            const record = item && typeof item === "object" ? item : {};
            const read = (path) => path.reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, record);
            return ["<li><span data-bind=\\".qty\\">", kovoEscapeHtml(read(["qty"])), "</span> x <span data-bind=\\".name\\">", kovoEscapeHtml(read(["name"])), "</span></li>"].join("");
          } }] });
        },
      };",
        "diagnostics": [],
        "renderedItems": [
          {
            "html": "<li><span data-bind=".qty">5 &gt; 4 &amp; 3 &lt; 6 'single'</span> x <span data-bind=".name">&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;</span></li>",
            "index": 0,
            "key": "p1",
            "value": {
              "name": "<img src=x onerror=alert(1)> & "quoted"",
              "qty": "5 > 4 & 3 < 6 'single'",
              "sku": "p1",
            },
          },
        ],
        "renderedText": "<li><span data-bind=".qty">5 &gt; 4 &amp; 3 &lt; 6 'single'</span> x <span data-bind=".name">&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;</span></li>",
      }
    `);
    expect(() => assertFixpoint(result)).not.toThrow();
  });
});

type QueryUpdatePlanExports = Record<string, (root: FakeRoot, value: unknown) => unknown>;

function runQueryPlan(
  updatePlans: QueryUpdatePlanExports,
  name: string,
  root: FakeRoot,
  value: unknown,
): unknown {
  const plan = updatePlans[name];
  if (!plan) throw new Error(`Missing query update plan: ${name}`);
  return plan(root, value);
}

function selectorAttributeValue(selector: string): string {
  const match = /^\[[^=\]]+="([^"]*)"\]$/.exec(selector);
  return match?.[1] ?? '';
}

function selectorAttributeRecord(
  result: ReturnType<typeof compileComponentModule>,
  attr: string,
): Record<string, string> {
  const selector = result.queryUpdatePlans[0]?.stamps?.find(
    (stamp) => stamp.attr === attr,
  )?.selector;
  if (!selector) throw new Error(`Missing selector for ${attr}`);

  const match = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
  if (!match) throw new Error(`Unsupported selector: ${selector}`);
  return { [(match[1] ?? '').replaceAll('\\:', ':')]: match[2] ?? '' };
}

function fileByKind(
  result: ReturnType<typeof compileComponentModule>,
  kind: 'client' | 'server',
): { source: string } {
  const file = result.files.find((item) => item.kind === kind);
  if (!file) throw new Error(`Missing ${kind} artifact`);
  return file;
}

function executeClientModule(source: string): Record<string, unknown> {
  const exports: Record<string, unknown> = {};
  const moduleSource = source
    .replace(
      /import\s+\{([^}]+)\}\s+from\s+['"]@kovojs\/browser(?:\/generated)?['"];\n?/g,
      (_match, names: string) => `const { ${names.trim()} } = runtime;\n`,
    )
    .replace(/export const ([A-Za-z_$][\w$]*)/g, 'const $1 = exports.$1');

  runInNewContext(
    moduleSource,
    {
      exports,
      runtime: {
        applyCompiledQueryUpdatePlan,
        derive,
        kovoEscapeHtml,
        kovoStyleProperty,
      },
    },
    { timeout: 1000 },
  );

  return exports;
}

function normalizeArtifact(source: string): string {
  return source.replaceAll(/\/c\/__v\/[0-9a-f]{8}\//g, '/c/__v/HASH/').trim();
}

class FakeElement {
  attributes: Array<{ name: string; value: string }>;
  textContent: string | null;

  constructor(attributes: Record<string, string>, options: { textContent?: string | null } = {}) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
  }

  attributeRecord(): Record<string, string> {
    return Object.fromEntries(
      [...this.attributes]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((attribute) => [attribute.name, attribute.value]),
    );
  }

  closest(selector: string): FakeElement | null {
    return this.matches(selector) ? this : null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exact = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exact) return this.getAttribute((exact[1] ?? '').replaceAll('\\:', ':')) === exact[2];

    const present = /^\[([^=\]]+)\]$/.exec(selector);
    return present ? this.getAttribute((present[1] ?? '').replaceAll('\\:', ':')) !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }
}

class FakeTemplateStampHost extends FakeElement {
  items: Array<{ html: string; index: number; key: string; value: unknown }> = [];

  reconcileTemplateStamp(
    items: readonly { html: string; index: number; key: string; value: unknown }[],
  ): void {
    this.items = items.map((item) => ({ ...item }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

class FakeRoot {
  constructor(
    readonly bindings: readonly FakeElement[],
    readonly elements: readonly FakeElement[],
  ) {}

  querySelectorAll(selector: string): FakeElement[] {
    if (selector === '[data-bind]') {
      return this.bindings.filter((element) => element.getAttribute('data-bind') !== null);
    }
    if (selector === '*') return [...this.bindings, ...this.elements];
    return [...this.bindings, ...this.elements].filter((element) => element.matches(selector));
  }
}
