# UI Libraries - `@jiso/headless-ui`, `@jiso/ui`, And Gallery

Status: active. Last compacted on 2026-06-13.

Scope: `packages/headless-ui`, `packages/ui`, `examples/gallery`, package-prefix/behavior seams,
vendoring, and gallery conformance.

Keep this file compact. Track the current checklist, open work, risks, and latest proving commands.
Use `- [ ]` for open actionable work and `- [x]` only for fully verified work.

## Checklist

- [x] F1 SPEC text: package prefix registration, `jiso-*` reservation, alias escape, behavior
      namespace implications, FW234.
- [x] F2 compiler/CLI prefix enforcement: package manifest prefix facts, aliasing, `fw explain`
      component provenance, Vite/CLI discovery.
- [x] F3 behavior namespace: `fw-*` is reserved; package behaviors use package prefixes and
      participate in FW221 IDREF validation.
- [x] F4 primitive author lint: primitive handlers no-op on `event.defaultPrevented`.
- [x] F5 platform audit: native-first platform decisions and floating fallback boundary.
- [x] H0 shared primitive helpers: state/data attrs, cancelable changes, keyboard maps, typeahead,
      and positioning fallback.
- [x] H1 primitives: dialog, alert-dialog, popover, tooltip, hover-card, collapsible, accordion,
      separator, progress, meter, avatar, toggle, switch, checkbox.
- [x] H2 primitives: tabs, radio-group, toggle-group, checkbox-group, toolbar, number-field,
      otp-field, scroll-area, field/fieldset integration. (All nine have headless primitive+tests,
      styled `@jiso/ui` component, gallery route, G2 behavior contract, and compiled interactive
      demo with browser + G3 axe-per-state coverage. Verified: `vitest packages/headless-ui
  packages/ui examples/gallery` 530 pass + gallery browser 39 pass; emit-in-sync.)
- [ ] H3 primitives: select, combobox, autocomplete, dropdown-menu, context-menu, menubar,
      navigation-menu, slider, toast, command.
- [x] U1 styled foundation: token sheet, `cn()`, statically analyzable variant helper.
- [x] U2 `fw add <component>` vendoring pipeline.
- [x] U3 styled H1 and pure-markup components.
- [x] U4 styled H2 components.
- [x] U5 styled H3 components.
- [x] G1 gallery static fixture surface: one route per component with source/markup snapshot.
- [ ] G2 behavior-contract gates: keyboard, ARIA, native state, and `fw explain` coverage.
- [ ] G3 axe checks per component state. (H1 + H2 interactive families now run axe on
      post-transition end-states; H3 axe-per-state audit pending before global close.)
- [ ] G4 visual regression baseline for `@jiso/ui`.
- [x] G5 merge fixtures for primitive attrs plus author elements.
- [ ] G6 compiled interactive gallery authored as app TSX and exercised in browser.

## Current State

- [x] Headless UI exports H0 helpers and H1/H2/H3 primitive helpers through package subpaths.
- [x] `@jiso/ui` ships vendorable TSX wrappers for pure-markup components and current primitive
      wrapper surfaces.
- [x] `fw add` vendors package-synchronized TSX source and rejects unknown names with the generated
      catalog list.
- [x] Gallery tests cover static fixtures, behavior contracts, merge fixtures, compiled demos,
      generated-client DOM/ref/export contracts, and static docs export wiring.
- [x] Static gallery routes consistently expose `data-ui-demo` wrappers for disclosure/overlay styled
      source surfaces while preserving SPEC §3.1 light-DOM behavior.
- [x] G5 exported primitive attrs inventory is closed for all exported primitive `*Attributes`
      builders, including author stress attrs, rendered merge goldens, and SPEC §4.6 diagnostics.
- [x] Recent coverage includes form ownership, canceled-change restoration, keyboard no-trap
      behavior, roving focus, typeahead, disabled states, compiled gallery generated handlers, axe
      checks, and visual baselines across many H1/H2/H3 surfaces.

## Open Work

