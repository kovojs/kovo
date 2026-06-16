// SPEC §9.2 + §12.1: enhanced validation errors retain field/error relationships.
import { createApp, mutation, route, s, type MutationFail } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

export const subscribe = mutation('a11y-form-error/subscribe', {
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
  page: () => `<main>
    <h1>Newsletter</h1>
    ${renderForm()}
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [subscribe],
    routes: [homeRoute],
    mutationResponse: ({ key }) => {
      if (key !== subscribe.key) return undefined;
      return {
        failureTarget: 'newsletter-form',
        renderFailureFragment: renderForm,
      };
    },
  }),
});
