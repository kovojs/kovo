/** @jsxImportSource @kovojs/server */
import { component, form, FormError } from '@kovojs/core';
import { query } from '@kovojs/server';

interface InvalidEmailFailure {
  code: 'INVALID_EMAIL';
  payload: { field: string };
}

const subscribeForm = form<'a11y-form-error/subscribe', { email: string }, InvalidEmailFailure>(
  'a11y-form-error/subscribe',
);

const newsletterFormQuery = query('newsletterForm', {
  load: () => ({ ready: true }),
  reads: [],
});

export const NewsletterForm = component({
  mutations: { subscribe: subscribeForm },
  queries: { newsletterForm: newsletterFormQuery },
  render: (_queries, _state, { forms }) => {
    const invalid = forms.subscribe.failure?.code === 'INVALID_EMAIL';

    return (
      <form mutation={subscribeForm} enhance>
        <label for="email">Email</label>
        <input
          id="email"
          name="email"
          type="text"
          value={forms.subscribe.submitted?.email ?? ''}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={invalid ? 'email-error' : undefined}
        />
        {invalid ? (
          <span data-error-path="email">
            <FormError
              id="email-error"
              code="INVALID_EMAIL"
              message="Enter a valid email address."
            />
          </span>
        ) : null}
        <button type="submit">Subscribe</button>
      </form>
    );
  },
});
