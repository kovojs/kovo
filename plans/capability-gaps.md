# Capability Gaps: ChatGPT-style & StackOverflow-style Apps

Adversarial capability-gap audit (2026-06-25) of building **(a)** a ChatGPT-style streaming chat
app and **(b)** a StackOverflow-style Q&A app on Kovo. Findings were produced by _building_ the
features in throwaway git worktrees off `HEAD` (`1489bde8b`) and running the real compiler/analyzer,
then independently refuting each blocked/major claim. Open `- [ ]` items are gaps to close; `- [x]`
marks confirmed strengths. Cite `SPEC.md §` + `packages/...` paths.

## Verdict — can you build it today?

- **StackOverflow-style: yes, with friction** (the better fit). Q&A modeling, multi-query detail
  regions, typed cursor/sort args, route-search GET channel, keyed reconciliation, Postgres FTS,
  optimistic voting, and multipart uploads all build and run.
- **ChatGPT-style: yes, with friction.** Streaming assistant turns (`<kovo-text>`), owner-scoped
  conversation/message persistence, `/chat/:id` routing, multi-query sidebars, and optimistic
  user-message append all work.
- **No hard blockers** to a working build — but the apps are not _safe or complete_ out of the box.
  The cost concentrates in: data-plane/optimism safety gates not enforced in the scaffold build, a
  user-content XSS footgun, auth breadth + a CSRF foot-gun, no cross-user realtime (`<kovo-live>`
  unshipped), and pagination append modes.

## Verification harness (reproducible)

```sh
ROOT=/Users/mini/kovo
git -C "$ROOT" worktree add --detach /tmp/kovo-gap HEAD && cd /tmp/kovo-gap
pnpm install --prefer-offline --ignore-scripts          # ~2s, warm store
cd examples/stackoverflow && npx vp build && npx vitest --run   # component compiler + example tests
# NOTE: vp build/vitest do NOT run the data-plane/optimism gates. Those are:
#   npx kovo compile drizzle-static   # KV410/KV411/KV422 (packages/cli/src/commands/compile.ts:1362)
#   npx kovo check optimistic         # KV310 exhaustiveness
git -C "$ROOT" worktree remove --force /tmp/kovo-gap   # throwaway
```

---

## 1. Correctness & safety traps (fix first — "buildable" ≠ safe/correct)

These are the highest-value discoveries: each lets you ship a passing build that is insecure or wrong.

- [ ] **Data-plane & optimism safety gates are not enforced in the example/scaffold build path.**
      A deliberate `sql.raw(\`… '${input.q}%'\`)`KV422 SQL-injection placed in`examples/stackoverflow/src`
built **green (`vp build`exit 0)**; KV310/KV429 also never run. The gates exist and fire correctly
only via the`kovo` CLI (`packages/cli/src/commands/compile.ts:1362`), which the example never calls;
`examples/drizzle-registry-runtime.ts`extracts query facts but **discards`.diagnostics`**.
→ an author scaffolding from the marquee example ships unsafe queries with a green build.
*Fix:* run `kovo compile drizzle-static`+`kovo check`in the example build, or make`exampleDrizzleRegistryPlugin` throw on error-severity diagnostics.

- [ ] **`trustedHtml(queryData)` is a silent stored-XSS sink (the user-content path is not
      by-construction).** `trustedHtml` is a pure brand that sanitizes nothing; compiling the **shipped**
      `examples/stackoverflow/src/components/question-detail.tsx` (6× `trustedHtml()` on query-derived data,
      no `reason`) emits **no KV236/KV426** (`packages/browser/src/security-output.ts`). The safe primitive
      is `safeRichHtml()` (a runtime sanitizer _floor_, documented as **not** a by-construction claim), but
      the example trains the opposite reflex. _Fix:_ require a `reason` on `trustedHtml` (or warn when its
      argument is provably query/request-derived); render example bodies through `safeRichHtml`.

