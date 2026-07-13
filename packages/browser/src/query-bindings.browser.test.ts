import { afterEach, describe, expect, it } from 'vitest';

import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { applyCompiledQueryUpdatePlan } from './query-bindings.js';
import { kovoCreateHTML } from './trusted-types.js';

afterEach(() => {
  document.body.replaceChildren();
  delete (globalThis as typeof globalThis & { __kovo_query_binding_owned?: number })
    .__kovo_query_binding_owned;
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

  it('does not adopt a late Array.filter substitution during template reconciliation', () => {
    const list = document.createElement('ul');
    list.id = 'security-list';
    list.innerHTML = '<template kovo-stamp><li></li></template>';
    document.body.append(list);
    const attacker = document.createElement('img');
    attacker.setAttribute('data-attacker-substitution', 'true');
    attacker.setAttribute('onerror', 'globalThis.__kovo_query_binding_owned = 1');
    attacker.setAttribute('src', '/missing-query-binding-owned');
    const originalFilter = Array.prototype.filter;

    try {
      Array.prototype.filter = function poisonedFilter(...args) {
        const filtered = Reflect.apply(originalFilter, this, args) as unknown[];
        return filtered.some((entry) => entry instanceof Element) ? [attacker] : filtered;
      } as typeof Array.prototype.filter;

      applyCompiledQueryUpdatePlan(
        document,
        'inventory',
        { items: [{ id: 'safe-row' }] },
        {
          bindings: false,
          templateStamps: [
            {
              key: 'id',
              list: 'items',
              render: () => '<li data-server-safe="true">SERVER SAFE</li>',
              selector: '#security-list',
            },
          ],
        },
      );
    } finally {
      Array.prototype.filter = originalFilter;
    }

    expect(list.querySelector('[data-attacker-substitution]')).toBeNull();
    expect(list.querySelector('[data-server-safe]')?.textContent).toBe('SERVER SAFE');
  });

  it('pins template parsing and keyed DOM commits before late prototype poisoning', () => {
    const list = document.createElement('ul');
    list.id = 'security-list';
    list.innerHTML = [
      '<li kovo-key="stale">STALE</li>',
      '<template kovo-stamp><li></li></template>',
    ].join('');
    document.body.append(list);
    const attacker = document.createElement('img');
    attacker.setAttribute('data-attacker-substitution', 'dom-poison');
    attacker.setAttribute('onerror', 'globalThis.__kovo_query_binding_owned = 1');
    attacker.setAttribute('src', '/missing-query-binding-owned');
    const attackerHtml = attacker.outerHTML;
    const attackerFragment = document.createDocumentFragment();
    attackerFragment.append(attacker.cloneNode(true));
    const createElementDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'createElement',
    );
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    const childrenDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'children');
    const querySelectorDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'querySelector',
    );
    const getAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'getAttribute',
    );
    const setAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'setAttribute',
    );
    const hasAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'hasAttribute',
    );
    const contentDescriptor = Object.getOwnPropertyDescriptor(
      HTMLTemplateElement.prototype,
      'content',
    );
    const firstElementChildDescriptor = Object.getOwnPropertyDescriptor(
      DocumentFragment.prototype,
      'firstElementChild',
    );
    const insertBeforeDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'insertBefore');
    const removeDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'remove');
    if (
      !createElementDescriptor ||
      !innerHtmlDescriptor?.set ||
      !childrenDescriptor?.get ||
      !querySelectorDescriptor ||
      !getAttributeDescriptor ||
      !setAttributeDescriptor ||
      !hasAttributeDescriptor ||
      !contentDescriptor?.get ||
      !insertBeforeDescriptor ||
      !removeDescriptor
    ) {
      throw new Error('missing template-stamp DOM security controls');
    }
    const nativeCreateElement =
      createElementDescriptor.value as typeof Document.prototype.createElement;
    const nativeInnerHtmlSet = innerHtmlDescriptor.set;
    const nativeInsertBefore = insertBeforeDescriptor.value as typeof Node.prototype.insertBefore;

    try {
      Object.defineProperty(Document.prototype, 'createElement', {
        ...createElementDescriptor,
        value(this: Document) {
          const parser = Reflect.apply(nativeCreateElement, this, [
            'template',
          ]) as HTMLTemplateElement;
          Reflect.apply(nativeInnerHtmlSet, parser, [attackerHtml]);
          return parser;
        },
      });
      Object.defineProperty(Element.prototype, 'innerHTML', {
        ...innerHtmlDescriptor,
        set(this: Element) {
          Reflect.apply(nativeInnerHtmlSet, this, [attackerHtml]);
        },
      });
      Object.defineProperty(Element.prototype, 'children', {
        ...childrenDescriptor,
        get() {
          return [attacker];
        },
      });
      Object.defineProperty(Element.prototype, 'querySelector', {
        ...querySelectorDescriptor,
        value() {
          throw new Error('late querySelector poison');
        },
      });
      Object.defineProperty(Element.prototype, 'getAttribute', {
        ...getAttributeDescriptor,
        value() {
          throw new Error('late getAttribute poison');
        },
      });
      Object.defineProperty(Element.prototype, 'setAttribute', {
        ...setAttributeDescriptor,
        value() {
          throw new Error('late setAttribute poison');
        },
      });
      Object.defineProperty(Element.prototype, 'hasAttribute', {
        ...hasAttributeDescriptor,
        value() {
          return false;
        },
      });
      Object.defineProperty(HTMLTemplateElement.prototype, 'content', {
        ...contentDescriptor,
        get() {
          return attackerFragment;
        },
      });
      Object.defineProperty(DocumentFragment.prototype, 'firstElementChild', {
        configurable: true,
        get() {
          return attacker;
        },
      });
      Object.defineProperty(Node.prototype, 'insertBefore', {
        ...insertBeforeDescriptor,
        value(this: Node, _node: Node, anchor: Node | null) {
          return Reflect.apply(nativeInsertBefore, this, [attacker, anchor]);
        },
      });
      Object.defineProperty(Element.prototype, 'remove', {
        ...removeDescriptor,
        value() {},
      });

      applyCompiledQueryUpdatePlan(
        document,
        'inventory',
        { items: [{ id: 'safe-row' }] },
        {
          bindings: false,
          templateStamps: [
            {
              key: 'id',
              list: 'items',
              render: () => '<li data-server-safe="true">SERVER SAFE</li>',
              selector: '#security-list',
            },
          ],
        },
      );
    } finally {
      Object.defineProperty(Document.prototype, 'createElement', createElementDescriptor);
      Object.defineProperty(Element.prototype, 'innerHTML', innerHtmlDescriptor);
      Object.defineProperty(Element.prototype, 'children', childrenDescriptor);
      Object.defineProperty(Element.prototype, 'querySelector', querySelectorDescriptor);
      Object.defineProperty(Element.prototype, 'getAttribute', getAttributeDescriptor);
      Object.defineProperty(Element.prototype, 'setAttribute', setAttributeDescriptor);
      Object.defineProperty(Element.prototype, 'hasAttribute', hasAttributeDescriptor);
      Object.defineProperty(HTMLTemplateElement.prototype, 'content', contentDescriptor);
      if (firstElementChildDescriptor) {
        Object.defineProperty(
          DocumentFragment.prototype,
          'firstElementChild',
          firstElementChildDescriptor,
        );
      } else {
        Reflect.deleteProperty(DocumentFragment.prototype, 'firstElementChild');
      }
      Object.defineProperty(Node.prototype, 'insertBefore', insertBeforeDescriptor);
      Object.defineProperty(Element.prototype, 'remove', removeDescriptor);
    }

    expect(list.querySelector('[data-attacker-substitution]')).toBeNull();
    expect(list.querySelector('[kovo-key="stale"]')).toBeNull();
    expect(list.querySelector('[kovo-key="safe-row"]')?.textContent).toBe('SERVER SAFE');
    expect(
      (globalThis as typeof globalThis & { __kovo_query_binding_owned?: number })
        .__kovo_query_binding_owned,
    ).toBeUndefined();
  });

  it('fails closed when template creation or HTML parsing was poisoned before capture', () => {
    const createElementDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'createElement',
    );
    const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!createElementDescriptor || !innerHtmlDescriptor?.set) {
      throw new Error('missing pre-init template security controls');
    }
    const nativeCreateElement =
      createElementDescriptor.value as typeof Document.prototype.createElement;
    const nativeInnerHtmlSet = innerHtmlDescriptor.set;
    let createError: unknown;
    let parseError: unknown;

    try {
      Object.defineProperty(Document.prototype, 'createElement', {
        ...createElementDescriptor,
        value(this: Document, name: string) {
          return Reflect.apply(nativeCreateElement, this, [name === 'template' ? 'div' : name]);
        },
      });
      try {
        createBrowserNavigationSecurityControls(globalThis, kovoCreateHTML);
      } catch (error) {
        createError = error;
      }
    } finally {
      Object.defineProperty(Document.prototype, 'createElement', createElementDescriptor);
    }

    try {
      Object.defineProperty(Element.prototype, 'innerHTML', {
        ...innerHtmlDescriptor,
        set(this: Element) {
          Reflect.apply(nativeInnerHtmlSet, this, [
            '<img data-attacker-substitution="pre-init" onerror="globalThis.__kovo_query_binding_owned=1">',
          ]);
        },
      });
      try {
        createBrowserNavigationSecurityControls(globalThis, kovoCreateHTML);
      } catch (error) {
        parseError = error;
      }
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', innerHtmlDescriptor);
    }

    expect(createError).toBeInstanceOf(TypeError);
    expect(String(createError)).toContain('modified before runtime initialization');
    expect(parseError).toBeInstanceOf(TypeError);
    expect(String(parseError)).toContain('modified before runtime initialization');
  });
});
