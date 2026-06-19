/** @jsxImportSource @kovojs/server */
import { FormError } from '@kovojs/core';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { commerceSignIn, commerceSignOut } from '../domain.js';

const authFormStyles = style.create(
  {
    errorText: {
      color: tokens.sys.color.error,
      fontSize: 14,
    },
    field: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outline,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      boxSizing: 'border-box',
      color: tokens.sys.color.onSurface,
      paddingBlock: 6,
      paddingInline: 10,
    },
    formInline: {
      display: 'inline',
    },
    formLabel: {
      color: tokens.sys.color.onSurfaceVariant,
      display: 'grid',
      fontSize: 12,
      fontWeight: 500,
      gap: 4,
    },
    loginForm: {
      backgroundColor: tokens.sys.color.surfaceContainerLowest,
      borderColor: tokens.sys.color.outlineVariant,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      gap: 16,
      padding: 24,
    },
    primaryButton: {
      backgroundColor: tokens.sys.color.primary,
      borderColor: tokens.sys.color.primary,
      borderRadius: tokens.sys.shape.cornerMedium,
      borderStyle: 'solid',
      borderWidth: 1,
      color: tokens.sys.color.onPrimary,
      fontSize: 14,
      fontWeight: 500,
      paddingBlock: 8,
      paddingInline: 16,
    },
    textButton: {
      color: tokens.sys.color.primary,
      fontSize: 14,
      fontWeight: 500,
      textDecoration: 'none',
    },
  },
  { namespace: 'commerce-auth', source: 'examples/commerce/src/components/auth-forms.tsx' },
);

export const authFormStyleCss = style.emitAtomicCss(
  Object.values(authFormStyles).flatMap((entry) => entry.__rules ?? []),
);

export function LoginForm({ next = '/cart' }: { next?: string }): string {
  return (
    <form style={authFormStyles.loginForm} mutation={commerceSignIn}>
      <input type="hidden" name="next" value={next} />
      <label style={authFormStyles.formLabel}>
        <span>Email</span>
        <input
          autocomplete="email"
          style={authFormStyles.field}
          name="email"
          required
          type="email"
        />
      </label>
      <label style={authFormStyles.formLabel}>
        <span>Password</span>
        <input
          autocomplete="current-password"
          style={authFormStyles.field}
          name="password"
          required
          type="password"
        />
      </label>
      <FormError
        style={authFormStyles.errorText}
        code="INVALID_CREDENTIALS"
        message="Invalid email or password."
      />
      <button style={authFormStyles.primaryButton} type="submit">
        Sign in
      </button>
    </form>
  );
}

export function LogoutForm(): string {
  return (
    <form style={authFormStyles.formInline} mutation={commerceSignOut}>
      <button style={authFormStyles.textButton} type="submit">
        Sign out
      </button>
    </form>
  );
}
