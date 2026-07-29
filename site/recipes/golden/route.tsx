import { defineKovo, s } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

const app = defineKovo({
  appId: 'ba3fd9ff-cf8e-4fea-89ea-188f88e8c915',
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

export const contactRoute = app.route('/contacts/:contactId', {
  access: app.publicAccess('the public directory is intentionally visible'),
  params: s.object({ contactId: s.string() }),
  page({ params }) {
    return <main>Contact {params.contactId}</main>;
  },
});

export const routeRecipeApp = app.assemble({ routes: [contactRoute] });
