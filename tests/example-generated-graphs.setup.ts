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
    { query: 'queries/cart-query', domains: ['cart'] },
    { query: 'queries/product-grid-query', domains: ['product'] },
    { query: 'queries/order-history-query', domains: ['order'] },

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
    'domain/add-to-cart': [
      { domain: 'cart', keys: null, via: 'cart_items' },
      { domain: 'order', keys: null, via: 'orders' },
      { domain: 'product', keys: 'arg:productId', via: 'products' },
    ],
    'mutations/add-contact': [{ domain: 'contact', keys: null, via: 'contacts' }],
    'mutations/create-deal': [
      { domain: 'deal', keys: null, via: 'deals' },
      { domain: 'contact', keys: null, via: 'contacts' },
    ],
    'mutations/move-deal': [{ domain: 'deal', keys: null, via: 'deals' }],
    'mutations/close-deal': [{ domain: 'deal', keys: null, via: 'deals' }],
    'mutations/post-question-mutation': [{ domain: 'question', keys: null, via: 'questions' }],
    'mutations/post-answer-mutation': [
      { domain: 'answer', keys: null, via: 'answers' },
      { domain: 'question', keys: null, via: 'questions' },
    ],
    'mutations/vote-up-mutation': [
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
