import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/browser';
import { component, FieldError, FormError } from '@kovojs/core';

import { renderedHtml, renderHtmlValue } from './html.js';
import { currentJsxMutationFormHelperRegistry, runWithJsxRequestContext } from './jsx-context.js';
import { Fragment, jsx, type JsxChild } from './jsx-runtime.js';
import { mutation } from './mutation.js';
import { s } from './schema.js';

const postSaveMutation = mutation('post/save', {
  csrf: false,
  csrfJustification: 'test fixture exercises server JSX output assembly',
  input: s.object({}),
  handler() {
    return null;
  },
});

describe('JSX output authority security', () => {
  it('escapes raw strings from runtime-constructed component renderers', async () => {
    const payload = '<img src=x onerror="runtimeComponentXss()">';
    const RuntimeComponent = component({
      render: () => payload as unknown as ReturnType<typeof jsx>,
    });

    const rendered = renderHtmlValue(await jsx(RuntimeComponent, {}));
    expect(rendered).not.toContain(payload);
    expect(rendered).toContain('&lt;img src=x onerror="runtimeComponentXss()"&gt;');
  });

  it('rejects structural component forgeries at the rendered-output boundary', async () => {
    const payload = '<img src=x onerror="structuralComponentXss()">';
    const forged = Object.assign(() => undefined, {
      definition: { render: () => payload },
    });

    const rendered = renderHtmlValue(await jsx(forged, {}));

    expect(rendered).toBe('');
    expect(rendered).not.toContain(payload);
  });

  it('pins a genuine component render function at component construction', async () => {
    const payload = '<img src=x onerror="mutatedComponentXss()">';
    const definition = {
      render: () => jsx('p', { children: 'Original component.' }),
    };
    const Genuine = component(definition);
    definition.render = () => payload as unknown as ReturnType<typeof jsx>;

    const rendered = renderHtmlValue(await jsx(Genuine, {}));

    expect(rendered).toContain('Original component.');
    expect(rendered).not.toContain(payload);
  });

  it('pins void-element classification after late Set membership replacement', () => {
    const originalHas = Set.prototype.has;
    const payload = 'globalThis.voidSetXss();//';
    let rendered = '';
    try {
      Set.prototype.has = function replaceVoidMembership(value) {
        if (value === 'script') return true;
        return Reflect.apply(originalHas, this, [value]) as boolean;
      };
      rendered = renderHtmlValue(
        jsx('div', { children: [jsx('script', { children: '' }), payload] }),
      );
    } finally {
      Set.prototype.has = originalHas;
    }

    expect(rendered).toBe(`<div><script></script>${payload}</div>`);
  });

  it('validates runtime element names before raw tag assembly', () => {
    const payload = 'img src=x onerror="dynamicTagXss()"';

    const rendered = renderHtmlValue(jsx(payload, {}));
    expect(rendered).toBe('');
    expect(rendered).not.toContain(payload);
  });

  it('pins intrinsic props against late Object.entries fabrication', () => {
    const originalEntries = Object.entries;
    const props = {};
    const payload = '0;url=javascript:entriesMetaXss()';
    let rendered = '';
    try {
      Object.entries = ((value: object) =>
        value === props
          ? [
              ['http-equiv', 'refresh'],
              ['content', payload],
            ]
          : originalEntries(value)) as typeof Object.entries;
      rendered = renderHtmlValue(jsx('meta', props));
    } finally {
      Object.entries = originalEntries;
    }

    expect(rendered).toBe('<meta>');
    expect(rendered).not.toContain(payload);
  });

  it('keeps nested and promised scalar script children inside the executable-text choke', async () => {
    const arrayPayload = 'globalThis.arrayScriptXss()';
    const promisePayload = 'globalThis.promiseScriptXss()';

    const arrayScript = renderHtmlValue(jsx('script', { children: [arrayPayload] }));
    const promiseScript = renderHtmlValue(
      await jsx('script', { children: Promise.resolve(promisePayload) }),
    );

    expect(arrayScript).toBe('<script></script>');
    expect(arrayScript).not.toContain(arrayPayload);
    expect(promiseScript).toBe('<script></script>');
    expect(promiseScript).not.toContain(promisePayload);
  });

  it('does not let nested rendered HTML launder ordinary text into executable elements', async () => {
    const payload = 'globalThis.renderedChildScriptXss()';
    const fragment = jsx(Fragment, { children: payload });
    const componentChild = jsx(() => payload, {});

    expect(renderHtmlValue(jsx('script', { children: fragment as JsxChild }))).toBe(
      '<script></script>',
    );
    expect(renderHtmlValue(jsx('script', { children: componentChild as JsxChild }))).toBe(
      '<script></script>',
    );
    expect(
      renderHtmlValue(jsx('script', { children: trustedHtml('globalThis.reviewedScript()') })),
    ).toBe('<script>globalThis.reviewedScript()</script>');
  });

  it('pins executable-element and meta-refresh classifiers after late lowercase replacement', () => {
    const originalToLowerCase = String.prototype.toLowerCase;
    const scriptPayload = 'globalThis.lowercaseScriptXss()';
    let script = '';
    let meta = '';
    try {
      String.prototype.toLowerCase = function replaceExecutableClassifiers() {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (value === 'script' || value === 'meta' || value === 'content') return 'div';
        return Reflect.apply(originalToLowerCase, this, []) as string;
      };
      script = renderHtmlValue(jsx('script', { children: scriptPayload }));
      meta = renderHtmlValue(
        jsx('meta', { 'http-equiv': 'refresh', content: '0;url=javascript:metaXss()' }),
      );
    } finally {
      String.prototype.toLowerCase = originalToLowerCase;
    }

    expect(script).toBe('<script></script>');
    expect(script).not.toContain(scriptPayload);
    expect(meta).toBe('<meta http-equiv="refresh">');
    expect(meta).not.toContain('javascript:metaXss()');
  });

  it('does not install a globally discoverable rendered-HTML mint', () => {
    const global = globalThis as typeof globalThis & Record<symbol, unknown>;

    expect(global[Symbol.for('kovo.mutationFormHelperRenderContext')]).toBeUndefined();
  });

  it('treats forged structured helper requests as escaped helper input, never raw output authority', () => {
    const payload = '<img src=x onerror="forgedHelper()">';
    const forged = {
      __kovoMutationFormHelperOperation: 'v1',
      kind: 'form',
      props: {
        failure: { code: 'BLOCKED' },
        message: payload,
      },
    };

    const rendered = renderHtmlValue(jsx('section', { children: forged as unknown as JsxChild }));

    expect(rendered).toContain('&lt;img src=x onerror="forgedHelper()"&gt;');
    expect(rendered).not.toContain(payload);
  });

  it('pins deferred helper parsing, registry access, async settlement, and final composition', async () => {
    const payload = '<img src=x onerror="placeholderReplace()">';
    const helperProps = { name: 'title' };
    const helper = FieldError(helperProps);
    const helperChildren = [helper] as unknown as JsxChild[];
    const promisedChildren = Promise.resolve(helperChildren);
    const originalArrayEvery = Array.prototype.every;
    const originalArrayJoin = Array.prototype.join;
    const originalArrayMap = Array.prototype.map;
    const originalArraySome = Array.prototype.some;
    const originalMapDelete = Map.prototype.delete;
    const originalMapGet = Map.prototype.get;
    const originalMapSet = Map.prototype.set;
    const originalObjectKeys = Object.keys;
    const originalPromiseThen = Promise.prototype.then;
    const originalStringIndexOf = String.prototype.indexOf;
    const originalStringLastIndexOf = String.prototype.lastIndexOf;
    const originalStringReplace = String.prototype.replace;
    const originalStringSlice = String.prototype.slice;
    let rendered: unknown;
    try {
      Array.prototype.every = function (callback, thisArg) {
        if (this === helperChildren) return false;
        return Reflect.apply(originalArrayEvery, this, [callback, thisArg]) as boolean;
      };
      Array.prototype.join = function (separator) {
        if (this === helperChildren) return payload;
        return Reflect.apply(originalArrayJoin, this, [separator]) as string;
      };
      Array.prototype.map = function (callback, thisArg) {
        if (this === helperChildren) return [payload];
        return Reflect.apply(originalArrayMap, this, [callback, thisArg]) as unknown[];
      } as typeof Array.prototype.map;
      Array.prototype.some = function (callback, thisArg) {
        if (this === helperChildren) return false;
        return Reflect.apply(originalArraySome, this, [callback, thisArg]) as boolean;
      };
      Map.prototype.delete = function (key) {
        if (typeof key === 'number') return false;
        return Reflect.apply(originalMapDelete, this, [key]) as boolean;
      };
      Map.prototype.get = function (key) {
        if (typeof key === 'number') return undefined;
        return Reflect.apply(originalMapGet, this, [key]);
      };
      Map.prototype.set = function (key, value) {
        if (typeof key === 'number') return this;
        return Reflect.apply(originalMapSet, this, [key, value]) as typeof this;
      };
      Object.keys = ((value: object) =>
        value === helperProps ? [] : originalObjectKeys(value)) as typeof Object.keys;
      Promise.prototype.then = function (onFulfilled, onRejected) {
        if (this === promisedChildren) throw new Error('late Promise.then replacement ran');
        return Reflect.apply(originalPromiseThen, this, [onFulfilled, onRejected]);
      };
      String.prototype.indexOf = function (search, position) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (value.includes('kovo-form-helper')) return -1;
        return Reflect.apply(originalStringIndexOf, this, [search, position]) as number;
      };
      String.prototype.lastIndexOf = function (search, position) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (value.includes('kovo-form-helper')) return -1;
        return Reflect.apply(originalStringLastIndexOf, this, [search, position]) as number;
      };
      String.prototype.replace = function (search, replacement) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (value.includes('kovo-form-helper')) return payload;
        return Reflect.apply(originalStringReplace, this, [search, replacement]) as string;
      };
      String.prototype.slice = function (start, end) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (value.includes('kovo-form-helper')) return payload;
        return Reflect.apply(originalStringSlice, this, [start, end]) as string;
      };

      rendered = runWithJsxRequestContext(
        {},
        {
          mutationFailure: {
            failure: {
              error: {
                code: 'VALIDATION',
                payload: { issues: [{ message: 'Expected title.', path: ['title'] }] },
              },
              ok: false,
              status: 422,
            },
            mutationKey: 'post/save',
          },
        },
        () => jsx('form', { mutation: postSaveMutation, children: promisedChildren }),
      );
      rendered = await rendered;
    } finally {
      Array.prototype.every = originalArrayEvery;
      Array.prototype.join = originalArrayJoin;
      Array.prototype.map = originalArrayMap;
      Array.prototype.some = originalArraySome;
      Map.prototype.delete = originalMapDelete;
      Map.prototype.get = originalMapGet;
      Map.prototype.set = originalMapSet;
      Object.keys = originalObjectKeys;
      Promise.prototype.then = originalPromiseThen;
      String.prototype.indexOf = originalStringIndexOf;
      String.prototype.lastIndexOf = originalStringLastIndexOf;
      String.prototype.replace = originalStringReplace;
      String.prototype.slice = originalStringSlice;
    }

    const html = renderHtmlValue(rendered);
    expect(html).toContain(
      '<output role="alert" data-error-code="VALIDATION">Expected title.</output>',
    );
    expect(html).not.toContain(payload);
    expect(html).not.toContain('kovo-form-helper');
  });

  it('pins mutation form attribute assembly after late Array.join replacement', () => {
    const originalJoin = Array.prototype.join;
    const payload = '><img src=x onerror="attributeJoin()">';
    let rendered = '';
    try {
      Array.prototype.join = function replaceMutationAttributes(separator) {
        if (this[0] === ' method="post"') return payload;
        return Reflect.apply(originalJoin, this, [separator]) as string;
      };
      rendered = renderHtmlValue(jsx('form', { mutation: postSaveMutation, children: '' }));
    } finally {
      Array.prototype.join = originalJoin;
    }

    expect(rendered).toContain('method="post" action="/_m/post/save"');
    expect(rendered).not.toContain(payload);
  });

  it('keeps request-local helper tokens cryptographic after late entropy replacement', () => {
    const cryptoPrototype = Object.getPrototypeOf(globalThis.crypto) as {
      getRandomValues: typeof globalThis.crypto.getRandomValues;
    };
    const originalGetRandomValues = cryptoPrototype.getRandomValues;
    let first = '';
    let second = '';
    try {
      cryptoPrototype.getRandomValues = function <Value extends ArrayBufferView | null>(
        value: Value,
      ): Value {
        if (value !== null) {
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(0);
        }
        return value;
      };
      first = runWithJsxRequestContext({}, () =>
        String(currentJsxMutationFormHelperRegistry()?.token),
      );
      second = runWithJsxRequestContext({}, () =>
        String(currentJsxMutationFormHelperRegistry()?.token),
      );
    } finally {
      cryptoPrototype.getRandomValues = originalGetRandomValues;
    }

    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(second).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(first).not.toBe(second);
  });

  it('binds deferred helper code filters to their registration-time snapshot', () => {
    const rendered = runWithJsxRequestContext(
      {},
      {
        mutationFailure: {
          failure: {
            error: { code: 'BLOCKED', payload: {} },
            ok: false,
            status: 422,
          },
          mutationKey: 'post/save',
        },
      },
      () => {
        const codes = ['BLOCKED'];
        const deferred = jsx(FormError, { code: codes, message: 'Pinned blocked message.' });
        codes[0] = 'OTHER';
        return jsx('form', { mutation: postSaveMutation, children: deferred });
      },
    );

    expect(renderHtmlValue(rendered)).toContain('Pinned blocked message.');
  });

  it('rejects a marker signed with a pre-import synchronized known randomBytes key', async () => {
    const require = createRequire(import.meta.url);
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const originalRandomBytes = crypto.randomBytes;
    const attacker = '<svg onload="knownEntropy()"></svg>';
    let forged = '';
    try {
      crypto.randomBytes = ((size: number) =>
        Buffer.alloc(size, 0x6b)) as typeof crypto.randomBytes;
      syncBuiltinESMExports();

      const html = await import('./html.ts?known-entropy-regression');
      const payload = Buffer.from(attacker, 'utf8').toString('base64url');
      const key = Buffer.alloc(32, 0x6b);
      const signature = createHmac('sha256', key).update(payload).digest('base64url');
      forged = html.renderHtmlValue(`\uE000kovo-rendered-html:v2:${payload}.${signature}\uE001`);
    } finally {
      crypto.randomBytes = originalRandomBytes;
      syncBuiltinESMExports();
    }

    expect(forged).not.toContain(attacker);
    expect(forged).toContain('kovo-rendered-html:v2');
  });

  it('pins marker parsing, HMAC creation, and constant-time comparison after late poisoning', () => {
    const require = createRequire(import.meta.url);
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const originalCreateHmac = crypto.createHmac;
    const originalTimingSafeEqual = crypto.timingSafeEqual;
    const originalStringIncludes = String.prototype.includes;
    const originalStringIndexOf = String.prototype.indexOf;
    const originalStringLastIndexOf = String.prototype.lastIndexOf;
    const originalStringSlice = String.prototype.slice;
    const markerPrefix = '\uE000kovo-rendered-html:v2:';
    const attacker = '<img src=x onerror="lateMarker()">';
    const payload = Buffer.from(attacker, 'utf8').toString('base64url');
    const forgedMarker = `${markerPrefix}${payload}.${'A'.repeat(43)}\uE001`;
    const genuineMarker = (renderedHtml('<strong>genuine</strong>') as unknown as string) + '';
    let genuine = '';
    let forged = '';
    try {
      crypto.createHmac = (() => ({
        digest: () => 'A'.repeat(43),
        update() {
          return this;
        },
      })) as unknown as typeof crypto.createHmac;
      crypto.timingSafeEqual = (() => true) as typeof crypto.timingSafeEqual;
      syncBuiltinESMExports();
      String.prototype.includes = function (search, position) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (Reflect.apply(originalStringIncludes, value, [markerPrefix])) return false;
        return Reflect.apply(originalStringIncludes, this, [search, position]) as boolean;
      };
      String.prototype.indexOf = function (search, position) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (Reflect.apply(originalStringIncludes, value, [markerPrefix])) return -1;
        return Reflect.apply(originalStringIndexOf, this, [search, position]) as number;
      };
      String.prototype.lastIndexOf = function (search, position) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (Reflect.apply(originalStringIncludes, value, [markerPrefix])) return -1;
        return Reflect.apply(originalStringLastIndexOf, this, [search, position]) as number;
      };
      String.prototype.slice = function (start, end) {
        const value = Reflect.apply(String, undefined, [this]) as string;
        if (Reflect.apply(originalStringIncludes, value, [markerPrefix])) return payload;
        return Reflect.apply(originalStringSlice, this, [start, end]) as string;
      };

      genuine = renderHtmlValue(genuineMarker);
      forged = renderHtmlValue(forgedMarker);
    } finally {
      crypto.createHmac = originalCreateHmac;
      crypto.timingSafeEqual = originalTimingSafeEqual;
      syncBuiltinESMExports();
      String.prototype.includes = originalStringIncludes;
      String.prototype.indexOf = originalStringIndexOf;
      String.prototype.lastIndexOf = originalStringLastIndexOf;
      String.prototype.slice = originalStringSlice;
    }

    expect(genuine).toBe('<strong>genuine</strong>');
    expect(forged).not.toContain(attacker);
  });
});
