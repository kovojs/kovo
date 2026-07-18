/** @jsxImportSource @kovojs/server */
import { guards, route } from '@kovojs/server';
import { referenceSignIn, referenceSignOut, type ReferenceRequest } from './auth.js';

export * from './auth.js';

export const accountRoute = route('/account', {
  guard: guards.authed<ReferenceRequest>(),
  page(_input, request) {
    return (
      <>
        account:{request.session.user.email}
        {renderReferenceLogoutForm(request)}
      </>
    );
  },
});

export const adminRoute = route('/admin', {
  guard: guards.role<ReferenceRequest>('admin'),
  page(_input, request) {
    return (
      <>
        admin:{request.session?.user.id ?? 'anonymous'}
        {renderReferenceLogoutForm(request)}
      </>
    );
  },
});

export function renderReferenceLoginForm(
  _request: ReferenceRequest,
  options: { failure?: 'INVALID_CREDENTIALS'; next?: string } = {},
) {
  // SPEC §6.3/§6.5/§9.1: typed mutation forms are the complete public form path. Kovo
  // emits the mutation-bound CSRF field and canonical Kovo-Idem field together.
  return (
    <form mutation={referenceSignIn}>
      <input type="hidden" name="next" value={safeReferenceFormNext(options.next)} />
      <input name="email" type="email" autocomplete="email" required />
      <input name="password" type="password" autocomplete="current-password" required />
      {options.failure === 'INVALID_CREDENTIALS' ? (
        <output role="alert" data-error-code="INVALID_CREDENTIALS">
          Invalid email or password.
        </output>
      ) : (
        ''
      )}
      <button type="submit">Sign in</button>
    </form>
  );
}

export function renderReferenceLogoutForm(_request: ReferenceRequest) {
  return (
    <form mutation={referenceSignOut}>
      <button type="submit">Sign out</button>
    </form>
  );
}

function safeReferenceFormNext(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/account';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return '/account';
  }
  return value;
}
