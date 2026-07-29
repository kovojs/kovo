# Server task topology v1

`@kovojs/server` now keeps ordinary app declaration at its root and publishes advanced
capabilities from semantic task paths. This makes autocomplete smaller, makes authority-bearing
imports visible in review, and lets implementation carriers evolve without becoming app API.

This is a technical-preview breaking change. Run the migration tool before upgrading:

```sh
node scripts/migrate-server-api-v1.mjs --check src
node scripts/migrate-server-api-v1.mjs --write src
```

The tool rewrites direct named imports and re-exports from `@kovojs/server`. It refuses namespace,
wildcard, dynamic, type-query, and removed-carrier cases because those require app context. Review
each structured refusal instead of using a blanket replacement.

Representative moves:

```ts
import { task } from '@kovojs/server/tasks';
import { createPostgresAppRuntimeDb } from '@kovojs/server/postgres';
import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { toNodeHandler } from '@kovojs/server/node';
```

Assembled apps remain empty, WeakMap-owned runtime tokens. Custom adapters and test harnesses can
import the type-only `InferKovoAppTypes` helper from `@kovojs/server/custom-adapters` to recover the
inferred request/DB contract and exact declaration-handle unions without exposing runtime
providers, registries, or assembly arrays.

Custom adapters must keep this side-effect import literally first:

```ts
import '@kovojs/server/runtime-bootstrap';
```

The discarded `committedSecretWaiver` export has no replacement. Use the specific validating or
declassification constructor for the security door being crossed; framework-resolved options,
generated wire/fragment shapes, framework database carriers, live-target authority, and
`isKovoApp` are no longer public.
