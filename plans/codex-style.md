# StyleX as Kovo's official styling layer

Status: **investigation / decision plan**. Created 2026-06-16.

`SPEC.md` is normative. This plan evaluates whether Kovo should adopt StyleX, from the sibling
checkout at `../stylex` (`ad139035`, StyleX package version `0.19.0`), as the official styling
solution. The decision target is not only "can StyleX work"; it is whether the API improves Kovo's
type-safety, performance, and customizability/theme-ability without weakening Kovo's machine-auditable
TSX authoring model.

## Initial Recommendation

- [ ] **Default to upstream dependency + Kovo adapter first; do not fork or wholesale-vendor StyleX
      yet.**
  - Reason: StyleX already has the important primitives Kovo needs: typed `stylex.create`,
    `StyleXStyles` / `StaticStyles` override types, typed `defineVars` / `createTheme`, build-time
    extraction, and `stylex.attrs(...)` returning Kovo-shaped `{ class, style }` attributes.
  - Reason: forking or vendoring would make Kovo own a Babel/Flow-heavy CSS compiler, bundler
    integrations, lint rules, CSS lowering, and TypeScript type maintenance before proving the API fit.
  - Reason: Kovo's likely needs are integration-shaped first: route/fragment stylesheet manifests,
    Vite plugin ordering, `@kovojs/server` JSX spread behavior, and public UI prop design. Those can
    be proven with an adapter/spike without carrying a fork.
  - Fork trigger: fork only if Kovo needs a stable compiler metadata contract that upstream will not
    expose, or if `stylex.attrs` / non-React output support regresses and cannot be shimmed.
  - Vendor trigger: vendor only a tiny Kovo wrapper/adapter. Avoid vendoring upstream StyleX packages
    unless a release-blocking patch cannot reasonably live as a forked package.

## Kovo Constraints From SPEC

- [ ] **Preserve TSX-only app authoring and readable lowered artifacts.**
  - SPEC §5.2 says app authors write TSX/JSX source; lowered IR and generated modules are artifacts,
    not hand-authored source. A StyleX integration must let app components remain TSX and must not
    require authors to write generated CSS/class artifacts by hand.
- [ ] **Preserve the framework stylesheet contract across pages, mutation fragments, and deferred
      streams.**
  - SPEC §13.1 says Kovo owns stylesheet hints for full pages, mutation fragments (§9.1), and
    `<kovo-defer>` streams. A StyleX stylesheet must be declared through Kovo page/fragment hints, not
    hidden inside an app-only bundler side effect.
- [ ] **Preserve light DOM and document-level theming.**
  - SPEC §3.1 rejects shadow DOM; §13.1 says design tokens are ordinary CSS custom properties and
    theming remains document CSS. StyleX `defineVars` / `createTheme` fits this in principle.
- [ ] **Preserve package component prefix semantics if `@kovojs/ui` becomes a normal package.**
  - SPEC §6.1.1 says published Kovo component packages need a manifest prefix that becomes public wire
    vocabulary. The current `@kovojs/ui` copy-in model avoids that by being app source. A published
    StyleX-backed UI package would need a `kovo.prefix` decision and docs around stable component
    names.
- [ ] **Preserve primitive merge semantics.**
  - SPEC §4.6 defines class concatenation, style concatenation, author override ordering, and conflict
    diagnostics. StyleX styles must compose through those rules when they meet primitive attributes,
    user overrides, `asChild`, and attrs-function lowering.

## Current Kovo Styling Baseline

- [ ] **Record the baseline before changing it.**
  - Current docs (`site/content/guides/styling.md`) are Tailwind-first: literal classes, explicit
    safelists for dynamic classes, document CSS custom-property tokens, and stylesheet hints per render
    path.
  - Current `@kovojs/ui` is private copy-in starter code (`packages/ui/package.json` has
    `"private": true` and `kovo.vendoredSource: true`), while `@kovojs/headless-ui` is the public
    behavior package.
  - Current UI components expose Tailwind helpers such as `buttonClassNames`, `buttonClasses`, and
    `class?: ClassValue`. That gives easy copy-in customization but weak style-object type safety.
  - Current variant helper (`packages/headless-ui/src/lib/variants.ts`) intentionally keeps Tailwind
    utility strings statically discoverable, citing SPEC §13.1.

