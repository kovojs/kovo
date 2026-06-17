import { runInNewContext } from 'node:vm';

import {
  applyCompiledQueryUpdatePlan,
  derive,
  kovoEscapeHtml,
  kovoStyleProperty,
} from '@kovojs/runtime';
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
      import { applyCompiledQueryUpdatePlan } from '@kovojs/runtime';

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
        return \`import { escapeText } from '@kovojs/server';

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
      import { applyCompiledQueryUpdatePlan, derive } from '@kovojs/runtime';

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
        return \`import { derive } from '@kovojs/runtime';

      export const PayloadCard$article_title_derive = derive(["product"], (product) => product.name);
      export const PayloadCard$article_aria_label_derive = derive(["product"], (product) => product.label);
      export const PayloadCard$article_aria_description_derive = derive(["product"], (product) => product.summary);


      export const PayloadCard = component({
        queries: { product: productQuery },
        render: ({ product }) => (
          <article data-bind:title="product.PayloadCard$article_title_derive" data-bind:aria-label="product.PayloadCard$article_aria_label_derive" data-bind:aria-description="product.PayloadCard$article_aria_description_derive" kovo-c="payload-card" kovo-deps="product">
            <h2 data-bind="product.name">{product.name}</h2>
          </article>
        ),
      });
      PayloadCard.name = "payload-card/payload-card";
      \`;
      }",
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
      /import\s+\{([^}]+)\}\s+from\s+['"]@kovojs\/runtime['"];\n?/g,
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
  return source.replaceAll(/\?v=[0-9a-f]{8}/g, '?v=HASH').trim();
}

class FakeElement {
  attributes: Array<{ name: string; value: string }>;
  textContent: string | null;

  constructor(
    attributes: Record<string, string>,
    options: { textContent?: string | null } = {},
  ) {
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
