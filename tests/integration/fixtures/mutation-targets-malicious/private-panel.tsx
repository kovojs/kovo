/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { privateTargetQuery } from './shared';

export const PrivatePanel = component({
  queries: { privateTarget: privateTargetQuery },
  render: ({ privateTarget }: { privateTarget: { id: string } }) => (
    <output data-private-panel>private:{privateTarget.id}:secret</output>
  ),
});
