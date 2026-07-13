import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRenderedFragmentHtml } from '@kovojs/core/internal/sink-policy';

import { applyBindProp } from './bind-prop.js';
import { createDocumentLifecycleRecovery } from './document-lifecycle.js';
import { isAllowedKovoDynamicImportUrl } from './dynamic-import-url.js';
import { installEnhancedNavigationRuntime } from './enhanced-navigation.js';
import { dispatchDelegatedEvent } from './handlers.js';
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
      'base[data-browser-runtime-security], meta[name="kovo-build"], meta[name="kovo-session"], [data-kovo-module-allowlist]',
    )
    .forEach((element) => element.remove());
  delete (globalThis as typeof globalThis & { __bindPropOwned?: number }).__bindPropOwned;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser-runtime security regressions', () => {
  it('pins DOM attribute, text, and live-property writes before late sink poisoning', () => {
    const controls = createBrowserNavigationSecurityControls();
    const output = document.createElement('span');
    const input = document.createElement('input');
    document.body.append(output, input);
    const setAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'setAttribute',
    );
    const removeAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'removeAttribute',
    );
    const textContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    const checkedDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'checked',
    );
    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (
      !setAttributeDescriptor ||
      !removeAttributeDescriptor ||
      !textContentDescriptor ||
      !checkedDescriptor ||
      !valueDescriptor
    ) {
      throw new Error('missing browser DOM sink security controls');
    }
    const poisonedSetAttribute = vi.fn();
    const poisonedRemoveAttribute = vi.fn();
    const poisonedTextContent = vi.fn();
    const poisonedChecked = vi.fn();
    const poisonedValue = vi.fn();
    try {
      Object.defineProperty(Element.prototype, 'setAttribute', {
        ...setAttributeDescriptor,
        value: poisonedSetAttribute,
      });
      Object.defineProperty(Element.prototype, 'removeAttribute', {
        ...removeAttributeDescriptor,
        value: poisonedRemoveAttribute,
      });
      Object.defineProperty(Node.prototype, 'textContent', {
        ...textContentDescriptor,
        set: poisonedTextContent,
      });
      Object.defineProperty(HTMLInputElement.prototype, 'checked', {
        ...checkedDescriptor,
        set: poisonedChecked,
      });
      Object.defineProperty(HTMLInputElement.prototype, 'value', {
        ...valueDescriptor,
        set: poisonedValue,
      });

      controls.setElementAttribute(output, 'data-security-output', 'ready');
      controls.setNodeTextContent(output, 'safe text');
      controls.setElementProperty(input, 'checked', true);
      controls.setElementProperty(input, 'value', 'safe value');
      controls.removeElementAttribute(output, 'data-security-output');
    } finally {
      Object.defineProperty(Element.prototype, 'setAttribute', setAttributeDescriptor);
      Object.defineProperty(Element.prototype, 'removeAttribute', removeAttributeDescriptor);
      Object.defineProperty(Node.prototype, 'textContent', textContentDescriptor);
      Object.defineProperty(HTMLInputElement.prototype, 'checked', checkedDescriptor);
      Object.defineProperty(HTMLInputElement.prototype, 'value', valueDescriptor);
    }

    expect(output.textContent).toBe('safe text');
    expect(output.hasAttribute('data-security-output')).toBe(false);
    expect(input.checked).toBe(true);
    expect(input.value).toBe('safe value');
    expect(poisonedSetAttribute).not.toHaveBeenCalled();
    expect(poisonedRemoveAttribute).not.toHaveBeenCalled();
    expect(poisonedTextContent).not.toHaveBeenCalled();
    expect(poisonedChecked).not.toHaveBeenCalled();
    expect(poisonedValue).not.toHaveBeenCalled();
  });

  it('pins delegated event selection and handler export authority before late DOM poisoning', async () => {
    const safeUrl = '/c/safe-handler.client.js';
    const privilegedUrl = '/c/privileged-handler.client.js';
    const marker = document.createElement('meta');
    marker.setAttribute('data-kovo-module-allowlist', `${safeUrl} ${privilegedUrl}`);
    document.head.append(marker);
    const safeButton = document.createElement('button');
    safeButton.setAttribute('on:click', `${safeUrl}#runSafe`);
    const privilegedButton = document.createElement('button');
    privilegedButton.setAttribute('on:click', `${privilegedUrl}#runPrivileged`);
    document.body.append(safeButton, privilegedButton);
    const safe = vi.fn();
    const privileged = vi.fn();
    const imports: string[] = [];
    const importModule = async (url: string) => {
      imports.push(url);
      return url === safeUrl ? { runSafe: safe } : { runPrivileged: privileged };
    };
    let pending: Promise<void> | undefined;
    document.addEventListener(
      'click',
      (event) => {
        pending = dispatchDelegatedEvent(event, importModule);
      },
      { capture: true, once: true },
    );

    const targetDescriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'target');
    const typeDescriptor = Object.getOwnPropertyDescriptor(Event.prototype, 'type');
    const closestDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'closest');
    const getAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'getAttribute',
    );
    if (!targetDescriptor || !typeDescriptor || !closestDescriptor || !getAttributeDescriptor) {
      throw new Error('missing browser event security controls');
    }
    try {
      Object.defineProperty(Event.prototype, 'target', {
        ...targetDescriptor,
        get: () => privilegedButton,
      });
      Object.defineProperty(Event.prototype, 'type', {
        ...typeDescriptor,
        get: () => 'submit',
      });
      Object.defineProperty(Element.prototype, 'closest', {
        ...closestDescriptor,
        value: () => privilegedButton,
      });
      Object.defineProperty(Element.prototype, 'getAttribute', {
        ...getAttributeDescriptor,
        value(name: string) {
          return name === 'on:click' ? `${privilegedUrl}#runPrivileged` : null;
        },
      });
      safeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } finally {
      Object.defineProperty(Event.prototype, 'target', targetDescriptor);
      Object.defineProperty(Event.prototype, 'type', typeDescriptor);
      Object.defineProperty(Element.prototype, 'closest', closestDescriptor);
      Object.defineProperty(Element.prototype, 'getAttribute', getAttributeDescriptor);
    }
    if (!pending) throw new Error('delegated event was not observed');
    await pending;

    expect(imports).toEqual([safeUrl]);
    expect(safe).toHaveBeenCalledOnce();
    expect(privileged).not.toHaveBeenCalled();
    marker.remove();
  });

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
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(safeHtml, { status: 200 })),
    );
    const security = createBrowserNavigationSecurityControls();

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
      readDomAttribute: (element, name) => security.readAttribute(element, name),
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

  it('pins lifecycle query authority and avoids late Promise and DOM dispatch', async () => {
    const script = document.createElement('script');
    script.setAttribute('kovo-query', 'cart');
    script.setAttribute('key', 'primary');
    document.body.append(script);
    const security = createBrowserNavigationSecurityControls();
    let safeFetchCalls = 0;
    let safeFetchInput = '';
    let safeFetchInit: object | undefined;
    const safeFetch = async (input: string, init: object) => {
      safeFetchCalls += 1;
      safeFetchInput = input;
      safeFetchInit = init;
      return { response: 'safe' };
    };
    let attackerFetchCalls = 0;
    const attackerFetch = async () => {
      attackerFetchCalls += 1;
      return { response: 'attacker' };
    };
    const applied: Array<{ body: string; build?: string }> = [];
    const options = {
      acceptHeader: 'text/html',
      addLifecycleEventListener: () => true,
      applyBody: (body: string, build?: string) => {
        applied.push({ body, build });
      },
      buildHeader: () => '',
      currentBuild: () => '',
      currentHref: () => undefined,
      document,
      encodeAttribute: (value: string) => value,
      fetchValue: safeFetch,
      findTarget: () => undefined,
      liveTargets: () => [],
      parseHtmlDocument: () => undefined,
      queryOne: () => null,
      queryAll: () => [script],
      queryUrl: (wireKey: string) => '/_q/' + wireKey,
      readAttribute: () => null,
      readElementAttribute: () => ({ present: false }),
      readDomAttribute: (element: Element, name: string) => security.readAttribute(element, name),
      readPageTransitionPersisted: () => false,
      readResponseStatus: () => 200,
      readResponseText: async () => '<kovo-fragment target="cart">SAFE</kovo-fragment>',
      reload: () => false,
      snapshotElementHtml: () => undefined,
      targetHeader: () => [],
      wireKey: (name: string | null, key: string | null) =>
        name ? name + (key ? ':' + key : '') : '',
    };
    const recovery = createDocumentLifecycleRecovery(options);

    options.fetchValue = attackerFetch;
    options.queryUrl = () => 'https://attacker.example/collect';
    options.readDomAttribute = () => 'attacker';
    const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'then');
    const catchDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, 'catch');
    const getAttributeDescriptor = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'getAttribute',
    );
    if (!thenDescriptor || !catchDescriptor || !getAttributeDescriptor) {
      throw new Error('browser Promise/Element descriptors unavailable');
    }
    Reflect.defineProperty(Promise.prototype, 'then', {
      ...thenDescriptor,
      value() {
        throw new Error('late Promise.then poison');
      },
    });
    Reflect.defineProperty(Promise.prototype, 'catch', {
      ...catchDescriptor,
      value() {
        throw new Error('late Promise.catch poison');
      },
    });
    Reflect.defineProperty(Element.prototype, 'getAttribute', {
      ...getAttributeDescriptor,
      value() {
        return 'attacker';
      },
    });
    try {
      recovery.visibleReturnRefresh();
    } finally {
      Reflect.defineProperty(Promise.prototype, 'then', thenDescriptor);
      Reflect.defineProperty(Promise.prototype, 'catch', catchDescriptor);
      Reflect.defineProperty(Element.prototype, 'getAttribute', getAttributeDescriptor);
    }

    await vi.waitFor(() => expect(applied).toHaveLength(1));
    expect(safeFetchCalls).toBe(1);
    expect(safeFetchInput).toBe('/_q/cart:primary');
    expect(safeFetchInit).toEqual(expect.objectContaining({ method: 'GET' }));
    expect(attackerFetchCalls).toBe(0);
    expect(applied).toEqual([
      { body: '<kovo-fragment target="cart">SAFE</kovo-fragment>', build: '' },
    ]);
  });

  it('commits lifecycle query facts through captured define and own-data array controls', () => {
    const recovery = createDocumentLifecycleRecovery({
      acceptHeader: 'text/html',
      addLifecycleEventListener: () => true,
      applyBody: () => undefined,
      buildHeader: () => '',
      currentBuild: () => '',
      currentHref: () => undefined,
      document,
      encodeAttribute: (value) => value,
      fetchValue: async () => ({}),
      findTarget: () => undefined,
      liveTargets: () => [],
      parseHtmlDocument: () => undefined,
      queryOne: () => null,
      queryAll: () => [],
      queryUrl: () => '',
      readAttribute: (_attrs, name) => (name === 'name' ? 'safe-query' : null),
      readElementAttribute: () => ({ present: false }),
      readDomAttribute: () => null,
      readPageTransitionPersisted: () => false,
      readResponseStatus: () => 200,
      readResponseText: async () => '',
      reload: () => false,
      snapshotElementHtml: () => undefined,
      targetHeader: () => [],
      wireKey: (name) => name ?? '',
    });
    const defineDescriptor = Object.getOwnPropertyDescriptor(Object, 'defineProperty');
    const zeroDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    if (!defineDescriptor) throw new Error('Object.defineProperty descriptor unavailable');
    let inheritedSetterCalls = 0;
    Reflect.defineProperty(Object, 'defineProperty', {
      ...defineDescriptor,
      value() {
        throw new Error('late Object.defineProperty poison');
      },
    });
    Reflect.defineProperty(Array.prototype, '0', {
      configurable: true,
      set() {
        inheritedSetterCalls += 1;
      },
    });
    let lifecycleError: unknown;
    try {
      recovery.rememberQueryChunk({ attrs: 'name="safe-query"' });
    } catch (error) {
      lifecycleError = error;
    } finally {
      Reflect.defineProperty(Object, 'defineProperty', defineDescriptor);
      if (zeroDescriptor) Reflect.defineProperty(Array.prototype, '0', zeroDescriptor);
      else Reflect.deleteProperty(Array.prototype, '0');
    }
    expect(lifecycleError).toBeUndefined();
    expect(inheritedSetterCalls).toBe(0);
  });

  it('rejects accessor lifecycle controls without invoking them', () => {
    const getter = vi.fn(() => async () => ({}));
    const options = {
      acceptHeader: 'text/html',
      addLifecycleEventListener: () => true,
      applyBody: () => undefined,
      buildHeader: () => '',
      currentBuild: () => '',
      currentHref: () => undefined,
      document,
      encodeAttribute: (value: string) => value,
      fetchValue: async () => ({}),
      findTarget: () => undefined,
      liveTargets: () => [],
      parseHtmlDocument: () => undefined,
      queryOne: () => null,
      queryAll: () => [],
      queryUrl: () => '',
      readAttribute: () => null,
      readElementAttribute: () => ({ present: false }),
      readDomAttribute: () => null,
      readPageTransitionPersisted: () => false,
      readResponseStatus: () => 200,
      readResponseText: async () => '',
      reload: () => false,
      snapshotElementHtml: () => undefined,
      targetHeader: () => [],
      wireKey: () => '',
    };
    Object.defineProperty(options, 'fetchValue', {
      configurable: true,
      enumerable: true,
      get: getter,
    });

    expect(() => createDocumentLifecycleRecovery(options)).toThrow(/own-data property/);
    expect(getter).not.toHaveBeenCalled();
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
