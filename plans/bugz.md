# Bug Ledger (`bugz`)

**Date:** 2026-06-25
**Scope:** Full framework — `packages/{server,compiler,drizzle,browser,core,better-auth}` at HEAD `d3d6864bb`.
**Method:** 12-lens adversarial multi-agent hunt (server XSS/encoding, mutation/CSRF/mass-assignment,
routing/redirect, egress/SSRF, response/headers/confidential, compiler static-analysis **soundness**,
compiler codegen sinks, SQL injection, IDOR/owner-scope, browser DOM XSS, core security primitives,
correctness/races) + a completeness-critic second round. **Every confirmed item below was reproduced
in a throwaway `git worktree`** (16/18 by a runnable test/script; the rest by source-level proof).
The headline XSS (H1) and the five static-analysis soundness holes (H2–H7) were independently
re-confirmed at this HEAD.

> These are findings against the framework's own **"secure by construction"** contract (SPEC §1.1,
> §2 Prime Principle): whole vuln classes are supposed to be compile-time errors or fail-closed
> runtime floors. The HIGH items are mostly **soundness holes** — insecure code that compiles clean
> and passes `kovo check`, silently breaking a guarantee the framework advertises. The June-2026
> `SECURITY_FINDINGS.md` wave (XSS default, redirect helpers) is already fixed; nothing below
> re-reports those.

## Severity summary

| Severity | Count | Items |
| -------- | ----- | ----- |
| High     | 9     | H1–H9 |
| Medium   | 4     | M1–M4 |
| Low      | 5     | L1–L5 |

Shared root causes: **H3 + H5** are one bug in `directPrivateScopeForExpression` (two gates affected);
**H8 + H9** are both webhook idempotency; **L1 + L2** are both `cookies.ts` floor gaps.

---

## HIGH

- [ ] **H1 — Server JSX runtime emits attribute _names_ unescaped; untrusted spread keys break out of the tag (stored XSS).** `packages/server/src/jsx-runtime.ts:251-253`
  - `renderJsxAttributes` sends every attribute _value_ through `safeRuntimeAttribute` (:251) but concatenates the _name_ verbatim (`rendered += \` ${name}="${attributeValue}"\``, :253). The sink policy (`decideRuntimeAttributeWrite`, `core/internal/sink-policy.ts`) inspects the name only to classify the family — it never validates the name's characters. The compiler defers dynamic spreads to this runtime floor; compiler line 252 expands only static object spreads. Dynamic spread keys have no guard at either layer.
  - **Exploit:** `record = { 'x><img src=x onerror=alert(1)>': 'y' }` (a jsonb column, CMS blob, or `Object.fromEntries(formData)`) → `<div x><img src=x onerror=alert(1)>="y">…` executes. A boolean-true key injects raw `<script>`. Breaks SPEC §1.1/§2 (XSS is neither a compile error nor a fail-closed floor here).
  - **Verified:** worktree vitest, 2/2 — rendered output contains raw `<img …onerror>` and `<script>` (independently re-reproduced at this HEAD).
  - **Fix:** fail-closed attribute-**name** allowlist in `renderJsxAttributes` (e.g. `/^[A-Za-z_:][A-Za-z0-9_.:-]*$/`, never whitespace/`=`/`<`/`>`/quotes); omit + emit a KV236-style sink event on mismatch (both the value and boolean-true branches). Ideally also reject dynamic spreads onto intrinsic elements in `output-context.ts` so the static layer matches the static-spread KV236 path.