## StyleX Facts From The Local Checkout

- [ ] **Verify public/stable StyleX APIs before depending on them.**
  - `@stylexjs/stylex` exposes typed `create`, `props`, `attrs`, `defineVars`, `createTheme`,
    `StyleXStyles`, `StyleXStylesWithout`, `StaticStyles`, and `StaticStylesWithout`.
  - `stylex.props(...)` returns React-shaped `{ className, styleObject }`.
  - `stylex.attrs(...)` returns framework-neutral `{ class, styleString }`, which matches Kovo's JSX
    attribute vocabulary much better.
  - The local docs mention `attrs` in the v0.5 release notes, but the package README still centers
    `props`. Before making `attrs` core to Kovo's API, confirm it is intended as stable public surface.
  - `@stylexjs/unplugin` has a Vite adapter, collects CSS from transformed modules, appends to an
    existing CSS asset or emits `stylex.css`, supports dev virtual CSS, and can transform StyleX code
    in dependencies via package discovery / `externalPackages`.
  - StyleX is MIT licensed.

## Fit Against The Goals

- [ ] **Type-safety: likely strong, but only if Kovo exposes style-object overrides directly.**
  - StyleX gives property/value typing, `StyleXStyles<CSS>` constraints, `StyleXStylesWithout<CSS>`
    exclusions, `StaticStyles<CSS>` for tighter override sets, and typed token/theme override shapes.
  - Kovo UI should prefer `style?: StyleXStyles` or named slot style props over `class?: ClassValue`
    for official components.
  - Keep `class?: string` as an escape hatch only if the user wants Tailwind/class compatibility to
    remain first-class.
- [ ] **Performance: likely good for production CSS size and runtime, with Kovo-specific measurement
      required.**
  - StyleX emits atomic CSS at build time and turns style selection into class strings.
  - A Kovo integration should use extracted CSS, not runtime injection, for production.
  - The open measurement is not "StyleX is fast" in isolation; it is whether a Kovo app with SSR,
    mutation fragments, deferred streams, and package UI imports gets deterministic CSS assets with
    no missing styles and acceptable build time.
- [ ] **Customizability/theme-ability: promising, but API design matters more than the compiler.**
  - StyleX supports token groups and themes through CSS variables, which aligns with SPEC §13.1.
  - Component customization should be style-object based and slot-addressable, not only variant props.
  - The UI package needs a theme/token ownership decision: app-defined tokens, Kovo-defined default
    tokens, or UI-package-defined tokens that apps override with `createTheme`.

## Proposed Kovo API Direction

- [ ] **Spike a Kovo-style wrapper around StyleX, not a forked styling language.**
  - Candidate import:
    ```tsx
    import * as sx from '@kovojs/style';
    ```
  - `@kovojs/style` can re-export StyleX types and functions, prefer `attrs` in examples, and provide
    small Kovo-specific helpers only where necessary.
  - Keep the authored API close to StyleX so users can transfer knowledge and upstream docs remain
    useful.
- [ ] **Use `style` for StyleX style objects unless you want to reserve it for raw inline CSS.**
  - Candidate component prop:
    ```tsx
    export interface ButtonProps {
      children?: string;
      style?: sx.StyleXStyles;
      variant?: 'primary' | 'secondary' | 'ghost';
    }
    ```
  - Candidate render:
    ```tsx
    <button {...sx.attrs(buttonStyles.root, buttonStyles[variant], props.style)}>
      {props.children}
    </button>
    ```
  - Risk: HTML already has a `style` attribute. For Kovo components this prop is component-level
    StyleX input, but for intrinsic elements `style` is currently a raw attribute string/object-ish
    output path. If this ambiguity feels too high, use `xstyle?: StyleXStyles` or
    `styles?: { root?: StyleXStyles }`.
