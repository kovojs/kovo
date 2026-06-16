# StyleX as Kovo's official styling layer (fork-first)

Status: **active investigation → implementation plan**. Created 2026-06-16.

`SPEC.md` is normative. This plan replaces Tailwind with a **Kovo-owned fork of StyleX's compiler core**
as the official styling solution, in service of three goals: (1) type-safety, (2) performance,
(3) customizability/theme-ability. Source of truth for StyleX facts is the sibling checkout
`../stylex` (StyleX `0.19.0`, MIT). A prior dependency-first evaluation is preserved at
`plans/codex-style.md`; this plan supersedes its strategic stance per the decisions below, while
borrowing its concrete API/spike detail.

## Locked Decisions (2026-06-16)

- [x] **Fork the compiler core into Kovo's compiler.** Absorb `@stylexjs/shared` (the
      framework-agnostic transform: `create`/`props`/`defineVars`/`createTheme`/styleq merge/atomic-class
      generation) and the tiny `stylex` runtime; re-home in Kovo's TS compiler. Kovo owns output shape,
      classname scheme, scoping integration, and the fixpoint gate. _Drop_ the babel/swc/postcss/rollup/
      unplugin/eslint/devtools packages — Kovo's compiler is the only host.
- [x] **Replace Tailwind everywhere.** StyleX becomes THE styling solution across starters, examples,
      docs site, and UI packages. §13.1 is rewritten from "Tailwind-first" to "StyleX-first."
- [x] **UI distribution: Model L default + eject hatch.** Publish `@kovojs/ui` as an installable library
      with typed style-object overrides; `kovo add --eject` drops to vendored source for heavy
      customization. Phase 4 still prototypes Button both ways to validate the override ergonomics, but the
      default is committed.
- [x] **Readable output is a fork requirement.** Adopt only because the fork lets Kovo emit
      provenance-prefixed, debuggable atomic classnames (not bare `x1a2b3c`) plus dev-only `data-style-src`,
      satisfying Constitution #1 (legibility is load-bearing).
- [x] **Hard fork, no upstream rebase.** Treat the port as a permanent fork; no ongoing rebase against
      upstream StyleX is planned. This removes the divergence-maintenance risk in exchange for owning the
      bug tail — acceptable because the forked surface is small (`shared` core + runtime).

## Why fork (not depend, not reimplement from scratch)

- [ ] **The fixpoint contract forces ownership (Constitution #3, §5.2).** Every compiler feature must
      lower to authorable Kovo IR that recompiles to a no-op. StyleX's babel output (injected CSS +
      hashed classes) is not Kovo source. Kovo must define the lowering and own the transform, so a
      black-box dependency cannot satisfy the gate.
- [ ] **Type-safety goal #1 wants a TS-native core, not Flow.** StyleX is authored in Flow and ships
      generated `.d.ts`. Kovo's compiler is strict-TS with lint bans on `any`/casts (§6.6). Porting the
      `shared` core to TS gives first-class types and removes a Flow toolchain from Kovo's build.
- [ ] **Readable classnames (decision 4) require controlling the emitter.** Upstream will not change its
      hashing to Kovo's provenance scheme; only the fork can.
- [ ] **The fork surface is small.** We need `create`, `props`/`attrs`, `defineVars`, `createTheme`,
      `keyframes`, `firstThatWorks`, conditional/pseudo/media handling, and the styleq runtime merge —
      `@stylexjs/shared` + a ~200-line runtime. We do **not** fork the bundler/lint/devtools constellation.
      This is closer to the pinned-Drizzle-subset model (§14) than to vendoring a framework.
- [ ] **Not a from-scratch reimplementation.** The atomic-CSS generation, property-priority ordering
      (`shared/utils/property-priorities.js`), and last-wins styleq merge are subtle and battle-tested;
      port them, do not reinvent. Track upstream selectively against a pinned conformance subset.

## Goal Fit (with the fork)

