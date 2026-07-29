# API v1 cumulative migration

Kovo 0.2 makes one technical-preview cut to the app-facing API. Run one command before changing
package versions:

```sh
kovo fix api-v1 --check
```

`--check` reads the project and prints `kovo-api-migration-result/v1`. It exits 1 when a
mechanical rewrite or a manual decision remains. It never writes. Each refusal names the owning
batch, a UTF-8 source byte range, why Kovo stopped, and the exact manual action to take.

Resolve every refusal, commit or stash unrelated work, then apply the complete transaction:

```sh
kovo fix api-v1 --write
kovo fix api-v1 --check
```

The write is all-or-nothing across the selected source set. A refusal leaves every file unchanged.
If a captured file changes while Kovo is committing, Kovo stops and rolls back files it already
wrote when their bytes still match the migration output. The final check exits 0 only when a
second run is a no-op.

Pass one or more files or directories to narrow the transaction:

```sh
kovo fix api-v1 src packages/app --check
kovo fix api-v1 src packages/app --write
```

The result's `migrationBatches` field lists the exact checked-ledger order. The command covers the
core, Style, UI/headless/icons, browser installer and authoring, server, test harness, Drizzle, and
Better Auth batches. The standalone `scripts/migrate-*.mjs` commands remain release-maintainer
evidence for those batches; app upgrades use the cumulative `kovo fix api-v1` command.

## Move core imports

Keep ordinary component, route, query, and form authoring at `@kovojs/core`. Import security,
storage, webhook, and diagnostic tasks from their canonical homes.

Before:

```ts
import { component, createMemoryStorage, type DiagnosticCode, secret } from '@kovojs/core';
```

After:

```ts
import { component } from '@kovojs/core';
import type { DiagnosticCode } from '@kovojs/core/diagnostics';
import { secret } from '@kovojs/core/security';
import { createMemoryStorage } from '@kovojs/core/storage';
```

Types that only exposed inference plumbing or provider internals have no replacement import. Delete
the annotation and let the app contract infer it, or define an app-local type for the real boundary.

## Migrate styles and themes

`StyleRecord` was a forgeable representation. `StyleHandle` is the opaque value returned by Style
creation.

Before:

```ts
import type { StyleRecord } from '@kovojs/style';

export interface CardStyles {
  root: StyleRecord;
}
```

After:

```ts
import type { StyleHandle } from '@kovojs/style';

export interface CardStyles {
  root: StyleHandle;
}
```

The tool does not guess what `createTheme` meant. Use `defineTheme` only for a reviewed seed theme.
For variable overrides or aggregate style inputs, write the app-owned shape explicitly.

## Update components, headless primitives, and icons

Import copied/versioned UI components from direct task paths. The empty `@kovojs/ui` root is gone.
Choose the component home yourself because a namespace or root import does not identify it.

Before:

```ts
import { Card } from '@kovojs/ui';
import type { IconRenderResult } from '@kovojs/icons';
```

After:

```ts
import { Card } from '@kovojs/ui/card';
import type { ComponentRenderResult } from '@kovojs/core';
```

Retired headless state projections also stop. Replace them with the public `*Attributes` builder
that matches the rendered primitive anatomy. Do not copy the internal transition state into app
code.

## Replace custom client assembly

Custom shells install one bounded client. Kovo continues to own request construction, same-origin
credentials, redirect rejection, referrer policy, build headers, and the module allowlist.

Before:

```ts
import { installKovoLoader } from '@kovojs/browser/client';

installKovoLoader({ root: document });
```

After:

```ts
import { installKovoClient } from '@kovojs/browser/client';

const client = installKovoClient({ root: document });
await client.ready;
await client.dispose();
```

The migration only rewrites the exact result-free installer call. Manual stores, roots,
transports, allowlists, and generated plans are refused because translating them could discard
lifecycle or security behavior.

## Make browser trust and derive inputs explicit

Trust reviews are structured. Dependency identities are handles rather than runtime-name strings.

Before:

```ts
const article = trustedHtml(markup, 'reviewed Markdown output');
```

After:

```ts
const article = trustedHtml(markup, {
  reason: 'reviewed Markdown output',
  source: 'src/markdown.ts',
});
```

A non-empty static reason is wrapped mechanically. Missing, blank, or dynamic metadata is refused;
Kovo will not invent a trust decision. Replace raw `derive` strings with `derive.query(...)`,
`derive.state<Value>()`, or `derive.clock<Value>()` using the exact app-owned handle.

## Move server imports by task

The server root keeps ordinary app declaration. Authority-bearing and operational APIs move to
task paths so imports show intent during review.

Before:

```ts
import {
  createPostgresAppRuntimeDb,
  createRequestHandler,
  task,
  toNodeHandler,
} from '@kovojs/server';
```

