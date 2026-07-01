import { describe, expect, it } from 'vitest';

import { mutationInputFactsFromSource } from './mutation-inputs.js';

describe('mutation input facts', () => {
  it('extracts field names, completeness state, coercions, and provenance', () => {
    const source = `
export const addToCart = mutation('cart/add', {
  input: s.object({
    productId: s.string(),
    quantity: s.number().int().min(1).default(1),
    gift: s.boolean().optional(),
    stage: s.enum(['lead', 'open']),
  }),
  handler() {
    return null;
  },
});
`;

    const fact = mutationInputFactsFromSource('app.ts', source).get('addToCart');

    expect(fact).toMatchObject({
      key: 'cart/add',
      localName: 'addToCart',
      fields: [
        {
          coercion: 'string',
          defaulted: false,
          name: 'productId',
          optional: false,
          provenance: 'local-mutation',
          required: true,
          source: { fileName: 'app.ts' },
        },
        {
          coercion: 'number',
          defaulted: true,
          name: 'quantity',
          optional: false,
          provenance: 'local-mutation',
          required: false,
          source: { fileName: 'app.ts' },
        },
        {
          coercion: 'boolean',
          defaulted: false,
          name: 'gift',
          optional: true,
          provenance: 'local-mutation',
          required: false,
          source: { fileName: 'app.ts' },
        },
        {
          coercion: 'string',
          defaulted: false,
          name: 'stage',
          optional: false,
          provenance: 'local-mutation',
          required: true,
          source: { fileName: 'app.ts' },
        },
      ],
    });
    expect(fact?.fields.every((field) => typeof field.source?.start === 'number')).toBe(true);
    expect(fact?.fields.every((field) => typeof field.source?.length === 'number')).toBe(true);
  });

  it('derives object-form mutation keys from the source file and exported binding', () => {
    const source = `
export const addToCart = mutation({
  input: s.object({
    productId: s.string(),
  }),
  handler() {
    return null;
  },
});
`;

    const fact = mutationInputFactsFromSource('src/mutations/cart.ts', source).get('addToCart');

    expect(fact).toMatchObject({
      key: 'mutations/cart/add-to-cart',
      localName: 'addToCart',
      fields: [{ name: 'productId', provenance: 'local-mutation' }],
    });
  });

  it('extracts mutation inputs through subpath aliases and namespace imports', () => {
    const source = `
import { mutation as defineMutation } from '@kovojs/server/api/data';
import * as data from '@kovojs/server/api/data';

const mutationAlias = defineMutation;

export const save = mutationAlias({
  input: s.object({ productId: s.string() }),
  handler() {},
});

export const remove = data.mutation('cart/remove', {
  input: s.object({ productId: s.string() }),
  handler() {},
});
`;

    const facts = mutationInputFactsFromSource('src/cart/mutations.ts', source);

    expect(facts.get('save')).toMatchObject({
      key: 'cart/mutations/save',
      fields: [{ name: 'productId', provenance: 'local-mutation' }],
    });
    expect(facts.get('remove')).toMatchObject({
      key: 'cart/remove',
      fields: [{ name: 'productId', provenance: 'local-mutation' }],
    });
  });

  it('does not extract mutation inputs from local lookalike functions', () => {
    const source = `
function mutation(value) { return value; }

export const save = mutation({
  input: s.object({ productId: s.string() }),
  handler() {},
});
`;

    expect([...mutationInputFactsFromSource('src/cart/mutations.ts', source)]).toEqual([]);
  });
});
