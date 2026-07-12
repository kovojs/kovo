import { describe, expect, it } from 'vitest';

import {
  callExpressions,
  componentOptionObjectEntries,
  componentRenderHostElement,
  componentRenderSlotsParam,
  handlerWriteSinks,
  jsxElementChildBody,
  jsxElements,
  jsxExpressions,
  mutationHandlers,
  mutationSessionAuthorityFacts,
  parseComponentModule,
  soleJsxExpressionChild,
  taskRunHandlers,
  webhookRecordChanges,
} from './parse.js';

// @kovo-security-classifier-corpus kv418-request-authority
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
import { tabsKeyDown as keyDown, tabsTriggerClick } from '@kovojs/headless-ui/tabs';
`;

    expect(parseComponentModule('imports.tsx', source).namedImports).toEqual([
      {
        importedName: 'tabsKeyDown',
        localName: 'keyDown',
        moduleSpecifier: '@kovojs/headless-ui/tabs',
      },
      {
        importedName: 'tabsTriggerClick',
        localName: 'tabsTriggerClick',
        moduleSpecifier: '@kovojs/headless-ui/tabs',
      },
    ]);
  });

  it('recognizes imported and local aliases for component factory calls', () => {
    const source = `
import { component as defineComponent } from '@kovojs/core';

const defineRegion = defineComponent;

export const CartBadge = defineRegion({
  render: () => <cart-badge>Cart</cart-badge>,
});
`;

    expect(parseComponentModule('cart-badge.tsx', source).components).toEqual([
      expect.objectContaining({ localName: 'CartBadge' }),
    ]);
  });

  it('recognizes namespace and local aliases for component factory calls', () => {
    const source = `
import * as core from '@kovojs/core';

const defineComponent = core.component;

export const CartBadge = defineComponent({
  render: () => <cart-badge>Cart</cart-badge>,
});
`;

    expect(parseComponentModule('cart-badge.tsx', source).components).toEqual([
      expect.objectContaining({ localName: 'CartBadge' }),
    ]);
  });

  it('does not treat a local component lookalike as the framework factory', () => {
    const source = `
function component(value) { return value; }
export const CartBadge = component({
  render: () => <cart-badge>Cart</cart-badge>,
});
`;

    expect(parseComponentModule('cart-badge.tsx', source).components).toEqual([]);
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
  state: () => ({ label: "it's ready", count: -2, open: false, meta: { empty: null }, items: ['first', { label: 'second' }] }),
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const [component] = parseComponentModule('cart-badge.tsx', source).components;

    expect(component?.stateReturnObject?.staticValue).toEqual({
      count: -2,
      items: ['first', { label: 'second' }],
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

  it('does not treat local prop constructor lookalikes as static constructor facts', () => {
    const source = `
const String = { parse: (value) => value };
const Number = { parse: (value) => value };
const Boolean = { parse: (value) => value };

export const CartBadge = component({
  props: { label: String, count: Number, open: Boolean },
  render: () => <cart-badge>Ready</cart-badge>,
});
`;
    const model = parseComponentModule('cart-badge.tsx', source);

    expect(componentOptionObjectEntries(model, 'props')).toEqual([
      { key: 'label', value: 'String' },
      { key: 'count', value: 'Number' },
      { key: 'open', value: 'Boolean' },
    ]);
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
export const save = mutation({
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

  it('records legacy key-first mutation handler property access paths', () => {
    const source = `
