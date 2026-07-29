# Core task topology v1

Kovo's core API now has one canonical home per task:

- `@kovojs/core` contains component, form, route, link, redirect, query, JSON, and render
  authoring contracts.
- `@kovojs/core/security` contains classified values and door-specific declassification.
- `@kovojs/core/storage` contains storage capabilities and validated adapters.
- `@kovojs/core/webhooks` contains verifier construction and webhook request contracts.
- `@kovojs/core/diagnostics` contains stable diagnostic carrier types.

The root no longer re-exports task APIs. S3 provider request/response records, HMAC resolved
inspection, inferred registry helper graphs, and destructive reveal-audit drains are internal
implementation contracts with no public replacement. `component()` now returns the sole opaque
`Component<Props>` handle; component definition, mutation-slot, GET-form, and link descriptor
support types are inferred and cannot be imported as parallel authoring contracts.

Run the migration in check mode first:

```sh
node scripts/migrate-core-api-v1.mjs --check src
```

Direct named imports and re-exports are split by task while preserving aliases and type-only
bindings. Namespace, default, dynamic, wildcard, and internalized-carrier uses produce structured
refusals with UTF-8 byte anchors. Resolve every refusal using application intent, then apply the
all-or-nothing rewrite:

```sh
node scripts/migrate-core-api-v1.mjs --write src
```

Declassification policies must be rebuilt with the constructor for the exact door:

```ts
import { DeclassifyPolicy, revealSecret } from '@kovojs/core/security';

const credential = revealSecret(
  signingKey,
  DeclassifyPolicy.forRevealSecret({
    ownerScope: 'application',
    purpose: 'credential-use',
  }),
);
```

There is no compatibility barrel. To roll back from a clean worktree, restore the previous Kovo
package versions and reverse only files reported as `rewritten` by
`kovo-api-migration-result/v1`.
