import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';

import { applyBindProp } from './bind-prop.js';
import { createDocumentLifecycleRecovery } from './document-lifecycle.js';
import { isAllowedKovoDynamicImportUrl } from './dynamic-import-url.js';
import { installEnhancedNavigationRuntime } from './enhanced-navigation.js';
import { DomMorphRoot, applyFragments } from './morph.js';
import { createBrowserNavigationSecurityControls } from './navigation-security-intrinsics.js';
import { applyCompiledQueryUpdatePlan, applyStateBindings } from './query-bindings.js';
import { applyHtmlResponseFragments } from './response-fragment-apply.js';
import { kovoTrustedHtmlContent, safeRichHtml } from './security-output.js';
import { StreamTextBuffer } from './stream-text.js';
import { readInlineMutationResponseBodyChunks } from './wire-response-scanner.js';

const originalTrim = String.prototype.trim;
const originalLowerCase = String.prototype.toLowerCase;
const originalHasOwnCallDescriptor = Object.getOwnPropertyDescriptor(
  Object.prototype.hasOwnProperty,
  'call',
);
const originalInnerHtmlLowerDescriptor = Object.getOwnPropertyDescriptor(
  Object.prototype,
  'innerhtml',
);
const originalInnerHtmlDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'innerHTML');
const originalOuterHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');

