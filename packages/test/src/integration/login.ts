// Authenticated-session helper. Form login through Kovo's progressively-enhanced
// flow carries the server-rendered CSRF token automatically (the hidden `csrf`
// field is part of the rendered form), so a test just supplies credentials. This
// hides the CSRF/session dance that the commerce scratch drive script hand-rolled.
import type { Page } from '@playwright/test';

/** Options for `login`. */
export interface LoginOptions {
  /** Field name → value to fill. Defaults assume `email`/`password`. */
  fields: Record<string, string>;
  /** Route that renders the login form. Default `/login`. */
  loginPath?: string;
  /** Accessible name (or selector) of the submit control. Default a submit button. */
  submit?: string;
  /** Mutation path the submit posts to; awaited to confirm success. Default `/_m/**`. */
  awaitMutation?: string;
}

/**
 * Log in by submitting the rendered login form and waiting for the sign-in
 * mutation to succeed. Establishes the session cookie on the page's context.
 */
export async function login(page: Page, origin: string, options: LoginOptions): Promise<void> {
  const loginPath = options.loginPath ?? '/login';
  await page.goto(new URL(loginPath, origin).href, { waitUntil: 'networkidle' });

  for (const [name, value] of Object.entries(options.fields)) {
    await page.fill(`[name="${name}"]`, value);
  }

  const mutationMatch = options.awaitMutation;
  const submit = options.submit
    ? page.getByRole('button', { name: options.submit })
    : page.locator('button[type="submit"], input[type="submit"]').first();

  await Promise.all([
    page.waitForResponse(
      (response) =>
        (mutationMatch
          ? response.url().includes(mutationMatch)
          : response.url().includes('/_m/')) && response.status() < 400,
      { timeout: 15_000 },
    ),
    submit.click(),
  ]);
}
