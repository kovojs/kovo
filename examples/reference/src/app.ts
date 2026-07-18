import { csrfField, guards, mutationFormAttributes, route } from '@kovojs/server';
import type { MutationFormDefinition } from '@kovojs/server';
import { trustedHtml } from '@kovojs/browser';
import {
  referenceAuthCsrf,
  referenceSignIn,
  referenceSignOut,
  type ReferenceRequest,
} from './auth.js';

export * from './auth.js';

export const accountRoute = route('/account', {
  guard: guards.authed<ReferenceRequest>(),
  page(_input, request) {
    return trustedHtml(
      `account:${request.session.user.email}${renderReferenceLogoutForm(request)}`,
    );
  },
});

export const adminRoute = route('/admin', {
  guard: guards.role<ReferenceRequest>('admin'),
  page(_input, request) {
    return trustedHtml(
      `admin:${request.session?.user.id ?? 'anonymous'}${renderReferenceLogoutForm(request)}`,
    );
  },
});

export function renderReferenceLoginForm(
  request: ReferenceRequest,
  options: { failure?: 'INVALID_CREDENTIALS'; next?: string } = {},
): string {
  const error =
    options.failure === 'INVALID_CREDENTIALS'
      ? '<output role="alert" data-error-code="INVALID_CREDENTIALS">Invalid email or password.</output>'
      : '';

  // SPEC §6.5/§9.1 (audit trap #3): bind the CSRF token to the targeted mutation so its audience
  // matches the `{ audience: definition.key }` dispatch validates against. Without `mutation`, the
  // hand-rolled form would mint a `field:csrf`-audience token and every sign-in would 422.
  return `<form ${renderReferenceMutationFormAttributes(referenceSignIn)}>${csrfField(request, {
    ...referenceAuthCsrf,
    mutation: referenceSignIn,
  })}<input type="hidden" name="next" value="${escapeAttribute(options.next ?? '/account')}"><input name="email" type="email" autocomplete="email" required><input name="password" type="password" autocomplete="current-password" required>${error}<button type="submit">Sign in</button></form>`;
}

export function renderReferenceLogoutForm(request: ReferenceRequest): string {
  // SPEC §6.5/§9.1 (audit trap #3): bind the CSRF token to the sign-out mutation, see above.
  return `<form ${renderReferenceMutationFormAttributes(referenceSignOut)}>${csrfField(request, {
    ...referenceAuthCsrf,
    mutation: referenceSignOut,
  })}<button type="submit">Sign out</button></form>`;
}

function renderReferenceMutationFormAttributes<Request>(
  mutation: MutationFormDefinition<string, Request>,
): string {
  const attrs = mutationFormAttributes(mutation);
  return [
    `method="${attrs.method}"`,
    `action="${escapeAttribute(attrs.action)}"`,
    attrs.enhance ? 'enhance' : '',
    `data-mutation="${escapeAttribute(attrs['data-mutation'])}"`,
  ]
    .filter(Boolean)
    .join(' ');
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
