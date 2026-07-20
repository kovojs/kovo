import { createApp, guards, mutation, query, route, s, trustedHtml } from '@kovojs/server';

const allow = guards.rateLimit({ max: 100, per: 'global' });

const adminQuery = query('adminOrders', {
  args: s.object({ id: s.string() }),
  guard: allow,
  load(input) {
    return { id: input.id };
  },
});

const adminMutation = mutation('admin/update', {
  csrf: false,
  csrfJustification: 'non-browser Metric E representative app',
  guard: allow,
  input: s.object({ id: s.string().allowControlChars() }),
  handler() {
    return { ok: true };
  },
});

// This intentionally retains three declared escape doors so the Metric E baseline is non-vacuous.
// The census remains a measurement, not a safety proof (SPEC.md §2 and §5.3).
export default createApp({
  mutations: [adminMutation],
  queries: [adminQuery],
  routes: [
    route('/admin', {
      guard: allow,
      page: () => trustedHtml('<main>Admin</main>', 'Metric E representative app'),
    }),
  ],
});
