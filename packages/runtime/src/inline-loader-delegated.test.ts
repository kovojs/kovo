import { describe, expect, it, vi } from 'vitest';

import { dispatchDelegatedEvent } from './index.js';
import {
  dispatchInlineDelegatedClick,
  inlineSourceInstallCases,
} from './inline-loader-test-utils.js';
import { FakeElement, FakeStatefulBindingElement } from './runtime-test-fakes.js';

describe('inline loader delegated handlers', () => {
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
    'applies inline state bindings after chained handlers through %s',
    async (_name, installSource) => {
      const host = new FakeStatefulBindingElement({
        'data-bind:data-state': 'state.status',
        'fw-state': '{"count":1,"status":"idle"}',
        'on:click': '/c/cart.js#add /c/cart.js#finish',
      });
      const count = new FakeStatefulBindingElement(
        { 'data-bind': 'state.count' },
        { parent: host, textContent: '1' },
      );
      const label = new FakeStatefulBindingElement(
        {
          'aria-label': 'Old',
          'data-bind:aria-label': 'state.label',
        },
        { parent: host },
      );
      const nestedHost = new FakeStatefulBindingElement(
        { 'fw-state': '{"count":100}' },
        { parent: host },
      );
      const nestedCount = new FakeStatefulBindingElement(
        { 'data-bind': 'state.count' },
        { parent: nestedHost, textContent: '100' },
      );
      const add = vi.fn((_event, ctx: { state: { count: number } }) => {
        ctx.state.count += 1;
      });
      const finish = vi.fn(
        (_event, ctx: { state: { label?: string; status?: string } }) => {
          ctx.state.label = 'Ready';
          ctx.state.status = 'open';
        },
      );
      const importModule = vi.fn(async () => ({ add, finish }));

      await dispatchInlineDelegatedClick(host, importModule, installSource);

      expect(host.getAttribute('fw-state')).toBe('{"count":2,"status":"open","label":"Ready"}');
      expect(host.getAttribute('data-state')).toBe('open');
      expect(count.textContent).toBe('2');
      expect(label.getAttribute('aria-label')).toBe('Ready');
      expect(nestedCount.textContent).toBe('100');
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
});