- [ ] **H2 — Egress private-network floor validates only `address[0]` of a multi-A DNS answer, then forwards the whole array (SSRF / DNS-rebind / cloud-metadata).** `packages/server/src/egress.ts:613-618` (mirror: `egress-undici.ts:114-116`)
  - The injected pinning lookup classifies `resolvedIp = address[0]` (:613-614) but `cb(null, address, family)` forwards the **entire unvalidated array** (:618). Node ≥20 enables `autoSelectFamily` by default (true on the repo's Node 24.18), so the lookup is always called with `{all:true}` and RFC-8305 happy-eyeballs dials `address[1..n]` when `address[0]` is slow/refused. Directly falsifies the module's own advertised "the answer we validate is the answer we connect to" (egress.ts:46-49,597-598) and SPEC §6.6 rule 2.
  - **Exploit:** attacker DNS returns `[<slow public IP>, 169.254.169.254]` (or `127.0.0.1`/RFC1918) for any host the app fetches (user-supplied/webhook/avatar/OG-preview URL); floor passes on the public first record, Node connects to the private second → IMDS credential theft / internal pivot. Fires on **default Node + default empty-deny policy**.
  - **Verified:** worktree, 3/3 — under an empty deny policy, `http.get` to a host resolving `[8.8.8.8, 127.0.0.1]` connected to the _denied_ loopback and read its body; control `169.254.169.254` correctly blocked. Confirmed `address[0]`-only at HEAD.
  - **Fix:** classify **every** entry of the array; fail the lookup closed if any IP is blocked (or forward only the passing subset, fail closed if empty). Mirror in `egress-undici.ts` via `dns.lookup(host,{all:true})`. Optionally disable `autoSelectFamily` on the floored path as DiD. _(Candidate claimed critical; held at HIGH because the layer is honestly labeled fail-closed DiD, not a by-construction proof.)_
  - **Contestability (reviewed): held at HIGH.** The "it's only DiD" rebuttal does **not** cover this: the module's disclosed residual holes are same-process code-patching, worker/child processes, native sockets, and exfiltration — a benign multi-A answer is none of them. This falsifies the layer's _specific_ affirmative rebind-pinning guarantee (egress.ts:597-598) using the exact input it exists to defeat, on **default config**, for metadata credential theft. In-threat-model + default-on ⇒ HIGH stands.

- [ ] **H3 — KV438 mass-assignment gate: an input field named `session`/`guard`/`tenant` is mis-classified as trusted server scope (cross-tenant write / privilege escalation).** `packages/drizzle/src/static/session-provenance.ts:454-456` _(shared root with H5)_
  - `directPrivateScopeForExpression` returns "private (server) scope" whenever **any** segment of the access path is literally `guard`/`session`/`tenant` (`segments.path.indexOf(kind)`), **never checking that the root is the request/session binding**. `governedValueVerdict` (`derivation.ts`) consults this _before_ the input-provenance reject, so a request-input value laundered through such a field name is treated as server-derived and a governed-column write compiles with no KV438.
  - **Exploit:** governed table `kovo({owner:'ownerId', governed:['role','tenantId']})`; handler input `{ tenant: string }`; `db.update(accounts).set({ tenantId: input.tenant })` → **zero KV438**, while the identical `input.role` write _is_ flagged. Tenant-A user posts `tenant:'B'` → cross-tenant IDOR; `session`/`guard`-named fields escalate role/owner. Breaks SPEC §10.3/§11.1, §1.1.
  - **Verified:** worktree, real `extractMassAssignmentFromProject` — control `input.role`→flagged; `input.tenant`/`input.session`/`input.guard`→`[]` (no finding). Confirmed code at HEAD (only differentiator is the field **name**). Precondition refined: the matched segment must be a **required** (non-nullable) field; `tenant?: string` is flagged.
  - **Fix:** anchor the private-scope match to a proven carrier — require `segments.root` to resolve to the recognized request/session/context binding (or a `SessionProvenance` alias); and/or exclude expressions whose root is an `$input` root so they fall through to the symbol-provenance input reject (fail-closed). One fix covers H5.
  - **Contestability (reviewed):** analyzer fix is load-bearing and not controversial. The `tenant`→`tenantId` vector is realistically named — the gate fails on the exact "trust the client's tenant" mistake it exists to catch — so H3 holds at HIGH. Note the trigger is a _member_ access `X.tenant.Y` with untrusted `X`, not a variable named `tenant` (root is excluded from the match).

- [ ] **H4 — KV422 SQL-safety analyzer recognizes Kovo `sql.raw`/`identifier` only by the literal receiver name `sql`; aliasing/namespace import defeats it (SQL injection via query-builder ORDER BY/WHERE).** `packages/drizzle/src/static.ts:766,835`
  - The pass detects Kovo's raw-SQL helpers by `receiver.getText() === 'sql'`. It resolves aliases/namespaces for **native drizzle-orm** (`nativeDrizzleSqlReceiverTexts`, :780-791) but has **no** equivalent binding resolution for `@kovojs/drizzle`'s own `sql`. So `import { sql as s }` → `s.raw(input.x)` and `import * as k` → `k.sql.raw(input.x)` are invisible. Because the raw chunk flows through the Drizzle **query builder** (`orderBy`/`where`), it never reaches the managed-handle runtime floor (`server/src/sql-safe-handle.ts` only guards `execute/query/exec/sql/prepare`).
  - **Exploit:** `import { sql as s } from '@kovojs/drizzle'; db.select().from(products).orderBy(s.raw(input.sort))` → blind/error-based exfil via ORDER BY (stacked statements on multi-statement drivers). `kovo check` emits **zero** KV422. Breaks SPEC §10.2/§6.6.
  - **Verified:** worktree, 5/5 — `analyzeSqlSafetyFromProject` returns `[]` for aliased + namespace forms, `['KV422']` for the byte-identical bare-`sql` baseline. Confirmed literal compares at HEAD. _(The candidate's "HOLE 3" — aliased `s.raw` at a real `db.execute` sink — was refuted: the sink path still flags it.)_
  - **Fix:** resolve `sql` to its `@kovojs/drizzle` import binding (collect local aliases + `<ns>.sql` accessors) and compare against that set at both :766 and :835 — mirror what `nativeDrizzleSqlReceiverTexts` already does for drizzle-orm. Optionally fail-closed on any `<recv>.raw(...)`/`.identifier(...)` whose receiver isn't provably non-SQL.

- [ ] **H5 — KV414 owner-scope (IDOR) gate: a `.session.`/`.guard.` member access is trusted as the session principal even when rooted at client input.** `packages/drizzle/src/static/session-provenance.ts:454-456` _(same root function as H3)_
  - Same un-anchored name match as H3, reached via `argumentKey`→`privateScopeForExpression` (`summaries.ts:1806`) which runs **before** the client-input check. `queryInputKeyOperand` only recognizes depth-1 `input.<x>`, so a depth-2 `input.session.userId` is never seen as input and the greedy session-by-name match wins → the owner predicate is recorded `scope:'session'` with no KV414.
  - **Exploit:** owner table `kovo({owner:t=>t.userId})`; handler input `{ session: { userId: string } }`; `db.delete(orders).where(eq(orders.userId, input.session.userId))` → attacker sets any victim's id and deletes/updates their rows; clean compile.
  - **Verified:** worktree, real `extractOwnerAuditFromProject` — `input.session`/`input.guard` writes return `scope:'session'` (byte-identical to trusted `req.session` baseline, no KV414); control `input.userId`→`scope:'args'` (flagged). Refinements: `tenant` resolved to `scope:'unknown'` (not the safe `session`), so only `session`/`guard` launder; the **read-side** extension was _not_ reproduced (needs a `query()`-registered load) — treat read-side + the KV438 overlap as same-root-cause but write-side alone justifies HIGH.
  - **Fix:** as H3 — bind private-scope to a proven session/request root; make input-provenance detection depth-N so nested `input.a.b…` is recognized as input and takes precedence (fail-closed to args/KV414).
  - **Contestability (reviewed):** weakest framing in the report — **write-side only** (read-side unverified), and `tenant` resolves to `unknown` here so only `session`/`guard` launder (unnatural names for _client_ input). Still fix it (shared root-anchoring fix with H3), but exploitability is low: treat as effectively MEDIUM / "harden the analyzer," not a demonstrated live IDOR.

- [ ] **H6 — Client URL/HTML trust brands (`__kovoTrustedUrl`/`__kovoTrustedHtml`) are structurally forgeable from wire/query JSON (`javascript:` href + SSR HTML injection).** `packages/browser/src/security-output.ts:120-126,155-161,199-220`
  - `kovoSafeUrl`/`kovoBoundAttributeValue` short-circuit scheme neutralization when `isKovoTrustedUrl(value)` — but that is a plain `value.__kovoTrustedUrl === true` structural check, **not** a process-minted witness (contrast the non-forgeable `blessSink` WeakSet in `sink-policy.ts` and `Symbol.for('kovo.renderedHtml')`). Query truth is `JSON.stringify`'d server-side and round-trips intact (`wire-parser.ts`), so a JSON object reproduces the brand.
  - **Exploit:** app binds a URL attr to an object-typed query leaf the user controls (settings/custom-fields/CMS JSON). Attacker stores `{"__kovoTrustedUrl":true,"value":"javascript:alert(document.cookie)"}` → `href="javascript:…"` on next apply (click-to-exec for `<a>`/`<form action>`, interaction-free for `<iframe src>`). **Server-side twin:** `isKovoTrustedHtml` has the identical weakness; `server/src/html.ts:73-79 renderHtmlValue` honors `__kovoTrustedHtml===true` on any object → stored SSR XSS for `{post.body}` where `post.body` is an attacker object. Breaks SPEC §4.8 KV236 / §4.5.
  - **Verified:** worktree, 3/3 — string `javascript:` → neutralized to `#`; `JSON.parse('{"__kovoTrustedUrl":true,"value":"javascript:…"}')` → emitted verbatim; end-to-end `applyQueryBindings` set the live href to the `javascript:` URL.
  - **Fix:** mint a process-private WeakSet/Symbol witness in `trustedUrl()`/`trustedHtml()` and check **that** in `isKovoTrustedUrl`/`isKovoTrustedHtml` (reuse the `blessSink` pattern), so a wire-decoded object is never author-vouched. Fix both URL and HTML predicates.

- [ ] **H7 — ReDoS analyzer fails open: an unescaped `)` inside a character class hides the quantified group, accepting a catastrophic `pattern()`.** `packages/server/src/redos.ts:428-443` + `packages/compiler/src/validate/redos-pattern.ts:188` (identical copy)
  - `matchGroupClose` counts `(`/`)` but never skips `[...]` spans (no `classDepth`), so `)` inside a class decrements depth early, mis-locating the group close; the nested-quantifier `(X+)+` check is then skipped. Both the runtime floor (`assertLinearSafePattern`, via `schema.ts:398 .pattern()`) and the compile-time KV434 gate accept it. Breaks the SPEC §6.6 contract that `pattern()`'s static reject is the _sound_ subset (may over-reject, must never accept exponential).
  - **Exploit:** author writes `s.string().pattern("^([\\w)]+)+$")` (natural for fields that may contain `)` — "Acme (Inc.)", phone formats). No KV434; runtime accepts it. A ~33–40-char request value triggers catastrophic backtracking → one core pegged for tens of seconds. Unauthenticated remote DoS.
  - **Verified:** worktree — `assertLinearSafePattern` accepts `^([)]+)+$`, `^([\w)]+)+$`, `^([a-z0-9)]+)+$` (rejects the paren-free control); measured 4.9s @ n=30, 19.6s @ n=32. `matchGroupClose` bodies byte-identical across both copies; sibling `splitTopLevelAlternatives` _does_ track `classDepth` (the fix shape). Confirmed at HEAD.
  - **Fix:** give `matchGroupClose` a `classDepth` counter (enter on `[`, exit on `]`, ignore `(`/`)` inside a class) in **both** files; add `([)]+)+` / `([\w)]+)+` to the rejection fixtures.

- [ ] **H8 — Webhook idempotency floor is keyed on `recordChange()`, not on actual writes; a tx-direct/outbox write double-executes on provider retry.** `packages/server/src/webhook.ts:407-421` (early return at :411; check at :357 runs _after_ commit)
  - `assertWebhookReplayPosture` returns early when `changes.length === 0`, and `changes` is only appended by `context.recordChange` (a metadata push, no DB write). A handler that writes via `context.tx` / a `domain()` write / a `kovo({exempt:true})` outbox table but never calls `recordChange` yields `changes.length===0` → allowed with no `idempotency()` and no `replayStore`. No compile-time backstop: `compiler/src/scan/parse.ts:130` collects only `mutation(...)` handlers, so KV330/KV402/KV404 never apply to webhook handlers despite SPEC.md:875 claiming they do.
  - **Exploit:** `webhook('charge', { handler(i,ctx){ ctx.tx.insert(ledger)… } })` with no idempotency/replayStore. Provider redelivers the same event id (Stripe/PayPal retry on timeout) → handler runs **twice** (double charge). Breaks SPEC §9.1:875 / §10.3:1151.
  - **Verified:** worktree, 3/3 — same body twice → `sideEffects===2`, both 200, `replayed===false`; the contrast webhook that calls `recordChange` trips the 500 floor; tx commits _before_ the posture check.
  - **Fix:** stop keying on `changes.length`. Per the "stronger default" bias, require `idempotency`+`replayStore` unconditionally for any `webhook()` exposing a writable tx, fail closed at declaration/dispatch (move the check _before_ commit). Add a compiler check that scans webhook handlers for reachable writes so KV330/etc. actually apply.

- [ ] **H9 — Webhook reserve-lost race falls through to execute instead of failing closed; concurrent redelivery double-executes with a durable store.** `packages/server/src/webhook.ts:328-356` (fall-through after :340)
  - The reserve path does a single non-blocking attempt: `reserve()` → if undefined, `get()` once → if that's undefined, it falls through and runs the handler with `reservation===undefined`. The `WebhookReplayStore.get` contract (:65-69) permits returning undefined, which a realistic durable cross-instance store (Postgres `INSERT … ON CONFLICT DO NOTHING` + `SELECT`) does for a reserved-but-uncommitted row. The mutation path was hardened for exactly this (`replay.ts:367-388` re-reserve → `kind:'unavailable'`); the webhook path never was. Breaks SPEC §10.3:1151 ("MUST block … never re-execute", explicitly names `webhook()`).
  - **Exploit:** durable replayStore + two concurrent deliveries of the same event id (provider double-send / two instances). A parks in the handler; B's `get()` and `reserve()` both return undefined → B runs the handler too → double side effect.
  - **Verified:** worktree — `{ enteredTotal:2, sideEffects:2, statusA:200, statusB:200 }` with a contract-compliant durable-style store. (The shipped in-memory store has a _blocking_ `get()` so it doesn't trigger — but it also can't dedup across instances, so it isn't the HA store.)
  - **Fix:** mirror `reserveMutationReplayBeforeRun` — on `reserve()===undefined` with no committed response, **re-reserve**; if still unobtainable, **fail closed** (429 Retry-After / 503) so the provider retries, never execute.

---

## MEDIUM

- [ ] **M1 — No-JS mutation submissions have no replay/idempotency protection; the handler double-executes on duplicate/concurrent submit.** `packages/server/src/mutation.ts:658-672, 781-787, 833, 895-939`
  - Two independent defects kill the SPEC §10.3:1151 atomic-reservation floor on the no-JS path: (1) `renderMutationEndpointResponse` never threads a replay store into `renderNoJsMutationResponse`, and `KovoApp` has no no-JS replay-store field (`app-types.ts:238` only the enhanced one), so `replayStore` is always undefined; (2) idem is derived via `'Kovo-Idem' in noJsRequest.rawInput`, always false for a real `FormData` POST (the `in` operator doesn't see FormData entries). The guard at :833 `if (idem && replayStore)` is dead → every no-JS submit takes the "plain path (no dedup)".
  - **Exploit:** any mutation reached without a `Kovo-Fragment` header (no-JS browser, JS disabled — a first-class SPEC §6.3 path). Double-click / two in-flight POSTs / network retry → non-idempotent write (transfer, place-order, counter) commits twice. 303 PRG only blocks reload-resubmit, not concurrent duplicates.
  - **Verified:** worktree, 2/2 — drove the real unified endpoint twice concurrently: `handlerRuns=2, replayStore records=0, statuses 303/303`. `'Kovo-Idem' in new FormData()` === false. The enhanced (JS) path is correctly protected.
  - **Fix:** add a `NoJsMutationReplayStore`-typed app field threaded into the no-JS branch; read idem from `FormData.get(KOVO_IDEM_FIELD_NAME)`, not the `in` operator. Add an integration test through `renderMutationEndpointResponse` (the existing unit test passes idem+store directly, masking the gap). _(Arguably HIGH under §1.1 "lost-update is a fail-closed floor"; held at medium — needs non-idempotency + duplicate submit, and KV429 version checks 409 the second write for versioned tables.)_

- [ ] **M2 — Compiler-injected `escapeText` double-escapes every data-path text binding (`&`→`&amp;amp;`).** `packages/compiler/src/lower/structural-jsx.ts:1176` (and :1201,1224,1246,1268,1280,1310); interacts with `server/src/renderable.ts:39`
  - The compiler lowers text interpolations to `{escapeText(expr)}`; the emitted module's `@jsxImportSource @kovojs/server` runtime routes children through `renderServerRenderable`, whose string branch escapes **again**. `escapeHtml` isn't idempotent, so values with `&`/`<`/`>` are escaped twice. Over-escaping (fail-**safe**, never XSS) but corrupts visible output of common DB text ("AT&T", "R&D", `a < b`). The §5.2 equivalence gate compares lowered _source_, not rendered HTML, and fixtures contain no metacharacters → CI stays green. The static-text path (:1310) is **never** corrected client-side, so that HTML ships permanently double-escaped.
  - **Verified:** worktree — `html(<h2 data-bind>{escapeText("AT&T")}</h2>)` → `…>AT&amp;amp;T</h2>` (expected single `AT&amp;T`).
  - **Fix:** have the compiler-injected escaper return a value `renderServerRenderable` passes through unescaped (wrap escaped result in `renderedHtml(...)` / emit a coerced-rendered-html marker), preserving single-escape and the §5.2 escapeText-presence signal. Add a render-through integration test with `&`/`<`/`>` data.

- [ ] **M3 — `verifyCredential` decoy digest is pinned at floor params, leaking account existence by login timing when the app hardens hashing.** `packages/server/src/password.ts:80-81, 142-156`
  - The absent-account decoy is a constant `…$m=19456,t=2,p=1$…` (the default floor). argon2 derives cost from the **digest's** encoded m/t/p, not the `params` arg, so the decoy always costs ~19 MiB regardless of configured options. If the app stores stronger digests (e.g. `memoryCost:65536`, OWASP-recommended), present-account logins do ~3–4× more work than absent ones — a login-timing oracle for user enumeration. Contradicts the helper's own "does not expose user existence" doc (SPEC §6.6 frames it as DiD; this is a correctness defect vs the helper contract).
  - **Verified:** worktree — present/absent latency ratio **4.18×** (~40 ms delta, trivially measurable) when hardened; control at default params **0.90×** (no signal).
  - **Fix:** derive the decoy from the call's resolved `params` (lazily hash a fixed secret per param-set and cache) so absent-account work matches the enforced floor. _(Config-gated, not default-on → medium.)_

- [ ] **M4 — Static export drops the strict CSP / X-Frame-Options / COOP / Permissions-Policy floor; every prerendered page is weaker than dynamic dispatch.** `packages/server/src/static-export-output.ts:242-263` (+ `static-export-output-targets.ts:48-88`, `build.ts:394-398`)
  - Replay faithfully captures the full document header floor into `artifact.headers` (asserted by `static-export-replay.test.ts:83-92`), but the writer materializes **only** `artifact.body` — `staticExportOutputTargets` has no `_headers`/host-config kind, and there's no `<meta http-equiv>` CSP fallback. Build presets re-add only `x-content-type-options: nosniff` (`documentStaticHeaders`); the Vercel/Cloudflare configs serve the prerendered file from disk before the full-header function runs; the neutral static build adds nothing. SPEC §6.6 self-labels these as DiD floors (so **not** a soundness hole), but the static surface is a real regression vs dynamic dispatch.
  - **Verified:** worktree — `writeStaticExportOutput` produced only `index.html`; DROPPED header keys = `content-security-policy, x-frame-options, cross-origin-opener-policy, origin-agent-cluster, permissions-policy, referrer-policy, x-content-type-options`; no header sidecar, no `http-equiv`.
  - **Fix:** materialize the captured per-document headers into a host-consumable artifact (`_headers` / Vercel `config.json` routes from `artifact.headers`, reusing the set-cookie/Kovo-header stripping that `static-export-headers` already does); and/or broaden `documentStaticHeaders()` to carry the strict CSP + isolation floor. _(Candidate claimed high/soundness; corrected to medium/DiD — only anonymous/exportable pages are statically exported, so no authed surface loses headers; impact is cross-origin clickjacking + lost XSS backstop on marketing/docs pages.)_

---

## LOW

- [ ] **L1 — Classless cookies fail _open_: an omitted `class` defaults to `app-data` (no HttpOnly/Secure), a default-allow the framework should fail closed.** `packages/server/src/cookies.ts:162-179, 200-206`
  - `class?` is optional (`:45`), and `inferCookieClass` resolves anything it doesn't name-match (`sid|session|sessionid|sessiontoken|auth|authtoken`) to `app-data` (`:178`), which forces **no** HttpOnly, **no** Secure, no `__Host-`. So common credential names (`access_token`/`jwt`/`token`/`jsessionid`/`bearer`/`id_token`) — and _any_ unrecognized name — ship insecure by default. This is **default-allow**, contradicting SPEC §2 ("default-deny over default-allow") and the `CLAUDE.md` stronger-default bias; the name-guessing heuristic exists only to serve "classless legacy callers" (`:276-277`) that a technical preview does not have.
  - **Verified:** worktree (esbuild + `NODE_ENV=production`) — `access_token`/`jwt`/`refresh_token`/`jsessionid`/`bearer`/`token`/`id_token`/`xsrf` → `HttpOnly=n Secure=n`; `sid`/`sessionToken`/`auth_token` → full `__Host-…; HttpOnly; Secure`.
  - **Fix (decided — default-deny on omission):** resolve an omitted `class` to the **credential floor** (HttpOnly + Secure(prod) + `__Host-`), not `app-data`, and **delete `inferCookieClass`** + its name-guessing. Shipping a client-readable cookie then requires an explicit `class: 'app-data'`. Framework credential cookies (CSRF, opaque-session, forwarded better-auth) already declare `class`; migration is auditing app-data `setCookie` call sites to add `class: 'app-data'`. This subsumes the missing-name symptom entirely — no name list to keep complete. (L2 still needs its own `SameSite=None`→`Secure` fix on the explicit app-data path.)

- [ ] **L2 — `app-data` cookie with `SameSite=None` is emitted without `Secure`, so browsers silently drop it.** `packages/server/src/cookies.ts:200-206`
  - The credential branch and `normalizeForwardedSetCookie` (:238,407) auto-pair `SameSite=None` with `Secure`, but the `app-data` branch returns `secure: options.secure` verbatim. `serializeCookie('theme','dark',{class:'app-data',sameSite:'none'})` → `theme=dark; SameSite=None` (no Secure) → Chrome/Firefox/Safari reject it. Fail-**safe** (a dropped cookie can't leak), but an internally-inconsistent "correct by construction" wart that breaks cross-site/iframe app-data flows (consent/locale/theme).
  - **Verified:** worktree (ts.transpile of the real source) — `OUT1: "theme=dark; SameSite=None"` (no Secure); control with `secure:true` → `"…; Secure; SameSite=None"`.
  - **Fix:** in the `app-data` branch set `secure: options.sameSite === 'none' ? true : options.secure` (mirror the credential/forwarded paths).

- [ ] **L3 — List-stamp template renders item-relative _attribute_ bindings (`data-bind:href`) as escaped _text_, clobbering the element's label.** `packages/compiler/src/analyze/query-bindings.ts:127-168` → `compiler/src/emit/client.ts:311-336`
  - `templateItemBindingPlaceholders` matches both `data-bind` and `data-bind:<attr>` (via `isBindingAttribute`) and positions every placeholder at the element **child body**, so `<a data-bind:href=".url">Open</a>` in a `<template kovo-stamp>` renders the URL as the link text (dropping "Open"); the runtime also sets the real href separately. Value is HTML-escaped → correctness, not XSS. Compiles clean (no diagnostic). Broader: self-closing stamped elements get the value _prepended_ as stray text; text+attr on one element is order-fragile by `localeCompare`.
  - **Verified:** worktree — emitted `render(item)` = `…<a data-bind:href=".url">${kovoEscapeHtml(read(["url"]))}</a>…`; placeholder span is the `<a>` child body.
  - **Fix:** in `templateItemBindingPlaceholders`, restrict child-body placeholders to text bindings (`attribute.name === 'data-bind'`); attribute bindings are already applied by the runtime `applyItemRelativeBindings`/`setBoundAttribute`.

- [ ] **L4 — Inline-loader URL scheme check (`uu`) uses a looser regex than the canonical primitive, rewriting valid relative URLs to `#`.** `packages/browser/src/inline-loader-build.ts:183-186` (+ regenerated `inline-loader.ts`)
  - `uu` uses `/^[a-z][^:]*:/` (any non-colon chars before the colon) vs canonical `security-url.ts:41` `/^([a-z][a-z0-9+.-]*):/` and the sibling inline copy `w`. So a relative URL with a colon after a non-scheme char (`archive/2024:summary`, `a/b:c`) is wrongly flagged unsafe → rewritten to `#` on the always-on inline path only, while SSR and the module loader keep it. **Safe direction (over-block), not an XSS bypass** — all of `javascript:`/`vbscript:`/`data:`/`blob:` (incl. tab/case/control-char variants) are flagged by all three.
  - **Verified:** worktree (node strip-types against the real runtime string) — `uu('a/b:c')=true`, `uu('foo/bar:baz')=true` while canonical/`w` = false; all dangerous schemes flagged by all three.
  - **Fix:** change `uu` to `/^[a-z][a-z0-9+.-]*:/` (regenerate `inline-loader.ts` together), or derive `uu` from the same extracted source as `w` so the three checkers can't drift (a future _loosening_ of `uu` would be a real allowlist bypass).

- [ ] **L5 — `sniffUploadBytes` marks ZIP/OOXML containers `inlineSafe`, contradicting its own download-only invariant.** `packages/server/src/upload-sniff.ts:108-117` (comment at :136-137)
  - `recognizePassiveMagic` returns `application/zip` for PK leads; `sniffUploadBytes` computes `inlineSafe: !active` uniformly. A real ZIP header carries a NUL at offset ~5, so `leadingAsciiLower` truncates the markup scan before any embedded HTML → `active=false` → `inlineSafe=true`, violating the file's stated "a ZIP is download-only … recognised, NOT inline-safe". **No live XSS today** — responses ship `Content-Type: application/zip; X-Content-Type-Options: nosniff` and browsers download ZIPs regardless of disposition — but a latent footgun inside the KV428 inline-XSS machinery (a future consumer trusting `inlineSafe` for ZIP would be misled).
  - **Verified:** worktree, 3/3 — `sniffUploadBytes([0x50,0x4b,0x03,0x04,…])` → `{contentType:'application/zip', inlineSafe:true}`; a 600-byte ZIP with `<script>` at offset 550 → `inlineSafe:true`.
  - **Fix:** force `inlineSafe:false` for `application/zip`, e.g. `inlineSafe: !active && recognized !== 'application/zip'`; add a test pinning ZIP's `inlineSafe`.

---

## Refuted / not bugs (recorded so they aren't re-chased)

All six were on `packages/server/src/confidential-at-rest.ts` and were refuted because the framework
ships **only** an encrypt path — decryption, key storage, and rotation are explicitly app-owned, and
the floor is documented DiD (SPEC §6.6:744), not a by-construction proof:

- **AAD cross-row ciphertext swap (IDOR-at-rest)** — needs an out-of-band DB write of a foreign
  ciphertext + a read-back surface; framework owns no decrypt path. Residue: doc footgun (AAD examples
  are column-scoped; show a row-PK-bound example).
- **`normalizeKey` base64url-vs-utf8 heuristic mis-decode** — no decrypt consumer exists and no valid
  competing UTF-8 32-byte key can collide; code-quality nit (the `44`-char regex arm is dead).
- **"Only the encrypt half ships — read-side tamper-rejection unenforced"** — no SPEC/plan pins a
  read-side sink; the encrypt sink is correct; a blessed `decryptAtRest` is a feature-completeness
  improvement, not a HEAD defect.
- **keyId/version outside GCM AAD** — true but inert: only `v1` exists, no decoder branches on it, and
  flipping the metadata yields the same plaintext (ciphertext+IV+AAD stay authenticated). Fold into AAD
  if/when a v2 mode lands.
- **Random 96-bit IV birthday bound** — correct NIST construction; the ~2³² encryptions/key ceiling is
  unreachable and rotation is a documented app responsibility. Doc-completeness only.

Also downgraded to robustness-only (not a security breach): `deferred-stream.ts` substring-stop vs
server line-equality predicate mismatch — reproducible only for a multi-fragment chunk shape the
shipped pipeline never emits today (worth a cheap sentinel-anchored hardening).

---

## Verification methodology

Each item was reproduced in a throwaway `git worktree` off HEAD (`git worktree add --detach`), with the
main tree kept clean and the worktree removed after (`git worktree remove --force`). The reusable recipe
(validated this session) lives at
`scratchpad/bugz-vitest.config.ts`: symlink the root **and** each `packages/*/node_modules` into the
worktree (nested transitive deps like `@material/*` live in per-package `node_modules`), copy a minimal
vitest config aliasing `@kovojs/<pkg>/<sub>` → `packages/<pkg>/src/<sub>` (the root `vite.config.ts`
won't load through a symlinked `node_modules`), write `packages/<pkg>/src/__bugz_*.test.ts`, and run
`node_modules/.bin/vitest run --config ./vitest.bugz.config.ts <file>`.

## Suggested fix order

1. **H6** (forgeable trust brands) and **H1** (attribute-name XSS) — both are client+server XSS soundness
   holes with the same shape (a fail-closed floor trusting attacker-shaped data); fix the witness/name
   guards together.
2. **H3 + H5** — single fix in `directPrivateScopeForExpression` (anchor private-scope to a proven root +
   depth-N input detection); closes the KV438 and KV414 bypasses at once.
3. **H4** (KV422 alias resolution), **H7** (ReDoS class-depth, both copies), **H2** (egress per-address
   validation).
4. **H8 + H9** (webhook idempotency — unconditional requirement + re-reserve/fail-closed).
5. **M1–M4**, then **L1–L5**.
