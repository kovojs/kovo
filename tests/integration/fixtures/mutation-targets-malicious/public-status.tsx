/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { publicTargetQuery } from './shared';

export const PublicStatus = component({
  queries: { publicTarget: publicTargetQuery },
  render: ({ publicTarget }: { publicTarget: { count: number } }) => (
    <output data-public-status>public:{publicTarget.count}</output>
  ),
});
