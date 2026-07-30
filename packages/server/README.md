# @kovojs/server

Kovo's server runtime separates ordinary app declarations from operational authorities. Start at
the package root; import an advanced capability from the task path that names what it can do.

```sh
pnpm add @kovojs/server
```

## Declare an app

```tsx
/** @jsxImportSource @kovojs/server */
import { defineKovo, tag } from '@kovojs/server';

const app = defineKovo({});
export const cartItem = tag();

const home = app.route('/', {
  access: app.publicAccess('public homepage'),
  page: () => <main>Hello from Kovo</main>,
});

export default app.assemble({ routes: [home] });
```

The root is the daily declaration surface: app assembly, routes, layouts, guards, schemas, queries,
mutations, responses, invalidation domains/tags, and document primitives. The compiler derives the
exported `cartItem` tag's stable identity; pass an explicit name only for shared external
vocabulary. Advanced work has one semantic home:

| Task                                | Import path                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Agents and tools                    | `@kovojs/server/agent`                                                                                             |
| Build presets and Vite integration  | `@kovojs/server/build`, `@kovojs/server/vite`                                                                      |
| Versioned client-module registries  | `@kovojs/server/client-modules`                                                                                    |
| Commands and process allowlists     | `@kovojs/server/command`                                                                                           |
| Confidential-at-rest encryption     | `@kovojs/server/confidential`                                                                                      |
| Custom request adapters             | `@kovojs/server/custom-adapters`                                                                                   |
| Managed reads and cache influence   | `@kovojs/server/data`                                                                                              |
| Delegation and principal lifecycle  | `@kovojs/server/delegation`, `@kovojs/server/principal-epochs`, `@kovojs/server/principal-erasure`                 |
| Derived datasets and replay         | `@kovojs/server/derived-data`, `@kovojs/server/replay`                                                             |
| Diagnostics and routing contracts   | `@kovojs/server/diagnostics`, `@kovojs/server/routing`                                                             |
| Egress, files, downloads, and keys  | `@kovojs/server/egress`, `@kovojs/server/files`, `@kovojs/server/storage-downloads`, `@kovojs/server/storage-keys` |
| Node integration                    | `@kovojs/server/node`                                                                                              |
| Passwords and signing keys          | `@kovojs/server/password`, `@kovojs/server/signing`                                                                |
| Postgres lifecycle                  | `@kovojs/server/postgres`                                                                                          |
| SQLite app runtime                  | `@kovojs/server/sqlite`                                                                                            |
| Rendering and component trees       | `@kovojs/server/rendering`, `@kovojs/server/render-tree`                                                           |
| Secret-read and security boundaries | `@kovojs/server/secret-reading`, `@kovojs/server/security`                                                         |
| Static export                       | `@kovojs/server/static-export`                                                                                     |
| Durable tasks and webhooks          | `@kovojs/server/tasks`, `@kovojs/server/webhooks`                                                                  |
| Write-safety evidence               | `@kovojs/server/write-safety`                                                                                      |

## Custom adapters

Custom adapters must establish Kovo's runtime ordering before evaluating the app or adapter. Keep
the bootstrap import as the literal first import, as required by `SPEC.md` §6.6.

```ts
import '@kovojs/server/runtime-bootstrap';

import { createRequestHandler, type InferKovoAppTypes } from '@kovojs/server/custom-adapters';
import { toNodeHandler } from '@kovojs/server/node';
import app from './app.js';

type AppTypes = InferKovoAppTypes<typeof app>;

const handle = createRequestHandler(app);
export const nodeHandler = toNodeHandler(handle);
```

`InferKovoAppTypes` is the narrow compile-time bridge for custom adapters and test harnesses. It
retains the inferred request/DB contract and exact assembled declaration-handle unions; the runtime
app remains an empty token whose providers, registries, and declaration arrays stay private.

## Advanced capability catalog

Import only the authorities a module owns. The complete value catalog below makes each semantic
home searchable without widening the daily root:

```ts
import { agent, agentContent, createAgentSession, runAgentTurn, tool } from '@kovojs/server/agent';
import { cloudflare, defineConfig, node as nodePreset, vercel } from '@kovojs/server/build';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules';
import { cmd, commandAllowlist, runCommand } from '@kovojs/server/command';
import {
  createConfidentialAtRestCipher,
  decryptAtRest,
  encryptAtRest,
  rewrapAtRest,
} from '@kovojs/server/confidential';
import { createRequestHandler } from '@kovojs/server/custom-adapters';
import {
  declarePublicRead,
  readonlyDb,
  type AppDbProvider,
  type Reader,
  type Writer,
} from '@kovojs/server/data';
import {
  createMemoryMutationReplayStore,
  replayMutationWireBody,
  type MutationReplayBody,
} from '@kovojs/server/replay';
import { createDelegationAuthority, onBehalfOf } from '@kovojs/server/delegation';
import { derived } from '@kovojs/server/derived-data';
import { EgressBlockedError, EgressConfigError } from '@kovojs/server/egress';
import { rootedFiles } from '@kovojs/server/files';
import { toNodeHandler } from '@kovojs/server/node';
import {
  PASSWORD_ARGON2ID_DEFAULTS,
  hashPassword,
  isArgon2idPasswordDigest,
  verifyCredential,
  verifyPassword,
} from '@kovojs/server/password';
import {
  checkPostgresAppDbPosture,
  createPostgresAppRuntimeDb,
  declarePublicRelation,
  migratePostgresAppDb,
  planPostgresAppDbMigration,
  postgresAppRuntimeOptions,
  postgresSchemaModule,
  provisionPostgresAppDb,
} from '@kovojs/server/postgres';
import {
  PrincipalEpochStaleError,
  PrincipalEpochUnavailableError,
  advancePrincipalEpoch,
  createMemoryPrincipalEpochStore,
  initializePrincipalEpoch,
  tombstonePrincipalEpoch,
} from '@kovojs/server/principal-epochs';
import {
  PrincipalErasureIncompleteError,
  erasePrincipal,
  verifyPrincipalErasureReceipt,
} from '@kovojs/server/principal-erasure';
import {
  ComponentXmlError,
  parseComponentXml,
  renderRegistry,
  renderTree,
} from '@kovojs/server/render-tree';
import { renderRouteHtml } from '@kovojs/server/rendering';
import { declareSecretReadCapability } from '@kovojs/server/secret-reading';
import {
  InlineUnverifiedUploadError,
  RedosPatternError,
  accept,
  mintCsrfField,
  mintCsrfToken,
  unsafeCookie,
  unsafeRegex,
} from '@kovojs/server/security';
import { createSigningKeyRing } from '@kovojs/server/signing';
import { createSqliteAppRuntime } from '@kovojs/server/sqlite';
import { StaticExportError, exportStaticApp } from '@kovojs/server/static-export';
import {
  DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  createStorageDownloadEndpoint,
} from '@kovojs/server/storage-downloads';
import { scopedKey } from '@kovojs/server/storage-keys';
import { createDurableTaskStatus, task } from '@kovojs/server/tasks';
import { kovo } from '@kovojs/server/vite';
import {
  createMemoryWebhookReplayStore,
  webhook,
  webhookReplayIdentity,
} from '@kovojs/server/webhooks';
import { serverValue, trustedAssign } from '@kovojs/server/write-safety';
```

API reference: `/api/server/`. Task-first guides: `/guides/request-shell/`,
`/guides/deployment/`, and `/guides/streaming/`.