- [ ] **Prefer slot style maps for real UI components.**
  - Candidate:
    ```tsx
    export interface SelectStyles {
      root?: sx.StyleXStyles;
      trigger?: sx.StyleXStyles;
      content?: sx.StyleXStyles;
      item?: sx.StyleXStyles;
      value?: sx.StyleXStyles;
    }
    export interface SelectProps {
      styles?: SelectStyles;
    }
    ```
  - This is a better fit than one `class` string for shadcn-like components with multiple parts.
- [ ] **Export default style objects or style slots only if that is part of the customization story.**
  - Option A: export `buttonStyles` and token vars, so apps compose/override directly.
  - Option B: keep style objects internal and expose only `style` / `styles` override props.
  - Option C: expose both, but treat exported style objects as public API and snapshot them.
- [ ] **Keep variants as semantic API, not the only styling API.**
  - Variant props remain useful for design-system defaults.
  - Style-object overrides should come last in `sx.attrs(...)` so local app customizations win.

## Package Model Options

- [ ] **Option 1: Keep copy-in UI, but rewrite it to StyleX.**
  - Pros: no published component prefix decision; users can freely edit source; closest to current docs.
  - Cons: weaker reason to adopt StyleX as "official"; copied StyleX components still need the
    app-level StyleX build pipeline; updates remain manual.
- [ ] **Option 2: Publish `@kovojs/ui` as a normal StyleX-backed package.**
  - Pros: regular dependency, central updates, StyleX dependency transform can compile package styles,
    style-object overrides replace shadcn-style source edits for common customization.
  - Cons: needs SPEC §6.1.1 package prefix, public component API stability, package CSS extraction from
    dependencies, and strong theming/override design.
- [ ] **Option 3: Hybrid.**
  - Publish a small stable `@kovojs/ui` package for primitives/static components with style-object
    overrides, keep `kovo add` copy-in for heavily customized components.
  - This may be the pragmatic migration path if the API is not settled enough to freeze every styled
    component.

## Fork / Vendor / Dependency Decision Matrix

- [ ] **Dependency + adapter.**
  - Choose this for the first spike.
  - Best when upstream `@stylexjs/stylex` + `@stylexjs/unplugin` can provide extracted CSS, Kovo-shaped
    `attrs`, dependency package transforms, and stable enough TypeScript types.
- [ ] **Fork.**
  - Choose this only if Kovo needs changes to StyleX compiler output/metadata, `attrs` stability,
    bundler behavior, or package-dependency compilation that upstream cannot accept quickly.
  - A fork should publish as a clearly named package and keep a documented upstream rebase policy.
- [ ] **Vendor.**
  - Avoid for upstream StyleX itself. The codebase is large, has its own release/build/test machinery,
    and would increase Kovo maintenance sharply.
  - Acceptable only for a tiny adapter layer or temporary patch with an expiration task.

## Spike Plan

- [ ] **S0: API decision pass before coding.**
  - Answer the questions at the end of this document.
  - Pick prop names (`style`, `xstyle`, `styles`) and package model (copy-in, published, hybrid).
  - Decide whether Tailwind remains supported but secondary, or whether StyleX replaces Tailwind in
    starters/docs.
- [ ] **S1: Minimal StyleX build integration in one example app.**
  - Add upstream StyleX dependencies and `@stylexjs/unplugin` Vite integration in a contained example.
  - Ensure production build emits an extracted stylesheet and Kovo page hints include it.
  - In dev, avoid inline script requirements that would conflict with Kovo's CSP/nonced-script goals.
  - Prove: `pnpm --filter <example> build`, static export, and served page has styles at first paint.
- [ ] **S2: One static component rewrite.**
  - Rewrite `Button` or `Badge` using `stylex.create` + `stylex.attrs`.
  - Replace `class?: ClassValue` with the chosen StyleX override prop.
  - Prove: TypeScript rejects invalid overrides; rendered HTML contains stable class attributes; CSS is
    extracted; no runtime style injection in production.
