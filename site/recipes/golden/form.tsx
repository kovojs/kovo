import { component, FieldError, FormError } from '@kovojs/core';
import { mutation, publicAccess, s, type CsrfOptions } from '@kovojs/server';

export function defineProfileForm(csrf: CsrfOptions<unknown>) {
  const updateProfile = mutation({
    access: publicAccess('the demo profile form is intentionally public'),
    csrf,
    errors: { EMAIL_TAKEN: s.object({ email: s.string() }) },
    input: s.object({ email: s.string().email(), name: s.string() }),
    handler: (input) => ({ updated: input.email }),
  });

  return component({
    mutations: { updateProfile },
    render(_props, _state, { forms }) {
      return (
        <form mutation={updateProfile}>
          <input name="name" value={forms.updateProfile.submitted?.name ?? ''} />
          <input name="email" type="email" />
          <FieldError name="email" />
          <FormError code="EMAIL_TAKEN">That email is already registered.</FormError>
          <button type="submit">Save profile</button>
        </form>
      );
    },
  });
}
