// SPEC §9.2 + §12.1: enhanced validation errors retain field/error relationships.
import { createApp, mutation, publicAccess, route, s, type MutationFail } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';

export const subscribe = mutation('a11y-form-error/subscribe', {
  access: publicAccess('integration fixture mutation a11y-form-error/subscribe has no runtime guard'),
  csrf: false,
  errors: { INVALID_EMAIL: s.object({ field: s.string() }) },
  input: s.object({ email: s.string() }),
  handler: (input, _request, context) => {
    if (!input.email.includes('@')) return context.fail('INVALID_EMAIL', { field: 'email' });
    return { ok: true };
  },
});

function renderForm(failure?: MutationFail): string {
  const invalid = failure?.error.code === 'INVALID_EMAIL';
  const describedBy = invalid ? ' aria-describedby="email-error"' : '';
  const ariaInvalid = invalid ? ' aria-invalid="true"' : '';
  const error = invalid
    ? '<p id="email-error" role="alert" data-error-code="INVALID_EMAIL" data-error-path="email">Enter a valid email address.</p>'
    : '';
  return `<form kovo-fragment-target="newsletter-form" method="post" action="/_m/a11y-form-error/subscribe" enhance data-mutation="a11y-form-error/subscribe">
    <label for="email">Email</label>
    <input id="email" name="email" type="text" value=""${ariaInvalid}${describedBy} />
    ${error}
    <button type="submit">Subscribe</button>
  </form>`;
}

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  meta: { title: 'Newsletter error state' },
  page: () => `<main>
    <h1>Newsletter</h1>
    ${renderForm()}
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [subscribe],
    routes: [homeRoute],
    mutationResponses: {
      [subscribe.key]: () => {
        return {
          failureTarget: 'newsletter-form',
          renderFailureFragment: renderForm,
        };
      },
    },
  }),
});
