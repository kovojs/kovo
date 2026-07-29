import { publicScopedKey } from '@kovojs/core';
import { route, s } from '@kovojs/server';

export const receiptRoute = route('/receipts/:receiptId', {
  params: s.object({ receiptId: s.string() }),
  async page({ params, signUrl }) {
    const signed = await signUrl!({
      expiresIn: 5 * 60_000,
      key: publicScopedKey(`receipts/${params.receiptId}.pdf`),
    });
    return <a href={signed.url}>Download receipt</a>;
  },
});
