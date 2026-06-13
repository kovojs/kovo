import { describe, expect, it } from 'vitest';

import {
  enhancedMutationBehaviorFact,
  loaderSmokeBehaviorFact,
  morphFragmentBehaviorFact,
  optimismCleanupBehaviorFact,
  type EnhancedMutationRuntime,
  type LoaderSmokeRuntime,
  type MorphFragmentRuntime,
  type OptimismCleanupRuntime,
} from './runtime-fixtures.ts';

describe('@jiso/test runtime fixture facts', () => {
  it('projects loader smoke behavior without keeping fake DOM mechanics in fw-check', async () => {
    const store = {
      value: undefined as unknown,
      get() {
        return this.value;
      },
      set(value: unknown) {
        this.value = value;
      },
    };
    const runtime: LoaderSmokeRuntime = {
      applyCompiledQueryUpdatePlan(root, _queryName, value, plan) {
        const selector = (plan as { templateStamps: Array<{ selector: string }> }).templateStamps[0]
          ?.selector;
        const host = (
          root as {
            querySelectorAll(selector: string): Array<{
              reconcileTemplateStamp(items: unknown[]): void;
            }>;
          }
        ).querySelectorAll(selector ?? '')[0];
        host?.reconcileTemplateStamp([
          {
            html: '<li>p1:2</li>',
            index: 0,
            key: 'p1',
            value: (value as { items: unknown[] }).items[0],
          },
        ]);
        return { templateStamps: [selector ?? ''] };
      },
      createQueryStore() {
        return store;
      },
      installJisoLoader(options) {
        const loaderOptions = options as {
          importModule(): Promise<
            Record<string, (event: unknown, context: { signal: AbortSignal }) => void>
          >;
          requestIdle(callback: () => void): void;
          root: {
            addEventListener(
              type: string,
              listener: () => void,
              options?: { capture?: boolean },
            ): void;
            querySelectorAll(selector: string): unknown[];
          };
          visibleObserver(
            callback: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void,
          ): {
            observe(element: unknown): void;
            unobserve(element: unknown): void;
          };
        };
        loaderOptions.root.addEventListener('click', () => {}, { capture: true });
        loaderOptions.root.addEventListener('submit', () => {});
        void loaderOptions.importModule().then((handlers) => {
          handlers.load?.({}, { signal: new AbortController().signal });
          loaderOptions.requestIdle(() => {
            handlers.idle?.({}, { signal: new AbortController().signal });
          });
          let visibleHandled = false;
          const observer = loaderOptions.visibleObserver((entries) => {
            const entry = entries[0];
            if (entry?.isIntersecting && !visibleHandled) {
              visibleHandled = true;
              handlers.visible?.({}, { signal: new AbortController().signal });
              observer.unobserve(entry.target);
            }
          });
          for (const element of loaderOptions.root.querySelectorAll('[on\\:visible]')) {
            observer.observe(element);
          }
        });
        return {
          dispose() {},
          events: ['click', 'submit'],
        };
      },
      async refetchQueries() {
        store.set({ count: 2 });
        return [{ fragments: [], queries: ['cart'] }];
      },
    };

    await expect(loaderSmokeBehaviorFact(runtime)).resolves.toMatchObject({
      appliedTemplateStamps: ['[data-list]'],
      calls: [
        ['load', true],
        ['idle', true],
        ['visible', true],
      ],
      initialImportCount: 1,
      listenerEvents: ['click', 'submit'],
      observer: { observedCount: 1, unobservedCount: 1 },
      storeValues: { cart: { count: 2 } },
    });
  });

  it('projects keyed morph and fragment behavior without keeping fake DOM mechanics in fw-check', () => {
    const values = new Map<string, unknown>();
    const runtime: MorphFragmentRuntime = {
      applyMutationResponseToDom(options) {
        const fixtureOptions = options as {
          body: string;
          root: {
            findFragmentTarget(target: string): {
              appendHtml(html: string): void;
            } | null;
          };
          store: {
            set(name: string, value: unknown, key?: string): void;
          };
        };
        if (fixtureOptions.body.includes('"count":2')) {
          fixtureOptions.store.set('productGrid', { count: 2 }, 'category:all');
        }
        fixtureOptions.root
          .findFragmentTarget('products')
          ?.appendHtml('<article fw-key="p2">New</article>');
        return { appliedFragments: ['products'] };
      },
      createQueryStore() {
        return {
          get(name: string, key?: string) {
            return values.get(key === undefined ? name : `${name}:${key}`);
          },
          set(name: string, value: unknown, key?: string) {
            values.set(key === undefined ? name : `${name}:${key}`, value);
          },
        };
      },
      morphStructuralTree(current, next) {
        const existingByKey = new Map(
          (current.children as Array<Record<string, unknown>>).map((child) => [child.key, child]),
        );
        current.children = (next.children as Array<Record<string, unknown>>).map((child) => {
          const existing = existingByKey.get(child.key);
          if (existing) {
            Object.assign(existing, child);
            return existing;
          }
          return child;
        });
        return current;
      },
    };

    expect(morphFragmentBehaviorFact(runtime)).toEqual({
      appliedFragments: ['products'],
      ignoredMissingTarget: true,
      keyedIdentity: {
        firstItemReusedAfterReorder: true,
        secondItemReusedAtFront: true,
      },
      preservedBrowserState: {
        focused: true,
        scroll: { left: 4, top: 24 },
        selection: { direction: 'forward', end: 3, start: 1 },
      },
      queryStoreValue: { count: 2 },
      renderedTargetHtml: '<article fw-key="p1">Old</article><article fw-key="p2">New</article>',
      reorderedText: 'Alpha next',
    });
  });

  it('projects bfcache optimism cleanup without keeping lifecycle mechanics in fw-check', async () => {
    const runtime: OptimismCleanupRuntime = {
      OptimisticRebaser: class {
        private readonly pending = new Map<string, unknown>();
        constructor(
          private readonly store: {
            get(name: string): unknown;
            set(name: string, value: unknown): void;
          },
        ) {}
        discardPendingOptimism() {
          const discarded = [...this.pending.keys()];
          for (const query of discarded) {
            const entry = this.pending.get(query) as { previous: unknown } | undefined;
            this.store.set(query, entry?.previous);
            this.pending.delete(query);
          }
          return discarded;
        }
        pendingCount(query: string) {
          return this.pending.has(query) ? 1 : 0;
        }
        applyOptimistic(query: string, value: unknown) {
          this.pending.set(query, { previous: this.store.get(query) });
          this.store.set(query, value);
        }
        settle(query: string, value: unknown) {
          this.pending.delete(query);
          this.store.set(query, value);
        }
      } as unknown as OptimismCleanupRuntime['OptimisticRebaser'],
      createQueryStore() {
        const values = new Map<string, unknown>();
        return {
          get(name: string) {
            return values.get(name);
          },
          set(name: string, value: unknown) {
            values.set(name, value);
          },
        };
      },
      installPagehideOptimismCleanup(options) {
        const root = options.root as {
          addEventListener(type: string, listener: (event: unknown) => void): void;
          removeEventListener(type: string, listener: (event: unknown) => void): void;
        };
        const listener = () => options.discardPendingOptimism();
        root.addEventListener('pagehide', listener);
        return {
          dispose() {
            root.removeEventListener('pagehide', listener);
          },
        };
      },
      stampPendingQueries(root, _queries, pending) {
        for (const element of (
          root as {
            querySelectorAll(selector: string): Array<{
              removeAttribute(name: string): void;
              setAttribute(name: string, value: string): void;
            }>;
          }
        ).querySelectorAll('[fw-deps]')) {
          if (pending) {
            element.setAttribute('fw-pending', '');
            element.setAttribute('aria-busy', 'true');
          } else {
            element.removeAttribute('fw-pending');
            element.removeAttribute('aria-busy');
          }
        }
      },
      async submitOptimisticEnhancedMutation(options) {
        const fixtureOptions = options as {
          fetch(url: string, options: unknown): Promise<{ text(): Promise<string> }>;
          formData: FormData;
          pendingRoot: unknown;
          rebaser: {
            applyOptimistic(query: string, value: unknown): void;
            settle(query: string, value: unknown): void;
          };
          stampPendingQueries?: never;
          store: { get(name: string): unknown; set(name: string, value: unknown): void };
        };
        fixtureOptions.rebaser.applyOptimistic('cart', { count: 3 });
        runtime.stampPendingQueries(fixtureOptions.pendingRoot, ['cart'], true);
        const response = await fixtureOptions.fetch('/_m/cart/add', {
          body: fixtureOptions.formData,
          headers: {
            Accept: 'text/vnd.jiso.fragment+html',
            'FW-Fragment': 'true',
            'FW-Idem': 'idem_bfcache',
            'FW-Targets': '',
          },
          keepalive: true,
          method: 'POST',
        });
        await response.text();
        fixtureOptions.rebaser.settle('cart', { count: 2 });
        return {
          appliedFragments: [],
          changes: [],
          fragments: [],
          idem: 'idem_bfcache',
          queries: ['cart'],
          targets: [],
        };
      },
    };

    await expect(optimismCleanupBehaviorFact(runtime)).resolves.toMatchObject({
      listenerStates: {
        afterInstall: { pagehide: true, unload: false },
        afterDispose: { pagehide: false },
      },
      fetchOptions: {
        bodyIsFormData: true,
        formDataQuantity: '2',
        keepalive: true,
        method: 'POST',
      },
      pendingAttributes: {
        afterSubmit: { 'aria-busy': 'true', 'fw-deps': 'cart', 'fw-pending': '' },
        afterPagehide: { 'fw-deps': 'cart' },
      },
      pendingCounts: { afterSubmit: 1, afterPagehide: 0, afterResponse: 0 },
      result: { idem: 'idem_bfcache', queries: ['cart'] },
      storeValues: {
        afterSubmit: { count: 3 },
        afterPagehide: { count: 1 },
        afterResponse: { count: 2 },
      },
    });
  });

  it('projects enhanced mutation behavior without keeping fake DOM mechanics in fw-check', async () => {
    const createQueryStore = () => {
      const values = new Map<string, unknown>();
      const keyFor = (name: string, key?: string) => (key === undefined ? name : `${name}:${key}`);
      return {
        get(name: string, key?: string) {
          return values.get(keyFor(name, key));
        },
        set(name: string, value: unknown, key?: string) {
          values.set(keyFor(name, key), value);
        },
      };
    };
    const runtime: EnhancedMutationRuntime = {
      OptimisticRebaser: class {
        constructor(private readonly store: ReturnType<typeof createQueryStore>) {}
        pendingCount() {
          return 0;
        }
        applyOptimistic(query: string, key: string, value: unknown) {
          this.store.set(query, value, key);
        }
        settle(query: string, key: string, value: unknown) {
          this.store.set(query, value, key);
        }
      } as unknown as EnhancedMutationRuntime['OptimisticRebaser'],
      createQueryStore,
      async submitEnhancedMutation(options) {
        const fixtureOptions = options as {
          broadcast?: {
            publish(body: string, changes: Array<{ domain: string; keys?: string[] }>): void;
          };
          fetch(
            url: string,
            options: { headers: Record<string, string> },
          ): Promise<{
            headers: { get(name: string): string | null };
            text(): Promise<string>;
          }>;
          idem?: string;
          onError?(error: Error): void;
          store: ReturnType<typeof createQueryStore>;
        };
        const response = await fixtureOptions.fetch('/_m/cart/add', {
          headers: {
            Accept: 'text/vnd.jiso.fragment+html',
            'FW-Fragment': 'true',
            'FW-Idem': fixtureOptions.idem ?? '',
            'FW-Targets': '',
          },
        });
        const body = await response.text();
        const changesHeader = response.headers.get('FW-Changes');
        let changes: Array<{ domain: string; keys?: string[] }> = [];
        if (changesHeader === '{bad json') {
          fixtureOptions.onError?.(new Error('Malformed JSON in FW-Changes header: {bad json'));
        } else if (changesHeader) {
          changes = [{ domain: 'cart', keys: ['c1'] }];
        }
        if (body.includes('"count":2')) {
          fixtureOptions.store.set('cart', { count: 2 }, 'cart:c1');
          fixtureOptions.broadcast?.publish(body, changes);
          return { changes, queries: ['cart:c1'] };
        }
        return { changes: [], queries: ['cart'] };
      },
      async submitOptimisticEnhancedMutation(options) {
        const fixtureOptions = options as {
          fetch(
            url: string,
            options: { headers: Record<string, string> },
          ): Promise<{
            headers: { get(name: string): string | null };
            text(): Promise<string>;
          }>;
          pendingRoot: {
            querySelectorAll(selector: string): Array<{
              removeAttribute(name: string): void;
              setAttribute(name: string, value: string): void;
            }>;
          };
          rebaser: {
            applyOptimistic(query: string, key: string, value: unknown): void;
            settle(query: string, key: string, value: unknown): void;
          };
        };
        fixtureOptions.rebaser.applyOptimistic('reviews', 'product:p1', {
          items: [{ id: 'r1' }, { id: 'draft' }],
        });
        for (const element of fixtureOptions.pendingRoot.querySelectorAll('[fw-deps]')) {
          element.setAttribute('fw-pending', '');
        }
        const response = await fixtureOptions.fetch('/_m/reviews/add', {
          headers: { 'FW-Idem': 'idem_optimistic_change' },
        });
        await response.text();
        fixtureOptions.rebaser.settle('reviews', 'product:p1', {
          items: [{ id: 'r1' }, { id: 'server' }],
        });
        for (const element of fixtureOptions.pendingRoot.querySelectorAll('[fw-deps]')) {
          element.removeAttribute('fw-pending');
        }
        return {
          changes: [{ domain: 'product', keys: ['p1'] }],
          queries: ['reviews:product:p1'],
        };
      },
    };

    await expect(enhancedMutationBehaviorFact(runtime)).resolves.toEqual({
      broadcast: {
        events: [
          {
            body: '<fw-query name="cart" key="cart:c1">{"count":2}</fw-query>',
            changes: [{ domain: 'cart', keys: ['c1'] }],
          },
        ],
        fetchHeaders: {
          Accept: 'text/vnd.jiso.fragment+html',
          'FW-Fragment': 'true',
          'FW-Idem': 'idem_change_record',
          'FW-Targets': '',
        },
        resultChanges: [{ domain: 'cart', keys: ['c1'] }],
        resultQueries: ['cart:c1'],
        storeValue: { count: 2 },
      },
      malformedHeader: {
        errorCount: 1,
        errorMessagePrefixMatches: true,
        resultChanges: [],
        resultQueries: ['cart'],
      },
      optimistic: {
        fetchIdemHeader: 'idem_optimistic_change',
        pendingAfterResponse: null,
        pendingDuringFetch: '',
        resultChanges: [{ domain: 'product', keys: ['p1'] }],
        resultQueries: ['reviews:product:p1'],
        storeAfterResponse: { items: [{ id: 'r1' }, { id: 'server' }] },
        storeDuringFetch: { items: [{ id: 'r1' }, { id: 'draft' }] },
      },
    });
  });
});
