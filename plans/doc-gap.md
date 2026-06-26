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
- Authored code snippets: `cd site && npm run content` runs `code-snippets/v1 snippets=120 OK` through the content pipeline.
- Regen is clean (no committed drift): `cd site && npm run content` then `git diff --stat site/gen` → empty (gen/ is gitignored, reproducibly built).

### Verified non-issues (checked, do not re-file)

- `reads:`/KV410 read-side escape **is** documented (mental-model.md:26-34, security.md:143, testing.md:143); queries.md:261 "no tag lists" is not a contradiction. (was DG-14)
- `kovo build --preset vercel`/`cloudflare` **are** implemented and tested (server/src/build.ts:164/192); cli.md is correct, the `commands-manifest.ts` "fail loudly" string is the stale one. (was DG-29)

---

## P0 — Highest priority (correctness-breaking or security-relevant)

- [x] **DG-03** [high·md] `guides/live-queries.md` documents an **unshipped** SSE API as if it works — `live: true`, `<kovo-live>`, `redisLiveEmitter`/`inProcessLiveEmitter`, `createApp({ live })`. Every sample fails `tsc`. _Evidence:_ `site/content/guides/live-queries.md` now leads with shipped mutation responses, BroadcastChannel, and refetch-on-focus, and labels SSE live queries roadmap-only; `site/content/guides/deployment.md` mirrors the caveat; `cd site && npm run content` passed.
- [x] **DG-04** [high·sm] `rateLimit per:'ip'` scope (and the `per:'session'`-collapses-anonymous footgun the runtime itself warns about) is undocumented site-wide. _Evidence:_ `site/content/guides/security.md` now documents `per: 'ip' | 'session' | 'global'`, `req.clientIp`, and the anonymous-session caveat; `cd site && npm run content` passed.
- [x] **DG-05** [high·md] **KV229** (static-export non-exportable, error-level) is absent from the diagnostics catalog though 4 guides link readers to it. _Evidence:_ `KV229` is registered in `packages/core/src/diagnostics.ts`; `cd site && npm run content` passed with `diagnostics-ref/v1 codes=81`, proving the generated catalog includes the registry code.
- [x] **DG-02** [high·sm] `guides/styling.md` teaches `defineTheme({ base, sys })` — an `@internal`, unexported form that fails `tsc` (public `defineTheme` takes `{ seed } & ThemeFromSeedOptions`, no base/sys). _Evidence:_ `site/content/guides/styling.md` now uses only the public seed form (`seed`, `colors`, `shape`, `variant`, `contrast`) and notes `base`/`sys` is internal; `cd site && npm run content` passed.
- [ ] **DG-06** [high·lg] `@kovojs/ui` API reference renders **458/460 symbols as "Undocumented"** — every component const + `*Props` interface, the package users reach for first. _Evidence:_ ui.sidebar.json (458 `documented:false`); api-ref.mjs:623 (`documented = JSDoc presence`). _Fix:_ add JSDoc summary + `@example` to exported component consts and their `*Props` in `packages/ui/src/*.tsx`; prioritize Button/Card/Dialog/Field/Select/Table.
- [x] **DG-09** [high·md] No narrative guide for single-row **lost-update / oversell** concurrency (`kovo({atomic|version})`, compare-and-set, **KV429**) — and the canonical add-to-cart example _is_ the read-check-then-write TOCTOU race KV429 exists to catch. _Evidence:_ `site/content/guides/mutations.md` now has "Prevent lost updates on one row" and `site/content/guides/data-layer.md` has "Protect single-row counters"; `cd site && npm run content` passed with `code-snippets/v1 snippets=115 OK`.

---

## Reference integrity

