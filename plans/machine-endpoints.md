# Machine endpoints — webhooks, exports, downloads (D6)

Status: design agreed 2026-06-11; the `endpoint()` floor and `csrf: false` opt-out are already normative (SPEC §9.1, §6.6, landed with the D5 A-track); shaped primitives not started
Scope: SPEC additions (`webhook()`, route response outcomes, storage capability, `--endpoints` audit), `@jiso/server` + `@jiso/core` surfaces, a verifier kit with provider presets, storage adapters, and reference-app adoption. Referenced from `IMPLEMENT_v1.md` as workstream **D6**. Shares the `endpoint()` deliverable with `plans/auth.md` A4.

## Progress checklist

- [ ] S7 spike: raw-body capture without double-buffering + the webhook verify→tx→change-record lifecycle, proven against a recorded Stripe fixture (decision-gate writeup).
- [ ] SPEC PR: `webhook()` primitive, `respond.file()`/`respond.stream()` route outcomes, storage capability interface, `--endpoints` audit, and the stated JSON-API non-goal.
- [x] E1 `endpoint()` floor implementation (shared with D5 A4), with this plan's refinements: pre-parse raw-body access, prefix mounts, no ambient session.
- [ ] E2 `webhook()` shaped primitive: verifier slot, loose input schema, idempotency, Tx lifecycle, domain writes, change record.
- [ ] E3 verifier kit: generic `hmacSignature()` + `stripeSignature` + `standardWebhooks` presets, custom `verify` escape, provider test vectors in CI.
- [ ] E4 `respond.file()`/`respond.stream()` route outcomes (ETag/304; exports and downloads become ordinary guarded routes).
- [ ] E5 storage capability interface + filesystem and S3-compatible adapters; retrofit D4 `s.file()` uploads onto it.
- [ ] E6 `fw explain --endpoints` audit surface (snapshot-locked like the rest of P8 output).
- [ ] E7 reference-app adoption: payment webhook, order CSV export route, attachment download behind the `--unscoped` audit.

## Background — the gap

