import { guards, route } from '@kovojs/server';

interface AccountRequest {
  session?: { id: string; user: { email: string; id: string } } | null;
}

export const accountRoute = route('/account', {
  guard: guards.authed<AccountRequest>(),
  page(_input, request) {
    return <main>Signed in as {request.session.user.email}</main>;
  },
});
