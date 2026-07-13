/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { panelQuery, type PanelResult } from './shared';

export const Panel = component({
  queries: { panel: panelQuery },
  render: ({ panel }: { panel: PanelResult }) => (
    <section>
      <details data-testid="panel-details">
        <summary>More</summary>
        <p>Body</p>
      </details>
      <output data-testid="count">{panel.value}</output>
    </section>
  ),
});
