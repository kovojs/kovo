import { runWithExampleGeneratedGraphs } from '../example-generated-graphs.setup.js';
import { componentLiveTargetRenderer } from '../../packages/server/src/internal/wire.js';

import { CartBadge } from '../../examples/commerce/src/components/cart-badge.js';
import { OrderHistory } from '../../examples/commerce/src/components/order-history.js';
import { ProductGrid } from '../../examples/commerce/src/components/product-grid.js';

const commerceLiveTargetRenderers = [
  componentLiveTargetRenderer({
    component: CartBadge,
    componentId: 'components/cart-badge/cart-badge',
  }),
  componentLiveTargetRenderer({
    component: ProductGrid,
    componentId: 'components/product-grid/product-grid',
  }),
  componentLiveTargetRenderer({
    component: OrderHistory,
    componentId: 'components/order-history/order-history',
  }),
];

/** Vitest-only renderer inventory for the commerce app's exact generated graph. */
export function runWithCommerceGeneratedGraphs<Value>(load: () => Value): Value {
  return runWithExampleGeneratedGraphs(commerceLiveTargetRenderers, load);
}
