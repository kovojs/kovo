import { component } from '@kovojs/core';
import { describe, expect, it } from 'vitest';

import { query } from './query.js';
import { setOrAppendHtmlAttribute, stampKovoComponentRoot } from './component-root-stamps.js';
import { createLiveTargetAttestation } from './mutation-wire.js';
import { runWithJsxRequestContext } from './jsx-context.js';
import { createLiveTargetTestAuthority } from './test-fixtures.js';
import { runWithResponseLifecycleRequest } from './response-lifecycle-context.js';

const componentRootStampTestBuildToken = 'component-root-stamp-test-build';
const componentRootStampTestAuthority = createLiveTargetTestAuthority(
  componentRootStampTestBuildToken,
);

describe('component root stamp security', () => {
  it('fails closed before a framework-owned root stamp changes during HTML parsing', () => {
    expect(() => setOrAppendHtmlAttribute('', 'kovo-key', 'record\r1')).toThrow(
      /KV236.*framework root stamp kovo-key.*carriage-return/u,
    );
    expect(() => setOrAppendHtmlAttribute('', 'kovo-key', 'record\ud8001')).toThrow(
      /KV236.*framework root stamp kovo-key.*unpaired-surrogate/u,
    );
    expect(setOrAppendHtmlAttribute('', 'kovo-key', 'record\n😀1')).toBe(' kovo-key="record\n😀1"');
  });

  it('does not let a late selective String.replace escape the stamped opening tag', () => {
    // SPEC §5.2/§6.6 C9/§9.1: framework live-target stamps are emitted after the JSX
    // output choke, so their parser and final assembly must remain framework-owned controls.
    const cardQuery = query('card', { load: () => ({ title: 'safe' }) });
    const Card = component({
      queries: { card: cardQuery },
      render: () => undefined,
    });
    const attrs = ' kovo-c="card-root" kovo-deps="existing"';
    const html = `<card-root${attrs}>safe</card-root>`;
    const injection = '><img src=x onerror=globalThis.__kovoStampXss=1><card-root data-rest="';
    const nativeReplace = String.prototype.replace;
    const nativeValueOf = String.prototype.valueOf;
    let stamped: string;

    try {
      String.prototype.replace = function (search, replacement) {
        const scalar = nativeValueOf.call(this);
        if (scalar === attrs) return injection;
        return nativeReplace.call(this, search, replacement as never);
      };
      stamped = stampKovoComponentRoot({
        attestationAuthority: componentRootStampTestAuthority.authority,
        component: Card,
        componentName: 'components/card/card-root',
        html,
        props: {},
        request: {},
      });
    } finally {
      String.prototype.replace = nativeReplace;
    }

    expect(stamped).not.toContain('<img');
    expect(stamped).toContain('kovo-c="card-root"');
    expect(stamped).toContain('kovo-deps="existing card"');
    expect(stamped).toContain('>safe</card-root>');
  });

  it('pins the complete parser, collection, JSON, URI, and final-assembly control set', () => {
    const catalogQuery = query('catalog/items', { load: () => ({ title: 'safe' }) });
    const Card = component({
      props: { productId: String, filters: Object },
      queries: { local: catalogQuery },
      render: () => undefined,
    });
    const props = { filters: { z: 2, a: 1 }, productId: 'p1' };
    const request = {};
    const html = '<card-root kovo-c="card-root" kovo-deps="legacy, local">safe</card-root>';
    const native = {
      arrayFilter: Array.prototype.filter,
      arrayJoin: Array.prototype.join,
      arrayMap: Array.prototype.map,
      arraySort: Array.prototype.sort,
      encodeURIComponent: globalThis.encodeURIComponent,
      jsonStringify: JSON.stringify,
      objectDefineProperty: Object.defineProperty,
      objectEntries: Object.entries,
      objectFreeze: Object.freeze,
      objectFromEntries: Object.fromEntries,
      objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
      objectKeys: Object.keys,
      regexp: globalThis.RegExp,
      regexpExec: RegExp.prototype.exec,
      regexpTest: RegExp.prototype.test,
      setAdd: Set.prototype.add,
      setHas: Set.prototype.has,
      stringIncludes: String.prototype.includes,
      stringReplace: String.prototype.replace,
      stringReplaceAll: String.prototype.replaceAll,
      stringSlice: String.prototype.slice,
      stringSplit: String.prototype.split,
      stringStartsWith: String.prototype.startsWith,
      stringTrim: String.prototype.trim,
    };
    let stamped: string;

    try {
      Array.prototype.filter = () => [];
      Array.prototype.join = () => 'admin';
      Array.prototype.map = () => ['admin'];
      Array.prototype.sort = function () {
        return this;
      };
      globalThis.encodeURIComponent = () => 'admin';
      JSON.stringify = () => '{"admin":true}';
      Object.defineProperty = () => {
        throw new Error('poisoned Object.defineProperty');
      };
      Object.entries = () => [['admin', true]];
      Object.freeze = (value) => value;
      Object.fromEntries = () => ({ admin: true });
      Object.getOwnPropertyDescriptor = () => undefined;
      Object.keys = () => ['admin'];
      (globalThis as { RegExp: typeof RegExp }).RegExp = function () {
        throw new Error('poisoned RegExp constructor');
      } as unknown as typeof RegExp;
      RegExp.prototype.exec = () => ['admin'] as unknown as RegExpExecArray;
      RegExp.prototype.test = () => false;
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => true;
      String.prototype.includes = () => true;
      String.prototype.replace = () => '><img src=x onerror=admin()>';
      String.prototype.replaceAll = () => '><img src=x onerror=admin()>';
      String.prototype.slice = () => '><img src=x onerror=admin()>';
      String.prototype.split = () => ['admin'];
      String.prototype.startsWith = () => true;
      String.prototype.trim = () => 'admin';

      stamped = stampKovoComponentRoot({
        attestationAuthority: componentRootStampTestAuthority.authority,
        component: Card,
        componentName: 'components/card/card-root',
        html,
        props,
        request,
      });
    } finally {
      String.prototype.trim = native.stringTrim;
      String.prototype.startsWith = native.stringStartsWith;
      String.prototype.split = native.stringSplit;
      String.prototype.slice = native.stringSlice;
      String.prototype.replaceAll = native.stringReplaceAll;
      String.prototype.replace = native.stringReplace;
      String.prototype.includes = native.stringIncludes;
      Set.prototype.has = native.setHas;
      Set.prototype.add = native.setAdd;
      RegExp.prototype.test = native.regexpTest;
      RegExp.prototype.exec = native.regexpExec;
      (globalThis as { RegExp: typeof RegExp }).RegExp = native.regexp;
      Object.keys = native.objectKeys;
      Object.getOwnPropertyDescriptor = native.objectGetOwnPropertyDescriptor;
      Object.fromEntries = native.objectFromEntries;
      Object.freeze = native.objectFreeze;
      Object.entries = native.objectEntries;
      Object.defineProperty = native.objectDefineProperty;
      JSON.stringify = native.jsonStringify;
      globalThis.encodeURIComponent = native.encodeURIComponent;
      Array.prototype.sort = native.arraySort;
      Array.prototype.map = native.arrayMap;
      Array.prototype.join = native.arrayJoin;
      Array.prototype.filter = native.arrayFilter;
    }

    const target =
      'card-root:%7B%22filters%22%3A%7B%22a%22%3A1%2C%22z%22%3A2%7D%2C%22productId%22%3A%22p1%22%7D';
    const expectedToken = createLiveTargetAttestation(
      {
        component: 'components/card/card-root',
        props: { productId: 'p1', filters: { a: 1, z: 2 } },
        target,
      },
      { buildToken: componentRootStampTestAuthority.audience, request },
    );

    expect(stamped).not.toContain('<img');
    expect(stamped).not.toContain('admin');
    expect(stamped).toContain('kovo-deps="legacy catalog/items"');
    expect(stamped).toContain(`kovo-fragment-target="${target}"`);
    expect(stamped).toContain(`kovo-live-token="${expectedToken}"`);
    expect(stamped).toContain(
      'kovo-props="{&quot;productId&quot;:&quot;p1&quot;,&quot;filters&quot;:{&quot;a&quot;:1,&quot;z&quot;:2}}"',
    );
  });

  it('requires own data options, props, and query bindings without invoking accessors', () => {
    const cardQuery = query('card', { load: () => ({ title: 'safe' }) });
    let propReads = 0;
    const props = {} as Record<string, unknown>;
    Object.defineProperty(props, 'productId', {
      enumerable: true,
      get() {
        propReads += 1;
        return 'attacker';
      },
    });
    const Card = component({
      props: { productId: String },
      queries: { card: cardQuery },
      render: () => undefined,
    });

    expect(() =>
      stampKovoComponentRoot({
        component: Card,
        componentName: 'components/card/card-root',
        html: '<card-root>safe</card-root>',
        props,
        request: {},
      }),
    ).toThrow(/own data property/);
    expect(propReads).toBe(0);

    const inheritedOptions = Object.create({
      component: Card,
      html: '<card-root>unsafe</card-root>',
      props: {},
      request: {},
    });
    expect(() => stampKovoComponentRoot(inheritedOptions)).toThrow(/own data property/);

    let queryReads = 0;
    const bindings = {} as Record<string, unknown>;
    Object.defineProperty(bindings, 'card', {
      enumerable: true,
      get() {
        queryReads += 1;
        return cardQuery;
      },
    });
    const AccessorCard = component({
      queries: bindings as never,
      render: () => undefined,
    });
    expect(() =>
      stampKovoComponentRoot({
        component: AccessorCard,
        componentName: 'components/card/accessor-card',
        html: '<card-root>safe</card-root>',
        props: {},
        request: {},
      }),
    ).toThrow(/own data property/);
    expect(queryReads).toBe(0);
  });

  it('does not treat inherited query keys as live-target authority', () => {
    const inheritedQuery = Object.create({ key: 'admin', reads: [] });
    const Card = component({
      queries: { card: inheritedQuery as never },
      render: () => undefined,
    });
    const html = '<card-root>safe</card-root>';

    expect(
      stampKovoComponentRoot({
        component: Card,
        componentName: 'components/card/card-root',
        html,
        props: {},
        request: {},
      }),
    ).toBe(html);
  });

  it('binds omitted optional props identically in the token and visible JSON attribute', () => {
    const cardQuery = query('card', { load: () => ({ title: 'safe' }) });
    const Card = component({
      props: { optionalLabel: String },
      queries: { card: cardQuery },
      render: () => undefined,
    });
    const request = {};
    const stamped = stampKovoComponentRoot({
      attestationAuthority: componentRootStampTestAuthority.authority,
      component: Card,
      componentName: 'components/card/card-root',
      html: '<card-root>safe</card-root>',
      props: {},
      request,
    });
    const expectedToken = createLiveTargetAttestation(
      {
        component: 'components/card/card-root',
        props: {},
        target: 'card-root',
      },
      { buildToken: componentRootStampTestAuthority.audience, request },
    );

    expect(stamped).toContain('kovo-props="{}"');
    expect(stamped).toContain(`kovo-live-token="${expectedToken}"`);
  });

  it('mints first-anonymous live-target tokens against the response CSRF cookie', () => {
    // SPEC §6.6/§9.1: a first anonymous document has no request cookie yet. The component
    // stamp must mint through the same response-owned cache/Set-Cookie channel as a rendered form,
    // then attest the descriptor against that exact browser credential.
    const csrf = {
      secret: 'component-root-anonymous-csrf-secret-0123456789abcdef',
      sessionId: (_request: Request) => undefined,
    };
    const authority = createLiveTargetTestAuthority('component-root-anonymous-build', csrf);
    const cardQuery = query('anonymous-card', { load: () => ({ title: 'safe' }) });
    const Card = component({
      queries: { card: cardQuery },
      render: () => undefined,
    });
    const request = new Request('https://app.test/account');
    const setCookies: string[] = [];
    const stamped = runWithResponseLifecycleRequest(request, request, () =>
      runWithJsxRequestContext(
        request,
        {
          csrf,
          onCsrfSetCookie: (cookie) => setCookies.push(cookie),
        },
        () =>
          stampKovoComponentRoot({
            attestationAuthority: authority.authority,
            component: Card,
            componentName: 'components/card/anonymous-card',
            html: '<anonymous-card>safe</anonymous-card>',
            props: {},
            request,
          }),
      ),
    );

    expect(setCookies).toHaveLength(1);
    const cookiePair = setCookies[0]?.split(';', 1)[0];
    if (cookiePair === undefined) throw new Error('expected anonymous CSRF cookie pair');
    const cookieBoundRequest = new Request('https://app.test/account', {
      headers: { Cookie: cookiePair },
    });
    const otherCookieRequest = new Request('https://app.test/account', {
      headers: { Cookie: '__Host-kovo_csrf=' + 'b'.repeat(43) },
    });
    const descriptor = {
      component: 'components/card/anonymous-card',
      props: {},
      target: 'anonymous-card',
    };
    const expected = createLiveTargetAttestation(descriptor, {
      buildToken: authority.audience,
      csrf,
      request: cookieBoundRequest,
    });
    const otherBrowser = createLiveTargetAttestation(descriptor, {
      buildToken: authority.audience,
      csrf,
      request: otherCookieRequest,
    });

    expect(stamped).toContain(`kovo-live-token="${expected}"`);
    expect(otherBrowser).not.toBe(expected);
  });

  it('preserves framework stamping for custom non-cookie CSRF carriers', () => {
    const request = { csrfPrincipal: 'custom-session-a' };
    const csrf = {
      secret: 'component-root-custom-csrf-secret-0123456789abcdef',
      sessionId: (value: typeof request) => value.csrfPrincipal,
    };
    const authority = createLiveTargetTestAuthority('component-root-custom-build', csrf);
    const cardQuery = query('custom-card', { load: () => ({ title: 'safe' }) });
    const Card = component({ queries: { card: cardQuery }, render: () => undefined });
    const descriptor = {
      component: 'components/card/custom-card',
      props: {},
      target: 'custom-card',
    };
    const stamped = stampKovoComponentRoot({
      attestationAuthority: authority.authority,
      component: Card,
      componentName: descriptor.component,
      html: '<custom-card>safe</custom-card>',
      props: {},
      request,
    });
    const expected = createLiveTargetAttestation(descriptor, {
      buildToken: authority.audience,
      csrf,
      request,
    });

    expect(stamped).toContain(`kovo-live-token="${expected}"`);
  });
});
