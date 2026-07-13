/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import { trustedHtml } from '@kovojs/server';

import { parentQuery, type ParentResult } from './shared';

export const ParentPanel = component({
  queries: { parent: parentQuery },
  render: ({ parent }: { parent: ParentResult }) => (
    <section id="parent-panel" kovo-key="parent-panel">
      <p>
        Parent version <output>{parent.version}</output>
      </p>
      {trustedHtml(
        '<nested-counter kovo-c="nested-counter" kovo-key="nested-counter" kovo-state=\'{"count":0}\'><button type="button" on:click="/client.ts#incrementNested">Nested count <span data-bind="state.count">0</span></button></nested-counter>',
      )}
    </section>
  ),
});
