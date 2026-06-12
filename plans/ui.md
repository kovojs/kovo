# UI libraries — `@jiso/headless-ui` + vendored `@jiso/ui` + gallery (D7)

Status: design agreed 2026-06-11; F1 SPEC text landed; F2 compiler-side prefix fact enforcement started
Scope: a behavior-layer package (`packages/headless-ui`, published `@jiso/headless-ui`), a vendored styled layer (`@jiso/ui`, distributed as source via `fw add`), a gallery app in this workspace (`examples/gallery`) that is also the conformance/a11y/visual test surface, and the small framework seams they require (package prefix registration, behavior-attribute namespace, primitive-author lint). Referenced from `IMPLEMENT_v1.md` as workstream **D7**.

## Progress checklist

- [x] F1 SPEC text: package prefix registration (manifest field, app-wide uniqueness, alias escape, `jiso-` reserved for `@jiso/*`), behavior-attribute namespace implications, FW234 teaching error. Evidence: SPEC §6.1.1 defines the manifest field, effective-prefix uniqueness, alias escape, `jiso-*` reservation, `fw-c`/CSS/behavior-attribute implications, and FW234 example; SPEC §4.6 now uses `jiso-tooltip`; SPEC §11.3 lists FW234.
- [ ] F2 compiler: prefix enforcement + FW234; `fw explain component <prefixed>` prints the owning package. Evidence so far: compiler accepts explicit package prefix facts and emits FW234 for duplicate effective prefixes, malformed/missing prefixes, and non-`@jiso/*` `jiso-*` misuse; explicit effective-prefix aliases are covered as the collision escape hatch. Remaining: feed real package-discovery facts into app builds and add `fw explain component <prefixed>` provenance output.
      Additional evidence 2026-06-11: explicit `packageComponentPrefixes` facts now flow through
      the core explain graph schema and compiler `deriveAppGraph`; `fw explain component
jiso-dialog` resolves dashed wire names and prints provenance including package, declared
      prefix, effective prefix, and source. Covered by `packages/core/src/graph.test.ts`,
      `packages/compiler/src/index.test.ts`, and `packages/cli/src/index.test.ts`. Same-session
      evidence: `pnpm exec vitest --run packages/core/src/graph.test.ts packages/compiler/src/index.test.ts packages/cli/src/index.test.ts`
      and `pnpm run check`. Remaining: feed real package-discovery facts into app builds.
      Additional evidence 2026-06-11: `@jiso/core` now exports
      `packageComponentPrefixFactFromPackageManifest()`, which derives package-prefix facts from
      real `package.json` metadata including the new `packages/headless-ui/package.json`
      `jiso.prefix: "jiso-"` manifest field and optional app-side effective-prefix aliases.
      Same-session evidence:
      `pnpm exec vitest --run packages/core/src/package-prefix.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts`
      and
      `pnpm exec vp check packages/core/src/package-prefix.ts packages/core/src/package-prefix.test.ts packages/core/src/index.ts packages/headless-ui/src/index.ts packages/headless-ui/src/tooling/index.ts packages/headless-ui/src/tooling/primitive-handler-lint.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts packages/headless-ui/package.json pnpm-lock.yaml`.
      Remaining: feed those discovered facts into app/compiler/Vite build flow.
- [x] F3 behavior-attribute namespace: `fw-*` stays framework-reserved; package behaviors ride the package prefix (`jiso-tooltip="id"`), wired through FW221 IDREF validation. Evidence: `packages/compiler/src/validate/package-prefixes.ts` rejects package `fw-*` prefixes with FW234 per SPEC §6.1.1, `packages/compiler/src/validate/markup.ts` feeds package-declared IDREF behavior attributes through FW221, and `packages/compiler/src/index.test.ts` covers valid/missing package-prefixed behavior IDREFs plus `fw-*` reservation.
- [ ] F4 primitive-author lint: chained handlers contractually no-op on `event.defaultPrevented` (lives in `@jiso/headless-ui` tooling, not the loader).
      Partial evidence 2026-06-11: `packages/headless-ui/src/tooling/primitive-handler-lint.ts`
      provides a dependency-light tooling API that scans marked primitive handlers and reports
      `JISO_HUI001` when they do not begin by no-oping on the first event parameter's
      `defaultPrevented` state, with diagnostic text citing `SPEC.md` section 4.6. Focused tests
      cover function and arrow handlers, accepted guards, missing guards, and wrong-event guards.
      Same-session evidence:
      `pnpm exec vitest --run packages/core/src/package-prefix.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts`
      and
      `pnpm exec vp check packages/core/src/package-prefix.ts packages/core/src/package-prefix.test.ts packages/core/src/index.ts packages/headless-ui/src/index.ts packages/headless-ui/src/tooling/index.ts packages/headless-ui/src/tooling/primitive-handler-lint.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts packages/headless-ui/package.json pnpm-lock.yaml`.
      Remaining: wire the lint API as a package script/CLI gate over real primitive source.
