import { describe, expect, it } from 'vitest';

import {
  callExpressions,
  componentOptionObjectEntries,
  componentRenderHostElement,
  componentRenderSlotsParam,
  jsxElementChildBody,
  jsxElements,
  jsxExpressions,
  mutationHandlers,
  parseComponentModule,
  soleJsxExpressionChild,
} from './parse.js';

describe('compiler scan parser helpers', () => {
  it('records static module specifiers for package prefix discovery', () => {
    const source = `
import { component } from '@kovojs/core';
import { Dialog } from '@acme/primitives/dialog';
export { theme } from '@acme/theme';
const loader = () => import('@acme/lazy/panel');
`;

    expect(parseComponentModule('imports.tsx', source).moduleSpecifiers).toEqual([
      { end: 41, specifier: '@kovojs/core', start: 27 },
      { end: 91, specifier: '@acme/primitives/dialog', start: 66 },
      { end: 128, specifier: '@acme/theme', start: 115 },
      { end: 176, specifier: '@acme/lazy/panel', start: 158 },
    ]);
    expect(parseComponentModule('imports.tsx', source).namedImports).toEqual([
      { importedName: 'component', localName: 'component', moduleSpecifier: '@kovojs/core' },
      { importedName: 'Dialog', localName: 'Dialog', moduleSpecifier: '@acme/primitives/dialog' },
    ]);
  });

  it('records aliased named imports for client handler dependency emission', () => {
    const source = `
import { tabsKeyDown as keyDown, tabsTriggerClick } from '@kovojs/headless-ui/primitives';
`;

    expect(parseComponentModule('imports.tsx', source).namedImports).toEqual([
      {
        importedName: 'tabsKeyDown',
        localName: 'keyDown',
        moduleSpecifier: '@kovojs/headless-ui/primitives',
      },
      {
        importedName: 'tabsTriggerClick',
        localName: 'tabsTriggerClick',
        moduleSpecifier: '@kovojs/headless-ui/primitives',
      },
    ]);
  });

  it('records trimmed JSX child bodies with original source offsets', () => {
    const source = `
export const ChildSlot = component({
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
export const CartBadge = component({
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
export const CartBadge = component({
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

  it('records sole JSX property access expressions with optional receiver segments', () => {
    const source = `
export const CartBadge = component({
  render: () => (
    <cart-badge>
      <span>{cart.count}</span>
      <span>{cart.items?.name}</span>
      <span>{cart.items?.details?.price}</span>
      <span>{cart.count + 1}</span>
      <span>{count}</span>
    </cart-badge>
  ),
});
`;
    const expressions = jsxExpressions(parseComponentModule('cart-badge.tsx', source));

    expect(expressions.map((expression) => expression.solePropertyAccessPath ?? null)).toEqual([
      'cart.count',
      'cart.items?.name',
      'cart.items?.details?.price',
      null,
      null,
    ]);
  });

  it('returns the parsed component render host element', () => {
    const source = `
export const Recommendations = component({
  queries: { cart: cartQuery },
  render: () => <section kovo-deps="product:p1 cart">Recommended</section>,
});
`;
    const host = componentRenderHostElement(parseComponentModule('recommendations.tsx', source));

    expect(host?.tag).toBe('section');
    expect(host?.attributes.find((attribute) => attribute.name === 'kovo-deps')?.value).toBe(
      'product:p1 cart',
    );
  });

  it('records first HTML tag names for string-rendered component returns', () => {
    const source = `
export const CartBadge = component({
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
export const CartBadge = component({
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
export const CartBadge = component({
  state: () => ({ now: Date.now() }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const [component] = parseComponentModule('cart-badge.tsx', source).components;

    expect(component?.stateReturnObject?.staticValue).toBeUndefined();
  });

  it('records state return initializer property accesses as parser facts', () => {
    const source = `
export const CartBadge = component({
  state: () => ({ saved: cart.count, local: 'draft' }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const [component] = parseComponentModule('cart-badge.tsx', source).components;

    expect(component?.stateReturnObject?.entries).toEqual([
      {
        key: 'saved',
        value: 'cart.count',
        valuePropertyAccesses: [
          {
            end: source.indexOf('cart.count') + 'cart.count'.length,
            path: 'cart.count',
            start: source.indexOf('cart.count'),
            terminalName: 'count',
          },
        ],
      },
      { key: 'local', value: "'draft'" },
    ]);
  });

  it('records component prop constructor types as parser model facts', () => {
    const source = `
export const CartBadge = component({
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

  it('does not parse legacy positional component names as component declarations', () => {
    const source = `
export const CartBadge = component('cart-badge', {
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const model = parseComponentModule('cart-badge.tsx', source);

    expect(model.components).toEqual([]);
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

  it('records zero-argument JSX arrow attribute body facts', () => {
    const source = `
export const CartActions = component({
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
      bodyLocalNames: [],
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

  it('records local declaration names inside zero-argument JSX arrow attributes', () => {
    const source = `
export const Tabs = component({
  render: () => (
    <button onClick={() => { const result = choose(item.id); state.value = result.value; }}>Pick</button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('tabs.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.zeroArgArrow?.bodyLocalNames).toEqual(['result']);
  });

  it('records document element actions on zero-argument JSX arrow attributes', () => {
    const source = `
export const CartActions = component({
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
export const ExecutionTriggers = component({
  render: () => (
    <section>
      {/* KV211: intentionally eager. */}
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

  it('does not attach JSX comments across element boundaries', () => {
    const source = `
export const ExecutionTriggers = component({
  render: () => (
    <section>
      <p>{/* KV211: this paragraph is not the eager trigger. */}</p>
      <stock-ticker on:load="/c/ticker.client.js#Ticker$start"></stock-ticker>
    </section>
  ),
});
`;
    const model = parseComponentModule('execution-triggers.tsx', source);
    const [comment] = model.jsxComments;

    expect(comment?.attachedAttributeStart).toBeUndefined();
  });

  it('records handler property access boolean and number usage contexts', () => {
    const source = `
export const CartActions = component({
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
export const CartBadge = component({
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
export const CartShell = component({
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

  it('marks JSX elements inside array map callbacks as repeatable', () => {
    const source = `
export const ProductList = component({
  render: ({ products }) => (
    <section>
      <form enhance mutation={save}>Save</form>
      {products.items.map((item) => (
        <form enhance mutation={save}>
          <input name="id" value={item.id} />
        </form>
      ))}
    </section>
  ),
});
`;
    const forms = jsxElements(parseComponentModule('product-list.tsx', source)).filter(
      (element) => element.tag === 'form',
    );

    expect(forms.map((form) => form.repeatable)).toEqual([false, true]);
  });

  it('records JSX spread call facts for model-driven diagnostics', () => {
    const source = `
export const ProductList = component({
  render: () => (
    <form enhance {...mutationFormAttributes(addToCart)}>
      <input name="id" value="p1" />
    </form>
  ),
});
`;
    const [form] = jsxElements(parseComponentModule('product-list.tsx', source)).filter(
      (element) => element.tag === 'form',
    );

    expect(form?.spreadAttributes).toEqual([
      expect.objectContaining({
        expressionCallArgumentBareIdentifierName: 'addToCart',
        expressionCallName: 'mutationFormAttributes',
      }),
    ]);
  });

  it('records the render slots parameter for compiler-bound form helpers', () => {
    const source = `
export const ProductList = component({
  render: (_queries, _state, slots = {}) => (
    <form enhance mutation={save}>
      <FieldError name="quantity" />
    </form>
  ),
});
`;

    expect(componentRenderSlotsParam(parseComponentModule('product-list.tsx', source))).toEqual(
      expect.objectContaining({ name: 'slots' }),
    );
  });

  it('records JSX opening tag and child source for model-driven lowerers', () => {
    const source = `
export const ProductCard = component({
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
export const CartBadge = component({
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
export const ProductLinks = component({
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
export const CartActions = component({
  render: () => <button onClick={track(item.id, "window.location")}>Save</button>,
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.expressionReferences).toEqual(['track', 'item']);
    expect(click?.expressionPropertyAccesses?.map((access) => access.path)).toEqual(['item.id']);
  });

  it('records call argument facts on zero-argument JSX arrow attributes', () => {
    const source = `
export const CartActions = component({
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
});
