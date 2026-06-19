import { definedProps } from './defined-props.js';
import { reportRuntimeContextError } from './error-policy.js';
import type { RuntimeErrorContext } from './events.js';
import type { LoaderRoot } from './loader-lifecycle.js';
import { installClockUpdatePlans, type ClockUpdatePlan } from './clock-tick-bus.js';
import { installInlineQueryEventHydration } from './query-events.js';
import type { QueryEventHydrationTarget } from './query-events.js';
import type { QueryApplyInterposition } from './query-apply.js';
import type { CompiledQueryUpdatePlans } from './query-bindings.js';
import type { QueryBindingRoot } from './query-bindings.js';
import { installQueryVisibleReturnRefetch } from './query-visible-return.js';
import type { QueryRefetchOptions } from './query-refetch.js';
import type { QueryStore } from './query-store.js';

export interface InstallLoaderQueryRuntimeOptions {
  applyQuery?: QueryApplyInterposition;
  clockUpdatePlans?: readonly ClockUpdatePlan[];
  onError?: (error: unknown, context: RuntimeErrorContext) => void;
  queryEventTarget?: QueryEventHydrationTarget;
  queryPlans?: CompiledQueryUpdatePlans;
  queryRefetch?: QueryRefetchOptions;
  queryStore?: QueryStore;
  refetchOnFocus?: (queries: readonly string[]) => void | Promise<void>;
  refetchOnFocusOptOut?: readonly string[];
  root: LoaderRoot;
}

export interface InstalledLoaderQueryRuntime {
  dispose(): void;
  rememberAppliedQueries(queries: readonly string[]): void;
}

export function installLoaderQueryRuntime(
  options: InstallLoaderQueryRuntimeOptions,
): InstalledLoaderQueryRuntime {
  const disposers: Array<() => void> = [];
  const reportQueryHydrationError = (error: unknown): void => {
    reportRuntimeContextError(options.onError, error, { phase: 'query-hydration' });
  };
  const queryVisibleReturn = installQueryVisibleReturnRefetch({
    onError: reportQueryHydrationError,
    ...definedProps({
      applyQuery: options.applyQuery,
      queryPlans: options.queryPlans,
      queryRefetch: options.queryRefetch,
      queryStore: options.queryStore,
      refetchOnFocus: options.refetchOnFocus,
      refetchOnFocusOptOut: options.refetchOnFocusOptOut,
    }),
    root: options.root,
  });

  disposers.push(() => {
    queryVisibleReturn.dispose();
  });

  if (
    options.clockUpdatePlans &&
    options.clockUpdatePlans.length > 0 &&
    typeof options.root.querySelectorAll === 'function'
  ) {
    disposers.push(
      installClockUpdatePlans(options.root as QueryBindingRoot, options.clockUpdatePlans),
    );
  }

  if (options.queryStore) {
    disposers.push(
      installInlineQueryEventHydration({
        onAppliedQueries(queries) {
          queryVisibleReturn.rememberAppliedQueries(queries);
        },
        onError: reportQueryHydrationError,
        root: options.root,
        store: options.queryStore,
        target:
          options.queryEventTarget ??
          globalQueryEventTarget() ??
          (options.root as unknown as QueryEventHydrationTarget),
        ...definedProps({
          applyQuery: options.applyQuery,
          queryPlans: options.queryPlans,
        }),
      }),
    );
  }

  return {
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
    rememberAppliedQueries(queries) {
      queryVisibleReturn.rememberAppliedQueries(queries);
    },
  };
}

function globalQueryEventTarget(): QueryEventHydrationTarget | undefined {
  return typeof globalThis.addEventListener === 'function' ? globalThis : undefined;
}
