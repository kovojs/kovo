import { afterEach, describe, expect, it } from 'vitest';

import { applyCompiledQueryUpdatePlan } from './query-bindings.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('browser query template stamps', () => {
  it('keeps server-rendered escaped text and client text updates equivalent for HTML payloads', () => {
    const payload = `<img src=x onerror=alert(1)> & "quoted" 'single'`;
    const root = document.createElement('section');
    root.innerHTML =
      '<h2 data-bind="product.name">&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot; &#39;single&#39;</h2>';
    document.body.append(root);

    const heading = root.querySelector('h2');
    if (!heading) throw new Error('missing text binding fixture');

    const before = {
      html: root.innerHTML,
      imgCount: root.querySelectorAll('img').length,
      text: heading.textContent,
    };
    const applied = applyCompiledQueryUpdatePlan(root, 'product', { name: payload });
    const after = {
      applied,
      html: root.innerHTML,
      imgCount: root.querySelectorAll('img').length,
      text: heading.textContent,
    };

    // SPEC.md §4.8 requires server-rendered query text and client query updates
    // to share the same empty/text semantics without interpreting payloads as HTML.
    expect({ after, before }).toMatchInlineSnapshot(`
      {
        "after": {
          "applied": {
            "bindings": [
              "product.name",
            ],
            "derives": [],
            "stamps": [],
            "templateStamps": [],
          },
          "html": "<h2 data-bind="product.name">&lt;img src=x onerror=alert(1)&gt; &amp; "quoted" 'single'</h2>",
          "imgCount": 0,
          "text": "<img src=x onerror=alert(1)> & "quoted" 'single'",
        },
        "before": {
          "html": "<h2 data-bind="product.name">&lt;img src=x onerror=alert(1)&gt; &amp; "quoted" 'single'</h2>",
          "imgCount": 0,
          "text": "<img src=x onerror=alert(1)> & "quoted" 'single'",
        },
      }
    `);
  });

  it('reconciles plain DOM data-bind-list hosts by kovo-key and item-relative bindings', () => {
    const list = document.createElement('ul');
    list.setAttribute('data-bind-list', 'cart.items');
    list.setAttribute('kovo-key', 'productId');
    list.innerHTML = [
      '<li kovo-key="p1" data-bind:data-name=".name"><span data-bind=".qty">1</span> x <span data-bind=".name">Old mug</span></li>',
      '<li kovo-key="p3"><span data-bind=".qty">9</span> x <span data-bind=".name">Tea</span></li>',
      '<template kovo-stamp><li kovo-key=""><span data-bind=".qty">0</span> x <span data-bind=".name">Item</span></li></template>',
    ].join('');
    document.body.append(list);

    const p1 = list.querySelector('[kovo-key="p1"]');
    const p3 = list.querySelector('[kovo-key="p3"]');

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
              return `<li kovo-key="" data-bind:data-name=".name"><span data-bind=".qty">${product.qty}</span> x <span data-bind=".name">${product.name}</span></li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied.templateStamps).toEqual(['[data-bind-list="cart.items"]']);
    expect(list.querySelector('[kovo-key="p1"]')).toBe(p1);
    expect(list.querySelector('[kovo-key="p3"]')).not.toBe(p3);
    expect([...list.children].map((child) => child.getAttribute('kovo-key'))).toEqual([
      'p2',
      'p1',
      null,
    ]);
    expect(list.textContent).toBe('1 x Beans2 x Mug');
    expect(list.querySelector('[kovo-key="p1"]')?.getAttribute('data-name')).toBe('Mug');
  });
});
