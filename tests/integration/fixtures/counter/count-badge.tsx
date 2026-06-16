/** @jsxImportSource @kovojs/server */
// The bound component. Plain authored TSX — the compiler derives
// `data-bind="count.count"` on the bound cell and `kovo-deps`/`kovo-c` on the root.
// `kovo-fragment-target` is authored so the custom-element root has a name the
// inline-loader morph can resolve (SPEC §9.1).
import { component } from '@kovojs/core';

import { countQuery, type CountResult } from './shared';

export const CountBadge = component('count-badge', {
  fragmentTarget: true,
  queries: { count: countQuery },
  render: ({ count }: { count: CountResult }) => (
    <count-badge kovo-fragment-target="count-badge">
      <span>Count:</span> <output>{count.count}</output>
    </count-badge>
  ),
});
