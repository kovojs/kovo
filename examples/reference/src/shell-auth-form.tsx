/** @jsxImportSource @kovojs/server */
import { referenceSignIn } from './app.js';

export function ReferenceShellLoginForm({
  failure,
  next = '/account',
}: {
  failure?: 'INVALID_CREDENTIALS';
  next?: string;
} = {}): string {
  return (
    <form mutation={referenceSignIn}>
      <input type="hidden" name="next" value={next} />
      <input name="email" type="email" autocomplete="email" required />
      <input name="password" type="password" autocomplete="current-password" required />
      {failure === 'INVALID_CREDENTIALS' ? (
        <output role="alert" data-error-code="INVALID_CREDENTIALS">
          Invalid email or password.
        </output>
      ) : null}
      <button type="submit">Sign in</button>
    </form>
  );
}