- [ ] **Type-safety (#1): strong.** Typed `create({...})` style objects replace untyped Tailwind
      strings; `style.Style` / `style.StaticStyle` / `style.StyleExcept` constrain public override props;
      typed `defineVars`/`createTheme` constrain themes. Invalid overrides become compile errors —
      directly serves §1.1's "provable by TypeScript static checking."
- [ ] **Performance (#2): strong, with a Kovo-specific gate.** Atomic CSS dedupes across the app; **static
      components merge at server render**, so the common case ships zero client styling runtime (the 4KB
      loader budget, §16, is untouched). Reactive class/style toggles already ride the §4.8 update plan.
      Open measurement: CSS bytes, HTML bytes, build time vs. the Tailwind baseline on a CSS-heavy
      fixture (Phase 6).
- [ ] **Theme-ability (#3): strong.** `defineVars` → CSS custom properties and `createTheme` → override
      classes are _exactly_ §13.1's "tokens are ordinary CSS custom properties; theming is document CSS,"
      and need no shadow boundary (§3.1).

## SPEC Tensions & Positions

- [ ] **Legibility (Constitution #1, "wire is documentation" #4).** Bare atomic hashes are opaque.
      Position: the fork emits **provenance-prefixed atomic classes** (e.g. `kv-button-bg-1a2b`) keyed to
      the originating component + property family, keeps `data-style-src` mapping element → source style
      key, and keeps atomic dedupe. Classnames were never Kovo's legibility carrier (`kovo-c` stamps and
      `data-bind` are, §4.2/§4.8) — but devtools "what is this element styled with" must still resolve to
      source. Prove the devtools/`kovo explain` story in Phase 2.
- [ ] **Fixpoint (Constitution #3, §5.2).** `style.create(...)` is sugar lowering to (a) injected atomic
      CSS rules and (b) a static `styleKey → classnames` map; component IR references resolved classnames.
      The emitted IR must be authorable Kovo source and recompile to a no-op. Add a fixpoint fixture
      (Phase 3) to the existing fixpoint CI gate.
- [ ] **Primitive merge (§4.6/§4.7).** Kovo's render-time merge concatenates+dedupes `class` and
      concatenates `style` (author last). StyleX's merge is **property-level last-wins via atomic
      classes** — richer. Position: route a component's public override through
      `style.attrs(...componentStyles, props.style)` so author overrides win per-property; teach the §4.7
      class-merge that atomic classes must not be blindly deduped in a way that breaks last-wins ordering.
      Reconcile with `asChild` / attrs-function lowering using the archived UI/compiler hardening
      evidence in `plans/archive.md`.
- [ ] **Reactive styles (§4.8/§4.9).** A class/style that depends on query data or island state (e.g.
      `state.bouncing ? styles.bounce : null`) must be driven by the §4.8 update plan, and the §4.9
      classifier must accept a StyleX style-object toggle as a `plan` position (not a KV311). Integration
      task in Phase 3.
- [ ] **Fragments/defer (§13.1, §9.1, §8).** Tailwind needed `@source inline(...)` safelists so dynamic
      classes survive in mutation fragments / `<kovo-defer>` streams. StyleX **removes this hazard**:
      styles are statically extracted from source regardless of render path, atomic classes are global and
      build-time-known, so a late fragment can only reference classes already in the page stylesheet. Keep
      Kovo's stylesheet-hint contract (emit the asset list once, same hints for page/fragment/defer).
- [ ] **`@scope` simplification (§13.1).** Atomic classes are inherently collision-free and global, so the
      co-located-CSS `@scope`/`kovo-c` extraction path is **not needed for StyleX-authored styles**. Decide
      in Phase 5 whether `@scope` extraction is retired for app styling or retained only for raw co-located
      CSS escape hatches.
- [ ] **Package prefix (§6.1.1).** If `@kovojs/ui` becomes a published package (Phase 4, Model L), it
      needs a `kovo.prefix` that enters public wire vocabulary. Vendored source stays app-named. This is a
      gating decision for the distribution model, not for adopting StyleX.

## Architecture: `@kovojs/style` (the fork)

- [ ] **New package `packages/style` (`@kovojs/style`), TS-native.**
  - Authoring API (port from `../stylex` `@stylexjs/stylex` + `shared`): `create`, `props`, `attrs`,
    `defineVars`, `createTheme`, `keyframes`, `firstThatWorks`, `defineConsts`, pseudo/media/conditional
    support, and the styleq last-wins runtime.
  - `attrs(...)` returns `{ class, style }` (StyleX already does — `../stylex/.../stylex.js:169`), which
    matches Kovo's string JSX. Prefer `attrs` over React-shaped `props` in all Kovo examples.
  - Compile-time transform re-homed inside Kovo's compiler (`packages/compiler`): extract atomic CSS,
    emit provenance-prefixed classnames, produce the `styleKey → classnames` map, and feed Kovo's
    stylesheet-hint manifest.
- [ ] **Authoring shape in components.** Replace `defineVariants` + `cn` (Tailwind) with plain
      `style.create` groups composed through a compiler-lowered `style={[...]}` JSX prop. **No variant
      helper** — defaults via destructuring, selection via typed index, compounds via inline conditionals
      (Phase 0). The variant helper was a Tailwind/CVA workaround for un-composable class strings; StyleX +
      compiler lowering makes it redundant.

  ```tsx
  import * as style from '@kovojs/style';
  import { tokens } from './button.tokens.js'; // token/theme defs live in `*.tokens.ts` files

  // Group by variant axis (separate create() calls) so keys don't collide and grouping stays legible.
  const base = style.create({
    root: { display: 'inline-flex', alignItems: 'center', borderRadius: 6, fontSize: 14 },
  });
  const variants = style.create({
    primary: { backgroundColor: tokens.accent, color: tokens.onAccent },
    secondary: { backgroundColor: tokens.surface, color: tokens.text },
    ghost: { backgroundColor: 'transparent', color: tokens.text },
  });
  const sizes = style.create({
    sm: { height: 32, paddingInline: 10 },
    md: { height: 36, paddingInline: 12 },
  });

  export const Button = component({
    render({ variant = 'primary', size = 'md', style: override, children }: ButtonProps) {
      // `style={[...]}`: array of style objects, override last (wins by position). Compiler merges
      // statically to `class="kv-button-…"` when nothing is dynamic; emits a §4.8 toggle when it is.
      return (
        <button style={[base.root, variants[variant], sizes[size], override]}>{children}</button>
      );
    },
  });
  ```

- [ ] **Override prop = typed style object, author-last in the array.** `props.style` (single-root) or a
      per-component `styles` slot map (multi-part) is the override channel and comes **last in the
      `style={[...]}` array** so app customizations win by position. Both props are `style.Style` objects —
      Kovo intentionally takes over the `style` name to discourage raw HTML `style` strings, and official
      components drop the `class` escape hatch entirely (Phase 0). **Convention:** import the package as
      `style` and give every `style.create(...)` result a descriptive name (`base`, `variants`, `sizes`,
      `dialogStyles`) so the namespace never collides with a bare `styles` local.
- [ ] **Tokens/themes.** `@kovojs/ui` ships default token vars + a default theme via `defineVars`/
      `createTheme`; apps override at the document level. Component styles reference tokens, never literal
      color systems — this is the §3 customizability story.

## UI Distribution Model — comparison (decision 3)

- [ ] **Model V — keep shadcn vendored source, swap Tailwind→StyleX inside it.**
  - Pros: no `kovo.prefix`/public-API freeze; infinite per-app customization; closest to today.
  - Cons: weaker payoff from "official StyleX"; copied components still need the StyleX build; manual
    updates/drift.
- [ ] **Model L — publish `@kovojs/ui` as an installable library with style-object overrides.**
  - Enabled _specifically_ by StyleX's deterministic last-wins merge: a published component can accept a
    typed `style`/`styles` override that reliably wins — impossible cleanly with Tailwind specificity.
  - Pros: real dependency, central updates, smaller surface, typed overrides replace source edits.
  - Cons: needs `kovo.prefix` (§6.1.1), public-API stability, package-style extraction, strong theming.
- [ ] **Recommendation to validate (not yet locked):** Model L as default **with an `eject`/copy-in
      escape hatch** (publish stable primitives as a package; `kovo add --eject` drops to vendored source
      for heavy customization). Prototype Button both ways and decide.

## Phased Checklist

- [x] **Phase 0 — API decision pass (no code).** Done 2026-06-16 — see "Resolved Decisions — Phase 0."
      Two items remain (package prefix, package CSS delivery) and are confirmed before Phase 4 freezes
      public surface.
- [ ] **Phase 1 — Fork the core into `@kovojs/style`.** Port `@stylexjs/shared` + runtime Flow→TS;
      stand up `create`/`attrs`/`defineVars`/`createTheme`; unit-test the styleq last-wins merge and
      atomic-class generation against ported upstream fixtures. **Emit cascade priority via
      `@layer`/priority buckets, not single-file source order** (splitting invariant (b) — hard to
      retrofit). _Evidence:_ `pnpm --filter @kovojs/style test`; a fixture proving two atoms in separate
      files resolve correctly regardless of link order.
  - Evidence (partial, 2026-06-16): `packages/style` added as `@kovojs/style` with TS-native
    `create`/`attrs`/`props`/`defineVars`/`defineConsts`/`createTheme`/`raw`/`firstThatWorks`/`keyframes`,
    provenance-prefixed atoms, `data-style-src`, and priority-layer CSS emission.
  - Evidence (partial, 2026-06-16): `pnpm --filter @kovojs/style test` covers property-level last-wins
    merge, raw inline escape serialization, readable atomic class generation, `@layer` priority buckets,
    cross-file priority order, typed token vars, and theme override classes.
  - Evidence (partial, 2026-06-16): `pnpm exec tsc --noEmit`,
    `pnpm exec vitest --run scripts/public-packages.test.mjs`, and
    `pnpm --filter @kovojs/style run build:dist` pass for the new package and package registration.
  - Evidence (partial, 2026-06-16): ported a focused subset from
    `../stylex/packages/@stylexjs/stylex/__tests__/stylex-test.js` into
    `packages/style/src/index.test.ts`; `pnpm --filter @kovojs/style test` now covers upstream basic
    resolve, array merge order, same-property override, nested pseudo override, source-map data, and the
    dynamic attrs fixture through Kovo's explicit `raw(...)` escape hatch.
  - Evidence (partial, 2026-06-16): `packages/style/src/index.ts` now exposes `defineConsts`, and
    `packages/style/src/index.test.ts` ports additional upstream runtime fixtures for pseudo-only
    props, the complicated nested merge-order stress case, attrs basic resolution, and dynamic props
    through Kovo's explicit `raw(...)` escape hatch.
  - Evidence (partial, 2026-06-16): `pnpm --filter @kovojs/style test`, `pnpm exec tsc --noEmit`,
    and `pnpm --filter @kovojs/style run build:dist` pass for the expanded Phase 1 runtime fork
    coverage.
  - [ ] Port the broader upstream StyleX shared/runtime fixture set before checking Phase 1 complete.
  - [x] Replace the current curated priority-property subset with the full forked
    `property-priorities` table before checking Phase 1 complete.
    - Evidence (2026-06-16): `packages/style/src/property-priorities.ts` is ported from
      `../stylex/packages/@stylexjs/shared/src/utils/property-priorities.js`; `packages/style/src/index.ts`
      delegates priority lookup through the ported table.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/style test`, `pnpm exec tsc --noEmit`,
      `pnpm exec vitest --run packages/compiler/src/style.test.ts packages/compiler/src/css.test.ts
      packages/compiler/src/compile-component.test.ts`, `pnpm --filter @kovojs/style run build:dist`,
      and `pnpm --filter @kovojs/compiler run build:dist` pass.
- [ ] **Phase 2 — Compiler integration + readable output.** Re-home the extraction transform in
      `packages/compiler`; emit provenance-prefixed classes + `data-style-src`; **build and persist the
      rule→usage attribution map** (atom → referencing module/route/fragment/package, splitting invariant
      (a)); wire the stylesheet-hint manifest as a **render-parameterized `(renderTarget) → asset[]`**
      function returning the single v1 asset (invariant (c)). Prove devtools/`kovo explain component`
      resolves a class back to source. _Evidence:_ compiler fixture + one rendered page with legible
      classes; attribution map emitted as an inspectable artifact.
  - Evidence (partial, 2026-06-16): `packages/compiler/src/style.ts` extracts namespace-imported static
    `style.create(...)` calls, lowers static JSX `style={base.root}` / `style={[base.root, ...]}` to
    authorable `class` + `data-style-src` IR, emits global `@layer kovo-style.*` atomic CSS, and attaches
    `styleRuleUsages` attribution to the component CSS asset.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/compiler/src/style.test.ts
    packages/compiler/src/css.test.ts packages/compiler/src/compile-component.test.ts`,
    `pnpm exec tsc --noEmit`, and `pnpm --filter @kovojs/compiler run build:dist` pass.
  - Evidence (partial, 2026-06-16): `packages/compiler/src/css.ts` exposes
    `createCssAssetResolver(manifest): (renderTarget) => asset[]`; `packages/compiler/src/css.test.ts`
    verifies page, fragment-target, and defer/source-file selection while preserving the current v1 asset
    behavior.
  - [x] Extend compiler lowering beyond the static subset to reactive style-object toggles before
    checking Phase 2/3 complete.
    - Evidence (2026-06-16): `packages/compiler/src/style.ts` lowers known StyleX refs in
      state/query conditionals to static class-string variants, `packages/compiler/src/compile.ts`
      threads the resulting state derives/query attribute stamps through the existing §4.8 client
      update-plan emit path, and `packages/compiler/src/lower/structural-jsx.ts` skips those claimed
      `style={...}` spans so the generic style-attribute derive does not consume them first.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/compiler/src/style.test.ts
      packages/compiler/src/query-update-plans.test.ts packages/compiler/src/state-bindings.test.ts
      packages/compiler/src/query-coverage.test.ts`, `pnpm exec tsc --noEmit`, and
      `pnpm --filter @kovojs/compiler run build:dist` pass.
  - [x] Persist attribution into an emitted inspectable artifact and teach `kovo explain component` to
    resolve classes before checking Phase 2 complete.
    - Evidence (2026-06-16): `packages/compiler/src/emit/registry.ts` emits
      `ComponentStyleRules`, `packages/compiler/src/style.test.ts` asserts registry persistence and
      component graph `styleRules`, and `packages/cli/src/index.kovo-explain.test.ts` asserts
      `STYLE class=... source=... style-ref=...` output.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/compiler/src/style.test.ts
      packages/compiler/src/registry.test.ts packages/cli/src/index.kovo-explain.test.ts`,
      `pnpm exec tsc --noEmit`, `pnpm --filter @kovojs/core run build:dist`,
      `pnpm --filter @kovojs/compiler run build:dist`, and `pnpm --filter kovo run build:dist` pass.
- [ ] **Phase 3 — Fixpoint + reactive + merge integration.** Fixpoint fixture (compile(IR) ≡ IR);
      §4.9 classifier accepts style-object toggles; §4.7 atomic-aware class merge. _Evidence:_ fixpoint CI
      green; a reactive `state`-driven style toggle updates via §4.8 with no `setAttribute`.
  - Evidence (partial, 2026-06-16): `packages/compiler/src/style.test.ts` asserts
    `assertFixpoint(...)` for the static `style.create` lowering subset; `pnpm exec vitest --run
    packages/compiler/src/style.test.ts packages/compiler/src/css.test.ts
    packages/compiler/src/compile-component.test.ts` passes.
  - [x] Add reactive `state`/query-driven style-object toggle lowering through the §4.8 update plan
    before checking Phase 3 complete.
    - Evidence (2026-06-16): `packages/compiler/src/style.test.ts` covers a state-driven
      `style={[base.root, state.bouncing ? motion.bounce : null]}` lowering to a versioned
      `data-bind:class` state derive, plus a query-driven
      `style={cart.count > 0 ? buttonStates.ready : buttonStates.empty}` lowering to a compiled
      `class` attribute stamp with `data-derive-attr="class"`.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/compiler/src/style.test.ts
      packages/compiler/src/query-update-plans.test.ts packages/compiler/src/state-bindings.test.ts
      packages/compiler/src/query-coverage.test.ts`, `pnpm exec vitest --run
      packages/compiler/src/css.test.ts packages/compiler/src/compile-component.test.ts`,
      `pnpm exec tsc --noEmit`, and `pnpm --filter @kovojs/compiler run build:dist` pass.
- [x] **Phase 4 — UI model bake-off (Button) + one multi-slot component.** Implement Button as Model V
      and Model L; rewrite one interactive multi-slot component (`Select`/`Dialog`/`Tabs`) exercising
      headless attrs + slot overrides. Keep axe/browser gates green (§12.1). Recommend a model.
      _Evidence:_ both Buttons typecheck/build; multi-slot browser+axe suite green.
  - [x] Prototype Button as installable-library Model L with StyleX object overrides.
    - Evidence (2026-06-16): `packages/ui/src/button.tsx` now imports `@kovojs/style`, replaces
      `defineVariants`/`cn` with `style.create` groups and `style.attrs(...)`, exposes typed
      `style?: style.StyleInput` overrides, and drops the `class` override escape hatch for Button.
    - Evidence (2026-06-16): `packages/ui/src/button.stylex.test.tsx` proves StyleX-rendered
      `kv-*` classes, source metadata, default variant/size selection, and author-last typed style
      overrides. `packages/ui/registry.json` and `packages/ui/scripts/build-registry.mjs` now treat
      `@kovojs/style` as a public copied-component dependency.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/ui/src/button.stylex.test.tsx
      packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`,
      `node packages/ui/scripts/build-registry.mjs`, and `pnpm exec tsc --noEmit` pass.
  - [x] Prototype Button as copy-in Model V with StyleX-authored vendored source.
    - Evidence (2026-06-16): `packages/ui/registry.json` records Button's copied-source dependency on
      `@kovojs/style`, `packages/ui/src/copy-in.test.ts` links that public package into the scratch app,
      and `packages/cli/src/index.kovo-add.test.ts` asserts copied `button.tsx` contains
      `import * as style from '@kovojs/style'`, `buttonStyles`, and `style.attrs(...)`.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/ui/src/button.stylex.test.tsx
      packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`,
      `node packages/ui/scripts/build-registry.mjs`, and `pnpm exec tsc --noEmit` pass.
  - [x] Compare Model V and Model L Button surfaces and record the final recommendation.
    - Evidence (2026-06-16): Recommend Model L as the default distribution surface with `kovo add
      --eject`/copy-in as the customization hatch. `packages/ui/src/button.tsx` proves the library
      surface is compact and typed (`style?: style.StyleInput`, no `class` escape hatch), while
      `packages/ui/registry.json`, `packages/ui/src/copy-in.test.ts`, and
      `packages/cli/src/index.kovo-add.test.ts` prove the same StyleX-authored source remains
      available for vendored customization with `@kovojs/style` preserved as a public dependency.
  - [x] Rewrite one interactive multi-slot component to StyleX slot override objects.
    - Evidence (2026-06-16): `packages/ui/src/tabs.tsx` now imports `@kovojs/style`, replaces
      `defineVariants`/`cn` with `tabsStyles = style.create(...)`, keeps the headless
      `tabs*Attributes(...)` semantics, and exposes `styles?: TabsStyleOverrides` for root/list/
      trigger/panel slot overrides.
    - Evidence (2026-06-16): `packages/style/src/index.ts` supports bracket selector suffixes such as
      `[data-state=active]` so StyleX-authored headless state styles can attach to generated `data-*`
      attrs; `packages/style/src/index.test.ts` covers this extraction behavior.
    - Evidence (2026-06-16): `packages/ui/src/tabs.stylex.test.tsx` proves StyleX-rendered `kv-*`
      slot classes, headless ARIA/data attributes, hidden inactive panels, and per-slot author-last
      override objects.
    - Evidence (2026-06-16): `pnpm exec vitest --run packages/style/src/index.test.ts
      packages/ui/src/tabs.stylex.test.tsx packages/ui/src/copy-in.test.ts
      packages/cli/src/index.kovo-add.test.ts`, `node packages/ui/scripts/build-registry.mjs`, and
      `pnpm exec tsc --noEmit` pass.
  - [x] Run the relevant browser/axe gates for the StyleX multi-slot component.
    - Evidence (2026-06-16): `examples/gallery/src/visual-fixtures/tabs.html.txt` is refreshed from
      the current `@kovojs/ui` Tabs renderer and contains `kv-tabs-*` classes plus `data-style-src`
      for root/list/trigger/panel slots.
    - Evidence (2026-06-16): `examples/gallery/src/interactive-gallery.axe.browser.test.ts` runs
      axe against the StyleX Tabs static fixture and asserts the StyleX markers before the audit.
      `examples/gallery/src/interactive-gallery.visual.browser.test.ts` pins the updated rendered
      gallery route hash.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/example-gallery exec vitest --run
      src/demo-fixtures.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --config
      vitest.browser.config.ts --run src/interactive-gallery.axe.browser.test.ts`, and
      `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
      src/interactive-gallery.visual.browser.test.ts` pass.
- [ ] **Phase 5 — Replace Tailwind across starters/examples/docs.** Migrate gallery, commerce, crm,
      stackoverflow, docs site, and `create-kovo` starter; remove Tailwind deps + `@source` safelists;
      decide `@scope` retirement. _Evidence:_ `rg -i tailwind` returns only historical/plan references;
      examples build + static-export styled.
  - Evidence (partial, 2026-06-16): `packages/ui/src/badge.tsx` now uses `@kovojs/style`,
    exports `badgeStyles`, accepts `style?: style.StyleInput`, and drops `defineVariants`/`cn` plus the
    `class` escape hatch. `packages/ui/src/badge.stylex.test.tsx` proves default/variant StyleX
    classes and author-last overrides.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Badge's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` asserts copied
    `badge.tsx` contains StyleX imports, `badgeStyles`, and typed `style` overrides. The gallery
    Badge visual fixture is refreshed with `kv-badge-*` classes.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/badge.stylex.test.tsx
    packages/ui/src/button.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest
    --run src/demo-fixtures.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --config
    vitest.browser.config.ts --run src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    and `pnpm exec tsc --noEmit` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/skeleton.tsx` now uses `@kovojs/style`,
    exports `skeletonStyles`, accepts `style?: style.StyleInput`, and drops `cn` plus the `class`
    escape hatch. `examples/gallery/src/demo-fixtures.tsx` uses StyleX size overrides for the
    Skeleton route, and `examples/gallery/package.json` declares `@kovojs/style` for those fixtures.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/skeleton.stylex.test.tsx
    packages/ui/src/badge.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest
    --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest
    --config vitest.browser.config.ts --run src/interactive-gallery.visual.browser.test.ts`,
    `node packages/ui/scripts/build-registry.mjs`, and `pnpm exec tsc --noEmit` pass.
  - Evidence (partial, 2026-06-16): `packages/create-kovo/templates/package.json` drops
    `@tailwindcss/vite`/`tailwindcss` and adds `@kovojs/style`; `templates/vite.config.ts` removes the
    Tailwind plugin; `templates/src/app.tsx` and `templates/src/auth.tsx` use `style.create(...)` and
    `style.attrs(...)`; `templates/src/styles.css` is reduced to raw document defaults. Integrated
    side-agent commit `ba5aad19` (`agent/stylex-starter` original `9fa834cc`).
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/create-kovo/src/index.test.ts`,
    `pnpm --filter create-kovo run build:dist`, `pnpm exec tsc --noEmit`, and `git diff --check` pass
    after integration.
  - Evidence (partial, 2026-06-16): `packages/ui/src/alert.tsx` now uses `@kovojs/style`, exports
    `alertStyles`, accepts `style?: style.StyleInput`, and drops `defineVariants`/`cn` plus the `class`
    escape hatch. `packages/ui/src/alert.stylex.test.tsx` snapshots default/variant StyleX output,
    exported style groups, and author-last overrides.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Alert's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` asserts copied `alert.tsx`
    contains StyleX imports, `alertStyles`, and typed `style` overrides. The gallery Alert visual
    fixture and `examples/gallery/src/__snapshots__/demo-fixtures.test.ts.snap` are refreshed with
    `kv-alert-*` classes and `data-style-src`.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/alert.stylex.test.tsx
    packages/ui/src/badge.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/card.tsx` now uses `@kovojs/style`, exports
    `cardStyles`, accepts `style?: style.StyleInput`, and drops `cn` plus the `class` escape hatch.
    `packages/ui/src/card.stylex.test.tsx` snapshots default StyleX output, exported style groups, and
    author-last overrides; the gallery Card fixture and demo snapshot are refreshed with `kv-card-*`
    classes and `data-style-src`.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/card.stylex.test.tsx
    packages/ui/src/alert.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/kbd.tsx` now uses `@kovojs/style`, exports
    `kbdStyles`, accepts `style?: style.StyleInput`, and drops `cn` plus the `class` escape hatch.
    `packages/ui/src/kbd.stylex.test.tsx` snapshots default StyleX output, exported style groups, and
    author-last overrides; `examples/gallery/src/demo-fixtures.tsx` uses a StyleX uppercase override for
    the Kbd route.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/kbd.stylex.test.tsx
    packages/ui/src/card.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
- [ ] **Phase 6 — Perf/size gate.** CSS bytes, HTML bytes, client JS, build time vs. Tailwind baseline on
      a CSS-heavy fixture (ties to `plans/compiler-quality.md`'s missing CSS-heavy perf coverage).
- [ ] **Phase 7 — SPEC + docs.** Rewrite §13.1 to StyleX-first; update package-prefix language if Model L
      lands; rewrite `site/content/guides/styling.md` + `components.md`; reconcile `plans/api-cleanup.md`
      STABILITY for any new public surface.
- [ ] **Deferred — CSS splitting (opt-in, gated on measurement).** Compute base/route/fragment chunks
      from the attribution map (Phase 2 invariant (a)), keyed off the route registry (§6.4); the manifest
      (invariant (c)) returns per-render asset sets; fragment/defer responses declare their required
      assets. **No architecture change required** — only chunk computation + manifest population — _because_
      invariants (a)/(b)/(c) were preserved from v1. Trigger: a measured page/route where the single asset
      ships meaningfully more CSS than the route needs.

## Resolved Decisions — Phase 0 (2026-06-16)

- [x] **Override prop names: `style` + `styles`.** `style?: style.Style` for single-root components;
      `styles?: SlotMap` for multi-part components. Both are StyleX style objects — this intentionally
      **takes over the `style` name to discourage raw HTML `style` strings**.
- [x] **Slot map shape is per-component.** No universal slot vocabulary; each compound component defines
      the slot set that is ergonomic/idiomatic for it (e.g. Select: `trigger`/`content`/`item`/`value`).
      Phase 4 fixes the canonical slots per component as part of its public API.
- [x] **Allow full `style.Style` overrides.** Apps may override with arbitrary style objects; UI
      internals stay static except variants/tokens. No `style.StaticStyle` restriction on public props.
- [x] **Authoring surface: compiler-lowered `style` JSX prop.** `style` accepts a `style.Style` or an
      array of them (RN-style, falsy entries allowed); the Kovo compiler lowers it — to a literal
      `class="kv-…"` when static, to a §4.8 class-swap when dynamic. `style.attrs()` / `style.props()`
      remain the runtime primitives but are the **lowering target**, not the authored API (so Constitution
      #3's fixpoint holds: `style={[…]}` lowers to authorable `{...style.attrs(…)}` or static `class`).
- [x] **Variant helper dropped entirely.** No `defineVariants`/`style.variants`. Variants are plain
      `style.create` groups selected by typed index and composed through `style={[...]}`; defaults via
      destructuring, compounds via inline conditionals. The helper was a Tailwind/CVA workaround for
      un-composable class strings and is redundant under native StyleX composition + compiler lowering —
      dropping it removes a concept and serves the Constitution's "sugar must justify itself."
- [x] **`style.raw(...)` escape hatch for dynamic inline CSS.** `style` means typed atomic style objects,
      not raw CSS strings. For the rare genuinely-dynamic inline case (e.g. an island setting
      `--progress: 60%`), `style.raw('--progress: 60%')` is the explicit escape that emits a raw inline
      `style="…"` — keeping the common `style` path object-only rather than overloading it to also accept
      strings.
- [x] **Remove the `class` escape hatch.** Official components drop `class?: ClassValue`; customization is
      style-object overrides only. (Raw-CSS escape hatch survives via `@scope`, below.)
- [x] **Classname scheme: component + property-family prefix.** Emit e.g. `kv-button-bg-1a2b`; keep atomic
      dedupe; `data-style-src` is **dev-only**.
- [x] **Token ownership: `@kovojs/ui` ships defaults.** Apps override via document-level `createTheme`;
      component styles reference tokens, never literal color systems.
- [x] **Token/theme file convention: `*.tokens.ts` (recommended, not a required magic extension).**
      `style.create(...)` stays **inline** in component `.tsx` — no special extension. Files that export
      `defineVars`/`defineConsts`/`createTheme` use the semantic suffix `*.tokens.ts` (themes may use
      `*.theme.ts`), matching Kovo's existing role-declaring filenames (`*.queries.ts`, `*.routes.ts`).
      **Deliberately not StyleX's `*.stylex.ts`**: that marker exists only because StyleX's Babel plugin is
      single-file and needs it to resolve cross-module/cross-package var-name stability. Kovo's compiler is
      whole-program (it already resolves token identity through the §4.8/§11 graph) and ships `@kovojs/ui`
      pre-compiled (tokens export literal `var(--kovo-ui-*)` strings, §14 decision), so neither reason
      applies — the suffix is a legibility + extraction-scoping convention, not a correctness requirement.
      A purity lint (`KV4xx`: token modules export only `defineVars`/`createTheme`, no runtime imports)
      enforces the compile-time-only boundary instead of the filename.
- [x] **`@scope` kept as escape hatch only.** StyleX atomic classes are globally collision-free, so the
      co-located-CSS `@scope` path is redundant for normal styling. Retain it (the compiler code exists)
      for raw CSS that StyleX can't express well (deep/`:has()` selectors, hand-written keyframes,
      third-party widget theming); do not teach it or use it in starters/UI.
- [x] **One app-wide StyleX asset for now — as a _packaging_ default, not an architecture assumption.**
      Ship a single declared stylesheet in v1; revisit route/fragment/chunk splitting only if measured
      (Phase 6). Splitting optionality is **preserved by three day-one invariants** (don't foreclose it):
  - **(a) Rule→usage attribution map.** The extraction pass records which atoms each
    module/route/fragment/package origin references, even though v1 concatenates them. This map is the
    substrate any future chunking needs; discarding it makes splitting impossible to retrofit. (Phase 2.)
  - **(b) Cascade priority via `@layer`/priority buckets, not single-file source order.** Emit conflict
    resolution so it survives atoms being spread across multiple files loaded in any order. Relying on
    single-file insertion order would silently break the cascade once split — the one genuinely
    hard-to-retrofit choice, so bake it in from Phase 1/2 even for the single sheet.
  - **(c) Render-parameterized stylesheet manifest.** Hint resolution is a function
    `(renderTarget) → asset[]` returning the single asset in v1; never hardcode "the one stylesheet" into
    the shell/server/fragment paths, so v2 can return `[base.css, route-x.css]` with no caller change.
- [x] **Fragments/defer: declare required assets, don't assume the page already has all CSS.** Under the
      single-asset model a late fragment can only reference already-present atoms (correct by construction),
      but that is a property of _packaging_, not a permanent guarantee. Fragment/defer responses retain the
      ability to declare their required stylesheet assets (§13.1 fragment-target metadata), resolved via the
      attribution map (a) — so splitting later stays sound.
- [x] **Migrate everything.** Tailwind removed from all examples (gallery, commerce, crm, stackoverflow),
      docs site, and the `create-kovo` starter — not a partial/opt-in migration.

## Resolved Decisions — Phase 0 cont. (2026-06-16, confirmed)

- [x] **Package prefix: `kovo-ui-`.** Renders hosts as `<kovo-ui-button>` / `kovo-c="kovo-ui-button"`;
      legal because `@kovojs/*` may use `kovo-*` (§6.1.1); apps can alias on collision.
- [x] **Package CSS delivery: ship pre-compiled.** The fork gives `@kovojs/ui` the **same atomic hash
      space** as the app (pre-compiled package classes dedupe against app classes) and tokens are
      document-level CSS vars (theming needs no recompile), so ship `@kovojs/ui` pre-compiled with
      per-component entry points (`@kovojs/ui/button`) for dead-code elimination. No
      `externalPackages`-style node_modules re-transformation unless DCE proves insufficient.

Phase 0 is fully closed; no API decisions remain open before implementation.

## Acceptance Criteria

- [ ] **Fork:** `@kovojs/style` exists, TS-native, merge+atomic-class parity proven against ported
      upstream fixtures; no Flow toolchain in Kovo's build.
- [ ] **Legibility:** rendered classes are provenance-prefixed + `data-style-src`; `kovo explain` resolves
      a class to source. Constitution #1 satisfied.
- [ ] **Fixpoint:** a StyleX-styled component's emitted IR recompiles to a no-op (CI gate green).
- [ ] **Reactive + merge:** a state-driven style toggle updates via §4.8; author `style` override wins
      per-property through §4.7.
- [ ] **Tailwind removed:** starters/examples/docs build and static-export styled with zero Tailwind.
- [ ] **UI model decided:** Model V vs L recommended with a prototyped Button and a published-prefix
      decision if L.
- [ ] **SPEC §13.1 updated** to StyleX-first; at least one static and one interactive component proven end
      to end (typecheck → build → static export → browser/axe → late-fragment stylesheet).
