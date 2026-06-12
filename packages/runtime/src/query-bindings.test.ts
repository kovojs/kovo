import { describe, expect, it } from 'vitest';

import {
  applyCompiledQueryUpdatePlan,
  applyQueryBindings,
  supportsQueryBindings,
  type QueryBindingElement,
} from './query-bindings.js';

class FakeQueryRoot {
  bindings: FakeQueryBindingElement[] = [];
  elements: FakeQueryPlanElement[] = [];

  querySelectorAll(selector: string): Iterable<QueryBindingElement> {
    if (selector === '[data-bind]') return this.bindings;
    if (selector === '*') return [...this.bindings, ...this.elements];
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

  it('runs compiled plans after bindings and reconciles template stamps', () => {
    const root = new FakeQueryRoot();
    const count = new FakeQueryBindingElement('cart.count', { textContent: '0' });
    const summary = new FakeQueryPlanElement(
      { 'data-derive': 'cart.summary' },
      { textContent: '0 items' },
    );
    const list = new FakeTemplateStampHost({ 'data-bind-list': 'cart.items' });
    const observed: string[] = [];
    root.bindings.push(count);
    root.elements.push(summary, list);

    const applied = applyCompiledQueryUpdatePlan(
      root,
      'cart',
      {
        count: 2,
        items: [
          { id: 'mug', name: 'Mug' },
          { id: 'beans', name: 'Beans' },
        ],
      },
      {
        derives: [
          {
            name: 'summary',
            select() {
              observed.push(`derive:${count.textContent}`);
              return `${count.textContent} items`;
            },
          },
        ],
        templateStamps: [
          {
            key: 'id',
            list: 'items',
            render(item) {
              return `<li>${(item as { name: string }).name}</li>`;
            },
            selector: '[data-bind-list="cart.items"]',
          },
        ],
      },
    );

    expect(applied).toEqual({
      bindings: ['cart.count'],
      derives: ['summary'],
      stamps: [],
      templateStamps: ['[data-bind-list="cart.items"]'],
    });
    expect(observed).toEqual(['derive:2']);
    expect(summary.textContent).toBe('2 items');
    expect(list.items.map((item) => item.key)).toEqual(['mug', 'beans']);
    expect(list.textContent).toBe('<li>Mug</li><li>Beans</li>');
  });

  it('detects query binding roots by selector support', () => {
    expect(supportsQueryBindings(new FakeQueryRoot())).toBe(true);
    expect(supportsQueryBindings({})).toBe(false);
  });
});
