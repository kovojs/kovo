/** @jsxImportSource @kovojs/server */
import { FormError } from '@kovojs/core';

import { signIn as referenceSignIn } from './auth.js';

export function ReferenceShellLoginForm({
  next = '/account',
}: {
  next?: string;
} = {}): string {
  return (
    <form mutation={referenceSignIn}>
      <input type="hidden" name="next" value={next} />
      <input name="email" type="email" autocomplete="email" required />
      <input name="password" type="password" autocomplete="current-password" required />
      {/* SPEC §9.1: the framework re-renders the submitted source-route form with typed failure
          state; the app does not register an app-level mutation-response body override. */}
      <FormError code="INVALID_CREDENTIALS" message="Invalid email or password." />
      <FormError code="CSRF" message="Request verification failed. Please retry." />
      <button type="submit">Sign in</button>
    </form>
  );
}
