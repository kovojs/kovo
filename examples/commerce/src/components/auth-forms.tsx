/** @jsxImportSource @kovojs/server */
import { FormError } from '@kovojs/core';

import { commerceSignIn, commerceSignOut } from '../app.js';

export function LoginForm({ next = '/cart' }: { next?: string }): string {
  return (
    <form class="grid gap-4 rounded border border-slate-200 bg-white p-6" mutation={commerceSignIn}>
      <input type="hidden" name="next" value={next} />
      <label class="grid gap-1 text-sm font-medium text-slate-700">
        <span>Email</span>
        <input
          autocomplete="email"
          class="rounded border border-slate-300 px-3 py-2"
          name="email"
          required
          type="email"
        />
      </label>
      <label class="grid gap-1 text-sm font-medium text-slate-700">
        <span>Password</span>
        <input
          autocomplete="current-password"
          class="rounded border border-slate-300 px-3 py-2"
          name="password"
          required
          type="password"
        />
      </label>
      <FormError
        class="text-sm text-red-700"
        code="INVALID_CREDENTIALS"
        message="Invalid email or password."
      />
      <button class="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" type="submit">
        Sign in
      </button>
    </form>
  );
}

export function LogoutForm(): string {
  return (
    <form class="inline" mutation={commerceSignOut}>
      <button class="text-sm font-medium text-slate-900" type="submit">
        Sign out
      </button>
    </form>
  );
}
