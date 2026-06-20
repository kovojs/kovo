/** @jsxImportSource @kovojs/server */
import { FormError } from '@kovojs/core';
import * as style from '@kovojs/style';

import { appSignIn, appSignOut } from '../auth.js';

// Sign-in / sign-out are ordinary Kovo mutation forms (SPEC.md §6.3): no-JS
// browsers POST to /_m/auth/* and follow the redirect; `enhance` upgrades the
// same form in place. The compiler stamps the CSRF token into both.

const styles = style.create({
  form: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 16,
    padding: 24,
  },
  label: {
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    fontSize: 12,
    fontWeight: 500,
    gap: 4,
  },
  input: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outline,
    borderRadius: style.tokens.sys.shape.cornerSmall,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.sys.color.onSurface,
    paddingBlock: 6,
    paddingInline: 10,
  },
  primary: {
    backgroundColor: style.tokens.sys.color.primary,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    color: style.tokens.sys.color.onPrimary,
    fontSize: 14,
    fontWeight: 500,
    paddingBlock: 8,
    paddingInline: 16,
  },
  text: { color: style.tokens.sys.color.onPrimary, fontSize: 14, fontWeight: 500 },
  error: { color: style.tokens.sys.color.error, fontSize: 14 },
});

export function LoginForm({ next = '/' }: { next?: string } = {}): string {
  return (
    <form style={styles.form} mutation={appSignIn}>
      <input type="hidden" name="next" value={next} />
      <label style={styles.label}>
        <span>Email</span>
        <input style={styles.input} name="email" type="email" autocomplete="email" required />
      </label>
      <label style={styles.label}>
        <span>Password</span>
        <input
          style={styles.input}
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <FormError
        style={styles.error}
        code="INVALID_CREDENTIALS"
        message="Invalid email or password."
      />
      <button style={styles.primary} type="submit">
        Sign in
      </button>
    </form>
  );
}

export function SignOutForm(): string {
  return (
    <form mutation={appSignOut}>
      <button style={styles.text} type="submit">
        Sign out
      </button>
    </form>
  );
}
