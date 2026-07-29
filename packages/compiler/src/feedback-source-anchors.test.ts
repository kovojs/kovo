import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

describe('compiler feedback-surface source anchors', () => {
  it('anchors handlers, triggers, derives, suppressions, and binding positions to authored TSX', () => {
    const source = `
export const CartBadge$label = derive(['cart'], (cart) => String(cart.count));

export const CartBadge = component({
  queries: { cart: {} },
  render: () => (
    <section>
      <button onClick={() => {}} data-bind="cart.count">Add</button>
      <output data-derive="cart.CartBadge$label">empty</output>
      <sales-chart onVisible={() => {}} />
      {/* KV211: eager inventory hydration is required for this route. */}
      <stock-ticker onLoad={() => {}} />
    </section>
  ),
});
`;
    const result = compileComponentModule({
      fileName: 'src/cart-badge.tsx',
      source,
      sourceProvenance: 'app',
    });
    const component = result.componentGraphFacts[0];

    expect(component?.handlers).toHaveLength(1);
    expect(component?.triggers).toHaveLength(2);
    expect(component?.derives).toHaveLength(1);
    expect(component?.suppressions).toHaveLength(1);

    const handler = component?.handlers?.[0];
    expect(source.slice(handler?.source?.start, handler?.source?.end)).toContain('onClick');
    expect(handler?.generatedFrom).toEqual(handler?.source);

    const visible = component?.triggers?.find((trigger) => trigger.trigger === 'visible');
    expect(source.slice(visible?.source?.start, visible?.source?.end)).toContain('onVisible');
    const load = component?.triggers?.find((trigger) => trigger.trigger === 'load');
    expect(source.slice(load?.source?.start, load?.source?.end)).toContain('onLoad');
    expect(load?.justification).toContain('KV211');

    const derive = component?.derives?.[0];
    expect(source.slice(derive?.source?.start, derive?.source?.end)).toContain("derive(['cart']");
    expect(source.slice(derive?.generatedFrom?.start, derive?.generatedFrom?.end)).toContain(
      'data-derive',
    );

    const suppression = component?.suppressions?.[0];
    expect(source.slice(suppression?.source.start, suppression?.source.end)).toContain('KV211');
    expect(source.slice(suppression?.target?.start, suppression?.target?.end)).toContain('onLoad');

    expect(result.updateCoverage.length).toBeGreaterThan(0);
    for (const fact of result.updateCoverage) {
      expect(fact.sourceAnchor).toMatchObject({
        file: 'src/cart-badge.tsx',
      });
      expect(source.slice(fact.sourceAnchor?.start, fact.sourceAnchor?.end).length).toBeGreaterThan(
        0,
      );
    }
    expect(
      result.updateCoverage.some(
        (fact) =>
          fact.query === 'cart.count' &&
          source.slice(fact.sourceAnchor?.start, fact.sourceAnchor?.end).includes('data-bind'),
      ),
    ).toBe(true);
  });
});