After:

```ts
import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { toNodeHandler } from '@kovojs/server/node';
import { createPostgresAppRuntimeDb } from '@kovojs/server/postgres';
import { task } from '@kovojs/server/tasks';
```

Custom adapters keep this side-effect import literally first:

```ts
import '@kovojs/server/runtime-bootstrap';
```

Generated fragments, framework/system database handles, resolved options, live-target authority,
and `isKovoApp` are not app API. There are no compatibility aliases or catch-all barrels.

## Bind tests to the built app

The harness takes compile-time types from the imported app and runtime facts from the exact
successful build artifact.

Before:

```ts
const harness = createKovoTestHarness({
  graph: callerAuthoredGraph,
  pages: callerAuthoredPages,
});
```

After:

```ts
const harness = await createKovoTestHarness(app, {
  artifact: new URL('../dist/.kovo/graph.json', import.meta.url),
  projectRoot: new URL('../', import.meta.url),
  db,
});
```

Kovo cannot infer the app, artifact, absolute project root, or HTTP origin. Those call sites are
intentional refusals. Postgres helpers now come from `@kovojs/test/postgres`; the focused CSRF
helper comes from `@kovojs/test/csrf`.

## Migrate Drizzle annotations

Annotations now use exact Drizzle column objects. Strings, lookalikes, and runtime metadata records
do not prove column identity.

Before:

```ts
kovo({
  key: 'accountId,id',
  ownerVia: { fk: 'accountId', parent: accounts, parentKey: 'id' },
  secret: ['secret'],
});
```

After:

```ts
kovo((columns) => ({
  key: [columns.accountId, columns.id],
  ownerVia: {
    fk: columns.accountId,
    parent: accounts,
    parentKey: accounts.id,
  },
  secret: [columns.secret],
}));
```

Dynamic composition and app-authored runtime security metadata are refused. Choose the concrete
columns in source; do not cast a structural lookalike.

## Move generated auth bindings

Human auth workflows remain at `@kovojs/better-auth`. Compiler-generated database assembly moves to
backend-specific generated paths.

Before:

```ts
import {
  createBetterAuthPostgresBindingsFromEnvironment,
  type BetterAuthBindingRequest,
} from '@kovojs/better-auth';
```

After:

```ts
import type { BetterAuthGeneratedRequest } from '@kovojs/better-auth/generated';
import { createBetterAuthPostgresBindingsFromEnvironment } from '@kovojs/better-auth/generated/postgres';
```

Use `@kovojs/better-auth/generated/sqlite` for SQLite. A retired credential mutation carrier is
refused because the correct replacement is an app-local result contract, not generated authority.

## Resolve security-posture refusals

The command never chooses security or deployment intent. The refusal category tells you what must
be explicit before rerunning:

| Category             | Manual action                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `trust-decision`     | Write structured, non-empty review metadata or construct the policy for the exact declassification door.                 |
| `auth-posture`       | Bind the app's guard and session authority explicitly; do not infer it from an old carrier name.                         |
| `csrf-posture`       | Select the route's CSRF verifier or a reviewed explicit exemption in source.                                             |
| `sql-semantics`      | Replace the SQL with the typed Drizzle form or declare the reviewed read/write facts; never infer meaning from a string. |
| `deployment-posture` | Configure the concrete origin/runtime boundary, including a separate HTTP origin when the harness needs page behavior.   |
| `app-context`        | Import the exact app contract or define the app-local boundary named by the refusal.                                     |
| `ambiguous-binding`  | Replace namespace/default/wildcard/CommonJS access with direct named imports, then rerun the command.                    |
| `dynamic-import`     | Replace computed module access with a static canonical import, then rerun the command.                                   |

Every refusal includes a `manualAction` with the task section to use. Do not suppress the refusal
with a cast, a compatibility barrel, a copied internal type, or a raw generated import.

## Prove the migrated app

Build the migrated app, then inspect the same graph the runtime will use:

```sh
kovo build ./src/app.tsx --out dist
kovo explain query contacts dist/.kovo/graph.json
```

The output stays on the stable explain protocol. An application-specific query looks like:

```text
kovo-explain/v1
QUERY contacts
reads: contact
consumers: component:ContactList,page:/
invalidated-by: contacts/add,contacts/delete
domain-writes: -
```

Import paths and opaque authoring handles changed; the proof facts did not become app-authored
metadata. Inspect relevant mutation, access, endpoint, trust, and capability views before release.

## Roll back

Start from a clean worktree. Restore the previous Kovo package versions, then reverse only files
reported as `rewritten` by `kovo-api-migration-result/v1`. Do not recreate removed roots, aliases,
overloads, compatibility barrels, generated carriers, or hand-authored lowered IR.
