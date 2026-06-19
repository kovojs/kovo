import { kovoVitePlugin } from '../packages/compiler/src/vite-config.ts';
import type { KovoVitePlugin } from '../packages/compiler/src/vite.ts';
import type { RegistryFacts } from '../packages/compiler/src/types.ts';

type KovoVitePrePlugin = KovoVitePlugin & { enforce: 'pre' };

export function commerceKovoCompilerPlugin(): KovoVitePrePlugin {
  return Object.assign(
    kovoVitePlugin({
      include: ['src/components'],
      registryFacts: commerceRegistryFacts,
    }),
    { enforce: 'pre' as const },
  );
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

const commerceRegistryFacts = {
  mutationInputs: {
    'cart/add': [
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
  mutations: { 'cart/add': 'typeof addToCart' },
} satisfies RegistryFacts;
