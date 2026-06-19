# Kovo Security Findings

**Date:** 2026-06-15
**Scope:** The full Kovo framework — `packages/*` (server, runtime, compiler, better-auth, core, ui, headless-ui, create-kovo), the reference apps under `examples/*`, the scaffolder templates, and the tutorial steps under `site/*`.
**Method:** Every claim in `.deepsec/data/kovo/reports/report.md` (58 entries) was re-verified against the current source, then a fresh discovery sweep was run across every subsystem. Each finding was independently re-read at the code level and adversarially verified before inclusion. Findings assessed **low severity or below are excluded** from the ranked list (see _Re-verification adjustments_ and _Dropped / not-reported_ for what was downgraded or refuted, since that delta is part of re-verifying the report).

## Severity summary

| Severity                       | Count |
| ------------------------------ | ----- |
| Critical                       | 1     |
| High                           | 5     |
| Medium                         | 10    |
| (Low / refuted — not reported) | 24    |

**Posture in one paragraph.** Kovo's risk is dominated by a single systemic root cause: the framework performs **no HTML output encoding on the path apps use most**. The server JSX runtime inserts text children verbatim, the compiler never injects escaping for text or attribute interpolations, the compiled reactive list-stamp builds HTML strings and assigns them via `innerHTML`, and reactive attribute bindings apply live values to URL/style attributes via raw `setAttribute`. There is **no opt-in escaping helper and no escape hatch**, so every app that renders dynamic user/DB data inherits stored/DOM XSS by default. A secondary cluster of open-redirect sinks (`redirectPath`, `normalizePathname`, the Referer-derived PRG target) all stem from missing same-origin normalization (backslash and leading-`//` bypasses). The remaining medium issues are reference-app / scaffolder hygiene gaps (hardcoded secrets, no brute-force throttle, unscoped storage keys, webhook trust, CSV formula injection) that bite real apps copying the blessed patterns.

---

## CRITICAL

### C1 — No default HTML output encoding: text interpolations are emitted unescaped at every layer (systemic stored/reflected XSS)

- **Status:** Confirmed (root cause of ~15 report XSS items) — _elevated_ from the report's HIGH.
- **Category:** XSS / missing output encoding (framework-wide).
- **Locations:**
  - `packages/server/src/jsx-runtime.ts:79-84` — `renderJsxChildren` returns `String(children)` with no escaping; only attributes are escaped (`:66` via `escapeAttribute`).
  - `packages/server/src/html.ts:1-7` — `escapeHtml` covers `& < >` only; `escapeAttribute` adds `"`. No URL/scheme handling, no single-quote.
  - `packages/compiler/src/lower/inline-derives.ts:131-154` and `packages/compiler/src/emit/server.ts:328-341` — the compiler (the designated lowering/validation layer) re-emits raw `{expr}` text interpolations and round-trips template literals verbatim; it never wraps text in an escape helper.
  - Wire → client sink: `packages/server/src/wire-html.ts:66` (`<kovo-fragment …>${html}</kovo-fragment>` raw) → `packages/browser/src/response-fragment-apply.ts:62,71` (`insertAdjacentHTML` / `template.innerHTML = h`) and `packages/browser/src/morph.ts:28,34` (`template.innerHTML = html.trim()`).
  - UI-library derivatives feeding scalar text props through the unescaped renderer: `packages/ui/src/{autocomplete.tsx:257,287; combobox.tsx:248,277; command.tsx:316,368; select.tsx:269,297; menubar.tsx:168; navigation-menu.tsx:229,284; drawer.tsx:109,114,119,129; sheet.tsx:112,117,122,132; dialog.tsx:117,143,167; field.tsx:188,213,300,334,349,374,400,455}`; plus `packages/ui/src/table.tsx:54,56,113` (`tablePart` does its own `${children ?? ''}` raw concat — an independent sink the JSX fix would _not_ cover).
