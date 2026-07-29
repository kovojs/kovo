# @kovojs/core

Kovo's task-shaped core API. The root contains component, form, navigation, and
query authoring primitives. Security, storage, webhook, and diagnostic contracts
live at explicit subpaths so an import states which boundary it crosses.

```sh
pnpm add @kovojs/core
```

```ts
import { component, queryRef, routeRef } from '@kovojs/core';

export const contactRoute = routeRef('/contacts/:id', {
  params: { id: '' },
});

export const contactQuery = queryRef('contact');

export const ContactName = component({
  render({ contact }: { contact: { name: string } }) {
    return <strong>{contact.name}</strong>;
  },
});
```

## Security

Use the security entrypoint for classified values and explicit declassification.
Door-specific policy constructors make a policy for one reveal operation only.

```ts
import {
  DeclassifyPolicy,
  declareOffWire,
  isRedacted,
  isSecret,
  isUntrusted,
  publishToClient,
  redacted,
  revealRedacted,
  revealSecret,
  revealUntrusted,
  secret,
  trustedReveal,
  untrusted,
} from '@kovojs/core/security';

const signingKey = secret(process.env.WEBHOOK_SIGNING_KEY);
const rawSigningKey = revealSecret(
  signingKey,
  DeclassifyPolicy.forRevealSecret({
    ownerScope: 'application',
    purpose: 'credential-use',
  }),
);
```

## Storage

Storage capabilities hide provider request and response records. Wrap
provider-local operations in the opaque S3-compatible client before constructing
the capability.

```ts
import {
  S3CompatibleObjectClient,
  createFileSystemStorage,
  createMemoryStorage,
  createS3CompatibleStorage,
} from '@kovojs/core/storage';

const client = S3CompatibleObjectClient.create(providerOperations);
const objects = createS3CompatibleStorage({
  bucket: 'app-assets',
  client,
});
```

## Webhooks and diagnostics

```ts
import { customVerifier, hmacSignature, standardWebhooks } from '@kovojs/core/webhooks';
import type {
  DiagnosticCode,
  DiagnosticSeverity,
  RegisteredDiagnostic,
} from '@kovojs/core/diagnostics';
```

## Reference

- API: `/api/core/`, `/api/core-security/`, `/api/core-storage/`,
  `/api/core-webhooks/`, `/api/core-diagnostics/`
- Guides: `/getting-started/mental-model/`, `/guides/routing/`, `/guides/queries/`
