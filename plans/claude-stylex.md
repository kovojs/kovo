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

- **The fixpoint contract forces ownership (Constitution #3, §5.2).** Every compiler feature must
      lower to authorable Kovo IR that recompiles to a no-op. StyleX's babel output (injected CSS +
      hashed classes) is not Kovo source. Kovo must define the lowering and own the transform, so a
      black-box dependency cannot satisfy the gate.
- **Type-safety goal #1 wants a TS-native core, not Flow.** StyleX is authored in Flow and ships
      generated `.d.ts`. Kovo's compiler is strict-TS with lint bans on `any`/casts (§6.6). Porting the
      `shared` core to TS gives first-class types and removes a Flow toolchain from Kovo's build.
- **Readable classnames (decision 4) require controlling the emitter.** Upstream will not change its
      hashing to Kovo's provenance scheme; only the fork can.
- **The fork surface is small.** We need `create`, `props`/`attrs`, `defineVars`, `createTheme`,
      `keyframes`, `firstThatWorks`, conditional/pseudo/media handling, and the styleq runtime merge —
      `@stylexjs/shared` + a ~200-line runtime. We do **not** fork the bundler/lint/devtools constellation.
      This is closer to the pinned-Drizzle-subset model (§14) than to vendoring a framework.
- **Not a from-scratch reimplementation.** The atomic-CSS generation, property-priority ordering
      (`shared/utils/property-priorities.js`), and last-wins styleq merge are subtle and battle-tested;
      port them, do not reinvent. Track upstream selectively against a pinned conformance subset.

## Goal Fit (with the fork)