- **Description:** `renderJsxChildren` inserts string/number children verbatim. The framework escapes every _other_ text sink it emits by hand (`hints.ts` `<title>`, `document-core.ts` error pages, `mutation.ts` validation output) — proving the authors know text needs escaping; only the app-facing JSX child path lacks it. The compiler does not compensate. There is no `dangerouslySetInnerHTML` / `RawHtml` marker and no diagnostic, so an author has **no supported way to render dynamic text safely** beyond manually calling `escapeHtml` at every interpolation. The `@kovojs/ui` library multiplies the sink across dozens of components whose `title`/`description`/`error`/option-`label` props are plain text that callers fill from data.
- **Impact:** Any `{query.x}` / `{props.x}` / DB string rendered as JSX text (or via a `@kovojs/ui` text prop) is emitted unescaped. The **initial SSR document** contains the markup the browser parses on load, and fragment updates re-inject it through `innerHTML`/`insertAdjacentHTML`/morph, which execute `<img src=x onerror=…>` / `<svg onload=…>`. A stored comment/answer/product/record name with event-handler markup is stored XSS for every viewer, with no app opt-in. **Proven end-to-end** in the stackoverflow reference app: `postAnswer` input is `body: s.string()` (no sanitization) → `answers.body` → `{answer.body}` rendered unescaped on both full-page and fragment paths. Because this is the framework default with no available mitigation and multiple sinks, it is rated Critical rather than High.
- **Recommendation:** Make `renderJsxChildren` HTML-escape string/number children by default, with an explicit `RawHtml` / `dangerouslyRenderHtml` opt-in for intentional pre-rendered composition (component output, `csrfField`, manual-concat helpers) so composed markup isn't double-escaped. Route `table.tsx` `tablePart` through the same escaping (or accept only `RawHtml`). Have the compiler wrap non-statically-safe text interpolations in a runtime escape helper and emit a diagnostic. Define text-escaping semantics in `SPEC.md §4`. Add regression tests asserting `jsx('span', {children: '<img>'})` and a `TableCell`/option label containing `<img>` render escaped.

---

## HIGH

### H1 — Compiled reactive list-stamp builds HTML from unescaped query values and assigns it via `innerHTML` (stored DOM XSS on reactive-list updates)

- **Status:** New (not in report).
- **Category:** XSS / unsafe codegen sink.
- **Locations:** `packages/compiler/src/emit/client.ts:235-239` (`render(item){ … return [${renderSegments.join(', ')}].join(""); }`), `:254-256` (value placeholders emitted as `String(read([...]) ?? "")` — no escape); `packages/browser/src/query-bindings.ts:280-287` (`parser.innerHTML = item.html.trim()`), `:513-521` (`formatBoundValue` returns raw string); morph child-clone at `packages/browser/src/morph.ts:341-364`.
- **Description:** For a reactive keyed list authored with the SPEC-documented `data-bind-list` + `<template kovo-stamp>` pattern (`SPEC.md:281-292`), the compiler emits a client `render(item)` that **rebuilds each item as an HTML string** by concatenating static template chunks with per-placeholder interpolations (`String(read(...)) ?? ""`), with no HTML escaping. The runtime assigns the result via `parser.innerHTML = item.html.trim()`. On an in-place update/reorder of an existing keyed item, `morphDomChildren` clones the injected node into the already-connected live element before bindings overwrite `textContent`, so an `<img onerror>` handler fires. This is distinct from C1: that is the server `String(children)` path (whose client text update is safe via `textContent`); here the compiler deliberately emits an `innerHTML`-string update path.
- **Impact:** An app rendering a reactive comment/feed/cart list over user-submitted rows (e.g. `query.comments[].body`) where a row contains `<img src=x onerror=alert(document.cookie)>` executes on every reactive store update (mutation invalidation, polling, reorder) for every viewer. No opt-out, no diagnostic; inherited the moment an app uses the documented reactive-list feature over untrusted data.
- **Recommendation:** In `templateStampRenderSegments`, HTML-escape value placeholders that target text positions; better, stop building an HTML string for the item body — clone the static template once and write each binding via `textContent`/`setBoundAttribute`. Fix the ordering so binding cleanup runs before nodes go live. Add a compiler diagnostic and a regression test.

### H2 — Reactive attribute binding (inline-derive) applies live query/state values to URL/style attributes (`href`, `src`, `formaction`, `srcdoc`, `style`) with no scheme policy

- **Status:** New (not in report).
- **Category:** DOM XSS / open-redirect via reactive attribute binding.
- **Locations:** `packages/compiler/src/lower/inline-derives.ts:282-295` (`shouldSkipInlineAttributeDerive` excludes only event/trigger/`className`/`data-*`/`kovo-*` — **not** `href`/`src`/`formaction`/`action`/`srcdoc`/`xlink:href`/`style`/`poster`); `packages/browser/src/query-bindings.ts:488-498` (`setBoundAttribute` → raw `element.setAttribute(name, formatBoundValue(value))`), `:513-521` (no escaping). SSR marker escaped only via `escapeAttribute` (`& "` style only).
- **Description:** `lowerInlineAttributeDerive` turns any attribute whose value is a query/state expression into a reactive binding stamp keyed by the attribute name. The skip list does not exclude URL- or script-bearing attributes, and the runtime applies the live value via raw `setAttribute` with no allow/deny list. A compile of `<a href={profile.website}>` emits `data-derive-attr="href"` with zero diagnostics; `<img src={user.avatarUrl}>` emits `attr:"src"`; `viewTransitionName` lowering emits a `style` binding (CSS-injection surface).
- **Impact:** An app binding a per-user field to a URL/style attribute (profile website, avatar `src`, dynamic style) where the value is attacker-controllable yields, on query refresh, a `javascript:` `href` / `data:` `src` / malicious `style` applied via `setAttribute` — XSS-on-click in the app origin plus CSS injection. The framework presents reactive attribute binding as a safe primitive but applies no URL policy. (Auto-firing `onerror`/`onload` attrs _are_ excluded by the skip list, so the dominant vector is `javascript:`-on-click + CSS injection rather than zero-interaction.)
- **Recommendation:** Add a compiler policy for inline attribute derives targeting URL/script/style attributes (refuse to lower with a diagnostic, or tag the stamp so the runtime enforces a safe-URL check). In `setBoundAttribute`, reject/strip `javascript:`/`data:`/`vbscript:` for URL attributes and validate `style` values; mirror the neutralization in SSR so both paths agree.

