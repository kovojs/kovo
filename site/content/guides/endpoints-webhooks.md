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
  handler: finishOAuth,
});
```

Exact and prefix mounts are declared. Cookies are not interpreted into ambient `req.session`, and an
endpoint does not get the mutation lifecycle unless you build it deliberately. A CSRF exemption is
sound here because auth does not ride browser ambient authority; verifier tokens, signatures, OAuth
state, or another explicit scheme authenticate the request. The handler can still parse the raw
request when the protocol needs it.

## `webhook()` for provider POSTs

Use `webhook()` for third-party POSTs that write Kovo-owned data:

```ts
import { hmacSignature } from '@kovojs/core';
import { domain, s, webhook, webhookReplayIdentity } from '@kovojs/server';

const order = domain('order');
declare const providerWebhookReplayStore: any;
declare const applyOrderEvent: any;

export const orderWebhook = webhook('/hooks/order-provider', {
  verify: hmacSignature({
    encoding: 'hex',
    header: 'x-provider-signature',
    payload: (request) => request.payload,
    secret: process.env.PROVIDER_WEBHOOK_SECRET!,
    tolerance: { header: 'x-provider-timestamp', seconds: 5 * 60 },
  }),
  input: s.object({
    id: s.string(),
    occurredAtMs: s.number().int(),
    type: s.string(),
  }),
  idempotency: (event) => webhookReplayIdentity(event.id, event.occurredAtMs),
  replayStore: providerWebhookReplayStore,
  writes: [order],
  async handler(event, context) {
    await context
      .declareSystemWrite('Provider webhook applies provider-confirmed order events')
      .runMutation(applyOrderEvent, event);

    context.recordChange(order, { keys: [event.id] });
  },
});
```

The path is explicit because it is the provider-facing address. The webhook registry identity is
derived from `orderWebhook` and its module path, so replay and audit names follow the source instead
of duplicating a string.

Replace `applyOrderEvent` with your app mutation or write helper. A webhook that can write
Kovo-owned data must declare both `idempotency` and `replayStore`, then choose an explicit
`actAs(...)` or `declareSystemWrite(...)` posture before composing through mutations or managed DB
work.

Use the provider event's own signed occurrence timestamp for `occurredAtMs`. Do not use `Date.now()`
or the signature delivery timestamp. Kovo accepts up to five minutes of future clock skew and keeps
replay truth for 30 days from that authenticated occurrence. Stale or farther-future events return
422 before the replay store or handler runs.

The lifecycle is fixed: capture raw bytes, verify, parse/coerce a loose input schema, reserve replay
by the opaque provider event identity, run the handler with `tx`, commit, emit every
`recordChange()` as the unified change record, and return the provider-appropriate 2xx. A
redelivered event inside the horizon replays the stored response and does not re-execute the
handler. The `writes` list is the static audit fact; the `recordChange()` calls are the runtime
key-level records.

The verifier kit includes generic HMAC and Standard Webhooks helpers. Provider-specific recipes,
including Stripe's exact signature format, can live in app/example code on top of those helpers; the
audit prints the resolved verifier scheme or a named custom/none justification.

## Set response metadata

Use the named file options for fields that change how a response is interpreted. The direct header
bag is only for cache metadata:

```ts
import { respond } from '@kovojs/server';

declare const pdfBytes: Uint8Array;

function downloadInvoice() {
  return respond.file(pdfBytes, {
    contentType: 'application/pdf',
    etag: '"invoice-42"',
    filename: 'invoice-42.pdf',
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
    },
  });
}
```

`respond.file()` and `respond.stream()` accept `Cache-Control`, `Last-Modified`, and `Vary` in
`headers`. Use `contentType`, `etag`, and `filename`/`disposition` for the dedicated fields. Return
`redirect()` for a location. Mutation cookies go through `context.setCookie()`.

Raw `endpoint()` responses may need other end-to-end integration headers. Return a Web `Response`
for those. Kovo still rejects `Content-Length`, `Connection`, `Transfer-Encoding`, and the other
adapter-owned framing or hop-by-hop fields before anything reaches the socket. Header controls such
as CR, LF, and NUL also fail closed.

## Send CSRF tokens to raw endpoints

Default-CSRF unsafe endpoints accept the same token carriers Kovo can parse before the handler runs:
form fields and JSON bodies. For the first anonymous page, use `mintCsrfField` or `mintCsrfToken` so
the response can also set Kovo's anonymous CSRF cookie. The ordinary browser path is a route plus a
`mutation()` form, where Kovo owns this lifecycle automatically. A raw bootstrap is an advanced
integration: its endpoint must execute a verifier (or be a framework-owned self-verifying adapter)
before it can emit browser state.

Call the helper inside that verified endpoint while it constructs its `Response`. When the endpoint
runs through `createRequestHandler()`, Kovo privately captures a first-anonymous binding cookie and
attaches it during final response reconstruction. Do not copy it into app-owned headers yourself:
an explicit `Set-Cookie` is still app-authored browser state and is rejected without the endpoint's
browser-state authorization proof.

```ts
import { mintCsrfField } from '@kovojs/server';

