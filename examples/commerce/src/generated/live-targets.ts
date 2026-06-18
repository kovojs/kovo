// @kovojs-ir - generated live-target registry for Commerce components (SPEC.md section 9.1). Do not edit; regenerate with `pnpm run emit-components`.
import {
  collectGeneratedLiveTargetRenderers,
  componentLiveTargetRenderer,
  type LiveTargetRenderContext,
  type LiveTargetRenderer,
} from '@kovojs/server/internal/wire';
import { escapeHtml } from '@kovojs/server/internal/html';

import type { CommerceRequest } from '../app.js';
import * as cartBadgeModule from './cart-badge.js';
import * as orderHistoryModule from './order-history.js';
import { ProductGrid } from './product-grid.js';

const productGridRenderer = componentLiveTargetRenderer({
  component: ProductGrid,
  componentId: 'components/product-grid/product-grid',
  slots(context: LiveTargetRenderContext<CommerceRequest>) {
    return {
      forms: { addToCart: { failure: null } },
      request: context.request,
    };
  },
}) satisfies LiveTargetRenderer<CommerceRequest>;

const productGridLiveTargetRenderer: LiveTargetRenderer<CommerceRequest> = {
  ...productGridRenderer,
  errorBoundary: {
    render(error) {
      return `<section role="alert" class="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">Product grid failed: ${escapeHtml((error as Error).message)}</section>`;
    },
  },
  render(context) {
    const productGridError = context.request.renderFaults?.productGrid?.();
    if (productGridError) throw productGridError;
    return productGridRenderer.render(context);
  },
};

export const liveTargetRenderers: readonly LiveTargetRenderer<CommerceRequest>[] = [
  ...collectGeneratedLiveTargetRenderers<CommerceRequest>([
    cartBadgeModule,
    orderHistoryModule,
  ]),
  productGridLiveTargetRenderer,
];
