import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import type { GeneratedOutputWriteFact } from './internal.js';
import type { CompileResult } from './index.js';

describe('compiler output-context facts', () => {
  it('records facts for generated server text, query attributes, state text, and templates', () => {
    const serverText = compileComponentModule({
      fileName: 'server-text-facts.tsx',
      source: `
export const ServerTextFacts = component({
  render: ({ product }) => <article>{product.name}</article>,
});
`,
    });
    const reactive = compileComponentModule({
      fileName: 'output-context-facts.tsx',
      source: `
export const OutputContextFacts = component({
  queries: { product: productQuery, cart: cartQuery },
  state: () => ({ count: 0 }),
  render: ({ product, cart }, state) => (
    <section title={product.name}>
      <h2>{product.name}</h2>
      <output>{state.count + 1}</output>
      <ul data-bind-list="cart.items" kovo-key="id">
        <template kovo-stamp>
          <li><span data-bind=".name">Name</span></li>
        </template>
      </ul>
    </section>
  ),
});
`,
    });

    expectGeneratedInterpolationFacts(serverText, [
      {
        context: 'text',
        expression: 'product.name',
        source: 'server-render',
        writer: 'static text interpolation escape',
      },
    ]);
    expectGeneratedInterpolationFacts(reactive, [
      {
        context: 'attribute',
        expression: 'product.name',
        source: 'client-query',
        writer: 'inline query attribute derive',
      },
      {
        context: 'attribute',
        expression: 'product.name',
        source: 'client-query',
        writer: 'query attribute stamp',
      },
      {
        context: 'text',
        expression: 'product.name',
        source: 'client-query',
        writer: 'inline text binding',
      },
      {
        context: 'text',
        expression: 'state.count + 1',
        source: 'client-state',
        writer: 'inline state text derive',
      },
      {
        context: 'html-fragment',
        expression: 'cart.items',
        source: 'template-stamp',
        writer: 'template stamp assembly',
      },
      {
        context: 'html-fragment',
        expression: '.name',
        source: 'template-stamp',
        writer: 'template stamp interpolation',
      },
    ]);
  });

  it('records URL attribute facts for generated dynamic URL updates', () => {
    const result = compileComponentModule({
      fileName: 'dynamic-url-facts.tsx',
      source: `
export const DynamicUrlFacts = component({
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

    expect(expectFacts(result, { context: 'url-attribute' })).toMatchInlineSnapshot(`
      [
        {
          "context": "url-attribute",
          "expression": "product.href",
          "sink": "href",
          "source": "client-query",
          "writer": "inline query attribute derive",
        },
        {
          "context": "url-attribute",
          "expression": "product.image",
          "sink": "src",
          "source": "client-query",
          "writer": "inline query attribute derive",
        },
        {
          "context": "url-attribute",
          "expression": "product.href",
          "sink": "href",
          "source": "client-query",
          "writer": "query attribute stamp",
        },
        {
          "context": "url-attribute",
          "expression": "product.image",
          "sink": "src",
          "source": "client-query",
          "writer": "query attribute stamp",
        },
      ]
    `);
  });

  it('records generated style-property and CSS-text facts', () => {
    const result = compileComponentModule({
      fileName: 'style-output-context-facts.tsx',
      source: `
import * as style from '@kovojs/style';

const styles = style.create({
  root: {
    backgroundColor: 'black',
    color: 'white',
  },
}, { namespace: 'facts', source: 'facts.tsx' });

export const StyleOutputContextFacts = component({
  state: () => ({ value: 50 }),
  render: (_queries, state) => (
    <article>
      <button style={styles.root}>Buy</button>
      <span style={{ width: \`\${state.value}%\` }} />
    </article>
  ),
});
`,
    });

    expect(snapshotFacts(expectFacts(result, { context: 'style-property' })))
      .toMatchInlineSnapshot(`
      [
        {
          "context": "style-property",
          "expression": "[kovoStyleProperty('width', \`\${state.value}%\`)].filter(Boolean).join('; ')",
          "sink": "style",
          "source": "client-state",
          "writer": "inline state attribute derive",
        },
      ]
    `);
    expect(expectFacts(result, { context: 'css-text' })).toMatchInlineSnapshot(`
      [
        {
          "context": "css-text",
          "sink": "StyleOutputContextFacts.css",
          "source": "style-extraction",
          "writer": "style extraction css text",
        },
      ]
    `);
  });

  it('records trusted/raw HTML facts for accepted raw HTML sinks', () => {
    const result = compileComponentModule({
      fileName: 'trusted-output-context-facts.tsx',
      source: `
import { trustedHtml } from '@kovojs/runtime';

export const TrustedOutputContextFacts = component({
  render: () => <article dangerouslySetInnerHTML={trustedHtml("<b>safe</b>")} />,
});
`,
    });

    expect(snapshotFacts(expectFacts(result, { context: 'trusted-html' }))).toMatchInlineSnapshot(`
      [
        {
          "context": "trusted-html",
          "expression": "trustedHtml('<b>safe</b>')",
          "sink": "dangerouslySetInnerHTML",
          "source": "server-render",
          "writer": "trusted raw HTML attribute",
        },
      ]
    `);
  });

  it('keeps generated interpolation helper calls covered by output-context facts', () => {
    const result = compileComponentModule({
      fileName: 'generated-interpolation-guard.tsx',
      source: `
export const GeneratedInterpolationGuard = component({
  queries: { product: productQuery },
  state: () => ({ value: 50 }),
  render: ({ product, profile }, state) => (
    <article title={product.name}>
      <h2>{product.name}</h2>
      <p>{profile.name}</p>
      <span style={{ width: \`\${state.value}%\` }} />
    </article>
  ),
});
`,
    });
    const emittedSource = result.files.map((file) => file.source).join('\n');

    // SPEC §1.2/§5.2: every compiler-generated interpolation helper must have a typed
    // output-context fact before generated artifacts choose escaping or sanitization.
    expect(emittedSource).toContain('escapeText(profile.name)');
    expect(emittedSource).toContain('kovoStyleProperty("width",');
    expectGeneratedInterpolationFacts(result, [
      {
        context: 'text',
        expression: 'profile.name',
        source: 'server-render',
        writer: 'static text interpolation escape',
      },
      {
        context: 'attribute',
        expression: 'product.name',
        source: 'client-query',
        writer: 'inline query attribute derive',
      },
      {
        context: 'style-property',
        source: 'client-state',
        writer: 'inline state attribute derive',
      },
    ]);
  });
});

function expectGeneratedInterpolationFacts(
  result: CompileResult,
  expected: readonly Partial<GeneratedOutputWriteFact>[],
): void {
  for (const fact of expected) {
    expect(
      result.outputContextFacts,
      `missing output-context fact ${JSON.stringify(fact)}`,
    ).toEqual(expect.arrayContaining([expect.objectContaining(fact)]));
  }
}

function expectFacts(
  result: CompileResult,
  expected: Partial<GeneratedOutputWriteFact>,
): GeneratedOutputWriteFact[] {
  return result.outputContextFacts.filter((fact) =>
    Object.entries(expected).every(
      ([key, value]) => fact[key as keyof GeneratedOutputWriteFact] === value,
    ),
  );
}

function snapshotFacts(
  facts: readonly GeneratedOutputWriteFact[],
): readonly GeneratedOutputWriteFact[] {
  return facts.map((fact) => ({
    ...fact,
    ...(fact.expression ? { expression: fact.expression.replaceAll('"', "'") } : {}),
  }));
}