### H3 — `@kovojs/ui` anchor primitives and headless navigation-menu emit caller `href` with no URL-scheme validation (`javascript:`-scheme XSS on click)

- **Status:** Adjusted (report flagged only `navigation-menu` at low; broadened to the anchor-primitive family at High).
- **Category:** XSS (`javascript:`/`data:` URL-scheme injection).
- **Locations:** `packages/ui/src/breadcrumb.tsx:53-66` (`href={current ? undefined : props.href}`), `packages/ui/src/hover-card.tsx:80-102` (`href={disabled ? undefined : (props.href ?? '#')}`), `packages/headless-ui/src/primitives/navigation-menu.ts:238-252` (spreads `href` verbatim) consumed at `packages/ui/src/navigation-menu.tsx:261-288`; sink `jsx-runtime.ts:66` + `html.ts:5-7` (`escapeAttribute` does not neutralize schemes). No `sanitizeUrl`/`safeHref`/`allowedProtocols` helper exists anywhere in `packages/{ui,headless-ui,server,runtime}`.
- **Description:** Shipped anchor primitives take an arbitrary caller `href?: string` and hand it to the JSX runtime, which renders `href="${escapeAttribute(...)}"`; `escapeAttribute` only replaces `& < > "`, so `javascript:alert(document.cookie)` passes through byte-for-byte (independently verified). There is no shared safe-URL helper in the foundation.
- **Impact:** An app rendering links from dynamic data — breadcrumbs from DB category URLs, hover-card profile links, nav links from CMS/profile data, or a reflected query param — that stores/reflects `javascript:fetch('/api/transfer',{method:'POST',body:document.cookie})` produces a clickable script link in the app origin. Plain server-rendered navigation triggers it on click (no `innerHTML`/morph needed): session/CSRF-token theft, account actions. Shipped-library sink all apps inherit; not Critical because it needs an untrusted-URL source plus a user click.
- **Recommendation:** Add one shared safe-URL helper in `headless-ui` that allowlists `http`/`https`/`mailto`/`tel`/relative/fragment and default-denies everything else (handling whitespace/case/entity-obfuscated variants), then route every `href`/`src`-emitting primitive through it. Add conformance tests asserting `javascript:` hrefs are neutralized.

### H4 — `better-auth` `redirectPath` open-redirect guard blocks `//` but not `/\` (backslash bypass) — shipped library + scaffolded template

- **Status:** Confirmed — _elevated_ from the report's MEDIUM (shipped helper inherited by every app).
- **Category:** Open redirect.
- **Locations:** `packages/better-auth/src/index.ts:1204-1209` (guard), `:962,1017` (signIn/signUp consumers), `:156,163` (`next` input schema); emitted as a 303 `Location` at `packages/server/src/mutation.ts:653-656`; scaffolded consumer `packages/create-kovo/templates/src/auth.tsx:78-81,119`.
- **Description:** `redirectPath` is `if (!value.startsWith('/') || value.startsWith('//')) return fallback; return value;` — it rejects only `//`, not a leading backslash. `redirectPath('/\evil.com','/')` returns `'/\evil.com'`; per the WHATWG URL spec browsers collapse backslash to slash for http(s), so `new URL('/\evil.com','https://app/login').href === 'https://evil.com/'`. The shipped test asserts cross-origin `next` is rejected (so this is a deliberate same-origin control) but never covers `/\`.
- **Impact:** An attacker sends a victim a link to the app's own login page with a poisoned `next` (e.g. `/login?next=/%5Cevil.com`). The form renders it into the hidden `next` input; the victim signs in legitimately (their own CSRF token is included, so CSRF-default-on does not stop it); on success the handler emits `303 Location: /\evil.com` → the browser navigates to `https://evil.com/`. Post-auth open redirect for phishing / OAuth-token theft, in shipped library + scaffolded template.
- **Recommendation:** Reject authority-forming targets after backslash-normalization: reject if `value.replace(/\\/g,'/').startsWith('//')`, or resolve `new URL(value,'https://x')` and require `origin === 'https://x'`. Centralize a single `safeSameOriginPath()` helper shared with `normalizePathname` (H5) and the Referer-derived PRG target. Add tests for `/\evil.com`, `/\/evil.com`, `\/evil.com`.

