# @kovojs/server

Kovo's server runtime separates ordinary app declarations from operational authorities. Start at
the package root; import an advanced capability from the task path that names what it can do.

```sh
pnpm add @kovojs/server
```

## Declare an app

```tsx
/** @jsxImportSource @kovojs/server */
import { defineKovo, publicAccess, tag } from '@kovojs/server';

export const inventoryItem = tag('inventory-item');

export default defineKovo({
  routes: ({ route }) => [
    route('/', {
      access: publicAccess('public homepage'),
      page: () => <main>Hello from Kovo</main>,
    }),
  ],
});
```

The root is the daily declaration surface: app assembly, routes, layouts, guards, schemas, queries,
mutations, responses, and document primitives. Advanced work has one semantic home:

| Task                                | Import path                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Agents and tools                    | `@kovojs/server/agent`                                                                             |
| Commands and process allowlists     | `@kovojs/server/command`                                                                           |
| Confidential-at-rest encryption     | `@kovojs/server/confidential`                                                                      |
| Custom request adapters             | `@kovojs/server/custom-adapters`                                                                   |
| Managed reads and cache influence   | `@kovojs/server/data`                                                                              |
| Delegation and principal lifecycle  | `@kovojs/server/delegation`, `@kovojs/server/principal-epochs`, `@kovojs/server/principal-erasure` |
| Derived datasets and replay         | `@kovojs/server/derived-data`, `@kovojs/server/replay`                                             |
| Diagnostics and routing contracts   | `@kovojs/server/diagnostics`, `@kovojs/server/routing`                                             |
| Egress, rooted files, and downloads | `@kovojs/server/egress`, `@kovojs/server/files`, `@kovojs/server/storage-downloads`                |
| Node integration                    | `@kovojs/server/node`                                                                              |
| Passwords and signing keys          | `@kovojs/server/password`, `@kovojs/server/signing`                                                |
| Postgres lifecycle                  | `@kovojs/server/postgres`                                                                          |
| Rendering and component trees       | `@kovojs/server/rendering`, `@kovojs/server/render-tree`                                           |
| Secret-read and security boundaries | `@kovojs/server/secret-reading`, `@kovojs/server/security`                                         |
| Static export                       | `@kovojs/server/static-export`                                                                     |
| Durable tasks and webhooks          | `@kovojs/server/tasks`, `@kovojs/server/webhooks`                                                  |
| Write-safety evidence               | `@kovojs/server/write-safety`                                                                      |

## Custom adapters

Custom adapters must establish Kovo's runtime ordering before evaluating the app or adapter. Keep
the bootstrap import as the literal first import, as required by `SPEC.md` §6.6.

```ts
import '@kovojs/server/runtime-bootstrap';

import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { toNodeHandler } from '@kovojs/server/node';
import app from './app.js';

const handle = createRequestHandler(app);
export const nodeHandler = toNodeHandler(handle);
```

## Advanced capability catalog

Import only the authorities a module owns. The complete value catalog below makes each semantic
home searchable without widening the daily root:

```ts
import { agent, agentContent, createAgentSession, runAgentTurn, tool } from '@kovojs/server/agent';
import { createMemoryVersionedClientModuleRegistry } from '@kovojs/server/client-modules';
import { cmd, commandAllowlist, runCommand } from '@kovojs/server/command';
import {
  createConfidentialAtRestCipher,
  decryptAtRest,
  encryptAtRest,
  rewrapAtRest,
} from '@kovojs/server/confidential';
import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { declarePublicRead, readonlyDb } from '@kovojs/server/data';
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
import { createMemoryMutationReplayStore, replayMutationWireBody } from '@kovojs/server/replay';
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
import { StaticExportError, exportStaticApp } from '@kovojs/server/static-export';
import {
  DEFAULT_CAPABILITY_DOWNLOAD_BASE_PATH,
  createStorageDownloadEndpoint,
} from '@kovojs/server/storage-downloads';
import { scopedKey } from '@kovojs/server/storage-keys';
import { createDurableTaskStatus, task } from '@kovojs/server/tasks';
import {
  createMemoryWebhookReplayStore,
  webhook,
  webhookReplayIdentity,
} from '@kovojs/server/webhooks';
import { serverValue, trustedAssign } from '@kovojs/server/write-safety';
```

API reference: `/api/server/`. Task-first guides: `/guides/request-shell/`,
`/guides/deployment/`, and `/guides/streaming/`.