- [ ] **S3: One multi-slot interactive component rewrite.**
  - Rewrite `Select`, `Dialog`, or `Tabs` enough to exercise headless attributes plus slot style
    overrides.
  - Prove: primitive attrs still merge per SPEC §4.6; state/data attributes still support styling;
    browser interaction/axe tests stay green for the selected component.
- [ ] **S4: Fragment/defer stylesheet proof.**
  - Drive a mutation fragment or deferred stream that renders a StyleX-styled component not present in
    the initial body.
  - Decide whether all StyleX CSS is one app stylesheet included on every page/fragment, or whether
    Kovo needs a StyleX CSS manifest with per-route/per-fragment asset selection.
  - Prove: no unstyled late fragment; fragment response carries or relies on a declared stylesheet
    according to SPEC §13.1.
- [ ] **S5: Published-package proof if `@kovojs/ui` becomes normal dependency.**
  - Add `kovo.prefix` to a throwaway package or branch-only `@kovojs/ui` package.
  - Configure StyleX dependency compilation (`externalPackages` if necessary).
  - Prove: app imports package components, package styles extract, component prefixes are stable, and
    `kovo explain component` remains legible.
- [ ] **S6: Performance and size gate.**
  - Compare Tailwind/current UI vs StyleX spike for generated CSS bytes, server HTML bytes, client JS
    bytes, build time, and static-export output.
  - Include a CSS-heavy component fixture because `plans/compiler-quality.md` already calls out missing
    compiler-performance coverage for CSS-heavy components.
- [ ] **S7: Docs and SPEC update.**
  - If accepted, update SPEC §13.1 from Tailwind-first to StyleX-first or StyleX-official.
  - Update `site/content/guides/styling.md` and `site/content/guides/components.md`.
  - If `@kovojs/ui` becomes published, update `plans/api-cleanup.md` / STABILITY docs around the
    public UI surface and component prefix.

## Open Questions For User

- [ ] **Is the desired author override prop name `style`, `xstyle`, or `styles`?**
  - My default: `style?: StyleXStyles` for single-root components and `styles?: SlotStyleMap` for
    multi-part components. This is ergonomic, but it overloads the HTML meaning of `style`.
- [ ] **Should `class` remain a first-class escape hatch on official UI components?**
  - My default: keep it during migration, but do not make it the primary customization API. If StyleX is
    official, examples should teach style-object overrides first.
- [ ] **Should Kovo publish `@kovojs/ui`, keep copy-in, or use a hybrid?**
  - My default: hybrid until the StyleX API is proven; regular package for stable components only after
    prefix/theming/public API decisions are locked.
- [ ] **Do you want StyleX to replace Tailwind in starters, or be the blessed UI-package styling layer
      while apps may still use Tailwind?**
  - My default: replace Tailwind in the official starter only after S1-S4 pass; keep Tailwind docs as a
    supported alternative for app-authored CSS.
- [ ] **Who owns design tokens: Kovo, the app, or `@kovojs/ui`?**
  - My default: `@kovojs/ui` exports default token vars/themes, apps override them with document-level
    themes, and component styles reference tokens rather than literal color systems.
- [ ] **Is a single app-wide StyleX stylesheet acceptable for v1, or do you require route/fragment-level
      CSS splitting from day one?**
  - My default: one declared StyleX asset for the first official integration; split later only with a
    manifest that preserves SPEC §13.1 fragment/defer correctness.
- [ ] **Are dynamic StyleX styles allowed in Kovo UI, or should official components restrict overrides
      to static styles/tokens?**
  - My default: allow app overrides typed as `StyleXStyles`, but keep official UI internals static
    except for variants and token themes.

## Acceptance Criteria

- [ ] **Decision:** record dependency/fork/vendor choice with evidence from S1-S4.
- [ ] **API:** record chosen prop names, slot override shape, token/theme ownership, and package model.
- [ ] **SPEC:** update SPEC §13.1 and any package-prefix language if StyleX becomes official.
- [ ] **Verification:** have at least one static and one interactive component proven through typecheck,
      build, static export, browser behavior, and late-fragment/defer stylesheet delivery.