### H5 — `normalizePathname` preserves leading `//`, yielding an _unauthenticated_ protocol-relative 308 open redirect on any app GET

- **Status:** Confirmed — _elevated_ from the report's MEDIUM (unauthenticated, pre-auth, every app).
- **Category:** Open redirect.
- **Locations:** `packages/server/src/match.ts:49-74` (`normalizePathname` strips only trailing slashes); `packages/server/src/app-request.ts:24-30` (Location emission, fires _before_ dispatch/auth/CSRF at `:33`); same path via `packages/server/src/shell.ts:115`.
- **Description:** `normalizePathname` computes `normalized = absolutePathname.replace(/\/+$/, '')` (trailing only) and emits a 308 when trailing slashes were stripped; leading slashes are never collapsed. `normalizePathname('//evil.com/')` ⇒ `{ pathname: '//evil.com', redirect: 308 }`. `app-request.ts` sets `url.pathname` to that and returns `Location: ${url.pathname}${url.search}${url.hash}` = `//evil.com`, which browsers resolve to `https://evil.com/`. This fires inside `handleAppRequest` **before any route handler, auth guard, or CSRF check**.
- **Impact:** Fully unauthenticated, no CSRF, no app cooperation: a crafted `https://victim.app//evil.com/` (leading `//` + trailing slash to trigger the 308) returns `308 Location: //evil.com` and the browser follows off-site. Works on every Kovo app for any path shapeable as `//<host>/…`, assuming no upstream proxy collapses the `//` (Bun/Node pass it through). Same family as H4 but a distinct sink and strictly more reachable.
- **Recommendation:** In `normalizePathname`, collapse leading authority-forming sequences before returning (e.g. `'/' + normalized.replace(/^[/\\]+/, '')`) and treat any normalized form starting with `//` or `/\` as needing rewrite to a single leading slash; or neutralize non-single-slash-rooted redirect targets in `app-request.ts` before emitting `Location`. Reuse the shared `safeSameOriginPath()` helper. Add tests for `//evil.com/`, `/\evil.com/`, `//evil.com//`.

---

## MEDIUM

### M1 — `FileSchema.mime` trusts the client-declared Content-Type (no magic-byte sniffing) and `respond.stream`/`respond.file` omit `X-Content-Type-Options: nosniff`

- **Status:** Confirmed.
- **Category:** Stored-file content-type trust / content-sniffing XSS.
- **Locations:** `packages/server/src/schema.ts:334` (validates only declared `input.type`), `:291,308` (stored `contentType = file.type`); `packages/server/src/response.ts:276-283` (no `nosniff`), `:177,183` (disposition default `attachment`). No `nosniff` anywhere in `packages/`/`examples/`. The former Commerce upload/download instance was retired from the readable example.
- **Description:** `parseFileLike` validates only the attacker-supplied multipart Content-Type and stores it verbatim; no byte inspection. `routeOutcomeHeaders` never emits `X-Content-Type-Options: nosniff`. Mitigation: `respond.file`/`respond.stream` default disposition to `attachment`; upload behavior is now covered in framework fixtures rather than the Commerce app.
- **Impact:** An app whose allowlist includes a scriptable/sniffable type (`image/svg+xml`, `text/html`) **or** that serves uploads `inline` with a loose/missing content type gets stored XSS, because `.file` never sniffs and `respond.stream` sets no `nosniff` — the browser sniffs/executes HTML/SVG-with-script. A framework-inherited defense gap requiring a plausible-but-non-default app configuration.
- **Recommendation:** Default `respond.stream`/`respond.file` to `X-Content-Type-Options: nosniff`; add optional magic-byte sniffing for declared `image/*`/`application/pdf`; document that `.mime` validates only the declared type; steer apps toward `disposition: 'attachment'` for non-verified types.

### M2 — Credential sign-in/sign-up classify success by _absence_ of 400/401/403, so 200-two-factor-pending and 429/5xx become "signed-in"

