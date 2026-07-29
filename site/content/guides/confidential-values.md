---
title: Confidential values
description: Mark secrets and untrusted input, reveal them deliberately, and keep them off the client wire by default.
order: 16.1
---

# Confidential values

Use this when a value should stay server-only or should not be trusted yet: API keys, password
digests, request-derived strings, masked PII. Kovo's useful default here is simple: the value does
not quietly turn into JSON or browser-visible markup.

## Load app secrets

Declare the environment keys your app uses. `s.secret(...)` keeps credentials boxed after boot:

```tsx
import { defineKovo, s } from '@kovojs/server';

export const app = defineKovo({
  env: s.object({
    API_TOKEN: s.secret(s.string()),
    PUBLIC_ORIGIN: s.string(),
  }),
});

export default app.assemble({});
```

`app.env` is frozen and contains only those two keys. A missing key stops boot, including in
development. The raw environment snapshot never appears on the app object.

`kovo build` does not need the production values. During graph derivation, Kovo substitutes
framework-owned unavailable boxes for every declared field; trying to render, serialize, clone, or
otherwise observe one fails instead of emitting a dummy. The generated server parses the real
declared environment before it serves traffic. Keep deployment secrets in the runtime environment,
not in your build command or CI artifact job.

## Mark another value

Wrap the value where it first becomes sensitive:

```ts
// Source-verified shape from packages/core/src/index.ts
import { secret } from '@kovojs/core';

const stripeKey = secret(process.env.STRIPE_SECRET_KEY!);
```

A `Secret<T>` is not `JsonValue`, and a runtime secret box refuses coercion. `JSON.stringify`,
template literals, and string concatenation all throw instead of laundering the value onto the wire.

## Run it

The runtime failure is explicit:

```ts
// Source-verified runtime refusal from packages/core/src/internal/wire-json.test.ts
import { secret } from '@kovojs/core';

JSON.stringify({ token: secret('sk_live_wire_json') });
```

That throws a client-wire confidentiality error telling you to reveal or redact the value
explicitly before returning it.

## Reveal it at a boot-only sink

Reveal the value only where a boot-time dependency actually needs the raw bytes. The policy is a
closed `purpose × door × owner scope` tuple, not caller-authored prose:

```ts
// Source-verified shape from packages/core/src/secret.ts
import { DeclassifyPolicy, revealSecret, secret } from '@kovojs/core';

const authorization = `Bearer ${revealSecret(
  secret(process.env.STRIPE_SECRET_KEY!),
  DeclassifyPolicy.create({
    door: 'revealSecret',
    purpose: 'credential-use',
    ownerScope: 'application',
  }),
)}`;
```

The exact policy is the point. A string, copied object, cast, subclass, unknown tuple, or policy for
another door cannot authorize release.

For a dependency credential, reveal once inside the client factory. Keep the dependency client, not
the raw string, for later requests:

```tsx
// Source: packages/server/src/env.test.ts
import { DeclassifyPolicy, revealSecret, type SecretValue } from '@kovojs/core';

function createCredentialClient(apiToken: SecretValue<string>) {
  const rawToken = revealSecret(
    apiToken,
    DeclassifyPolicy.create({
      door: 'revealSecret',
      purpose: 'credential-use',
      ownerScope: 'application',
    }),
  );
  return Object.freeze({ credentialLength: () => rawToken.length });
}

const client = createCredentialClient(app.env.API_TOKEN);
```

Run `kovo explain revealed`. The reveal appears with its source location and exact policy. The
combined `kovo explain capabilities` view folds in the same fact. This is an audit trail, not permission to
send the raw key elsewhere. Keep the policy inline and literal; its field order does not matter.
Dynamic policy construction fails the build because Kovo cannot record an honest audit row for it.

Declassification is request-closed. A module reachable from an application handler—directly or
through a helper or re-export—cannot import `DeclassifyPolicy` or a reveal door; capability closure
stops the build. Construct dependency clients in a boot-only module and pass the
capability-bearing client, never the raw credential, into later request work.

