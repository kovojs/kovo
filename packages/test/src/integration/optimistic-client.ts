import {
  createBrowserKovoRoot,
  createQueryStore,
  defaultEnhancedFetch,
  installKovoLoader,
  type EnhancedMutationFetch,
  type QueryStore,
} from '@kovojs/browser/client';
import { applyCompiledQueryUpdatePlan } from '@kovojs/browser/generated';
import { keyedDomMorph } from '@kovojs/browser/internal/morph';
import {
  OptimisticRebaser,
  stampPendingQueries,
  submitOptimisticEnhancedMutation,
  type OptimisticEnhancedMutationSubmitOptions,
} from '@kovojs/browser/internal/mutation';

type OptimisticFixturePlan<Input> = OptimisticEnhancedMutationSubmitOptions<Input>['optimistic'];

/** @internal Options for the framework-owned optimistic integration fixture client. */
export interface OptimisticFixtureClientOptions {
  discardPendingOptimism?: boolean;
  installLoader?: boolean;
  importModule?: (url: string) => Promise<unknown>;
  queryRefetch?: boolean;
  queries?: Readonly<Record<string, (value: unknown, root: Document) => void>>;
}

/** @internal Submit options for the framework-owned optimistic integration fixture client. */
export interface OptimisticFixtureSubmitOptions<Input> {
  formData?: unknown;
  input: Input;
  optimistic: OptimisticFixturePlan<Input>;
}

/** @internal Framework-owned optimistic integration fixture client. */
export interface OptimisticFixtureClient {
  pendingCount(queryName: string): number;
  store: QueryStore;
  submitForm<Input>(
    form: HTMLFormElement,
    options: OptimisticFixtureSubmitOptions<Input>,
  ): Promise<unknown>;
}

/**
 * @internal
 *
 * Framework-owned optimistic integration specs still need the raw optimistic submit ABI
 * while app-facing optimism sugar is not public. Keep that white-box wiring in the test
 * harness so fixture client entries can use public/generated browser surfaces directly.
 */
export function installOptimisticFixtureClient(
  options: OptimisticFixtureClientOptions = {},
): OptimisticFixtureClient {
  const store = createQueryStore();
  const rebaser = new OptimisticRebaser(store);
  const root = createBrowserKovoRoot();

  if (options.installLoader !== false) {
    installKovoLoader({
      ...(options.discardPendingOptimism
        ? {
            discardPendingOptimism() {
              const discarded = rebaser.discardPendingOptimism();
              stampPendingQueries(document, discarded, false);
              return discarded;
            },
          }
        : {}),
      importModule: options.importModule ?? ((url) => import(/* @vite-ignore */ url)),
      ...(options.queryRefetch ? { queryRefetch: { fetch: window.fetch.bind(window) } } : {}),
      queryStore: store,
      root: document,
    });
  }

  for (const [queryName, apply] of Object.entries(options.queries ?? {})) {
    store.subscribe(queryName, (value: unknown) => {
      applyCompiledQueryUpdatePlan(document, queryName, value);
      apply(value, document);
    });
  }

  return {
    pendingCount(queryName) {
      return rebaser.pendingCount(queryName);
    },
    store,
    submitForm<Input>(form: HTMLFormElement, submitOptions: OptimisticFixtureSubmitOptions<Input>) {
      return submitOptimisticEnhancedMutation({
        fetch: defaultEnhancedFetch as EnhancedMutationFetch,
        form,
        formData: submitOptions.formData ?? new FormData(form),
        input: submitOptions.input,
        morph: keyedDomMorph,
        optimistic: submitOptions.optimistic,
        pendingRoot: document,
        rebaser,
        root,
        store,
      });
    },
  };
}
