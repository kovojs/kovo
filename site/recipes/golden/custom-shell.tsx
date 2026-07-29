import { BodyAttrs, BodyStart, defineKovo, Document, Head, Meta } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

const appDocument = Document({
  lang: 'en',
  title: 'Kovo contacts',
  children: [
    Head({ children: Meta({ content: 'width=device-width, initial-scale=1', name: 'viewport' }) }),
    BodyAttrs({ class: 'app-shell' }),
    BodyStart({ children: <a href="#main">Skip to content</a> }),
  ],
});

const app = defineKovo({
  appId: '7f55ad66-6ec7-4bd0-995c-34747b7a09dd',
  document: appDocument,
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

const homeRoute = app.route('/', {
  access: app.publicAccess('the landing page is intentionally public'),
  page: () => <main id="main">Contacts</main>,
});

export const customShellApp = app.assemble({ routes: [homeRoute] });