- [ ] F5 platform audit: CSS anchor positioning + `@starting-style`/`transition-behavior: allow-discrete` coverage check; lazy-loaded floating fallback module decided.
- [ ] H0 shared lib: state-attributes, keyboard/menu navigation maps, typeahead, change-details (reason + `defaultPrevented` contract), positioning fallback.
- [ ] H1 wave 1 primitives (L0-heavy): dialog, alert-dialog, popover, tooltip, hover-card, collapsible, accordion, separator, progress, meter, avatar, toggle, switch, checkbox.
- [ ] H2 wave 2 primitives (stateful L1 islands): tabs, radio-group, toggle-group, checkbox-group, toolbar, number-field, otp-field, scroll-area, field/fieldset as `form()` integration.
- [ ] H3 wave 3 primitives (list-driven & isomorphic): select, combobox, autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast, command.
- [ ] U1 token sheet + `cn()` + statically-analyzable variant helper (Tailwind-first, §13.1 discoverability rules).
- [ ] U2 `fw add <component>` vendoring pipeline (source copied into the app; components register under app-local bare names).
- [ ] U3 styled components trailing H1 + pure-markup set (button, badge, card, kbd, alert, table, breadcrumb, skeleton, sheet/drawer over dialog).
- [ ] U4 styled components trailing H2.
- [ ] U5 styled components trailing H3.
- [ ] G1 `examples/gallery` app: one route per component; demos double as test fixtures.
- [ ] G2 behavior-contract gates: keyboard/ARIA assertions per primitive (browser-free via `page()` + `fw explain` where possible; framework browser suite for focus/dismiss/top-layer).
- [ ] G3 axe checks per component state in the gallery.
- [ ] G4 visual regression for `@jiso/ui`: shadcn-parity human review once, then self-baselined screenshots.
- [ ] G5 merge fixtures: every primitive's attrs record × an author element → golden merged output (doubles as FW231/FW232 coverage).

## Background

Two-layer component system in the qwik-base-ui/shadcn mold, redesigned for Jiso's component model rather than ported:

- `@jiso/headless-ui` — accessible behavior: compound primitives (render-time function composition, SPEC §4.5), attrs-function/`asChild` customization over the §4.6 merge rules, behavior attributes for trigger-shaped cases, `data-state` vocabulary, keyboard maps, ARIA wiring.
- `@jiso/ui` — shadcn-quality Tailwind components wrapping headless-ui or plain markup.
- `examples/gallery` — docs + demo + the standing test surface, in this workspace.

The library is also the framework's conformance suite: ~40 real consumers of §4.5–4.8 (composition, merging, triggers, update plan, stamps, isomorphic islands), all of which exist in the codebase as of 2026-06-11 but have only the commerce app as a consumer.

Behavior contracts (state attributes, ARIA, keyboard maps, change reasons) are ported from Base UI / APG / qwik-base-ui references; implementations are not. The platform absorbs what Base UI hand-rolls: native `<dialog>`/popover/`<details>` + invoker commands replace dismissable-layer/top-layer/focus-trap machinery; CSS anchor positioning + `@starting-style` replace floating/transition-status engines where Baseline allows (F5 audits the gaps).

## Decisions (recorded so we don't relitigate)

