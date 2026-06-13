import { describe, expect, it } from 'vitest';

import {
  arrowFunctionParts,
  callExpressions,
  componentOptionObjectEntries,
  componentRenderHostElement,
  documentElementActionFromZeroArgArrow,
  functionBodyPropertyAccessPaths,
  jsxElementChildBody,
  jsxElements,
  jsxExpressions,
  mutationHandlers,
  parseComponentModule,
  soleJsxExpressionChild,
  solePropertyAccessPath,
  soleWrappedPropertyAccessPath,
  stringLiteralArrayValues,
} from './parse.js';

describe('compiler scan parser helpers', () => {
  it('records static module specifiers for package prefix discovery', () => {
    const source = `
import { component } from '@jiso/core';
import { Dialog } from '@acme/primitives/dialog';
export { theme } from '@acme/theme';
const loader = () => import('@acme/lazy/panel');
`;

    expect(parseComponentModule('imports.tsx', source).moduleSpecifiers).toEqual([
      { specifier: '@jiso/core' },
      { specifier: '@acme/primitives/dialog' },
      { specifier: '@acme/theme' },
      { specifier: '@acme/lazy/panel' },
    ]);
  });

  it('records trimmed JSX child bodies with original source offsets', () => {
    const source = `
export const ChildSlot = component('child-slot', {
  fragmentTarget: true,
  render: () => (
    <ChildSlot>
      <span>{cart.count}</span>
    </ChildSlot>
  ),
});
`;
    const [slot] = jsxElements(parseComponentModule('child-slot.tsx', source)).filter(
      (element) => element.tag === 'ChildSlot',
    );
    expect(slot).toBeDefined();
    if (!slot) throw new Error('expected ChildSlot JSX element');

    expect(jsxElementChildBody(slot)).toEqual({
      offset: source.indexOf('<span>'),
      source: '<span>{cart.count}</span>',
    });
    expect(slot.childBody).toEqual(jsxElementChildBody(slot));
  });

  it('records JSX expression container spans for source patches', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  render: () => <cart-badge>Total: {cart.count} items</cart-badge>,
});
`;
    const [expression] = jsxExpressions(parseComponentModule('cart-badge.tsx', source));

    expect(expression).toEqual(
      expect.objectContaining({
        containerEnd: source.indexOf('{cart.count}') + '{cart.count}'.length,
        containerStart: source.indexOf('{cart.count}'),
        end: source.indexOf('cart.count') + 'cart.count'.length,
        expression: 'cart.count',
        solePropertyAccessPath: 'cart.count',
        start: source.indexOf('cart.count'),
      }),
    );
  });

  it('records sole JSX expression children as parsed child facts', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  render: () => (
    <section>
      <cart-badge>
        {cart.count}
      </cart-badge>
      <cart-label>Count: {cart.count}</cart-label>
      <cart-wrap><span>{cart.count}</span></cart-wrap>
    </section>
  ),
});
`;
    const model = parseComponentModule('cart-badge.tsx', source);
    const elements = jsxElements(model);
    const badge = elements.find((element) => element.tag === 'cart-badge');
    const label = elements.find((element) => element.tag === 'cart-label');
    const wrap = elements.find((element) => element.tag === 'cart-wrap');

    expect(badge).toBeDefined();
    expect(label).toBeDefined();
    expect(wrap).toBeDefined();
    if (!badge || !label || !wrap) throw new Error('expected JSX fixture elements');

    expect(badge.childNonWhitespaceCount).toBe(1);
    expect(badge.childExpressionContainers).toEqual([
      {
        end: source.indexOf('{cart.count}') + '{cart.count}'.length,
        start: source.indexOf('{cart.count}'),
      },
    ]);
    expect(soleJsxExpressionChild(badge, model)?.solePropertyAccessPath).toBe('cart.count');

    expect(label.childNonWhitespaceCount).toBe(2);
    expect(soleJsxExpressionChild(label, model)).toBeNull();
    expect(wrap.childNonWhitespaceCount).toBe(1);
    expect(soleJsxExpressionChild(wrap, model)).toBeNull();
  });

  it('extracts one property access expression with optional receiver segments', () => {
    expect(solePropertyAccessPath('expression.tsx', 'cart.count')).toBe('cart.count');
    expect(solePropertyAccessPath('expression.tsx', 'cart.items?.name')).toBe('cart.items?.name');
    expect(solePropertyAccessPath('expression.tsx', 'cart.items?.details?.price')).toBe(
      'cart.items?.details?.price',
    );
  });

  it('rejects non-sole property access expressions', () => {
    expect(solePropertyAccessPath('expression.tsx', 'cart.count + 1')).toBeNull();
    expect(solePropertyAccessPath('expression.tsx', 'count')).toBeNull();
  });

  it('extracts one property access from wrapped JSX expression text', () => {
    expect(soleWrappedPropertyAccessPath('expression.tsx', ' { cart.count } ')).toBe('cart.count');
    expect(soleWrappedPropertyAccessPath('expression.tsx', 'cart.count')).toBeNull();
    expect(soleWrappedPropertyAccessPath('expression.tsx', '{cart.count + 1}')).toBeNull();
  });

  it('returns the parsed component render host element', () => {
    const source = `
export const Recommendations = component('recommendations', {
  queries: { cart: cartQuery },
  render: () => <section fw-deps="product:p1 cart">Recommended</section>,
});
`;
    const host = componentRenderHostElement(parseComponentModule('recommendations.tsx', source));

    expect(host?.tag).toBe('section');
    expect(host?.attributes.find((attribute) => attribute.name === 'fw-deps')?.value).toBe(
      'product:p1 cart',
    );
  });

  it('records first HTML tag names for string-rendered component returns', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  render: ({ cart }) => \`<cart-badge><span>\${cart.count}</span></cart-badge>\`,
});
`;
    const [component] = parseComponentModule('cart-badge.tsx', source).components;

    expect(component?.stringRenderReturns).toEqual([
      {
        end: source.indexOf('`,') + 1,
        firstHtmlTagName: 'cart-badge',
        source: '`<cart-badge><span>${cart.count}</span></cart-badge>`',
        start: source.indexOf('`<cart-badge>'),
      },
    ]);
  });

  it('records static literal state return values', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  state: () => ({ label: "it's ready", count: -2, open: false, meta: { empty: null } }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const [component] = parseComponentModule('cart-badge.tsx', source).components;

    expect(component?.stateReturnObject?.staticValue).toEqual({
      count: -2,
      label: "it's ready",
      meta: { empty: null },
      open: false,
    });
  });

  it('leaves non-static state return values unstamped in the model', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  state: () => ({ now: Date.now() }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const [component] = parseComponentModule('cart-badge.tsx', source).components;

    expect(component?.stateReturnObject?.staticValue).toBeUndefined();
  });

  it('records component prop constructor types as parser model facts', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  props: { label: String, count: Number, open: Boolean, meta: customProp },
  css: \`
    cart-badge { color: red; }
  \`,
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const model = parseComponentModule('cart-badge.tsx', source);

    expect(componentOptionObjectEntries(model, 'props')).toEqual([
      { key: 'label', staticConstructorType: 'string', value: 'String' },
      { key: 'count', staticConstructorType: 'number', value: 'Number' },
      { key: 'open', staticConstructorType: 'boolean', value: 'Boolean' },
      { key: 'meta', value: 'customProp' },
    ]);
    expect(model.components[0]?.options.find((option) => option.key === 'css')).toMatchObject({
      staticTemplateValue: '\n    cart-badge { color: red; }\n  ',
    });
  });

  it('records first HTML tag names for exported renderSource returns', () => {
    const source = `
export function renderSource() {
  const sample = '<not-returned></not-returned>';
  return \`<cart-badge><span>2</span></cart-badge>\`;
}
`;
    const model = parseComponentModule('cart-badge.server.ts', source);

    expect(model.renderSourceReturns).toEqual([
      {
        end: source.indexOf('`;') + 1,
        firstHtmlTagName: 'cart-badge',
        source: '`<cart-badge><span>2</span></cart-badge>`',
        start: source.indexOf('`<cart-badge>'),
      },
    ]);
  });

  it('extracts outer property access paths from function body source', () => {
    expect(
      functionBodyPropertyAccessPaths(
        'handler-expression.ts',
        'submit(item.id, cart.items?.length, state.count, "item.name")',
      ),
    ).toEqual(['item.id', 'cart.items?.length', 'state.count']);
  });

  it('records mutation handler property access paths with source spans', () => {
    const source = `
export const save = mutation('cart/save', {
  handler(input: Input, request: Request) {
    const text = "request.db";
    return request.db.insert(input);
  },
});
`;
    const [handler] = mutationHandlers(parseComponentModule('cart.mutation.ts', source));

    expect(handler?.bodyPropertyAccesses).toEqual([
      {
        end: source.indexOf('request.db.insert') + 'request.db.insert'.length,
        path: 'request.db.insert',
        start: source.indexOf('request.db.insert'),
        terminalName: 'insert',
      },
    ]);
    expect(handler?.paramNames).toEqual(['input', 'request']);
  });

  it('records simple destructured mutation handler parameter names', () => {
    const source = `
export const save = mutation('cart/save', {
  handler({ db }) {
    return db.insert(input);
  },
});
`;
    const [handler] = mutationHandlers(parseComponentModule('cart.mutation.ts', source));

    expect(handler?.paramNames).toEqual(['db']);
  });

  it('extracts string literal array values from expression source', () => {
    expect(stringLiteralArrayValues('expression.tsx', '["cart"]')).toEqual(['cart']);
    expect(stringLiteralArrayValues('expression.tsx', "['cart', 'productGrid']")).toEqual([
      'cart',
      'productGrid',
    ]);
    expect(stringLiteralArrayValues('expression.tsx', '[cart]')).toBeNull();
  });

  it('records zero-argument JSX arrow attribute body facts', () => {
    const source = `
export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => { log('item.id'); state.count += item.quantity; }}>Add</button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.domEventName).toBe('click');
    expect(click?.zeroArgArrow).toEqual({
      body: "log('item.id'); state.count += item.quantity;",
      bodyEnd: source.indexOf(' }}>Add') + 1,
      bodyKind: 'block',
      bodyPropertyAccesses: [
        {
          end: source.indexOf('state.count') + 'state.count'.length,
          inferredType: 'number',
          path: 'state.count',
          start: source.indexOf('state.count'),
          terminalName: 'count',
        },
        {
          end: source.indexOf('item.quantity') + 'item.quantity'.length,
          inferredType: 'number',
          path: 'item.quantity',
          start: source.indexOf('item.quantity'),
          terminalName: 'quantity',
        },
      ],
      bodyReferences: [
        {
          end: source.indexOf('log(') + 'log'.length,
          name: 'log',
          start: source.indexOf('log('),
        },
        {
          end: source.indexOf('state.count') + 'state'.length,
          name: 'state',
          start: source.indexOf('state.count'),
        },
        {
          end: source.indexOf('item.quantity') + 'item'.length,
          name: 'item',
          start: source.indexOf('item.quantity'),
        },
      ],
      bodyStart: source.indexOf(" log('item.id');"),
      bodySourceStart: source.indexOf("log('item.id');"),
      references: ['log', 'state', 'item'],
    });
  });

  it('records document element actions on zero-argument JSX arrow attributes', () => {
    const source = `
export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.leadingStart).toBe(source.indexOf(' onClick='));
    expect(click?.zeroArgArrow?.documentElementAction).toEqual({
      action: 'method',
      method: 'showModal',
      target: 'cart-drawer',
    });
  });

  it('attaches JSX comments to the following attribute when no JSX content intervenes', () => {
    const source = `
export const ExecutionTriggers = component('execution-triggers', {
  render: () => (
    <section>
      {/* FW211: intentionally eager. */}
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`;
    const model = parseComponentModule('execution-triggers.tsx', source);
    const [comment] = model.jsxComments;
    const [, stockTicker] = jsxElements(model);
    const load = stockTicker?.attributes.find((attribute) => attribute.name === 'on:load');

    expect(load?.executionTriggerName).toBe('load');
    expect(comment?.attachedAttributeStart).toBe(source.indexOf('on:load'));
  });

  it('records handler property access boolean and number usage contexts', () => {
    const source = `
export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => track(item.quantity > 0, !item.selected, item.name)}>Add</button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.zeroArgArrow?.bodyPropertyAccesses).toEqual([
      {
        end: source.indexOf('item.quantity') + 'item.quantity'.length,
        inferredType: 'number',
        path: 'item.quantity',
        start: source.indexOf('item.quantity'),
        terminalName: 'quantity',
      },
      {
        end: source.indexOf('item.selected') + 'item.selected'.length,
        inferredType: 'boolean',
        path: 'item.selected',
        start: source.indexOf('item.selected'),
        terminalName: 'selected',
      },
      {
        end: source.indexOf('item.name') + 'item.name'.length,
        path: 'item.name',
        start: source.indexOf('item.name'),
        terminalName: 'name',
      },
    ]);
  });

  it('records JSX attribute and child expression property access facts', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  render: () => (
    <cart-badge>
      <button disabled={cart.count === 0}>Checkout</button>
      <span>{cart.count}</span>
      <output>{cart.count + 1}</output>
      <p>{"cart.count"}</p>
    </cart-badge>
  ),
});
`;
    const elements = jsxElements(parseComponentModule('cart-badge.tsx', source));
    const button = elements.find((element) => element.tag === 'button');
    const disabled = button?.attributes.find((attribute) => attribute.name === 'disabled');
    const expressions = parseComponentModule('cart-badge.tsx', source).jsxExpressions;

    expect(disabled?.expressionPropertyAccesses).toEqual([
      {
        end: source.indexOf('cart.count') + 'cart.count'.length,
        inferredType: 'number',
        path: 'cart.count',
        start: source.indexOf('cart.count'),
        terminalName: 'count',
      },
    ]);
    expect(expressions.map((expression) => expression.solePropertyAccessPath ?? null)).toEqual([
      null,
      'cart.count',
      null,
      null,
    ]);
  });

  it('records JSX ancestor tags for element model consumers', () => {
    const source = `
export const CartShell = component('cart-shell', {
  render: () => (
    <section>
      <p><span><strong>Cart</strong></span></p>
    </section>
  ),
});
`;
    const elements = jsxElements(parseComponentModule('cart-shell.tsx', source));
    const strong = elements.find((element) => element.tag === 'strong');

    expect(strong?.ancestorTags).toEqual(['span', 'p', 'section']);
  });

  it('records JSX opening tag and child source for model-driven lowerers', () => {
    const source = `
export const ProductCard = component('product-card', {
  render: () => (
    <section>
      <Link to="/products/:id" params={{ id: 'p1' }}>Product</Link>
      <img src="/p1.png"/>
      <img src="/p2.png" />
    </section>
  ),
});
`;
    const elements = jsxElements(parseComponentModule('product-card.tsx', source));
    const link = elements.find((element) => element.tag === 'Link');
    const images = elements.filter((element) => element.tag === 'img');

    expect(link?.openingTagNameStart).toBe(source.indexOf('Link'));
    expect(link?.openingTagNameEnd).toBe(source.indexOf(' to="/products/:id"'));
    expect(link?.childBody).toEqual({
      offset: source.indexOf('Product</Link>'),
      source: 'Product',
    });
    expect(images.map((element) => element.selfClosingSlashHasLeadingWhitespace)).toEqual([
      false,
      true,
    ]);
  });

  it('records call argument property access facts', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  render: () => <span>{renderOnce(format(cart.count), "cart.discount", product.name, { product: { unitPrice: product.unitPrice }, clientOnly })}</span>,
});
export const CartBadge$isEmpty = derive(["cart"], (cart: Cart) => cart.count === 0);
`;
    const renderOnce = callExpressions(parseComponentModule('cart-badge.tsx', source)).find(
      (call) => call.name === 'renderOnce',
    );
    const derive = callExpressions(parseComponentModule('cart-badge.tsx', source)).find(
      (call) => call.name === 'derive',
    );

    expect(renderOnce?.arguments).toEqual([
      'format(cart.count)',
      '"cart.discount"',
      'product.name',
      '{ product: { unitPrice: product.unitPrice }, clientOnly }',
    ]);
    expect(
      renderOnce?.argumentPropertyAccesses.map((paths) => paths.map((path) => path.path)),
    ).toEqual([['cart.count'], [], ['product.name'], ['product.unitPrice']]);
    expect(renderOnce?.argumentObjectLiteralPaths).toEqual([
      [],
      [],
      [],
      ['product.unitPrice', 'clientOnly'],
    ]);
    expect(renderOnce?.argumentStaticValues).toEqual([
      undefined,
      'cart.discount',
      undefined,
      undefined,
    ]);
    expect(derive?.argumentStringLiteralArrayValues).toEqual([['cart'], null]);
    expect(derive?.argumentStaticValues).toEqual([undefined, undefined]);
    expect(derive?.argumentArrowFunctionParts).toEqual([
      null,
      { expression: 'cart.count === 0', param: 'cart' },
    ]);
  });

  it('records static literal JSX attribute expression values', () => {
    const source = `
