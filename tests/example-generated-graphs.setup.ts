import {
  registerGeneratedMutationTouchRegistry,
  registerGeneratedQueryReadRegistry,
} from '../packages/server/src/internal/execution.js';
import {
  assignDerivedDomainKey,
  assignDerivedQueryKey,
  componentLiveTargetRenderer,
  registerGeneratedLiveTargetRenderer,
} from '../packages/server/src/internal/wire.js';

import {
  activity as crmActivity,
  contact as crmContact,
  deal as crmDeal,
} from '../examples/crm/src/model.js';
import {
  activityListQuery as crmActivityListQuery,
  contactDealCountQuery as crmContactDealCountQuery,
  contactListQuery as crmContactListQuery,
  dealListQuery as crmDealListQuery,
  openDealsQuery as crmOpenDealsQuery,
  pipelineByStageQuery as crmPipelineByStageQuery,
} from '../examples/crm/src/queries.js';
import {
  answer as soAnswer,
  question as soQuestion,
  vote as soVote,
} from '../examples/stackoverflow/src/model.js';
import {
  answerList as soAnswerList,
  questionAnswers as soQuestionAnswers,
  questionDetail as soQuestionDetail,
  questionList as soQuestionList,
  questionScore as soQuestionScore,
} from '../examples/stackoverflow/src/queries.js';

const setupKey = Symbol.for('kovo.exampleGeneratedGraphSetup');
const setupState = globalThis as typeof globalThis & { [setupKey]?: true };

if (!setupState[setupKey]) {
  setupState[setupKey] = true;

  assignDerivedDomainKey(crmContact, 'model/contact');
  assignDerivedDomainKey(crmDeal, 'model/deal');
  assignDerivedDomainKey(crmActivity, 'model/activity');

  assignDerivedQueryKey(crmContactListQuery, 'queries/contact-list-query');
  assignDerivedQueryKey(crmContactDealCountQuery, 'queries/contact-deal-count-query');
  assignDerivedQueryKey(crmDealListQuery, 'queries/deal-list-query');
  assignDerivedQueryKey(crmOpenDealsQuery, 'queries/open-deals-query');
  assignDerivedQueryKey(crmPipelineByStageQuery, 'queries/pipeline-by-stage-query');
  assignDerivedQueryKey(crmActivityListQuery, 'queries/activity-list-query');

  assignDerivedDomainKey(soQuestion, 'model/question');
  assignDerivedDomainKey(soAnswer, 'model/answer');
  assignDerivedDomainKey(soVote, 'model/vote');

  assignDerivedQueryKey(soQuestionList, 'queries/question-list');
  assignDerivedQueryKey(soAnswerList, 'queries/answer-list');
  assignDerivedQueryKey(soQuestionDetail, 'queries/question-detail');
  assignDerivedQueryKey(soQuestionAnswers, 'queries/question-answers');
  assignDerivedQueryKey(soQuestionScore, 'queries/question-score');

  registerGeneratedQueryReadRegistry([
    { query: 'queries/cart-query', domains: ['cart'] },
    { query: 'queries/product-grid-query', domains: ['product'] },
    { query: 'queries/order-history-query', domains: ['order'] },

    { query: 'queries/contact-list-query', domains: ['model/contact'] },
    { query: 'queries/contact-deal-count-query', domains: ['model/deal'] },
    { query: 'queries/deal-list-query', domains: ['model/deal'] },
    { query: 'queries/open-deals-query', domains: ['model/deal'] },
    { query: 'queries/pipeline-by-stage-query', domains: ['model/deal'] },
    { query: 'queries/activity-list-query', domains: ['model/activity'] },

    { query: 'queries/question-list', domains: ['model/question'] },
    { query: 'queries/answer-list', domains: ['model/answer'] },
    { query: 'queries/question-detail', domains: ['model/question'] },
    { query: 'queries/question-answers', domains: ['model/answer'] },
    { query: 'queries/question-score', domains: ['model/vote', 'model/question'] },
  ]);

  registerGeneratedMutationTouchRegistry({
    'domain/add-to-cart': [
      { domain: 'cart', keys: null, via: 'cart_items' },
      { domain: 'order', keys: null, via: 'orders' },
      { domain: 'product', keys: 'arg:productId', via: 'products' },
    ],
    'mutations/add-contact': [{ domain: 'model/contact', keys: null, via: 'contacts' }],
    'mutations/create-deal': [
      { domain: 'model/deal', keys: null, via: 'deals' },
      { domain: 'model/contact', keys: null, via: 'contacts' },
    ],
    'mutations/move-deal': [{ domain: 'model/deal', keys: null, via: 'deals' }],
    'mutations/close-deal': [{ domain: 'model/deal', keys: null, via: 'deals' }],
    'mutations/post-question-mutation': [
      { domain: 'model/question', keys: null, via: 'questions' },
    ],
    'mutations/post-answer-mutation': [
      { domain: 'model/answer', keys: null, via: 'answers' },
      { domain: 'model/question', keys: null, via: 'questions' },
    ],
    'mutations/vote-up-mutation': [
      { domain: 'model/vote', keys: null, via: 'votes' },
      { domain: 'model/question', keys: null, via: 'questions' },
    ],
  });

  const [
    { CartBadge },
    { OrderHistory },
    { ProductGrid },
    { ContactsRegion },
    { DealDetailRegion },
    { PipelineRegion },
    { QuestionDetailRegion },
    { QuestionListRegion },
  ] = await Promise.all([
    import('../examples/commerce/src/components/cart-badge.js'),
    import('../examples/commerce/src/components/order-history.js'),
    import('../examples/commerce/src/components/product-grid.js'),
    import('../examples/crm/src/components/contacts.js'),
    import('../examples/crm/src/components/deal-detail.js'),
    import('../examples/crm/src/components/pipeline.js'),
    import('../examples/stackoverflow/src/components/question-detail.js'),
    import('../examples/stackoverflow/src/components/question-list.js'),
  ]);

  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: CartBadge,
      componentId: 'components/cart-badge/cart-badge',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: ProductGrid,
      componentId: 'components/product-grid/product-grid',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: OrderHistory,
      componentId: 'components/order-history/order-history',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: ContactsRegion,
      componentId: 'components/contacts/contacts-region',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: PipelineRegion,
      componentId: 'components/pipeline/pipeline-region',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: DealDetailRegion,
      componentId: 'components/deal-detail/deal-detail-region',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: QuestionListRegion,
      componentId: 'components/question-list/question-list-region',
    }),
  );
  registerExampleLiveTargetRenderer(
    componentLiveTargetRenderer({
      component: QuestionDetailRegion,
      componentId: 'components/question-detail/question-detail-region',
    }),
  );
}

function registerExampleLiveTargetRenderer(
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
