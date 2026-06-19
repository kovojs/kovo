import { describe, expect, it, vi } from 'vitest';

import { dispatchDelegatedEvent } from './handlers.js';
import {
  dispatchInlineDelegatedClick,
  InlineTriggerElement,
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
        'kovo-param-types': 'quantity:number featured:boolean missingType',
        'kovo-state': '{"count":1}',
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
        expect(element.getAttribute('kovo-state')).toBe('{"count":2,"done":true}');
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
    'does not stamp state onto stateless delegated handler elements through %s',
    async (_name, installSource) => {
      const element = new InlineTriggerElement({
        'on:click': '/c/theme.js#toggle',
      });
      const toggle = vi.fn((_event, ctx: { state: { opened?: boolean } }) => {
        ctx.state.opened = true;
      });

      await dispatchInlineDelegatedClick(element, async () => ({ toggle }), installSource);

      expect(toggle).toHaveBeenCalledTimes(1);
      expect(element.getAttribute('kovo-state')).toBeNull();
    },
  );

  it.each(inlineSourceInstallCases)(
    'applies inline state bindings after chained handlers through %s',
    async (_name, installSource) => {
      const host = new FakeStatefulBindingElement({
        'data-bind:data-state': 'state.status',
        'kovo-state': '{"count":1,"status":"idle"}',
        'on:click': '/c/cart.js#add /c/cart.js#finish',
      });
      const count = new FakeStatefulBindingElement(
        { 'data-bind': 'state.count' },
        { parent: host, textContent: '1' },
      );
      const input = new FakeStatefulBindingElement(
        {
          'data-bind:value': '/c/cart.js#inputValue',
          value: '1',
        },
        { parent: host, value: '1' },
      );
      const label = new FakeStatefulBindingElement(
        {
          'aria-label': 'Old',
          'data-bind:aria-label': 'state.label',
        },
        { parent: host },
      );
      const panel = new FakeStatefulBindingElement(
        {
          'data-bind:hidden': '/c/cart.js#panelHidden',
          hidden: '',
        },
        { parent: host },
      );
      const nestedHost = new FakeStatefulBindingElement(
        { 'kovo-state': '{"count":100}' },
        { parent: host },
      );
      const nestedCount = new FakeStatefulBindingElement(
        { 'data-bind': 'state.count' },
        { parent: nestedHost, textContent: '100' },
      );
      const add = vi.fn((_event, ctx: { state: { count: number } }) => {
        ctx.state.count += 1;
      });
      const finish = vi.fn((_event, ctx: { state: { label?: string; status?: string } }) => {
        ctx.state.label = 'Ready';
        ctx.state.status = 'open';
      });
      const importModule = vi.fn(async () => ({
        add,
        finish,
        panelHidden: {
          run(value: unknown) {
            return (value as { status?: string }).status === 'open' ? null : '';
          },
        },
        inputValue: {
          run(value: unknown) {
            return (value as { count: number }).count;
          },
        },
      }));

      await dispatchInlineDelegatedClick(host, importModule, installSource);

      expect(host.getAttribute('kovo-state')).toBe('{"count":2,"status":"open","label":"Ready"}');
      expect(host.getAttribute('data-state')).toBe('open');
      expect(count.textContent).toBe('2');
      expect(input.getAttribute('value')).toBe('2');
      expect(input.value).toBe('2');
      expect(label.getAttribute('aria-label')).toBe('Ready');
      expect(panel.getAttribute('hidden')).toBeNull();
      expect(nestedCount.textContent).toBe('100');
    },
  );

  it.each(inlineSourceInstallCases)(
    'drains post-commit callbacks after the async derive un-hide through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4 / focus-race fix: deferred menu focus is enqueued on the
      // post-commit hook during the handler and must run only after the awaited
      // derive binding reveals the menu content (`data-bind:hidden` via import).
      const order: string[] = [];
      const host = new FakeStatefulBindingElement({
        'kovo-state': '{"open":false}',
        'on:click': '/c/menu.js#open',
      });
      const content = new FakeStatefulBindingElement(
        { 'data-bind:hidden': '/c/menu.js#contentHidden', hidden: '' },
        { parent: host },
      );
      const importModule = vi.fn(async () => ({
        open(_event: unknown, ctx: { state: { open: boolean } }) {
          ctx.state.open = true;
          (
            globalThis as { __kovo_postCommitSchedule?: (cb: () => void) => void }
          ).__kovo_postCommitSchedule?.(() => {
            order.push(`focus:hidden=${content.getAttribute('hidden')}`);
          });
        },
        contentHidden: {
          run(value: unknown) {
            order.push('derive-unhide');
            return (value as { open: boolean }).open ? null : '';
          },
        },
      }));

      const globalRecord = globalThis as { __kovo_postCommitSchedule?: unknown };
      const previousHook = globalRecord.__kovo_postCommitSchedule;
      await dispatchInlineDelegatedClick(host, importModule, installSource);

      // Focus callback runs strictly after the un-hide, and sees a revealed menu.
      expect(order).toEqual(['derive-unhide', 'focus:hidden=null']);
      expect(content.getAttribute('hidden')).toBeNull();
      // The global hook is restored after dispatch (no cross-dispatch leak).
      expect(globalRecord.__kovo_postCommitSchedule).toBe(previousHook);
    },
  );

  it.each(inlineSourceInstallCases)(
    'reuses inline ctx.signal for the same island through %s',
    async (_name, installSource) => {
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const element = new FakeElement({
        'kovo-c': 'abortable-widget',
        'kovo-key': 'primary',
        'on:click': '/c/abortable.js#start',
      });
      const signals: AbortSignal[] = [];
      const importModule = vi.fn(async () => ({
        start(_event: unknown, ctx: { signal: AbortSignal }) {
          signals.push(ctx.signal);
        },
      }));

      try {
        globalRecord.addEventListener = (
          type: string,
          listener: (event: unknown) => Promise<void>,
        ) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          createElement() {
            return { content: { querySelectorAll: () => [] }, innerHTML: '' };
          },
          querySelectorAll() {
            return [];
          },
        };

        installSource(importModule, globalRecord);
        await listeners.get('click')?.({ target: element, type: 'click' });
        await listeners.get('click')?.({ target: element, type: 'click' });
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          document: originals.document,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }

      expect(signals).toHaveLength(2);
      expect(signals[0]).toBe(signals[1]);
      expect(signals[0]?.aborted).toBe(false);
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps inline indeterminate checkbox properties in parity through %s',
    async (_name, installSource) => {
      const host = new FakeStatefulBindingElement({
        'kovo-state': '{"checked":"indeterminate"}',
        'on:click': '/c/checkbox.js#toggle',
      });
      const input = new FakeStatefulBindingElement(
        {
          'aria-checked': 'mixed',
          'data-bind:indeterminate': '/c/checkbox.js#isIndeterminate',
          'data-state': 'indeterminate',
          type: 'checkbox',
        },
        { indeterminate: false, parent: host },
      );
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const importModule = vi.fn(async () => ({
        isIndeterminate: {
          run(value: unknown) {
            return (value as { checked: boolean | 'indeterminate' }).checked === 'indeterminate'
              ? ''
              : null;
          },
        },
        toggle(_event: unknown, ctx: { state: { checked: boolean | 'indeterminate' } }) {
          ctx.state.checked = true;
        },
      }));

      try {
        globalRecord.addEventListener = (
          type: string,
          listener: (event: unknown) => Promise<void>,
        ) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll(selector: string) {
            return selector ===
              'input[type="checkbox"][aria-checked="mixed"],input[type="checkbox"][data-state="indeterminate"]'
              ? [input]
              : [];
          },
        };

        installSource(importModule, globalRecord);
        expect(input.indeterminate).toBe(true);

        await listeners.get('click')?.({
          target: host,
          type: 'click',
        });

        expect(host.getAttribute('kovo-state')).toBe('{"checked":true}');
        expect(input.getAttribute('indeterminate')).toBeNull();
        expect(input.indeterminate).toBe(false);
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          document: originals.document,
        });
        if (originals.importModule === undefined) {
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
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
        importModule: globalRecord.__kovoInlineImport,
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
          delete globalRecord.__kovoInlineImport;
        } else {
          globalRecord.__kovoInlineImport = originals.importModule;
        }
      }
    },
  );
});
