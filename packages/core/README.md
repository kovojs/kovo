# @kovojs/core

Kovo's task-shaped core API. The root contains component, form, and typed
navigation contracts. App-owned route and query declarations come from the
server contract; security, storage, webhook, and diagnostic contracts
live at explicit subpaths so an import states which boundary it crosses.

```sh
pnpm add @kovojs/core
```

```ts
import { component, href } from '@kovojs/core';

export const contactHref = (id: string) =>
  href('/contacts/:id', { params: { id } });

export const ContactName = component({
  render({ contact }: { contact: { name: string } }) {
    return <strong>{contact.name}</strong>;
  },
});
```

## Security

Use the security entrypoint for classified values and explicit declassification.
Door-specific policy constructors make an opaque policy for one reveal operation
only. Door, purpose, and owner-scope state is framework-private, and reveal audit
drains are available only to framework internals.

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

declare const providerOperations: Parameters<typeof S3CompatibleObjectClient.create>[0];

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

type HmacInput = Parameters<typeof hmacSignature>[0];
```

## Reference

- API: `/api/core/` (grouped by the root, diagnostics, security, storage, and webhooks task paths)
- Guides: `/getting-started/mental-model/`, `/guides/routing/`, `/guides/queries/`
