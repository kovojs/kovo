/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { trustedHtml } from '@kovojs/server';

import { islandQuery, type IslandResult } from './shared';

export const PatchZone = component({
  queries: { island: islandQuery },
  render: ({ island }: { island: IslandResult }) => (
    <section kovo-key="patch-zone">
      {island.installed ? (
        trustedHtml(
          '<patched-island kovo-c="patched-island" kovo-key="patched-island" kovo-state=\'{"count":0}\'><button type="button" on:click="/client.ts#activate" data-p-label="patched">Activate patched island</button><output data-island-output data-bind="state.count">0</output></patched-island>',
        )
      ) : (
        <p data-empty-zone>No island yet</p>
      )}
    </section>
  ),
});
