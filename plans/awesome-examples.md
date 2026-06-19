# Awesome Examples — Make the demos look great (and actually work)

**Goal:** The example apps (`examples/stackoverflow`, `commerce`, `crm`, plus `devtool`,
`gallery`, `reference`) should look polished and intentional, not broken. The Stack Overflow
example specifically should **read as Stack Overflow** — recognizable layout, color, and
typography — while staying fully functional (upvote / ask / answer flows really work).

**Status (2026-06-18):** Phase 1 (engine fix) + Phase 2/3 (Stack Overflow redesign & function)
**DONE and verified**. Branch `agent/awesome-examples`. The SO example now reads as Stack Overflow
(logo, top bar + search, left sidebar, votes/answers/views stat rail, blue titles, tag pills, user
cards) and all three interactive flows round-trip in a real browser (upvote morphs in place, ask
adds a row, answer adds an answer). The engine fix benefits every example: `commerce` and `crm` now
render correctly (were near-unstyled); `crm` is fully functional. Remaining: aesthetic polish of
`commerce`/`devtool`/`gallery`/`reference`, and one framework gap (lowered forms + CSRF, below).

**Proving commands (this session):**
- `npx vitest run packages` → 2856 passed; the 13 failures are **pre-existing** (verified by
  reverting the 3 engine files to base — identical failure set). Engine change adds zero regressions.
- `npx vitest run examples/stackoverflow/src/interactive-app.test.ts` → 6/6 pass (incl. the
  "styles.css stays authored resets" guard).
- Browser (Playwright): SO upvote score 0→1 morphs in place; ask 7→8 rows; answer 2→3 — all
  mutations 200.

**Behavior source of truth:** `SPEC.md` (§6.1.1 atomic CSS, §13.1 stylesheet linking, §9.1/§9.5
the SO app). When a fix and SPEC conflict, follow SPEC and record the conflict.

Mark `- [x]` only when this session verifies the cited proving command/screenshot for the exact
item (CLAUDE.md Progress Discipline).

---

## Why the examples look terrible — root-cause diagnosis

Reproduced by serving the built SO app (`PORT=5176 node examples/stackoverflow/scripts/serve.mjs`)
and screenshotting `/` and `/questions/q1` with Playwright. The page renders **almost entirely
unstyled**: visible `<li>` bullets, default blue underlined links, brand text "DODevOverflow" and
nav "QuestionsTagsUsers" with no spacing, avatars reading "ANAnonymous", no cards, no layout. Three
independent defects stack up:

### Root cause A — runtime `style.emitAtomicCss` emits **unitless** pixel lengths (the big one)

The example components author styles with `@kovojs/style` `style.create(...)` using bare numbers
(`fontSize: 12`, `gap: 8`, `maxWidth: 832`, `paddingInline: 24`, …) and ship them as critical CSS
via `style.emitAtomicCss(...)` (e.g. `soChromeStyleCss`, `questionListStyleCss`,
`questionDetailStyleCss` in `examples/stackoverflow/src/components/*.tsx`, inlined by
`stylesheet('./styles.css', { criticalCss: [...] })` in `src/interactive-app.tsx:28`).

