/** @jsxImportSource @kovojs/server */
import { FormError } from '@kovojs/core';
import * as style from '@kovojs/style';

import { commerceSignIn, commerceSignOut } from '../domain.js';
import { commerceStyles } from '../styles.js';

export function LoginForm({ next = '/cart' }: { next?: string }): string {
  return (
    <form {...style.attrs(commerceStyles.loginForm)} mutation={commerceSignIn}>
      <input type="hidden" name="next" value={next} />
      <label {...style.attrs(commerceStyles.formLabel)}>
        <span>Email</span>
        <input
          autocomplete="email"
          {...style.attrs(commerceStyles.field)}
          name="email"
          required
          type="email"
        />
      </label>
      <label {...style.attrs(commerceStyles.formLabel)}>
        <span>Password</span>
        <input
          autocomplete="current-password"
          {...style.attrs(commerceStyles.field)}
          name="password"
          required
          type="password"
        />
      </label>
      <FormError
        {...style.attrs(commerceStyles.errorText)}
        code="INVALID_CREDENTIALS"
        message="Invalid email or password."
      />
      <button {...style.attrs(commerceStyles.primaryButton)} type="submit">
        Sign in
      </button>
    </form>
  );
}

export function LogoutForm(): string {
  return (
    <form {...style.attrs(commerceStyles.formInline)} mutation={commerceSignOut}>
      <button {...style.attrs(commerceStyles.productLink)} type="submit">Sign out</button>
    </form>
  );
}
