import { writeFileSync } from 'node:fs';
import { deriveAppGraph } from '@kovojs/compiler';

const graphDeclarations = {
  components: [
    {
      fragments: ['cart-badge'],
      name: 'CartBadge',
      queries: ['cart'],
    },
    {
      fragments: ['cart-panel'],
      name: 'CartPanel',
      queries: ['cart'],
    },
  ],
  mutations: [
    {
      guards: ['authed'],
      invalidates: ['cart'],
      inputFields: ['productId', 'quantity'],
      key: 'cart/add',
      session: 'starterSession',
      writes: ['cart'],
    },
  ],
  optimistic: [
    {
      mutation: 'cart/add',
      query: 'cart',
      status: 'await-fragment',
    },
  ],
  pages: [
    {
      i18n: ['en-US:cartTitle'],
      meta: {
        description: 'Starter cart backed by query data.',
        title: 'Kovo Starter Cart',
      },
      queries: ['cart'],
      route: '/cart',
      stylesheets: ['/src/styles.css'],
    },
  ],
  queries: [
    {
      domains: ['cart'],
      query: 'cart',
    },
  ],
  touchGraph: {
    'cart.addItem': {
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'src/cart.ts:12',
          via: 'cart_items',
        },
      ],
      unresolved: [],
    },
  },
};

const { graph } = deriveAppGraph({ graph: graphDeclarations });
writeFileSync(new URL('../graph.json', import.meta.url), `${JSON.stringify(graph, null, 2)}\n`);
process.stdout.write('emit-graph/v1\nOK\n');