- **Type-safety (#1): strong.** Typed `create({...})` style objects replace untyped Tailwind
      strings; `style.Style` / `style.StaticStyle` / `style.StyleExcept` constrain public override props;
      typed `defineVars`/`createTheme` constrain themes. Invalid overrides become compile errors —
      directly serves §1.1's "provable by TypeScript static checking."
- **Performance (#2): strong, with a Kovo-specific gate.** Atomic CSS dedupes across the app; **static
      components merge at server render**, so the common case ships zero client styling runtime (the 4KB
      loader budget, §16, is untouched). Reactive class/style toggles already ride the §4.8 update plan.
      Open measurement: CSS bytes, HTML bytes, build time vs. the Tailwind baseline on a CSS-heavy
      fixture (Phase 6).
- **Theme-ability (#3): strong.** `defineVars` → CSS custom properties and `createTheme` → override
      classes are _exactly_ §13.1's "tokens are ordinary CSS custom properties; theming is document CSS,"
      and need no shadow boundary (§3.1).

## SPEC Tensions & Positions

- **Legibility (Constitution #1, "wire is documentation" #4).** Bare atomic hashes are opaque.
      Position: the fork emits **provenance-prefixed atomic classes** (e.g. `kv-button-bg-1a2b`) keyed to
      the originating component + property family, keeps `data-style-src` mapping element → source style
      key, and keeps atomic dedupe. Classnames were never Kovo's legibility carrier (`kovo-c` stamps and
      `data-bind` are, §4.2/§4.8) — but devtools "what is this element styled with" must still resolve to
      source. Prove the devtools/`kovo explain` story in Phase 2.
- **Fixpoint (Constitution #3, §5.2).** `style.create(...)` is sugar lowering to (a) injected atomic
      CSS rules and (b) a static `styleKey → classnames` map; component IR references resolved classnames.
      The emitted IR must be authorable Kovo source and recompile to a no-op. Add a fixpoint fixture
      (Phase 3) to the existing fixpoint CI gate.
- **Primitive merge (§4.6/§4.7).** Kovo's render-time merge concatenates+dedupes `class` and
      concatenates `style` (author last). StyleX's merge is **property-level last-wins via atomic
      classes** — richer. Position: route a component's public override through
      `style.attrs(...componentStyles, props.style)` so author overrides win per-property; teach the §4.7
      class-merge that atomic classes must not be blindly deduped in a way that breaks last-wins ordering.
      Reconcile with `asChild` / attrs-function lowering using the archived UI/compiler hardening
      evidence in `plans/archive.md`.
- **Reactive styles (§4.8/§4.9).** A class/style that depends on query data or island state (e.g.
      `state.bouncing ? styles.bounce : null`) must be driven by the §4.8 update plan, and the §4.9
      classifier must accept a StyleX style-object toggle as a `plan` position (not a KV311). Integration
      task in Phase 3.
- **Fragments/defer (§13.1, §9.1, §8).** Tailwind needed `@source inline(...)` safelists so dynamic
      classes survive in mutation fragments / `<kovo-defer>` streams. StyleX **removes this hazard**:
      styles are statically extracted from source regardless of render path, atomic classes are global and
      build-time-known, so a late fragment can only reference classes already in the page stylesheet. Keep
      Kovo's stylesheet-hint contract (emit the asset list once, same hints for page/fragment/defer).
- **`@scope` simplification (§13.1).** Atomic classes are inherently collision-free and global, so the
      co-located-CSS `@scope`/`kovo-c` extraction path is **not needed for StyleX-authored styles**. Decide
      in Phase 5 whether `@scope` extraction is retired for app styling or retained only for raw co-located
      CSS escape hatches.
- **Package prefix (§6.1.1).** If `@kovojs/ui` becomes a published package (Phase 4, Model L), it
      needs a `kovo.prefix` that enters public wire vocabulary. Vendored source stays app-named. This is a
      gating decision for the distribution model, not for adopting StyleX.

## Architecture: `@kovojs/style` (the fork)

- **New package `packages/style` (`@kovojs/style`), TS-native.**
  - Authoring API (port from `../stylex` `@stylexjs/stylex` + `shared`): `create`, `props`, `attrs`,
    `defineVars`, `createTheme`, `keyframes`, `firstThatWorks`, `defineConsts`, pseudo/media/conditional
    support, and the styleq last-wins runtime.
  - `attrs(...)` returns `{ class, style }` (StyleX already does — `../stylex/.../stylex.js:169`), which
    matches Kovo's string JSX. Prefer `attrs` over React-shaped `props` in all Kovo examples.
  - Compile-time transform re-homed inside Kovo's compiler (`packages/compiler`): extract atomic CSS,
    emit provenance-prefixed classnames, produce the `styleKey → classnames` map, and feed Kovo's
    stylesheet-hint manifest.
- **Authoring shape in components.** Replace `defineVariants` + `cn` (Tailwind) with plain
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

- **Override prop = typed style object, author-last in the array.** `props.style` (single-root) or a
      per-component `styles` slot map (multi-part) is the override channel and comes **last in the
      `style={[...]}` array** so app customizations win by position. Both props are `style.Style` objects —
      Kovo intentionally takes over the `style` name to discourage raw HTML `style` strings, and official
      components drop the `class` escape hatch entirely (Phase 0). **Convention:** import the package as
      `style` and give every `style.create(...)` result a descriptive name (`base`, `variants`, `sizes`,
      `dialogStyles`) so the namespace never collides with a bare `styles` local.
- **Tokens/themes.** `@kovojs/ui` ships default token vars + a default theme via `defineVars`/
      `createTheme`; apps override at the document level. Component styles reference tokens, never literal
      color systems — this is the §3 customizability story.

## UI Distribution Model — comparison (decision 3)

- **Model V — keep shadcn vendored source, swap Tailwind→StyleX inside it.**
  - Pros: no `kovo.prefix`/public-API freeze; infinite per-app customization; closest to today.
  - Cons: weaker payoff from "official StyleX"; copied components still need the StyleX build; manual
    updates/drift.
- **Model L — publish `@kovojs/ui` as an installable library with style-object overrides.**
  - Enabled _specifically_ by StyleX's deterministic last-wins merge: a published component can accept a
    typed `style`/`styles` override that reliably wins — impossible cleanly with Tailwind specificity.
  - Pros: real dependency, central updates, smaller surface, typed overrides replace source edits.
  - Cons: needs `kovo.prefix` (§6.1.1), public-API stability, package-style extraction, strong theming.
- **Recommendation to validate (not yet locked):** Model L as default **with an `eject`/copy-in
      escape hatch** (publish stable primitives as a package; `kovo add --eject` drops to vendored source
      for heavy customization). Prototype Button both ways and decide.

## Phased Checklist

- [x] **Phase 0 — API decision pass (no code).** Done 2026-06-16 — see "Resolved Decisions — Phase 0."
      Two items remain (package prefix, package CSS delivery) and are confirmed before Phase 4 freezes
      public surface.
- [x] **Phase 1 — Fork the core into `@kovojs/style`.** Port `@stylexjs/shared` + runtime Flow→TS;
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
  - Evidence (partial, 2026-06-16): `packages/style/src/index.test.ts` snapshots the upstream
    `stylex-test.js` missing-input error handling for Kovo-supported APIs (`create`, `createTheme`,
    `defineConsts`, `defineVars`, `firstThatWorks`, `keyframes`) and Kovo-only helper guards
    (`createAtomicStyles`, `raw`); `packages/style/src/index.ts` now reports explicit `TypeError`
    messages instead of relying on incidental JS failures.
  - Evidence (partial, 2026-06-16): `pnpm --filter @kovojs/style test`,
    `pnpm --filter @kovojs/style run build:dist`, and `pnpm exec tsc --noEmit --pretty false` pass
    for the missing-input runtime fixture port.
  - [x] Port the broader upstream StyleX shared/runtime fixture set before checking Phase 1 complete.
    - Evidence (2026-06-17): audited `../stylex/packages/@stylexjs/stylex/__tests__/stylex-test.js`,
      `inject-test.js`, `createSheet-test.js`, and `createOrderedCSSStyleSheet-test.js`. Kovo ports the
      supported `stylex-test.js` runtime contract in `packages/style/src/index.test.ts`: missing-input
      errors for supported APIs, `props`/`attrs` basic resolution, array merge order, same-property
      override, nested pseudo override, pseudo-only merge, complicated nested merge-order stress case,
      source-map metadata, and dynamic inline fixtures through Kovo's explicit `raw(...)` escape hatch.
      The remaining upstream runtime files exercise StyleX's browser injector/ordered stylesheet
      mutation surface (`inject`, `createSheet`, `createOrderedCSSStyleSheet`), which Kovo deliberately
      did not fork because SPEC §13.1 extraction emits deterministic stylesheet assets instead of
      runtime CSS injection.
    - Evidence (2026-06-17): `find ../stylex/packages/@stylexjs/stylex/__tests__ -type f` lists only
      `stylex-test.js`, `inject-test.js`, `createSheet-test.js`, and `createOrderedCSSStyleSheet-test.js`;
      `packages/style/src/index.test.ts` contains the supported `stylex-test.js` ports and Kovo-specific
      priority-layer/atomic/token/theme fixtures.
  - [x] Replace the current curated priority-property subset with the full forked
    `property-priorities` table before checking Phase 1 complete.
    - Evidence (2026-06-16): `packages/style/src/property-priorities.ts` is ported from
      `../stylex/packages/@stylexjs/shared/src/utils/property-priorities.js`; `packages/style/src/index.ts`
      delegates priority lookup through the ported table.
    - Evidence (2026-06-16): `pnpm --filter @kovojs/style test`, `pnpm exec tsc --noEmit`,
      `pnpm exec vitest --run packages/compiler/src/style.test.ts packages/compiler/src/css.test.ts
      packages/compiler/src/compile-component.test.ts`, `pnpm --filter @kovojs/style run build:dist`,
      and `pnpm --filter @kovojs/compiler run build:dist` pass.
- [x] **Phase 2 — Compiler integration + readable output.** Re-home the extraction transform in
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
  - Evidence (2026-06-17): current-tree proof for the completed compiler/readability surface:
    `pnpm exec vitest --run packages/compiler/src/style.test.ts packages/compiler/src/css.test.ts
    packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts
    packages/cli/src/index.kovo-explain.test.ts packages/compiler/src/query-update-plans.test.ts
    packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-coverage.test.ts` passes
    (8 files, 88 tests). `pnpm --filter @kovojs/compiler run build:dist`,
    `pnpm --filter @kovojs/core run build:dist`, `pnpm --filter kovo run build:dist`, and
    `pnpm exec tsc --noEmit --pretty false` pass.
- [x] **Phase 3 — Fixpoint + reactive + merge integration.** Fixpoint fixture (compile(IR) ≡ IR);
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
  - Evidence (2026-06-17): `packages/compiler/src/style.test.ts` now asserts static `style.create`
    lowering passes `assertFixpoint(...)`, author-last arrays replace the earlier same-property atom,
    state-driven style-object toggles compile to `data-bind:class` derives, query-driven toggles compile
    to `data-derive-attr="class"` stamps, both client derivations avoid generated `setAttribute`, and
    both coverage records are accepted as `status: 'plan'` without `KV311`. Current proof command:
    `pnpm exec vitest --run packages/compiler/src/style.test.ts packages/compiler/src/css.test.ts
    packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts
    packages/cli/src/index.kovo-explain.test.ts packages/compiler/src/query-update-plans.test.ts
    packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-coverage.test.ts`.
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
- [x] **Phase 5 — Replace Tailwind across starters/examples/docs.** Migrate gallery, commerce, crm,
      stackoverflow, docs site, and `create-kovo` starter; remove Tailwind deps + `@source` safelists;
      decide `@scope` retirement. _Evidence:_ `rg -i tailwind` returns only historical/plan references;
      examples build, and static-exportable surfaces export styled while server-mutation demos are served
      dynamically per SPEC §9.5.
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
  - Evidence (partial, 2026-06-16): `examples/crm` and `examples/stackoverflow` package manifests drop
    `@tailwindcss/vite`/`tailwindcss`; both Vite configs remove the Tailwind plugin, rename the CSS entry
    from `tailwind` to `styles`, and both app-shell stylesheet constants now point at
    `/assets/styles.css`. Their `src/styles.css` files are checked-in baseline app CSS with no Tailwind
    import or `@source` safelist; `rg -n -i "tailwind|assets/tailwind\.css|@tailwindcss" examples/crm
    examples/stackoverflow` returns no matches.
  - Evidence (partial, 2026-06-16): `pnpm --filter @kovojs/example-crm test`,
    `pnpm --filter @kovojs/example-stackoverflow test`, `pnpm --filter @kovojs/example-crm run build`,
    `pnpm --filter @kovojs/example-stackoverflow run build`, `pnpm --filter @kovojs/example-crm exec tsc
    --noEmit --pretty false`, `pnpm --filter @kovojs/example-stackoverflow exec tsc --noEmit --pretty
    false`, and `git diff --check` pass. The builds emit `dist/assets/styles.css` and
    `.vite/manifest.json` records `"file": "assets/styles.css"` for both examples. Direct static export
    scripts still fail before completing on existing KV229 param-route metadata gaps for `/deals/:id` and
    `/questions/:id`; the broad `vp run export` task graph is additionally blocked by the out-of-scope
    commerce Tailwind config/dependency state.
  - Evidence (partial, 2026-06-17): `examples/commerce/package.json` and `pnpm-lock.yaml` drop
    `@tailwindcss/vite`/`tailwindcss`, `examples/commerce/vite.config.ts` removes the Tailwind plugin
    and renames the CSS entry to `styles`, `commerceStylesheets` and generated graph facts point at
    `/assets/styles.css`, and `examples/commerce/src/styles.css` is checked-in plain document CSS for the
    current commerce static rendering surface (SPEC.md §13.1).
  - Evidence (partial, 2026-06-17): `pnpm --filter @kovojs/example-commerce test`,
    `pnpm --filter @kovojs/example-commerce run build`, `pnpm --filter @kovojs/example-commerce exec tsc
    --noEmit --pretty false`, `rg -n -i "tailwind|assets/tailwind\\.css|@tailwindcss|tailwindcss|@source"
    examples/commerce`, and `git diff --check` pass. The build emits `dist/assets/styles.css`.
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
  - Evidence (partial, 2026-06-16): `packages/ui/src/separator.tsx` now uses `@kovojs/style`,
    exports `separatorStyles`, accepts `style?: style.StyleInput`, and drops `defineVariants`/`cn` plus
    the `class` escape hatch while preserving `separatorRootAttributes(...)` orientation/role output.
    `packages/ui/src/separator.stylex.test.tsx` snapshots decorative, semantic vertical, exported style
    groups, and author-last override output; the gallery Separator route uses a StyleX width override.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/separator.stylex.test.tsx
    packages/ui/src/kbd.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/progress.tsx` now uses `@kovojs/style`,
    exports `progressStyles`, accepts `style?: style.StyleInput`, and drops `defineVariants`/`cn` plus
    the `class` escape hatch while preserving `progressRootAttributes(...)` max/value/state output.
    `packages/ui/src/progress.stylex.test.tsx` snapshots loading, complete, indeterminate, exported
    style groups, and author-last override output.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/progress.stylex.test.tsx
    packages/ui/src/separator.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/meter.tsx` now uses `@kovojs/style`, exports
    `meterStyles`, accepts `style?: style.StyleInput`, and drops `defineVariants`/`cn` plus the `class`
    escape hatch while preserving `meterRootAttributes(...)` threshold/value/state output.
    `packages/ui/src/meter.stylex.test.tsx` snapshots optimum, suboptimum, exported style groups, and
    author-last override output.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/meter.stylex.test.tsx
    packages/ui/src/progress.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/toggle.tsx` now uses `@kovojs/style`, exports
    `toggleStyles`, accepts `style?: style.StyleInput`, and drops `defineVariants`/`cn` plus the
    `class` escape hatch while preserving `toggleRootAttributes(...)` pressed/disabled output.
    `packages/ui/src/toggle.stylex.test.tsx` snapshots pressed, off, disabled, exported style groups,
    and author-last override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Toggle's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` asserts copied
    `toggle.tsx` contains StyleX imports, `toggleStyles`, and typed `style` overrides. The gallery
    Toggle visual fixture is refreshed with `kv-toggle-*` classes and `data-style-src`; shared
    form-control tests keep semantic Toggle checks and move generated class coverage to the Vitest
    snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/toggle.stylex.test.tsx
    packages/ui/src/meter.stylex.test.tsx packages/ui/src/index.form-controls.test.tsx
    packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`, `node
    packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/switch.tsx` now uses `@kovojs/style`, exports
    `switchStyles`, accepts `styles?: SwitchStyleOverrides` for `root`/`input` slot overrides, and
    drops `defineVariants`/`cn` plus the `class`/`inputClass` escape hatches while preserving
    `switchRootAttributes(...)` checked/disabled/form output. `packages/ui/src/switch.stylex.test.tsx`
    snapshots checked, unchecked, disabled, exported style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Switch's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` asserts copied
    `switch.tsx` contains StyleX imports, `switchStyles`, and typed `styles` overrides. The gallery
    Switch visual fixture is refreshed with `kv-switch-*` classes and `data-style-src`; shared markup
    tests keep semantic Switch checks and move generated class coverage to the Vitest snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/switch.stylex.test.tsx
    packages/ui/src/toggle.stylex.test.tsx packages/ui/src/index.form-controls.test.tsx
    packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`, `node
    packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/checkbox.tsx` now uses `@kovojs/style`, exports
    `checkboxStyles`, accepts `styles?: CheckboxStyleOverrides` for `root`/`input` slot overrides, and
    drops `defineVariants`/`cn` plus the `class`/`inputClass` escape hatches while preserving
    `checkboxRootAttributes(...)` checked/indeterminate/disabled/form output.
    `packages/ui/src/checkbox.stylex.test.tsx` snapshots checked, indeterminate, disabled, exported
    style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Checkbox's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` asserts copied
    `checkbox.tsx` contains StyleX imports, `checkboxStyles`, and typed `styles` overrides. The gallery
    Checkbox visual fixture is refreshed with `kv-checkbox-*` classes and `data-style-src`; shared
    markup tests keep semantic Checkbox checks and move generated class coverage to the Vitest snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/checkbox.stylex.test.tsx
    packages/ui/src/switch.stylex.test.tsx packages/ui/src/index.form-controls.test.tsx
    packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`, `node
    packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/radio-group.tsx` now uses `@kovojs/style`,
    exports `radioGroupStyles`, accepts `styles?: RadioGroupStyleOverrides` for `root`/`item`/`radio`/
    `label` slot overrides, and drops `defineVariants`/`cn` plus the `class` escape hatches while
    preserving `radioGroup*Attributes(...)` radiogroup, native radio, roving `tabIndex`, and label `for`
    output. `packages/ui/src/radio-group.stylex.test.tsx` snapshots the generated StyleX output,
    exported style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Radio Group's copied-source
    dependency on `@kovojs/style`; `packages/ui/src/copy-in.test.ts` typechecks copied `radio-group.tsx`
    against only the public `@kovojs/*` packages, and `packages/cli/src/index.kovo-add.test.ts` asserts
    copied `radio-group.tsx` contains StyleX imports, `radioGroupStyles`, and typed `styles` overrides.
    The gallery Radio Group visual fixture and demo snapshot are refreshed with `kv-radio-group-*`
    classes and `data-style-src`; shared tests keep semantic form-control assertions and move generated
    class coverage to the focused Vitest snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/radio-group.stylex.test.tsx
    packages/ui/src/index.form-controls.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm --filter @kovojs/example-gallery exec vitest --run src/demo-fixtures.test.ts
    src/behavior-contracts.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --config
    vitest.browser.config.ts --run src/interactive-gallery.native.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/avatar.tsx` now uses `@kovojs/style`, exports
    `avatarStyles`, accepts `styles?: AvatarStyleOverrides` for `root`/`image`/`fallback` slot
    overrides, and drops `defineVariants`/`cn` plus the `class` escape hatches while preserving
    `avatarRootAttributes(...)`, `avatarImageAttributes(...)`, and `avatarFallbackAttributes(...)`
    state/hidden/ARIA output. `packages/ui/src/avatar.stylex.test.tsx` snapshots loading, loaded,
    error, exported style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Avatar's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` includes Avatar in the
    vendored add list and asserts copied `avatar.tsx` contains StyleX imports, `avatarStyles`, and
    typed `styles` overrides. The gallery Avatar visual fixture is refreshed with `kv-avatar-*`
    classes and `data-style-src`; shared markup tests keep semantic Avatar checks and move generated
    class coverage to the Vitest snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/avatar.stylex.test.tsx
    packages/ui/src/checkbox.stylex.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm --filter @kovojs/example-gallery exec vitest --run src/demo-fixtures.test.ts
    src/behavior-contracts.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --config
    vitest.browser.config.ts --run src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/accordion.tsx` now uses `@kovojs/style`,
    exports `accordionStyles`, accepts `styles?: AccordionStyleOverrides` for
    `root`/`item`/`header`/`trigger`/`content` slot overrides, and drops `defineVariants`/`cn` plus the
    `class` escape hatches while preserving `accordionRootAttributes(...)`,
    `accordionItemAttributes(...)`, `accordionHeaderAttributes(...)`, `accordionTriggerAttributes(...)`,
    and `accordionContentAttributes(...)` state/ARIA/hidden output. `packages/ui/src/accordion.stylex.test.tsx`
    snapshots open/closed output, exported style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Accordion's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` includes Accordion in the
    vendored add list and asserts copied `accordion.tsx` contains StyleX imports, `accordionStyles`, and
    typed `styles` overrides. The gallery Accordion visual fixture is refreshed with `kv-accordion-*`
    classes and `data-style-src`; shared markup tests keep semantic Accordion checks and move generated
    class coverage to the Vitest snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/accordion.stylex.test.tsx
    packages/ui/src/avatar.stylex.test.tsx packages/ui/src/index.markup.test.tsx
    packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`, `node
    packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/breadcrumb.tsx` now uses `@kovojs/style`,
    exports `breadcrumbStyles`, accepts `styles?: BreadcrumbStyleOverrides` for
    `root`/`list`/`item`/`link`/`current`/`separator` slot overrides, and drops `cn` plus the `class`
    escape hatches while preserving `safeUrl(...)` href sanitization and `separatorRootAttributes(...)`
    decorative separator output. `packages/ui/src/breadcrumb.stylex.test.tsx` snapshots default/current
    link output, exported style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Breadcrumb's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` asserts copied
    `breadcrumb.tsx` contains StyleX imports, `breadcrumbStyles`, and typed `styles` overrides. The
    gallery Breadcrumb visual fixture is refreshed with `kv-breadcrumb-*` classes and `data-style-src`;
    shared markup tests keep semantic Breadcrumb checks and move generated class coverage to the Vitest
    snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/breadcrumb.stylex.test.tsx
    packages/ui/src/breadcrumb.test.tsx packages/ui/src/accordion.stylex.test.tsx
    packages/ui/src/index.markup.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm --filter @kovojs/example-gallery exec vitest --run src/demo-fixtures.test.ts
    src/behavior-contracts.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --config
    vitest.browser.config.ts --run src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/scroll-area.tsx` now uses `@kovojs/style`,
    exports `scrollAreaStyles`, accepts `styles?: ScrollAreaStyleOverrides` for
    `root`/`viewport`/`scrollbar`/`thumb`/`corner` slot overrides, and drops `defineVariants`/`cn` plus
    the `class` escape hatches while preserving the headless scroll-area attribute helpers for
    scrollbars, viewport, thumb, and corner state.
    `packages/ui/src/scroll-area.stylex.test.tsx` snapshots root/viewport/scrollbar/thumb/corner output,
    exported style groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Scroll Area's copied-source
    dependency on `@kovojs/style`; `packages/cli/src/index.kovo-add.test.ts` includes Scroll Area in the
    vendored add list and asserts copied `scroll-area.tsx` contains StyleX imports, `scrollAreaStyles`,
    and typed `styles` overrides. The gallery Scroll Area visual fixture is refreshed with
    `kv-scroll-area-*` classes and `data-style-src`; shared inputs tests keep semantic Scroll Area checks
    and move generated class coverage to the Vitest snapshot.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run packages/ui/src/scroll-area.stylex.test.tsx
    packages/ui/src/index.inputs.test.tsx packages/ui/src/index.markup.test.tsx
    packages/ui/src/copy-in.test.ts packages/cli/src/index.kovo-add.test.ts`, `node
    packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `pnpm exec tsc --noEmit`, and `git diff --check`
    pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/table.tsx` now uses `@kovojs/style`,
    exports `tableStyles`, accepts `styles?: TableStyleOverrides` for `wrapper`/`table`/`caption`/
    `head`/`body`/`row`/`headerCell`/`cell` overrides, and drops `cn` plus the `class`/`wrapperClass`
    escape hatches while preserving the SPEC.md §5.2 raw table-part emission path for isolated
    `thead`/`tbody`/`tr`/`th`/`td` output. `packages/ui/src/table.stylex.test.tsx` snapshots semantic
    table markup, exported StyleX slot groups, and author-last slot override output.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records Table's copied-source
    dependency on `@kovojs/style`; `packages/ui/src/copy-in.test.ts` covers `table.tsx`;
    `packages/cli/src/index.kovo-add.test.ts` asserts copied `table.tsx` contains StyleX imports,
    `tableStyles`, and typed `styles` overrides. The gallery Table visual fixture is refreshed in
    `examples/gallery/src/visual-fixtures/table.html.txt`, and shared Table assertions in
    `packages/ui/src/index.markup.test.tsx`, `examples/gallery/src/demo-fixtures.test.ts`, and
    `examples/gallery/src/behavior-contracts.test.ts` keep semantic checks while moving generated class
    coverage to the Vitest snapshot.
  - Evidence (partial, 2026-06-16): `./node_modules/.bin/vitest run packages/cli/src/index.kovo-add.test.ts`,
    `../../node_modules/.bin/vitest run src/index.markup.test.tsx -t "exports table primitives as styled semantic markup"`,
    `../../node_modules/.bin/vitest run src/xss-escaping.test.tsx`,
    `../../node_modules/.bin/vitest run src/copy-in.test.ts`,
    `../../node_modules/.bin/vitest run -u -t "@kovojs/ui Table StyleX slots"`,
    `../../node_modules/.bin/vitest run -u src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `node packages/ui/scripts/build-registry.mjs --write`, `pnpm exec tsc --noEmit`, and
    `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/collapsible.tsx` and
    `packages/ui/src/disclosure.tsx` now use `@kovojs/style`, export `collapsibleStyles` /
    `disclosureStyles`, accept `styles?: { root?, trigger?, content? }` slot overrides, and drop
    `defineVariants`/`cn` plus the `class` escape hatch while preserving
    `collapsible*Attributes(...)` and `disclosure*Attributes(...)` state, IDREF, hidden, disabled,
    and native `<details>` / button semantics. `packages/ui/src/collapsible.stylex.test.tsx` and
    `packages/ui/src/disclosure.stylex.test.tsx` snapshot generated StyleX output, exported style
    groups, and author-last slot overrides.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records the copied-source StyleX
    dependency for Collapsible and Disclosure; `examples/gallery/src/demo-fixtures.test.ts`,
    `examples/gallery/src/visual-fixtures/collapsible.html.txt`, and
    `examples/gallery/src/visual-fixtures/disclosure.html.txt` refresh the gallery fixture surface
    to `kv-collapsible-*` / `kv-disclosure-*` classes with `data-style-src`, while shared fixture
    checks keep semantic assertions and drop brittle Tailwind fragment pins for these two routes.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run
    packages/ui/src/collapsible.stylex.test.tsx packages/ui/src/disclosure.stylex.test.tsx
    packages/ui/src/copy-in.test.ts`, `pnpm --filter @kovojs/example-gallery exec vitest --run
    src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`, `node packages/ui/scripts/build-registry.mjs`,
    `pnpm exec tsc --noEmit`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-16): `packages/ui/src/popover.tsx`, `packages/ui/src/tooltip.tsx`,
    and `packages/ui/src/hover-card.tsx` now import `@kovojs/style`, replace `defineVariants`/`cn`
    with `style.create(...)` + `style.attrs(...)`, and expose typed `styles?: ...StyleOverrides`
    slot overrides for `root`/`trigger`/`content` while preserving the headless
    `popover*Attributes(...)`, `tooltip*Attributes(...)`, and `hoverCard*Attributes(...)` semantics
    required by `SPEC.md` §4.6.
  - Evidence (partial, 2026-06-16): `packages/ui/src/popover.stylex.test.tsx`,
    `packages/ui/src/tooltip.stylex.test.tsx`, and `packages/ui/src/hover-card.stylex.test.tsx`
    snapshot generated `kv-*` classes, exported StyleX slot groups, and author-last slot override
    output; `packages/ui/src/index.markup.test.tsx` keeps the semantic overlay assertions and
    removes brittle Tailwind-fragment coverage; `packages/ui/src/copy-in.test.ts` now typechecks the
    vendored `hover-card.tsx`, `popover.tsx`, and `tooltip.tsx` sources against the public
    `@kovojs/*` packages alone.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` is regenerated for the overlay
    imports, `examples/gallery/src/visual-fixtures/hover-card.html.txt`,
    `examples/gallery/src/visual-fixtures/popover.html.txt`, and
    `examples/gallery/src/visual-fixtures/tooltip.html.txt` are refreshed with `kv-*` classes plus
    `data-style-src`, and `examples/gallery/src/demo-fixtures.test.ts` moves overlay fixture checks
    to those StyleX markers instead of Tailwind class fragments.
  - Evidence (partial, 2026-06-16): `packages/ui/src/toggle-group.tsx` and
    `packages/ui/src/toolbar.tsx` now use `@kovojs/style`, export `toggleGroupStyles` /
    `toolbarStyles`, accept typed `styles` slot overrides for `root`/`item`/`button`, and drop
    `defineVariants`/`cn` plus the `class` escape hatches while preserving
    `toggleGroupRootAttributes(...)`, `toggleGroupItemAttributes(...)`,
    `toggleGroupButtonAttributes(...)`, `toolbarRootAttributes(...)`,
    `toolbarItemAttributes(...)`, and `toolbarButtonAttributes(...)` roving-control semantics.
    `packages/ui/src/toggle-group.stylex.test.tsx` and `packages/ui/src/toolbar.stylex.test.tsx`
    snapshot generated StyleX output, exported slot objects, and author-last overrides.
  - Evidence (partial, 2026-06-16): `packages/ui/registry.json` records the copied-source
    `@kovojs/style` dependency for Toggle Group and Toolbar; `packages/cli/src/index.kovo-add.test.ts`
    asserts copied `toggle-group.tsx` / `toolbar.tsx` contain StyleX imports, exported style groups,
    and typed `styles` overrides. The gallery Toggle Group and Toolbar visual fixtures now render
    `kv-toggle-group-*` / `kv-toolbar-*` classes plus `data-style-src`, and shared form-control and
    markup tests keep semantic roving assertions while moving brittle generated class coverage into the
    focused StyleX snapshots.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run
    packages/ui/src/toggle-group.stylex.test.tsx packages/ui/src/toolbar.stylex.test.tsx
    packages/ui/src/index.form-controls.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts`, `node packages/ui/scripts/build-registry.mjs --write`,
    `node packages/ui/scripts/build-registry.mjs`, `pnpm --filter @kovojs/example-gallery exec vitest
    --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts src/interactive-gallery.visual.browser.test.ts
    src/interactive-gallery.interactions-b.browser.test.ts`, `pnpm exec tsc --noEmit`, and
    `git diff --check` pass.
  - Evidence (partial, 2026-06-16): the remaining Tailwind-helper UI modules
    (`alert-dialog`, `autocomplete`, `checkbox-group`, `combobox`, `command`, `context-menu`,
    `dialog`, `drawer`, `dropdown-menu`, `field`, `menubar`, `navigation-menu`, `number-field`,
    `otp-field`, `select`, `sheet`, `slider`, `toast`) now import `@kovojs/style`, export
    `...Styles` groups, accept typed `...StyleOverrides`, and drop `defineVariants`/`cn`/
    `ClassValue` from `packages/ui/src/*.tsx`; `rg -n "defineVariants|type ClassValue|cn\\("
    packages/ui/src/*.tsx` returns no matches. Focused `*.stylex.test.tsx` files snapshot generated
    StyleX output, exported slot objects, and author-last overrides for each migrated component.
  - Evidence (partial, 2026-06-16): `packages/ui/src/index.tsx` re-exports the new StyleX style groups
    and override types, `packages/cli/src/index.kovo-add.test.ts` asserts copied sources contain
    StyleX imports/style groups/typed overrides, `packages/ui/registry.json` is regenerated, and
    shared UI/gallery assertions now keep semantic behavior checks while moving generated class coverage
    to Vitest snapshots or `data-style-src` markers.
  - Evidence (partial, 2026-06-16): `pnpm exec vitest --run
    packages/ui/src/*.stylex.test.tsx packages/ui/src/index.markup.test.tsx
    packages/ui/src/index.form-controls.test.tsx packages/ui/src/index.inputs.test.tsx
    packages/ui/src/index.overlays.test.tsx packages/ui/src/copy-in.test.ts
    packages/cli/src/index.kovo-add.test.ts examples/gallery/src/demo-fixtures.test.ts
    examples/gallery/src/behavior-contracts.test.ts`, `pnpm exec vitest --run
    examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts`,
    `node packages/ui/scripts/build-registry.mjs`, `pnpm exec tsc --noEmit --pretty false`, and
    `git diff --check` pass.
  - Evidence (partial, 2026-06-16): browser gates pass for the migrated gallery surface:
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts`,
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.axe.browser.test.ts`, and
    `pnpm --filter @kovojs/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.native.browser.test.ts src/interactive-gallery.interactions-b.browser.test.ts`.
  - Evidence (partial, 2026-06-16): `pnpm --filter @kovojs/example-gallery run
    emit:interactive-gallery` now passes after the compiler-quality follow-up for safe dynamic
    style-object lowering; `examples/gallery/src/interactive/scroll-area-demo.tsx` and
    `examples/gallery/src/interactive/slider-demo.tsx` use typed object-valued style props instead
    of dynamic raw CSS text, and their generated client derives call `kovoStyleProperty(...)`.
  - Evidence (partial, 2026-06-17): the docs site no longer depends on Tailwind:
    `site/package.json` and `pnpm-lock.yaml` drop `@tailwindcss/vite`/`tailwindcss`,
    `site/vite.config.ts` removes the Tailwind plugin, `site/src/styles.css` is plain document CSS,
    and `site/src/components/{chrome,docs-layout}.tsx` no longer use Tailwind utility classes.
  - Evidence (partial, 2026-06-17): docs content under `site/content/{docs,guides}` now teaches
    StyleX-first component styling, typed `style`/`styles` overrides, plain document CSS, and the
    `/assets/site.css` stylesheet contract for pages/fragments/defer; `rg -n -i
    "tailwind|@tailwind|@source|@theme|dark:|tailwind.css|defineVariants|ClassValue| cn\\(" site`
    returns no matches.
  - Evidence (partial, 2026-06-17): `pnpm exec tsc --noEmit --pretty false`, `git diff --check`,
    and `pnpm exec vp run build` pass in the `agent/stylex-site` worktree. `pnpm --filter
    @kovojs/site run build` reaches Vite CSS output (`dist-css/assets/site.css`) but stops on the
    existing static-export diagnostic `KV229 route=/deals/:id`; `pnpm --filter @kovojs/site test`
    stops in the existing API-ref expectation drift for the newly public `style.md` page.
  - Evidence (partial, 2026-06-17): after main-thread integration, `pnpm install --frozen-lockfile`,
    `pnpm --filter @kovojs/site exec tsc --noEmit --pretty false`, `pnpm --filter @kovojs/site test`,
    `pnpm exec tsc --noEmit --pretty false`, and `git diff --check` pass. `pnpm --filter
    @kovojs/site run build` reaches `dist-css/assets/site.css` and still stops on the known commerce
    static-export `KV229 route=/deals/:id` gap.
  - Evidence (partial, 2026-06-17): the gallery authored interactive demos, generated interactive
    TSX artifacts, app-shell stylesheet comments, and standalone export comments no longer carry stale
    Tailwind discovery wording. `rg -n -i
    "tailwind|@tailwind|@source|tailwind\\.css|tailwindcss" examples/gallery` returns no matches;
    `pnpm --filter @kovojs/example-gallery run emit:interactive-gallery -- --check`,
    `pnpm --filter @kovojs/example-gallery exec vitest --run src/demo-fixtures.test.ts
    src/behavior-contracts.test.ts`, `pnpm --filter @kovojs/example-gallery exec tsc --noEmit
    --pretty false`, and `git diff --check` pass in `agent/stylex-gallery-cleanup`.
  - Evidence (partial, 2026-06-17): integration late-fragment CSS coverage no longer depends on
    Tailwind: `tests/integration/fixtures/late-fragment-static-css` uses a checked-in static
    `/assets/fragment.css`, `tests/integration/package.json` and `pnpm-lock.yaml` drop
    `@tailwindcss/node`/`tailwindcss` from the integration importer, and `rg -n -i
    "tailwind|@tailwind|@source|tailwindcss|@tailwindcss" tests/integration` returns no matches.
    `pnpm --filter @kovojs/integration-tests exec playwright test`, `pnpm --filter
    @kovojs/integration-tests exec playwright test --list`, `pnpm exec tsc --noEmit --pretty false`,
    and `git diff --check` pass.
  - Evidence (partial, 2026-06-17): after main-thread integration, `pnpm --filter
    @kovojs/integration-tests exec playwright test tests/integration/specs/late-fragment-static-css.spec.ts`,
    `pnpm --filter @kovojs/integration-tests exec playwright test --list`, `pnpm install
    --frozen-lockfile`, `pnpm exec tsc --noEmit --pretty false`, and `git diff --check` pass.
  - Evidence (partial, 2026-06-17): root/package-level Tailwind dependency residue is removed:
    `Dockerfile` now refers generically to built CSS assets, orphaned `@tailwindcss/node` and
    `tailwindcss` package snapshots are removed from `pnpm-lock.yaml`, `pnpm install
    --frozen-lockfile` passes, and `rg -n -i
    "tailwind|@tailwindcss|tailwindcss|@source" Dockerfile pnpm-lock.yaml package.json
    packages/**/package.json examples/**/package.json tests/**/package.json site/package.json`
    returns no matches.
  - Evidence (partial, 2026-06-17): `packages/create-kovo` no longer contains direct legacy CSS tool
    strings while retaining computed negative regression assertions for the generated starter
    package, Vite config, source CSS, exported CSS, preview CSS, and template app-shell source asset.
    `rg -n -i "tailwind|@tailwind|@source|tailwindcss|@tailwindcss" packages/create-kovo` returns
    no matches, `pnpm exec vitest --run packages/create-kovo/src/index.test.ts
    packages/create-kovo/templates/src/app-shell.test.ts` runs the non-excluded create-kovo suite
    green, and `git diff --check` passes.
  - Evidence (partial, 2026-06-17): `@kovojs/headless-ui` token aliases now use document-token names
    (`KovoUiDocumentTokenProperty`, `kovoUiDocumentTokenCss`, `documentTokenProperty` /
    `documentTokenValue`) and `packages/headless-ui/src/lib/variants.ts` no longer carries stale
    utility-discovery wording. `packages/headless-ui/src/lib/token-sheet.test.ts` snapshots the
    generated token CSS and alias map. `api-surface-baseline.json` was regenerated and shrank by the
    two removed old headless-ui exports. `rg -n
    "tailwind|Tailwind|@source|tailwindcss|KovoUiTailwindThemeProperty|kovoUiTailwindThemeCss|tailwindThemeProperty|tailwindThemeValue|renderTailwindThemeCss"
    packages/headless-ui` returns no matches. `pnpm exec vitest --run packages/headless-ui/src`,
    `pnpm run check:api-surface`, `pnpm exec tsc --noEmit --pretty false`, and `git diff --check`
    pass in `agent/stylex-headless-cleanup`.
  - Evidence (partial, 2026-06-17): conformance/test/CLI/server fixture cleanup removes the remaining
    Tailwind-named CSS assets, utility-class fixture strings, source-directive starter expectations, and
    starter Tailwind dev-dependency expectations from the owned fixture paths. The obsolete
    `cssSourceDirectives(...)` parser was replaced with `cssLayerNames(...)`, preserving CSS structure
    coverage without carrying the old directive vocabulary. `rg -n
    "tailwind|Tailwind|@tailwind|tailwind\\.css|TailwindCSS|TAILWIND|@tailwindcss|tailwindcss|@source"
    packages/conformance-fixtures packages/test tests/kovo-check.node.mjs
    packages/cli/src/index.kovo-explain.test.ts packages/server/src/hints.test.ts` returns no matches;
    `pnpm exec vitest --run packages/conformance-fixtures/src/source-fixtures.test.ts
    packages/conformance-fixtures/src/package-exports.test.ts
    packages/conformance-fixtures/src/server-fixtures.test.ts
    packages/conformance-fixtures/src/starter-template-fixtures.test.ts
    packages/conformance-fixtures/src/command-fixtures.test.ts packages/test/src/html-fragment.test.ts
    packages/server/src/hints.test.ts packages/cli/src/index.kovo-explain.test.ts`, `node --test
    --test-name-pattern "D1 commerce enhanced fragments carry stylesheet hints|D4 commerce
    adopt-dont-invent features stay represented|P10 starter wires graph assertions into CI|P2 page hints
    keep speculation rules opt-in and non-empty" tests/kovo-check.node.mjs`, `pnpm exec tsc --noEmit
    --pretty false`, and `git diff --check` pass in `agent/stylex-test-fixtures-cleanup`.
  - Evidence (2026-06-17): current non-plan scan for legacy styling vocabulary is clean:
    `rg -n -i "tailwind|@tailwind|@source|tailwindcss|@tailwindcss|assets/tailwind\\.css" .
    --glob '!node_modules/**' --glob '!**/dist/**' --glob '!**/.vite/**' --glob '!site/dist-css/**'
    --glob '!plans/**'` returns no matches.
  - Evidence (2026-06-17): example/style build gates pass with styled `assets/styles.css` output:
    `pnpm --filter @kovojs/example-commerce run build`, `pnpm --filter @kovojs/example-crm run build`,
    `pnpm --filter @kovojs/example-stackoverflow run build`, and `pnpm --filter
    @kovojs/example-gallery run emit:interactive-gallery -- --check`.
  - Evidence (2026-06-17): static-exportable surfaces export styled: `pnpm exec node
    examples/commerce/scripts/export-static.mjs --out tmp-commerce-static` passes
    (`commerce-export/v1`, `html=3`, `assets=1`, `manifest-files=...static-asset:/assets/styles.css`,
    `diagnostics=0`), and `pnpm --filter @kovojs/site run build` passes
    (`site-export/v1`, `html=92`, `diagnostics=0`). CRM and Stack Overflow are intentionally dynamic
    server-mutation demos: their direct static export scripts now fail with KV229 server mutation endpoint
    diagnostics, and the docs example manifest renders them only when `KOVO_EXAMPLE_CRM_URL` /
    `KOVO_EXAMPLE_STACKOVERFLOW_URL` service URLs are configured.
- [x] **Phase 6 — Perf/size gate.** CSS bytes, HTML bytes, client JS, build time vs. Tailwind baseline on
      a CSS-heavy fixture (ties to `plans/compiler-quality.md`'s missing CSS-heavy perf coverage).
  - Evidence (2026-06-17): `examples/commerce/scripts/measure-style-size.mjs` builds the commerce
    CSS-heavy fixture, sums emitted CSS/JS asset bytes from `dist/assets`, SSR-renders
    `renderCartPage()` through a middleware Vite server, and reports raw UTF-8 HTML bytes. The script
    can target a historical worktree via `--root` so current and Tailwind-baseline numbers use the
    same measurement code.
  - Evidence (2026-06-17): current StyleX/plain-CSS commerce measurement:
    `node examples/commerce/scripts/measure-style-size.mjs` ->
    `build-ms=249`, `css-bytes=1652`, `css-files=dist/assets/styles.css`, `js-bytes=0`,
    `html-bytes=3288`.
  - Evidence (2026-06-17): Tailwind baseline measurement at detached worktree commit
    `a4cde02c` (`../kovo-commerce-tailwind-baseline`, immediately before commerce migration):
    `node examples/commerce/scripts/measure-style-size.mjs --root
    ../kovo-commerce-tailwind-baseline/examples/commerce` -> `build-ms=333`, `css-bytes=9479`,
    `css-files=dist/assets/tailwind.css`, `js-bytes=0`, `html-bytes=3290`.
- [x] **Phase 7 — SPEC + docs.** Rewrite §13.1 to StyleX-first; update package-prefix language if Model L
      lands; rewrite `site/content/guides/styling.md` + `components.md`; reconcile `plans/api-cleanup.md`
      STABILITY for any new public surface.
  - Evidence (partial, 2026-06-16): `SPEC.md` §13.1 now makes `@kovojs/style` the StyleX-first
    v1 authoring model, preserves the stylesheet hint/fragment metadata contract, and keeps `@scope`
    as the raw co-located CSS escape hatch; §4.2 references StyleX atomic stylesheet assets for the
    light-DOM styling contract, and §6.1.1 names `@kovojs/ui` as the first-party `kovo-ui-` package
    prefix.
  - Evidence (partial, 2026-06-16): `rg -n "Tailwind|tailwind|headless-ui|StyleX|@kovojs/style|kovo-ui-"
    SPEC.md` returns only the new StyleX / `@kovojs/style` / `kovo-ui-` references.
  - Evidence (partial, 2026-06-17): `site/content/guides/styling.md` and
    `site/content/guides/components.md` describe `@kovojs/style` as the default component styling
    package, StyleX `style`/`styles` override objects, plain document CSS for page chrome, and the
    copy-in `@kovojs/ui` flow that builds against public packages only.
  - Evidence (partial, 2026-06-17): `site/content/docs/stability.md` includes `@kovojs/style` in the
    public package table and keeps `@kovojs/ui` documented as a private copy-in starter; `STABILITY.md`
    and the site page both state the `@internal` boundary is enforced by API docs/gates rather than a
    `.d.ts` stripping promise.
  - Evidence (2026-06-17): `pnpm exec vitest --run scripts/public-packages.test.mjs
    site/scripts/api-ref.test.mjs packages/server/src/component-render.test.tsx`,
    `pnpm run check:api-surface`, and `git diff --check` pass for the new public style API docs and
    server render signature documentation.
  - Evidence (2026-06-17): `pnpm --filter @kovojs/site run build` now completes a fresh static export
    (`site-export/v1`, `html=92`, `diagnostics=0`) after the docs example manifest stopped treating
    CRM/Stack Overflow server-mutation demos as static embeds unless a live service URL is configured.
    `pnpm --filter @kovojs/site run check:links` passes (`pages=93`, `internal=13492`,
    `external=190`), `pnpm --filter @kovojs/site test` passes (9 files, 44 tests), and
    `pnpm --filter @kovojs/site exec tsc --noEmit --pretty false` passes.
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

- [x] **Fork:** `@kovojs/style` exists, TS-native, merge+atomic-class parity proven against ported
      upstream fixtures; no Flow toolchain in Kovo's build.
- [x] **Legibility:** rendered classes are provenance-prefixed + `data-style-src`; `kovo explain` resolves
      a class to source. Constitution #1 satisfied.
- [x] **Fixpoint:** a StyleX-styled component's emitted IR recompiles to a no-op (CI gate green).
- [x] **Reactive + merge:** a state-driven style toggle updates via §4.8; author `style` override wins
      per-property through §4.7.
- [x] **Tailwind removed:** starters/examples/docs build with zero Tailwind; static-exportable surfaces
      export styled, and dynamic server-mutation demos stay dynamic per SPEC §9.5.
- [x] **UI model decided:** Model V vs L recommended with a prototyped Button and a published-prefix
      decision if L.
- [x] **SPEC §13.1 updated** to StyleX-first; at least one static and one interactive component proven end
      to end (typecheck → build → static export → browser/axe → late-fragment stylesheet).
  - Evidence (2026-06-17): acceptance proof commands in the current tree:
    `pnpm --filter @kovojs/style test` (20 tests), `pnpm exec vitest --run
    packages/compiler/src/style.test.ts packages/compiler/src/css.test.ts
    packages/compiler/src/compile-component.test.ts packages/compiler/src/registry.test.ts
    packages/cli/src/index.kovo-explain.test.ts packages/compiler/src/query-update-plans.test.ts
    packages/compiler/src/state-bindings.test.ts packages/compiler/src/query-coverage.test.ts` (8 files,
    88 tests), `pnpm exec tsc --noEmit --pretty false`, `pnpm --filter @kovojs/example-gallery exec
    vitest --config vitest.browser.config.ts --run src/interactive-gallery.axe.browser.test.ts
    src/interactive-gallery.visual.browser.test.ts` (2 files, 6 tests), and `pnpm --filter
    @kovojs/integration-tests exec playwright test tests/integration/specs/late-fragment-static-css.spec.ts`
    (1 passed).
  - Evidence (2026-06-17): StyleX/Tailwind replacement proof commands in the current tree:
    non-plan legacy vocabulary scan returns no matches; `pnpm --filter @kovojs/example-commerce run build`,
    `pnpm --filter @kovojs/example-crm run build`, `pnpm --filter @kovojs/example-stackoverflow run build`,
    `pnpm --filter @kovojs/example-gallery run emit:interactive-gallery -- --check`, `pnpm exec node
    examples/commerce/scripts/export-static.mjs --out tmp-commerce-static`, and `pnpm --filter
    @kovojs/site run build` pass.
