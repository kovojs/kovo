import { describe, expect, it } from 'vitest';

import {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  createQueryBindingIndex,
  supportsQueryBindings,
  type QueryBindingElement,
} from './query-bindings.js';

class FakeQueryRoot {
  bindings: FakeQueryBindingElement[] = [];
  elements: FakeQueryPlanElement[] = [];
  wildcardSelectorCalls = 0;

  querySelectorAll(selector: string): Iterable<QueryBindingElement> {
    if (selector === '[data-bind]') return this.bindings;
    if (selector === '*') {
      this.wildcardSelectorCalls += 1;
      return [...this.bindings, ...this.elements];
    }
    return this.elements.filter((element) => element.matches(selector));
  }
}

class FakeQueryBindingElement {
  textContent: string | null;
  value?: string;

  constructor(
    private readonly path: string,
    options: { textContent?: string | null; value?: string } = {},
  ) {
    this.textContent = options.textContent ?? null;
    if (options.value !== undefined) {
      this.value = options.value;
    }
  }

  getAttribute(name: string): string | null {
    return name === 'data-bind' ? this.path : null;
  }
}

class FakeQueryPlanElement {
  attributes: { name: string; value: string }[];
  textContent: string | null;

  constructor(attributes: Record<string, string>, options: { textContent?: string | null } = {}) {
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.textContent = options.textContent ?? null;
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((attribute) => attribute.name === name)?.value ?? null;
  }

  matches(selector: string): boolean {
    const exactAttribute = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
    if (exactAttribute) {
      return this.getAttribute(exactAttribute[1] ?? '') === exactAttribute[2];
    }

    const presentAttribute = /^\[([^=\]]+)\]$/.exec(selector);
    return presentAttribute ? this.getAttribute(presentAttribute[1] ?? '') !== null : false;
  }

  removeAttribute(name: string): void {
    this.attributes = this.attributes.filter((attribute) => attribute.name !== name);
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((attribute) => attribute.name === name);
    if (existing) {
      existing.value = value;
      return;
    }

    this.attributes.push({ name, value });
  }
}

class FakeTemplateStampHost extends FakeQueryPlanElement {
  items: Array<{ html: string; index: number; key: string; value: unknown }> = [];

  reconcileTemplateStamp(
    items: readonly { html: string; index: number; key: string; value: unknown }[],
  ): void {
    this.items = items.map((item) => ({ ...item }));
    this.textContent = items.map((item) => item.html).join('');
  }
}

describe('query binding helpers', () => {
  it('applies DOM-shaped data-bind text, value, and attribute updates', () => {
    const root = new FakeQueryRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const total = new FakeQueryBindingElement('cart.total', { value: '0' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'old',
      'data-bind:aria-label': 'cart.label',
    });
    root.bindings.push(count, total);
    root.elements.push(label);

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
    const root = new FakeQueryRoot();
    const name = new FakeQueryBindingElement('deal.contact?.name', { textContent: 'Ada' });
    const label = new FakeQueryPlanElement({
      'aria-label': 'Ada',
      'data-bind:aria-label': 'deal.contact?.name',
    });
    root.bindings.push(name);
    root.elements.push(label);

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
    const root = new FakeQueryRoot();
    const cartLabel = new FakeQueryPlanElement({
      'aria-label': 'old cart',
      'data-bind:aria-label': 'cart.label',
    });
    const productLabel = new FakeQueryPlanElement({
      'aria-label': 'old product',
      'data-bind:aria-label': 'product.label',
    });
    root.elements.push(cartLabel, productLabel);

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
    const root = new FakeQueryRoot();
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
    root.elements.push(summary, host, list);

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
    const root = new FakeQueryRoot();
    const host = new FakeQueryPlanElement({ 'aria-label': 'Ada', 'data-plan': 'deal-host' });
    root.elements.push(host);

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

  it('detects query binding roots by selector support', () => {
    expect(supportsQueryBindings(new FakeQueryRoot())).toBe(true);
    expect(supportsQueryBindings({})).toBe(false);
  });
});
