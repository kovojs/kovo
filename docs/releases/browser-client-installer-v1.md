# Browser client installer v1

Custom application shells now install Kovo with one experimental API:

```ts
import { installKovoClient } from '@kovojs/browser/client';

const client = installKovoClient({
  root: document,
  importModule: (url) => import(url),
});

await client.ready;
await client.dispose();
```

The installer owns the query store, morph adapter, mutation transport, module-allowlist snapshot,
and mutable runtime caches. A custom `fetch` callback is an observer around a zero-argument
`next()`: Kovo still constructs the exact `Request`, fixes same-origin credentials, rejects
redirects, fixes the referrer policy, preserves framework headers, and accepts only the exact
`Response` returned by `next()`.

`dispose()` defaults to drain mode. It removes listeners immediately, waits for requests and module
loads that already started to settle, then clears document-scoped state. `dispose('abort')` removes
listeners, aborts active requests, rejects late module results, and clears state without waiting for
authored wrappers. A server-declared session transition automatically takes the abort path before
Kovo's mandatory full-document recovery.

Compiler-emitted applications continue to use `@kovojs/browser/generated`; low-level store, root,
loader, and transport values are generated ABI rather than app-authored assembly.

Before upgrading, run:

```sh
node scripts/migrate-browser-client-installer-v1.mjs --check src
```

The tool rewrites a result-free `installKovoLoader({ root, importModule?, onError? })` call when its
intent is exact. It refuses app-owned stores, morph roots, transports, allowlists, loader handles,
and generated plans because silently discarding or translating those values could change security
or lifecycle behavior. Resolve each anchored refusal, then run the tool with `--write`.

Rollback requires a clean worktree: restore the prior Kovo package versions and reverse only the
client bootstrap edits named by the structured migration result. Do not expose generated runtime
assembly through an application barrel.
