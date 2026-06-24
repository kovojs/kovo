import {
  registerGeneratedMutationTouchRegistry,
  registerGeneratedQueryReadRegistry,
} from '../packages/server/src/internal/execution.js';
import {
  componentLiveTargetRenderer,
  registerGeneratedLiveTargetRenderer,
} from '../packages/server/src/internal/wire.js';

import { CartBadge } from '../examples/commerce/src/components/cart-badge.js';
import { OrderHistory } from '../examples/commerce/src/components/order-history.js';
import { ProductGrid } from '../examples/commerce/src/components/product-grid.js';

const setupKey = Symbol.for('kovo.exampleGeneratedGraphSetup');
const setupState = globalThis as typeof globalThis & { [setupKey]?: true };

if (!setupState[setupKey]) {
  setupState[setupKey] = true;

  registerGeneratedQueryReadRegistry([
    { query: 'cart', domains: ['cart'] },
    { query: 'productGrid', domains: ['product'] },
    { query: 'orderHistory', domains: ['order'] },

    { query: 'contactList', domains: ['contact'] },
    { query: 'contactDealCount', domains: ['deal'] },
    { query: 'dealList', domains: ['deal'] },
    { query: 'openDeals', domains: ['deal'] },
    { query: 'pipelineByStage', domains: ['deal'] },
    { query: 'activityList', domains: ['activity'] },

    { query: 'questionList', domains: ['question'] },
    { query: 'answerList', domains: ['answer'] },
    { query: 'questionDetail', domains: ['question'] },
    { query: 'questionAnswers', domains: ['answer'] },
    { query: 'questionScore', domains: ['vote', 'question'] },
  ]);

  registerGeneratedMutationTouchRegistry({
    'cart/add': [
      { domain: 'cart', keys: null, via: 'cart_items' },
      { domain: 'order', keys: null, via: 'orders' },
      { domain: 'product', keys: 'arg:productId', via: 'products' },
    ],
    addContact: [{ domain: 'contact', keys: null, via: 'contacts' }],
    createDeal: [
      { domain: 'deal', keys: null, via: 'deals' },
      { domain: 'contact', keys: null, via: 'contacts' },
    ],
    moveDeal: [{ domain: 'deal', keys: null, via: 'deals' }],
    closeDeal: [{ domain: 'deal', keys: null, via: 'deals' }],
    postQuestion: [{ domain: 'question', keys: null, via: 'questions' }],
    postAnswer: [
      { domain: 'answer', keys: null, via: 'answers' },
      { domain: 'question', keys: null, via: 'questions' },
    ],
    voteUp: [
      { domain: 'vote', keys: null, via: 'votes' },
      { domain: 'question', keys: null, via: 'questions' },
    ],
  });

  registerCommerceLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: CartBadge,
      componentId: 'components/cart-badge/cart-badge',
    }),
  );
  registerCommerceLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: ProductGrid,
      componentId: 'components/product-grid/product-grid',
    }),
  );
  registerCommerceLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: OrderHistory,
      componentId: 'components/order-history/order-history',
    }),
  );
}

function registerCommerceLiveTargetRenderer(
  renderer: Parameters<typeof registerGeneratedLiveTargetRenderer>[0],
) {
  try {
    registerGeneratedLiveTargetRenderer(renderer);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Duplicate generated live target renderer for component ')
    ) {
      return;
    }
    throw error;
  }
}
