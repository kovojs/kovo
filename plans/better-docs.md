# Better Docs — ranked improvement ledger

Source: 32-agent review workflow, 2026-07-04 — one reviewer per guide in `site/content/guides/`
(26 guides, each verified against the implementing packages and SPEC.md), plus six gap sweeps
(public API surface, SPEC coverage, example apps vs docs, world-class framework comparison,
agent-reader infrastructure, tooling/DX). Raw per-agent results:
`~/.claude/projects/-Users-mini-kovo/.../subagents/workflows/wf_24cef220-99e/journal.jsonl`.

This plan is intentionally more prescriptive than the usual compact-ledger convention (user
request, 2026-07-04): each item carries the offending passage, the verified target shape, and —
for new guides — a full section outline, so an implementing agent can deliver Next.js/Rails-level
pages without re-deriving the review. Do not compact the prescriptions away while items are open.

**How to use this plan.** Items marked ✅ were re-verified by hand in the authoring session
(exact file:line read). Everything else cites agent-read evidence: treat as high-confidence, but
re-read the cited lines before editing, and compile/run every code sample and command before
publishing — the site has compile-checked fences and a link-check gate; use them. House contract
for all prose: `rules/docs-style.md` — guide skeleton is job → smallest code (≤8 lines, one new
idea) → Run it → production shape → Handle failure → Next, with SPEC/KV pointers collapsed in a
`<details>` at the end; voice is Simon-Willison-plain ("You declare the query once", not "the
query is declared once"); every omission in a sample is named in one sentence.

Scoreboard (reviewer score /10): auth-better-auth 4, data-layer 4, dataflow-devtool 4.5,
mutations 4.5, compiler-internals 5, styling 5.5, accessibility 6, components 6,
endpoints-webhooks 6, islands 6, layouts 6, queries 6, static-export 6, streaming 6,
wire-protocol 6, deployment 6.5, live-queries 6.5, request-shell 6.5, routing 6.5, testing 6.5,
cli 7, kovo-explain 7, optimistic 7, postgres-authz-policy 7, render-tree 7, security 7.

## P0 — Wrong or build-breaking content (readers fail today)

- [ ] ✅ **Fix the canonical mutation example in `mutations.md` and `data-layer.md` — both teach
  the KV330 error case as the happy path.**
  - Current: both guides show `await request.db.insert(cartItems).values(...)` /
    `request.db.update(products)...` directly inside the mutation `handler`
    (data-layer.md:79-86; mutations.md first and third examples), and mutations.md asserts
    "Most Drizzle insert, update, and delete calls are extracted from the handler."
  - Why wrong: that exact shape is the compiler's KV330 positive test
    (`packages/compiler/src/direct-db.test.ts:11-34`, "reports KV330 when mutation handlers
    access request db directly"). The sanctioned pattern — used by the reference app with an
    explanatory comment — extracts writes into a named domain-layer function while reads stay in
    the handler: `examples/commerce/src/domain.ts:240-275` (`handler` does `db.select()` reads,
    then `await commitAddToCartRows(db, {...})`; the helper carries the comment "SPEC §10.3 /
    KV330: commerce writes live in the domain layer instead of the mutation handler").
  - Fix (target smallest example for mutations.md — modeled on commerce, re-verify compiles):

    ```tsx
    import { mutation, s } from '@kovojs/server';
    import { db as writeCartRow } from './cart-writes'; // writes live in the domain layer
    import { cart } from './model';                     // export const cart = domain('cart')

    export const addToCart = mutation({
      input: s.object({ productId: s.string(), quantity: s.number().int().min(1).default(1) }),
      touches: [cart],
      async handler(input, request, context) {
        // Reads are fine here. Writes go through a named helper — a direct
        // request.db.insert() in this body fails the build with KV330.
        await writeCartRow(request.db, input);
        return { productId: input.productId, quantity: input.quantity };
      },
    });
    ```

    Then add a short "Why the write lives in a helper" paragraph: the compiler extracts and
    verifies writes from the domain layer against `touches:`; a direct write in the handler body
    is unanalyzable and fails with KV330 (show the actual KV330 message text, captured from
    `kovo compile`). Replace the "most calls are extracted" sentence with the true contract
    (derive the exact scope — reads-allowed/writes-extracted — from `direct-db.test.ts` and
    SPEC §10.3 before wording it).
  - Same fix in data-layer.md, whose "Write with analyzable Drizzle calls" section must show the
    helper-extraction shape and name KV330 as the failure mode, with a `Handle failure` block
    showing the diagnostic.
- [ ] ✅ **Fix `data-layer.md` `touches: [cart]` — `cart` is never created; introduce `domain()`.**
  - `registry.touches` takes `Domain` values (`packages/server/src/mutation.ts:682` maps
    `domain.key`), created with `domain()` from `@kovojs/server`. Verified signature
    (`packages/server/src/domain.ts:26-30`): `domain()` derives a stable name from the exported
    binding, `domain('cart')` names it explicitly. Add, before the first `touches:` use:

    ```ts
    import { domain } from '@kovojs/server';

    // The invalidation currency: queries `read` domains, mutations `touch` them.
    // Touching a domain reruns every query that reads it (SPEC §10.1).
    export const cart = domain('cart');
    export const product = domain('product');
    ```

    and one sentence distinguishing these source-level `Domain` values from the string
    annotations in `kovo({ ... })` table tags (the guide currently conflates them). Also mention
    `tag()` (row-scoped invalidation, same file) with a pointer, not a full treatment.
- [ ] **Rewrite `auth-better-auth.md` (lowest score, 4/10).** Three independent breakages plus a
  missing arc; treat as a page rewrite, not spot fixes.
  - Broken guard example: the "Guard pages and mutations" snippet is
    `route('/', { page(_context, request) { if (!request.session) return redirect('/login', {}); ... } })`
    — no `access`, no `guard`. Kovo routes are default-deny; this fails the build with KV436.
    Target shape (verify exports — commerce uses `betterAuthAuthed` from `@kovojs/better-auth`,
    see `examples/commerce/src/domain.ts:233-236`):

    ```tsx
    import { betterAuthAuthed } from '@kovojs/better-auth';

    export const accountRoute = route('/account', {
      guard: betterAuthAuthed(),   // unauthenticated → login redirect, typed session after
      page(context, request) {
        return <AccountPage email={request.session.user.email} />;
      },
    });
    ```
  - Stale database wiring: the files table says `src/db.ts` is "the Drizzle database passed to
    both app queries and Better Auth", and step 1 shows `drizzleAdapter(appDb, ...)`. The current
    scaffold's `src/db.ts` exports a read-only surface (`readonlyAppDb`); Better Auth receives a
    separate writable handle. Re-derive the wiring from the actual create-kovo template files and
    show the real ones (quote the template source verbatim with file provenance comments).
  - First sample references `commerceSession` (never defined on the page — later snippets say
    `appSession`) and types the callback `({ session, user }: { session: any; user: any })` —
    `any` annotations the framework bans. Name it `appSession` throughout and use the real
    callback types from `packages/better-auth`'s exported signature.
  - Add the missing arc: a **Run it** section (scaffold, sign up, watch the session cookie land
    in devtools, hit the guarded page logged-out and see the redirect) and a **Handle failure**
    section binding `INVALID_CREDENTIALS` to the login form with `<FormError>` — the starter's
    `auth-forms` module already does this; lift that code with provenance.
  - Fold in the highest-value missing subtopics (from review): mounting Better Auth's own HTTP
    handler with `mount()` for OAuth/social callbacks; the `role()` guard re-exported from
    `@kovojs/better-auth`; sign-out semantics (forwarded session-clearing `Set-Cookie` +
    `Clear-Site-Data`); configuring the `betterAuth()` instance itself (`baseURL`, shared secret,
    `advanced.disableCSRFCheck` and why Kovo's CSRF makes that safe); rolling-session refresh
    header forwarding. Fix the spec pointer (session typing is not §6.6 — locate the right §).
- [ ] **Fix broken/unrunnable commands (each: quote → replacement, then run the replacement
  end-to-end before publishing):**
  - `dataflow-devtool.md:48` — `KOVO_DEVTOOL_BASE=/__kovo pnpm --filter @kovojs/example-devtool dev`:
    no `dev` script exists (`examples/devtool/package.json` has only `check`/`test`). Either add
    a `dev` script to the example (preferred — the guide's flow then works as written) or
    document the real flow: build/copy a `graph.json`, then mount `createDevtoolApp` per
    `examples/devtool`'s actual entry.
  - `deployment.md:196,282,301` — `vp build` is not the production build and `vp run kovo-check`
    is not a scaffold script. ✅ The scaffold's real scripts
    (`packages/create-kovo/templates/package.json:5-14`): `build:prod` = `kovo build
    ./src/app.tsx`, `check` = `node scripts/check-parallel.mjs`, `start` = `NODE_ENV=production
    node dist/server/server.mjs`. Rewrite the Dockerfile comment, pre-deploy gates block, and
    checklist around `pnpm run build:prod` / `pnpm run check` / `pnpm run start`, and say what
    each actually runs.
  - `static-export.md:78-84` — "Checks to run" lists `pnpm --filter @kovojs/site run build`,
    `check:links`, `smoke:navigation`: Kovo-monorepo site scripts a reader's app doesn't have.
    Replace with reader-runnable gates: `kovo export` dry-run (no `outDir`) as the CI
    exportability check, reading the `kovo-export/v1` report / `StaticExportResult`, plus a
    generic link-checker suggestion clearly marked as third-party.
  - `queries.md` — "Run the data-plane check before you ship: `vp check`" attributes
    KV410/KV411/KV406 graph failures to the vite-plus typecheck. They come from `kovo check`.
    Replace with `kovo check` plus the graph-provenance sentence (see P1) and keep `vp check`
    only for its real job (typecheck + lint).
  - `getting-started/installation.md` — `pnpm create kovo my-app -- --dialect sqlite` refuses
    unless `--experimental-sqlite` is passed or `KOVO_EXPERIMENTAL_SQLITE=1` is set
    (`packages/create-kovo/src/index.ts:586-590,629`). Show the working command with the flag and
    label SQLite experimental where the dialect is introduced.
  - `getting-started/quickstart.md` — leads with `pnpm create kovo my-app` while its own callout
    says Kovo isn't on npm yet and tells readers to "clone the repo and work in a workspace
    member" — without ever giving those commands. Add the executable pre-v1 block inline
    (clone → `pnpm install` → scaffold/copy a workspace member → `pnpm run dev`), verified by
    actually executing it in a clean checkout; keep the npm form as the post-v1 path, clearly
    ordered.
- [ ] **Replace fabricated/stale CLI sample output with real captured output.** Rule for all
  three: run the real command against the commerce example's committed graph and paste bytes;
  never hand-compose output blocks.
  - `endpoints-webhooks.md:150-157` — the `kovo explain --endpoints` block shows invented
    positional rows (`endpoint:oauth/callback GET /auth/callback exact none:... exempt:... -`).
    Real format is key=value rows (`ENDPOINT <name> surface=endpoint ...` per
    `packages/cli/src/graph-explain-format.ts`). Capture and paste, then update the surrounding
    prose that narrates columns.
  - `security.md:255` — same disease: `UNSCOPED query:orderHistory order via user_id key
    predicate not traceable to session` vs the real `UNSCOPED QUERY <name> domain=<d> ...`
    format. Recapture both the `--unscoped` and `--endpoints` blocks.
  - `kovo-explain.md:76` — `OPTIMISTIC-SUMMARY total=3 hand-written=1 await-fragment=2
    UNHANDLED=0` omits the `derived=` and `PUNTED=` fields the CLI always emits
    (`graph-explain-format.ts:1019-1027`), so the guide's flagship copy-paste CI grep fails
    against real output. Recapture the sample and fix the CI recipe to match (assert on
    `UNHANDLED=0` with a pattern tolerant of field order/additions, and say why).
  - Durable fix: generate these output blocks at site build time from the committed commerce
    graph (a small `site/scripts/` step that runs `kovo explain` and injects the blocks, or a
    test that diffs the docs blocks against fresh output) so they cannot drift again. The
    kovo-explain review also found the "generated from the commerce app's committed graph" claim
    is currently hand-maintained fiction — this makes it true.
- [ ] **Fix spec-contradicting claims** (each: what the page says → what is normatively true →
  the replacement passage):
  - `compiler-internals.md:72-76` + frontmatter description ("how to eject a component"): says
    any component's emitted files can be checked in, the `.tsx` deleted, "nothing else in the
    toolchain knows the difference." SPEC §5.2 rule 7 (`spec/05-compiler.md:30`) forbids
    hand-authored lowered IR (KV235), and `// @kovojs-ir` is a load-bearing provenance gate —
    `isCompilerIrArtifact` (`packages/compiler/src/validate/authoring-surface.ts:206-208`)
    rejects app-authored files carrying it. Replace the ejection section with the real contract:
    emitted IR is an inspectable *artifact* (read it, diff it, verify it) but never an ownership
    path; delete the "eject" promise from the description. Also fix line 68's "informational,
    not load-bearing" claim about the marker comment — invert it and show the rejection.
  - `optimistic.md:45-48` — says queued submissions "each wait for the previous to settle before
    its transform and request fire." SPEC §10.4 (`spec/10-data-plane.md:269`) normatively
    requires the opposite for transforms: a queued mutation applies its transform immediately;
    only the network request serializes behind the queue head. Rewrite the paragraph from the
    spec sentence (quote it in the collapsed details), and make the user-visible consequence
    explicit: the UI reflects every queued submission at once, requests settle in order.
  - `optimistic.md:93-94` — says the loader snapshots "with structuredClone." SPEC §10.4
    (`spec/10-data-plane.md:263`) mandates structural sharing, not an unconditional deep copy;
    the code uses copy-on-write. Replace the mechanism sentence; keep the JsonValue safety point.
  - `islands.md:296-303` and `routing.md` — "one inline script — capped at 8KB gzip — is the
    entire always-loaded path." Stale twice: the enforced ceiling is 10,500 gzip bytes, and
    delegation/ref resolution/update-plan/query-hydration/morph responsibilities now live in a
    deferred runtime module, not the inline script. Rewrite the loader section from the current
    SPEC text and loader source; update the budget number everywhere (grep the site for `8KB`).
  - `islands.md:166-168` — "component-level clock declarations are not a shipped app-authoring
    option yet" is false: `clocks` is an accepted `component()` definition field
    (`packages/core/src/index.ts:152-153` and the allowed-keys list at :403) with compiler
    update-plan extraction. Replace the denial with a short working example
    (`clocks: { ago: { every: '30s' } }` plus the `now.*` inputs — derive exact spelling from
    core's types and an existing test/fixture) and cross-link the fuller treatment planned in P4.
  - `streaming.md:27-35` — the first `<Defer>` example never defers. ✅ `RegionPriority =
    'after-paint' | 'critical' | 'visible'` and the default is `'critical'`, which renders
    inline (`packages/server/src/deferred-region.ts:16,163-171`). Fix the smallest example to
    pass `priority="after-paint"`, then add a short "Pick a priority" subsection: `critical`
    renders in the shell (the default — say so loudly), `after-paint` streams after the shell,
    `visible` applies when the region scrolls into view (IntersectionObserver-gated).
  - `wire-protocol.md` — the delta frame example
    `<kovo-query name="cart" delta>{"items":{"upsert":[...],"removedKeys":["p2"]}}</kovo-query>`
    shows an envelope that does not exist. Real shape
    (`packages/core/src/query-delta.ts:36-41`): `{set?, lists: {<path>: {key, upsert?, remove?,
    prepend?}}}` — collections nest under `lists`, keyed by path, with `key`/`remove` (not
    `removedKeys`). Capture a real delta frame from a running example and paste it; also add the
    frame attributes every real response carries (`key`/`version`/`settles`, the `Kovo-Build`
    header) since the page's stated job is reading a trace.
  - `testing.md:96` — `await db.sql(...)`: `PgliteTestDb` has no `sql` method (surface is
    `close/exec/pglite/query/read/write`, `packages/test/src/pglite.ts:25-37`). Change to
    `db.query(...)`.
  - `testing.md:117-118` — "a write to a table whose domain the static graph doesn't list for
    that mutation fails the test" is only true when the exec is scoped with the undocumented
    `touchGraphKey` option (`assertObservedWritesCovered` →
    `selectTouchGraph(touchGraph, touchGraphKey)`). Either document `touchGraphKey` in the same
    breath or soften the claim to what the default harness checks.
  - `security.md:152` — `guard: authed()` with no import: `@kovojs/server` exports only the
    `guards` namespace (`packages/server/src/index.ts:422`), and the guide itself teaches
    `guards.authed()` twenty lines earlier. Fix to `guards.authed()` and add the import line.
  - `accessibility.md:129-141` — the closing next-step ("[Testing] — add app-level browser
    checks for your own labels, headings, and flows") points at a guide that is explicitly
    browser-free and argues against browser tests; and the cited proving file
    (`interactive-gallery.axe.browser.test.ts`) carries a fraction of the tier claims — most
    `expectNoAxeViolations` assertions live in `interactive-gallery.interactions-a/b.browser.test.ts`.
    Fix both: cite all three suites (the run command `pnpm --filter @kovojs/example-gallery run
    test:browser` is already correct), and repoint the closer at a real self-serve audit recipe
    (see P4 accessibility). `rules/accessibility-conformance.md:31-33` carries the same stale
    citation — fix it in the same commit.
  - `layouts.md` — claims `kovo explain page --layouts` output "lists the resolved layout chain,
    guards, queries, boundaries, stylesheets, and the route leaf." The actual page branch prints
    the chain, per-layout queries, and the leaf — no guards, no boundaries. Trim the claim to
    the real output (paste it), or extend the CLI first and keep the prose.

## P1 — Systemic quality passes across existing guides

- [ ] **Copy-paste-runnable samples policy, applied guide by guide.** Adopt one rule and enforce
  it everywhere: every fenced TS/TSX block either (a) compiles standalone — all imports present,
  every identifier defined in the block or a prior block on the same page — or (b) opens with a
  provenance comment naming its source file (`// examples/commerce/src/domain.ts`) and elides
  only lines marked with `// …`. No `any`-typed contexts anywhere (the framework bans them).
  - Worked example of the class of fix (queries.md): replace
    `load: async (_input, context?: { db?: any })` with the real contract —
    `QueryLoadContext<Request, Db>` whose `db` is `Reader<Db>` (write verbs removed at the type
    level, mirroring the runtime `KovoReadonlyHandleError` proxy,
    `packages/server/src/query.ts`). The `any` both lies about the API and hides the guide's own
    subject (read-only loaders).
  - Worst offenders to sweep first (each flagged by its reviewer): mutations, data-layer,
    auth-better-auth, routing (bare `authed()`/`role()` — they come from `@kovojs/better-auth`
    (`packages/better-auth`), a fact no page states; three snippets have imports, the rest none),
    queries, layouts (no imports for `layout`/`route`/`guards`; the boundary example references
    identifiers that would crash as written), request-shell, testing (`createCommerceDb`,
    `renderCartPage`, `commerceTouchGraph`, `harnessOptions` all undefined plus an
    `as unknown as KovoTestTouchGraph` cast), security (zero imports on the owner-scoped query
    block), endpoints-webhooks.
  - Acceptance: the site's compile-checked-fences gate passes with the policy tightened to
    typecheck (not just parse) if that's not already the case — investigate why non-compiling
    samples currently pass it.
- [ ] **Add a "Run it" proof moment to every guide missing one** (flagged on 15+ pages). The bar
  (`rules/docs-style.md:93-95`): a command, a View Source, or a click, plus what the reader sees
  change. Concrete recipe per page:
  - mutations: submit the form with JavaScript disabled, watch the full-page POST work; then
    re-enable and show the fetch + fragment response in the network tab.
  - queries: View Source on the rendered page, point at the `<script type="application/json"
    kovo-query>` hydration frame and the `kovo-deps`/`kovo-query` stamps.
  - routing: scaffold the route, `curl -i` it, show the 200 and the 308 trailing-slash redirect
    the guide describes.
  - islands: View Source showing the served `on:*` attribute and `kovo-state` stamps; click and
    watch the morph in the Elements panel.
  - streaming: `curl -N` the page and watch the shell arrive first, then the
    `<kovo-fragment>` chunks; contrast with `priority="critical"`.
  - wire-protocol: a devtools/network-tab walkthrough of one mutation response's frames — the
    page's whole job is reading a trace and it never shows one.
  - optimistic: two-tab demo (submit in A, watch B) or throttled-network devtools capture of
    predicted state → settle.
  - security: hit a guarded route logged-out, show the redirect/403; run one review mode and show
    a finding.
  - testing: the actual `vp test` / `pnpm test` invocation and one failure output.
  - static-export: `ls -R` of the export tree plus the `kovo-export/v1` report.
  - render-tree: one authored XML string in, the exact emitted HTML out.
  - styling: the extracted `.css` file for the page's running example, found in the build output.
  - layouts, data-layer, request-shell, accessibility: per their P0/P4 entries.
- [ ] **Add "Handle failure" sections per the guide skeleton.** Content spec per page:
  - mutations: the typed 422 (`context.fail`) rendered with `<FormError>`/`<FieldError>` from
    `@kovojs/core`; success redirect (`defaultRedirectTo`, typed `redirect('/path/:id',
    { params })`) for POST-redirect-GET.
  - streaming: `<Defer timeoutMs>` (default 30s) and the `state="error"` placeholder
    re-emission — show what the user sees.
  - queries: what a failing loader renders; the KV410/KV411 diagnostics with recourse
    (`output` + `reads`).
  - static-export: the KV229 non-exportable-route error verbatim, and `--skip-non-exportable`.
  - endpoints-webhooks: `context.fail(code, payload, { status, retryAfter })`, rollback
    semantics, the fixed 401/400 verifier failures, replay-conflict behavior.
  - live-queries: what happens on delta-miss/build-skew (full refetch over `/_q/`), session
    change (channel dropped).
  - postgres-authz-policy: `KV433_AUTHZ_POLICY_UNSUPPORTED` at provision time — the feature's
    main failure mode, currently absent.
  - auth-better-auth: `INVALID_CREDENTIALS` → form error binding (see P0 rewrite).
- [ ] **Document graph.json provenance once; link it everywhere it's assumed.** Canonical
  paragraph to write (verify paths against `packages/cli/src/commands/build-export.ts:333,513`
  and the discovery order in the check/explain command source):
  > Every `kovo check` and `kovo explain` invocation reads an extracted graph artifact.
  > `kovo build` writes it to `dist/.kovo/graph.json`. With no path argument the CLI looks for
  > `graph.json`, then `.kovo/graph.json`, then `dist/.kovo/graph.json`, working up from the
  > current directory — a bare `kovo check` in a fresh clone passes vacuously because there is
  > no graph yet. Build first, or pass the path explicitly.
  Link/inline it in: cli.md (its absence makes bare `kovo check` look like a no-op full check),
  kovo-explain.md (every command takes `graph.json` and the page never says where it comes
  from — flagged HIGH), dataflow-devtool.md (same, plus `buildBundle({ graph })` needs a real
  path), testing.md (where the committed touch graph comes from).
- [ ] ✅ **Cross-link the generated API reference.** It exists (`site/scripts/api-ref.mjs` renders
  `/api/<slug>/`, nav-linked at `site/src/document-template.tsx:139`) but no guide points into
  it. Minimum links: cli.md → `/api/cli/` ("full flag reference"); every guide's collapsed
  details → its package's `/api/` page; components.md → the ui/headless-ui pages. While there,
  add the one-sentence note that `--help`/`-h` works on every `kovo` command
  (`packages/cli/src/commands-manifest.ts:864`) — currently undocumented.

## P2 — Missing guides (coverage gaps), ranked

Each entry is a full outline an implementer can write from. All follow the guide skeleton;
"Sections" lists the verb-headed H2s in order. Verify every named export against the package
index before writing (evidence lines given).

- [ ] **File uploads & blob storage** — `tutorial/04-mutations.md:87` already promises "the
  mutations guide covers guards, file uploads, and response headers"; none exists anywhere.
  Exports: `createFileSystemStorage`/`createMemoryStorage`/`createS3CompatibleStorage`
  (`packages/core/src/index.ts`, re-exported from server), `s.file()`, storage download
  endpoint shown once in security.md's checklist (`createStorageDownloadEndpoint`).
  - Frontmatter: title "File uploads & storage"; description "Accept a file from a form, store
    it, and serve it back with a scoped download URL."
  - Sections: **Accept a file** (add `s.file()` to a mutation input; the compiler derives
    `enctype="multipart/form-data"` on the no-JS form — show the served form HTML) →
    **Store it** (`createFileSystemStorage` for dev, swap to `createS3CompatibleStorage` in
    prod, `createMemoryStorage` in tests — one running example: avatar upload) → **Run it**
    (upload, `ls` the storage dir / list the bucket) → **Serve it back**
    (`createStorageDownloadEndpoint` + capability URL via `ctx.signUrl`; why raw static serving
    is wrong for user content) → **Limit it** (size/type validation on the schema; interaction
    with request-shell body limits) → **Handle failure** (validation failure → field error;
    storage errors) → Next: mutations, security (capability URLs).
- [ ] **Background tasks & scheduling** — SPEC §9.6 fully shipped, zero site coverage, flagged
  by 4 of 6 sweeps. Exports: `task` (`packages/server/src/index.ts:270`; `task.ts`,
  `task-runner.ts`), `request.schedule()`/`request.cancel()`, `TaskScheduleOptions` with
  debounce/throttle keys, `TaskCronCatchUp`, `createDurableTaskStatus`,
  `createDurableTaskSqlExecutor`; CLI: `kovo explain task <target>`, `kovo explain --tasks`
  (`packages/cli/src/commands-manifest.ts:29,33,494-496`).
  - Frontmatter: title "Background tasks"; description "Send the email after the order commits —
    durable, retried, and visible in the graph."
  - Sections: **Define a task** (`task({ input, handler })` — smallest: send-welcome-email) →
    **Schedule it from a mutation** (`request.schedule()` — lead with the headline guarantee:
    scheduling is transactional with the mutation commit; if the write rolls back, the task never
    runs) → **Run it** (the dev runner; where task execution logs appear) → **Coalesce bursts**
    (debounce/throttle keys — the keyed-job default semantics per SPEC §9.6) → **Run on a
    schedule** (cron + catch-up policy) → **Deploy the runner** (JobRunner capability in the
    deploy presets; `createDurableTaskSqlExecutor`/`createDurableTaskStatus` for status) →
    **Inspect it** (`kovo explain task <key>`, `--tasks` — real output) → **Handle failure**
    (retries, cancellation via `request.cancel()`) → Next: deployment, endpoints-webhooks.
- [ ] **Configuration & environment reference** — no page enumerates any of the 25+ `KOVO_*`
  vars or the boot-validation contract. Source of truth: `packages/server/src/env.ts`
  (`validateAppEnv`, `resolveBootMode`, `committedSecretWaiver`,
  `FRAMEWORK_SECRET_MIN_ENTROPY_BITS`); grep `KOVO_` across packages for the full inventory.
  Reference-mode page (density fine per docs-style), but still opens with the smallest use:
  - Sections: **Validate your env at boot** (`createApp({ env: s.object({...}) })` — typed
    access, and the payoff: production boot *refuses* with a typed `CreateAppBootError` instead
    of failing at first request) → **Boot modes** (dev vs production posture differences) →
    **Secret rules** (entropy floor, committed-secret detection and the waiver escape hatch) →
    **Variable reference** (generated or hand-maintained table: name, consumer package, default,
    effect — database URLs/roles/driver, CSRF secret, data dir, CSP report endpoint, deploy
    knobs, `KOVO_EXPERIMENTAL_SQLITE`, `KOVO_DEVTOOL_BASE`, …). Strongly consider generating the
    table from source the way `/api/` is generated, so it can't drift.
- [ ] **Database lifecycle: create, migrate, seed** — all four data-backed examples hand-roll
  the same bootstrap; today's only coverage is a cli.md subsection. Sources:
  `packages/cli/src/commands/db.ts` (`check|generate|migrate|provision`,
  `KOVO_ADMIN_DATABASE_URL`, `generatedMigrationSequence`, `--reader-role`/`--writer-role`
  defaults `kovo_reader`/`kovo_writer`, `--database-url` precedence incl.
  `KOVO_RUNTIME_DATABASE_URL`); seeding patterns in `examples/commerce/src/db.ts`
  (`SCHEMA_DDL` + `SEED_PRODUCTS`), `examples/crm/src/db.ts` + `demo-data.ts`.
  - Sections: **Start with PGlite** (the zero-setup dev default; where the data dir lives) →
    **Define the schema** (Drizzle tables + `kovo({...})` classification, linking data-layer) →
    **Seed dev data** (the exec-DDL + insert pattern from the examples, generalized) →
    **Generate and run migrations** (`kovo db generate` → migration sequence → `kovo db
    migrate`) → **Move to Postgres** (connection URLs, `kovo db provision` role setup, admin URL
    handling, reader/writer role adoption and why two roles exist — link
    postgres-authz-policy) → **Check the posture** (`kovo db check`, real output) → **Handle
    failure** (provision failures, KV433 family) → Next: postgres-authz-policy, deployment.
- [ ] **Error handling** — one page unifying the story currently fragmented across four guides
  (layouts "Render segment failures", request-shell "Documents and error shells", mutations
  typed failures, routing `notFound()`), plus the pieces documented nowhere:
  `<ErrorBoundary fallback={...}>` from `@kovojs/core` (used at
  `examples/commerce/src/app.tsx:89-91`, zero site mentions), `errorBoundary()` fragment wrapper
  (`packages/server/src/mutation/`), `createApp({ onError })` `ServerErrorHandler`
  (`app-types.ts:279`), and the failure wire postures beyond 422: 401 with `Kovo-Reauth`
  directive, 403 unauthorized code, 500 `RENDER_ERROR` (SPEC §9.2, `spec/09-wire-protocol.md:97-115`).
  - Sections: **Wrap a region** (ErrorBoundary around a query-backed region; commerce's
    ProductGridError as the running example) → **Run it** (make the loader throw, see the
    fallback) → **Handle mutation failures** (recap typed 422 → link mutations; then the 401
    `Kovo-Reauth` re-auth flow and 403/500 postures — what the browser runtime does with each) →
    **Render segment failures** (route/layout boundaries + status semantics table: guard failure
    → 403 boundary, `notFound()` → 404, throw → 500) → **Own the error shells**
    (`ErrorShellRenderer`, a minimal custom 404; the default's no-internals guarantee) →
    **Observe errors in production** (`createApp({ onError })`; link observability when it
    exists) → Next. Existing guides then link here instead of re-explaining.
- [ ] **Caching** — the first question a Next.js-trained evaluator asks; Kovo has a distinctive
  normative answer and no page. Sources: SPEC §9 caching contract
  (`spec/09-wire-protocol.md:~87,~145`), typed `cacheControl` allowlist (KV415),
  `spec/07-navigation.md:34` (bfcache posture), `QueryReadConfig.read.cacheControl`
  (`packages/server/src/query.ts:47-50`), immutable `/c/__v/<version>` module URLs + deploy
  retention.
  - Sections: **What's cached by default** (the honest defaults: session-dependent documents
    forced `no-store`; `/_q` reads pinned `private,no-store` + `Vary: Cookie`; immutable hashed
    `/c/` modules) → **Cache a public read** (`read: { cacheControl }` on a query — the typed
    allowlist and why arbitrary header strings are rejected, KV415) → **Run it** (curl the
    headers before/after) → **Navigation & bfcache** (what back/forward restores) → **Deploys**
    (old `/c/__v/` versions retained so long-lived documents keep working; the retention knob) →
    **Handle failure** (KV415 diagnostic) → collapsed details: SPEC §§.
- [ ] **Pagination** (recipe or a queries.md major section) — commerce ships the complete
  first-class pattern, no guide teaches it: cursor query (`after`/`limit`/`nextCursor`,
  `examples/commerce/src/queries.ts` productGridQuery), keyed items (`kovo-key={item.id}`),
  `data-page-cursor` threading, and per-key `delta: [{ domain: order.key, key: 'id', path:
  'items' }]` declarations so one new row ships as a delta instead of a full list. Walk the
  commerce implementation end-to-end with provenance comments; show the wire (a `lists` delta
  frame) as the payoff.
- [ ] **Confidential values** — core to the framework pitch ("secrets can't reach the browser");
  only the drizzle column tag appears (conceptually) in why-kovo.md. Exports
  (`packages/core/src/index.ts`): `secret`, `redacted`, `untrusted`, `revealSecret`,
  `revealRedacted`, `revealUntrusted`, `trustedReveal`, `publishToClient`, `declareOffWire`,
  plus `encryptAtRest` and key rings.
  - Sections: **Mark a value** (wrap an API key with `secret()`; show the compile/serialization
    failure when it heads for the wire — the payoff *is* the error) → **Reveal it at the sink**
    (`revealSecret` at the point of use; why reveal is explicit) → **Classify user input**
    (`untrusted()` and where the framework forces handling) → **Column-level secrets** (the
    drizzle `kovo({ secret: [...] })` tag — connect to data-layer) → **Encrypt at rest**
    (`encryptAtRest`, key rings) → **Handle failure** (the off-wire diagnostics) → collapsed
    spec pointers.
- [ ] **Outbound requests & egress** — anyone calling Stripe/OpenAI/email hits the fail-closed
  egress floor immediately; today one prose mention in security.md. Exports:
  `EgressBlockedError`, `EgressConfigError`, `EgressOptions`, `PrivateAddressClass`
  (`packages/server/src/index.ts:70-71`, `packages/server/src/egress.ts`).
  - Sections: **Call a third-party API** (`ctx.fetch` from a handler; the smallest allowlist
    config naming `api.stripe.com`) → **Run it** (and the before-state: the exact
    `EgressBlockedError` you get with no allowlist — lead with this, it's what readers will hit
    first) → **Scope the allowlist** (per-host patterns, `PrivateAddressClass`/SSRF posture —
    why private ranges are blocked even when allowlisted) → **Handle failure**
    (`EgressBlockedError` vs `EgressConfigError`) → Next: security, endpoints-webhooks.
- [ ] **Composing primitives** — accessibility.md tells authors to build on headless primitives;
  nothing teaches how. Source: SPEC §4.6 (`spec/04-component-model.md:237-279`) with its
  normative merge-rule table; implemented in `packages/compiler/src/attribute-merge*`.
  - Sections: **Attach behavior to your element** (the attrs-function child spelling — one
    primitive, one custom trigger) → **Use asChild** (the sugar form and when it's identical) →
    **Behavior attributes** (`kovo-tooltip`-style attach-by-attribute) → **What merging does**
    (the per-attribute-class rules in a table: `class`/`style` concatenate, handlers chain,
    ARIA/role conflicts fail the build with their KV codes — reproduce the table from SPEC §4.6,
    cite it as the authority) → **Handle failure** (the conflict diagnostics) → Next:
    components, accessibility.
- [ ] **Medium-priority new-guide backlog** (promote to its own checkbox with an outline when
  picked up):
  - Roll-your-own credential auth: `hashPassword`/`verifyPassword`/`verifyCredential`/
    `isArgon2idPasswordDigest`/`PASSWORD_ARGON2ID_DEFAULTS` (server index) + `session()`
    provider without Better Auth — the "email+password without a dependency" path.
  - i18n catalogs: `i18n()`/`t()` (`packages/server/src/meta.ts:80-107`), route-level
    `i18n:` attachment, placeholder messages (`'{count} in stock'`) — commerce is the worked
    example (`examples/commerce/src/domain.ts:297-302`).
  - Safe subprocess: `cmd`/`commandAllowlist`/`runCommand` (`packages/server/src/command.ts`) —
    fail-closed allowlist; the ffmpeg/image-resize framing.
  - Drizzle escape hatches: `compareAndSet` (optimistic concurrency; pairs with
    StaleVersionError in optimistic.md) and `staticSql` vs `trustedSql`
    (`packages/drizzle/src/runtime.ts`).
  - Login-flow UX: sanitized `?next=` redirect + session-conditional rendering, from
    `examples/commerce/src/app.tsx:131-147`.
  - Vite/build config: `kovo({ app })` plugin options (`@kovojs/server/vite`),
    `build.manifest: true` + styles input, hashed-asset resolution (stackoverflow example
    hand-rolls ~85 lines of this — the guide should make that unnecessary or explain it).
  - Production observability: `kovoSecurityReportSnapshot` (`packages/server/src/reporting.ts`),
    durable-task status, `KOVO_CSP_REPORT_ENDPOINT` CSP violation reporting.
  - Static assets/images/fonts posture: where files live, hashing, `_headers`, and an honest
    "no image optimizer" statement if that's the answer.
  - Dev HMR contract: SPEC §9.5.1 — what a patch preserves vs resets (island state, queries,
    styles); zero site coverage of the tool authors use all day.
  - `kovo-key` runtime identity: SPEC §13.2 — when the compiler derives it, when authors must
    supply it, morph-vs-clobber consequences.

## P3 — Agent-reader infrastructure

The agent layer is unusually complete (llms.txt index, 2.17MB llms-full.txt corpus with SPEC
appended, per-page .md mirrors at `<route>.md`, `kovo update-docs` app-local mirror,
compile-checked fences, link-check gate). Remaining gaps are ergonomics:

- [ ] Advertise each page's .md mirror from its HTML: add `<link rel="alternate"
  type="text/markdown" href="<route>.md">` to the head in `site/src/document-template.tsx` and a
  visible "View as Markdown" link near the title/footer. Today an agent on
  `/guides/routing/` must fetch and parse all of `/llms.txt` to discover the mirror convention.
  Match the exact mirror path emitted by `site/scripts/llms.mjs` / `site/src/aux.ts`.
- [ ] Emit context-budget-sized llms tiers from `site/scripts/llms.mjs`: e.g. `llms-guides.txt`
  (guides + getting-started + tutorial, no SPEC) and `llms-api.txt`; list the tiers with byte
  sizes in `llms.txt`. Today the only options are the 17KB index and the 2.17MB everything-file
  (~550K tokens — bigger than most agent contexts, and it embeds the 286KB SPEC).
- [ ] Add `_headers` entries for the agent files: content-type `text/markdown; charset=utf-8`
  (or text/plain for .txt), `X-Content-Type-Options: nosniff`, and a cache policy for
  `/llms*.txt`, `/spec.md`, and the `/**/*.md` mirrors. Currently safe only because
  `serve-static.mjs` hardcodes the type; any `_headers`-honoring host serves them untyped.
- [ ] Add `robots.txt` (with a `Sitemap:` line and a comment pointing at `/llms.txt` and
  `/llms-full.txt`) and `sitemap.xml`, emitted from `site/src/aux.ts` alongside the existing
  artifacts. Discovery currently rests on one footer link plus community convention.
- [ ] Stamp llms artifacts with a version line (`Version: @kovojs <ver> (<commit>)`) passed into
  the build — `llms.mjs` is deliberately deterministic, so thread the value in as an input
  rather than reading git at emit time. Lets an agent tell whether its cached corpus matches the
  installed framework.
- [ ] Snippet provenance for reference-app symbols (same rule as P1 item 1; the agent sweep hit
  it independently: testing.md/routing.md snippets lean on undefined commerce symbols with no
  file pointer, forcing exactly the guessing the mirrors otherwise eliminate).

## P4 — Per-guide enrichment backlog (top adds per page)

Highest-value missing subtopics, each verified against code by the reviewer; expand into
checkboxes when a page is picked up. Format: what to add — the API/contract — where it lives.

- **mutations**: guards as the KV436 access decision (`guards.all`, `guards.rateLimit`,
  `guards.authed`) with one production example; success redirects (`defaultRedirectTo`, typed
  `redirect()` params) for POST-redirect-GET; rendering failures with
  `<FormError>`/`<FieldError>` from `@kovojs/core`; `s.file()` uploads (or link the P2 guide);
  `context.setCookie` + `MutationSuccess.responseHeaders`; idempotency-token replay +
  `StaleVersionError`/compare-and-set for KV429 conflicts. (The tutorial's ch.4 handoff promises
  guards/uploads/headers are "covered in the mutations guide" — make that true.)
- **queries**: parameterized queries (`args` schema + binding component props via the callable
  args binding); `guard:` on a query for session-scoped reads; `output` + `reads:` declarations
  for opaque `sql<T>` projections — the KV410/KV411 recourse the guide warns about but never
  shows; the JsonValue boundary (no Date/Map/class instances — show the type error);
  `read: { cacheControl }` (link P2 caching); how a query refreshes outside a mutation
  (`/_q/<query-key>` + `Kovo-Build` stale detection).
- **routing**: how `RouteRegistry` is populated so `<Link to>`/`href()`/`redirect()` type-check
  (generated registry `.d.ts` — name-dropped, never explained); the app-scoped route factory
  (typing `request` contextually from `createApp()` instead of inline `as` assertions — the
  guide currently teaches the unsafe cast); `staticPaths` (used in its own first example,
  unexplained); an actual `href()` demo under the heading that promises one;
  `onUnauthenticated` route override; `prerenderUrls` hint.
- **islands**: declared clocks (`clocks: { ago: { every: '30s' } }`, `now.*` inputs, `at`/
  `until`/`renderOnce` cadences); per-element params (`data-p-*` from render → typed
  `ctx.params` — the list-item handler pattern, asserted but never demonstrated); what
  `isomorphic: true` actually does and costs (offered twice as a KV420/KV311 fix, never
  explained); `renderOnce` being compiler-recognized *by name* — state it as the contract;
  unit-testing handlers/derives as plain functions.
- **streaming**: the authoring API for streaming mutations — `mutation({ stream: (ctx) => ... })`
  (`packages/server/src/mutation/definition.ts:325-327`) with `stream.text/fragment/query/done`
  helpers; the wire is currently shown with no way to produce it. Also: priority ladder (P0),
  rich stream renderers (`data-stream-renderer module#export` + escaped-text/`trustedHtml`
  KV236 sink contract), nested deferred regions, CSP interaction (the stream's inline
  apply/cleanup scripts are hash-listed — custom strict CSPs must include them).
- **testing**: the three undocumented public subpaths — `@kovojs/test/html-fragment`
  (`htmlFormFacts`, `htmlFormFieldsByName`, `htmlLinkHrefs`, `kovoQueryJson`… — the guide
  currently teaches `toContain` string matching while these exist), `@kovojs/test/headers`
  (`enhancedMutationHeaders`, `setCookieValues` — Set-Cookie is exactly what naive header
  matching gets wrong), `@kovojs/test/sqlite` (`createSqliteTestDb`); `harness.query()` and the
  `{ reads, render }` page-fixture form; per-exec `touchGraphKey` and `csrf` options; update the
  stale "zero app-level browser tests" claim (commerce now ships
  `enhanced-navigation.test.ts`, Playwright + axe).
- **security**: `guards.owns(keyOf, ownsRow)` — the built-in ownership guard that discharges the
  KV414 IDOR obligation; `kovo explain --capabilities` (audit mode for `ctx.signUrl` mints —
  the guide's capability section points at `--sources-sinks` instead); denial-UX knobs
  (`onUnauthenticated`/`renderForbidden`/`loginPath` + sanitized `next`); `trustedProxy`/
  `clientIp` as the prerequisite for per-IP rate limits; app-level `createApp({ csrf })`
  inheritance + `mintCsrfField`/`mintCsrfToken`; `ctx.actAs`/`rawRead` contracts. Also fix (from
  review): the rate-limit failure modes are throw-not-degrade for per-IP/unproven-session
  keying; the CSRF field-name paragraph contradicts its own example; delete the duplicated
  prompt-injection disclaimer above the fold.
- **deployment**: `trustedProxy`/`origin` for anything behind a load balancer (silently mis-keys
  rate limits today — the guide never mentions it); the node preset already emits `server.mjs`,
  a runtime package.json, and a Dockerfile — stop hand-rolling a divergent one, document the
  emitted artifact; per-instance in-memory replay store caveat in the statelessness section;
  task-runner deploys (link P2 tasks); adapter response compression (`compression: false`);
  an actual rollback walkthrough (the guide asserts "rollbacks are boring" and never shows one);
  Vercel/Cloudflare preset deploy shapes; boot-time env validation (link P2 config).
- **cli / kovo-explain**: `kovo build --check` (validate-only: tsc + kovo-check + full compiler
  diagnostics, no emit — the CI gate authors ask for most) and `--no-cache`
  (`commands-manifest.ts:55-56,574-579`); `kovo audit [--fail-on-findings]` (the one-command
  aggregate of the review modes); `kovo check <family>` selectors
  (optimistic|coverage|endpoint-posture|sources-sinks); `kovo mcp`'s four tools by name
  (`compile_component`, `kovo_check`, `kovo_explain`, `list_diagnostics`,
  `packages/cli/src/commands/mcp.ts:415-430`) plus an `.mcp.json` registration snippet;
  `kovo export` asset flags (`--manifest`/`--dist`/`--asset-base`/`--stylesheet-env` — the
  manifest even ships the example invocation); `kovo db` flag/env precedence
  (`--database-url` > `KOVO_RUNTIME_DATABASE_URL`…, `--reader-role`/`--writer-role`); exit-code
  contract table for CI; `kovo explain context <target>` example (listed, never shown);
  `--trust` mode; the `derived=`/`PUNTED=` summary fields (P0).
- **components**: fix the copied-component example importing from `@kovojs/ui` — it violates the
  copy-in dependency contract stated in the same section; fix the SelectTrigger example dropping
  `role`/`type` that the builder emits (`packages/headless-ui/src/primitives/select.ts:560-562`)
  while telling readers to spread the builder output; add: a catalog answer (44 registry
  components, no list or gallery link anywhere), re-running `kovo add` (skip vs
  would-overwrite), `passThroughProps` forwarding, one complete multi-part assembly
  (Select from Trigger/Content/Item with `SelectStateProps` explained — the state-snapshot
  contract confuses every reader who meets `itemValue` vs `value`), `@kovojs/icons` in the
  dependency story, and `kovo add`'s machine-readable `kovo-add/v1` output.
- **styling**: drop the invented `failureStylesheets` mutation option (P0-adjacent:
  `MutationDefinition` has no such field — it's an app-level `mutationResponses` policy; show
  the real spelling); stop naming `@internal` `stylesheetsForTargets` as usable API; add:
  `style.defineVars`/`style.createTheme` (public, unmentioned), critical-CSS delivery options
  (`stylesheet()`'s `criticalCss`, `criticalCssTheme`, `deferFull…`), dark mode
  (`defineTheme`'s `selector`/`darkSelector` + the default root selector), app-wide
  `createApp({ stylesheets })` inheritance, the `[Style, inlineRecord]` tuple / `attrs()` helper
  for dynamic values, real mechanics for the "co-located raw CSS" section (currently
  unactionable), and a Run it (find the extracted CSS in the build).
- **accessibility**: keyboard-interaction proofs — roving tabindex, arrow-key nav, focus
  trap/return are *already proven* by the interactions suites but never claimed (axe can't test
  keyboard; this is the strongest evidence on the shelf); a "what axe-clean does not prove"
  honesty section (contrast under custom themes, screen readers, focus order); a self-serve
  audit recipe (render a route with the `@kovojs/test` page harness into a Vitest browser test,
  run axe-core — becomes the fixed closing link, P0); reduced-motion behavior shipped by
  accordion/disclosure/collapsible; live-region guidance (toast wires `aria-live=polite`; when
  app code should announce after mutations); fix the Select example's silent form-submission
  drop (add `SelectHiddenInput` + `name` like the real gallery demo).
- **live-queries**: `queryRef(key, { refetchOnFocus: false })` — the one shipped authoring API
  in this feature area, undocumented site-wide; a two-tab Run-it walkthrough (submit in A, watch
  B, observe the `/_q/` read on focus in devtools); session-change/anonymous-tab fingerprint
  behavior; delta-miss/build-skew → full refetch recovery; the `<meta name="kovo-session">` /
  `<meta name="kovo-build">` inspection points; label the wire sample as dev-shaped (prod ships
  deltas); un-hedge "the loader may rebroadcast" (it's default-on).
- **wire-protocol**: error vocabulary (422 form-scoped fragments, 401 `Kovo-Reauth`, 403, 500
  `RENDER_ERROR`/`IDEMPOTENCY…`) — a debugging page with no failure frames; frame attributes +
  mandatory `Kovo-Build` header (P0); `<kovo-done>` termination and what an interrupted stream
  looks like; `mode="prepend"` + scroll-anchor guarantee and the pagination delta; initial-page
  hydration frames (`<script type="application/json" kovo-query>`) and their different escaping;
  promote `kovo explain` frame reconstruction out of the collapsed details.
- **request-shell**: state that request limits are ON by default with the concrete budgets
  (1 MiB body, 100 list items, 60s windows) and how to disable; `trustedProxy: true` +
  `clientIp` extractor (`app-load-shed.ts:445-477`) — the per-IP limiter silently mis-keys
  behind any LB; a minimal `ErrorShellRenderer` 404 example (readers must currently guess what
  `NotFoundShell` is); `mutationReplayStore` (starter wires it; SPEC §9.1/§10.3); `onError`;
  fix the `document.template` claim that flatly contradicts the SPEC section it cites; de-noun
  the densest paragraphs per the voice rule.
- **endpoints-webhooks**: the `WebhookReplayStore` interface (atomic reserve/commit/abort) +
  `createMemoryWebhookReplayStore`; the webhook `transaction` wrapper
  (`WebhookTransactionContext`); `endpoint({ db: true })` + `ctx.actAs(principalId)` for
  owner-scoped endpoint DB access; verifier surface beyond the one preset shown
  (`standardWebhooks({ secret })`, `customVerifier()`, `verify: 'none'` +
  `verifyJustification`); prefix mounts + `mountJustification`; note the `hmacSignature` sample
  silently timestamp-binds the payload (either explain or simplify); show the registration path.
- **optimistic**: keyed query-instance transforms (`{ keys, transform }` entry form — routes a
  prediction to one instance store; missing entirely); queue failure semantics (head-of-line
  timeout/abort, rollback of the failed head, re-validation of queued survivors);
  settlement-before-rebase (server-truth chunks settle pending transforms by idempotency-token
  membership); derived transforms as omittable map keys; show KV313 in the main text (it's the
  diagnostic the whole page orbits, currently buried in details); show a real
  `OPTIMISTIC-PROOF`/`OPTIMISTIC-PUNT` line; fix the map-key naming issue (bare identifiers
  won't match compiler-derived query names — flagged medium in review).
- **postgres-authz-policy**: `kovo.principal` provenance (`principalFromRequest`, the per-request
  GUC set by the runtime, NULL/unauthenticated behavior); predicate constraints (no bound
  params, sql-tag-only values) and `KV433_AUTHZ_POLICY_UNSUPPORTED` (P1 failure section); the
  string-justification `authzPolicy` variant and its weaker posture; the coexisting
  `kovo_system_scope`/`kovo_admin_scope` policies (`crossOwnerRead`); reproducing scoped reads
  locally (`--driver pglite`, or `SET ROLE` + `set_config` in psql, or a `@kovojs/test`
  recipe — fixes the unreproducible "check member and non-member behavior" section); the
  one-FOR-ALL-predicate limitation in "Know the boundary".
- **render-tree**: the Run-it (P1: one authored `<kovo-…>` XML string → the exact emitted HTML);
  interactivity contract for registered components (server-rendered once, handlers lazy-load via
  the §4.4 loader, isomorphic restriction); non-string attribute coercion via the schema
  (`s.number().default()`, boolean attrs parsing as empty string); bare-component registry
  shorthand; `renderTree` accepting a single node; `parseComponentXml` behavior on
  comments/PIs/CDATA; fix `safeRichHtml` mischaracterization ("explicit sanitizer") and the
  `slots: { children?: any }` in the first sample.
- **static-export**: asset wiring (`assets`/`publicAssetRoot`/`publicAssetBase` options and CLI
  `--manifest`/`--dist` — the direct-API example currently produces documents with missing
  CSS); the `_headers` sidecar (which hosts consume it: Netlify/Cloudflare Pages; how to
  replicate its security + immutable-cache policy elsewhere); SRI on exported module refs (and
  the don't-edit-files-after-export consequence); dry-run as a CI gate + reading
  `StaticExportResult`; one concrete `staticPaths` example; define L0/L1 at first use; the
  successful-export output tree (P1 Run it).
- **layouts**: layout-declared stylesheets/head hints (`LayoutDefinition extends
  PageHintOptions`); the payoff of layout queries (layouts become live targets, `kovo-layout-N`
  stamps); render-less guard-only segments (`render` optional); the boundary status table
  (shared with the P2 error-handling guide); `access` posture on layouts; explain what the
  `state: undefined` second render arg is and why v1 authors ignore it.
- **compiler-internals**: platform-behavior emission (SPEC §5.2 rule 4 — handlers proven
  equivalent to native dialog/popover/details are replaced, not shipped); the render-plan
  version token (`/c/__v/<version>` shown in the page's own capture, unexplained); contextual
  output escaping in the emitted module (`escapeText`, KV236); the full artifact set
  (`generated/touch-graph.ts`, `generated/optimistic/*.ts`, per-component `.css`); the prod
  `mergeClientModules` exception to 1:1 mapping; how to reproduce a lowering locally
  (`kovo compile component` — the flow the page's own captures use).
- **dataflow-devtool**: graph JSON provenance (P1); a real `kovo_explain` card sample (the
  `kovo-explain/v1` text with queries-in/mutations-out); MCP client wiring (an `mcpServers`
  stanza); multi-app `--graph/--src/--label` groups + `--blurb`; `createDevtoolApp`'s
  `base`/`KOVO_DEVTOOL_BASE` and `requestHandler` surface; and settle the framing question:
  this is a public guide for a private package — either publish the package, or mark the guide
  clearly as a repo-internal tool tour.

## Verification notes

- ✅ Re-verified by hand this session: KV330 posture (`packages/compiler/src/direct-db.test.ts:11`;
  canonical extraction in `examples/commerce/src/domain.ts:240-275`); `domain()` signature
  (`packages/server/src/domain.ts:26-30`); `RegionPriority`/`'critical'` default
  (`packages/server/src/deferred-region.ts:16,40-41`); scaffold scripts
  (`packages/create-kovo/templates/package.json:5-14`); API reference existence
  (`site/scripts/api-ref.mjs`, `site/src/document-template.tsx:139`).
- All other file:line citations come from the review agents (each read the cited source); treat
  as high-confidence leads and re-confirm the exact lines when editing. Target code samples in
  this plan are drafted from that evidence — compile them (and run every command) before they
  land in a published page; the site's compile-checked fences and link-check must pass.
- Two sweeps disagreed on API-reference absence; resolved in favor of "exists, under-linked"
  (evidence above). The framework-comparison sweep's "no API reference" item was dropped.
- Full per-guide review detail (per-issue prose beyond what's inlined here) survives in the
  workflow journal referenced in the header; consult it if an item's rationale needs more
  context than this ledger carries.