export const ProductLinks = component('product-links', {
  render: () => (
    <Link
      to="/products/:id"
      params={{ id: 'p1', featured: true, page: 2 }}
      search={{ sort: 'price', discounted: false }}
    >
      Product
    </Link>
  ),
});
`;
    const link = jsxElements(parseComponentModule('product-links.tsx', source)).find(
      (element) => element.tag === 'Link',
    );

    expect(link?.attributes.find((attribute) => attribute.name === 'params')).toMatchObject({
      expressionStaticValue: { featured: true, id: 'p1', page: 2 },
    });
    expect(link?.attributes.find((attribute) => attribute.name === 'search')).toMatchObject({
      expressionStaticValue: { discounted: false, sort: 'price' },
    });
  });

  it('records references and property accesses on JSX attribute expressions', () => {
    const source = `
export const CartActions = component('cart-actions', {
  render: () => <button onClick={track(item.id, "window.location")}>Save</button>,
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.expressionReferences).toEqual(['track', 'item']);
    expect(click?.expressionPropertyAccesses?.map((access) => access.path)).toEqual(['item.id']);
  });

  it('extracts concise arrow function parts through the TypeScript parser', () => {
    expect(arrowFunctionParts('expression.tsx', '(cart: Cart) => cart.count + ";"')).toEqual({
      expression: 'cart.count + ";"',
      param: 'cart',
    });
    expect(arrowFunctionParts('expression.tsx', 'cart => cart.count')).toEqual({
      expression: 'cart.count',
      param: 'cart',
    });
    expect(arrowFunctionParts('expression.tsx', 'cart => { return cart.count; }')).toBeNull();
  });

  it('records call argument facts on zero-argument JSX arrow attributes', () => {
    const source = `
export const CartActions = component('cart-actions', {
  render: () => (
    <button onClick={() => saveItem('literal,item', item.id, { quantity: item.quantity }, state)}>
      Save
    </button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.zeroArgArrow?.callArguments).toEqual([
      "'literal,item'",
      'item.id',
      '{ quantity: item.quantity }',
      'state',
    ]);
    expect(click?.zeroArgArrow?.callArgumentStaticValues).toEqual([
      'literal,item',
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      click?.zeroArgArrow?.callArgumentPropertyAccesses?.map((paths) =>
        paths.map((path) => path.path),
      ),
    ).toEqual([[], ['item.id'], ['item.quantity'], []]);
    expect(
      click?.zeroArgArrow?.callArgumentReferences?.map((references) =>
        references.map((reference) => reference.name),
      ),
    ).toEqual([[], ['item'], ['item'], ['state']]);
  });

  it('extracts document element method actions from zero-argument arrows', () => {
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        "() => (document.getElementById('cart-drawer') as HTMLDialogElement).requestClose()",
      ),
    ).toEqual({
      action: 'method',
      method: 'requestClose',
      target: 'cart-drawer',
    });
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        '() => document.getElementById(dynamicId)!.showModal()',
      ),
    ).toBeNull();
  });

  it('extracts matching document element open toggles from zero-argument arrows', () => {
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        "() => document.getElementById('shipping')!.open = !document.getElementById('shipping')!.open",
      ),
    ).toEqual({
      action: 'toggle-open',
      target: 'shipping',
    });
    expect(
      documentElementActionFromZeroArgArrow(
        'handler.tsx',
        "() => document.getElementById('shipping')!.open = !document.getElementById('billing')!.open",
      ),
    ).toBeNull();
  });
});
