---
title: Endpoints & webhooks
description: Declare raw HTTP ingress for OAuth callbacks, webhooks, downloads, typed headers, cookies, and audit review.
order: 4.8
---

# Endpoints & webhooks

Most browser writes should be `mutation()` forms: schema input, CSRF, no-JS behavior, replay, guards,
transactions, query truth, and typed failure UI. Use raw ingress when the caller is not a browser
form or when the protocol itself needs raw HTTP control: OAuth callbacks, third-party webhooks,
downloads, health checks, adapter-owned mounts, and externally authenticated machine writes.
CSV/TSV/spreadsheet exports also live here if an app needs them, but they are ordinary app-owned
raw response code, not a Kovo safe-by-default helper lane.

## `endpoint()` for raw HTTP

An endpoint is registry-visible and receives the raw `Request` before body parsing:

```ts
import { endpoint } from '@kovojs/server';

export const oauthCallback = endpoint('/auth/callback', {
  method: 'GET',
  reason: 'OAuth provider callback',
  auth: { kind: 'none', justification: 'OAuth state parameter validates callback' },
  csrf: false,
  csrfJustification: 'OAuth provider callback is not a browser form submission',
  response: { appOwnedSafety: true, body: 'redirect', cache: 'no-store' },
  async handler(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    return finishOAuth({ code, state });
  },
});
```

Exact and prefix mounts are declared. Cookies are not interpreted into ambient `req.session`, and an
endpoint does not get the mutation lifecycle unless you build it deliberately. A CSRF exemption is
sound here because auth does not ride browser ambient authority; verifier tokens, signatures, OAuth
state, or another explicit scheme authenticate the request.

## `webhook()` for provider POSTs

Use `webhook()` for third-party POSTs that write Kovo-owned data:

```ts
import { hmacSignature } from '@kovojs/core';
import { s, webhook } from '@kovojs/server';

export const stripeWebhook = webhook('stripe', {
  path: '/hooks/stripe',
  verify: hmacSignature({
    header: 'stripe-signature',
    payload: 'raw-body',
    tolerance: '5m',
  }),
  input: s
    .object({
      id: s.string(),
      type: s.string(),
    })
    .passthrough(),
  idempotency: (event) => event.id,
  async handler(event, { db }) {
    await db.orders.applyStripeEvent(event);
  },
});
```

The lifecycle is fixed: capture raw bytes, verify, parse/coerce a loose input schema, reserve replay
by provider event id, run the handler in a transaction, commit, emit the unified change record, and
return the provider-appropriate 2xx. A redelivered event id replays the stored response and does not
re-execute the handler.

The verifier kit includes generic HMAC and Standard Webhooks helpers. Provider-specific recipes can
live in app/example code on top of those helpers; the audit prints the resolved verifier scheme or a
named custom/none justification.

## Typed response headers and cookies

Mutation handlers, endpoints, and route file/stream responses use typed response channels for
transport metadata. They do not get a raw string map. Header names are confined to an allowlist such
as `Set-Cookie`, `Cache-Control`, `Vary`, `ETag`, `Last-Modified`, `Content-Disposition`, and
declared redirect `Location`; app code cannot write reserved `Kovo-*` framework headers.

Every header name and value is rejected if it contains CR, LF, NUL, or other forbidden controls.
That is **KV415**. `Set-Cookie` must use the typed cookie builder, which validates the name,
percent-encodes values, and serializes attributes structurally.

```ts
ctx.cookies.set('download_token', token, {
  httpOnly: true,
  path: '/',
  sameSite: 'lax',
  secure: true,
});
ctx.headers.setCacheControl({ private: true, noStore: true });
```

## Audit the ingress surface

`kovo explain --endpoints` is the stable security-review table. It lists every declared endpoint and
webhook, every mutation, and every route returning `respond.file()` or `respond.stream()`:

```txt
kovo-explain/v1
ENDPOINTS
endpoint:oauth/callback GET /auth/callback exact none:oauth-provider-state exempt:oauth-provider-state -
webhook:stripe POST /hooks/stripe exact verifier:hmac exempt:webhook order
route:invoice-download GET /invoices/:id exact session+guard checked invoice
SUMMARY total=3
```

Each row shows method, path, mount mode, auth scheme, CSRF posture, and the write-to-domain chain
where one exists. A `csrf: false` mutation appears here too, and **KV418** guarantees that it does
not read ambient session authority.

## Next

- [Security & authorization](/guides/security/) — CSRF, guards, and audit posture.
- [Request shell](/guides/request-shell/) — where endpoints sit in dispatch order.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — keeping endpoint audits in CI.
- [Server API reference](/api/server/) — generated reference for `endpoint()`, `webhook()`, and response helpers.

<details>
<summary>Spec & diagnostics</summary>

Raw `endpoint()`, `webhook()`, verifier kits, no ambient session, CSRF exemptions, response header
channel, typed cookie builder, and KV415: SPEC §9.1. `csrf: false` mutation restrictions and KV418:
SPEC §6.6. The `--endpoints` audit and printed row vocabulary: SPEC §11.4.

</details>