## Add the production shape

There are four common lanes:

- `untrusted(value)` marks request-derived input that still needs validation or escaping.
- `redacted(value, { mask })` keeps a masked display form while preserving the real value for
  deliberate reveal.
- `publishToClient(value, { reason })` publishes a same-file `const` string, number, boolean, or
  `null`. Use it for inert labels and public build constants.
- `declareOffWire(() => { ... }, { justification })` lets you do server-only secret work that never
  returns a value to the query wire.

Keep the published value next to the handler so the compiler can copy data without importing code:

```ts
import { publishToClient } from '@kovojs/core/security';

const CHECKOUT_VERSION = 'v2';

publishToClient(CHECKOUT_VERSION, { reason: 'public checkout protocol version' });
```

An imported value is refused even when wrapped. Importing its module would execute that module in
the browser before any runtime check. Pass dynamic public data through component props or a query
instead.

Column-level secrecy lives in the schema annotation, not in query prose:

```ts
import { kovo } from '@kovojs/drizzle';

kovo((columns) => ({
  domain: 'user',
  key: columns.id,
  secret: [columns.passwordHash],
}));
```

For confidential-at-rest columns, encrypt before the write:

```ts
// Source-verified shape from packages/server/src/confidential-at-rest.ts
import { createConfidentialAtRestCipher, encryptAtRest } from '@kovojs/server/confidential';
import { createSigningKeyRing } from '@kovojs/server/signing';

declare const env: { SSN_KEY: string };
declare const input: { id: string; ssn: string };

const roots = createSigningKeyRing({
  keys: [{ id: 'v2', secret: env.SSN_KEY, state: 'active' }],
});
const ssnCipher = createConfidentialAtRestCipher(roots, { audience: 'profiles.ssn' });
const ciphertext = encryptAtRest(input.ssn, ssnCipher, { aad: `profile:${input.id}` });
```

## Handle failure

There are two failure modes to expect:

- Static query-wire diagnostics when a query projection would serialize a secret column.
- Runtime secret-box failures when a secret reaches JSON, headers, redirects, or another egress
  sink without an explicit reveal or redaction step.

Do not solve either with a cast. Remove the secret from the projection, reveal it only at a
boot-time dependency boundary, or publish a same-file primitive constant. Use props or a query for
dynamic public data.

## Next

- [Security](/guides/security/) - see the broader sink map around secrets, headers, redirects, and downloads.
- [Domains, writes & data access](/guides/data-layer/) - connect column annotations to your Drizzle schema.

<details>
<summary>Spec & diagnostics</summary>

Public exports: `packages/core/src/index.ts` and `packages/server/src/index.ts`. The config-env door
is specified by SPEC §6.6/§9.5 and implemented in `packages/server/src/env.ts` plus
`packages/server/src/app.ts`. Runtime secret,
untrusted, and redacted behavior: `packages/core/src/secret.ts` and `packages/core/src/secret.test.ts`.
Wire refusal text: `packages/core/src/internal/wire-json.ts` and
`packages/core/src/internal/wire-json.test.ts`. Runtime sink refusal: `packages/server/src/secret-egress.ts`.
Column-level secret and confidential-at-rest annotations: `packages/drizzle/src/drizzle-surface.ts`.
`encryptAtRest(...)`: `packages/server/src/confidential-at-rest.ts`. Main diagnostic: KV435.
`publishToClient(...)` accepts only a unique, pristine same-file `const` initialized to `string |
number | boolean | null`; imported or mutable bindings fail closed under KV437 (SPEC §6.2/§6.6).
Dynamic declassification policies fail with KV426; request-reachable policy or reveal-door imports
fail with KV448 (SPEC §6.6).

API reference: [@kovojs/core](/api/core/), [@kovojs/drizzle](/api/drizzle/), [@kovojs/server](/api/server/).

</details>