- [x] **DG-24** [med·md] Diagnostics generator scans **only `@kovojs/core`**, so the catalog's "every diagnostic the framework emits" promise is structurally false. _Evidence:_ `site/scripts/diagnostics-ref.mjs` now checks `packages/*/src` and the SPEC diagnostic table against `diagnosticDefinitions`; `pnpm exec vitest --run packages/core/src/diagnostics.test.ts` and `cd site && npm run content` passed.
- [x] **DG-23** [med·sm] **KV313** (optimistic rebase discard) is in neither the catalog nor optimistic.md. _Evidence:_ `KV313` is registered in `packages/core/src/diagnostics.ts`, `site/content/guides/optimistic.md` documents the discard/refetch behavior, and `cd site && npm run content` passed with `diagnostics-ref/v1 codes=81`.
- [ ] **DG-22** [med·lg] `@kovojs/headless-ui` renders **777/880 "Undocumented"** — the ARIA/data attribute builders + `*State`/`*Options`/`*Attributes` types that copy-in authors call directly. _Evidence:_ headless-ui.sidebar.json (103 documented = the event handlers only). _Fix:_ JSDoc each builder (name the ARIA/data attrs it emits + SPEC §) and its Options/State interface; start with the primitives `@kovojs/ui` composes (accordion, dialog, select, combobox, menu).
- [x] **DG-47** [low·md] No `README.md` for 12 npm-public packages (only `@kovojs/icons` has one). _Evidence:_ added short READMEs for the 12 missing public packages; `node -e` scan over `public-packages.json` public entries found every `packages/<dir>/README.md`, and `git diff --check` passed.

## Outdated content

- [ ] **DG-25** [med·sm] `getting-started/project-structure.md` `createApp` snippet is stale and now **throws**: `sessionProvider` must be the structured `{ justification, lifecycle:'delegated', lifecycleAssertions, provider }` object, not a function. _Evidence:_ project-structure.md:46-53 vs templates/src/app.tsx:102-154; app.ts:226 throws on the function form. _Fix:_ re-extract from app.tsx (structured delegated provider, inline `route()` decls; mention clientModules/document/endpoints).
- [x] **DG-26** [low·sm] `guides/cli.md` drifts from `commands-manifest.ts`: says "two sub-checks" but there are four (`optimistic|coverage|endpoint-posture|sources-sinks`); omits `explain document`. _Evidence:_ `site/content/guides/cli.md` now lists all four focused `kovo check` subcommands and `kovo explain document`; `cd site && npm run content` passed.

## Inaccuracies

