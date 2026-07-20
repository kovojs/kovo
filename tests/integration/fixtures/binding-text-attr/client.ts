import { createQueryStore, installKovoLoader } from '@kovojs/browser/client';
import { installInlineQueryEventHydration } from '@kovojs/test/internal/integration/fixture-browser-abi';
import { kovoFixtureQueryPlans } from 'virtual:kovo-fixture-generated-query-plans';

const store = createQueryStore();
for (const query of Object.keys(kovoFixtureQueryPlans)) {
  const descriptor = Object.getOwnPropertyDescriptor(kovoFixtureQueryPlans, query);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw new TypeError(`Fixture query ${query} has no compiler-owned update plan.`);
  }
  const applyPlan = descriptor.value;
  store.subscribe(query, (value) => {
    // The inline response runtime publishes query truth before morphing fragments. Replaying in
    // the next microtask applies the compiler-owned stamps to the post-morph DOM as well as to the
    // initial document hydrated below.
    queueMicrotask(() => applyPlan(document, value, { queryStore: store }));
  });
}

// Use the public loader once for its normative initial <script kovo-query> hydration, then retire
// its delegated listeners. The focused fixture keeps only the inline response listener below.
const initialHydration = installKovoLoader({
  importModule: (specifier) => import(specifier),
  queryStore: store,
  root: document,
});
initialHydration.dispose();

installInlineQueryEventHydration({
  onAppliedQueries(queries) {
    for (let index = 0; index < queries.length; index += 1) {
      if (!Object.hasOwn(kovoFixtureQueryPlans, queries[index]!)) {
        throw new TypeError(`Fixture query ${queries[index]!} has no compiler-owned update plan.`);
      }
    }
  },
  root: document,
  store,
  target: window,
});