- **Naming/registration: package-declared prefixes, compiler-enforced.** Every component package declares a registry prefix (`jiso.prefix` in its package.json); the compiler enforces app-wide prefix uniqueness; conflict is teaching error **FW234** with an app-side alias as the escape hatch. `fw-c` values stay globally meaningful (CSS scoping, docs, debugging folklore transfer between codebases); `fw explain` prints provenance. `jiso-` is the prefix `@jiso/headless-ui` declares, reserved-checked for `@jiso/*` — first-party privilege falls out as a special case of the general rule.
  - Rejected: bare names (first collision converts into an ecosystem renaming scramble; provenance illegible in devtools); first-party-only reserved prefix (privilege, not policy); app-side naming/adoption (identical behavior renders different HTML per app — breaks knowledge portability, the thing Constitution #1 buys).
- **Behavior attributes ride the package prefix** (`jiso-tooltip="pricing-tip"`); `fw-*` remains framework-reserved so loader growth never collides with package behaviors.
- **Distribution split:** `@jiso/headless-ui` is a normal workspace/npm package (prefixed names). `@jiso/ui` is **vendored shadcn-style** via `fw add <component>` — its TSX source lands in the app, so its components are bare-named app components and naming is the app's business; SPEC §5.2's TSX-only authoring rule means the vendored layer must never ship lowered IR.
- **One primitive = one island.** Compound APIs are render-time composition; runtime coordination is the DOM (`closest('[fw-c]')`, no-reparenting rule). No context API, no portals — native top-layer promotion is why none is needed.
- **Forms defer to the framework.** No `Form` primitive: `field`/`fieldset` are label/description/error-wiring helpers around typed `form()` (§6.3); every form-control primitive renders a real named control so the no-JS POST path works natively.
- **Toast is the typed-events test case:** a fixed-position viewport element in the app layout + `emit('toast:show', …)` over the §7 event channel; no reparenting, no portal.
- **W4 deferred (not v1-blocking):** carousel, calendar, resizable — engine-class builds with no jiso dependency gaps; Chart out of scope entirely (per qwik-base-ui's own exclusion).

## F-track — framework seams (spec first, then compiler/runtime)

- **F1 — prefix registration SPEC text.** Landed in SPEC §6.1.1, with FW234 listed in SPEC §11.3 and the §4.6 behavior-attribute example moved to the package prefix.
- **F2 — enforcement.** Compile-time prefix collision → FW234 (show both packages, the alias fix); provenance in `fw explain component`. Current compiler slice validates explicit package prefix facts/config and keeps provenance output as remaining work because `fw explain` lives outside the compiler-owned surface for this pass.
- **F3 — behavior-attribute namespace.** Package behaviors are compiler-known attributes validated like `commandfor` (FW221 machinery); document the `fw-*` reservation.
- **F4 — primitive-author lint.** The §4.6 chain contract ("no-op on `defaultPrevented`") checked over `@jiso/headless-ui` handler sources; keeps the loader dumb.
- **F5 — platform coverage audit.** Decide per concern: CSS anchor positioning (Chromium-led — degradation per §1.3) vs. the lazy floating fallback module (loaded on first trigger interaction, costing nothing until a menu opens); exit-animation coverage via `@starting-style` + `allow-discrete`, with the JS-coordinated escape documented.

## H-track — `@jiso/headless-ui`

`packages/headless-ui`, prefix `jiso-`. Waves are dependency-ordered; all framework prerequisites (composition lowering, merge rules FW231–233, triggers, stamps, isomorphic FW302, `/_q/`) already exist — each wave starts by _verifying_ its prerequisites against real primitives rather than waiting on phases.

- **H0 — shared lib** (`src/lib/`): pure-logic modules portable nearly verbatim from the qwik-base-ui reference (state-attributes, menu-navigation, typeahead, change-details), plus the positioning fallback from F5.
- **H1 — wave 1 (L0-heavy, 14 primitives).** Mostly platform attributes + thin handlers; the compiler's platform-substitution pass should delete most JS — `fw explain component jiso-dialog` listing the substitutions is itself a gate. Switch/checkbox/toggle prove the form-control + merge-table path (logical-OR `disabled`, hidden-input-free native controls).
- **H2 — wave 2 (stateful L1 islands, 9 primitives).** Group semantics (roving tabindex via keyboard maps), stamps for group rendering, `ctx.signal` cleanup, `on:visible` where warranted.
- **H3 — wave 3 (list-driven & isomorphic, 10 primitives).** `isomorphic: true` (FW302-justified per component) for client-driven list rendering; `fw-key` reorder under optimism; `/_q/` for async combobox/autocomplete options; command = combobox × dialog composition; toast per the decision above.

## U-track — `@jiso/ui`

- **U1 — foundations.** Token sheet (CSS custom properties), `cn()`, variant helper with statically-discoverable class output (§13.1: no dynamic class strings; safelist rules documented).
- **U2 — vendoring pipeline.** `fw add <component>` copies TSX source + its headless-ui imports' styled wrappers into the app; idempotent re-add; the vendored source must pass the same TSX authoring checks as local app code.
- **U3–U5 — components**, trailing each H-wave by one step; U3 also carries the pure-markup set that needs no behavior layer (button, badge, card, kbd, alert, table, breadcrumb, skeleton) and sheet/drawer as styled dialog variants.

## G-track — gallery (`examples/gallery`)

Same workspace, same Vite+ config, alongside `examples/commerce`. One route per component: rendered demo, behavior-contract table (`data-state` values, keyboard map, change reasons), and the no-JS degradation statement per primitive. The demos are the fixtures G2–G5 run against — no separate test app.

## Quality gates (standing, added as each exists)

1. **Behavior parity, measured:** per-primitive keyboard/ARIA assertions against the APG/Base UI contract — browser-free via `@jiso/test` `page()` HTML assertions + `fw explain` graph checks where wiring suffices; focus/dismiss/top-layer joins the framework-owned browser suite (§11.4).
2. **a11y:** axe per component state in the gallery.
3. **Visual (`@jiso/ui` only):** shadcn-parity human review once, then self-baselined screenshot regression — never pixel-parity against React renders.
4. **Merge goldens:** G5 fixtures pin the §4.6 table per primitive; FW231/FW232 diagnostics get real-world coverage.
5. **Eager-JS budget:** `grep 'on:load'` and FW302 counts in headless-ui are reviewed per wave — every isomorphic island names its justification (SPEC §16.7 discipline applied to the library itself).

## Exit criteria

- F1–F4 landed (FW234 golden message; provenance in explain output).
- H1+H2 primitives shipped with all five gates green; H3 shipped with FW302 justifications reviewed.
- `fw add button card dialog` produces a working styled app surface in the starter; vendored TSX output passes the fixpoint gate.
- Gallery deployed as the docs surface; the §16.2 legibility study can use gallery components as its material.
- W4 (carousel/calendar/resizable) explicitly re-triaged after exit, not silently dropped.
