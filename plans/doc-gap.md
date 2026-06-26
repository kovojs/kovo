# Documentation Gap & Style Remediation

Active plan ledger for closing gaps in Kovo's **authored docs** (`site/content/**`) and
**generated reference** (`site/gen/**`), and bringing every authored page into conformance with
`rules/docs-style.md`. Authority order is unchanged: behavior follows `SPEC.md`; this plan only
changes docs to match shipped source/SPEC (or flags where source/SPEC must decide first).

## How this was produced (2026-06-25)

Two adversarially-verified audits over the doc surface (`site/content/` = 6 getting-started + 8
tutorial + 23 guides; `site/gen/api/` = 12 package references; `site/gen/reference/diagnostics.md`):

- **Content audit** — 8 finder slices → dedup → per-finding verify. 54 raw → 47 canonical →
  **45 confirmed, 2 rejected**. Severity mix: 6 high · 25 medium · 14 low.
- **Docs-style audit** — graded all 37 authored pages against `rules/docs-style.md`'s 6 failure
  signs. Grades **A:8 B:19 C:7 D:3 F:0**. Root defect: openers lead with framework mechanism, not
  the reader's job (F6 24/37, F2 16/37, F1 11/37).

Each item below carries `[severity·effort]` and one evidence pointer. IDs (`DG-NN`) are stable for
traceability. Mark `- [x]` only when the exact fix is shipped and re-verified.

### Latest verification (reproduce the machine-checkable signals)

- Undocumented diagnostics: `comm -23 <(grep -rhoE 'KV[0-9]{3}' packages/*/src | sort -u) <(grep -oE 'KV[0-9]{3}' site/gen/reference/diagnostics.md | sort -u)` → `KV229 KV313 KV999`.
- Undocumented API prose: `node -e` over `site/gen/api/*.sidebar.json` `documented:false` → ui 458/460, headless-ui 777/880; all other packages 0.
- Missing READMEs: only `packages/icons/README.md` exists among 12 npm-public packages.
- Regen is clean (no committed drift): `cd site && npm run content` then `git diff --stat site/gen` → empty (gen/ is gitignored, reproducibly built).

### Verified non-issues (checked, do not re-file)

- `reads:`/KV410 read-side escape **is** documented (mental-model.md:26-34, security.md:143, testing.md:143); queries.md:261 "no tag lists" is not a contradiction. (was DG-14)
- `kovo build --preset vercel`/`cloudflare` **are** implemented and tested (server/src/build.ts:164/192); cli.md is correct, the `commands-manifest.ts` "fail loudly" string is the stale one. (was DG-29)

---

## P0 — Highest priority (correctness-breaking or security-relevant)