- [x] **DG-30** [med·md] `guides/components.md` tells copy-in authors to import `escapeHtml` from the `@internal` `@kovojs/server/internal/html` subpath — contradicts STABILITY and the registry; real components inline a local `escapeHtml`. _Evidence:_ `site/content/guides/components.md` now tells copy-in authors to rely on JSX escaping or keep local helpers, and `packages/ui/registry.json` no longer advertises internal server escape helpers; `cd site && npm run content` passed.
- [x] **DG-28** [med·sm] `guides/data-layer.md` claims `kovo()` takes `{domain,key?}`/`{exempt}` "**and nothing else (verified)**" — false; it also accepts `owner, atomic, version, governed, secret, confidentialAtRest, fans` + `view`. _Evidence:_ `site/content/guides/data-layer.md` now names the extended `kovo()` option set and no longer claims the options stop at `{ domain, key }` / `{ exempt }`; `cd site && npm run content` passed.
- [ ] **DG-27** [med·sm] Tutorial ch.2 says the app imports compiled IR from `src/generated/`, but the fixture imports the authored component directly (and `src/generated/` is gitignored/transient). _Evidence:_ 02-islands.md:39-42 vs steps/02-islands/src/app.ts:3,8. _Fix:_ correct the prose (app imports the authored component; `src/generated/` is a transient/legacy compiler artifact).
- [x] **DG-01** [med·sm] Quickstart's "watch a check fail" demo binds `contact.company` — a field the scaffold already selects/renders/writes, so `vp check` emits **no** error and the signature value-prop demo doesn't reproduce. _Evidence:_ `site/content/getting-started/quickstart.md` now uses absent `contact.phone`; `cd site && npm run content` passed.
- [x] **DG-45** [low·sm] `guides/auth-better-auth.md` mislabels a build/test-gate section as "Audit commands" and is thin (no session schema, adapter call, or CSRF config shown). _Evidence:_ `site/content/guides/auth-better-auth.md` now shows `session()`, `betterAuthSession()`, typed CSRF config, and the section is "Verify the integration"; `cd site && npm run content` passed.
- [x] **DG-43** [low·sm] `getting-started/stability.md` table conflicts with `public-packages.json`: `@kovojs/compiler`/`@kovojs/test` shown "Internal", `@kovojs/icons` omitted, though all three are `visibility:public`. _Evidence:_ `site/content/getting-started/stability.md` now includes icons and frames compiler/test as usage guidance rather than visibility; `cd site && npm run content` passed.
- [x] **DG-44** [low·sm] `guides/accessibility.md` cites a non-existent **SPEC §12.1** and a wrong axe test path. _Evidence:_ `site/content/guides/accessibility.md` and `rules/accessibility-conformance.md` now point to `interactive-gallery.axe.browser.test.ts` and the rule, not SPEC §12.1; `cd site && npm run content` passed.
- [x] **DG-42** [low·sm] `project-structure.md` annotates `tsconfig.json` as conditional, but create-kovo always writes it. _Evidence:_ `site/content/getting-started/project-structure.md` lists `tsconfig.json` as written by the scaffold; source check `rg "tsconfig.json" packages/create-kovo/src/index.ts` confirms it is in `templateFiles`.

## Missing guides

- [ ] **DG-34** [med·md] No consolidated **Wire Protocol reference**; the normative §9.1.1 prod-delta deep-merge encoding is undocumented. _Evidence:_ SPEC.md:845-866; headers scattered across mutations/streaming/queries; `grep deep-merge|removed-key|settlement set site/content` empty. _Fix:_ add a `site/gen`/reference wire-protocol page (headers, `text/vnd.kovo.fragment`, the `<kovo-query>/<kovo-fragment>/<kovo-text>/<kovo-defer>` vocabulary, the §9.1.1 delta semantics). Scope out `<kovo-live>` (DG-03).
- [ ] **DG-31** [med·md] Confidential-data / **secret** boundary (`secret:` columns, `trustedReveal`, **KV435**, `kovo explain --revealed`) is undocumented — a headline class + Constitution test #4. _Evidence:_ SPEC §1.1/§2; `grep trustedReveal|--revealed|KV435 site/content` empty. _Fix:_ add a "Confidential data: the secret boundary" section to security.md.
- [ ] **DG-32** [med·md] No guide for **capability URLs / secure downloads** (`createStorageDownloadEndpoint`, `ctx.signUrl`, `signCapability`, SPEC §6.6) — and security.md's source/sink table still points downloads at the weaker roll-your-own escape. _Evidence:_ server.md:348-442 documents the symbols; `grep signCapability|signUrl site/content` empty; security.md:274. _Fix:_ add a "Secure file downloads" guide (mount → mint → canonicalize-before-sign → fail-closed verify order → per-object scope → bearer-leak honest limit → `--capabilities` audit).
- [ ] **DG-08** [med·md] **Mass-assignment** protection (`governed` columns, `serverValue`/`adminAssign`, **KV438**) has no narrative guide. _Evidence:_ SPEC §1.1/§2; `grep KV438|serverValue|adminAssign|governed site/content` empty. _Fix:_ add a "Mass assignment / write provenance" section to security.md or data-layer.md (why `{...input}` on governed columns is KV438; the two escapes; surfaced by `kovo explain --writes`).
- [x] **DG-33** [med·sm] No coverage of **time-dependent rendering / declared clocks** (`clocks` input, **KV312/KV315**, `.refresh({every|at|until})`, `renderOnce`). _Evidence:_ `site/content/guides/islands.md` now documents `clocks`, `now.<name>`, `.refresh({ every | at | until })`, and `renderOnce`; `cd site && npm run content` passed with the snippet checker.
- [x] **DG-35** [med·md] No **database-migration / schema-provisioning** guide for the persistent-Postgres deploy path. _Evidence:_ `site/content/guides/data-layer.md` now has "Provision and evolve the schema" covering startup DDL, unscaffolded drizzle-kit/operator migration choices, and deploy sequencing; `cd site && npm run content` passed.
- [ ] **DG-07** [med·md] Registry-bounded dynamic rendering (`renderTree`/`renderRegistry`/`parseComponentXml`, SPEC §4.10) — normative v1 primitive for the AI-agent audience — has **no guide and no API ref**, because it's not re-exported from the public `@kovojs/server` barrel. _Evidence:_ render-tree.ts:89/208 exported only via internal `api/rendering.ts`, not `index.ts`; `grep renderTree site/content site/gen` empty; plans/render-tree.md:50 over-claims "Public API wired". _Fix:_ **Blocked on decision D2** — first decide if §4.10 ships in published v1; if yes, add the symbols to `index.ts` (generator + baseline auto-update), then write the guide.
- [x] **DG-46** [low·sm] No troubleshooting / upgrading hub in onboarding. _Evidence:_ `site/content/getting-started/troubleshooting.md` now covers setup drift, secrets, demo sign-in, docs drift, and upgrades; `cd site && npm run content` passed.

