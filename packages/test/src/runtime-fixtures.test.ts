import { describe, expect, it } from 'vitest';

import { loaderSmokeBehaviorFact, type LoaderSmokeRuntime } from './runtime-fixtures.ts';

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
});
