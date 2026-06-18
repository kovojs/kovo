# Awesome Examples — Make the demos look great (and actually work)

**Goal:** The example apps (`examples/stackoverflow`, `commerce`, `crm`, plus `devtool`,
`gallery`, `reference`) should look polished and intentional, not broken. The Stack Overflow
example specifically should **read as Stack Overflow** — recognizable layout, color, and
typography — while staying fully functional (upvote / ask / answer flows really work).

**Status:** Diagnosis complete (2026-06-18). Root causes proven from a running server +
screenshots. Implementation not started.

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

- [ ] **A1. Close the unitless-length gap at the engine level.** Make `@kovojs/style`'s atomic CSS
      emit browser-valid lengths so the runtime `emitAtomicCss` path matches the compiler's served
      output. Preferred: lift `normalizeNumericLengths` + the `UNITLESS_CSS_PROPERTIES` allowlist out
      of `packages/compiler/src/package-styles.ts` into `@kovojs/style` and apply it inside the emit
      so bare-number lengths get `px` (keeping the class-name hash on the raw value, per the existing
      comment's lockstep note). Update `packages/compiler` to consume the shared normalizer instead of
      its private copy. SPEC §6.1.1.
      - Risk: this will churn `@kovojs/style` and example/UI CSS snapshots — budget for snapshot
        regen and an api-surface check. Verify the class-name hash is unchanged (so `style.attrs`
        output and the stylesheet stay in lockstep).
      - Evidence to capture: a `@kovojs/style` unit test asserting `style.emitAtomicCss` produces
        `max-width:832px` / `gap:8px` (not `:832`/`:8`), and that `opacity`/`z-index`/`line-height`
        stay unitless.
- [ ] **A2. If A1 is deferred,** apply the normalizer to the examples' critical-CSS strings at the
      call site (wrap `soChromeStyleCss` etc.) as a stopgap. Prefer A1; record here only if A1 is
      blocked and why.
- [ ] **B1. Regenerate every example's served stylesheet and stop committing stale `dist`.** Re-run
      `pnpm --filter @kovojs/example-stackoverflow run emit-ui-css` then `vp build` so
      `dist/assets/styles.css` carries the current `generated/kovo-ui.css` (assert `kv-badge`,
      `kv-card`, `kv-button` classes present and non-zero `kv-` count). Decide and document whether
      built `dist` should be git-ignored for examples (serve builds on demand) vs. committed-and-fresh;
      a stale committed `dist` is the trap here. Apply the same to `crm`/`commerce`.
- [ ] **B2. Verify the critical-CSS handoff.** After A1+B1, confirm that with the external sheet
      loaded the page is fully styled (no regression when the inline critical `<style>` is superseded).
      Screenshot `/` with `waitUntil:'networkidle'` and confirm cards/spacing survive.

### Phase 2 — Make Stack Overflow look like Stack Overflow

- [ ] **C1. Shell redesign** (`src/components/chrome.tsx`): white top bar with logo + (visual) global
      search, a left sidebar nav (Home / Questions / Tags / Users), main content to the right. Match
      SO color tokens via `src/theme.ts`: link blue `#0074cc`/`#0a95ff`, tag pill `#e1ecf4`/`#39739d`,
      Ask-button orange `#f48024`, neutral `#232629` text on `#ffffff`/`#f8f9f9` surfaces.
- [ ] **C2. Question-list row** (`src/components/question-list.tsx`): left stat rail with votes /
      answers / views blocks (accepted-answer count in a green outlined box), blue title link,
      2-line excerpt, blue tag pills, bottom-right author user-card with rep + relative time. "All
      Questions" / "Top Questions" header with the orange **Ask Question** button top-right.
- [ ] **C3. Question detail** (`src/components/question-detail.tsx`): large vote gutter (caret / score
      / caret), question body, accepted-answer check, answer list with the same vote gutter, and the
      "Your Answer" composer matching SO spacing/typography.
- [ ] **C4. Seed data polish** (`src/demo-data.ts`): realistic titles, tags, view counts, and author
      names/reputation so the populated page reads convincingly (avoid "Anonymous" avatars).

### Phase 3 — Functionality must still work (regression gate)

- [ ] **D1. Interactive flows verified end-to-end** against a running server: upvote increments and
      morphs in place; Ask question posts and the new row appears; duplicate-title shows the
      `FormError`; post-answer adds an answer and refreshes the detail region. Prove with the existing
      `src/interactive-app.test.ts` plus a manual screenshot of a post-upvote state.
- [ ] **D2. Run example gates:** `pnpm --filter @kovojs/example-stackoverflow test` and the repo
      `vp run typecheck-examples`; refresh demo snapshots only where the visual change is intended.

### Phase 4 — Apply the same treatment to the other examples

- [ ] **E1. commerce** — same Phase-1 fix benefits it (5 runtime emit sites). Screenshot-audit `/`
      and a product page; polish to a credible storefront.
- [ ] **E2. crm** — stale `dist/assets/styles.css` confirmed (0 `kv-` refs). Re-emit + redesign list/detail.
- [ ] **E3. devtool / gallery / reference** — screenshot-audit each, fix any remaining unstyled
      regions, confirm the gallery demos render correctly (gallery has a large pending generated diff
      in `git status` — reconcile it as part of this).

---

## Verification protocol (use for every visual checkbox)

1. Build the example, start its server (`PORT=<p> node examples/<name>/scripts/serve.mjs`).
2. Screenshot with Playwright (resolve the binary at
   `node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.mjs`); capture `fullPage`
   with `waitUntil:'networkidle'` so the critical-CSS swap has completed.
3. Diff against the intended design; iterate. Attach before/after to the closing evidence line.

**Reproduction recorded this session (the "before"):** SO `/` and `/questions/q1` render unstyled;
inline critical CSS has 98 unitless length declarations; served `/assets/styles.css` is 5185 bytes
with 0 `kv-` classes. These are the baselines Phase 1 must eliminate.

---

## Notes / open questions

- A1 (engine-level unit fix) is the highest-leverage item — it fixes all three runtime-emit examples
  at once and removes a documented latent gap. Sequencing: A1 → B1 → screenshot-verify → design.
- Confirm whether examples should commit `dist` at all. If kept, add a check that `dist` is fresh
  (or build in CI) so a stale artifact can't silently break the served styles again.
- The `@kovojs/style` snapshot churn from A1 is expected and acceptable; treat snapshot regen as part
  of the slice, not a surprise.
</content>
</invoke>
