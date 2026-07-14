/** @jsxImportSource @kovojs/server */
import { createApp, mutation, route, s, stream } from '@kovojs/server';
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
  csrf: false,
  csrfJustification: 'fixture mutation has no ambient browser authority',
  input: s.object({}),
  handler: () => ({ ok: true }),
  async *stream() {
    const stylesheet = lateCardStylesheets[0];
    const href = typeof stylesheet === 'string' ? stylesheet : stylesheet?.href;
    if (!href) throw new Error('late-card compiler stylesheet metadata is required');
    yield stream.fragment({
      html: await (
        <>
          <link rel="stylesheet" href={href} />
          <LateCard />
        </>
      ),
      mode: 'append',
      target: 'late-card',
    });
  },
});

const homeRoute = route('/', {
  page: () => `<main>
    <h1>Fragment style metadata</h1>
    <section kovo-fragment-target="late-card" kovo-deps="late-card"></section>
    <form method="post" action="/_m/fragment-style-metadata/reveal" enhance data-mutation="fragment-style-metadata/reveal" data-mutation-stream="true">
      <button type="submit">Reveal card</button>
    </form>
  </main>`,
});

export default defineFixture({
  app: createApp({
    mutations: [revealLateCard],
    routes: [homeRoute],
  }),
});