- [ ] **CSRF audience foot-gun bricks hand-authored auth forms.** Dispatch validates
      `{audience: definition.key}` (`packages/server/src/mutation.ts:149`) but `csrfField`/`csrfToken`
      default to `field:<name>` (`csrf.ts:443`) → every hand-rolled login/signup/logout/reset form silently
      **422**s; `examples/reference` auth tests are **red on HEAD**. Compiler-emitted `<form mutation>`
      auto-binds and works. _Fix:_ auto-bind audience from the targeted mutation in the helpers; add a no-JS
      round-trip regression test. (Secondary: the Origin floor returns a generic 422 with no app `FormError`.)

- [ ] **`owns()` cannot read the validated key → latent IDOR.** `guards.owns` reads `keyOf(request)`
      (`packages/server/src/guards.ts:359`) but `runQuery`/`runMutation`/`runRoutePage` never merge parsed
      `args`/`params` onto the guard request — so a correct ownership predicate denies legit owners and a
      key-ignoring one authorizes everyone. KV414 is dischargeable **only** via session-scoped `WHERE`
      (`eq(t.userId, session.user.id)`); the headline `owns((a)=>a.id, table.col)` column-form is unshipped
      sugar (SPEC §10.3:1157). _Fix:_ merge args/params before `runGuard`; add a production-path `owns()`
      test through the runners; ship the column-form.

- [ ] **KV429 lost-update lowering footgun.** `set({score: sql\`${col} + 1\`})`(bare literal) silently
**escapes** KV429, while`+ ${1}` (interpolated operand) trips it — trivially-equivalent SQL gets
different verdicts (`packages/drizzle/src/index.toctou-readonly.test.ts`). *Fix:* lower `+ 1`and`+ ${1}`identically. (Caveat: a pure counter increment is atomic and correctly un-gated;
one-vote-per-user is a multi-row invariant KV429 explicitly does not cover — use a`UNIQUE` constraint.)

