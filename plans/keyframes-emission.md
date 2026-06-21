# StyleX `@keyframes` emission — make `style.keyframes()` produce extractable CSS

**Goal:** Make `style.keyframes(...)` an end-to-end feature: it should emit a real `@keyframes` block
into the extracted CSS (and survive `kovo add` vendoring), so `@kovojs/ui` components can ship CSS
keyframe animations. Today it is **name-only**, which is why the gallery UX overhaul had to strip the
skeleton pulse, progress indeterminate slide, and tabs fade (`plans/better-components-ux.md` D /
`plans/more-ui-primitives.md` D). This plan implements the emission and restores those animations.

**Status (2026-06-20):** Implemented end-to-end on `agent/keyframes-emission`. Engine emits the
`@keyframes` block via `createKeyframes` (`{ name, css }` on `@kovojs/style/internal`); the compiler
extractor recognizes `style.keyframes`, binds the name (lifts KV236), and threads the deduped block into
extracted CSS; skeleton pulse / progress indeterminate slide / tabs panel fade restored.

**Latest verification:** `npx vitest run packages/style packages/compiler/src/{package-styles,style}.test.ts
packages/ui/src/{skeleton,progress,tabs}.stylex.test.tsx packages/cli/src/index.kovo-add.test.ts` → 68
passed. Full `packages/ui packages/compiler` → 762 passed. `vp check --no-fmt` on
`packages/{style,compiler,ui}/src` → clean. `api-surface-gate` baseline unchanged (new exports are
`@internal`). Build: `site/scripts/emit-ui-css.mjs` emits each `@keyframes` once with linked
`animation-name` atoms.

**Behavior source of truth:** `SPEC.md` (§6.1.1 atomic CSS, §13.1 StyleX component styles extract into
CSS assets, §5.2 typed-facts extraction / **KV236**), `rules/compiler-hard-rules.md`,
`rules/api-surface.md`. Styling stays **StyleX-only** (no hand-authored `.css`). Mark `- [x]` only when
this session verifies the cited test for the exact item.

---

## Background — two gaps, confirmed

1. **The engine never emits the `@keyframes` block.** `keyframes(frames, identity)`
   (`packages/style/src/engine.ts:459`) only returns a deterministic **name**
   (`kv-<slug>-<hash>`); it does not produce any `@keyframes <name> { … }` CSS. So even at runtime the
   animation name resolves to nothing — there is no keyframes definition anywhere.
2. **The compiler extractor rejects it.** The static StyleX extractor
   (`packages/compiler/src/style.ts:1251`, **KV236**) only resolves "literals, same-file
   defineVars/createTheme values, and public theme token references." A `style.keyframes(...)` const
   referenced by variable in `animationName` is none of those, so the rule — and, per the A5 coverage
   gate (`packages/compiler/src/package-styles.test.ts`), the component's whole CSS — is dropped.

Net: any component using `style.keyframes` ships **unstyled**. The prior pass removed three animations
to keep the A5 gate green; this plan restores them properly.

---

## Design

Implement keyframes CSS end-to-end, mirroring how `defineVars`/`createTheme` are already handled.

1. **Engine — emit the `@keyframes` CSS.** Add a keyframes-CSS emitter alongside `keyframes()`: turn
   the `Keyframes` object (`{ '0%': {…}, '50%': {…} }`) into `@keyframes <name> { <step> { <decls> } }`,
   reusing the engine's existing declaration normalization (property casing + the unitless-length
   handling that `emitAtomicCss`/`createAtomicStyles` already apply, so `transform`/`opacity`/lengths
   serialize identically to atomic rules). Expose a structured result (`{ name, css }`) through
   `@kovojs/style/internal` for the compiler (mirroring `createAtomicStyles`), and include it in the
   runtime `emitAtomicCss` path so runtime emitters get it too.
2. **Compiler — recognize + extract + thread.** In `style.ts`, recognize `style.keyframes(...)` calls
   where `defineVars`/`createTheme` are recognized (~L280–315): compute the name and add it to
   `staticValues` so `animationName: <kfConst>` resolves to the literal name (this lifts **KV236** for
   keyframes consts), and collect the `@keyframes` block. Thread the block into the extracted CSS
   assembled by `package-styles.ts` (chunks → `dedupeCss`), deduped so a keyframe used by multiple
   components emits once.
