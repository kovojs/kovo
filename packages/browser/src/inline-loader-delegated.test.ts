import { afterAll, describe, expect, it, vi } from 'vitest';

import { dispatchDelegatedEvent } from './handlers.js';
import {
  dispatchInlineDelegatedClick,
  InlineTriggerElement,
  inlineModuleAllowlistQuery,
  inlineSourceInstallCases,
} from './inline-loader-test-utils.js';
import {
  FakeElement,
  FakeStatefulBindingElement,
  installTestClientModuleManifest,
} from './runtime-test-fakes.js';

const restoreClientModuleManifest = installTestClientModuleManifest([
  '/c/abortable.js',
  '/c/cart.js',
  '/c/checkbox.js',
  '/c/menu.js',
  '/c/theme.js',
]);
afterAll(restoreClientModuleManifest);

describe('inline loader delegated handlers', () => {
  it.each(inlineSourceInstallCases)(
    'cancels the native context menu synchronously before the awaited handler import through %s',
    async (_name, installSource) => {
      // SPEC.md §4.4: an on:contextmenu element opts into a custom menu, so the
      // native menu's default must be canceled synchronously in the capture-phase
      // dispatch prefix — deferring preventDefault until after the awaited handler
      // import misses the dispatch window and leaks the browser menu.
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const element = new FakeElement({
        'kovo-state': '{"open":false}',
        'on:contextmenu': '/c/menu.js#open',
      });
      let importStarted = false;
      // The import never resolves, so the handler (and any preventDefault it would
      // call) can only run after the await — proving the loader must prevent
      // synchronously on its own.
      const importModule = vi.fn(
        () =>
          new Promise<Record<string, unknown>>(() => {
            importStarted = true;
          }),
      );

      try {
        globalRecord.addEventListener = (
          type: string,
          listener: (event: unknown) => Promise<void>,
        ) => {
          listeners.set(type, listener);
        };
        globalRecord.document = {
          querySelectorAll: (selector: string) =>
            inlineModuleAllowlistQuery(selector, ['/c/menu.js']),
        };

        installSource(importModule, globalRecord);

        const preventDefault = vi.fn();
        const event = { cancelable: true, preventDefault, target: element, type: 'contextmenu' };
        const pending = listeners.get('contextmenu')?.(event);

        // Prevented synchronously — before (or regardless of) the await-import.
        expect(preventDefault).toHaveBeenCalledTimes(1);
        void pending;
        void importStarted;
      } finally {
        Object.assign(globalRecord, {
          addEventListener: originals.addEventListener,
          document: originals.document,
        });
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
        dispatchInlineDelegatedClick(inlineElement, importModule, installSource, ['/c/cart.js']),
      );
    },
  );

  it.each(inlineSourceInstallCases)(
    'commits newly created state onto the fallback handler element through %s',
    async (_name, installSource) => {
      const element = new InlineTriggerElement({
        'on:click': '/c/theme.js#toggle',
      });
      const toggle = vi.fn((_event, ctx: { state: { opened?: boolean } }) => {
        ctx.state.opened = true;
      });

      await dispatchInlineDelegatedClick(element, async () => ({ toggle }), installSource, [
        '/c/theme.js',
      ]);

      expect(toggle).toHaveBeenCalledTimes(1);
      expect(element.getAttribute('kovo-state')).toBe('{"opened":true}');
    },
  );

  it.each(inlineSourceInstallCases)(
    'does not synthesize empty state for a stateless handler through %s',
    async (_name, installSource) => {
      const element = new InlineTriggerElement({
        'on:click': '/c/theme.js#inspect',
      });
      const inspect = vi.fn();

      await dispatchInlineDelegatedClick(element, async () => ({ inspect }), installSource, [
        '/c/theme.js',
      ]);

      expect(inspect).toHaveBeenCalledTimes(1);
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

      await dispatchInlineDelegatedClick(host, importModule, installSource, ['/c/cart.js']);

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
      const direct = new FakeStatefulBindingElement(
        { 'data-bind': 'state.open' },
        { parent: host, textContent: 'false' },
      );
      const content = new FakeStatefulBindingElement(
        { 'data-bind': '/c/menu.js#contentHidden' },
        { parent: host, textContent: 'old-derived' },
      );
      const importModule = vi.fn(async () => ({
        open(_event: unknown, ctx: { state: { open: boolean } }) {
          ctx.state.open = true;
          (
            globalThis as { __kovo_postCommitSchedule?: (cb: () => void) => void }
          ).__kovo_postCommitSchedule?.(() => {
            order.push(
              `post-commit:${host.getAttribute('kovo-state')}:${direct.textContent}:${content.textContent}`,
            );
          });
        },
        contentHidden: {
          run(value: unknown) {
            order.push(
              `derive-prepare:${host.getAttribute('kovo-state')}:${direct.textContent}:${content.textContent}`,
            );
            return (value as { open: boolean }).open ? 'revealed' : 'hidden';
          },
        },
      }));

      const globalRecord = globalThis as { __kovo_postCommitSchedule?: unknown };
      const previousHook = globalRecord.__kovo_postCommitSchedule;
      await dispatchInlineDelegatedClick(host, importModule, installSource, ['/c/menu.js']);

      // Focus callback runs strictly after the un-hide, and sees a revealed menu.
      expect(order).toEqual([
        'derive-prepare:{"open":false}:false:old-derived',
        'post-commit:{"open":true}:true:revealed',
      ]);
      expect(content.textContent).toBe('revealed');
      // The global hook is restored after dispatch (no cross-dispatch leak).
      expect(globalRecord.__kovo_postCommitSchedule).toBe(previousHook);
    },
  );

  it.each(inlineSourceInstallCases)(
    'rolls back failed handler state and post-commit effects through %s',
    async (_name, installSource) => {
      const deferredEffect = vi.fn();
      const host = new FakeStatefulBindingElement({
        'kovo-state': '{"count":0}',
        'on:click': '/c/counter.js#fail',
      });

      await expect(
        dispatchInlineDelegatedClick(
          host,
          async () => ({
            fail(_event: unknown, ctx: { state: { count: number } }) {
              ctx.state.count += 1;
              (
                globalThis as { __kovo_postCommitSchedule?: (cb: () => void) => void }
              ).__kovo_postCommitSchedule?.(deferredEffect);
              throw new Error('boom');
            },
          }),
          installSource,
          ['/c/counter.js'],
        ),
      ).rejects.toThrow('boom');

      expect(host.getAttribute('kovo-state')).toBe('{"count":0}');
      expect(deferredEffect).not.toHaveBeenCalled();
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps the binding/state transaction closed across derive preparation failures through %s',
    async (_name, installSource) => {
      const makeHost = () => {
        const deferredEffect = vi.fn();
        const host = new FakeStatefulBindingElement({
          'kovo-state': '{"value":"old"}',
          'on:click': '/c/a.js#change',
        });
        const direct = new FakeStatefulBindingElement(
          { 'data-bind': 'state.value' },
          { parent: host, textContent: 'old-direct' },
        );
        const change = (_event: unknown, ctx: { state: { value: string } }) => {
          ctx.state.value = 'new';
          (
            globalThis as { __kovo_postCommitSchedule?: (callback: () => void) => void }
          ).__kovo_postCommitSchedule?.(deferredEffect);
        };
        return { change, deferredEffect, direct, host };
      };
      const expectClosed = (
        host: FakeStatefulBindingElement,
        direct: FakeStatefulBindingElement,
        deferredEffect: ReturnType<typeof vi.fn>,
        outputs: readonly FakeStatefulBindingElement[],
      ) => {
        expect(host.getAttribute('kovo-state')).toBe('{"value":"old"}');
        expect(direct.textContent).toBe('old-direct');
        for (const output of outputs) expect(output.textContent).toMatch(/^old-/u);
        expect(deferredEffect).not.toHaveBeenCalled();
      };

      // A later import fails after an earlier derive callee has been found. No derive runs and no
      // direct/framework sink is written.
      {
        const { change, deferredEffect, direct, host } = makeHost();
        const first = new FakeStatefulBindingElement(
          { 'data-bind': '/c/a.js#first' },
          { parent: host, textContent: 'old-first' },
        );
        const second = new FakeStatefulBindingElement(
          { 'data-bind': '/c/b.js#second' },
          { parent: host, textContent: 'old-second' },
        );
        const firstRun = vi.fn(() => 'new-first');
        await expect(
          dispatchInlineDelegatedClick(
            host,
            async (url) => {
              if (url === '/c/a.js') return { change, first: { run: firstRun } };
              throw new Error('late derive import failed');
            },
            installSource,
            ['/c/a.js', '/c/b.js'],
          ),
        ).rejects.toThrow('late derive import failed');
        expect(firstRun).not.toHaveBeenCalled();
        expectClosed(host, direct, deferredEffect, [first, second]);
      }

      // Missing/invalid owned exports and run functions are closed verdicts, never undefined
      // binding values.
      for (const deriveModule of [
        {},
        { derived: vi.fn() },
        { derived: {} },
        { derived: { run: 'not-a-function' } },
      ]) {
        const { change, deferredEffect, direct, host } = makeHost();
        const output = new FakeStatefulBindingElement(
          { 'data-bind': '/c/b.js#derived' },
          { parent: host, textContent: 'old-output' },
        );
        await expect(
          dispatchInlineDelegatedClick(
            host,
            async (url) => (url === '/c/a.js' ? { change } : deriveModule),
            installSource,
            ['/c/a.js', '/c/b.js'],
          ),
        ).rejects.toThrow('Kovo state derive export/run is missing or invalid');
        expectClosed(host, direct, deferredEffect, [output]);
      }

      // A late derive body can throw only during preparation; earlier materialized operations have
      // still not been applied.
      {
        const { change, deferredEffect, direct, host } = makeHost();
        const first = new FakeStatefulBindingElement(
          { 'data-bind': '/c/a.js#first' },
          { parent: host, textContent: 'old-first' },
        );
        const second = new FakeStatefulBindingElement(
          { 'data-bind': '/c/b.js#second' },
          { parent: host, textContent: 'old-second' },
        );
        const firstRun = vi.fn(() => 'new-first');
        await expect(
          dispatchInlineDelegatedClick(
            host,
            async (url) =>
              url === '/c/a.js'
                ? { change, first: { run: firstRun } }
                : {
                    second: {
                      run() {
                        throw new Error('late derive run failed');
                      },
                    },
                  },
            installSource,
            ['/c/a.js', '/c/b.js'],
          ),
        ).rejects.toThrow('late derive run failed');
        expect(firstRun).toHaveBeenCalledTimes(1);
        expectClosed(host, direct, deferredEffect, [first, second]);
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'rejects inherited inline derive outputs through %s',
    async (_name, installSource) => {
      const host = new FakeStatefulBindingElement({
        'kovo-state': '{"enabled":false}',
        'on:click': '/c/theme.js#toggle',
      });
      const output = new FakeStatefulBindingElement(
        { 'data-bind': '/c/theme.js#labelDerive' },
        { parent: host, textContent: 'old' },
      );
      const run = vi.fn(() => 'forged');
      const carrier = Object.create({ labelDerive: { run } }) as Record<string, unknown>;
      carrier.toggle = (_event: unknown, ctx: { state: { enabled: boolean } }) => {
        ctx.state.enabled = true;
      };

      await expect(
        dispatchInlineDelegatedClick(host, async () => carrier, installSource, ['/c/theme.js']),
      ).rejects.toThrow('Kovo state derive export/run is missing or invalid');

      expect(run).not.toHaveBeenCalled();
      expect(output.textContent).toBe('old');
    },
  );

  it.each(inlineSourceInstallCases)(
    'snapshots every inline derive reference before the first authored derive runs through %s',
    async (_name, installSource) => {
      // SPEC §6.6: an earlier derive cannot rewrite a later DOM ref and redirect the framework's
      // next import/callee decision in the same state-commit pass.
      const host = new FakeStatefulBindingElement({
        'kovo-state': '{"enabled":false}',
        'on:click': '/c/theme.js#toggle',
      });
      const firstOutput = new FakeStatefulBindingElement(
        { 'data-bind': '/c/theme.js#first' },
        { parent: host, textContent: 'old-first' },
      );
      const secondOutput = new FakeStatefulBindingElement(
        { 'data-bind': '/c/theme.js#second' },
        { parent: host, textContent: 'old-second' },
      );
      const second = vi.fn(() => 'safe-second');
      const privileged = vi.fn(() => 'privileged');
      const module = {
        first: {
          run() {
            secondOutput.setAttribute('data-bind', '/c/theme.js#privileged');
            return 'first';
          },
        },
        privileged: { run: privileged },
        second: { run: second },
        toggle(_event: unknown, ctx: { state: { enabled: boolean } }) {
          ctx.state.enabled = true;
        },
      };

      await dispatchInlineDelegatedClick(host, async () => module, installSource, ['/c/theme.js']);

      expect(firstOutput.textContent).toBe('first');
      expect(secondOutput.textContent).toBe('safe-second');
      expect(second).toHaveBeenCalledTimes(1);
      expect(privileged).not.toHaveBeenCalled();
    },
  );

  it.each(inlineSourceInstallCases)(
    'snapshots every inline handler reference before the first authored handler runs through %s',
    async (_name, installSource) => {
      // SPEC §6.6: module evaluation and an earlier authored handler run in the shared realm, but
      // cannot rewrite the later url#export split that the framework already selected from DOM.
      const secondReference = '/c/theme.js#second';
      const element = new FakeElement({
        'on:click': '/c/theme.js#first ' + secondReference,
      });
      const second = vi.fn();
      const privileged = vi.fn();
      const originalSlice = String.prototype.slice;
      const first = vi.fn(() => {
        String.prototype.slice = function poisonedHandlerSlice(start, end) {
          const source = Reflect.apply(originalSlice, this, [0]);
          if (source === secondReference && start > 0) return 'privileged';
          return Reflect.apply(originalSlice, this, [start, end]);
        };
      });

      try {
        await dispatchInlineDelegatedClick(
          element,
          async () => ({ first, privileged, second }),
          installSource,
          ['/c/theme.js'],
        );
      } finally {
        String.prototype.slice = originalSlice;
      }

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(privileged).not.toHaveBeenCalled();
    },
  );

  it.each(inlineSourceInstallCases)(
    'restores the inline post-commit scheduler without invoking authored accessors through %s',
    async (_name, installSource) => {
      const scheduleKey = '__kovo_postCommitSchedule';
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, scheduleKey);
      const getter = vi.fn();
      const setter = vi.fn();
      const second = vi.fn();
      const element = new FakeElement({
        'on:click': '/c/theme.js#first /c/theme.js#second',
      });

      try {
        await dispatchInlineDelegatedClick(
          element,
          async () => ({
            first() {
              Object.defineProperty(globalThis, scheduleKey, {
                configurable: true,
                get: getter,
                set: setter,
              });
            },
            second,
          }),
          installSource,
          ['/c/theme.js'],
        );

        expect(getter).not.toHaveBeenCalled();
        expect(setter).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
      } finally {
        if (originalDescriptor) {
          Object.defineProperty(globalThis, scheduleKey, originalDescriptor);
        } else {
          delete globalRecord[scheduleKey];
        }
      }
    },
  );

  it.each(inlineSourceInstallCases)(
    'keeps inline handler and parameter selection pinned after late prototype poisoning through %s',
    async (_name, installSource) => {
      const refs = '/c/theme.js#safe';
      const paramTypes = 'quantity:number';
      const element = new FakeElement({
        'data-p-quantity': '2',
        'kovo-param-types': paramTypes,
        'on:click': refs,
      });
      const safe = vi.fn((_event, context: { params: { quantity: number } }) => {
        expect(context.params.quantity).toBe(2);
      });
      const privileged = vi.fn();
      const originalNumber = Number;
      const originalReplace = String.prototype.replace;
      const originalSlice = String.prototype.slice;
      const originalSplit = String.prototype.split;
      const originalStartsWith = String.prototype.startsWith;

      try {
        await dispatchInlineDelegatedClick(
          element,
          async () => ({ privileged, safe }),
          installSource,
          ['/c/theme.js'],
          () => {
            String.prototype.split = function poisonedSplit(separator, limit) {
              const source = Reflect.apply(originalSlice, this, [0]);
              if (source === refs) return ['/c/theme.js#privileged'];
              if (source === paramTypes) return ['quantity:boolean'];
              return Reflect.apply(originalSplit, this, [separator, limit]);
            };
            String.prototype.startsWith = function poisonedStartsWith(search, position) {
              const source = Reflect.apply(originalSlice, this, [0]);
              if (source === 'data-p-quantity') return false;
              return Reflect.apply(originalStartsWith, this, [search, position]);
            };
            String.prototype.replace = function poisonedReplace(search, replacement) {
              const source = Reflect.apply(originalSlice, this, [0]);
              if (source === 'quantity') return '__proto__';
              return Reflect.apply(originalReplace, this, [search, replacement]);
            };
            (globalThis as unknown as Record<string, unknown>).Number = (value: unknown) =>
              value === '2' ? 999 : originalNumber(value);
          },
        );
      } finally {
        String.prototype.replace = originalReplace;
        String.prototype.slice = originalSlice;
        String.prototype.split = originalSplit;
        String.prototype.startsWith = originalStartsWith;
        (globalThis as unknown as Record<string, unknown>).Number = originalNumber;
      }

      expect(safe).toHaveBeenCalledTimes(1);
      expect(privileged).not.toHaveBeenCalled();
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
          querySelectorAll(selector: string) {
            return inlineModuleAllowlistQuery(selector, ['/c/abortable.js']);
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
            return inlineModuleAllowlistQuery(selector, ['/c/checkbox.js'], () =>
              selector ===
              'input[type="checkbox"][aria-checked="mixed"],input[type="checkbox"][data-state="indeterminate"]'
                ? [input]
                : [],
            );
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
    'applies data-bind-prop:checked/indeterminate/scrollTop live properties through %s (SPEC §4.8)',
    async (_name, installSource) => {
      // SPEC.md §4.8 data-bind-prop: the inline loader must assign the live
      // property after a handler re-render, not just the companion attribute.
      const host = new FakeStatefulBindingElement({
        'kovo-state': '{"checked":"indeterminate","scrollTop":0}',
        'on:click': '/c/checkbox.js#toggle',
      });
      const input = new FakeStatefulBindingElement(
        {
          checked: '',
          'data-bind:checked': '/c/checkbox.js#isChecked',
          'data-bind-prop:checked': '/c/checkbox.js#isChecked',
          'data-bind-prop:indeterminate': '/c/checkbox.js#isIndeterminate',
          type: 'checkbox',
        },
        { checked: false, indeterminate: false, parent: host },
      );
      const viewport = new FakeStatefulBindingElement(
        { 'data-bind-prop:scrolltop': 'state.scrollTop' },
        { parent: host, scrollTop: 0 },
      );
      const globalRecord = globalThis as unknown as Record<string, unknown>;
      const originals = {
        addEventListener: globalRecord.addEventListener,
        document: globalRecord.document,
        importModule: globalRecord.__kovoInlineImport,
      };
      const listeners = new Map<string, (event: unknown) => Promise<void>>();
      const importModule = vi.fn(async () => ({
        isChecked: {
          run(value: unknown) {
            return (value as { checked: unknown }).checked === true ? '' : null;
          },
        },
        isIndeterminate: {
          run(value: unknown) {
            return (value as { checked: unknown }).checked === 'indeterminate' ? '' : null;
          },
        },
        toggle(_event: unknown, ctx: { state: { checked: unknown; scrollTop: number } }) {
          ctx.state.checked = true;
          ctx.state.scrollTop = 320;
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
            return inlineModuleAllowlistQuery(selector, ['/c/checkbox.js']);
          },
        };

        installSource(importModule, globalRecord);

        await listeners.get('click')?.({ target: host, type: 'click' });

        // After the handler: state.checked=true, state.scrollTop=320.
        expect(input.checked).toBe(true);
        expect(input.indeterminate).toBe(false);
        expect(viewport.scrollTop).toBe(320);
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
          dispatchInlineDelegatedClick(inlineElement, importModule, installSource, ['/c/cart.js']),
        );

        expect(inlineError).toBeInstanceOf(Error);
        expect((inlineError as Error).message).toBe((modularError as Error).message);
      };

      await assertErrorParity('/c/cart.js');
      await assertErrorParity('/c/cart.js#missing');
    },
  );

  it.each(inlineSourceInstallCases)(
    'rejects inherited and accessor inline handler exports through %s',
    async (_name, installSource) => {
      const inherited = vi.fn();
      const inheritedCarrier = Object.create({ toggle: inherited }) as Record<string, unknown>;
      const inheritedElement = new FakeElement({ 'on:click': '/c/theme.js#toggle' });
      await expect(
        dispatchInlineDelegatedClick(
          inheritedElement,
          async () => inheritedCarrier,
          installSource,
          ['/c/theme.js'],
        ),
      ).rejects.toThrow('Handler export not found: /c/theme.js#toggle');
      expect(inherited).not.toHaveBeenCalled();

      const getter = vi.fn(() => inherited);
      const accessorCarrier: Record<string, unknown> = {};
      Object.defineProperty(accessorCarrier, 'toggle', { configurable: true, get: getter });
      const accessorElement = new FakeElement({ 'on:click': '/c/theme.js#toggle' });
      await expect(
        dispatchInlineDelegatedClick(accessorElement, async () => accessorCarrier, installSource, [
          '/c/theme.js',
        ]),
      ).rejects.toThrow('Handler export not found: /c/theme.js#toggle');
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it.each(inlineSourceInstallCases)(
    'rejects non-Kovo handler import URLs before import through %s',
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
        ).rejects.toThrow('Disallowed Kovo dynamic import URL: data:text/javascript');
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
