# StyleX `@keyframes` emission — make `style.keyframes()` produce extractable CSS

**Goal:** Make `style.keyframes(...)` an end-to-end feature: it should emit a real `@keyframes` block
into the extracted CSS (and survive `kovo add` vendoring), so `@kovojs/ui` components can ship CSS
keyframe animations. Today it is **name-only**, which is why the gallery UX overhaul had to strip the
skeleton pulse, progress indeterminate slide, and tabs fade (`plans/better-components-ux.md` D /
`plans/more-ui-primitives.md` D). This plan implements the emission and restores those animations.

**Status (2026-06-20):** Planning. Framework feature (`@kovojs/style` engine + compiler extractor).
Core-extractor change → high blast radius; sequence engine-first, then compiler, then restore.

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

- [ ] Engine: read `keyframes()` (`engine.ts:459`) + `createAtomicStyles`/`emitAtomicCss` to find the
      declaration-normalization helpers to reuse and the structured-result shape to extend.
- [ ] Compiler: read the `defineVars`/`createTheme` recognition + `staticValues` population (`style.ts`
      ~L280–315) and the KV236 site (~L1251); read `package-styles.ts` CSS assembly (`chunks` +
      `dedupeCss`) for where `@keyframes` blocks attach + dedup.
- [ ] A5 gate: `package-styles.test.ts` expectations (currently empty) — keyframes components must stay
      out of the "unstyled" list once emission lands.

### Phase 1 — Engine: emit `@keyframes` CSS

- [ ] Keyframes-CSS emitter (frames → `@keyframes <name> { … }`) reusing declaration normalization;
      structured `{ name, css }` via `@kovojs/style/internal`; include in `emitAtomicCss`.
- [ ] Engine unit tests: frames → expected CSS, unit/normalization parity with atomic rules, stable
      deterministic name.

### Phase 2 — Compiler: recognize + extract + thread keyframes

- [ ] Recognize `style.keyframes(...)`; add the name to `staticValues` (lift KV236 for keyframes
      consts); collect the `@keyframes` block and thread it into the extracted component CSS, deduped.
- [ ] Compiler tests: extractor unit test (keyframes const resolves + block emitted); A5 gate stays
      empty with a keyframes-using component; `kovo add` vendor test (no KV236 on vendored component).

### Phase 3 — Restore the animations

- [ ] Re-add keyframes to `skeleton.tsx` (pulse), `progress.tsx` (indeterminate slide), `tabs.tsx`
      (panel fade); update the three `*.stylex.test.tsx` snapshots to include `@keyframes` + animation
      classes; confirm A5 gate empty + `kovo add` green.
- [ ] (Optional) verify the rendered `kovo-ui.css` contains the `@keyframes` blocks once, via the
      site/gallery build.

### Phase 4 — Docs

- [ ] SPEC §13.1/§6.1.1 note that `style.keyframes` extracts an `@keyframes` asset; `api-surface` if any
      new export.

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
