import { defineKovo } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';
import { createKovoTestHarness } from '@kovojs/test/harness';

const app = defineKovo({
  appId: '93378e19-6823-4e3b-ab23-400af6bd4748',
  egress: { allowInternal: [] },
  renderRoute: renderRouteHtml,
});

const healthRoute = app.route('/health', {
  access: app.publicAccess('the health page is intentionally visible'),
  page: () => <main>ok</main>,
});

export const harnessRecipeApp = app.assemble({ routes: [healthRoute] });

export function createContactHarness(artifact: string | URL, projectRoot: string | URL) {
  return createKovoTestHarness(harnessRecipeApp, { artifact, projectRoot });
}
