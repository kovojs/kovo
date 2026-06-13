import { runInThisContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createInlineJisoLoaderSource } from './inline-loader.js';
import { dispatchDelegatedEvent } from './index.js';
import {
  dispatchInlineDelegatedClick,
  inlineSourceInstallCases,
  InlineTriggerElement,
} from './inline-loader-test-utils.js';
import { FakeElement } from './runtime-test-fakes.js';

describe('inline loader source', () => {
  it('installs from a generated custom import expression without importing handlers eagerly', () => {
    const globalRecord = globalThis as unknown as Record<string, unknown>;
    const originals = {
      addEventListener: globalRecord.addEventListener,
      document: globalRecord.document,
      importModule: globalRecord.__jisoInlineImport,
    };
    const listeners = new Map<string, unknown>();
    const importModule = vi.fn(async () => ({}));

    try {
      globalRecord.__jisoInlineImport = importModule;
      globalRecord.addEventListener = (type: string, listener: unknown) => {
        listeners.set(type, listener);
      };
      globalRecord.document = {
        querySelectorAll() {
          return [];
        },
      };

      runInThisContext(createInlineJisoLoaderSource(' globalThis.__jisoInlineImport '));

      expect([...listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
      expect(importModule).not.toHaveBeenCalled();
    } finally {
      Object.assign(globalRecord, {
        addEventListener: originals.addEventListener,
        document: originals.document,
      });
      if (originals.importModule === undefined) {
        delete globalRecord.__jisoInlineImport;
      } else {
        globalRecord.__jisoInlineImport = originals.importModule;
      }
    }
  });

  it.each(inlineSourceInstallCases)(
    'ships an inline enhanced form round trip through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: enhanced-form query/fragment effects must stay in the always-loaded path.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        CustomEvent: globalRecord.CustomEvent,
        DOMParser: globalRecord.DOMParser,
        FormData: globalRecord.FormData,
        addEventListener: globalRecord.addEventListener,
        dispatchEvent: globalRecord.dispatchEvent,
        document: globalRecord.document,
        fetch: globalRecord.fetch,
        importModule: globalRecord.__jisoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => void>();
      const dispatched: unknown[] = [];
      const fragmentTarget = { innerHTML: '' };
      const appendTarget = { insertAdjacentHTML: vi.fn() };
      const formData = { kind: 'form-data' };
      const form = {
        action: '/_m/cart/add',
        getAttribute(name: string) {
          return name === 'data-enhance' ? '' : null;
        },
        method: 'post',
      };
      const depElements = [
        {
          id: 'cart-badge',
          getAttribute(name: string) {
            if (name === 'fw-deps') return 'cart';
            if (name === 'fw-fragment-target') return null;
            return null;
          },
        },
        {
          id: 'inventory-panel',
          getAttribute(name: string) {
            if (name === 'fw-deps') return 'inventory stock';
            if (name === 'fw-fragment-target') return 'inventory';
            return null;
          },
        },
        {
          id: 'empty-fragment-target-fallback',
          getAttribute(name: string) {
            if (name === 'fw-deps') return 'debug';
            if (name === 'fw-fragment-target') return '';
            return null;
          },
        },
      ];
      const fetch = vi.fn(async () => ({
        async text() {
          return [
            '<fw-query name="cart" key="cart:c1">{"count":1}</fw-query>',
            '<fw-fragment target="cart-badge"><cart-badge>1</cart-badge></fw-fragment>',
            '<fw-fragment target="cart-list" mode="append"><li>2</li></fw-fragment>',
          ].join('\n');
        },
      }));

      try {
        globalRecord.CustomEvent = class CustomEvent {
          readonly detail: unknown;
          readonly type: string;

          constructor(type: string, init?: { detail?: unknown }) {
            this.detail = init?.detail;
            this.type = type;
          }
        };
        globalRecord.DOMParser = class DOMParser {
          parseFromString(body: string) {
            const queryMatch = /<fw-query\b([^>]*)>([\s\S]*?)<\/fw-query>/.exec(body);
            const fragmentMatches = [
              ...body.matchAll(/<fw-fragment\b([^>]*)>([\s\S]*?)<\/fw-fragment>/g),
            ];
            const queryAttributes = queryMatch?.[1] ?? '';
            const queryElement = queryMatch
              ? {
                  getAttribute(name: string) {
                    if (name === 'name') {
                      return /name="([^"]+)"/.exec(queryAttributes)?.[1] ?? null;
                    }
                    if (name === 'key') {
                      return /key="([^"]+)"/.exec(queryAttributes)?.[1] ?? null;
                    }
                    return null;
                  },
                  textContent: queryMatch[2],
                }
              : null;
            const fragmentElements = fragmentMatches.map((fragmentMatch) => {
              const fragmentAttributes = fragmentMatch[1] ?? '';
              return {
                getAttribute(name: string) {
                  if (name === 'target') {
                    return /target="([^"]+)"/.exec(fragmentAttributes)?.[1] ?? null;
                  }
                  if (name === 'mode') {
                    return /mode="([^"]+)"/.exec(fragmentAttributes)?.[1] ?? null;
                  }
                  return null;
                },
                innerHTML: fragmentMatch[2],
              };
            });

            return {
              querySelectorAll(selector: string) {
                if (selector === 'fw-query') return queryElement ? [queryElement] : [];
                if (selector === 'fw-fragment') return fragmentElements;
                return [];
              },
            };
          }
        };
        globalRecord.FormData = function FormData() {
          return formData;
        };
        globalRecord.addEventListener = (type: string, listener: (event: unknown) => void) => {
          listeners.set(type, listener);
        };
        globalRecord.dispatchEvent = (event: unknown) => {
          dispatched.push(event);
          return true;
        };
        globalRecord.document = {
          getElementById(id: string) {
            return id === 'cart-badge' ? fragmentTarget : null;
          },
          querySelector(selector: string) {
            return selector === '[fw-fragment-target="cart-list"]' ? appendTarget : null;
          },
          querySelectorAll(selector: string) {
            return selector === '[fw-deps]' ? depElements : [];
          },
          visibilityState: 'visible',
        };
        globalRecord.fetch = fetch;

        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );
        listeners.get('submit')?.({
          preventDefault: vi.fn(),
          target: {
            closest(selector: string) {
              return selector === 'form[enhance],form[data-enhance],form[data-mutation]'
                ? form
                : null;
            },
          },
          type: 'submit',
        });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(fetch).toHaveBeenCalledWith('/_m/cart/add', {
          body: formData,
          headers: {
            Accept: 'text/vnd.jiso.fragment+html',
            'FW-Fragment': 'true',
            'FW-Idem': expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            ),
            'FW-Targets': 'cart-badge=cart; inventory=inventory stock',
          },
          keepalive: true,
          method: 'POST',
        });
        expect(dispatched).toEqual([
          expect.objectContaining({
            detail: {
              attrs: ' name="cart" key="cart:c1"',
              content: '{"count":1}',
            },
            type: 'jiso:query',
          }),
        ]);
        expect(fragmentTarget.innerHTML).toBe('<cart-badge>1</cart-badge>');
        expect(appendTarget.insertAdjacentHTML).toHaveBeenCalledWith('beforeend', '<li>2</li>');
      } finally {
        Object.assign(globalRecord, {
          CustomEvent: originals.CustomEvent,
          DOMParser: originals.DOMParser,
          FormData: originals.FormData,
          addEventListener: originals.addEventListener,
          dispatchEvent: originals.dispatchEvent,
          document: originals.document,
          fetch: originals.fetch,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__jisoInlineImport;
        } else {
          globalRecord.__jisoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps inline delegated params and state in parity through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: delegated handler semantics must not drift between inline source artifacts.
      const attrs = {
        'data-p-featured': 'false',
        'data-p-item-id': 'i_42',
        'data-p-missing-type': 'kept-as-string',
        'data-p-quantity': '2',
        'fw-param-types': 'quantity:number featured:boolean missingType',
        'fw-state': '{"count":1}',
        'on:click': '/c/cart.js#add /c/cart.js#finish',
      };
      const expectedCalls = [
        {
          handler: 'add',
          params: {
            featured: false,
            itemId: 'i_42',
            missingType: 'kept-as-string',
            quantity: 2,
          },
          signalAborted: false,
          state: { count: 1 },
        },
        {
          handler: 'finish',
          params: {
            featured: false,
            itemId: 'i_42',
            missingType: 'kept-as-string',
            quantity: 2,
          },
          signalAborted: false,
          state: { count: 2 },
        },
      ];
      const runDelegatedHandlers = async (
        element: FakeElement,
        dispatch: (
          importModule: (url: string) => Promise<Record<string, unknown>>,
        ) => Promise<void>,
      ) => {
        const calls: unknown[] = [];
        const add = vi.fn(
          (_event, ctx: { params: unknown; signal: AbortSignal; state: { count: number } }) => {
            calls.push({
              handler: 'add',
              params: ctx.params,
              signalAborted: ctx.signal.aborted,
              state: { ...ctx.state },
            });
            ctx.state.count += 1;
          },
        );
        const finish = vi.fn(
          (
            _event,
            ctx: { params: unknown; signal: AbortSignal; state: { count: number; done?: boolean } },
          ) => {
            calls.push({
              handler: 'finish',
              params: ctx.params,
              signalAborted: ctx.signal.aborted,
              state: { ...ctx.state },
            });
            ctx.state.done = true;
          },
        );
        const importModule = vi.fn(async () => ({ add, finish }));

        await dispatch(importModule);

        expect(importModule).toHaveBeenCalledWith('/c/cart.js');
        expect(calls).toEqual(expectedCalls);
        expect(element.getAttribute('fw-state')).toBe('{"count":2,"done":true}');
      };
      const modularElement = new FakeElement(attrs);
      const inlineElement = new FakeElement(attrs);

      await runDelegatedHandlers(modularElement, (importModule) =>
        dispatchDelegatedEvent({ target: modularElement, type: 'click' }, importModule),
      );
      await runDelegatedHandlers(inlineElement, (importModule) =>
        dispatchInlineDelegatedClick(inlineElement, importModule, installSource),
      );
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps inline delegated error messages in parity through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: handler resolution failures are part of the shipped loader contract.
      const assertErrorParity = async (ref: string) => {
        const modularElement = new FakeElement({ 'on:click': ref });
        const inlineElement = new FakeElement({ 'on:click': ref });
        const importModule = vi.fn(async () => ({}));
        const capture = async (dispatch: () => Promise<void>) =>
          dispatch().then(
            () => undefined,
            (error: unknown) => error,
          );

        const modularError = await capture(() =>
          dispatchDelegatedEvent({ target: modularElement, type: 'click' }, importModule),
        );
        const inlineError = await capture(() =>
          dispatchInlineDelegatedClick(inlineElement, importModule, installSource),
        );

        expect(inlineError).toBeInstanceOf(Error);
        expect((inlineError as Error).message).toBe((modularError as Error).message);
      };

      await assertErrorParity('/c/cart.js');
      await assertErrorParity('/c/cart.js#missing');
    },
  );

  it.each(inlineSourceInstallCases)(
    'throws from the inline loader when a handler export is missing through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: all inline source artifacts must reject unresolved handler exports.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        importModule: globalRecord.__jisoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const handlerUrl = `data:text/javascript,${encodeURIComponent('export const present = true;')}#missing`;
      const attributes = new Map<string, string>([['on:click', handlerUrl]]);
      const element = {
        attributes: [],
        getAttribute(name: string) {
          return attributes.get(name) ?? null;
        },
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
        closest(selector: string) {
          return selector === '[on\\:click]' ? this : null;
        },
      };

      try {
        globalRecord.addEventListener = (
          type: string,
          listener: (event: unknown) => Promise<void>,
        ) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll() {
            return [];
          },
        };
        installSource(
          vi.fn(async () => ({})),
          globalRecord,
        );

        await expect(
          listeners.get('click')?.({
            target: element,
            type: 'click',
          }),
        ).rejects.toThrow(`Handler export not found: ${handlerUrl}`);
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          document: originals.document,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__jisoInlineImport;
        } else {
          globalRecord.__jisoInlineImport = originals.importModule;
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps execution trigger initialization in parity through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: execution triggers live in the always-loaded inline path.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        IntersectionObserver: globalRecord.IntersectionObserver,
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        importModule: globalRecord.__jisoInlineImport,
        requestIdleCallback: globalRecord.requestIdleCallback,
      };
      const listeners = new Map<string, unknown>();
      const idleCallbacks: Array<() => void> = [];
      const loadElement = new InlineTriggerElement({ 'on:load': '/c/load.js#start' });
      const idleElement = new InlineTriggerElement({ 'on:idle': '/c/idle.js#warm' });
      const visibleElement = new InlineTriggerElement({ 'on:visible': '/c/chart.js#mount' });
      const observer = {
        observe: vi.fn(),
        unobserve: vi.fn(),
      };
      let visibleCallback:
        | ((entries: Array<{ isIntersecting: boolean; target: InlineTriggerElement }>) => void)
        | undefined;
      const handlers = {
        mount: vi.fn(),
        start: vi.fn(),
        warm: vi.fn(),
      };
      const importModule = vi.fn(async (url: string) => {
        if (url === '/c/load.js') return { start: handlers.start };
        if (url === '/c/idle.js') return { warm: handlers.warm };
        return { mount: handlers.mount };
      });

      try {
        globalRecord.addEventListener = (type: string, listener: unknown) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll(selector: string) {
            if (selector === '[on\\:load]') return [loadElement];
            if (selector === '[on\\:idle]') return [idleElement];
            if (selector === '[on\\:visible]') return [visibleElement];
            return [];
          },
        };
        globalRecord.requestIdleCallback = (callback: () => void) => {
          idleCallbacks.push(callback);
          return 1;
        };
        globalRecord.IntersectionObserver = function IntersectionObserver(
          callback: typeof visibleCallback,
        ) {
          visibleCallback = callback;
          return observer;
        };

        installSource(importModule, globalRecord);

        expect([...listeners.keys()]).toEqual(['click', 'submit', 'input', 'change']);
        await vi.waitFor(() => expect(handlers.start).toHaveBeenCalledTimes(1));
        expect(handlers.warm).not.toHaveBeenCalled();
        expect(handlers.mount).not.toHaveBeenCalled();
        expect(observer.observe).toHaveBeenCalledWith(visibleElement);

        idleCallbacks[0]?.();
        await vi.waitFor(() => expect(handlers.warm).toHaveBeenCalledTimes(1));

        visibleCallback?.([{ isIntersecting: false, target: visibleElement }]);
        expect(handlers.mount).not.toHaveBeenCalled();
        visibleCallback?.([{ isIntersecting: true, target: visibleElement }]);
        await vi.waitFor(() => expect(handlers.mount).toHaveBeenCalledTimes(1));
        expect(observer.unobserve).toHaveBeenCalledWith(visibleElement);
        expect(importModule).toHaveBeenCalledWith('/c/load.js');
        expect(importModule).toHaveBeenCalledWith('/c/idle.js');
        expect(importModule).toHaveBeenCalledWith('/c/chart.js');
      } finally {
        Object.assign(globalRecord, {
          IntersectionObserver: originals.IntersectionObserver,
          addEventListener: originals.addEventListener,
          document: originals.document,
          requestIdleCallback: originals.requestIdleCallback,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__jisoInlineImport;
        } else {
          globalRecord.__jisoInlineImport = originals.importModule;
        }
      }
    },
  );
});