export async function renderUploadForm(request: Request) {
  const csrf = mintCsrfField(request, {
    ...appCsrf,
    audience: 'endpoint:/files',
  });

  return new Response(
    `<form method="post" action="/files">${csrf.html}<button>Upload</button></form>`,
  );
}
```

Call `renderUploadForm(request)` only from the verified raw endpoint handler. The public mint
helpers do not accept a mutation target. Route mutation forms use typed
`<form mutation={definition}>` authoring so Kovo emits CSRF and `Kovo-Idem` together. The returned
`setCookie` remains available for
non-Kovo response integrations; explicitly attaching its exact bytes to a managed raw response is
deduplicated, but it still requires the same endpoint browser-state proof and reserved-header
posture as any app-authored `Set-Cookie`.

For verified JSON bootstraps, send
`mintCsrfToken(request, appCsrf, { audience: 'endpoint:/bootstrap' }).token` as `kovo-csrf`; the
managed finalizer delivers a first binding cookie. A detached call can still use a session or an
anonymous cookie already on the request. It cannot create the first anonymous binding: Kovo rejects
that call because there is no active response lifecycle proving the new cookie can reach the
browser. Direct `runEndpoint()` execution has no managed cookie sink and likewise rejects a first
anonymous mint. If your protocol needs `text/plain`, `bytes`, or a signed raw body, use
`csrf: false` with a verifier, OAuth state, or another non-browser auth scheme and name the
justification. Browser credential forms should stay as `mutation()` forms so Kovo owns the CSRF
field, no-JS response, replay, and typed failure UI.

## Audit the ingress surface

`kovo explain --endpoints` is the stable security-review table. It lists every declared endpoint and
webhook, every mutation, and every route returning `respond.file()` or `respond.stream()`:

```txt
kovo-explain/v1
ENDPOINTS
ENDPOINT app-shell/order-paid surface=webhook method=POST path=/webhooks/order-paid mount=exact auth=verifier:stripe-signature csrf=exempt:signed stripe webhook cache=no-store body=raw bodySize=- rateLimit=webhook:stripe headers=Stripe-Signature files=- dynamic=- writes=order
ENDPOINT echo surface=endpoint method=POST path=/api/echo-json mount=exact auth=public:public echo endpoint is CSRF checked csrf=checked cache=no-store body=json bodySize=- rateLimit=- headers=- files=- dynamic=- writes=-
ENDPOINT health surface=endpoint method=GET path=/healthz mount=exact auth=none:public uptime probe csrf=safe:read-only cache=no-store body=json bodySize=- rateLimit=- headers=- files=- dynamic=- writes=-
ENDPOINT inventory/download surface=route-file method=GET path=/downloads/inventory.bin mount=exact auth=custom:api-key csrf=safe:read-only cache=private,no-store body=bytes bodySize=stream rateLimit=download:user headers=Content-Disposition,Content-Type files=inventory.bin dynamic=- writes=-
SUMMARY total=4
```

Each row is key/value text: surface, method, path, mount mode, auth scheme, CSRF posture, cache/body
posture, response headers, file fields, dynamic-route posture, and the write-to-domain chain where
one exists. A `csrf: false` mutation appears here too, and the CSRF/session gate guarantees that it
does not read ambient session authority.

## Handle failure

Keep provider and machine failures explicit:

- Verifier failures return the fixed unauthorized/bad-request response for that verifier before the
  handler runs.
- `context.fail(code, payload, { status, retryAfter })` is the expected provider-facing failure path
  when the request is valid but the event cannot be accepted.
- Handler throws roll back the transaction and do not publish `recordChange()` output.
- Replay conflicts reuse the stored response for the same provider event id instead of running the
  handler twice.

That posture keeps "bad signature", "valid but rejected event", and "operational failure" separate
in logs and provider retries.

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

API reference: [@kovojs/core](/api/core/), [@kovojs/server](/api/server/).

</details>
