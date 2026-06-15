import { afterEach, describe, expect, it } from 'vitest';

import { applyCompiledQueryUpdatePlan } from './query-bindings.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser query template stamps', () => {
  it('reconciles plain DOM data-bind-list hosts by fw-key and item-relative bindings', () => {
    const list = document.createElement('ul');
    list.setAttribute('data-bind-list', 'cart.items');
    list.setAttribute('fw-key', 'productId');
    list.innerHTML = [
      '<li fw-key="p1" data-bind:data-name=".name"><span data-bind=".qty">1</span> x <span data-bind=".name">Old mug</span></li>',
      '<li fw-key="p3"><span data-bind=".qty">9</span> x <span data-bind=".name">Tea</span></li>',
      '<template fw-stamp><li fw-key=""><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li></template>',
    ].join('');
    document.body.append(list);

    const p1 = list.querySelector('[fw-key="p1"]');
    const p3 = list.querySelector('[fw-key="p3"]');

    const applied = applyCompiledQueryUpdatePlan(
      document,
      'cart',
      {
        items: [
          { name: 'Beans', productId: 'p2', qty: 1 },
          { name: 'Mug', productId: 'p1', qty: 2 },
        ],
      },
      {
        templateStamps: [
          {
            key: 'productId',
            list: 'items',
            render(item) {
              const product = item as { name: string; qty: number };
              return `<li fw-key="" data-bind:data-name=".name"><span data-bind=".qty">${product.qty}</span> x <span data-bind=".name">${product.name}</span></li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied.templateStamps).toEqual(['[data-bind-list="cart.items"]']);
    expect(list.querySelector('[fw-key="p1"]')).toBe(p1);
    expect(list.querySelector('[fw-key="p3"]')).not.toBe(p3);
    expect([...list.children].map((child) => child.getAttribute('fw-key'))).toEqual([
      'p2',
      'p1',
      null,
    ]);
    expect(list.textContent).toBe('1 x Beans2 x Mug');
    expect(list.querySelector('[fw-key="p1"]')?.getAttribute('data-name')).toBe('Mug');
  });
});