- [ ] **DG-03** [high·md] `guides/live-queries.md` documents an **unshipped** SSE API as if it works — `live: true`, `<kovo-live>`, `redisLiveEmitter`/`inProcessLiveEmitter`, `createApp({ live })`. Every sample fails `tsc`. _Evidence:_ core/src/index.ts:253-256 ("`live:true` intentionally NOT part of config; `<kovo-live>` unimplemented"); plans/capability-gaps.md §5. _Fix:_ gate behind a "Roadmap — not in technical preview" banner or rewrite to the shipping liveness paths (mutation responses, BroadcastChannel, refetch-on-focus); mirror the caveat in deployment.md:21-29. **Blocked on decision D1.**
- [ ] **DG-04** [high·sm] `rateLimit per:'ip'` scope (and the `per:'session'`-collapses-anonymous footgun the runtime itself warns about) is undocumented site-wide. _Evidence:_ guards.ts:320 (`per?: 'global'|'session'|'ip'`), :820-829 (M3 warning); security.md:57 lists only session|global; `grep "per: 'ip'" site/content` empty. _Fix:_ add `'ip'` to security.md:57, document `req.clientIp`, add the M3 anonymous-throttling caveat, cross-ref mutations.md.
- [ ] **DG-05** [high·md] **KV229** (static-export non-exportable, error-level) is absent from the diagnostics catalog though 4 guides link readers to it. _Evidence:_ `grep -c KV229 site/gen/reference/diagnostics.md` = 0 (jumps KV228→KV230); inbound links static-export.md:24, cli.md:187, routing.md:296, deployment.md:116. _Fix:_ register KV229 in `packages/core/src/diagnostics.ts` (root cause = **DG-24**).
- [ ] **DG-02** [high·sm] `guides/styling.md` teaches `defineTheme({ base, sys })` — an `@internal`, unexported form that fails `tsc` (public `defineTheme` takes `{ seed } & ThemeFromSeedOptions`, no base/sys). _Evidence:_ styling.md:46-62 vs theme.ts:56-88, :376-399 (`@internal`), index.ts:17. _Fix:_ replace with the supported seed-based override (`defineTheme({ seed, colors, shape, variant, contrast })`).
- [ ] **DG-06** [high·lg] `@kovojs/ui` API reference renders **458/460 symbols as "Undocumented"** — every component const + `*Props` interface, the package users reach for first. _Evidence:_ ui.sidebar.json (458 `documented:false`); api-ref.mjs:623 (`documented = JSDoc presence`). _Fix:_ add JSDoc summary + `@example` to exported component consts and their `*Props` in `packages/ui/src/*.tsx`; prioritize Button/Card/Dialog/Field/Select/Table.
- [ ] **DG-09** [high·md] No narrative guide for single-row **lost-update / oversell** concurrency (`kovo({atomic|version})`, compare-and-set, **KV429**) — and the canonical add-to-cart example _is_ the read-check-then-write TOCTOU race KV429 exists to catch. _Evidence:_ SPEC §1.1, §10.3; diagnostics.md KV429; drizzle/src/cas.ts; mutations.md:47-50; reference exists but `grep atomic|version|KV429 site/content` all false positives. _Fix:_ add a "Preventing oversell: single-row concurrency" section to mutations.md/data-layer.md (race → atomic/version declare-once → CAS fold → typed 409/422 retry → honest single-row ceiling).

---

## Reference integrity

- [ ] **DG-24** [med·md] Diagnostics generator scans **only `@kovojs/core`**, so the catalog's "every diagnostic the framework emits" promise is structurally false. _Evidence:_ diagnostics-ref.mjs:30-47; diagnostics.md:9-11; comm-diff of emitted vs catalog = exactly `{KV229, KV313}`. _Fix:_ register KV229 + KV313 in core `diagnostics.ts` (single source) **and** add a generator self-check that fails the build when any `KV###` emitted in `packages/*/src` or SPEC tables is missing from the catalog. Root cause of DG-05 + DG-23.
- [ ] **DG-23** [med·sm] **KV313** (optimistic rebase discard) is in neither the catalog nor optimistic.md. _Evidence:_ `grep -c KV313 diagnostics.md` = 0 (KV312→KV314); SPEC.md:1213; browser/src/optimism.ts (comments only — not tagged at emit, a deeper bug). _Fix:_ register KV313 (DG-24) + add a paragraph to optimistic.md (transform throws / missing server truth → discard + visible KV313, wired to onError/devtool).
- [ ] **DG-22** [med·lg] `@kovojs/headless-ui` renders **777/880 "Undocumented"** — the ARIA/data attribute builders + `*State`/`*Options`/`*Attributes` types that copy-in authors call directly. _Evidence:_ headless-ui.sidebar.json (103 documented = the event handlers only). _Fix:_ JSDoc each builder (name the ARIA/data attrs it emits + SPEC §) and its Options/State interface; start with the primitives `@kovojs/ui` composes (accordion, dialog, select, combobox, menu).
- [ ] **DG-47** [low·md] No `README.md` for 12 npm-public packages (only `@kovojs/icons` has one). _Evidence:_ filesystem scan; all have `files:["dist"]`, `private:undefined`. _Fix:_ add a short README per package (purpose, install, minimal snippet, link to `/api/<slug>/` + guide); consider generating from `public-packages.json` `apiRef.description`. Pre-v1 / launch-readiness.

## Outdated content

