/* oxlint-disable typescript/unbound-method -- Tests retain then restore deliberately poisoned methods. */
import { describe, expect, it } from 'vitest';

import { renderPage } from './render.mjs';
import { renderStyleElement } from './output-security.mjs';

function baseRenderOptions() {
  return {
    app: 'demo',
    bundle: {
      app: 'demo',
      blurb: 'Demo bundle',
      counts: { domain: 1 },
      edges: [],
      label: 'Demo',
      nodes: [
        {
          data: {},
          id: 'domain:orders',
          kind: 'domain',
          label: 'Orders',
          name: 'orders',
        },
      ],
    },
    manifest: [{ blurb: 'Demo app', id: 'demo', label: 'Demo' }],
    pzHref: '/c/devtool.js',
  };
}

describe('devtool renderPage', () => {
  it('escapes hostile input at HTML attribute sinks', () => {
    const hostile = `x" autofocus onfocus="alert(1)`;
    const html = renderPage({
      app: hostile,
      bundle: {
        app: hostile,
        counts: { component: 1, mutation: 1, query: 1 },
        edges: [
          {
            from: `query-${hostile}`,
            id: `edge-${hostile}`,
            kind: 'feeds',
            to: `component-${hostile}`,
          },
          {
            from: `component-${hostile}`,
            id: 'edge-2',
            kind: 'emits',
            to: `mutation-${hostile}`,
          },
        ],
        label: `Bundle ${hostile}`,
        nodes: [
          {
            data: { domains: [`domain-${hostile}`] },
            id: `query-${hostile}`,
            kind: 'query',
            label: `Query ${hostile}`,
            name: `queryName-${hostile}`,
          },
          {
            data: { domName: `section-${hostile}`, fragments: [`frag-${hostile}`] },
            id: `component-${hostile}`,
            kind: 'component',
            label: `Component ${hostile}`,
            name: `componentName-${hostile}`,
          },
          {
            data: {
              inputFields: [`field-${hostile}`],
              optimistic: [
                {
                  derivation: { reason: { code: hostile }, status: 'PUNTED' },
                  query: `queryName-${hostile}`,
                  status: 'hand-written',
                },
              ],
              writes: [`domain-${hostile}`],
            },
            id: `mutation-${hostile}`,
            kind: 'mutation',
            label: `Mutation ${hostile}`,
            name: `mutationName-${hostile}`,
          },
        ],
      },
      manifest: [{ blurb: `Blurb ${hostile}`, id: hostile, label: `App ${hostile}` }],
      pzHref: `/c/devtool.js" onclick="alert(1)`,
      q: hostile,
      sel: `component-${hostile}`,
    });

    expect(html).toContain('&quot;');
    expect(html).toContain('autofocus onfocus=&quot;alert(1)');
    expect(html).not.toContain(`value="${hostile}"`);
    expect(html).not.toContain(`href="?app=${hostile}`);
    expect(html).not.toContain(`on:visible="/c/devtool.js" onclick="alert(1)#Devtool$init"`);
    expect(html).not.toContain(`data-node-id="component-${hostile}"`);
  });

  it('escapes every rendered graph-card and source-slice text carrier', () => {
    const hostile = '<img src=x onerror=alert(7)>';
    const source = {
      anchorLine: 1,
      code: `export const value = "${hostile}";`,
      endLine: 1,
      file: `src/${hostile}.ts`,
      lang: hostile,
      startLine: 1,
      touches: [
        {
          domain: hostile,
          keys: hostile,
          site: `src/domain.ts:1/${hostile}`,
          via: hostile,
        },
      ],
    };
    const options = {
      app: 'demo',
      bundle: {
        app: 'demo',
        blurb: hostile,
        counts: {},
        edges: [
          { from: 'mutation:m', id: 'writes', kind: 'writes', to: 'domain:d' },
          { from: 'domain:d', id: 'backs', kind: 'backs', to: 'query:q' },
          { from: 'query:q', id: 'feeds', kind: 'feeds', to: 'component:c' },
          { from: 'component:c', id: 'emits', kind: 'emits', to: 'mutation:m' },
          { from: 'page:p', id: 'renders', kind: 'renders', to: 'component:c' },
        ],
        label: hostile,
        nodes: [
          {
            data: {
              guards: [hostile],
              inputFields: [hostile],
              optimistic: [
                {
                  derivation: {
                    reason: {
                      code: hostile,
                      column: hostile,
                      columns: [hostile],
                      detail: hostile,
                      expr: hostile,
                      field: hostile,
                      shape: hostile,
                      site: hostile,
                      table: hostile,
                    },
                    status: 'PUNTED',
                  },
                  query: 'q',
                  status: 'UNHANDLED',
                },
              ],
              writes: [hostile],
            },
            id: 'mutation:m',
            kind: 'mutation',
            label: hostile,
            name: hostile,
            source,
          },
          {
            data: { guards: [hostile] },
            id: 'domain:d',
            kind: 'domain',
            label: hostile,
            name: hostile,
            source,
          },
          {
            data: { domains: [hostile], guards: [hostile] },
            id: 'query:q',
            kind: 'query',
            label: hostile,
            name: 'q',
            source,
          },
          {
            data: {
              domName: hostile,
              fragments: [hostile],
              guards: [hostile],
              mutationForms: [{ fields: [hostile], mutation: hostile }],
              queries: [hostile],
            },
            id: 'component:c',
            kind: 'component',
            label: hostile,
            name: hostile,
            source,
          },
          {
            data: { guards: [hostile], meta: { description: hostile, title: hostile } },
            id: 'page:p',
            kind: 'page',
            label: hostile,
            name: hostile,
            source,
          },
        ],
      },
      manifest: [{ blurb: hostile, id: 'demo', label: hostile }],
      pzHref: '/c/devtool.js',
      q: hostile,
    };

    for (const sel of ['mutation:m', 'domain:d', 'query:q', 'component:c', 'page:p']) {
      const html = renderPage({ ...options, sel });
      expect(html).toContain('&lt;img src=x onerror=alert(7)&gt;');
      expect(html).not.toContain(hostile);
    }
  });

  it('keeps hostile search text escaped after late String.replace poisoning', () => {
    const hostile = '</span><img src=x onerror=alert(1)>';
    const options = { ...baseRenderOptions(), q: hostile };
    const originalReplace = String.prototype.replace;
    let html;

    try {
      String.prototype.replace = function () {
        return String(this);
      };
      html = renderPage(options);
    } finally {
      String.prototype.replace = originalReplace;
    }

    expect(html).toContain('&lt;/span&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain(hostile);
  });

  it('rejects node kinds outside the closed runtime vocabulary before rendering', () => {
    const hostile = '</span><img src=x onerror=alert(2)>';
    const options = baseRenderOptions();
    options.bundle.nodes[0].kind = hostile;
    options.q = 'orders';

    expect(() => renderPage(options)).toThrow(/bundle\.nodes\[0\]\.kind is not supported/u);
  });

  it('preserves the normative UNHANDLED optimistic-coverage status inside the closed vocabulary', () => {
    const options = baseRenderOptions();
    options.bundle.nodes = [
      {
        data: {
          optimistic: [{ query: 'orderHistory', status: 'UNHANDLED' }],
          writes: ['orders'],
        },
        id: 'mutation:updateOrder',
        kind: 'mutation',
        label: 'Update order',
        name: 'updateOrder',
      },
      {
        data: { domains: ['orders'] },
        id: 'query:orderHistory',
        kind: 'query',
        label: 'Order history',
        name: 'orderHistory',
      },
    ];
    options.sel = 'mutation:updateOrder';

    const html = renderPage(options);

    expect(html).toContain('<span class="badge badge--none">UNHANDLED</span>');
  });

  it('removes caller-controlled stylesheet authority from renderPage', () => {
    const options = {
      ...baseRenderOptions(),
      css: '</style><script>globalThis.pwned = true</script><style>',
    };

    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalSlice = String.prototype.slice;
    let style;

    try {
      String.prototype.charCodeAt = () => 65;
      String.prototype.slice = () => '</style><script>alert(2)</script>';
      style = renderStyleElement('</style><script>alert(1)</script>');
    } finally {
      String.prototype.charCodeAt = originalCharCodeAt;
      String.prototype.slice = originalSlice;
    }

    expect(() => renderPage(options)).toThrow(/no longer accepts caller CSS/u);
    expect(style).toBe('<style>\\3c /style>\\3c script>alert(1)\\3c /script></style>');
  });

  it('rejects hostile source line metadata instead of interpolating it', () => {
    const hostile = '</span><img src=x onerror=alert(3)>';
    const options = baseRenderOptions();
    options.bundle.nodes[0].source = {
      anchorLine: 1,
      code: 'export const orders = domain();',
      endLine: 1,
      file: 'src/orders.ts',
      lang: 'ts',
      startLine: hostile,
    };
    options.sel = 'domain:orders';

    expect(() => renderPage(options)).toThrow(/source\.startLine must be a positive safe integer/u);
  });

  it('does not dispatch manifest rendering through a late Array.map override', () => {
    const hostile = '<img src=x onerror=alert(4)>';
    const options = baseRenderOptions();
    const manifest = options.manifest;
    const originalMap = Array.prototype.map;
    let html;

    try {
      Array.prototype.map = function (callback, thisArg) {
        if (this === manifest) return [hostile];
        return Reflect.apply(originalMap, this, [callback, thisArg]);
      };
      html = renderPage(options);
    } finally {
      Array.prototype.map = originalMap;
    }

    expect(html).toContain('<b>Demo</b><small>Demo app</small>');
    expect(html).not.toContain(hostile);
  });

  it('keeps reconstruction, ranking, and escaping on boot-pinned controls after broad late poisoning', () => {
    const hostile = '<img src=x onerror=alert(5)>';
    const options = baseRenderOptions();
    options.bundle.nodes[0].source = {
      anchorLine: 1,
      code: hostile,
      endLine: 1,
      file: 'src/orders.ts',
      lang: 'ts',
      startLine: 1,
    };
    options.sel = 'domain:orders';
    options.q = 'orders';
    const originals = {
      arrayFilter: Array.prototype.filter,
      arrayIncludes: Array.prototype.includes,
      arrayIsArray: Array.isArray,
      arrayJoin: Array.prototype.join,
      arrayMap: Array.prototype.map,
      arrayReduce: Array.prototype.reduce,
      arraySlice: Array.prototype.slice,
      arraySort: Array.prototype.sort,
      encodeURIComponent: globalThis.encodeURIComponent,
      mapGet: Map.prototype.get,
      mapHas: Map.prototype.has,
      mapSet: Map.prototype.set,
      mathLog: Math.log,
      numberIsFinite: Number.isFinite,
      numberIsSafeInteger: Number.isSafeInteger,
      numberToFixed: Number.prototype.toFixed,
      objectDefineProperty: Object.defineProperty,
      objectFreeze: Object.freeze,
      objectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
      objectGetPrototypeOf: Object.getPrototypeOf,
      objectIs: Object.is,
      objectIsFrozen: Object.isFrozen,
      reflectApply: Reflect.apply,
      regexpExec: RegExp.prototype.exec,
      regexpTest: RegExp.prototype.test,
      setAdd: Set.prototype.add,
      setHas: Set.prototype.has,
      stringCharCodeAt: String.prototype.charCodeAt,
      stringReplace: String.prototype.replace,
      stringSlice: String.prototype.slice,
      stringSplit: String.prototype.split,
      stringStartsWith: String.prototype.startsWith,
      stringToLowerCase: String.prototype.toLowerCase,
      stringTrim: String.prototype.trim,
    };
    let html;

    try {
      Array.isArray = () => false;
      Array.prototype.filter = () => [hostile];
      Array.prototype.includes = () => false;
      Array.prototype.join = () => hostile;
      Array.prototype.map = () => [hostile];
      Array.prototype.reduce = () => hostile;
      Array.prototype.slice = () => [hostile];
      Array.prototype.sort = () => [hostile];
      globalThis.encodeURIComponent = () => hostile;
      Map.prototype.get = () => hostile;
      Map.prototype.has = () => false;
      Map.prototype.set = function () {
        return this;
      };
      Math.log = () => 0;
      Number.isFinite = () => false;
      Number.isSafeInteger = () => false;
      Number.prototype.toFixed = () => hostile;
      Object.defineProperty = () => ({});
      Object.freeze = (value) => value;
      Object.getOwnPropertyDescriptor = () => ({
        configurable: true,
        enumerable: true,
        value: hostile,
        writable: true,
      });
      Object.getPrototypeOf = () => Object.prototype;
      Object.is = () => false;
      Object.isFrozen = () => false;
      Reflect.apply = () => hostile;
      RegExp.prototype.exec = () => null;
      RegExp.prototype.test = () => false;
      Set.prototype.add = function () {
        return this;
      };
      Set.prototype.has = () => false;
      String.prototype.charCodeAt = () => 65;
      String.prototype.replace = function () {
        return String(this);
      };
      String.prototype.slice = () => hostile;
      String.prototype.split = () => [hostile];
      String.prototype.startsWith = () => false;
      String.prototype.toLowerCase = () => hostile;
      String.prototype.trim = () => '';
      html = renderPage(options);
    } finally {
      Array.prototype.filter = originals.arrayFilter;
      Array.prototype.includes = originals.arrayIncludes;
      Array.isArray = originals.arrayIsArray;
      Array.prototype.join = originals.arrayJoin;
      Array.prototype.map = originals.arrayMap;
      Array.prototype.reduce = originals.arrayReduce;
      Array.prototype.slice = originals.arraySlice;
      Array.prototype.sort = originals.arraySort;
      globalThis.encodeURIComponent = originals.encodeURIComponent;
      Map.prototype.get = originals.mapGet;
      Map.prototype.has = originals.mapHas;
      Map.prototype.set = originals.mapSet;
      Math.log = originals.mathLog;
      Number.isFinite = originals.numberIsFinite;
      Number.isSafeInteger = originals.numberIsSafeInteger;
      Number.prototype.toFixed = originals.numberToFixed;
      Object.defineProperty = originals.objectDefineProperty;
      Object.freeze = originals.objectFreeze;
      Object.getOwnPropertyDescriptor = originals.objectGetOwnPropertyDescriptor;
      Object.getPrototypeOf = originals.objectGetPrototypeOf;
      Object.is = originals.objectIs;
      Object.isFrozen = originals.objectIsFrozen;
      Reflect.apply = originals.reflectApply;
      RegExp.prototype.exec = originals.regexpExec;
      RegExp.prototype.test = originals.regexpTest;
      Set.prototype.add = originals.setAdd;
      Set.prototype.has = originals.setHas;
      String.prototype.charCodeAt = originals.stringCharCodeAt;
      String.prototype.replace = originals.stringReplace;
      String.prototype.slice = originals.stringSlice;
      String.prototype.split = originals.stringSplit;
      String.prototype.startsWith = originals.stringStartsWith;
      String.prototype.toLowerCase = originals.stringToLowerCase;
      String.prototype.trim = originals.stringTrim;
    }

    expect(html).toContain('BM25 · 1 matches');
    expect(html).toContain('q=orders');
    expect(html).toContain('&lt;img');
    expect(html).toContain(')&gt;');
    expect(html).not.toContain(hostile);
  });

  it('never invokes getters while reconstructing runtime carriers', () => {
    const options = baseRenderOptions();
    let reads = 0;
    Object.defineProperty(options.bundle.nodes[0], 'label', {
      enumerable: true,
      get() {
        reads += 1;
        return '<img src=x onerror=alert(6)>';
      },
    });

    expect(() => renderPage(options)).toThrow(/label/u);
    expect(reads).toBe(0);
  });

  it('does not mistake accessors for data after Object.prototype value pollution', () => {
    const options = baseRenderOptions();
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
    let reads = 0;
    let failure;
    Object.defineProperty(options.bundle.nodes[0], 'label', {
      enumerable: true,
      get() {
        reads += 1;
        return 'getter result';
      },
    });

    try {
      Object.defineProperty(Object.prototype, 'value', {
        configurable: true,
        value: '<img src=x onerror=alert(8)>',
        writable: true,
      });
      try {
        renderPage(options);
      } catch (error) {
        failure = error;
      }
    } finally {
      if (originalValue === undefined) delete Object.prototype.value;
      else Object.defineProperty(Object.prototype, 'value', originalValue);
    }

    expect(failure).toBeInstanceOf(TypeError);
    expect(failure.message).toMatch(/bundle\.nodes\[0\]\.label.*(?:changed|own data property)/u);
    expect(reads).toBe(0);
  });

  it('rejects a proxy that changes an authority field during reconstruction', () => {
    const options = baseRenderOptions();
    const target = options.manifest[0];
    let reads = 0;
    options.manifest[0] = new Proxy(target, {
      getOwnPropertyDescriptor(record, key) {
        if (key !== 'id') return Reflect.getOwnPropertyDescriptor(record, key);
        reads += 1;
        return {
          configurable: true,
          enumerable: true,
          value: reads === 1 ? 'demo' : 'attacker',
          writable: true,
        };
      },
    });

    expect(() => renderPage(options)).toThrow(/manifest\[0\]\.id changed while it was inspected/u);
  });

  it('rejects an array proxy that changes an entry during reconstruction', () => {
    const options = baseRenderOptions();
    const target = options.manifest;
    let reads = 0;
    options.manifest = new Proxy(target, {
      getOwnPropertyDescriptor(record, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
        if (key !== '0' || descriptor === undefined) return descriptor;
        reads += 1;
        return {
          ...descriptor,
          value:
            reads === 1
              ? descriptor.value
              : { blurb: '', id: 'attacker', label: '<img src=x onerror=alert(9)>' },
        };
      },
    });

    expect(() => renderPage(options)).toThrow(/manifest\[0\] changed while it was inspected/u);
  });
});