- **Status:** Adjusted (report rated this a BUG; it is a real auth-state-confusion issue, severity Medium).
- **Category:** Authentication state confusion.
- **Locations:** `packages/better-auth/src/index.ts:955-964` (signIn), `:1010-1019` (signUp), `:1067-1074` (`forwardBetterAuthSetCookie`), `:1192-1194` (`isCredentialFailureStatus` = 400/401/403 only). Used at `create-kovo/templates/src/auth.tsx:78`, `examples/commerce/src/app.ts:242`, `examples/reference/src/app.ts:174`.
- **Description:** `isCredentialFailureStatus` treats only 400/401/403 as failure; every other status falls through to the success branch, which forwards any `Set-Cookie` and returns `status:'signed-in'`/`'signed-up'` with a redirect. With `asResponse:true`, better-auth converts 2FA-pending (`200 {twoFactorRedirect:true}`, no session cookie), rate-limit (429), and transient 5xx into Response objects that reach this branch. No 2xx check and no session-cookie-presence check.
- **Impact:** With the `twoFactor` plugin enabled, valid first-factor credentials yield a 200 (2FA pending, no session) classified as "signed-in" and redirected into the protected area — the second factor is silently skipped; 429/5xx are masked as success. **Not a full auth bypass**: guarded requests re-derive `request.session` via `auth.api.getSession` and reject when no real session cookie was set, so realistic impact is a broken 2FA control plus masked errors. Dormant unless the app enables `twoFactor`/`requireEmailVerification` (no shipped template/example does), but the defect is in shipped auth-library + scaffolded code.
- **Recommendation:** Verify success explicitly — require a 2xx status **and** a session-establishing `Set-Cookie`; treat a `twoFactorRedirect` 200 body as a distinct two-factor-pending outcome; treat 429/5xx as failure/retryable. Add tests for the `asResponse` 200-twoFactorRedirect / 429 / 500 paths.

### M3 — `rateLimitKey` collapses all unauthenticated clients into one shared `'anonymous'` bucket (no IP fallback)

- **Status:** Adjusted (report rated low; raised to Medium as a real defect in shipped library code).
- **Category:** Denial of service / rate-limit keying.
- **Locations:** `packages/server/src/guards.ts:389-397` (`rateLimitKey`), `:143-178` (`rateLimit`). Safe shipped compositions: `examples/commerce/src/app.ts:308-310,372-374` (auth before rate-limit).
- **Description:** With default (`per:'session'`) keying, `rateLimitKey` falls back to `request.session?.id ?? request.session?.user?.id ?? 'anonymous'`; every session-less request maps to the single literal `'anonymous'` key sharing one count record. There is no IP fallback.
- **Impact:** On a public endpoint guarded only by `guards.rateLimit({max:N})` with no custom key and no preceding auth guard, one attacker exhausts the shared bucket with N requests and 429-locks out **all** anonymous users until the window resets — cheap DoS/lockout. A developer reasonably reads `per:'session'` as per-client. Mitigated in all reference/template code (they compose `authed` before `rateLimit`), so it never fires there; Medium because it is a real defect in shipped library code reachable with a plausible public-endpoint pattern.
- **Recommendation:** Don't silently collapse anonymous requests to a constant. Require an explicit `key` (or `per:'global'`) when no session id is present (warn/throw otherwise), or prominently document that default `per:'session'` keying does not isolate anonymous clients and public endpoints must supply a key (client IP/fingerprint).

### M4 — Mutation idempotency reservation runs _after_ the handler, so concurrent `Kovo-Idem` duplicates both miss `get()` and double-execute

- **Status:** Adjusted (report HIGH_BUG; security-relevant double-execution, severity Medium given the opt-in store).
- **Category:** Idempotency / TOCTOU race.
- **Locations:** `packages/server/src/mutation.ts:422-467` (`readMutationReplay` is a pure read before `runMutation`; `reserve` only inside `withMutationReplay`); `packages/server/src/replay.ts:59-96,132-176`; correct order at `packages/server/src/webhook.ts:235-275`.
- **Description:** `renderMutationResponse` does read (`store.get`) → run handler → reserve (`store.reserve`), so the pending-Promise coalescing never covers the in-flight handler window. A duplicate dispatched while the first handler is mid-flight yields `writes === 2`. The sibling webhook path does `get → reserve → run` correctly, proving the authors know the right order.
- **Impact:** An app that configures `app.mutationReplayStore` with a resolvable scope can have a true concurrent double-submit (double-click / browser retry) with the same `Kovo-Idem` both pass `get()` and both run the handler → duplicate order/charge. Bounded integrity issue, not auth bypass. Capped at Medium because the store is opt-in (no shipped app enables it for mutations), the runtime generates a fresh random idem per submission, and _sequential_ post-commit retries are deduped correctly.
- **Recommendation:** Reserve before executing, mirroring the webhook order: after the `get()` miss, `reserve(scope, idem)` (handling the undefined-return race by awaiting the now-present pending entry), run the handler, then commit. Also fold `definition.key` into the replay scope/key so idempotency is per-`(session, mutation, idem)` and one mutation's cached response/`Set-Cookie` cannot be replayed for another.

### M5 — `create-kovo` template ships a hardcoded CSRF secret; the scaffolder never substitutes it

