# More UI Primitives — close the deferred behavioral gaps from the gallery UX overhaul

**Goal:** Land the framework/primitive-level capabilities that `plans/better-components-ux.md` had to
defer, so the remaining `@kovojs/ui` components behave correctly instead of being visually-patched
only: avatar load/error state, scroll-area imperative scroll, checkbox-group select-all native form
state, and CSS keyframe animations (skeleton pulse / progress indeterminate / tabs fade). Each
deferral traces to one of two framework gaps — **reactive `data-bind:*` is attribute-only** (it never
sets a live element property or reacts to a DOM event) and **the StyleX extractor can't resolve
`style.keyframes(...)`** — plus a couple of component-local model choices.

**Status (2026-06-20):** Planning. Builds on the merged `better-components-ux` work; see its
"Deferred" section for the original evidence.

**Behavior source of truth:** `SPEC.md` (§4.6 chained client handlers; §5.2 TSX-authored
components + KV235; §6.1.1 atomic CSS / §13.1 stylesheet extraction; §12.x accessibility),
`rules/compiler-hard-rules.md`, `rules/api-surface.md` (any new exports), `rules/accessibility-conformance.md`.
Styling stays **StyleX-only** reading `uiTheme`; demos stay **compiled TSX**; client behavior comes
from `packages/headless-ui` primitives + generated islands (mirror existing primitives, e.g.
`hover-card.ts` event→state handlers, `slider.ts` pointer handlers). Mark `- [x]` only when this
session verifies the cited test/command for the exact item (CLAUDE.md Progress Discipline).

---

## Background — the two framework gaps

1. **`data-bind:*` is attribute-only.** The browser loader applies bindings with
   `setAttribute`/`removeAttribute` (confirmed in `packages/browser/src` morph/handler apply paths).
   It never assigns a live DOM **property** (`el.scrollTop`, `el.checked`, `el.indeterminate`) and
   never reacts to a DOM **event** (`<img> load`/`error`). So any behavior that needs a live property
   or an event can't be expressed by binding an attribute — it needs a **client island** (event →
   handler → state) or an **imperative client action**.
