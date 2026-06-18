// @kovojs-ir - generated live-target registry for Commerce components (SPEC.md section 9.1). Do not edit; regenerate with `pnpm run emit-components`.
import {
  collectGeneratedLiveTargetRenderers,
  type LiveTargetRenderer,
} from '@kovojs/server/internal/wire';

import type { CommerceRequest } from '../domain.js';
import * as cartBadgeModule from './cart-badge.js';
import * as orderHistoryModule from './order-history.js';
import * as productGridModule from './product-grid.js';

export const liveTargetRenderers: readonly LiveTargetRenderer<CommerceRequest>[] = [
  ...collectGeneratedLiveTargetRenderers<CommerceRequest>([
    cartBadgeModule,
    orderHistoryModule,
    productGridModule,
  ]),
];
