---
title: Testing with @kovojs/test
description: Exercise one imported Kovo app with inferred types and runtime facts from an exact successful build.
order: 6
---

# Testing with @kovojs/test

Use the app-scoped harness when you want fast mutation, query, route, and database assertions
without starting a browser. It has two deliberately separate sources of truth:

| Contract                                                                 | Source                      | Benefit                                             |
| ------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------- |
| Mutation input/error/result, query input/result, route keys, request, DB | The imported app token      | Renames and invalid calls fail in TypeScript.       |
| Query reads, mutation touches, build posture, analyzed inputs            | The explicit build artifact | Tests cannot invent the graph they claim to verify. |

## Run an app-scoped harness

Install the test package, build the same app you will import, then run the test:

```sh
pnpm add -D @kovojs/test
kovo build ./src/app.tsx
kovo test
```

Pass absolute artifact and project-root URLs. The harness does no nearby-file discovery.

```ts
// Source: examples/crm/src/testing.ts
import { createKovoTestHarness } from '@kovojs/test/harness';

const harness = await createKovoTestHarness(crmApp, {
  artifact: new URL('../dist/.kovo/graph.json', import.meta.url),
  db,
  projectRoot: new URL('../', import.meta.url),
  // ... typed request and verifier mapping are in the source file
});

const result = await harness.query(contactListQuery);
if (result.items.length < 2) throw new Error('Expected seeded contacts.');
```

`result` is inferred from `contactListQuery`; `db` and `request` must match `crmApp`; only route
keys and mutation/query handles assembled into `crmApp` are accepted.

`page()` and `request()` exercise the wire against the explicit `baseUrl` of a separately
bootstrapped app. This keeps the app request realm isolated from Vitest's mutable globals. Direct
`query()` and `exec()` tests stay in-process and do not require `baseUrl`.

Before returning the harness, Kovo verifies:

- a successful, complete graph proof;
- the compiler, source-set, config-set, lockfile, and runtime-posture digests;
- every analyzed source/config file against its current bytes;
- the artifact's stable app identity against the imported app.

A source edit, dependency reinstall, partial build, or artifact copied from another app therefore
fails before one handler runs. Rebuild instead of weakening that check.

## Execute a mutation

`exec` accepts only a mutation handle from the imported app and infers its input and structured
result:

```ts
const result = await harness.exec(addContact, {
  company: 'Analytical Engines',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
});

if (result.ok) {
  expect(result.value).toEqual({ ok: true });
}
expect(harness.verificationDiagnostics()).toEqual([]);
```

The harness scopes write verification to the mutation's assembled handle. There is no
`touchGraphKey` option and no caller-supplied touch graph.

For a declared application error, assert and narrow its payload:

```ts
import { assertMutationError } from '@kovojs/test/assertions';

const result = await harness.exec(addToCart, addToCartInput);
const payload = assertMutationError(addToCart, result, {
  code: 'OUT_OF_STOCK',
  payload: { availableQuantity: 5 },
});
// payload is inferred as { availableQuantity: number }
```

Framework-owned failures such as `CSRF`, `UNAUTHORIZED`, `VALIDATION`, `RATE_LIMITED`, and
`STALE_VERSION` remain explicit in the harness result union.

## Query and render

Queries are app-scoped and their observed SQL reads are compared with artifact-derived read facts:

```ts
const contacts = await harness.query(contactListQuery);
expect(contacts.items[0]?.email).toContain('@');
```

Routes use the app's exact route-key union:

<!-- kovo-sample: illustrative reason="Requires the separately bootstrapped app URL and app-local build paths from the test setup." -->

```ts
const wireHarness = await createKovoTestHarness(crmApp, {
  artifact,
  baseUrl: 'http://127.0.0.1:4173',
  projectRoot,
});

const page = await wireHarness.page('/contacts');
expect(page.html).toContain('<main');
expect(page.fragment('contacts-region')).toContain('Ada');
```

Use `wireHarness.request(request)` when the app declares a custom raw-request contract. Requests
whose origin differs from `baseUrl` are rejected.

## Exercise real Postgres RLS

The Postgres test helper is separate from the ordinary harness entry. It runs the same
owner-scoped, admin-read, and audited system postures as the server:

```ts
import { createPostgresTestRuntime } from '@kovojs/test/postgres';
import * as schema from './schema.js';

const runtime = await createPostgresTestRuntime({ schema });
try {
  await runtime.withPrincipal('u1', async (db) => {
    await db.insert(schema.contacts).values(contact);
  });
  await expect(
    runtime.withPrincipal('u2', (db) => db.select().from(schema.contacts)),
  ).resolves.toEqual([]);
} finally {
  await runtime.close();
}
```

`asAdmin` requires an explicit `crossOwnerReadTables` allowlist. `asSystem` requires a non-empty
audit reason. Neither is a blanket test bypass.

For direct engine fixtures, import `@kovojs/test/pglite` or `@kovojs/test/sqlite` and install that
entry's optional engine peer. The harness package keeps Playwright and native/all-backend database
engines out of its ordinary install closure.

## Mint a focused CSRF token

Prefer rendering the real form and reading its hidden token. For a focused request-level test:

```ts
import { mutationCsrfTokenForTesting } from '@kovojs/test/csrf';

const token = mutationCsrfTokenForTesting(request, appCsrf, {
  mutation: addContact,
});
```

## Handle a graph mismatch

Runtime observation checks the sound direction:

> observed reads/writes ⊆ artifact-derived reads/touches ∪ reviewed opaque declarations

Excess declarations can over-invalidate and warn. Missing declarations can leave a UI stale and
fail. Read `harness.verificationDiagnostics()` after a run; the collapsed reference below maps
each code to the mismatch you need to fix.

## Property-test optimistic transforms

Keep pure optimistic transforms honest across generated state/input cases:

```ts
import { propertyTest } from '@kovojs/test/assertions';

expect(
  propertyTest({
    apply: (state, input) => applyAddToCartEffect(state, input),
    cases: generatedCartStates(),
    predict: (state, input) => addToCartOptimistic.transforms.cart(state, input),
    shape: (state) => shapeCartQuery(state),
  }),
).toEqual({ cases: 18 });
```

## What still needs a browser?

Use browser tests for native platform behavior: focus/caret survival, scroll, view transitions,
file pickers, and browser accessibility semantics. App wiring, handler logic, rendered HTML,
typed failures, graph honesty, and optimistic transform soundness belong in the browser-free
suite.

<details>
<summary>Spec & diagnostics</summary>

App/build identity and completion proof: SPEC §5.2.4. Browser-free testing and artifact binding:
SPEC §12. Mutation lifecycle and typed errors: SPEC §6.3. Database read/write verification:
SPEC §11.2–§11.4. Postgres owner/admin/system posture: SPEC §10.3.

| Code  | Meaning                                                   |
| ----- | --------------------------------------------------------- |
| KV402 | A write touched an undeclared domain.                     |
| KV403 | A declared write was not observed in this run.            |
| KV404 | A write reached an unmapped table.                        |
| KV405 | A statically known conditional branch was not exercised.  |
| KV406 | An opaque write lacks reviewed touches/tables.            |
| KV407 | A query read an undeclared domain.                        |
| KV408 | The observed row key differs from the declared predicate. |
| KV409 | A non-equality predicate degraded to table invalidation.  |
| KV410 | An opaque result failed its declared output schema.       |
| KV411 | A query read an exempt table.                             |

API reference: [@kovojs/test](/api/test/).

</details>