2. **`style.keyframes(...)` isn't statically extractable.** The StyleX extractor
   (`packages/compiler/src/style.ts:1251`, **KV236**) "only accepts literals, same-file
   defineVars/createTheme values, and public @kovojs/style theme token references." A keyframes name
   bound through a const variable in `animationName` is none of those, so the rule (and, per the A5
   coverage gate, the component's whole CSS) is dropped → it would ship unstyled.

---

## Items

### A. Avatar load/error island

- **Problem:** a real `<img>` that 404s stays `data-state="loading"` forever and the image + initials
  fallback coexist; `packages/headless-ui/src/primitives/avatar.ts` is a pure attribute builder with
  no client behavior.
- **Approach:** add `avatarImageLoad` / `avatarImageError` client handlers to `avatar.ts` (mirroring
  `hover-card.ts`'s event→state functions) that flip `status` → `loaded` / `error`; the avatar root
  re-renders `data-state` from `status` (CSS already hides image-on-error / fallback-on-loaded).
  Make the avatar gallery demo interactive (TSX `onLoad`/`onError`, added to the gallery
  `compiledDemos`) so a real failing/succeeding image drives the state.
- **Verify:** a new `avatar.test.ts` case for the handlers; a gallery browser test mounting the avatar
  demo, firing `load`/`error`, asserting `data-state` + fallback visibility; demo renders loaded
  images with no console 404 for the loaded one.

### B. scroll-area imperative "Jump to end"

- **Problem:** the demo sets `state.scrollTop` and binds it, but `data-bind:scrolltop` writes a no-op
  attribute; nothing scrolls. A prior inline attempt hit **KV201** (closure captured an unserializable
  value).
- **Approach:** add a `scrollAreaScrollTo` client action in `scroll-area.ts` that reaches the viewport
  **through the event** (the KV201-safe pattern accordion uses: `Object(event)['target']…`, no
  captured DOM/ids) and assigns `el.scrollTop`. Wire it from the demo button's `onClick`. Also forward
  `{style:true}` in `ScrollAreaViewport`'s `passThroughProps` so the demo's inline `max-height`
  applies. (Confirm this needs no compiler change; if a generic imperative-property binding is cleaner,
  evaluate it but prefer the local client action.)
- **Verify:** `scroll-area.test.ts` for the action (sets `.scrollTop` on a fake element); the demo
  compiles without KV201; gallery browser test asserts the viewport scrolls on click.

### C. checkbox-group select-all native form state

- **Problem:** a styled select-all `Checkbox` regressed the group's native `.checked` form state
  (`FormData.getAll(...)` kept a stale item after toggling off), because `data-bind:checked` sets the
  **attribute** but FormData reads the **property**, which browsers don't resync from attribute
  changes after interaction.
- **Approach (preferred, no compiler change):** make the group submit through a **single hidden
  aggregate input** carrying the comma-joined value (the pattern `otp-field` already uses), so the
  visible `CheckboxGroupControl` items are presentational and their native `.checked` no longer drives
  FormData. Then the styled select-all `Checkbox` can return (item B8 in the prior plan). **Fallback:**
  if a hidden aggregate is undesirable, add a property-binding client action that assigns `.checked`
  on the visible inputs.
- **Verify:** gallery browser test — toggle select-all on/off, assert `FormData.getAll(...)` matches
  the value across all transitions; aria-checked/data-state correct; axe-clean.

### D. CSS keyframe animations (skeleton pulse, progress indeterminate, tabs fade)

- **Problem:** `style.keyframes(...)` by variable trips KV236 + the A5 coverage gate; the prior pass
  removed them, leaving static styling.
- **Approach:** teach the extractor (`packages/compiler/src/style.ts` around the KV236 site + value
  resolver) to resolve a **same-file `style.keyframes(...)` const** the way it already resolves
  `defineVars`/`createTheme`: emit the `@keyframes` block into the extracted CSS and substitute the
  generated name into `animationName`. Then restore the three animations. (If extractor support proves
  too invasive, fall back to a sanctioned non-keyframes technique — e.g. progress slide via a
  transform transition — and keep skeleton/tabs static; record the decision.)
- **Verify:** `packages/compiler/src/package-styles.test.ts` A5 gate stays empty (no unstyled
  components) **with** keyframes present; `style.ts` extractor unit test for a keyframes const; the
  three `*.stylex.test.tsx` snapshots include the `@keyframes` + animation classes; `kovo add` vendor
  test (no KV236).

### E. OTP per-slot value robustness (low priority)

- **Problem:** the per-slot value can't be sliced in a `data-bind` path (no indexing); the prior pass
  reverted to the working `value={state.value[N]}` form (functions correctly client-side).
- **Approach:** confirm it still works; optionally refactor the demo to per-slot state fields
  (`s0..s3`, valid dot-paths) for clarity/robustness. Only do this if it doesn't regress the OTP
  browser tests.
- **Verify:** existing OTP browser/primitive tests stay green.

---

## Plan

### Phase 0 — Mechanism investigation (confirm approach per item)

- [ ] Read the browser binding-apply path (`packages/browser/src` morph/handler-context/inline-loader)
      to confirm attribute-only application and whether a property-binding hook is warranted vs.
      per-component client actions.
- [ ] Read the StyleX extractor value resolver around `style.ts:1251` to scope keyframes support (D).
- [ ] Confirm the avatar (A) + scroll-area (B) client-island wiring against an existing primitive
      (`hover-card.ts` / `slider.ts`) and the gallery harness.

### Phase 1 — Avatar load/error island (A)

- [ ] `avatar.ts` `avatarImageLoad`/`avatarImageError` handlers + types; re-render `data-state`.
- [ ] Make the avatar gallery demo interactive (compiled island) with `onLoad`/`onError`.
- [ ] Tests: `avatar.test.ts` + gallery browser test; new exports baselined if any.

### Phase 2 — scroll-area imperative scroll (B)

- [ ] `scrollAreaScrollTo` client action (event-reached viewport, KV201-safe) + `{style:true}`
      forwarding on `ScrollAreaViewport`.
- [ ] Wire the demo button; tests (primitive + gallery browser).

### Phase 3 — checkbox-group select-all (C)

- [ ] Hidden-aggregate form model (or property-binding fallback); restore the styled select-all.
- [ ] Gallery browser test across all toggle transitions (FormData + aria + axe).

### Phase 4 — Keyframe animations (D)

- [ ] Extractor: resolve same-file `style.keyframes(...)` consts (emit `@keyframes` + substitute name);
      extractor unit test.
- [ ] Restore skeleton pulse, progress indeterminate slide, tabs fade; update `*.stylex.test.tsx`
      snapshots; A5 gate empty; `kovo add` vendor test green.

### Phase 5 — OTP robustness (E) + integration

- [ ] Confirm/optionally refactor OTP; keep its tests green.
- [ ] Full gates in the worktree: `pnpm exec vp check`, `npx vitest run`, gallery `test:browser`,
      `check:api-surface`; then merge to main.

---

## Verification protocol

- Per item: a focused primitive/unit test for the new behavior **plus** a gallery browser test
  exercising it through the real hydration path (`mountInteractiveDemo` + `installInteractiveGalleryLoader`).
- Integration gate before merge: `pnpm exec vp check` (tsc/lint, 1400+ files clean),
  `npx vitest run` (non-browser; the commerce/tutorial 60s tests pass in isolation under low load),
  the gallery browser suite, and `node scripts/api-surface-gate.mjs` (run `--write` only for genuinely
  new public exports).
- If a fix conflicts with `SPEC.md`, follow SPEC and record it.

## Non-goals (separate follow-ups)

- **Vaul drawer drag/snap/background-scale** — large gesture feature; own ledger.
- **Visual-baseline CI regeneration** (`interactive-gallery.visual.browser.test.ts`) — its screenshot
  hashes are CI-environment-specific (fail locally even on `main`); regenerate on CI, not here.
- A **generic compiler `data-bind-prop:*`** (loader-applied live-property binding) — would unify B/C
  and future cases, but this plan prefers narrower per-component client actions; promote it to its own
  plan if the per-component approach proves repetitive.