- **Status:** Confirmed.
- **Category:** Hardcoded secret / forgeable CSRF token.
- **Locations:** `packages/create-kovo/templates/src/auth.tsx:57-63` (`starterAuthCsrf.secret = 'replace-with-a-deployed-secret'`), `:79,88,118,163` (wired into signIn/signOut + `csrfField`); `packages/create-kovo/src/index.ts:53,124-132` (`renderTemplate` only substitutes `{{name}}`); token derivation `packages/server/src/csrf.ts:77-78`.
- **Description:** The template hardcodes the CSRF HMAC secret, wired into both auth mutations and the login/logout `csrfField`. The scaffolder only does `{{name}}` substitution — no env read, no random-secret generation, no replacement. Token = `HMAC-SHA256(secret, sessionId)`, so the secret is the only key material.
- **Impact:** Every scaffolded app starts with a globally-known CSRF HMAC key. If a developer ships without changing the literal, an attacker who knows the public secret can mint valid `csrf` values for any guessable/observable session id, defeating the synchronizer-token CSRF defense. The placeholder is self-documenting but type-checks and passes all tests with no build-time guard, so a careless deploy silently inherits a public secret.
- **Recommendation:** Generate a per-project random secret at scaffold time (`crypto.randomBytes(32).toString('base64url')`), or read `process.env.KOVO_CSRF_SECRET` and throw at startup when missing/placeholder. At minimum, fail a startup assertion if the secret still equals `'replace-with-a-deployed-secret'`.

### M6 — Pre-session login CSRF token is a static, attacker-derivable constant (login-CSRF)

- **Status:** Adjusted (report covered the static-token angle; rated Medium here).
- **Category:** CSRF (login CSRF).
- **Locations:** `examples/commerce/src/app-shell.ts:288-301` (`authCsrfId = 'commerce-shell-login'`), `examples/commerce/src/app.ts:128-145`; template mirror `packages/create-kovo/templates/src/auth.tsx:59-61`; token derivation `packages/server/src/csrf.ts:77-78`.
- **Description:** Token = `HMAC(secret, sessionId)`. For the login form there is no session, so the `sessionId()` source falls back to a process-wide constant `authCsrfId`, and the auth-csrf secret is a shipped constant. So the login token = `HMAC(static_secret, 'commerce-shell-login')` — a fixed string computable offline. No `Origin`/`Sec-Fetch-Site` fallback check exists in the mutation pipeline, so the synchronizer token is the only defense for the unauthenticated sign-in endpoint.
- **Impact:** An attacker forges a valid `csrf` value for the sign-in endpoint and submits a cross-site login with **their own** credentials (login CSRF), forcing the victim's browser to authenticate as the attacker so subsequent victim actions land in the attacker-controlled session. Does not steal the victim's session; post-login mutation CSRF remains session-bound. The degenerate pre-session pattern also ships in the create-kovo template.
- **Recommendation:** Bind the pre-session token to a per-browser unpredictable value (random pre-session cookie used as the `sessionId` source, double-submit/signed cookie), or add an `Origin`/`Sec-Fetch-Site` check for the unauthenticated sign-in endpoint. At minimum document that a constant `authCsrfId` only guards blind cross-site posts and does not stop login-CSRF when the secret is known.

### M7 — Sign-in/sign-up mutations ship with no rate-limit / brute-force guard

- **Status:** Adjusted (report HIGH; example/template defense-in-depth gap, Medium).
- **Category:** Missing brute-force protection.
- **Locations:** `examples/commerce/src/app.ts:242-248` (csrf + redirect only, no guard); `packages/create-kovo/templates/src/auth.tsx:78-81` (guardless); `packages/better-auth/src/index.ts:937-941,1222-1230` (factory adds no default throttle); contrast guarded `examples/commerce/src/app.ts:307-309,371-373`; primitive `guards.ts:143-178`.
- **Description:** `commerceSignIn` and the template sign-in are declared with only csrf + `defaultRedirectTo`; the better-auth factory injects no default throttle. CSRF runs before guards, but the login CSRF token is a known constant (M6), so it imposes no per-attempt cost. The framework ships `guards.rateLimit` (used by `addToCart`) — the sign-in path simply omits it.
- **Impact:** An attacker scripts unlimited POSTs to the sign-in endpoint carrying the static login CSRF token, iterating passwords for a known email; nothing throttles. Enables online password brute-force / credential stuffing against any app on the starter template or commerce reference. Medium: missing defense-in-depth on example/template code, one-line fix, exploitability depends on weak passwords.
- **Recommendation:** Add a per-identifier rate-limit guard to sign-in (and sign-up) in both the create-kovo template and commerce, keyed by email/IP (default `per:'session'` collapses to one `'anonymous'` bucket — see M3): `guards.rateLimit({ max:5, windowMs:60000, per:'global', key:(r)=>emailFromRequest(r) ?? clientIp(r) })`. Consider a documented default throttle in `betterAuthSignInEmailMutation`.