export const save = mutation('cart/save', {
  handler(input: Input, request: Request) {
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

  it('records mutation handlers through subpath, namespace, and local aliases', () => {
    const source = `
import { mutation as defineMutation } from '@kovojs/server/api/data';
import * as data from '@kovojs/server/api/data';
const makeMutation = defineMutation;
export const save = makeMutation({ handler(input, request) { return request.db.insert(input); } });
export const remove = data.mutation({ handler(input, request) { return request.db.delete(input); } });
`;

    expect(mutationHandlers(parseComponentModule('cart.mutation.ts', source))).toHaveLength(2);
  });

  it('does not record local mutation lookalikes as framework handlers', () => {
    const source = `
function mutation(value) { return value; }
export const save = mutation({ handler(input, request) { return request.db.insert(input); } });
`;

    expect(mutationHandlers(parseComponentModule('cart.mutation.ts', source))).toEqual([]);
  });

  it('derives KV418 session-authority facts from raw Cookie header provenance', () => {
    const source = `
import { mutation } from '@kovojs/server';

export const direct = mutation('cart/direct', {
  handler(_input, request) {
    return request.headers.get('COOKIE');
  },
});
export const authorization = mutation('cart/authorization', {
  handler(_input, request) {
    return request.headers.get('AUTHORIZATION');
  },
});
export const proxyAuthorization = mutation('cart/proxy-authorization', {
  handler(_input, request) {
    const headers = request.headers;
    return headers.get('proxy-authorization');
  },
});
export const aliased = mutation('cart/aliased', {
  handler(_input, request) {
    const req = request;
    const headers = req['headers'];
    const cookieName = 'cookie';
    return headers.get(cookieName);
  },
});
export const dynamic = mutation('cart/dynamic', {
  handler(input, request) {
    return request.headers.get(input.headerName);
  },
});
export const enumerated = mutation('cart/enumerated', {
  handler(_input, { headers }) {
    return Object.fromEntries(headers);
  },
});
export const nestedHeaders = mutation('cart/nested-headers', {
  handler(_input, { headers: { get } }) {
    return get('cookie');
  },
});
export const destructuredSession = mutation('cart/destructured-session', {
  handler(_input, { session }) {
    return session?.user?.id;
  },
});
export const nestedAlias = mutation('cart/nested-alias', {
  handler(_input, request) {
    const { headers: { get } } = request;
    return get('cookie');
  },
});
export const signature = mutation('cart/signature', {
  handler(_input, request) {
    const headers = request.headers;
    return headers.get('x-signature');
  },
});
export const destructuredSignature = mutation('cart/destructured-signature', {
  handler(_input, { headers }) {
    return headers.get('x-signature');
  },
});
export const helperEscape = mutation('cart/helper-escape', {
  handler(_input, request) {
    return inspectRequest(request);
  },
});
export const cloned = mutation('cart/cloned', {
  handler(_input, request) {
    const next = request.clone();
    return next.headers.get('cookie');
  },
});
export const session = mutation('cart/session', {
  handler(_input, request) {
    return request.session?.user?.id;
  },
});
export const dbOnly = mutation('cart/db-only', {
  handler(input, request) {
    return request.db.insert(input);
  },
});
export const parenthesized = mutation('cart/parenthesized', {
  handler: ((_input, request) => request.headers.get('cookie')),
});
export const reassignedName = mutation('cart/reassigned-name', {
  handler(_input, request) {
    let name = 'x-signature';
    name = 'cookie';
    return request.headers.get(name);
  },
});
export const shadowedName = mutation('cart/shadowed-name', {
  handler(_input, request) {
    const name = 'x-signature';
    {
      const name = 'cookie';
      return request.headers.get(name);
    }
  },
});
export const argumentsRead = mutation('cart/arguments-read', {
  handler(_input, ignored) {
    return arguments[1].headers.get('cookie');
  },
});
export const restRead = mutation('cart/rest-read', {
  handler: (...args) => args[1].headers.get('cookie'),
});
export const evaluated = mutation('cart/evaluated', {
  handler(_input, request) {
    return eval('request.headers.get("cookie")');
  },
});
export const constructed = mutation('cart/constructed', {
  handler() {
    return Function('return globalThis.document?.cookie')();
  },
});
export const setsCookie = mutation('cart/sets-cookie', {
  handler(_input, _request, context) {
    context.setCookie('sid', 'value');
  },
});
export const forwardsCookie = mutation('cart/forwards-cookie', {
  handler(_input, _request, { forwardSetCookie }) {
    forwardSetCookie('sid=value; Secure', { mode: 'same-origin' });
  },
});
export const clearsSiteData = mutation('cart/clears-site-data', {
  handler(_input, _request, context) {
    context.setSessionRevocationClearSiteData();
  },
});
export const contextPrototypeEscape = mutation('cart/context-prototype-escape', {
  handler(_input, _request, context) {
    context.valueOf().setCookie('sid', 'attacker');
  },
});
export const fakeThisCookie = mutation('cart/fake-this-cookie', {
  handler(this: void, _input, request) {
    return request.headers.get('cookie');
  },
});
export const fakeThisCookieSink = mutation('cart/fake-this-cookie-sink', {
  handler(this: void, _input, _request, context) {
    context.setCookie('sid', 'attacker');
  },
});
export const inputOnly = mutation('cart/input-only', {
  handler: (_input) => ({ ok: true }),
});
`;

    const facts = mutationSessionAuthorityFacts(parseComponentModule('cart.mutation.ts', source));

    expect(facts.filter((fact) => fact.referencesSession)).toEqual(
      [
        'cart/aliased',
        'cart/arguments-read',
        'cart/authorization',
        'cart/clears-site-data',
        'cart/cloned',
        'cart/constructed',
        'cart/context-prototype-escape',
        'cart/destructured-session',
        'cart/direct',
        'cart/dynamic',
        'cart/enumerated',
        'cart/evaluated',
        'cart/fake-this-cookie',
        'cart/fake-this-cookie-sink',
        'cart/forwards-cookie',
        'cart/helper-escape',
        'cart/nested-alias',
        'cart/nested-headers',
        'cart/parenthesized',
        'cart/proxy-authorization',
        'cart/reassigned-name',
        'cart/rest-read',
        'cart/session',
        'cart/sets-cookie',
        'cart/shadowed-name',
      ].map((name) => ({
        detail: 'handler reads or may expose ambient request authority',
        kind: 'mutation',
        name,
        referencesSession: true,
        source: 'session-authority',
      })),
    );
    expect(facts.filter((fact) => !fact.referencesSession).map((fact) => fact.name)).toEqual([
      'cart/db-only',
      'cart/destructured-signature',
      'cart/input-only',
      'cart/signature',
    ]);
  });

  it('marks nonliteral mutation keys as unresolved instead of misassociating authority facts', () => {
    const source = `
import { mutation } from '@kovojs/server';

const runtimeKey = 'machine/runtime';
export const exported = mutation(runtimeKey, {
  handler(_input, request) {
    return request.headers.get('cookie');
  },
});
`;

    expect(
      mutationSessionAuthorityFacts(parseComponentModule('machine.mutation.ts', source)),
    ).toEqual([
      {
        detail: 'handler reads or may expose ambient request authority',
        kind: 'mutation',
        name: 'UNRESOLVED',
        referencesSession: true,
        source: 'session-authority',
        unresolvedName: true,
      },
    ]);
  });

  it('fails KV418 authority provenance closed for handlers that are not inline and inspectable', () => {
    const source = `
import { mutation } from '@kovojs/server';

const referencedHandler = (_input, request) => request.headers.get('x-signature');
const sharedOptions = { handler: referencedHandler };

export const referenced = mutation('machine/referenced', { handler: referencedHandler });
export const shared = mutation('machine/shared', sharedOptions);
export const spread = mutation('machine/spread', { ...sharedOptions });
export const inline = mutation('machine/inline', {
  handler(_input, request) {
    return request.headers.get('x-signature');
  },
});
`;

    const facts = mutationSessionAuthorityFacts(
      parseComponentModule('machine.mutation.ts', source),
    );
    expect(facts.filter((fact) => fact.referencesSession)).toEqual(
      ['machine/referenced', 'machine/shared', 'machine/spread'].map((name) => ({
        detail: 'handler authority cannot be proven statically',
        kind: 'mutation',
        name,
        referencesSession: true,
        source: 'session-authority',
      })),
    );
    expect(facts.find((fact) => fact.name === 'machine/inline')).toMatchObject({
      detail: 'handler has no statically observed ambient request authority',
      referencesSession: false,
    });
  });

  it('records simple destructured mutation handler parameter names', () => {
    const source = `
export const save = mutation({
  handler({ db }) {
    return db.insert(input);
  },
});
`;
    const [handler] = mutationHandlers(parseComponentModule('cart.mutation.ts', source));

    expect(handler?.paramNames).toEqual(['db']);
  });

  it('records mutation direct write sink facts with source-derived owners', () => {
    const source = `
export const save = mutation({
  handler(input, request) {
    const tx = request.db;
    tx.insert(input);
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('src/mutations/cart.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'tx', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'mutations/cart/save' },
        path: 'tx.insert',
        span: {
          end: source.indexOf('tx.insert') + 'tx.insert'.length,
          start: source.indexOf('tx.insert'),
        },
        surface: 'mutation',
      },
    ]);
  });

  it('records literal element request db write sink facts as direct db access', () => {
    const source = `
export const save = mutation('cart/save', {
  handler(input, request) {
    request['db'].insert(input);
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('src/mutations/cart.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'request.db', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart/save' },
        path: 'request.db.insert',
        span: {
          end: source.indexOf("request['db'].insert") + "request['db'].insert".length,
          start: source.indexOf("request['db'].insert"),
        },
        surface: 'mutation',
      },
    ]);
  });

  it('records destructured and helper-wrapper mutation write sink facts', () => {
    const source = `
export const save = mutation('cart/save', {
  handler(input, { db: requestDb }) {
    requestDb.delete(input);
    return withDb((db) => db.update(input));
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('src/mutations/cart.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'requestDb', provenance: 'property-access-path' },
        operationKind: 'delete',
        owner: { kind: 'key', value: 'cart/save' },
        path: 'requestDb.delete',
        span: {
          end: source.indexOf('requestDb.delete') + 'requestDb.delete'.length,
          start: source.indexOf('requestDb.delete'),
        },
        surface: 'mutation',
      },
      {
        canonicalTarget: { identity: 'db', provenance: 'property-access-path' },
        operationKind: 'update',
        owner: { kind: 'key', value: 'cart/save' },
        path: 'db.update',
        span: {
          end: source.indexOf('db.update') + 'db.update'.length,
          start: source.indexOf('db.update'),
        },
        surface: 'mutation',
      },
    ]);
  });

  it('records unresolved mutation write sink facts instead of an empty safe set', () => {
    const source = `
export const save = mutation('cart/save', {
  async handler(input) {
    await dbFor(input.tenant).insert(input);
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('src/mutations/cart.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-property-access' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'cart/save' },
        path: 'UNRESOLVED',
        span: {
          end: source.indexOf('dbFor(input.tenant).insert') + 'dbFor(input.tenant).insert'.length,
          start: source.indexOf('dbFor(input.tenant).insert'),
        },
        surface: 'mutation',
      },
    ]);
  });

  it('records durable task run handlers and composition edges', () => {
    const source = `
export const sendReceipt = task('email/send-receipt', {
  cron: '0 2 * * *',
  input: receiptInput,
  async run(args, ctx) {
    await ctx.runQuery(orderQuery, { id: args.orderId });
    await ctx.runMutation(markSent, { id: args.orderId });
    await ctx.schedule(sendReceipt, args, { afterMs: 1000 });
  },
});
`;
    const [handler] = taskRunHandlers(parseComponentModule('tasks.ts', source));

    expect(handler).toMatchObject({
      cron: '0 2 * * *',
      key: 'email/send-receipt',
      paramNames: ['args', 'ctx'],
      runMutationEdges: ['markSent'],
      runQueryEdges: ['orderQuery'],
      scheduleEdges: ['sendReceipt'],
    });
  });

  it('records object-form durable task handlers with source-derived keys', () => {
    const source = `
export const sendReceipt = task({
  input: receiptInput,
  async run(args, ctx) {
    await ctx.runQuery(orderQuery, { id: args.orderId });
  },
});
`;
    const [handler] = taskRunHandlers(parseComponentModule('src/tasks.ts', source));

    expect(handler).toMatchObject({
      key: 'tasks/send-receipt',
      paramNames: ['args', 'ctx'],
      runQueryEdges: ['orderQuery'],
    });
  });

  it('records task direct write sink facts separately from composition edges', () => {
    const source = `
export const sendReceipt = task('email/send-receipt', {
  async run(args, ctx) {
    await appDb.insert(receipts).values({ id: args.id });
    await ctx.runMutation(markSent, { id: args.id });
  },
});
`;
    const model = parseComponentModule('tasks.ts', source);
    const [handler] = taskRunHandlers(model);

    expect(handler).toMatchObject({
      key: 'email/send-receipt',
      runMutationEdges: ['markSent'],
    });
    expect(handlerWriteSinks(model)).toEqual([
      {
        canonicalTarget: { identity: 'appDb', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'email/send-receipt' },
        path: 'appDb.insert',
        span: {
          end: source.indexOf('appDb.insert') + 'appDb.insert'.length,
          start: source.indexOf('appDb.insert'),
        },
        surface: 'task',
      },
    ]);
  });

  it('records unresolved task write sink facts instead of an empty safe set', () => {
    const source = `
export const sendReceipt = task('email/send-receipt', {
  async run(args, ctx) {
    await dbFor(args.tenant).insert(receipts).values({ id: args.id });
    await ctx.runMutation(markSent, { id: args.id });
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('tasks.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'UNRESOLVED', provenance: 'unresolved-property-access' },
        operationKind: 'insert',
        owner: { kind: 'key', value: 'email/send-receipt' },
        path: 'UNRESOLVED',
        span: {
          end: source.indexOf('dbFor(args.tenant).insert') + 'dbFor(args.tenant).insert'.length,
          start: source.indexOf('dbFor(args.tenant).insert'),
        },
        surface: 'task',
      },
    ]);
  });

  it('records webhook direct write sink facts with the webhook path owner', () => {
    const source = `
import { webhook } from '@kovojs/server';

export const paymentWebhook = webhook('/webhooks/payment', {
  async handler(request) {
    await appDb.update(payments).set({ paid: true });
    return Response.json({ ok: true });
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('webhooks.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'appDb', provenance: 'property-access-path' },
        operationKind: 'update',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'appDb.update',
        span: {
          end: source.indexOf('appDb.update') + 'appDb.update'.length,
          start: source.indexOf('appDb.update'),
        },
        surface: 'webhook',
      },
    ]);
  });

  it('records webhook transaction raw-driver escape facts with the webhook path owner', () => {
    const source = `
import { webhook } from '@kovojs/server';

export const paymentWebhook = webhook('/webhooks/payment', {
  async handler(input, context) {
    void (context.tx as unknown as { $client: unknown }).$client;
    const tx = context.tx;
    void tx.session;
    return context.runMutation(recordPayment, { id: input.id });
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('webhooks.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'context.tx', provenance: 'property-access-path' },
        operationKind: 'raw-driver-escape',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'context.tx.$client',
        span: {
          end:
            source.indexOf('(context.tx as unknown as { $client: unknown }).$client') +
            '(context.tx as unknown as { $client: unknown }).$client'.length,
          start: source.indexOf('(context.tx as unknown as { $client: unknown }).$client'),
        },
        surface: 'webhook',
      },
      {
        canonicalTarget: { identity: 'tx', provenance: 'property-access-path' },
        operationKind: 'raw-driver-escape',
        owner: { kind: 'path', value: '/webhooks/payment' },
        path: 'tx.session',
        span: {
          end: source.indexOf('tx.session') + 'tx.session'.length,
          start: source.indexOf('tx.session'),
        },
        surface: 'webhook',
      },
    ]);
  });

  it('records endpoint direct write sink facts with the endpoint path owner', () => {
    const source = `
import { endpoint } from '@kovojs/server';

export const unsafeEndpoint = endpoint('/api/unsafe', {
  async handler(request) {
    await appDb.insert(payments).values({ id: await request.text() });
    return Response.json({ ok: true });
  },
});
`;
    const facts = handlerWriteSinks(parseComponentModule('endpoints.ts', source));

    expect(facts).toEqual([
      {
        canonicalTarget: { identity: 'appDb', provenance: 'property-access-path' },
        operationKind: 'insert',
        owner: { kind: 'path', value: '/api/unsafe' },
        path: 'appDb.insert',
        span: {
          end: source.indexOf('appDb.insert') + 'appDb.insert'.length,
          start: source.indexOf('appDb.insert'),
        },
        surface: 'endpoint',
      },
    ]);
  });

  it('records webhook recordChange facts with declared write keys', () => {
    const source = `
import { domain, webhook } from '@kovojs/server';

const contact = domain('model/contact');
const billing = domain('billing');

export const paymentWebhook = webhook('/webhooks/payment', {
  async handler(input, context) {
    context.recordChange(contact, { keys: [input.id] });
    (context as unknown as { recordChange(domain: typeof billing): unknown }).recordChange(billing);
    return Response.json({ ok: true });
  },
  writes: [contact],
});
`;
    const facts = webhookRecordChanges(parseComponentModule('webhooks.ts', source));

    expect(facts).toEqual([
      {
        declaredWriteKeys: ['model/contact'],
        domainKey: 'model/contact',
        owner: { kind: 'path', value: '/webhooks/payment' },
        span: {
          end: source.indexOf('contact, { keys') + 'contact'.length,
          start: source.indexOf('contact, { keys'),
        },
      },
      {
        declaredWriteKeys: ['model/contact'],
        domainKey: 'billing',
        owner: { kind: 'path', value: '/webhooks/payment' },
        span: {
          end: source.lastIndexOf('billing)') + 'billing'.length,
          start: source.lastIndexOf('billing)'),
        },
      },
    ]);
  });

  it('records destructured webhook recordChange facts', () => {
    const source = `
import { domain, webhook } from '@kovojs/server';

const contact = domain('model/contact');
const billing = domain('billing');

export const paymentWebhook = webhook('/webhooks/payment', {
  async handler(input, { recordChange, recordChange: markChanged }) {
    recordChange(contact, { keys: [input.id] });
    markChanged(billing);
    return Response.json({ ok: true });
  },
  writes: [contact],
});
`;
    const facts = webhookRecordChanges(parseComponentModule('webhooks.ts', source));

    expect(facts).toEqual([
      {
        declaredWriteKeys: ['model/contact'],
        domainKey: 'model/contact',
        owner: { kind: 'path', value: '/webhooks/payment' },
        span: {
          end: source.indexOf('contact, { keys') + 'contact'.length,
          start: source.indexOf('contact, { keys'),
        },
      },
      {
        declaredWriteKeys: ['model/contact'],
        domainKey: 'billing',
        owner: { kind: 'path', value: '/webhooks/payment' },
        span: {
          end: source.indexOf('billing);') + 'billing'.length,
          start: source.indexOf('billing);'),
        },
      },
    ]);
  });

  it('records durable task handlers through namespace and local aliases', () => {
    const source = `
import * as data from '@kovojs/server/api/data';
const defineTask = data.task;
export const sendReceipt = defineTask('email/send-receipt', {
  async run(args, ctx) { await ctx.runMutation(markSent, { id: args.id }); },
});
`;

    expect(taskRunHandlers(parseComponentModule('tasks.ts', source))).toEqual([
      expect.objectContaining({ key: 'email/send-receipt', runMutationEdges: ['markSent'] }),
    ]);
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

  it('does not record document element actions when document is shadowed', () => {
    const source = `
export const CartActions = component({
  render: (document) => (
    <button onClick={() => document.getElementById('cart-drawer')!.showModal()}>Open</button>
  ),
});
`;
    const [button] = jsxElements(parseComponentModule('cart-actions.tsx', source));
    const click = button?.attributes.find((attribute) => attribute.name === 'onClick');

    expect(click?.zeroArgArrow?.documentElementAction).toBeUndefined();
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

  it('marks JSX elements inside statically recognizable repeat callbacks as repeatable', () => {
    const source = `
export const ProductList = component({
  render: ({ products }) => (
    <section>
      {products.featured.flatMap((item) => <article>{item.name}</article>)}
      {Array.from(products.items, function itemCard(item) {
        return <form enhance mutation={save}><input name="id" value={item.id} /></form>;
      })}
    </section>
  ),
});
`;
    const elements = jsxElements(parseComponentModule('product-list.tsx', source));
    const article = elements.find((element) => element.tag === 'article');
    const form = elements.find((element) => element.tag === 'form');
    const input = elements.find((element) => element.tag === 'input');

    expect(article?.repeatable).toBe(true);
    expect(form?.repeatable).toBe(true);
    expect(input?.repeatable).toBe(true);
  });

  it('does not mark Array.from callbacks as repeatable when Array is shadowed', () => {
    const source = `
const Array = { from: (items, render) => items.map(render) };

export const ProductList = component({
  render: ({ products }) => (
    <section>
      {Array.from(products.items, function itemCard(item) {
        return <form enhance mutation={save}><input name="id" value={item.id} /></form>;
      })}
    </section>
  ),
});
`;
    const elements = jsxElements(parseComponentModule('product-list.tsx', source));
    const form = elements.find((element) => element.tag === 'form');
    const input = elements.find((element) => element.tag === 'input');

    expect(form?.repeatable).toBe(false);
    expect(input?.repeatable).toBe(false);
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

  it('exposes static JSX spread entries only when every runtime property is modelled (M3)', () => {
    const source = `
const labelName = 'aria-label';
const completeAttrs = { class: 'card', [labelName]: 'Profile' };
const partialAlias = { ...profileAttrs, noop() {} };

export const SpreadShapes = component({
  render: ({ profile, dynamicName }) => (
    <section>
      <article {...completeAttrs}>complete alias</article>
      <article {...partialAlias}>partial alias</article>
      <article {...{ ...profile.attributes }}>pure nested spread</article>
      <article {...{ ...profile.attributes, noop() {} }}>spread plus method</article>
      <article {...{ get ['ON:LOAD']() { return profile.handler; } }}>getter</article>
      <article {...{ [dynamicName]: profile.value }}>dynamic computed name</article>
    </section>
  ),
});
`;
    const spreads = jsxElements(parseComponentModule('spread-shapes.tsx', source))
      .flatMap((element) => element.spreadAttributes)
      .map((spread) => [spread.expression, spread.objectEntries] as const);

    expect(spreads).toEqual([
      [
        'completeAttrs',
        [
          expect.objectContaining({ key: 'class', value: "'card'" }),
          expect.objectContaining({ key: 'aria-label', value: "'Profile'" }),
        ],
      ],
      ['partialAlias', undefined],
      ['{ ...profile.attributes }', undefined],
      ['{ ...profile.attributes, noop() {} }', undefined],
      ["{ get ['ON:LOAD']() { return profile.handler; } }", undefined],
      ['{ [dynamicName]: profile.value }', undefined],
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
export const CartBadge$isEmpty = derive(["cart"], (cart: Cart) => cart.count === 0 && Date.now() > new Date().getTime());
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
    expect(derive?.argumentStaticValues).toEqual([['cart'], undefined]);
    expect(derive?.argumentArrowFunctionParts).toEqual([
      null,
      {
        expression: 'cart.count === 0 && Date.now() > new Date().getTime()',
        param: 'cart',
        params: ['cart'],
      },
    ]);
    expect(derive?.argumentTemporalReads.map((reads) => reads.map((read) => read.kind))).toEqual([
      [],
      ['Date.now', 'new Date'],
    ]);
  });

  it('does not record temporal reads from local Date lookalikes', () => {
    const source = `
const Date = {
  now: () => 0,
};
export const CartBadge$isEmpty = derive(["cart"], (cart: Cart) => cart.count === 0 && Date.now() > new Date().getTime());
`;
    const derive = callExpressions(parseComponentModule('cart-badge.tsx', source)).find(
      (call) => call.name === 'derive',
    );

    expect(derive?.argumentTemporalReads.map((reads) => reads.map((read) => read.kind))).toEqual([
      [],
      [],
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