- [ ] Re-audit H2 exports, tests, styled wrappers, gallery routes, behavior contracts, merge
      fixtures, and compiled interactive coverage before checking H2 complete.
- [ ] Re-audit H3 exports, tests, styled wrappers, gallery routes, behavior contracts, and compiled
      interactive coverage before checking H3 complete.
- [ ] Finish remaining state, focus, menu, and canceled-change restoration gaps for select,
      combobox, autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast,
      and command.
- [ ] Expand G2 until every primitive and styled component has relevant behavior-contract and
      `fw explain` provenance coverage.
- [ ] Add or refresh G3 axe checks per meaningful component state once route/state coverage is stable.
- [ ] Add or refresh G4 visual baselines for remaining `@jiso/ui` route families.
- [ ] Keep G6 compiled interactive demos app-authored TSX, checked in, generated-artifact fresh, and
      browser-exercised.
- [ ] Keep vendored source app-authored TSX: no `@jiso/ui` self-imports, no hand-authored lowered IR.
- [ ] Keep CLI add-catalog tests synchronized with `packages/ui/package.json` exports.

## Current Evidence

- [x] Scroll-area G3/G6 state coverage now uses headless `data-scroll-y`/thumb position attrs in the
      compiled demo, keeps generated artifacts fresh per SPEC §5.2, and runs axe after the generated
      end-state transition. Verified with gallery emit, UI wrapper test, gallery node/browser tests,
      UI/gallery `tsc`, exact `vp check`, and `git diff --check`.
- [x] G6 compiled sheet and drawer demos are app-authored TSX, generated into checked server/client
      artifacts, wired into gallery docs/manifest/export registry, and browser-tested for native
      dialog `commandfor` open plus `request-close` close behavior. Verified with gallery emit
      check, UI/gallery tests, full gallery browser test, gallery `tsc`, exact `vp check`, and
      `git diff --check`.
- [x] H3 styled menu/listbox native disabled behavior is covered for command, dropdown-menu,
      context-menu, and menubar. Verified with `packages/ui/src/index.test.tsx`,
      gallery demo-fixture tests, browser native-disabled and representative styled route checks,
      `tsc`, exact `vp check`, and `git diff --check`.
- [x] Overlay trigger disabled semantics and provenance are covered for hover-card and tooltip.
      Verified with UI tests, gallery behavior/provenance tests, representative browser route check,
      `tsc`, exact `vp check`, and `git diff --check`.
- [x] G1 static route source/markup closure is checked for all styled exports, including source
      fixtures and markup snapshots.
- [x] Recent visual baseline coverage includes simple styled, native status/display, H1/native
      toggle, H2 roving controls, radio-group, checkbox/switch, H3 autocomplete/combobox,
      menu/navigation, command, toast, and pure-markup gallery routes.
- [x] Recent compiled gallery coverage includes tabs, toolbar, field/fieldset, number-field,
      radio-group, toggle-group, checkbox-group, slider, select, combobox/autocomplete, command,
      navigation-menu, toast, checkbox mixed-state, and pure-markup generated click state.
- [x] Broad historical gate after `0cac62d`: `pnpm run check` passed with 782 formatted files,
      682 lint/typechecked files, and 7 example/conformance typecheck projects.

## Risks

- [ ] H2/H3 checkboxes remain open until a same-session audit verifies every named primitive family
      has exports, tests, wrappers, gallery route, behavior contract, and compiled/browser coverage.
- [ ] G3/G4/G6 remain open until coverage is proven across the full component set, not only recently
      touched route families.
- [ ] Browser visual checks may occasionally hit transient hash variants; rerun once and record
      whether the rerun passes without code changes.

## Active Queue

- [ ] Refill UI worker lane from the latest integrated head if more disjoint G2/G3/G4/G6 work is
      available.

## Rules

- [ ] Prefer one coherent primitive family or gallery/conformance gap per branch.
- [ ] Evidence must name the commands and files that prove the checked item.
- [ ] Do not add long historical logs; summarize old evidence into the rollup above.
