/** @jsxImportSource @kovojs/server */
// SPEC §9.2 + §12.1: enhanced validation errors retain field/error relationships.
import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

import { NewsletterForm } from './newsletter-form';

export const subscribe = mutation('a11y-form-error/subscribe', {
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  errors: { INVALID_EMAIL: s.object({ field: s.string() }) },
  input: s.object({ email: s.string() }),
  handler: (input, _request, context) => {
    if (!input.email.includes('@')) return context.fail('INVALID_EMAIL', { field: 'email' });
    return { ok: true };
  },
});

const homeRoute = route('/', {
  meta: { title: 'Newsletter error state' },
  page: () => (
    <main>
      <h1>Newsletter</h1>
      <NewsletterForm />
    </main>
  ),
});

export default defineFixture({
  app: createApp({
    mutations: [subscribe],
    routes: [homeRoute],
  }),
});
