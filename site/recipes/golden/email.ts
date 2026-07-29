import { s, task } from '@kovojs/server';

export const sendReceiptEmail = task({
  input: s.object({ orderId: s.string(), to: s.string().email() }),
  async run({ orderId, to }, context) {
    const response = await context.fetch('https://api.resend.com/emails', {
      body: JSON.stringify({ orderId, to }),
      method: 'POST',
    });
    if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
    return { delivered: to };
  },
});