- [ ] **Both shipped example suites are red at HEAD** (so they can't be trusted as references):
      `examples/stackoverflow/src/interactive-app.test.ts` fails to load — `question-detail.tsx` transitively
      imports reserved `@kovojs/server/internal/wire` → **KV235**; `examples/reference`/`commerce` auth tests
      fail on the CSRF foot-gun above. _Fix:_ the reserved import + the CSRF audiences, then keep them green.

---

## 2. Missing capabilities (no first-class path; spec does not promise one)

- [ ] **No durable background jobs / scheduled tasks / job queue.** Explicitly deferred (`SPEC.md:728`);
      no runner. LLM batch work, email digests, reputation recompute, search reindex have no primitive.
      _Workaround:_ `endpoint()` + external cron, `webhook()` for inbound callbacks, inline mutation
      side-effects, or the §10.1 outbox/exempt-table pattern. _Fix:_ add a `job()` primitive (durable retry +
      scheduling).
- [ ] **No first-class email-verification flow.** `@kovojs/better-auth` exports only sign-in/up/out; the
      `verification` table is schema-bridge-exempt only (`internal/contracts.ts:229`). _Workaround:_
      better-auth `emailVerification` via `mount()`, or hand-write `mutation()`s over `auth.api`. _Fix:_ ship
      `betterAuthSendVerification`/`VerifyEmail` mutations with declared touches, or document the recipe.
- [ ] **2FA is mis-handled, not just missing.** The credential mutation classifies better-auth's
      `{twoFactorRedirect:true}` 200 as **INVALID_CREDENTIALS** (`internal/credential.ts:405`) — a 2FA user's
      sign-in hard-fails silently; there is no challenge/verify flow. _Workaround:_ `mount()` better-auth's
      2FA endpoints + hand-author the UI. _Fix:_ return a typed two-factor-required outcome + a verify mutation.
- [ ] **No first-class markdown / rich-text primitive.** Kovo ships only the HTML-sanitizer floor
      (`safeRichHtml`); the app owns md→HTML and the sink choice. **Double-escape trap:** `safeRichHtml`
      re-escapes a renderer's already-escaped code blocks → corrupts code display (the #1 content type on a
      Q&A site). _Workaround:_ `safeRichHtml(markdownToHtml(body))` with code emitted unescaped. _Fix:_ ship
      `safeMarkdown()` or document the canonical `markdown-it + safeRichHtml` recipe; co-locate
      `trustedHtml`/`safeRichHtml` in one entrypoint (today they're split across `@kovojs/browser` vs `/server`).

---

## 3. API gaps (capability exists but the surface is missing/awkward)

- [ ] **Instance-keyed query optimism is unauthorable inline.** The inline `mutation({optimistic})` map
      keys by query _name_ only — no `keys` field (`packages/compiler/src/scan/optimistic-inline.ts`) — so
      optimism on a keyed detail query (`questionDetail` args`{id}`, `/chat/:id` messages) falls back to
      `await-fragment`. The standalone `satisfies OptimisticFor<typeof m>` object form supports computed keys
      but isn't wired from `mutation.optimistic`. _Fix:_ add a `keys` map to the inline form, or wire + document
      the object form end-to-end.
- [ ] **No read-side cursor-append ("load more") primitive.** `@kovojs/server` exports only `stream`;
      `FragmentRenderer.mode` is `@internal`; the typed `/_q/` store replaces per instance. Load-more works
      only as a growing-window GET-form replace (re-ships prior rows) or a DOM-target `mode='append'` fragment.
      _Fix:_ a read-side `paginate`/append emitting compiler-derived keyed `mode='append'` rows that upsert
      into one client collection.
- [ ] **No `mode='prepend'` (chat "load older messages").** Only `append`|`replace` (`wire-html.ts:89`);
      append writes to the DOM end. _Workaround:_ `flex-direction: column-reverse` + newest-first + append
      (Slack-style; undocumented). _Fix:_ document the idiom or add `mode='prepend'` with a scroll-anchor contract.
- [ ] **No social sign-in helper.** No `signInSocial` anywhere; `mount()` (`mount.ts:35`, SPEC §871) is the
      intended OAuth surface but has no button/start-URL sugar, no example, and `EndpointMethod` has no `'ALL'`
      (POST init + GET callback need two mounts). `oidcProvider` metadata is KV406-degraded. _Fix:_
      `betterAuthSocialSignIn` (typed provider → start URL/button) + a worked `mount()` OAuth example.
- [ ] **No password-reset helper.** §6.6 names it only as an example anonymous-CSRF form. Achievable via
      `mutation()` over `auth.api.forgetPassword/resetPassword`, but the credential error/touch constants are
      internal-only. _Fix:_ add `betterAuthRequestPasswordReset`/`ResetPassword`, or at least re-export the union.
- [ ] **`guards.rateLimit` lacks `per:'ip'`** though SPEC §9.5:935 says it admits it (`guards.ts:265`); no
      request-IP accessor. (Coarse pre-dispatch per-IP shedding _does_ exist in `app-load-shed.ts`.) _Fix:_ add
      `per:'ip'` + an IP accessor; document attaching `rateLimit` to credential mutations.
- [ ] **`refetchOnFocus` / `live` not declarable on the query.** Focus-refetch works but its opt-out is a
      runtime install option (`refetchOnFocusOptOut`), not a `QueryDefinition` field; no `live?:true` field
      exists though SPEC §9.3:905 specs it. _Fix:_ add `refetchOnFocus?: false` and `live?: true` to
      `QueryDefinition`.
- [ ] **Mutation `redirectTo` is untyped.** A plain string (`mutation/definition.ts:219`): no PathParams
      typing, no KV220 route-table validation, no rename propagation (typed `redirect()` exists only for route
      pages, `route.ts:1211`). Renaming `/chat/:id` would not flag the create-then-navigate redirect. _Fix:_
      accept a typed `redirect('/chat/:id', {params})` value.
- [ ] **Compiler-emitted registries aren't in the app `tsc` program.** KV310/`OptimisticFor` only bite
      when `QueryRegistry`/`InvalidationSets` are populated, but the example emits none — you hand-write a
      ~30-line `declare module` that can silently drift from the real invalidation graph. (`kovo compile`
      produces them; they're just not wired into the example's tsc.) _Fix:_ fold emitted registries into the
      app tsc program.
- [ ] **`reads:` type vs. analyzer mismatch.** `QueryDefinition.reads?: Domain[]` but the static analyzer
      resolves the read set by **table** identifier: `reads:[questions]` → TS2769, `reads:[question]` passes but
      is decorative (the real set comes from `.from()`). For a fully-raw `db.execute(sql\`…\`)`read the folded
read set can be **empty** (silent-staleness) while KV410 only checks`output`— contradicting SPEC §10.2
("a KV410 projection with no`reads:`is itself a KV410 error"). *Fix:* resolve`Domain`values + require
a resolvable non-empty`reads:` for opaque projections.
- [ ] **No public optimism test helper.** The runtime primitives (`OptimisticRebaser`, `createQueryStore`)
      are `/internal` only, so writing §10.5 soundness/commuting-diagram tests for hand-written transforms needs
      internal imports. Minor. _Fix:_ a small public transform-soundness helper.

---

## 4. Ergonomic friction (works, but unpleasant)

- [ ] **Live markdown preview is effectively blocked client-side.** A md→HTML transform in a render
      position raises **KV201** ("closure captures unserializable value") and raw-HTML brands coerce to escaped
      `textContent` in an L1 island (no client raw-HTML sink). _Workaround:_ render the preview via a
      server-fragment round-trip (1 RTT — not instant). _Fix:_ document preview-as-server-fragment, or provide a
      client-safe `safeRichHtml` build usable inside an isomorphic island.
- [ ] **Signup not wired in the reference example;** credential input schema is fixed
      (email/password/name/next) — custom-profile signup needs a hand-written mutation over `auth.api.signUpEmail`.
- [ ] **Per-user vote state** requires threading `myVote` into the query result _and_ a client-held pre-image
      (`previousValue`) into the mutation input; without both, aggregate score prediction must be `await-fragment`.
- [ ] **Anonymous → authenticated upgrade** is a composition of `sessionProvider` + a transactional row
      migration (§6.5) with no sugar/recipe.
- [ ] **Empty-state / first-message chat routing:** a combined create+send+navigate has no optimistic echo of
      the first message, and an empty `/chat` index needs its own route/branch.
- [ ] **Account linking** is reachable only via `mount()` to better-auth (intentional §6.5 delegation); no
      typed helper. Lower priority.

---

## 5. Known roadmap (SPEC defers — not surprises)

- [ ] **`<kovo-live>` SSE live queries unimplemented.** No `text/event-stream` subscriber in any package
      source (`EventSource` appears only in a CSP comment); the tag compiles to a **silent inert no-op** with no
      diagnostic. Kills all cross-user realtime: live vote counts, new-answer push, presence/typing,
      notifications. Roadmap `plans/data-layer-roadmap.md:28`; SPEC §9.3:905. _Workaround:_ poll `/_q/` on a
      timer + BroadcastChannel (same-user only). _Also:_ emit a compiler diagnostic for the inert tag.
- [ ] **Compiler-derived optimism unshipped for app builds.** Machinery exists in-package
      (`packages/drizzle/src/derive-codegen.ts`, `OptimisticDerivationSets`) but is not wired into example
      builds; hand-written transforms are the only exercised path (KV310 is enforced).
- [ ] **Stream resume-after-reload** — `streaming.ts` is a single-pass iterator over one POST; no job
      registry / Last-Event-ID / GET resume. §8:823 defines interruption as fail/refetch-to-server-truth.
      _Workaround:_ persist assistant output incrementally (a real chat persists messages anyway).
- [ ] **Live cross-tab stream mirroring** — the streaming apply path never broadcasts
      (`mutation-apply.ts:88-117`); other tabs converge only at completion via refetch-on-focus.
- [ ] **Presence / typing indicators** — depend on the unshipped SSE subscriber (SPEC §7 L4); no primitive,
      no interval-poll helper. _Workaround:_ degraded `/_q/` heartbeat poll.
- [ ] **Full-text search is dialect-specific (Postgres-only).** `to_tsvector/plainto_tsquery/ts_rank` won't
      run on the in-progress SQLite dialect (`plans/data-layer-roadmap.md`, `plans/sqlite-support.md`); no
      portable FTS abstraction and the ILIKE fallback differs by dialect too.

---

## 6. Strengths (already first-class — don't reinvent)

- [x] **Streaming assistant responses** — `stream` + `<kovo-text>` append/checkpoint reconciling to server
      truth (`packages/server/src/mutation/streaming.ts`, §9.1); chat-stream probe compiled + rendered clean.
- [x] **Owner-scoped Drizzle schema** — `kovo({domain, key, owner})` as the IDOR substrate (§10.1).
- [x] **Multiple typed queries per page + typed route params** — `:id` → props → `query.args` in one GET (§6.4/§10.2).
- [x] **Multipart upload** — `s.file().maxBytes().accept().store()` with server byte-sniffing + opaque keys +
      client-filename sanitization (`schema.ts`, `upload-sniff.ts`, KV428); 6/6 vitest.
- [x] **Postgres FTS via `sql<>` opaque projection** — KV410 (`output`) + KV422 (params-not-text) fire
      correctly _when the gates are run_; ran on PGlite returning ranked rows. Plus a zero-config ILIKE fallback.
- [x] **Typed `/_q/<key>` reads** — args coercion + caching contract (`private, no-store; Vary: Cookie` for
      session-dependent), serving refetch-on-focus, GET-form fragments, and search-as-you-type (§9.4).
- [x] **Session provider + rolling refresh + role/authed guards** — `betterAuthSession` forwards Set-Cookie
      and gates revocation; distinct 401-reauth vs 403 intents (§6.5).
- [x] **BroadcastChannel multi-tab sync** (principal + build-token guarded) + keyed `kovo-key` reconciliation +
      scroll/focus-preserving morph + typed cursor/sort args (§9.1.1/§9.3/§9.4/§10.2).
- [x] **Hand-written optimistic voting** — up/down/toggle/undo via one `(data,input)` transform; KV310
      exhaustiveness is a real `tsc` error; settle-before-rebase runtime proven (12/12 tests).
- [x] **Tags (M2M), comments, accept-answer (`owns()`), reputation (SUM)** — all type-check; only the _example_
      under-delivers (comma-string tags, no comments, static reputation).

---

## 7. Workarounds quick-reference (lower priority but real)

- **IDOR:** scope every owner-table read/write by `eq(t.userId, session.user.id)` AND the arg key (satisfies KV414).
- **Auth forms:** pass `audience: '<mutation-key>'` to `csrfField`/`csrfToken`, or author `<form mutation={...}>` (auto-binds).
- **Auth breadth** (verification/reset/2FA/social/linking): `mount()` better-auth's handler subtree, or hand-write `mutation()`s over `auth.api`.
- **Realtime:** poll `/_q/` on a timer for cross-user; BroadcastChannel for same-user multi-tab; refetch-on-focus for convergence.
- **Pagination:** growing-window GET-form replace or DOM-target `mode='append'`. **Chat prepend:** `column-reverse` + append.
- **Background work:** `endpoint()` + external cron; `webhook()` for inbound; §10.1 outbox for at-least-once delivery.
- **Markdown:** `safeRichHtml(markdownToHtml(body))` (never `trustedHtml(userData)`); emit code unescaped to dodge double-escape.
- **Keyed-query optimism:** standalone `satisfies OptimisticFor<typeof m>` object form, or accept `await-fragment` (1 RTT).

---

_Audit method: 10 worktree-isolated build-probe agents + independent skeptic verification + 3 recovery
probes (search, content/markdown, voting/optimism). Every blocked/major finding was built and refuted
before landing here._