The `@kovojs/style` engine emits those bare numbers **without a unit** → the served `<style>` block
contains invalid declarations: `max-width:832`, `gap:8`, `font-size:12`, `padding-inline:24`. The
browser drops every one. **98 unitless length declarations on the SO home page alone** (counted from
the served HTML's inline critical CSS). That kills nearly all spacing, sizing, and typography, so the
layout collapses to the default block flow seen in the screenshots.

This is a **known latent gap**, documented in `packages/compiler/src/package-styles.ts:173-225`:
the comment says "The engine emitting unitless values is a latent gap." The compiler's
`package-css` path papers over it with `normalizeNumericLengths()` (appends `px` to bare-number
lengths, skipping a `UNITLESS_CSS_PROPERTIES` allowlist) — which is why the **compiler-generated**
`src/generated/kovo-ui.css` correctly has `font-size:12px`. But the **runtime** `emitAtomicCss`
path the examples use does NOT run that normalizer, so every example that emits CSS at runtime is
broken. Confirmed scope: `commerce` (5 emit sites), `crm` (4), `stackoverflow` (3) all use the raw
runtime path.

### Root cause B — the served `/assets/styles.css` is a **stale build artifact**

`scripts/serve.mjs` serves `dist/assets/*` as immutable built assets and only falls through to Vite
for app routes. The committed `examples/stackoverflow/dist/assets/styles.css` (and `crm`'s, both
5185 bytes) is an **old build**: it contains a Tailwind-style utility set (`.mx-auto`, `.bg-orange-500`,
`.text-sm`, …) and **zero `kv-` atomic classes** — it predates the migration to `@kovojs/style`.
The current source `src/styles.css` only `@import`s `./generated/kovo-ui.css` (the
badge/card/button/avatar primitive classes), which the stale dist never picked up. Net effects:

1. Every `@kovojs/ui` primitive (Badge, Card, Button, Avatar) is unstyled — its classes exist in
   `generated/kovo-ui.css` but aren't in the served sheet.
2. The critical-CSS swap makes it worse: the inline `<style data-kovo-critical-href="/assets/styles.css">`
   is the runtime fallback that gets superseded once the external sheet loads. The external sheet is
   the stale, class-less file, so after load the page loses even the (already unit-broken) inline styles.

### Root cause B′ — a SECOND engine gap: invalid `@layer` names (found during implementation)

`emitAtomicCss` also emitted `@layer kovo-style.1000` — a layer-name segment cannot start with a
digit, so a browser drops the **entire** at-rule block. The compiler's `normalizeLayerNames` fixed
this for served package CSS (`kovo-style.1000` → `kovo-style-1000`) but, like the px gap, the runtime
emit path did not. So even after the px fix the critical CSS still failed to apply until the layer
names were also made valid at the engine. (The "stale committed `dist`" angle in B turned out to be a
red herring: the committed `styles.css` is authored-resets-only and the redesign dropped `@kovojs/ui`
entirely, so no `generated/kovo-ui.css` is needed — all styling rides the inline critical CSS.)

### Root cause C — even fully styled, the SO demo is a generic clone, not "Stack Overflow"

The current design is "DevOverflow" with an orange seed and a centered 832px column. Real Stack
Overflow has a distinct, recognizable shell that the demo does not attempt: a white top bar with the
orange-stacks logo + global search, a **left sidebar** nav (Home / Questions / Tags / Users), an
"All Questions" header with an orange **Ask Question** button top-right, and question rows whose
left rail shows **votes / answers / views** stat blocks (accepted answers in a green outlined box),
blue title links, blue tag pills (`#e1ecf4` bg / `#39739d` text), and an author "user card" bottom-right.
Matching that is a design pass on top of the mechanical fixes.

---

## Plan

### Phase 1 — Fix the CSS pipeline so authored styles actually render (unblocks everything)

- [x] **A1. Close the unitless-length gap at the engine level.** Added shared `UNITLESS_CSS_PROPERTIES`
      + `cssLengthValue()` to `packages/style/src/internal.ts`; `atomicRule` now appends `px` to
      bare-number lengths (class-name hash still uses the raw value, so `style.attrs` stays in
      lockstep). `packages/compiler/src/package-styles.ts` imports the shared set; its
      `normalizeNumericLengths` is now idempotent defense-in-depth. Evidence: new test in
      `packages/style/src/index.test.ts` ("emits browser-valid lengths…") asserts `max-width:832px`,
      `gap:8px`, and that `0`/`line-height`/`z-index`/`opacity`/`flex-shrink` stay unitless. Commit
      `64c4abb9`. SPEC §6.1.1.
- [x] **A1b. Fix the invalid-`@layer`-name gap (Root cause B′).** `emitAtomicCss` now emits
      `@layer kovo-style-<priority>` (was `kovo-style.<priority>`). Updated the 3 affected assertions
      (`packages/style/src/index.test.ts`, `compiler/src/structural-jsx-ir.test.ts`, `compiler/src/style.test.ts`).
      Commit `64c4abb9`.
- [x] **B. styles.css stays authored-resets-only.** Resolved by the redesign dropping `@kovojs/ui`
      (no `kovo-ui.css` needed); `examples/stackoverflow/src/interactive-app.test.ts` enforces
      "no `./generated/` in styles.css" and passes. Built `dist` is git-ignored, so no stale-artifact trap.
- [x] **B2. Critical-CSS handoff verified.** With the external sheet loaded (`networkidle`), the page is
      fully styled — the inline critical `<style>` persists; styling does not depend on a superseding sheet.

### Phase 2 — Make Stack Overflow look like Stack Overflow — **DONE (commit `e3bb73de`)**

- [x] **C1. Shell** (`chrome.tsx`): orange-hairline white top bar with the stacks logo + "stack overflow"
      wordmark + search + Log in/Sign up; left sidebar (Home/Questions(active)/Tags/Users/Companies).
- [x] **C2. Question-list row** (`question-list.tsx`): votes / answers (green box) / views stat rail,
      blue title, 2-line excerpt, light-blue tag pills, bottom-right user card; "All Questions" header
      with the blue **Ask Question** button and filter tabs.
- [x] **C3. Question detail** (`question-detail.tsx`): vote gutter + body + tags + user card, "N Answers"
      heading, accepted-answer check, and the "Your Answer" composer.
- [x] **C4. Seed polish** (`demo-data.ts`): presentation-only overlay enriches the base q1/q2 rows
      (authors, tags, bodies) so the first rows read convincingly.
- Note: compiler-lowered components must inline literal style values (the static extractor cannot
  resolve an imported palette object → `KV236`); the SO palette is literals in the two lowered
  components and the shared `so` object only in the runtime-rendered chrome. Filter tabs are unrolled
  (no conditional-spread `style=`, which also tripped `KV236`).

### Phase 3 — Functionality works — **DONE**

- [x] **D1. Interactive flows verified in a real browser** (Playwright): upvote score morphs 0→1 in
      place; ask adds a row (7→8); answer adds one (2→3) — all mutations 200. **Fixed a real bug:** the
      browser upvote silently 422'd because the runtime JSX auto-injects a CSRF field for
      `<form mutation={…}>` and the example added a second one manually → duplicate `csrf` parsed as an
      array → validation failed. Dropped the manual field on the runtime `voteButton`; kept it on the
      compiler-lowered `postQuestion`/`postAnswer` forms (whose `mutation` prop is stripped during
      lowering, so nothing is auto-injected).
- [x] **D2. Gates:** `interactive-app.test.ts` 6/6; `npx vitest run packages` adds zero regressions
      (13 pre-existing failures, confirmed by base comparison); tsc adds zero new errors.

### Phase 4 — Other examples — engine fix applied; polish open

- [x] **Engine fix lands for all** — `commerce` and `crm` now render correctly (were near-unstyled).
- [x] **E2. crm** — renders cleanly and is fully functional (Create-deal mutation round-trips, 200).
- [ ] **E1. commerce** — renders (product list/cart) but is **sparse**: needs header chrome, a real
      storefront layout, and styled buttons. Functional note: add-to-cart 422s **without login** because
      `commerceCsrf.sessionId = request.session?.id` and the anonymous served session has no id — this is
      commerce's auth design (log in via `auth-forms.tsx` first), pre-existing, not a regression.
- [ ] **E3. devtool / gallery / reference** — no `serve.mjs` (different harness); screenshot-audit each
      and polish. `gallery` had a large pending generated diff in the parent tree — reconcile separately.
- [ ] **Framework follow-up (high value):** compiler-lowered `enhance` + `mutation` forms do **not**
      auto-inject CSRF (the runtime does, keyed on the `mutation` prop the lowering strips). Today each
      example must add `csrfField` manually on lowered forms (SO, crm) — and `commerce` simply doesn't,
      so its forms are CSRF-less by construction. Making the lowering emit the CSRF field (as it already
      emits `kovo-form-key`) would fix this class of bug once for all examples and remove the per-example
      manual call. Out of scope for this branch (compiler change); track separately.

---

## Verification protocol (use for every visual checkbox)

1. Build the example, start its server (`PORT=<p> node examples/<name>/scripts/serve.mjs`).
2. Screenshot with Playwright (resolve the binary at
   `node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs`); capture `fullPage`
   with `waitUntil:'networkidle'` so the critical-CSS swap has completed.
3. Diff against the intended design; iterate. Attach before/after to the closing evidence line.

**Reproduction recorded this session (the "before"):** SO `/` and `/questions/q1` rendered unstyled;
inline critical CSS had 98 unitless length declarations and `@layer kovo-style.NNNN` invalid blocks.
Both eliminated by the engine fix (verified: `max-width:832px`, `@layer kovo-style-2000` in the
served critical CSS; pages fully styled at `networkidle`).

---

## Notes / open questions (remaining)

- The engine-level fix (A1/A1b) was the highest-leverage item — one change unblocked every
  runtime-emit example and removed two documented latent gaps. The expected `@kovojs/style` test churn
  was limited to ~5 layer-name assertions (no length-snapshot churn — committed package CSS already
  carried `px` via the compiler).
- **commerce polish + devtool/gallery/reference polish** are the open aesthetic items (Phase 4).
- **Compiler CSRF auto-injection for lowered forms** is the open framework item — see Phase 4. It is
  the clean fix for commerce's add-to-cart and would let SO/crm drop their manual `csrfField` calls.
