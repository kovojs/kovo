import { createApp, mutation, route, s } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';
import {
  kovoFixtureStylesheetManifest,
  kovoFixtureStylesheetsForTargets,
} from 'virtual:kovo-fixture-css-manifest';

import { LateCard } from './late-card';

const lateCardTarget =
  kovoFixtureStylesheetManifest().find((asset) => asset.componentName === 'late-card')
    ?.fragmentTargets[0] ?? 'late-card/late-card';

export const revealLateCard = mutation('fragment-style-metadata/reveal', {
  csrf: false,
  input: s.object({}),
  handler: () => ({ ok: true }),
});

const homeRoute = route('/', {
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
    mutationResponse: ({ key }) => {
      if (key !== revealLateCard.key) return undefined;
      return {
        fragmentRenderers: [
          {
            mode: 'append',
            render: () => LateCard.definition.render({}, null) as string,
            stylesheets: kovoFixtureStylesheetsForTargets([lateCardTarget]),
            target: 'late-card',
          },
        ],
      };
    },
  }),
});
