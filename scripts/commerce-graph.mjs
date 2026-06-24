const commerceGraph = {
  components: [
    {
      fragments: ['components/cart-badge/cart-badge'],
      name: 'components/cart-badge/cart-badge',
      queries: ['cart'],
    },
    {
      fragments: ['components/product-grid/product-grid'],
      name: 'components/product-grid/product-grid',
      queries: ['productGrid'],
    },
    {
      fragments: ['components/order-history/order-history'],
      name: 'components/order-history/order-history',
      queries: ['orderHistory'],
    },
  ],
  endpoints: [],
  mutations: [
    {
      guards: ['authed', 'rateLimit:session'],
      inputFields: ['productId', 'quantity'],
      invalidates: ['cart', 'product', 'order'],
      key: 'cart/add',
      session: 'commerceSession',
      writes: ['cart', 'product', 'order'],
    },
    {
      guards: ['authed'],
      inputFields: [],
      key: 'auth/sign-out',
      session: 'commerceSession',
      writes: ['auth'],
    },
  ],
  optimistic: [
    { derivation: { status: 'derived' }, mutation: 'cart/add', query: 'cart', status: 'derived' },
    {
      derivation: { status: 'derived' },
      mutation: 'cart/add',
      query: 'productGrid',
      status: 'derived',
    },
    {
      derivation: { status: 'derived' },
      mutation: 'cart/add',
      query: 'orderHistory',
      status: 'derived',
    },
  ],
  ownerDomains: [],
  pages: [
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 0 verifiable cart item.',
        title: 'Kovo Commerce (0)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/',
      stylesheets: ['/assets/styles.css'],
    },
    {
      i18n: ['en-US:cartLabel,productStock'],
      meta: {
        description: 'Browse products and checkout with 0 verifiable cart item.',
        title: 'Kovo Commerce (0)',
      },
      modulepreloads: [],
      prefetch: false,
      queries: ['cart', 'productGrid', 'orderHistory'],
      route: '/cart',
      stylesheets: ['/assets/styles.css'],
    },
  ],
  queries: [
    { domains: ['cart'], query: 'cart' },
    { domains: ['product'], query: 'productGrid' },
    { domains: ['order'], query: 'orderHistory' },
  ],
  scopeAudits: [],
  touchGraph: {
    'cart.addItem': {
      reads: [],
      touches: [
        {
          domain: 'cart',
          keys: null,
          site: 'examples/commerce/src/domain.ts:242',
          via: 'cart_items',
        },
        {
          domain: 'order',
          keys: null,
          site: 'examples/commerce/src/domain.ts:247',
          via: 'orders',
        },
        {
          domain: 'product',
          keys: 'arg:productId',
          predicate: 'eq',
          site: 'examples/commerce/src/domain.ts:255',
          via: 'products',
        },
      ],
      unresolved: [],
    },
  },
};

export function emitCommerceGraphArtifactsToTemp() {
  return {
    cleanup: () => {},
    graphPath: '',
    outDir: '',
  };
}

export function readTempCommerceGraph() {
  return structuredClone(commerceGraph);
}
