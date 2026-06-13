# UI Libraries - `@jiso/headless-ui`, `@jiso/ui`, And Gallery

Status: active. Last compacted on 2026-06-13.

Scope: `packages/headless-ui`, `packages/ui`, `examples/gallery`, plus framework seams for package
prefixes, behavior attributes, primitive authoring lint, vendoring, and gallery conformance.

Keep this file compact. Track the current checklist, open work, current risks, and latest proving
commands. Use `- [ ]` for open actionable work and `- [x]` only for fully verified work.

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
- [ ] H2 primitives: tabs, radio-group, toggle-group, checkbox-group, toolbar, number-field,
      otp-field, scroll-area, field/fieldset integration.
- [ ] H3 primitives: select, combobox, autocomplete, dropdown-menu, context-menu, menubar,
      navigation-menu, slider, toast, command.
- [x] U1 styled foundation: token sheet, `cn()`, statically analyzable variant helper.
- [x] U2 `fw add <component>` vendoring pipeline.
- [x] U3 styled H1 and pure-markup components.
- [x] U4 styled H2 components.
- [x] U5 styled H3 components.
- [ ] G1 gallery static fixture surface: one route per component with source/markup snapshot.
- [ ] G2 behavior-contract gates: keyboard, ARIA, native state, and `fw explain` coverage.
- [ ] G3 axe checks per component state.
- [ ] G4 visual regression baseline for `@jiso/ui`.
- [x] G5 merge fixtures for primitive attrs plus author elements.
- [ ] G6 compiled interactive gallery authored as app TSX and exercised in browser.

## Current State

- [x] Headless UI exports H0 helpers and H1/H2/H3 primitive helpers through package subpaths.
- [x] `@jiso/ui` ships vendorable TSX wrappers for pure-markup components and current primitive
      wrapper surfaces.
- [x] `fw add` vendors package-synchronized TSX source and rejects unknown names with the generated
      catalog list.
- [x] Gallery tests cover static fixtures, behavior contracts, merge fixtures, compiled
      interactive demos, generated-client DOM/ref/export contracts, and static docs export wiring.
- [x] G5 exported primitive attrs inventory is closed for all exported primitive `*Attributes`
      builders, including author stress attrs, rendered merge goldens, and SPEC §4.6 diagnostics.
- [x] Recent native-state coverage includes number-field off-grid stepping, checkbox-group canceled
      restoration, OTP delete/paste restoration and constraints, scroll-area viewport state, H3
      typeahead/movement/disabled-option handling, command option ids, and navigation-menu
      Enter/Space trigger activation. Slider now snaps explicit step values before exposing state
      or committing input/programmatic changes, restores rejected native input values, and proves
      delegated gallery input handling through refreshed generated artifacts and a browser test.
      Combobox and autocomplete now select highlighted options from Enter keydown, restore previous
      value/input state when option-select follow-up changes are canceled, and prove generated
      keydown handlers through browser-backed gallery tests. Tabs manual activation now selects
      the focused tab from Enter/Space through the cancelable keyboard path and proves generated
      keydown selection in the compiled gallery. Toolbar keydown no longer traps disabled/empty
      collections, and the compiled gallery now proves roving focus movement through refreshed
      generated artifacts and a browser-backed focus assertion. Field/fieldset integration now
      exposes native fieldset `name`, keeps the disable toggle in the first legend, and proves
      browser `FormData` inclusion/omission for grouped controls as fieldset disabled state changes.

## Open Work

- [ ] Re-audit H2 exports, tests, styled wrappers, gallery routes, behavior contracts, merge
      fixtures, and compiled interactive coverage before checking H2 complete.
      Evidence so far: scroll-area native scroll-state coverage is closed; field controls preserve
      disabled/native constraint/autofill attributes and gallery validity hints; field controls
      and fieldsets now preserve native `form` owner attributes through headless helpers, styled
      wrappers, static gallery contracts, generated interactive artifacts, and browser-backed
      `FormData`/`checkValidity()` evidence. Tabs manual Enter/Space activation is covered by
      headless tests, styled `activeValue` forwarding, static gallery tests, refreshed generated
      artifacts, and a browser-backed generated keydown selection test. Toolbar disabled/empty
      keyboard no-op behavior is covered by headless tests, while refreshed generated toolbar
      artifacts and browser tests prove roving tabindex plus DOM focus movement.