3. **Restore the animations.** Re-add the StyleX keyframes + `animationName` to `skeleton.tsx` (pulse),
   `progress.tsx` (indeterminate slide), `tabs.tsx` (panel fade), reverting the static fallbacks from
   the prior pass.

---

## Plan

### Phase 0 — Investigation

- [x] Engine: `keyframes()` (engine.ts), `createAtomicStyles`/`emitAtomicCss`, and the shared
      `cssLengthValue`/`toKebabCase` declaration normalization in `internal.ts` reviewed.
- [x] Compiler: `defineVars`/`createTheme` recognition + `staticValues` (`style.ts` collectStyleEnvironment),
      KV236 site (`staticStyleDiagnostic`), and `package-styles.ts` `chunks`→`dedupeCss` assembly reviewed.
- [x] A5 gate: `package-styles.test.ts` `diagnostics` must stay `[]` with keyframes components present.

### Phase 1 — Engine: emit `@keyframes` CSS

- [x] `createKeyframes(frames, identity)` → `{ name, css }` reusing `cssLengthValue` + kebab-casing;
      exported via `@kovojs/style/internal`; `emitAtomicCss` gains a `keyframes` option (deduped, outside
      `@layer`). `keyframes()` delegates (name unchanged). engine.ts.
- [x] Engine unit tests: frames→CSS, unit/casing parity with atomic rules, stable name, emitAtomicCss
      dedup. `packages/style/src/index.test.ts` (32 passed).

### Phase 2 — Compiler: recognize + extract + thread keyframes

- [x] `styleKeyframesCall`/`isStyleKeyframesCall` recognize `style.keyframes(...)`; name added to
      `staticValues` (lifts KV236); `@keyframes` blocks threaded via `emitAtomicCss({ keyframes })` and
      deduped across the combined stylesheet in `package-styles.ts` (`dedupeKeyframeBlocks`).
- [x] Compiler tests: extractor unit test (block emitted, no KV236) in `style.test.ts`; A5 gate empty +
      each block once in `package-styles.test.ts`; `index.kovo-add.test.ts` green (vendored skeleton/
      progress/tabs compile with `diagnostics: []`).

### Phase 3 — Restore the animations

- [x] keyframes restored: `skeleton.tsx` (pulse), `progress.tsx` (indeterminate slide), `tabs.tsx`
      (panel fade); `progress.stylex.test.tsx.snap` updated; skeleton/tabs inline assertions updated;
      A5 gate empty + `kovo add` green.
- [x] `site/scripts/emit-ui-css.mjs` build: `kovo-ui.css` carries each `@keyframes` once
      (`kv-skeleton-pulse-*`, `kv-progress-indeterminate-*`, `kv-tabs-panel-fade-*`) with matching
      `animation-name` atoms.

### Phase 4 — Docs

- [x] SPEC §13.1 notes `style.keyframes(...)` extracts a deduped `@keyframes` asset. New exports
      (`createKeyframes`, `KeyframesResult`) are `@internal`; api-surface baseline unchanged.

---

## Verification protocol

- Engine unit tests (frames → CSS, normalization parity). Compiler: extractor unit test + the A5
  coverage gate (`package-styles.test.ts`) empty + `index.kovo-add.test.ts` (no KV236). Component:
  the three stylex snapshots. Integration: `pnpm exec vp check`, `npx vitest run`, `check:api-surface`,
  `check:build` (kovo-ui.css emits the keyframes).
- If a fix conflicts with `SPEC.md`, follow SPEC and record it.

## Risks & non-goals

- **Risk:** core extractor change (a bug drops or duplicates component CSS); keyframe-declaration
  normalization must match atomic-rule normalization exactly (units, casing) or the animation renders
  subtly wrong; `@keyframes` dedup across components.
- **Non-goals:** dynamic/computed keyframes, animation shorthand parsing, per-instance keyframes — only
  static, same-file `style.keyframes(...)` consts.
