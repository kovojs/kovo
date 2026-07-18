/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { bump } from './app';
import { panelQuery, type PanelResult } from './shared';

const bumpForm = form<'morph-native-state/bump', Record<string, never>>('morph-native-state/bump');

export const Panel = component({
  mutations: { bump: bumpForm },
  queries: { panel: panelQuery },
  render: ({ panel }: { panel: PanelResult }) => (
    <section>
      <details data-testid="panel-details">
        <summary>More</summary>
        <p>Body</p>
      </details>
      <output data-testid="count">{panel.value}</output>
      <form mutation={bump} enhance>
        <button type="submit">Bump</button>
      </form>
    </section>
  ),
});
