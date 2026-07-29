import { defineKovo } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

const app = defineKovo({
  appId: '2afc9fe5-730d-486a-89d8-1f4c166103a4',
  auth: () => ({
    id: 'session-1',
    user: { email: 'ada@example.test', id: 'user-1' },
  }),
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

export const accountRoute = app.route('/account', {
  access: [app.authenticated],
  page(_input, request) {
    return <main>Signed in as {request.session.user.email}</main>;
  },
});

export const authRecipeApp = app.assemble({ routes: [accountRoute] });
