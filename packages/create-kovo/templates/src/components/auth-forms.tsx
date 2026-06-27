/** @jsxImportSource @kovojs/server */
import { FormError } from '@kovojs/core';
import { Button } from '@kovojs/ui/button';
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
    boxShadow: '0 16px 40px rgb(15 23 42 / 0.08)',
    display: 'grid',
    gap: 18,
    padding: 30,
    width: '100%',
    '@media (max-width: 640px)': { padding: 20 },
  },
  intro: { display: 'grid', gap: 8 },
  eyebrow: {
    color: style.tokens.sys.color.primary,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.3,
    margin: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: style.tokens.sys.color.onSurface,
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.2,
    margin: 0,
  },
  helper: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
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
    boxSizing: 'border-box',
    color: style.tokens.sys.color.onSurface,
    fontSize: 14,
    minHeight: 38,
    paddingBlock: 7,
    paddingInline: 12,
    width: '100%',
    ':focus-visible': {
      outlineColor: style.tokens.sys.color.primary,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
  signOutForm: { margin: 0 },
  signOutButton: {
    fontSize: 14,
  },
  submit: { width: '100%' },
  error: { color: style.tokens.sys.color.error, fontSize: 14 },
});

export function LoginForm({ next = '/' }: { next?: string } = {}): string {
  return (
    <form style={styles.form} mutation={appSignIn}>
      <div style={styles.intro}>
        <p style={styles.eyebrow}>Kovo Starter</p>
        <h1 style={styles.title}>Sign in</h1>
        <p style={styles.helper}>Welcome back to your contact book.</p>
      </div>
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
      {Button.definition.render({
        children: 'Sign in',
        style: styles.submit,
        type: 'submit',
        variant: 'primary',
      })}
    </form>
  );
}

export function SignOutForm(): string {
  return (
    <form style={styles.signOutForm} mutation={appSignOut}>
      {Button.definition.render({
        children: 'Sign out',
        size: 'sm',
        style: styles.signOutButton,
        type: 'submit',
        variant: 'outline',
      })}
    </form>
  );
}
