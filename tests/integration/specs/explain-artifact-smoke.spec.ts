// SPEC.md §5.3 + §11.4: explain output is a stable graph for behavior intent.
import { kovoExplain, type KovoExplainInput } from 'kovo';

import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'explain-artifact-smoke' });

test('matches browser-observed cart behavior to component and mutation explain output', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-component="CartBadge"] [data-bind="cart.count"]')).toHaveText(
    '0',
  );

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.locator('[data-component="CartBadge"] [data-bind="cart.count"]')).toHaveText(
    '1',
  );

  const graph: KovoExplainInput = {
    components: [
      {
        fragments: ['cart-badge'],
        handlers: [
          {
            captures: ['ctx'],
            event: 'submit',
            exportName: 'CartForm$submit',
            params: ['sku'],
            ref: '/c/cart-form.client.js#CartForm$submit',
          },
        ],
        name: 'CartBadge',
        queries: ['cart'],
      },
    ],
    mutations: [
      {
        inputFields: ['sku'],
        invalidates: ['cart'],
        key: 'cart/add',
        writes: ['cart'],
      },
    ],
    pages: [{ queries: ['cart'], route: '/' }],
    queries: [{ domains: ['cart'], query: 'cart' }],
  };

  expect(kovoExplain(graph, { kind: 'component', target: 'CartBadge' })).toEqual({
    exitCode: 0,
    output: [
      'kovo-explain/v1',
      'COMPONENT CartBadge',
      'queries: cart',
      'fragments: cart-badge',
      'HANDLER submit export=CartForm$submit ref=/c/cart-form.client.js#CartForm$submit captures=ctx params=sku substitution=-',
      '',
    ].join('\n'),
  });
  expect(kovoExplain(graph, { kind: 'mutation', target: 'cart/add' }).output).toContain(
    'updates: cart->component:CartBadge,page:/',
  );
});
