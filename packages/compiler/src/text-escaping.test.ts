import { describe, expect, it } from 'vitest';

import { assertFixpoint, compileComponentModule } from './index.js';

// SECURITY_FINDINGS.md C1: the @kovojs/server jsx runtime emits text children verbatim, so the
// compiler wraps static data-path text interpolations in escapeText(...) during lowering, making
// generated components safe-by-default without a runtime contract change.
describe('compiler text-child escaping (C1)', () => {
  it('escapes static data-path text children inside a mapped list and imports escapeText', () => {
    const result = compileComponentModule({
      fileName: 'order-history.tsx',
      source: `
export const OrderHistory = component({
  render: ({ orders }) => (
    <ol>
      {orders.map((item) => (
        <li kovo-key={item.id}>
          {item.productId} x {item.qty}
        </li>
      ))}
    </ol>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('{escapeText(item.productId)}');
    expect(serverSource).toContain('{escapeText(item.qty)}');
    expect(serverSource).toContain("import { escapeText } from '@kovojs/server/internal/escape';");
    // The map callback itself is not a property-access path, so it is never wrapped.
    expect(serverSource).not.toContain('escapeText(orders.map');
    expect(result.diagnostics).toEqual([]);
    // Idempotent: recompiling the lowered output must not double-wrap.
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('escapes a sole data-path text child', () => {
    const result = compileComponentModule({
      fileName: 'product-card.tsx',
      source: `
export const ProductCard = component({
  render: ({ product }) => <h2>{product.name}</h2>,
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('{escapeText(product.name)}</h2>');
    expect(() => assertFixpoint(result)).not.toThrow();
  });

  it('escapes render-data call and conditional expressions but not attribute expressions', () => {
    const result = compileComponentModule({
      fileName: 'card.tsx',
      source: `
export const Card = component({
  render: ({ product }) => (
    <article title={product.name}>
      {formatPrice(product.price)}
      {product.featured ? product.name : product.fallbackName}
      {product.subtitle ?? product.name}
      {\`SKU \${product.sku}\`}
      {[product.name, product.fallbackName].join(" / ")}
      <span>{product.icon}</span>
    </article>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    // attribute expression stays (runtime escapes attributes); call expression is not a data path.
    expect(serverSource).toContain('title={product.name}');
    expect(serverSource).toContain('{escapeText(formatPrice(product.price))}');
    expect(serverSource).toContain(
      '{escapeText(product.featured ? product.name : product.fallbackName)}',
    );
    expect(serverSource).toContain('{escapeText(product.subtitle ?? product.name)}');
    expect(serverSource).toContain('{escapeText(\\`SKU \\${product.sku}\\`)}');
    expect(serverSource).toContain(
      '{escapeText([product.name, product.fallbackName].join(" / "))}',
    );
    expect(serverSource).not.toContain('escapeText(product.name))'); // not double-applied to the attr
    // the sole data-path text child inside <span> is escaped
    expect(serverSource).toContain('<span>{escapeText(product.icon)}</span>');
  });

  it('escapes SSR fallback text for query/state bindings and derives', () => {
    const result = compileComponentModule({
      fileName: 'question-detail.tsx',
      source: `
export const QuestionDetail = component({
  queries: { question: {} },
  state: () => ({ selected: "<b>raw</b>" }),
  render: ({ question }, state) => (
    <article>
      <h1>{question.title}</h1>
      <p>Asked by {question.authorName}</p>
      <strong>{question.title + " " + question.body}</strong>
      <em>{state.selected.toUpperCase()}</em>
    </article>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain(
      '<h1 data-bind="question.title">{escapeText(question.title)}</h1>',
    );
    expect(serverSource).toContain(
      'Asked by <span data-bind="question.authorName">{escapeText(question.authorName)}</span>',
    );
    expect(serverSource).toContain('{escapeText(question.title + " " + question.body)}</strong>');
    expect(serverSource).toContain('{escapeText(state.selected.toUpperCase())}</em>');
    expect(serverSource).toContain("import { escapeText } from '@kovojs/server/internal/escape';");
  });

  it('leaves explicit component render composition as raw HTML', () => {
    const result = compileComponentModule({
      fileName: 'composed.tsx',
      source: `
export const Composed = component({
  render: ({ card }) => (
    <section>
      {Card.definition.render({ children: card.body })}
    </section>
  ),
});
`,
    });
    const serverSource = result.files[0]?.source ?? '';

    expect(serverSource).toContain('{Card.definition.render({ children: card.body })}');
    expect(serverSource).not.toContain('escapeText(Card.definition.render');
  });
});
