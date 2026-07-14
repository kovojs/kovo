import { domain, query, s, type QueryLoadContext } from '@kovojs/server';
import type { KovoFixtureRequest } from '@kovojs/test/internal/integration/define';

export interface ProductArgs {
  id: string;
}

export interface ProductResult {
  [key: string]: unknown;
  id: string;
  name: string;
  stock: number;
}

export const productDomain = domain('product');

export async function readProduct(
  db: KovoFixtureRequest['db'],
  id: string,
): Promise<ProductResult> {
  const rows = await db.query<ProductResult>({
    text: 'select id, name, stock from product where id = $1',
    values: [id],
  });
  return rows[0] ?? { id, name: 'Missing', stock: 0 };
}

export const productQuery = query('product', {
  args: s.object({ id: s.string() }),
  instanceKey: (input) => `product:${(input as ProductArgs).id}`,
  load: (input: ProductArgs, context?: QueryLoadContext<KovoFixtureRequest>) => {
    const db = context?.request?.db;
    if (!db) throw new Error('product query requires request.db');
    return readProduct(db, input.id);
  },
  reads: [productDomain],
});