- [x] Close remaining field/fieldset behavior gaps with primitive tests tied to `form()`
      integration and native validity semantics.
      Evidence 2026-06-13: `packages/headless-ui/src/primitives/field.ts` and
      `packages/ui/src/field.tsx` expose native `form` ownership for controls and fieldsets;
      `examples/gallery/src/interactive/field-demo.tsx` proves named field submission and pattern
      validity through generated artifacts and a browser test. Evidence 2026-06-13:
      `fieldsetRootAttributes()` and `Fieldset` now preserve native fieldset `name`;
      `examples/gallery/src/interactive/field-demo.tsx` keeps the fieldset disabled toggle inside
      the first legend and adds a grouped `gallery-seat` control; refreshed generated artifacts and
      `examples/gallery/src/interactive-gallery.browser.test.ts` prove `FormData` includes the seat
      while enabled, omits it while the fieldset is disabled, and re-includes it after re-enable.
- [ ] Re-audit H3 exports, tests, styled wrappers, gallery routes, behavior contracts, and
      browser-backed interactive coverage before checking H3 complete.
      Evidence so far: navigation-menu trigger keyboard activation covers Enter, Space, legacy
      Spacebar, native-link pass-through, disabled content, and matching gallery behavior
      contracts; dropdown-menu and context-menu item keyboard activation covers Enter, Space,
      legacy Spacebar, disabled/canceled state, headless barrel exports, static gallery contracts,
      and compiled/browser interactive gallery keydown selection. Menubar submenu item keyboard
      activation now covers Enter, Space, legacy Spacebar, disabled/canceled state, headless barrel
      exports, generated-client DOM refs, and compiled/browser interactive gallery keydown
      selection. Select now omits inactive native boolean attributes while preserving active
      `selected`/`disabled` option state through headless records, styled markup, static gallery
      fixtures, and browser-backed compiled gallery output. Command item selection now restores
      previous value state when dialog close is canceled, and the compiled interactive command demo
      covers keydown selection/close through refreshed generated artifacts and a browser test.
- [ ] Close remaining state, focus, menu, and canceled-change restoration gaps for select,
      combobox, autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast,
      and command with primitive tests plus gallery evidence where user-visible.
      Evidence 2026-06-13: `packages/headless-ui/src/primitives/combobox.ts` and
      `packages/headless-ui/src/primitives/autocomplete.ts` select the highlighted option on Enter
      through the same cancelable option-select path as click; their tests cover keyboard
      selection and value/input restoration when close or input follow-up changes are canceled.
      `examples/gallery/src/interactive/{combobox,autocomplete}-demo.tsx` and refreshed generated
      artifacts prove delegated keydown handlers, with static and browser gallery tests covering
      the generated behavior.
- [ ] Keep vendored source app-authored TSX: no `@jiso/ui` self-imports, no hand-authored lowered
      IR, no `fw-c=`, and no `data-bind=` in vendored component source.
- [ ] Keep CLI add-catalog tests synchronized with `packages/ui/package.json` exports and resolve
      catalog fixture drift whenever new UI subpaths are exported.
- [ ] Expand G1/G2 until every primitive and styled component has a static route, source/markup
      snapshot, relevant behavior contract, and provenance coverage.
- [ ] Add G3 axe checks and G4 visual baselines once route/state coverage is stable enough to avoid
      churn-heavy baselines.
- [ ] Keep G6 compiled interactive demos app-authored TSX, checked in, generated-artifact fresh,
      and browser-tested when behavior changes.

## Latest Gates

