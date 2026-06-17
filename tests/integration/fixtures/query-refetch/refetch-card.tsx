/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { refetchQuery, type RefetchResult } from './shared';

export const RefetchCard = component({
  fragmentTarget: true,
  queries: { refetch: refetchQuery },
  render: ({ refetch }: { refetch: RefetchResult }) => (
    <refetch-card kovo-fragment-target="refetch-card">
      <output>{refetch.message}</output>
    </refetch-card>
  ),
});