### M8 — Commerce receipt upload/download example was removed

- **Status:** Retired from `examples/commerce` during the example-readability pass.
- **Category:** Insecure direct object reference / cross-user disclosure.
- **Locations:** Historical Commerce app receipt upload/download code; framework upload/storage coverage remains in `packages/conformance-fixtures/src/server-fixtures.ts` and storage tests.
- **Description:** The prior Commerce receipt upload demo used a storage key derived from client filename and a matching download route. That production-hardening example made the app harder to read, so the upload/download surface was removed from Commerce instead of kept as app-authored demo code.
- **Recommendation:** Keep file upload ownership, storage-key namespacing, and content-disposition guidance in framework docs/fixtures rather than the readable Commerce example.

### M9 — Commerce payment webhook and CSV export example was removed

- **Status:** Retired from `examples/commerce` during the example-readability pass.
- **Category:** Authorization / data-integrity write + CSV formula injection.
- **Locations:** Historical Commerce payment webhook and CSV export code; webhook verification coverage remains in core/server tests and conformance fixtures.
- **Description:** The prior Commerce webhook and CSV export demo mixed provider-signature verification, replay protection, owner validation, and spreadsheet hardening into the storefront example. That surface was removed from Commerce so the app now teaches the ordinary route/query/mutation/component path.
- **Recommendation:** Keep signed webhook and CSV/spreadsheet hardening coverage in focused framework fixtures or docs, not in the readable storefront example.

### M10 — Inline-loader fragment-target lookup builds `querySelector` strings from un-escaped wire data (selector injection / apply DoS), diverging from the hardened modular path

- **Status:** New (not in report).
- **Category:** DOM selector injection / response-apply integrity.
- **Locations:** `packages/browser/src/inline-loader.ts:7` (shipped artifact `ft`) + `packages/browser/src/inline-loader-build.ts:192-195,207-212,241` (source, no try/catch; `sef` → native `form.submit()` fallback); contrast hardened `packages/browser/src/fragment-targets.ts:12-36` (`escapeCssString`); server emits via `wire-html.ts:66`; injected into the shell at `document-core.ts:219`. App vector: `examples/commerce/src/components/product-grid.tsx:113,158-160` + `app.ts:719` (`failureTarget` from raw `productId`, `s.string()`).
- **Description:** The always-loaded inline bootstrap resolves fragment targets by string-concatenating the wire-decoded target into CSS selectors with no escaping: `doc.querySelector('[kovo-c="'+target+'"]')…`. The target round-trips — server `escapeAttribute` encodes `"`→`&quot;`, the client `unescapeHtml` restores a literal `"`, breaking out of the selector. The modular sibling `findFragmentTargetElement` was deliberately hardened with `escapeCssString`, but the inline path — the one actually injected into every app shell — was never updated, and parity specs don't cover `ft`. `ft`/`p`/`ab` have no try/catch, so a malformed selector throws and aborts the whole apply pass.
- **Impact:** An app deriving a fragment target from entity data (commerce `productFormTarget(productId)`, `productId = s.string()` with no charset constraint) can submit `productId='x"]'` and get a malformed wire target back; the enhanced client's `querySelector` throws, the apply pass aborts, caught only by `sef`'s `.catch(()=>native form.submit())` → a fresh POST with no `Kovo-Idem` dedup (apply DoS / duplicate of the attacker's own mutation). Self-confined (the malicious target only appears in the submitter's own response; broadcast is same-user) and the morphed HTML stays server-escaped, so no cross-tenant XSS — but it is a shipped framework divergence from a deliberate security control, structurally unguarded by parity assertions.
- **Recommendation:** Port `escapeCssString` (or `CSS.escape`) into the inline `ft` so all interpolated selectors are escaped (keep `getElementById(target)`, which is selector-safe), or wrap `ft`'s `querySelector` calls in try/catch so a malformed target degrades to "no target found." Add a build-time parity assertion binding inline `ft` selector-escaping to the modular `findFragmentTargetElement`, plus a unit test.

---

## Re-verification adjustments (vs. the original report)

Deltas the user should be aware of from re-checking the report against current code:

- **Elevated.** The report's "JSX runtime inserts text children unescaped" (HIGH) is the dominant root cause and is treated here as **Critical** (framework default, no escape hatch, multiple independent sinks — JSX, compiler list-stamp, reactive attribute bindings — and proven end-to-end). The two open-redirect helpers `redirectPath` and `normalizePathname` were rated **MEDIUM** in the report but are **High** here (shipped helpers inherited by every app; `normalizePathname` is unauthenticated and pre-auth). The commerce receipt-key issue was the report's _low_ and is **Medium** (deterministic cross-user disclosure in the flagship reference's documented pattern).
- **New (not in the report).** Compiler reactive list-stamp `innerHTML` XSS (H1); reactive attribute binding to URL/style attributes (H2); the broadened `@kovojs/ui` anchor `href` scheme gap (H3); inline-loader selector injection (M10); CSV formula injection in the commerce export (folded into M9).
- **Downgraded / refuted from the report's MEDIUM+ tier** (excluded from the ranked list above, per "ignore low and below"), with the reason each was re-rated:
  - _GitHub Actions_ — unpinned actions (`ci.yml`/`pages.yml`) and the `pages.yml` workflow-wide `id-token:write`/`pages:write` over-grant: **low**. Framework-repo CI only (not in `packages/`/templates); fork-PR tokens are read-only with no secrets; the privileged path requires an already-trusted actor with push/`workflow_dispatch`. Genuine least-privilege hardening, not a fork-reachable exploit.
  - _`searchParamsToRecord` `__proto__` prototype "pollution"_: **refuted**. Runtime-verified that `record['__proto__']=value` invokes the inert prototype setter on a disposable per-request object; no own key, no global pollution, no privilege gain.
  - _Filesystem sidecar `.kovo-storage.json` collision_: **low**. Needs the FS backend specifically plus attacker control of the exact sidecar-suffixed key; same-bucket corruption/read-DoS only, no cross-tenant disclosure. Memory/S3 adapters immune; commerce uses memory.
  - _`StoredFileSchemaImpl.parse` (sync) returns "stored" without persisting_: **low**. Unreachable via any shipped flow (the mutation pipeline always uses `parseAsync`); a latent API footgun only if an app calls `.parse()` directly on a stored-file schema.
  - _Guard `null` fails open (vs `undefined` fails closed)_: **low**. Only reachable by a custom guard returning `null` against the typed `GuardResult` contract (a TS error); no shipped guard returns `null`; the common accidental `undefined` fails closed.
  - _Rate-limit Map FIFO (not LRU) eviction_: **low**. Resetting a throttled key costs ~10,000 distinct keys; impossible for `per:'global'`, bounded for `per:'session'`; reference apps always pair `rateLimit` with auth.
  - _`defaultMutationRedirectTo` reflects `Referer`_: **low**. Only reachable when an app uses the default mutation pipeline without supplying `redirectTo` (all shipped apps/templates supply it); `Referer` is browser-set and CSRF-default-on blocks cross-site POSTs. Fix alongside the redirect family via `safeSameOriginPath()`.
  - _Tutorial hardcoded CSRF secrets, tutorial/reference `{item.name}`/session-field XSS, `product-grid` `{item.id}`_: **low**. Latent instances of the C1 root cause over trusted seed data with no attacker write path; lowest blast-radius tier. All subsumed by the C1 fix.

## Dropped — additional low/none items considered during discovery

`serializeCookie` has no secure defaults / allows `SameSite=None` without `Secure` (mirrors the npm `cookie` convention; reference apps set `HttpOnly`+`SameSite=Lax`; fails safe in modern browsers); commerce mock's predictable `session-${user.id}` token (confined to the example's in-memory auth mock; real `better-auth` uses cryptographic ids); `getBetterAuthSetCookie` collapses multiple `Set-Cookie` on the `getSetCookie`-absent fallback (gated on a runtime lacking `Headers.getSetCookie()`, present everywhere targeted); Stripe/Standard-Webhooks presets verify a UTF-8 round-trip rather than raw bytes (fail-closed only; legitimate UTF-8 JSON verifies); `normalizeStorageKey` only splits on `/` so backslash separators pass (FS sink has a `path.resolve`/`relative` backstop on both OSes, S3 keys are opaque); mutation idempotency-replay key omits the mutation key (dormant — opt-in store, per-submission random idem; folded into M4).

---

## Recommended remediation order

1. **C1 + H1 + H2** — land a single output-encoding strategy: escape text children by default in `renderJsxChildren` with a `RawHtml` opt-in; have the compiler escape text interpolations and the list-stamp value placeholders; add a URL/style scheme policy for inline attribute derives and `setBoundAttribute`. This closes the dominant XSS surface across SSR, fragments, reactive lists, and reactive attributes at once.
2. **H3** — add one shared safe-URL helper in `headless-ui` and route every `href`/`src`-emitting primitive through it.
3. **H4 + H5** — introduce `safeSameOriginPath()` and use it in `redirectPath`, `normalizePathname`, and the Referer-derived PRG target.
4. **M-tier** — `nosniff` default (M1); explicit auth-success check (M2); rate-limit keying + sign-in throttle (M3, M7); reserve-before-execute (M4); scaffolder secret generation + pre-session token binding (M5, M6); namespaced storage keys (M8); webhook owner resolution + CSV-cell hardening (M9); inline-loader selector escaping/parity (M10).