Every mutation is a CSRF-protected, session-bound form POST (SPEC §6.6, §9.1); every route renders a page. Three workloads have no sanctioned home: inbound webhooks (Stripe, email/calendar sync — SPEC §10.3 itself names the Stripe webhook as the `invalidate()` escape hatch's motivating case), CSV/data export, and file downloads. Without owned primitives, adopters bolt raw Node handlers onto the side — outside the typed surface, the audits, and the invalidation graph, at boundaries that are security-sensitive (webhook forgery, download IDOR). The D5 A-track landed the floor: `endpoint()` is registry-visible, raw `Request → Response`, CSRF-exempt only with a named justification, enrolled in the unguarded audit (SPEC §9.1).

### Decisions (recorded so we don't relitigate)

- **The three workloads decompose asymmetrically.** Webhooks are the only true machine-facing surface (third-party caller, signature auth, **writes**) and get the one new shaped primitive. Exports and downloads are browser-facing reads with a non-HTML body — they become ordinary `route()`s via a response-outcome extension, inheriting typed params/search, guards, the unguarded audit, FW220-checked links, and (for downloads) the `--unscoped` IDOR audit. A bespoke download primitive would have to re-create exactly those audits.
- **Webhook writes flow through `domain()` writes.** The handler is in-process code writing the same Postgres: the §11.1 extractor sees it, FW330/FW402/FW404 apply, and the write emits the unified change record `{domain, keys, input}` (P9). There is no requesting page, so v1 client convergence is refetch-on-focus (§9.3) and the v2 live bus consumes the same record with zero rearchitecture. This shrinks `invalidate()` to genuinely external writers (cron in another codebase, other services) and narrows what the v2 CDC adapter must cover.
- **No ambient authority.** `endpoint()`/`webhook()` handlers get no `req.session`; cookies are never read. This is why the CSRF exemption is sound — CSRF rides ambient cookie auth, which these endpoints structurally lack. Stronger position than "token check skipped".
- **Webhook input schemas are loose-by-default.** Provider payloads are versioned unions; declare what you consume, pass unknown fields, and answer mismatches with a logged 4xx per provider retry semantics — never a crash. The payload is third-party-documented: a marked seam, same doctrine as raw SQL on the read side.
- **Verifier presets over hand-assembled config.** The generic HMAC decisions (header, signed-payload construction, encoding, timestamp tolerance, rotation handling) have security-silent failure modes: verifying re-serialized JSON instead of raw bytes, skipped replay tolerance, non-constant-time compare, broken secret rotation, hex/base64 mismatch. Presets bake these in, are validated against provider-published test vectors (stable public contracts — vectors, not a version pin), and are **ejectable**: a preset resolves to the printed generic-config form, and `fw explain endpoint` shows the resolved scheme, never just "preset: stripe". Set stays small: generic + `stripeSignature` + `standardWebhooks` (covers the Svix-style family); non-HMAC outliers (Twilio's URL+params scheme, Discord's Ed25519) use the custom `verify` function, visibly.
- **`csvExport(query)` sugar is dropped.** Considered (deriving CSV headers/rows from the query's inferred select shape) and cut from this plan: exports are ordinary routes returning `respond.stream()`, serialization is app code. The derived-CSV idea can return later as pure sugar lowering to exactly this route form (Constitution #3) without any design debt incurred now.
- **No sanctioned JSON/REST API surface in v1 — a stated non-goal, not an oversight.** `respond.json()` is one line away and invites an untyped second API beside the verified one. A typed public-API story (likely: queries/mutations re-exposed under token auth with their existing schemas) is a coherent v2 design; until then JSON APIs live on `endpoint()` where the justification requirement keeps them visible.

## E-track

- **E1 — `endpoint()` floor** (implementation shared with D5 A4; SPEC §9.1 text is landed). This plan's refinements, to fold into the implementation: **pre-parse raw-body access** (signature verification is over wire bytes; parsing must not consume them first), **prefix mounts** (better-auth's handler owns subpaths; `mount()` rides this), and the **no-ambient-session rule** above. Webhook paths are part of the public contract providers configure in their dashboards — declared, stable, and excluded from any future path-rewriting the way module URLs are versioned (§6.6 deploy-skew doctrine).
- **E2 — `webhook()`**. Shape: `webhook('stripe', { path, verify, input, idempotency, handler })`. Lifecycle mirrors mutations: verify → parse/coerce (loose schema) → BEGIN tx → handler (Tx-typed db, domain writes only — FW330 applies) → COMMIT → change record → 200; `fail()` → ROLLBACK → 4xx/5xx per provider retry semantics. `idempotency: (input) => key` rides the FW-Idem replay machinery (§9.1) keyed on provider event ids — a redelivered event is a replayed response, not a re-executed handler. `fw explain endpoint <name>` prints verifier scheme (resolved, not preset name), writes → domains → invalidated queries — the same chain mutations get.
- **E3 — Verifier kit**: `hmacSignature({ header, payload, encoding, tolerance, multiSig })` generic; `stripeSignature({ secret })` and `standardWebhooks({ secret })` presets resolving to it; constant-time comparison and tolerance defaults non-configurable footguns removed; custom `verify: (req) => Promise<boolean>` escape for non-HMAC schemes. Provider test vectors run in CI. A webhook with `verify: 'none'` requires a justification comment and surfaces in the audit (same philosophy as FW211/FW302).
- **E4 — Route response outcomes**: `respond.file()`/`respond.stream()` join `redirect()`/`notFound()` as sanctioned route outcomes (§6.4's closed set grows by two). Content-Disposition/Content-Type declared, ETag/if-none-match supported; range requests punted with a note. Exports: guarded `route()` with typed `search` filters streaming rows. Downloads: guarded `route('/attachments/:id')` whose row lookup is `owner:`-traceable — enrolled in `--unscoped` like any query.
- **E5 — Storage capability interface**: `put/get/stat/stream` + ETag passthrough; filesystem and S3-compatible adapters; shared adapter conformance tests. D4's `s.file()` uploads retrofit onto it so upload and download speak one seam. Floor+blessed again: the interface is the floor, the two adapters are blessed, anything S3-shaped works.
- **E6 — `--endpoints` audit**: every machine-facing surface in one diffable table — name, path, verb, auth scheme (`session+guard` / `verifier:<resolved scheme>` / `none — justified`), CSRF posture, and for webhooks the write→domain chain. Joins the P8 snapshot-locked output set. The CRM security-review question — "what can reach this app and what can it touch?" — becomes one command.
- **E7 — Reference-app adoption**: a payment-provider webhook (recorded fixtures, no live calls) whose write invalidates order queries; an order-history CSV export route; an attachment upload/download pair behind the IDOR audit. Each E-item ships only with a reference-app usage, per house rule.

## Spike S7 — raw bytes and the webhook lifecycle

Prove before building E2/E3: capture raw body bytes for verification without double-buffering large payloads, then run verify → loose-parse → tx → domain write → change record → 200 against a recorded Stripe fixture, including: tampered body rejected, stale timestamp rejected, rotated-secret multi-signature accepted, redelivered event id answered from replay without re-executing the handler. Decision-gate writeup covers where raw-body capture lives in the server shell and what the FW-Idem storage for provider event ids looks like.

## Out of scope

`csvExport(query)` derived sugar (dropped — see Decisions; revisit as v2 sugar at most) · any sanctioned JSON/REST public API (`respond.json()`, token-authed typed API — v2 design at the earliest) · outbound webhooks (background-jobs territory, gap #4) · range/resumable downloads (noted, punted) · giant exports that exceed a request/response window (background-jobs gap; the streaming threshold is named in docs, not hidden) · provider SDK wrappers beyond signature verification.

## Sequencing & dependencies

- E1 is the shared deliverable with D5 A4 — whichever workstream starts first implements it; the other consumes it. Its SPEC text is already landed.
- S7 gates E2/E3. E4/E5 are independent of webhooks and can run in parallel; E5 should land before or with E4's download usage.
- E6 extends P8 CLI output (after E2/E4 exist to report on).
- After P3 in the phase ordering, like D5; no dependency on P6/P7.

## Exit criteria

1. S7 decision-gate writeup merged; SPEC PR for E2/E4/E5/E6 merged (normative text, not this plan).
2. The reference-app webhook verifies a recorded provider fixture; tampered body and stale timestamp are rejected 4xx; a redelivered event id is answered from replay without re-executing the handler; secret rotation (multi-signature) passes.
3. The webhook's write appears in the touch graph and `fw explain endpoint` shows verifier scheme + write→domain→invalidated-queries; a direct db call smuggled into a webhook handler fails FW330 statically and the P9 harness at runtime.
4. Export route streams CSV behind its guard; download route's key predicate is `owner:`-traceable and a deliberately unscoped variant is flagged by `--unscoped`.
5. `fw explain --endpoints` lists every machine-facing surface with its auth scheme; every CSRF-exempt site carries a named justification; output is snapshot-locked.
6. Storage adapters pass the shared conformance tests; upload → download round-trips in the reference app through the capability interface.