- [ ] **DG-25** [med·sm] `getting-started/project-structure.md` `createApp` snippet is stale and now **throws**: `sessionProvider` must be the structured `{ justification, lifecycle:'delegated', lifecycleAssertions, provider }` object, not a function. _Evidence:_ project-structure.md:46-53 vs templates/src/app.tsx:102-154; app.ts:226 throws on the function form. _Fix:_ re-extract from app.tsx (structured delegated provider, inline `route()` decls; mention clientModules/document/endpoints).
- [ ] **DG-26** [low·sm] `guides/cli.md` drifts from `commands-manifest.ts`: says "two sub-checks" but there are four (`optimistic|coverage|endpoint-posture|sources-sinks`); omits `explain document`. _Evidence:_ cli.md:71/86 vs commands-manifest.ts:21/30. _Fix:_ correct the count + mention `explain document`; cross-link `/api/cli/` for the full flag surface (it's already complete there). _(Downgraded from med — generated CLI ref is accurate.)_

## Inaccuracies

- [ ] **DG-30** [med·md] `guides/components.md` tells copy-in authors to import `escapeHtml` from the `@internal` `@kovojs/server/internal/html` subpath — contradicts STABILITY and the registry; real components inline a local `escapeHtml`. _Evidence:_ components.md:75/221 vs html.ts:8-9 (`@internal`), STABILITY.md:17-19, registry.json:7. _Fix:_ show the local-helper / JSX auto-escape path; remove the `@kovojs/server` "escape helpers" claim from registry.json. (Expose a public escaping primitive first if one is genuinely wanted.)
- [ ] **DG-28** [med·sm] `guides/data-layer.md` claims `kovo()` takes `{domain,key?}`/`{exempt}` "**and nothing else (verified)**" — false; it also accepts `owner, atomic, version, governed, secret, confidentialAtRest, fans` + `view`. _Evidence:_ data-layer.md:197-198 vs drizzle-surface.ts:94-159. _Fix:_ enumerate the real option set (or "…plus security/concurrency columns covered in the security & concurrency guides"); drop the false "verified…nothing else" stamp.
- [ ] **DG-27** [med·sm] Tutorial ch.2 says the app imports compiled IR from `src/generated/`, but the fixture imports the authored component directly (and `src/generated/` is gitignored/transient). _Evidence:_ 02-islands.md:39-42 vs steps/02-islands/src/app.ts:3,8. _Fix:_ correct the prose (app imports the authored component; `src/generated/` is a transient/legacy compiler artifact).
- [ ] **DG-01** [med·sm] Quickstart's "watch a check fail" demo binds `contact.company` — a field the scaffold already selects/renders/writes, so `vp check` emits **no** error and the signature value-prop demo doesn't reproduce. _Evidence:_ quickstart.md:76-88 vs templates queries.ts:42, contacts.tsx:78/122. _Fix:_ use a genuinely-absent field (`phone`/`title`) or add the column first so the check actually fails.
- [ ] **DG-45** [low·sm] `guides/auth-better-auth.md` mislabels a build/test-gate section as "Audit commands" and is thin (no session schema, adapter call, or CSRF config shown). _Evidence:_ auth-better-auth.md:84-90; real audits are `kovo audit`/`kovo explain --unguarded/--unscoped/--endpoints`. _Fix:_ rename ("Verify the integration"), cross-link security.md, add one concrete `session()`+`betterAuthSession()`+CSRF snippet.
- [ ] **DG-43** [low·sm] `getting-started/stability.md` table conflicts with `public-packages.json`: `@kovojs/compiler`/`@kovojs/test` shown "Internal", `@kovojs/icons` omitted, though all three are `visibility:public`. _Evidence:_ stability.md:29-30 vs manifest. _Fix:_ add icons; clarify the compiler/test column is a usage-guidance split, not the public/internal definition.
- [ ] **DG-44** [low·sm] `guides/accessibility.md` cites a non-existent **SPEC §12.1** and a wrong axe test path. _Evidence:_ no §12.1 in SPEC.md; real source `rules/accessibility-conformance.md`; real test `interactive-gallery.axe.browser.test.ts`. _Fix:_ correct both (and the same stale path in the rule file).
- [ ] **DG-42** [low·sm] `project-structure.md` annotates `tsconfig.json` as conditional, but create-kovo always writes it. _Evidence:_ project-structure.md:33 vs create-kovo/src/index.ts:57. _Fix:_ drop the conditional footnote.

## Missing guides

- [ ] **DG-34** [med·md] No consolidated **Wire Protocol reference**; the normative §9.1.1 prod-delta deep-merge encoding is undocumented. _Evidence:_ SPEC.md:845-866; headers scattered across mutations/streaming/queries; `grep deep-merge|removed-key|settlement set site/content` empty. _Fix:_ add a `site/gen`/reference wire-protocol page (headers, `text/vnd.kovo.fragment`, the `<kovo-query>/<kovo-fragment>/<kovo-text>/<kovo-defer>` vocabulary, the §9.1.1 delta semantics). Scope out `<kovo-live>` (DG-03).
- [ ] **DG-31** [med·md] Confidential-data / **secret** boundary (`secret:` columns, `trustedReveal`, **KV435**, `kovo explain --revealed`) is undocumented — a headline class + Constitution test #4. _Evidence:_ SPEC §1.1/§2; `grep trustedReveal|--revealed|KV435 site/content` empty. _Fix:_ add a "Confidential data: the secret boundary" section to security.md.
- [ ] **DG-32** [med·md] No guide for **capability URLs / secure downloads** (`createStorageDownloadEndpoint`, `ctx.signUrl`, `signCapability`, SPEC §6.6) — and security.md's source/sink table still points downloads at the weaker roll-your-own escape. _Evidence:_ server.md:348-442 documents the symbols; `grep signCapability|signUrl site/content` empty; security.md:274. _Fix:_ add a "Secure file downloads" guide (mount → mint → canonicalize-before-sign → fail-closed verify order → per-object scope → bearer-leak honest limit → `--capabilities` audit).
- [ ] **DG-08** [med·md] **Mass-assignment** protection (`governed` columns, `serverValue`/`adminAssign`, **KV438**) has no narrative guide. _Evidence:_ SPEC §1.1/§2; `grep KV438|serverValue|adminAssign|governed site/content` empty. _Fix:_ add a "Mass assignment / write provenance" section to security.md or data-layer.md (why `{...input}` on governed columns is KV438; the two escapes; surfaced by `kovo explain --writes`).
- [ ] **DG-33** [med·sm] No coverage of **time-dependent rendering / declared clocks** (`clocks` input, **KV312/KV315**, `.refresh({every|at|until})`, `renderOnce`). _Evidence:_ SPEC §4.9; diagnostics.md:44; `grep clocks|now.ago|.refresh( site/content` empty. _Fix:_ add a "Time-dependent UI: declared clocks" subsection to islands.md with a runnable "3 minutes ago"/countdown sample.
- [ ] **DG-35** [med·md] No **database-migration / schema-provisioning** guide for the persistent-Postgres deploy path. _Evidence:_ `grep migrate|drizzle-kit|db:push site/content` empty; data-layer.md:279-281 says "driver swap, schema unchanged" but never how the schema lands. _Fix:_ add a "schema provisioning & evolution" section. NB: Kovo ships **no** drizzle-kit/config/migrations — the runtime path is hand-written `CREATE TABLE` DDL (templates/src/db.ts); frame drizzle-kit as a valid (un-scaffolded) operator choice since runtime db is ordinary Drizzle.
- [ ] **DG-07** [med·md] Registry-bounded dynamic rendering (`renderTree`/`renderRegistry`/`parseComponentXml`, SPEC §4.10) — normative v1 primitive for the AI-agent audience — has **no guide and no API ref**, because it's not re-exported from the public `@kovojs/server` barrel. _Evidence:_ render-tree.ts:89/208 exported only via internal `api/rendering.ts`, not `index.ts`; `grep renderTree site/content site/gen` empty; plans/render-tree.md:50 over-claims "Public API wired". _Fix:_ **Blocked on decision D2** — first decide if §4.10 ships in published v1; if yes, add the symbols to `index.ts` (generator + baseline auto-update), then write the guide.
- [ ] **DG-46** [low·sm] No troubleshooting / upgrading hub in onboarding. _Evidence:_ `grep troubleshoot|upgrad|FAQ site/content/getting-started` empty. _Fix:_ add a symptom-indexed `getting-started/troubleshooting` page that cross-links already-documented first-run failures (CSRF fail-closed, demo password, sound-subset bans, reading KV codes) + a short upgrading note vs stability.md's 0.x policy. Aggregation, not new content.

## Undocumented / incomplete public APIs

- [ ] **DG-10** [med·md] `kovo explain` grew **6 security-review modes** (`--revealed/--trust/--access/--capabilities/--cookies/--sources-sinks`) the guides don't mention; cli.md/kovo-explain.md/security.md all still say "**three** audits". _Evidence:_ commands-manifest.ts:28-46; graph-output.ts:288-407; security.md:202. _Fix:_ correct the "three" framing; in security.md wire source/sink rows to `--trust`(KV426)/`--revealed`/`--capabilities`(KV428/437)/`--cookies`(KV432); add `--capabilities`/`--cookies` to `EXPLAIN_USAGE` so the generated `/api/cli/` renders them.
- [ ] **DG-16** [med·sm] `@kovojs/server/vite` (the `kovo()` plugin **every** app wires) is a public subpath with **no API-ref section**. _Evidence:_ public-packages.json:1806 lists `./vite` in `apiBoundary.public` but `apiRef.entries` omits it; server.md has no `/vite` section. _Fix:_ add `{ path:'./vite', slug:'server-vite', … }` to `apiRef.entries` (symbols already JSDoc'd, render cleanly).
- [ ] **DG-17** [med·md] Per-route/per-layout **`boundaries`** (custom error/not-found/unauthorized renderers, SPEC §4.5) are named in prose but never shown with code. _Evidence:_ route.ts:101-133/142/200 (public types); layouts.md:57/104 prose only; `grep "boundaries: {" site/content/guides` empty. _Fix:_ add a "Per-segment error & not-found boundaries" section to layouts.md (runnable example, resolution order route→layout→app-shell, the `{error,request,status}` context).
- [ ] **DG-18** [med·sm] `routing.md` Speculation-Rules section omits the **KV419** credentialed-prerender gate + `prefetchJustification` escape — security-relevant (`'moderate'` prerenders with the user's credentials). _Evidence:_ routing.md:261-274; SPEC.md:776; hints.ts:109-116. _Fix:_ note `'moderate'` is KV419-gated on guarded routes and needs a named `prefetchJustification`; add KV419 to the routing `<details>`.
- [ ] **DG-19** [med·sm] Onboarding teaches `vp check` as THE gate, but the scaffold gate is `npm run check` = `vp check && check:sound-subset && check:endpoint-posture`; bare `vp check` does **not** enforce the §6.6 sound subset that why-kovo advertises. `endpoint-posture` is undocumented site-wide. _Evidence:_ installation.md:84; templates/package.json; `grep endpoint-posture site/content` = 0. _Fix:_ add `npm run check` + both sub-gates to installation.md's command table; clarify `vp check` ≠ sound-subset enforcement.
- [ ] **DG-20** [med·md] Streaming tutorial never shows the public **`<Defer>`** primitive and mislabels the framework-emitted `<kovo-defer>` as the authoring API. _Evidence:_ SPEC.md:782; 06-streaming.md:11/23/43/50 (only hand-built `<kovo-defer>` test helpers); hand-written `{defer()}` is KV244. _Fix:_ add a fixture authoring `<Defer fallback={…}>` from `@kovojs/server`; reframe `<kovo-defer>` as the emitted placeholder. Same fix in `guides/streaming.md`.
- [ ] **DG-12** [med·sm] Typed mutation **`redirectTo`/`defaultRedirectTo`** PRG fields are undocumented in mutations.md (the PRG section shows a hardcoded `303 /cart`). _Evidence:_ mutation/definition.ts:209/237; `grep redirectTo site/content` = 0. _Fix:_ add a "Choosing the PRG target" subsection (static `defaultRedirectTo`; dynamic `redirectTo` incl. typed `redirect('/path',{params})` create-then-navigate w/ KV220 rename propagation); cross-link routing.md:152-166.
- [ ] **DG-15** [med·sm] `routing.md` head/metadata shows only static `meta:{title,description}`; omits query-driven titles (`metaFromQuery`/`RouteMetaFactory`) and the OG `image` field. _Evidence:_ hints.ts:17-34; SPEC §6.4/§13.5; `grep metaFromQuery|RouteMetaFactory site/content` = 0. _Fix:_ document `meta.image` + a `metaFromQuery(query, derive)` example (the exported helper, not the raw factory).
- [ ] **DG-11** [med·sm] Scaffold writes `AGENTS.md`, a `CLAUDE.md` symlink, and a committed `.kovo/docs/` agent-docs mirror that **no** onboarding page mentions — despite the AI-agent-builder audience. _Evidence:_ create-kovo/src/index.ts:146-155; installation.md:53-60 / project-structure.md:11-34 omit them. _Fix:_ add them to the file tour + "What the starter writes"; cross-link `kovo update-docs`. (Overlaps DG-36.)
- [ ] **DG-21** [med·md] No consolidated **environment-variable / secrets reference**, and the CSRF secret var name is inconsistent: guides use `CSRF_SECRET` (deployment.md:147, security.md:168, request-shell.md:39) while the scaffold writes `KOVO_CSRF_SECRET` (+ `BETTER_AUTH_SECRET` fallback). _Evidence:_ create-kovo/src/index.ts:82; templates/src/auth.ts:45. _Fix:_ add an operator-facing var table (DATABASE_URL, KOVO_CSRF_SECRET/BETTER_AUTH_SECRET, PORT, HOST, NODE_ENV, KOVO_PRESET, **KOVO_SQL_GUARD** [fail-open], deploy-detect VERCEL/CLOUDFLARE/CF_PAGES); align the CSRF var name across guides.
- [ ] **DG-13** [low·sm] `QueryConfig.refetchOnFocus:false` opt-out is undocumented in queries.md (default-on; `true` rejected). _Evidence:_ core/src/index.ts:259; `grep refetchOnFocus site/content` = 0 (gen/api/core.md has it). _Fix:_ one-line opt-out example near queries.md:207.

## Incomplete sections (lower priority)

- [ ] **DG-36** [low·sm] `project-structure.md` tree omits always-written files: `scripts/check-sound-subset.mjs`, `src/endpoint-posture.test.ts`, `README.md` (+ AGENTS.md/CLAUDE.md/.kovo/docs from DG-11). _Evidence:_ create-kovo/src/index.ts:55-75. _Fix:_ add them; page bills itself as touring "every generated file".
- [ ] **DG-37** [low·sm] `endpoints-webhooks.md` shows no import lines; `hmacSignature` comes from `@kovojs/core` (not `@kovojs/server`) — non-obvious, and the only API-ref link points away from it. _Evidence:_ endpoints-webhooks.md:21-54/120; core/src/index.ts:61. _Fix:_ add explicit imports disambiguating the package split + a `@kovojs/core` verifier-kit ref link.
- [ ] **DG-38** [low·md] `deployment.md` has no observability/logging section, though the public `createApp({ onError })` seam (`ServerErrorDiagnosticContext`) exists for exactly that. _Evidence:_ `grep observab|logging|metrics site/content` ≈ empty; server/src/diagnostics.ts:1-54. _Fix:_ add an observability section naming `onError`, the `/_m`/`/_q` by-name access-log angle, §6.6 audit telemetry, and build-vs-runtime diagnostics.
- [ ] **DG-39** [low·sm] **The Constitution** (Prime Principle + five design tests, SPEC §2) has no dedicated explainer for the evaluator audience. _Evidence:_ appears only in a collapsed footnote (why-kovo.md:115-116). _Fix:_ add a short "Design principles" section to why-kovo.md (the §2 table + consequences).
- [ ] **DG-40** [low·sm] `dataflow-devtool.md` "Conformance" code block is byte-identical to the MCP-run command above it (copy-paste error); shows no conformance check. _Evidence:_ dataflow-devtool.md:86-87 == :73-74. _Fix:_ replace with the real same-artifact check (examples/devtool/scripts/conformance.mjs). NB: `@kovojs/devtool` is `private` — correctly absent from `/api/`, do not add a page.
- [ ] **DG-41** [low·sm] `CONTRIBUTING.md` repo-layout table omits 5 public packages (better-auth, headless-ui, style, icons, ui) and mislabels `packages/test` as "kovoTest" (now `@experimental`; use `createKovoTestHarness`). _Evidence:_ CONTRIBUTING.md:36-50 vs public-packages.json. _Fix:_ add the rows; relabel.

---

## Docs-style conformance (`rules/docs-style.md`)

User-requested dimension: bring authored pages to task-first / happy-path-first / payoff-before-mechanism.
Grades **A:8 B:19 C:7 D:3 F:0**. The docs are proof-rich and close well — the fix budget is almost
entirely **openers and first code blocks**, not endings. The 8 A-pages (why-kovo, mental-model,
quickstart, tutorial/08, cli, kovo-explain, deployment, compiler-internals) are the canonical templates.

### Systemic passes (do these first — they fix most pages at once)

- [ ] **DS-S1** [high·md] **Payoff-first opener pass** across the 24 F6 + 16 F2 pages: the first sentence must name the app outcome (cart badge ticks, link 404s, order flips to Shipped) before any framework noun. Heuristic lint: an opening sentence containing `touch set|domain|invalidation graph|StyleX|Interaction Ladder|BroadcastChannel|request shell` with no app noun fails. Copy why-kovo.md:9-12 / mental-model.md:10-11.
- [ ] **DS-S2** [high·md] **First-code-block contract** doc-wide: first fenced block ≤ ~8 lines, one new idea, copy-runnable (no forward-referenced identifiers), and must NOT require guards+csrf+queue+optimistic+tx+typed-errors at once. Fixes the 11 F1 pages; mutations.md + tutorial/04 are the worked examples.
- [ ] **DS-S3** [med·sm] **Citation quarantine**: move every `SPEC §`/`KV###` off the main path into one collapsed `## Spec & diagnostics` `<details>`; strip in-code KV comments from first blocks (routing KV229, data-layer/mutations KV330) and the 3 bare "SPEC section X.Y" dangles (installation:21, dataflow-devtool:9, auth-better-auth:63). Enforce with a grep CI lint: `SPEC §|SPEC section|KV\d{3}` outside a `<details>`.
- [ ] **DS-S4** [med·sm] **Reader-verb heading pass**: replace internal-noun headings (request-shell "The app aggregate/Dispatch order/Adapters"; styling "Seed themes/Component styles"; deployment "The stateless server") with verbs (Add/Render/Run/Check/Deploy/Secure/Style/Configure/Serve/Limit).
- [ ] **DS-S5** [med·sm] **Task-first `## Next` closer + "when to use this"**: add a `## Next` (never authority) to the 5 pages missing one (project-structure, stability, accessibility, auth-better-auth, dataflow-devtool); demote the 2 authority-closers (project-structure, accessibility). Add a one-line "when to use this / when X is better" to layouts, styling, data-layer, dataflow-devtool, components.
- [ ] **DS-S6** [low·sm] **De-dup static-export**: static-export.md and deployment.md:110-122 both own KV229 — pick one source of truth, cross-link the other.

### Restructure-first (genuinely inverted happy path — 7 pages)

- [ ] **DS-R1** [high·md] `guides/mutations.md` (D) — first block is the full addToCart (csrf+guards.all+queue+optimistic+transaction+typed-errors, :20-56). Split to a 6-8 line `cart/add` then layer one idea per section. **Becomes the canonical worked example for DS-S2.** (Pairs with content fix DG-09/DG-12.)
- [ ] **DS-R2** [high·md] `tutorial/04-mutations.md` (C) — linear critical path; first block is a production mutation that even shows the invalidation registry the chapter then claims is unaddressed (:88-90 contradicts :17). Split + fix the `shopCsrf` forward-reference. (Pairs with DG-20 sibling ch.6.)
- [ ] **DS-R3** [high·md] `guides/security.md` (C, most signs F1+F2+F3+F4+F6) — evaluator-critical. Replace proof-model opener with a concrete `guards.authed()` task; shrink the first guard block; move the practical checklist above the source/sink reference table; pull inline `(SPEC §…)` into `<details>`. (Pairs with DG-04/DG-08/DG-31/DG-10.)
- [ ] **DS-R4** [med·md] `guides/data-layer.md` (C) — "domain" is the concept every data page builds on; opener leads with "cache currency", first block is `onConflictDoUpdate` + SQL arithmetic. Shrink to `domain('cart')` + single insert. (Pairs with DG-28/DG-09.)
- [ ] **DS-R5** [med·md] `guides/accessibility.md` (D) — brand-register page, worst inversion: ~45 lines of "axe-clean across state tiers" posture before the reader's task; only top page closing on authority. Flip to job-first, demote the guarantee to one reassurance line. (Pairs with DG-44.)
- [ ] **DS-R6** [med·sm] `guides/styling.md` (C) — happy path literally inverted: "Seed themes"/`defineTheme` config is section 1, "style a component" buried at :64. Promote component styling to first. (Pairs with DG-02.)
- [ ] **DS-R7** [med·md] `guides/dataflow-devtool.md` (D) — never shows the visual payoff, opens all-framework-nouns + dangling SPEC cite, "Conformance" duplicates the MCP command. Payoff-first rebuild. (Pairs with DG-40.)

### Local-edits (good page, wrong opener / first block — ~22 pages)

Mostly absorbed by DS-S1/S2/S3, but each needs a targeted touch. Apply opener + first-block + citation
fixes to: routing, testing, queries, request-shell, optimistic, islands, live-queries, streaming,
static-export, components, layouts, auth-better-auth, endpoints-webhooks, compiler-internals (polish),
tutorial 01/02/03/05/06/07, installation, project-structure, stability. (Per-page specifics in the
audit transcript; several pair with content findings: routing↔DG-15/18, queries↔DG-13, live-queries↔DG-03,
streaming↔DG-20, request-shell↔DG-21, components↔DG-30.)

- [ ] **DS-L1** [med·md] Sweep the ~22 local-edit pages applying the systemic passes page-by-page; verify each still extracts/compiles (docs are extracted from checked-in compiling step states).

### Codify (make new pages conform by default)

- [x] **DS-C1** [med·sm] Add an **authored-page skeleton** to `rules/docs-style.md`. _Shipped 2026-06-25:_ added a `## Voice` section (Simon-Willison register — plain, direct, show-don't-tell, with a before/after) and three per-mode verb-heading skeletons (Guide: job → smallest code → Run it → production shape → Handle failure → Next + collapsed `Spec & diagnostics`; Tutorial: build slice → Run it → What just happened → Next; Reference: when-to-reach → minimal use → enumerate → examples). Exemplars cited: tutorial/08, kovo-explain.
- [ ] **DS-C2** [med·md] Add doc lints to the content pipeline / CI: first-code-block line-count + unresolved-identifier check; citation-quarantine grep (DS-S3); opener app-noun-ratio check. (The content pipeline already extracts from compiling step states, so first-block extraction is feasible.)

---

## Open decisions (block specific items)

- [ ] **D1 — live-queries shipping status (blocks DG-03 + deployment.md:21-29).** Is the `<kovo-live>` SSE / live-query subsystem in scope for the technical preview, or roadmap? Source says unimplemented (core/index.ts:253-256; capability-gaps §5). _Default per Technical-Preview Bias:_ gate behind a "Roadmap — not shipped" banner rather than document vaporware; rewrite to the shipping liveness paths.
- [ ] **D2 — render-tree §4.10 public surface (blocks DG-07).** Does `renderTree`/`renderRegistry`/`parseComponentXml` ship in the published v1 `@kovojs/server` surface? Currently exported only internally; `plans/render-tree.md:50` over-claims it's wired. If yes → add to `index.ts` then write the guide; if deferred → mark in SPEC/plan and downgrade to a reconciliation note.
- [ ] **D3 — `vp` vs `kovo` terminology.** `cli.md` (graded A) correctly splits `vp` (vite-plus toolchain runner: check/test/build) from `kovo` (framework graph CLI: explain/check coverage/audits). Confirm guides should consistently honor this split (DG-19 shows onboarding conflates `vp check` with the sound-subset gate). _Default:_ adopt cli.md's split as house terminology; no rename.

## Suggested sequencing

1. **Structural root fixes** that unblock many items: DG-24 (diagnostics generator + KV229/KV313), DS-S1/S2/S3 systemic passes, DS-C1 skeleton.
2. **P0** correctness/security: DG-02/03/04/05/06/09 (DG-03/07 pending D1/D2).
3. **Restructure-first** DS-R1…R7 (each pairs with a content finding — fix both in one PR per page).
4. Remaining medium content gaps (missing guides + undocumented APIs), then the local-edits sweep DS-L1.
5. Low-severity polish + launch-readiness (READMEs DG-47, CONTRIBUTING DG-41, env/secrets DG-21).
