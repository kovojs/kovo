import { csrfToken } from '@kovojs/server/internal/csrf';
import type { CsrfOptions } from '@kovojs/server/security';

/**
 * Mint a mutation-bound CSRF token for a synthetic request-level test.
 *
 * Prefer rendering the real form and reading its hidden field for an end-to-end assertion. This
 * helper is for focused request tests that intentionally bypass form rendering (SPEC §§9.1, 12).
 *
 * @param request - Synthetic request fixture used by the app's CSRF policy.
 * @param options - The same CSRF options configured by the app.
 * @param context - Exact mutation handle or derived mutation key.
 * @returns A token accepted only for that mutation audience.
 */
export function mutationCsrfTokenForTesting<Request>(
  request: Request,
  options: CsrfOptions<Request>,
  context: { mutation: string | { readonly key: string } },
): string {
  return csrfToken(request, options, context);
}
