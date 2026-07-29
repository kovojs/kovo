import { kovoVitePlugin } from '../packages/compiler/src/vite-config-source.ts';
import type { KovoVitePlugin } from '../packages/compiler/src/vite.ts';
import type { KovoVitePluginOptions } from '../packages/compiler/src/vite.ts';
import type { RegistryFacts } from '../packages/compiler/src/types.ts';

type KovoVitePrePlugin = KovoVitePlugin & { enforce: 'pre' };

export function exampleKovoCompilerPlugin(options: KovoVitePluginOptions): KovoVitePrePlugin {
  return kovoVitePlugin(options) as KovoVitePrePlugin;
}

export function commerceKovoCompilerPlugin(): KovoVitePrePlugin {
  return exampleKovoCompilerPlugin({ include: ['src'] });
}

function requiredString(name: string) {
  return {
    coercion: 'string' as const,
    defaulted: false,
    name,
    optional: false,
    provenance: 'registry' as const,
    required: true,
  };
}

function requiredNumber(name: string) {
  return {
    coercion: 'number' as const,
    defaulted: false,
    name,
    optional: false,
    provenance: 'registry' as const,
    required: true,
  };
}

export const commerceRegistryFacts = {
  mutationInputs: {
    'domain/add-to-cart': [
      requiredString('productId'),
      {
        coercion: 'number' as const,
        defaulted: true,
        name: 'quantity',
        optional: false,
        provenance: 'registry' as const,
        required: false,
      },
    ],
  },
  mutations: { 'domain/add-to-cart': 'typeof addToCart' },
} satisfies RegistryFacts;

const tutorialAddToCartInputs = [
  requiredString('productId'),
  {
    coercion: 'number' as const,
    defaulted: true,
    name: 'quantity',
    optional: false,
    provenance: 'registry' as const,
    required: false,
  },
];

/** Closed input facts for tutorial chapters whose mutation is declared in `app.tsx`. */
export const tutorialAppRegistryFacts = {
  mutationInputs: {
    'app/add-to-cart': tutorialAddToCartInputs,
  },
  mutations: {
    'app/add-to-cart': 'typeof addToCart',
  },
} satisfies RegistryFacts;

/** Closed input facts for chapter 4's cycle-free mutation module. */
export const tutorialMutationRegistryFacts = {
  mutationInputs: {
    'mutations/add-to-cart': tutorialAddToCartInputs,
  },
  mutations: {
    'mutations/add-to-cart': 'typeof addToCart',
  },
} satisfies RegistryFacts;

export const crmRegistryFacts = {
  mutationInputs: {
    'mutations/add-contact': [
      requiredString('id'),
      requiredString('name'),
      requiredString('email'),
    ],
    'mutations/close-deal': [requiredString('dealId')],
    'mutations/create-deal': [
      requiredString('id'),
      requiredString('contactId'),
      requiredString('stage'),
      requiredNumber('amount'),
    ],
    'mutations/move-deal': [requiredString('dealId'), requiredString('stage')],
  },
  mutations: {
    'mutations/add-contact': 'typeof addContact',
    'mutations/close-deal': 'typeof closeDeal',
    'mutations/create-deal': 'typeof createDeal',
    'mutations/move-deal': 'typeof moveDeal',
  },
} satisfies RegistryFacts;

export const stackOverflowRegistryFacts = {
  mutationInputs: {
    'mutations/post-answer-mutation': [
      requiredString('id'),
      requiredString('questionId'),
      requiredString('body'),
    ],
    'mutations/post-question-mutation': [
      requiredString('id'),
      requiredString('title'),
      requiredString('body'),
    ],
    'mutations/vote-up-mutation': [requiredString('id'), requiredString('targetId')],
  },
  mutations: {
    'mutations/post-answer-mutation': 'typeof postAnswerMutation',
    'mutations/post-question-mutation': 'typeof postQuestionMutation',
    'mutations/vote-up-mutation': 'typeof voteUpMutation',
  },
} satisfies RegistryFacts;
