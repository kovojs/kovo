import { describe, expect, it } from 'vitest';

import {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  applyStateBindings,
  createQueryBindingIndex,
  supportsQueryBindings,
} from './query-bindings.js';
import {
  FakeMorphRoot,
  FakeQueryBindingElement,
  FakeQueryPlanElement,
  FakeStatefulBindingElement,
  FakeTemplateStampHost,
} from './runtime-test-fakes.js';

describe('query binding helpers', () => {
  it('applies DOM-shaped data-bind text, value, and attribute updates', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const total = new FakeQueryBindingElement('cart.total', { value: '0' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'old',
      'data-bind:aria-label': 'cart.label',
    });
    root.bindings.push(count, total);
    root.planElements.push(label);

    expect(applyQueryBindings(root, 'cart', { count: 3, label: null, total: 1499 })).toEqual([
      'cart.count',
      'cart.total',
      'cart.label',
    ]);
    expect(count.textContent).toBe('3');
    expect(total.value).toBe('1499');
    expect(label.getAttribute('aria-label')).toBeNull();

    applyQueryBindings(root, 'cart', { count: 4, label: 'Cart ready', total: 1999 });
    expect(label.getAttribute('aria-label')).toBe('Cart ready');
  });

  it('applies optional binding path segments and removes empty attribute bindings', () => {
    const root = new FakeMorphRoot();
    const name = new FakeQueryBindingElement('deal.contact?.name', { textContent: 'Ada' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'Ada',
      'data-bind:aria-label': 'deal.contact?.name',
    });
    root.bindings.push(name);
    root.planElements.push(label);

    expect(applyQueryBindings(root, 'deal', { contact: null })).toEqual([
      'deal.contact?.name',
      'deal.contact?.name',
    ]);
    expect(name.textContent).toBe('');
    expect(label.getAttribute('aria-label')).toBeNull();

    applyQueryBindings(root, 'deal', { contact: { name: 'Grace' } });
    expect(name.textContent).toBe('Grace');
    expect(label.getAttribute('aria-label')).toBe('Grace');
  });

  it('reuses indexed attribute binding candidates across compiled query plans', () => {
    const root = new FakeMorphRoot();
    const cartLabel = new FakeQueryPlanElement({
      'aria-label': 'old cart',
      'data-bind:aria-label': 'cart.label',
    });
    const productLabel = new FakeQueryPlanElement({
      'aria-label': 'old product',
      'data-bind:aria-label': 'product.label',
    });
    root.planElements.push(cartLabel, productLabel);

    const bindingIndex = createQueryBindingIndex(root);

    // SPEC.md §4.8: compiled query plans update every matching data-bind slot.
    // The response apply path reuses this index for all query chunks in one body
    // instead of full-document '*' scanning once per query chunk.
    expect(
      applyCompiledQueryUpdatePlan(root, 'cart', { label: 'Cart ready' }, {}, { bindingIndex }),
    ).toEqual({
      bindings: ['cart.label'],
      derives: [],
      stamps: [],
      templateStamps: [],
    });
    expect(
      applyCompiledQueryUpdatePlan(
        root,
        'product',
        { label: 'Product ready' },
        {},
        { bindingIndex },
      ),
    ).toEqual({
      bindings: ['product.label'],
      derives: [],
      stamps: [],
      templateStamps: [],
    });

    expect(root.wildcardSelectorCalls).toBe(1);
    expect(cartLabel.getAttribute('aria-label')).toBe('Cart ready');
    expect(productLabel.getAttribute('aria-label')).toBe('Product ready');
  });

  it('runs compiled query update plans in bindings, derives, stamps, then template-stamps order', () => {
    const root = new FakeMorphRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '1' });
    const summary = new FakeQueryPlanElement(
      { 'data-derive': 'cart.summary' },
      { textContent: '1 item' },
    );
    const host = new FakeQueryPlanElement({ 'data-plan': 'cart-host' });
    const list = new FakeTemplateStampHost({
      'data-bind-list': 'cart.items',
      'fw-key': 'productId',
    });
    const observed: string[] = [];
    root.bindings.push(count);
    root.planElements.push(summary, host, list);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      {
        count: 2,
        items: [
          { name: 'Mug', productId: 'p1', qty: 2 },
          { name: 'Beans', productId: 'p2', qty: 1 },
        ],
      },
      {
        derives: [
          {
            name: 'summary',
            select(value) {
              observed.push(`derive sees binding:${count.textContent}`);
              return `${(value as { count: number }).count} items`;
            },
          },
        ],
        stamps: [
          {
            attr: 'data-cart-summary',
            selector: '[data-plan="cart-host"]',
            select() {
              observed.push(`stamp sees derive:${summary.textContent}`);
              return summary.textContent;
            },
          },
        ],
        templateStamps: [
          {
            key: 'productId',
            list: 'items',
            render(item) {
              const product = item as { name: string; qty: number };
              return `<li><span data-bind=".qty">${product.qty}</span> x <span data-bind=".name">${product.name}</span></li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: ['cart.count'],
      derives: ['summary'],
      stamps: ['data-cart-summary'],
      templateStamps: ['[data-bind-list="cart.items"]'],
    });
    expect(observed).toEqual(['derive sees binding:2', 'stamp sees derive:2 items']);
    expect(summary.textContent).toBe('2 items');
    expect(host.getAttribute('data-cart-summary')).toBe('2 items');
    expect(list.items.map((item) => item.key)).toEqual(['p1', 'p2']);
    expect(list.items.map((item) => item.index)).toEqual([0, 1]);
    expect(list.textContent).toBe(
      '<li><span data-bind=".qty">2</span> x <span data-bind=".name">Mug</span></li><li><span data-bind=".qty">1</span> x <span data-bind=".name">Beans</span></li>',
    );
  });

  it('removes compiled attribute stamps when the selected value is empty', () => {
    const root = new FakeMorphRoot();
    const host = new FakeQueryPlanElement({ 'aria-label': 'Ada', 'data-plan': 'deal-host' });
    root.planElements.push(host);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'deal',
      { contact: null },
      {
        bindings: false,
        stamps: [
          {
            attr: 'aria-label',
            selector: '[data-plan="deal-host"]',
            select(value) {
              return (value as { contact: { name: string } | null }).contact?.name;
            },
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: [],
      derives: [],
      stamps: ['aria-label'],
      templateStamps: [],
    });
    expect(host.getAttribute('aria-label')).toBeNull();
  });

  it('applies same-island state bindings without query dependencies', async () => {
    const host = new FakeStatefulBindingElement({
      'data-bind:data-state': 'state.status',
      'fw-state': '{"status":"idle"}',
    });
    const count = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: host, textContent: '0' },
    );
    const label = new FakeStatefulBindingElement(
      {
        'aria-label': 'Old',
        'data-bind:aria-label': 'state.label',
      },
      { parent: host },
    );

    await expect(
      applyStateBindings(host, { count: 2, label: 'Ready', status: 'open' }),
    ).resolves.toEqual(['state.count', 'state.status', 'state.label']);
    expect(count.textContent).toBe('2');
    expect(host.getAttribute('data-state')).toBe('open');
    expect(label.getAttribute('aria-label')).toBe('Ready');
  });

  it('keeps state binding walks scoped to the nearest state host', async () => {
    const host = new FakeStatefulBindingElement({ 'fw-state': '{"count":0}' });
    const count = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: host, textContent: '0' },
    );
    const nestedHost = new FakeStatefulBindingElement(
      { 'fw-state': '{"count":100}' },
      { parent: host },
    );
    const nestedCount = new FakeStatefulBindingElement(
      { 'data-bind': 'state.count' },
      { parent: nestedHost, textContent: '100' },
    );

    await expect(applyStateBindings(host, { count: 1 })).resolves.toEqual(['state.count']);
    expect(count.textContent).toBe('1');
    expect(nestedCount.textContent).toBe('100');
  });

  it('applies optional state path empty semantics to text and attributes', async () => {
    const host = new FakeStatefulBindingElement({ 'fw-state': '{"deal":{}}' });
    const name = new FakeStatefulBindingElement(
      { 'data-bind': 'state.deal.contact?.name' },
      { parent: host, textContent: 'Ada' },
    );
    const label = new FakeStatefulBindingElement(
      {
        'aria-label': 'Ada',
        'data-bind:aria-label': 'state.deal.contact?.name',
      },
      { parent: host },
    );

    await expect(applyStateBindings(host, { deal: { contact: null } })).resolves.toEqual([
      'state.deal.contact?.name',
      'state.deal.contact?.name',
    ]);
    expect(name.textContent).toBe('');
    expect(label.getAttribute('aria-label')).toBeNull();
  });

  it('lazy-imports state derive attribute bindings and removes empty results', async () => {
    const host = new FakeStatefulBindingElement({ 'fw-state': '{"open":false}' });
    const panel = new FakeStatefulBindingElement(
      {
        'data-bind:hidden': '/c/disclosure.client.js#Disclosure$panel_hidden_derive',
        hidden: '',
      },
      { parent: host },
    );
    const importModule = async () => ({
      Disclosure$panel_hidden_derive: {
        run(value: unknown) {
          return (value as { open: boolean }).open ? null : '';
        },
      },
    });

    await expect(applyStateBindings(host, { open: true }, { importModule })).resolves.toEqual([
      '/c/disclosure.client.js#Disclosure$panel_hidden_derive',
    ]);
    expect(panel.getAttribute('hidden')).toBeNull();

    await applyStateBindings(host, { open: false }, { importModule });
    expect(panel.getAttribute('hidden')).toBe('');
  });

  it('detects query binding roots by selector support', () => {
    expect(supportsQueryBindings(new FakeMorphRoot())).toBe(true);
    expect(supportsQueryBindings({})).toBe(false);
  });
});
