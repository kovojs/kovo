import { component, FieldError, FormError } from '@kovojs/core';
import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '425ca355-d01e-434a-86fc-3697ca21c0b7',
  csrf: {
    anonymousCookie: false,
    secret: 'golden-form-error-csrf-secret-at-least-32-bytes',
    sessionId: () => undefined,
  },
});

export const updateProfile = app.mutation({
  access: app.publicAccess('the demo profile form is intentionally public'),
  errors: { EMAIL_TAKEN: s.object({ email: s.string() }) },
  input: s.object({ email: s.string().email(), name: s.string() }),
  handler(input, _request, context) {
    if (input.email === 'taken@example.test') {
      return context.fail('EMAIL_TAKEN', { email: input.email });
    }
    return { updated: input.email };
  },
});

export const ProfileForm = component({
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