## Undocumented / incomplete public APIs

- [x] **DG-10** [med·md] `kovo explain` grew **6 security-review modes** (`--revealed/--trust/--access/--capabilities/--cookies/--sources-sinks`) the guides don't mention; cli.md/kovo-explain.md/security.md all still say "**three** audits". _Evidence:_ `site/content/guides/cli.md`, `site/content/guides/kovo-explain.md`, and `site/content/guides/security.md` now document `--revealed`, `--trust`, `--access`, `--capabilities`, `--cookies`, and `--sources-sinks`; `packages/cli/src/commands-manifest.ts` includes the same modes and `cd site && npm run content` passed.
- [x] **DG-16** [med·sm] `@kovojs/server/vite` (the `kovo()` plugin **every** app wires) is a public subpath with **no API-ref section**. _Evidence:_ `public-packages.json` now includes `{ path:"./vite", slug:"server-vite" }` in `@kovojs/server` `apiRef.entries`; `pnpm exec vitest --run site/scripts/api-ref.test.mjs` and `pnpm --filter @kovojs/site run api:ref` passed, rendering 11 API packages / 2076 exports.
- [x] **DG-17** [med·md] Per-route/per-layout **`boundaries`** (custom error/not-found/unauthorized renderers, SPEC §4.5) are named in prose but never shown with code. _Evidence:_ `site/content/guides/layouts.md` now includes a `boundaries` example for layout `unauthorized` and route `notFound`/`error`, plus route→layout→app-shell resolution and `{ error, request, status }`; `cd site && npm run content` passed.
- [x] **DG-18** [med·sm] `routing.md` Speculation-Rules section omits the **KV419** credentialed-prerender gate + `prefetchJustification` escape — security-relevant (`'moderate'` prerenders with the user's credentials). _Evidence:_ `site/content/guides/routing.md` now documents guarded-route `prefetch: 'moderate'`, `prefetchJustification`, and KV419 in the spec details; `cd site && npm run content` passed.
- [x] **DG-19** [med·sm] Onboarding teaches `vp check` as THE gate, but the scaffold gate is `npm run check` = `vp check && check:sound-subset && check:endpoint-posture`; bare `vp check` does **not** enforce the §6.6 sound subset that why-kovo advertises. `endpoint-posture` is undocumented site-wide. _Evidence:_ `site/content/getting-started/installation.md` now makes `npm run check` the full scaffold gate, lists `check:sound-subset` and `check:endpoint-posture`, and clarifies `vp check` as a sub-gate; `cd site && npm run content` passed with `code-snippets/v1 snippets=120 OK`.
- [x] **DG-20** [med·md] Streaming tutorial never shows the public **`<Defer>`** primitive and mislabels the framework-emitted `<kovo-defer>` as the authoring API. _Evidence:_ `site/content/tutorial/06-streaming.md` and `site/content/guides/streaming.md` now author `<Defer>` from `@kovojs/server` and describe `<kovo-defer>` as framework-emitted; `cd site && npm run content` passed.
- [x] **DG-12** [med·sm] Typed mutation **`redirectTo`/`defaultRedirectTo`** PRG fields are undocumented in mutations.md (the PRG section shows a hardcoded `303 /cart`). _Evidence:_ `site/content/guides/mutations.md` now documents `defaultRedirectTo`, `redirectTo`, and typed `redirect('/orders/:id', { params })`; `cd site && npm run content` passed.
- [x] **DG-15** [med·sm] `routing.md` head/metadata shows only static `meta:{title,description}`; omits query-driven titles (`metaFromQuery`/`RouteMetaFactory`) and the OG `image` field. _Evidence:_ `site/content/guides/routing.md` now documents `meta.image`, query-derived metadata with `metaFromQuery(...)`, and image URL sink checking; `cd site && npm run content` passed.
- [x] **DG-11** [med·sm] Scaffold writes `AGENTS.md`, a `CLAUDE.md` symlink, and a committed `.kovo/docs/` agent-docs mirror that **no** onboarding page mentions — despite the AI-agent-builder audience. _Evidence:_ `site/content/getting-started/project-structure.md` now lists `AGENTS.md`, `CLAUDE.md`, and `.kovo/docs/`; source check `packages/create-kovo/src/index.ts:146` writes those files.
- [x] **DG-21** [med·md] No consolidated **environment-variable / secrets reference**, and the CSRF secret var name is inconsistent: guides use `CSRF_SECRET` (deployment.md:147, security.md:168, request-shell.md:39) while the scaffold writes `KOVO_CSRF_SECRET` (+ `BETTER_AUTH_SECRET` fallback). _Evidence:_ `site/content/guides/deployment.md` now has the operator env table (`DATABASE_URL`, `KOVO_CSRF_SECRET`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `PORT`, `HOST`, `NODE_ENV`, `KOVO_PRESET`, deploy detection vars, `KOVO_SQL_GUARD`); `request-shell.md`, `deployment.md`, and `security.md` use `BETTER_AUTH_SECRET ?? KOVO_CSRF_SECRET`; a single-quoted grep for bare `CSRF_SECRET` references under `site/content` returned no matches; `cd site && npm run content` passed.
- [x] **DG-13** [low·sm] `QueryConfig.refetchOnFocus:false` opt-out is undocumented in queries.md (default-on; `true` rejected). _Evidence:_ `site/content/guides/queries.md` now documents default-on refetch-on-focus with a `refetchOnFocus: false` opt-out example near the typed read endpoint section; `cd site && npm run content` passed.

## Incomplete sections (lower priority)

- [x] **DG-36** [low·sm] `project-structure.md` tree omits always-written files: `scripts/check-sound-subset.mjs`, `src/endpoint-posture.test.ts`, `README.md` (+ AGENTS.md/CLAUDE.md/.kovo/docs from DG-11). _Evidence:_ `site/content/getting-started/project-structure.md` now lists those files; `rg "check-sound-subset|endpoint-posture|README.md|AGENTS.md" packages/create-kovo/src/index.ts` confirms the scaffold writes them.
- [x] **DG-37** [low·sm] `endpoints-webhooks.md` shows no import lines; `hmacSignature` comes from `@kovojs/core` (not `@kovojs/server`) — non-obvious, and the only API-ref link points away from it. _Evidence:_ `site/content/guides/endpoints-webhooks.md` now imports `endpoint` from `@kovojs/server`, `hmacSignature` from `@kovojs/core`, and `s`/`webhook` from `@kovojs/server`; `cd site && npm run content` passed.
- [ ] **DG-38** [low·md] `deployment.md` has no observability/logging section, though the public `createApp({ onError })` seam (`ServerErrorDiagnosticContext`) exists for exactly that. _Evidence:_ `grep observab|logging|metrics site/content` ≈ empty; server/src/diagnostics.ts:1-54. _Fix:_ add an observability section naming `onError`, the `/_m`/`/_q` by-name access-log angle, §6.6 audit telemetry, and build-vs-runtime diagnostics.
- [ ] **DG-39** [low·sm] **The Constitution** (Prime Principle + five design tests, SPEC §2) has no dedicated explainer for the evaluator audience. _Evidence:_ appears only in a collapsed footnote (why-kovo.md:115-116). _Fix:_ add a short "Design principles" section to why-kovo.md (the §2 table + consequences).
- [x] **DG-40** [low·sm] `dataflow-devtool.md` "Conformance" code block is byte-identical to the MCP-run command above it (copy-paste error); shows no conformance check. _Evidence:_ `site/content/guides/dataflow-devtool.md` now uses `pnpm run check:vp` under "Check that both surfaces match" instead of repeating the MCP command; `cd site && npm run content` passed.
- [x] **DG-41** [low·sm] `CONTRIBUTING.md` repo-layout table omits 5 public packages (better-auth, headless-ui, style, icons, ui) and mislabels `packages/test` as "kovoTest" (now `@experimental`; use `createKovoTestHarness`). _Evidence:_ `CONTRIBUTING.md` now lists the public UI/auth/style packages and names `@kovojs/test` as harness helpers; `cd site && npm run content` passed.

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
- [x] **DS-S6** [low·sm] **De-dup static-export**: static-export.md and deployment.md:110-122 both own KV229 — pick one source of truth, cross-link the other. _Evidence:_ `site/content/guides/deployment.md` now links to `static-export.md` for exportability diagnostics; `rg -n "KV229" site/content/guides/deployment.md site/content/guides/static-export.md` shows KV229 only in `static-export.md`.

### Restructure-first (genuinely inverted happy path — 7 pages)

- [x] **DS-R1** [high·md] `guides/mutations.md` (D) — first block is the full addToCart (csrf+guards.all+queue+optimistic+transaction+typed-errors, :20-56). Split to a 6-8 line `cart/add` then layer one idea per section. **Becomes the canonical worked example for DS-S2.** _Evidence:_ `site/content/guides/mutations.md` now opens with a minimal `mutation('cart/add')` and layers CSRF, guards, errors, transaction, queueing, optimism, redirects, and CAS separately; `cd site && npm run content` passed.
- [x] **DS-R2** [high·md] `tutorial/04-mutations.md` (C) — linear critical path; first block is a production mutation that even shows the invalidation registry the chapter then claims is unaddressed (:88-90 contradicts :17). Split + fix the `shopCsrf` forward-reference. _Evidence:_ `site/content/tutorial/04-mutations.md` now starts with the input, then CSRF, then the mutation; `pnpm exec vitest --run site/tutorial/steps/04-mutations/src/app.test.ts` passed.
- [ ] **DS-R3** [high·md] `guides/security.md` (C, most signs F1+F2+F3+F4+F6) — evaluator-critical. Replace proof-model opener with a concrete `guards.authed()` task; shrink the first guard block; move the practical checklist above the source/sink reference table; pull inline `(SPEC §…)` into `<details>`. (Pairs with DG-04/DG-08/DG-31/DG-10.)
- [ ] **DS-R4** [med·md] `guides/data-layer.md` (C) — "domain" is the concept every data page builds on; opener leads with "cache currency", first block is `onConflictDoUpdate` + SQL arithmetic. Shrink to `domain('cart')` + single insert. (Pairs with DG-28/DG-09.)
- [x] **DS-R5** [med·md] `guides/accessibility.md` (D) — brand-register page, worst inversion: ~45 lines of "axe-clean across state tiers" posture before the reader's task; only top page closing on authority. Flip to job-first, demote the guarantee to one reassurance line. _Evidence:_ `site/content/guides/accessibility.md` now opens with what primitives prove vs what app authors own, then labels/headings examples, exclusions, Next, and collapsed proof details; `cd site && npm run content` passed.
- [ ] **DS-R6** [med·sm] `guides/styling.md` (C) — happy path literally inverted: "Seed themes"/`defineTheme` config is section 1, "style a component" buried at :64. Promote component styling to first. (Pairs with DG-02.)
- [x] **DS-R7** [med·md] `guides/dataflow-devtool.md` (D) — never shows the visual payoff, opens all-framework-nouns + dangling SPEC cite, "Conformance" duplicates the MCP command. Payoff-first rebuild. _Evidence:_ `site/content/guides/dataflow-devtool.md` now starts with visual devtool + MCP payoff, separates mount/build/MCP/check flows, and removes the duplicate conformance command; `cd site && npm run content` passed.

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
  - [x] Authored `ts`/`tsx` snippets are extracted and type-checked during the content pipeline, with shared local declarations for deliberately focused examples.
        _Evidence:_ `site/scripts/code-snippets-check.mjs` is wired from `site/scripts/content-pipeline.mjs`; `pnpm exec vitest --run site/scripts/code-snippets-check.test.mjs` and `cd site && npm run content` passed with `code-snippets/v1 snippets=120 OK`.
  - [ ] Still open: first-code-block line-count lint, citation-quarantine grep, and opener app-noun-ratio check.

---

## Open decisions (block specific items)

- [x] **D1 — live-queries shipping status (blocks DG-03 + deployment.md:21-29).** Is the `<kovo-live>` SSE / live-query subsystem in scope for the technical preview, or roadmap? _Decision:_ treated as roadmap per source and Technical-Preview Bias; `site/content/guides/live-queries.md` and `site/content/guides/deployment.md` now say SSE live queries are not in the technical preview.
- [ ] **D2 — render-tree §4.10 public surface (blocks DG-07).** Does `renderTree`/`renderRegistry`/`parseComponentXml` ship in the published v1 `@kovojs/server` surface? Currently exported only internally; `plans/render-tree.md:50` over-claims it's wired. If yes → add to `index.ts` then write the guide; if deferred → mark in SPEC/plan and downgrade to a reconciliation note.
- [ ] **D3 — `vp` vs `kovo` terminology.** `cli.md` (graded A) correctly splits `vp` (vite-plus toolchain runner: check/test/build) from `kovo` (framework graph CLI: explain/check coverage/audits). Confirm guides should consistently honor this split (DG-19 shows onboarding conflates `vp check` with the sound-subset gate). _Default:_ adopt cli.md's split as house terminology; no rename.

## Suggested sequencing

1. **Structural root fixes** that unblock many items: DG-24 (diagnostics generator + KV229/KV313), DS-S1/S2/S3 systemic passes, DS-C1 skeleton.
2. **P0** correctness/security: DG-02/03/04/05/06/09 (DG-03/07 pending D1/D2).
3. **Restructure-first** DS-R1…R7 (each pairs with a content finding — fix both in one PR per page).
4. Remaining medium content gaps (missing guides + undocumented APIs), then the local-edits sweep DS-L1.
5. Low-severity polish + launch-readiness (READMEs DG-47, CONTRIBUTING DG-41, env/secrets DG-21).
