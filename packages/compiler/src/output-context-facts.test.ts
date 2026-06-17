import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';
import type { CompileResult, GeneratedOutputWriteFact } from './index.js';

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
});

function expectGeneratedInterpolationFacts(
  result: CompileResult,
  expected: readonly Partial<GeneratedOutputWriteFact>[],
): void {
  for (const fact of expected) {
    expect(result.outputContextFacts, `missing output-context fact ${JSON.stringify(fact)}`).toEqual(
      expect.arrayContaining([expect.objectContaining(fact)]),
    );
  }
}
