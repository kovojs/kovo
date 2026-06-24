import { createApp, mutation, publicAccess, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/internal/integration/define';
import {
  kovoFixtureStylesheetManifest,
  kovoFixtureStylesheetsForTargets,
} from 'virtual:kovo-fixture-css-manifest';

import { LateCard } from './late-card';

const lateCardAsset = kovoFixtureStylesheetManifest().find(
  (asset) => asset.componentName === 'late-card',
);
const lateCardStylesheets =
  lateCardAsset && lateCardAsset.fragmentTargets.length > 0
    ? kovoFixtureStylesheetsForTargets(lateCardAsset.fragmentTargets)
    : lateCardAsset
      ? [lateCardAsset]
      : [];

export const revealLateCard = mutation('fragment-style-metadata/reveal', {
  access: publicAccess(
    'integration fixture mutation fragment-style-metadata/reveal has no runtime guard',
  ),
  csrf: false,
  input: s.object({}),
  handler: () => ({ ok: true }),
});

const homeRoute = route('/', {
  access: publicAccess('integration fixture route / has no runtime guard'),
  page: () => `<main>
    <h1>Fragment style metadata</h1>
    <section kovo-fragment-target="late-card" kovo-deps="late-card"></section>
    <form method="post" action="/_m/fragment-style-metadata/reveal" enhance data-mutation="fragment-style-metadata/reveal">
      <button type="submit">Reveal card</button>
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [revealLateCard],
    routes: [homeRoute],
    mutationResponses: {
      [revealLateCard.key]: () => {
        return {
          fragmentRenderers: [
            {
              mode: 'append',
              render: () => LateCard.definition.render() as string,
              stylesheets: lateCardStylesheets,
              target: 'late-card',
            },
          ],
        };
      },
    },
  }),
});
