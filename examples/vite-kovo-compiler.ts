import { kovoVitePlugin } from '../packages/compiler/src/vite-config.ts';
import type { KovoVitePlugin } from '../packages/compiler/src/vite.ts';
import type { KovoVitePluginOptions } from '../packages/compiler/src/vite.ts';
import type { RegistryFacts } from '../packages/compiler/src/types.ts';

type KovoVitePrePlugin = KovoVitePlugin & { enforce: 'pre' };

export function exampleKovoCompilerPlugin(options: KovoVitePluginOptions): KovoVitePrePlugin {
  return Object.assign(kovoVitePlugin(options), { enforce: 'pre' as const });
}

export function commerceKovoCompilerPlugin(): KovoVitePrePlugin {
  return exampleKovoCompilerPlugin({
    include: ['src/components'],
    registryFacts: commerceRegistryFacts,
  });
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
