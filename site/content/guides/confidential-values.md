---
title: Confidential values
description: Mark secrets and untrusted input, reveal them deliberately, and keep them off the client wire by default.
order: 16.1
---

# Confidential values

Use this when a value should stay server-only or should not be trusted yet: API keys, password
digests, request-derived strings, masked PII. Kovo's useful default here is simple: the value does
not quietly turn into JSON or browser-visible markup.

## Mark a value

Wrap the value where it first becomes sensitive:

```text
// Source-verified shape from packages/core/src/index.ts
import { secret } from '@kovojs/core';

const stripeKey = secret(process.env.STRIPE_SECRET_KEY!);
```

A `Secret<T>` is not `JsonValue`, and a runtime secret box refuses coercion. `JSON.stringify`,
template literals, and string concatenation all throw instead of laundering the value onto the wire.

## Run it

The runtime failure is explicit:

```text
// Source-verified runtime refusal from packages/core/src/internal/wire-json.test.ts
import { secret } from '@kovojs/core';

JSON.stringify({ token: secret('sk_live_wire_json') });
```

That throws a client-wire confidentiality error telling you to reveal or redact the value
explicitly before returning it.

## Reveal it at the sink

Reveal the value where you actually need the raw bytes:

```text
// Source-verified shape from packages/core/src/secret.ts
import { revealSecret, secret } from '@kovojs/core';

const authorization = `Bearer ${revealSecret(secret(process.env.STRIPE_SECRET_KEY!), 'call Stripe')}`;
```

That justification is the point. It makes the unboxing visible in code review instead of burying it
inside a helper or a cast.

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

```text
const CHECKOUT_VERSION = 'v2';

publishToClient(CHECKOUT_VERSION, { reason: 'public checkout protocol version' });
```

An imported value is refused even when wrapped. Importing its module would execute that module in
the browser before any runtime check. Pass dynamic public data through component props or a query
instead.

Column-level secrecy lives in the schema annotation, not in query prose:

```text
import { kovo } from '@kovojs/drizzle';

kovo({ domain: 'user', key: 'id', secret: ['passwordHash'] });
```

For confidential-at-rest columns, encrypt before the write:

```text
// Source-verified shape from packages/server/src/confidential-at-rest.ts
import { encryptAtRest } from '@kovojs/server';

declare const env: { SSN_KEY: string };
declare const input: { ssn: string };

const ciphertext = encryptAtRest(input.ssn, env.SSN_KEY, { aad: 'profiles.ssn', keyId: 'v2' });
```

## Handle failure

There are two failure modes to expect:

- Static query-wire diagnostics when a query projection would serialize a secret column.
- Runtime secret-box failures when a secret reaches JSON, headers, redirects, or another egress
  sink without an explicit reveal or redaction step.

Do not solve either with a cast. Remove the secret from the projection, reveal it in a reviewed
place, or publish a same-file primitive constant. Use props or a query for dynamic public data.

## Next

- [Security](/guides/security/) - see the broader sink map around secrets, headers, redirects, and downloads.
- [Domains, writes & data access](/guides/data-layer/) - connect column annotations to your Drizzle schema.

<details>
<summary>Spec & diagnostics</summary>

Public exports: `packages/core/src/index.ts` and `packages/server/src/index.ts`. Runtime secret,
untrusted, and redacted behavior: `packages/core/src/secret.ts` and `packages/core/src/secret.test.ts`.
Wire refusal text: `packages/core/src/internal/wire-json.ts` and
`packages/core/src/internal/wire-json.test.ts`. Runtime sink refusal: `packages/server/src/secret-egress.ts`.
Column-level secret and confidential-at-rest annotations: `packages/drizzle/src/drizzle-surface.ts`.
`encryptAtRest(...)`: `packages/server/src/confidential-at-rest.ts`. Main diagnostic: KV435.
`publishToClient(...)` accepts only a unique, pristine same-file `const` initialized to `string |
number | boolean | null`; imported or mutable bindings fail closed under KV437 (SPEC §6.2/§6.6).

API reference: [@kovojs/core](/api/core/), [@kovojs/drizzle](/api/drizzle/), [@kovojs/server](/api/server/).

</details>
