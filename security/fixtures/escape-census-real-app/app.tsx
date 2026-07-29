/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { defineKovo, s } from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';

const app = defineKovo({
  appId: '60b4fd00-2f6c-4cbc-b5bf-66e204ca3d62',
});
const allow = app.rateLimit({ max: 100, per: 'global' });

export const adminQuery = app.query({
  access: [allow],
  args: s.object({ id: s.string() }),
  load(input: { id: string }) {
    return { id: input.id };
  },
});

export const adminMutation = app.mutation({
  access: [allow],
  csrf: false,
  csrfJustification: 'non-browser Metric E representative app',
  input: s.object({ id: s.string().allowControlChars() }),
  handler() {
    return { ok: true };
  },
});

// This intentionally retains three declared escape doors so the Metric E baseline is non-vacuous.
// The census remains a measurement, not a safety proof (SPEC.md §2 and §5.2).
export const AdminPage = component({
  queries: { adminOrders: adminQuery },
  render({ adminOrders }: { adminOrders: { id: string } }) {
    return (
      <main data-order-id={adminOrders.id}>
        {trustedHtml('<strong>Admin</strong>', { reason: 'Metric E representative app' })}
      </main>
    );
  },
});

export const adminRoute = app.route('/admin', {
  access: [allow],
  page: () => <AdminPage />,
});

export default app.assemble({
  mutations: [adminMutation],
  queries: [adminQuery],
  routes: [adminRoute],
});