afterEach(() => {
  String.prototype.trim = originalTrim;
  String.prototype.toLowerCase = originalLowerCase;
  if (originalHasOwnCallDescriptor === undefined) {
    Reflect.deleteProperty(Object.prototype.hasOwnProperty, 'call');
  } else {
    Object.defineProperty(Object.prototype.hasOwnProperty, 'call', originalHasOwnCallDescriptor);
  }
  if (originalInnerHtmlLowerDescriptor === undefined) {
    Reflect.deleteProperty(Object.prototype, 'innerhtml');
  } else {
    Object.defineProperty(Object.prototype, 'innerhtml', originalInnerHtmlLowerDescriptor);
  }
  if (originalInnerHtmlDescriptor === undefined) {
    Reflect.deleteProperty(Object.prototype, 'innerHTML');
  } else {
    Object.defineProperty(Object.prototype, 'innerHTML', originalInnerHtmlDescriptor);
  }
  if (originalOuterHtmlDescriptor !== undefined) {
    Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHtmlDescriptor);
  }
  document.body.replaceChildren();
  document.head
    .querySelectorAll(
      'base[data-browser-runtime-security], meta[name="kovo-build"], meta[name="kovo-session"]',
    )
    .forEach((element) => element.remove());
  delete (globalThis as typeof globalThis & { __bindPropOwned?: number }).__bindPropOwned;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser-runtime security regressions', () => {
  it('keeps witnessed fragment bytes authoritative after late trim replacement', () => {
    const safeHtml = '<section kovo-fragment-target="account">SERVER-SAFE</section>';
    const hostileHtml = '<base data-browser-runtime-security href="https://attacker.example/">';
    const originalBase = document.baseURI;
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'account');
    target.textContent = 'CURRENT-SAFE';
    document.body.append(target);

    String.prototype.trim = function () {
      if (String(this) === safeHtml) return hostileHtml;
      return Reflect.apply(originalTrim, this, []);
    };

    const applied = applyFragments(new DomMorphRoot(document), [
      { html: createRenderedFragmentHtml(safeHtml), target: 'account' },
    ]);

    expect(applied).toEqual(['account']);
    expect(document.querySelector('base[data-browser-runtime-security]')).toBeNull();
    expect(document.baseURI).toBe(originalBase);
    expect(document.querySelector('[kovo-fragment-target="account"]')?.textContent).toBe(
      'SERVER-SAFE',
    );
  });

  it('keeps compiler-rendered template stamp bytes authoritative after late trim replacement', () => {
    const safeHtml = '<li>SERVER-SAFE</li>';
    const hostileHtml = '<base data-browser-runtime-security href="https://attacker.example/">';
    const list = document.createElement('ul');
    list.setAttribute('id', 'security-list');
    list.innerHTML = '<template kovo-stamp><li></li></template>';
    document.body.append(list);
    const originalBase = document.baseURI;

    String.prototype.trim = function () {
      if (String(this) === safeHtml) return hostileHtml;
      return Reflect.apply(originalTrim, this, []);
    };

    applyCompiledQueryUpdatePlan(
      document,
      'inventory',
      { items: [{ id: 'item-1' }] },
      {
        templateStamps: [
          {
            key: 'id',
            list: 'items',
            render: () => safeHtml,
            selector: '#security-list',
          },
        ],
      },
    );

    expect(document.querySelector('base[data-browser-runtime-security]')).toBeNull();
    expect(document.baseURI).toBe(originalBase);
    expect(list.querySelector('li[kovo-key="item-1"]')?.textContent).toBe('SERVER-SAFE');
  });

  it('keeps inline wire fragment bytes authoritative after late slice replacement', () => {
    const safeContent = '<section kovo-fragment-target="account">SERVER-SAFE</section>';
    const hostileHtml = '<base data-browser-runtime-security href="https://attacker.example/">';
    const body = `<kovo-fragment target="account">${safeContent}</kovo-fragment>`;
    const contentStart = body.indexOf(safeContent);
    const contentEnd = contentStart + safeContent.length;
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'account');
    target.textContent = 'CURRENT-SAFE';
    document.body.append(target);
    const originalBase = document.baseURI;

    const originalSlice = String.prototype.slice;
    String.prototype.slice = function (start?: number, end?: number) {
      if (String(this) === body && start === contentStart && end === contentEnd) {
        return hostileHtml;
      }
      return Reflect.apply(originalSlice, this, [start, end]);
    };
    try {
      const chunks = readInlineMutationResponseBodyChunks(body);
      const applied = applyHtmlResponseFragments(chunks.fragments, (name) =>
        name === 'account' ? target : null,
      );

      expect(applied).toEqual(['account']);
      expect(document.querySelector('base[data-browser-runtime-security]')).toBeNull();
      expect(document.baseURI).toBe(originalBase);
      expect(target.textContent).toBe('SERVER-SAFE');
    } finally {
      String.prototype.slice = originalSlice;
    }
  });

  it('applies the scanned fragment array by index after late iterator replacement', () => {
    const safeContent = '<section kovo-fragment-target="account">SERVER-SAFE</section>';
    const hostileHtml = '<base data-browser-runtime-security href="https://attacker.example/">';
    const body = `<kovo-fragment target="account">${safeContent}</kovo-fragment>`;
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'account');
    target.textContent = 'CURRENT-SAFE';
    document.body.append(target);
    const originalBase = document.baseURI;
    const chunks = readInlineMutationResponseBodyChunks(body);
    const fragments = chunks.fragments;
    const originalIterator = Array.prototype[Symbol.iterator];

    try {
      Array.prototype[Symbol.iterator] = function () {
        if (this === fragments) {
          return [
            {
              html: {
                html: hostileHtml,
                toJSON: () => hostileHtml,
                toString: () => hostileHtml,
              },
              target: 'account',
            },
          ][Symbol.iterator]();
        }
        return Reflect.apply(originalIterator, this, []);
      };
      applyHtmlResponseFragments(fragments, (name) => (name === 'account' ? target : null));
    } finally {
      Array.prototype[Symbol.iterator] = originalIterator;
    }

    expect(document.querySelector('base[data-browser-runtime-security]')).toBeNull();
    expect(document.baseURI).toBe(originalBase);
    expect(target.textContent).toBe('SERVER-SAFE');
  });

  it('keeps a genuine dialog open binding on the closed property allowlist after pollution', () => {
    const payload =
      '<img id="bugz-owned" src="/missing-bugz-image" onerror="globalThis.__bindPropOwned=1">';
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-bind-prop:open', 'state.open');
    document.body.append(dialog);

    const intrinsicHasOwn = Object.prototype.hasOwnProperty;
    Object.defineProperty(Object.prototype.hasOwnProperty, 'call', {
      configurable: true,
      value: (receiver: object, key: PropertyKey) =>
        key === 'open' ? false : Reflect.apply(intrinsicHasOwn, receiver, [key]),
      writable: true,
    });
    String.prototype.toLowerCase = function () {
      if (String(this) === 'open') return 'innerhtml';
      return Reflect.apply(originalLowerCase, this, []);
    };
    Object.defineProperty(Object.prototype, 'innerhtml', {
      configurable: true,
      value: 'innerHTML',
      writable: true,
    });
    Object.defineProperty(Object.prototype, 'innerHTML', {
      configurable: true,
      value: 'string',
      writable: true,
    });

    applyBindProp(dialog, 'open', payload);

    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('#bugz-owned')).toBeNull();
    expect((globalThis as typeof globalThis & { __bindPropOwned?: number }).__bindPropOwned).toBe(
      undefined,
    );
  });

  it('uses stable snapshots for same-session segment equality after late outerHTML replacement', async () => {
    if (!originalOuterHtmlDescriptor?.get) throw new Error('outerHTML getter unavailable');
    document.head.innerHTML = [
      '<meta name="kovo-build" content="build-a">',
      '<meta name="kovo-session" content="same-principal">',
    ].join('');
    document.body.innerHTML = [
      '<main kovo-nav-segment="layout:Account" kovo-nav-kind="layout" kovo-nav-name="Account">',
      '<section kovo-nav-segment="page:/orders" kovo-nav-kind="page" kovo-nav-name="orders" kovo-nav-components="Orders">',
      '<p id="privileged-old">PRIVILEGED-OLD</p>',
      '</section>',
      '</main>',
    ].join('');
    const targetHtml = [
      '<!doctype html><html><head>',
      '<meta name="kovo-build" content="build-a">',
      '<meta name="kovo-session" content="same-principal">',
      '</head><body>',
      '<main kovo-nav-segment="layout:Account" kovo-nav-kind="layout" kovo-nav-name="Account">',
      '<section kovo-nav-segment="page:/orders" kovo-nav-kind="page" kovo-nav-name="orders" kovo-nav-components="Orders">',
      '<p id="revoked-next">ACCESS-REVOKED</p>',
      '</section>',
      '</main>',
      '</body></html>',
    ].join('');
    vi.stubGlobal('fetch', async () => ({
      headers: { get: (name: string) => (name === 'content-type' ? 'text/html' : null) },
      text: async () => targetHtml,
      url: new URL('/orders?page=2', location.href).href,
    }));
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => undefined);
    vi.stubGlobal('scrollTo', vi.fn());

    const runtime = installEnhancedNavigationRuntime({
      acceptHeader: 'text/html',
      applyDocumentElementAttributes() {},
      applyHead() {},
      applyStylePromotion() {},
      document,
      morph(current, next) {
        current.replaceWith(next);
        return next;
      },
      queryAll(root, selector) {
        return [...root.querySelectorAll(selector)];
      },
      replayScripts() {},
      replaceBody(nextBody) {
        document.body.replaceWith(nextBody);
        return nextBody;
      },
      replaceElementAttributes() {},
      runTriggers() {},
    });

    const nativeOuterHtmlGet = originalOuterHtmlDescriptor.get;
    Object.defineProperty(Element.prototype, 'outerHTML', {
      ...originalOuterHtmlDescriptor,
      get(this: Element) {
        if (this.getAttribute('kovo-nav-segment') === 'page:/orders') {
          return '<section data-forged-same="true"></section>';
        }
        return Reflect.apply(nativeOuterHtmlGet, this, []);
      },
    });

    await runtime.navigate('/orders?page=2');

    expect(pushState).toHaveBeenCalledWith({}, '', new URL('/orders?page=2', location.href).href);
    expect(document.querySelector('#privileged-old')).toBeNull();
    expect(document.querySelector('#revoked-next')?.textContent).toBe('ACCESS-REVOKED');
  });

  it('uses stable snapshots when reconstructing fetched live-target fragments', async () => {
    if (!originalOuterHtmlDescriptor?.get) throw new Error('outerHTML getter unavailable');
    const safeHtml = [
      '<!doctype html><html><body>',
      '<section kovo-fragment-target="account">SERVER-SAFE</section>',
      '</body></html>',
    ].join('');
    const target = document.createElement('section');
    target.setAttribute('kovo-fragment-target', 'account');
    target.textContent = 'CURRENT-SAFE';
    document.body.append(target);
    const originalBase = document.baseURI;
    const security = createBrowserNavigationSecurityControls();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(safeHtml, { status: 200 })),
    );

    const recovery = createDocumentLifecycleRecovery({
      acceptHeader: 'text/html',
      addLifecycleEventListener: (type, listener) =>
        security.addLifecycleEventListener(globalThis, type, listener),
      applyBody(body) {
        const chunks = readInlineMutationResponseBodyChunks(body);
        applyHtmlResponseFragments(chunks.fragments, (name) =>
          name === 'account' ? target : null,
        );
      },
      buildHeader: () => '',
      currentBuild: () => '',
      currentHref: () => security.currentUrl()?.href,
      document,
      encodeAttribute: (value) => value,
      fetchValue: (input, init) => security.fetchValue(input, init),
      findTarget(root, name) {
        return root.querySelector(`[kovo-fragment-target="${name}"]`) ?? undefined;
      },
      liveTargets: () => ['account#account@tok_account:{}'],
      parseHtmlDocument: (value) => security.parseHtmlDocument(value),
      queryOne: (root, selector) => security.queryOne(root, selector),
      queryAll: (root, selector) => [...root.querySelectorAll(selector)],
      queryUrl: () => '',
      readAttribute: () => null,
      readElementAttribute: () => ({ present: false }),
      readPageTransitionPersisted: (event) => security.readPageTransitionPersisted(event),
      readResponseStatus: (response) => {
        const status = security.readResponseField(response, 'status');
        return typeof status === 'number' ? status : undefined;
      },
      readResponseText: (response) => security.readResponseText(response),
      reload: () => security.reload(),
      snapshotElementHtml: (element) => security.readElementOuterHtml(element),
      targetHeader: () => [],
      wireKey: () => '',
    });

    const nativeOuterHtmlGet = originalOuterHtmlDescriptor.get;
    Object.defineProperty(Element.prototype, 'outerHTML', {
      ...originalOuterHtmlDescriptor,
      get(this: Element) {
        if (
          this.ownerDocument !== document &&
          this.getAttribute('kovo-fragment-target') === 'account'
        ) {
          return '<base data-browser-runtime-security href="https://attacker.example/">';
        }
        return Reflect.apply(nativeOuterHtmlGet, this, []);
      },
    });

    recovery.refreshLiveTargets();

    await vi.waitFor(() => expect(target.textContent).toBe('SERVER-SAFE'));
    expect(document.querySelector('base[data-browser-runtime-security]')).toBeNull();
    expect(document.baseURI).toBe(originalBase);
  });

  it('strips framework control attributes from rich CMS markup before DOM insertion', async () => {
    const moduleUrl = '/c/private-stream.client.js';
    const sanitized = safeRichHtml(
      [
        '<p id="cms-target" data-cms-id="post-1"',
        ` data-kovo-module-allowlist="${moduleUrl}"`,
        ' data-bind="state.privateDraft"',
        ' data-stream-text="assistant:a1"',
        ` data-stream-renderer="${moduleUrl}#renderPrivate">`,
        'Waiting',
        '</p>',
      ].join(''),
    );
    expect(isAllowedKovoDynamicImportUrl(moduleUrl)).toBe(false);

    const container = document.createElement('section');
    container.setAttribute('kovo-state', '{"privateDraft":"initial"}');
    container.innerHTML = kovoTrustedHtmlContent(sanitized);
    document.body.append(container);
    const target = document.querySelector('#cms-target');
    if (!(target instanceof HTMLElement)) throw new Error('missing sanitized CMS target');

    expect(target.getAttribute('data-cms-id')).toBe('post-1');
    expect(target.getAttribute('data-kovo-module-allowlist')).toBeNull();
    expect(target.getAttribute('data-bind')).toBeNull();
    expect(target.getAttribute('data-stream-text')).toBeNull();
    expect(target.getAttribute('data-stream-renderer')).toBeNull();
    expect(isAllowedKovoDynamicImportUrl(moduleUrl)).toBe(false);

    await applyStateBindings(container, { privateDraft: 'VICTIM-LOCAL-DRAFT' });
    expect(target.textContent).toBe('Waiting');

    const imports: string[] = [];
    const executions: string[] = [];
    const buffer = new StreamTextBuffer({
      flushThreshold: 1,
      importModule: async (url) => {
        imports.push(url);
        return {
          renderPrivate(element: HTMLElement, source: string) {
            executions.push(source);
            element.innerHTML =
              '<img id="module-owned" src="/missing-module-image" onerror="void 0">';
          },
        };
      },
    });

    expect(buffer.push(document, { target: 'assistant:a1', text: 'attacker-source' })).toBe(false);
    await buffer.flush();

    expect(imports).toEqual([]);
    expect(executions).toEqual([]);
    expect(document.querySelector('#module-owned')).toBeNull();
  });
});
