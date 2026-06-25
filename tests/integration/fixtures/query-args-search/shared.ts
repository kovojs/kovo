import { domain, query, s } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

const productDomain = domain('product');

export interface ProductArgs {
  id: string;
  max: number;
}

export interface ProductResult {
  id: string;
  name: string;
  price: number;
  withinBudget: boolean;
}

export async function readProduct(
  db: KovoFixtureRequest['db'],
  input: ProductArgs,
): Promise<ProductResult> {
  const rows = (await db.query(
    `select id, name, price from product where id = '${input.id.replaceAll("'", "''")}'`,
  )) as Array<{ id: string; name: string; price: number }>;
  const product = rows[0] ?? { id: input.id, name: 'Missing', price: 0 };
  return { ...product, withinBudget: product.price <= input.max };
}

export const productQuery = query('product', {
  args: s.object({ id: s.string(), max: s.number().int().min(1).default(9999) }),
  instanceKey: (input) => `product:${(input as ProductArgs).id}`,
  load: async (input: ProductArgs, context?: { request: KovoFixtureRequest }) => {
    const db = context?.request.db;
    if (!db) throw new Error('product query requires request.db');
    return readProduct(db, input);
  },
  reads: [productDomain],
});
