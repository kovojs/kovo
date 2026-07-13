import { domain, query, s, type QueryLoadContext } from '@kovojs/server';
import type {
  KovoFixtureReaderRequest,
  KovoFixtureRequest,
} from '@kovojs/test/internal/integration/define';

export interface ProductPanelResult extends Record<string, unknown> {
  id: string;
  label: string;
  stock: number;
}

type FixtureQueryRequest = KovoFixtureReaderRequest | KovoFixtureRequest;

export const product = domain('product');

export const productQuery = query('product', {
  args: s.object({ label: s.string(), productId: s.string() }),
  instanceKey: (input) => `product:${input.productId}`,
  reads: [product],
  async load(
    input: { label: string; productId: string },
    context?: QueryLoadContext<FixtureQueryRequest>,
  ): Promise<ProductPanelResult> {
    const db = context?.request?.db;
    if (!db) throw new Error('product query requires request.db');
    const statement = {
      text: 'select id, name as label, stock from products where id = $1',
      values: [input.productId],
    };
    if ('rawRead' in db) {
      const rows = await db.rawRead<ProductPanelResult>(statement, { reads: ['products'] });
      return rows[0] ?? { id: input.productId, label: input.label, stock: 0 };
    }
    const rows = await db.query<ProductPanelResult>(statement);
    return rows[0] ?? { id: input.productId, label: input.label, stock: 0 };
  },
});