- [x] Field/fieldset native form closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/field.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t field`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t field)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/field.ts packages/headless-ui/src/primitives/field.test.ts packages/ui/src/field.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/field-demo.tsx examples/gallery/src/generated/interactive/field-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Toolbar roving focus closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/toolbar.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toolbar`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t toolbar)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/toolbar.ts packages/headless-ui/src/primitives/toolbar.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/toolbar-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Tabs manual keyboard activation slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/tabs.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t tabs`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t tabs)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/tabs.ts packages/headless-ui/src/primitives/tabs.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Menubar keyboard selection slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/menubar.test.ts`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t menubar`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/menubar.ts packages/headless-ui/src/primitives/menubar.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
      `git diff --check`.
- [x] Dropdown/context-menu keyboard selection slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.test.ts`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/dropdown-menu.ts packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.tsx examples/gallery/src/interactive/dropdown-menu-demo.tsx examples/gallery/src/interactive/context-menu-demo.tsx examples/gallery/src/generated/interactive/dropdown-menu-demo.tsx examples/gallery/src/generated/interactive/dropdown-menu-demo.client.js examples/gallery/src/generated/interactive/context-menu-demo.tsx examples/gallery/src/generated/interactive/context-menu-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Navigation-menu closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/navigation-menu.test.ts`;
      `pnpm exec vitest --run examples/gallery/src/behavior-contracts.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t navigation-menu`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/navigation-menu.ts packages/headless-ui/src/primitives/navigation-menu.test.ts examples/gallery/src/demo-fixtures.tsx examples/gallery/src/behavior-contracts.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Select native boolean closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/select.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t select`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t select)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/select.ts packages/headless-ui/src/primitives/select.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
      `git diff --check`.
- [x] Command canceled-close and compiled keydown slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/command.test.ts`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t command)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/command.ts packages/headless-ui/src/primitives/command.test.ts examples/gallery/src/interactive/command-demo.tsx examples/gallery/src/generated/interactive/command-demo.tsx examples/gallery/src/generated/interactive/command-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md IMPLEMENT_v1.md`;
      `git diff --check`.
- [x] Slider step-state and compiled input slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/slider.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t slider`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t slider)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/slider.ts packages/headless-ui/src/primitives/slider.test.ts examples/gallery/src/interactive/slider-demo.tsx examples/gallery/src/generated/interactive/slider-demo.tsx examples/gallery/src/generated/interactive/slider-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Combobox/autocomplete Enter selection slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/autocomplete.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t "combobox|autocomplete"`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "combobox|autocomplete")`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/combobox.ts packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/autocomplete.ts packages/headless-ui/src/primitives/autocomplete.test.ts examples/gallery/src/interactive/combobox-demo.tsx examples/gallery/src/interactive/autocomplete-demo.tsx examples/gallery/src/generated/interactive/combobox-demo.tsx examples/gallery/src/generated/interactive/combobox-demo.client.js examples/gallery/src/generated/interactive/autocomplete-demo.tsx examples/gallery/src/generated/interactive/autocomplete-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Field native form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/field.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t field`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t field)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/field.ts packages/headless-ui/src/primitives/field.test.ts packages/ui/src/field.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/field-demo.tsx examples/gallery/src/generated/interactive/field-demo.tsx examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Broad gate after `0cac62d`: `pnpm run check` passed with 782 formatted files, 682
      lint/typechecked files, and 7 typechecked example/conformance projects.

## Rules

Prefer native platform behavior first; JS should add state coordination only when native semantics
are insufficient. Primitive handlers must respect `event.defaultPrevented` and leave DOM/native
state coherent after canceled changes. Behavior attributes belong to package prefixes such as
`jiso-*`; framework `fw-*` stays reserved. `@jiso/ui` components are vendored TSX source, not
runtime imports from the package. Gallery evidence should prove authored TSX, rendered markup,
generated clients, and browser behavior where each surface is relevant.
