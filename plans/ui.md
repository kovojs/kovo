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
      Switch now preserves native checkbox external `form` ownership through headless/styled
      wrappers, static fixture coverage, refreshed generated artifacts, and browser-backed
      `FormData` checks.
      Number-field now preserves native input `form` ownership through headless/styled wrappers and
      proves generated direct input plus stepper updates keep browser `FormData` current.
      OTP field now preserves external form ownership for its aggregate hidden input through
      headless/styled wrappers, static fixture contracts, refreshed generated artifacts, and
      browser-backed `FormData` checks as generated handlers update the value.
      Toggle-group keydown no longer traps disabled, empty, or fully disabled collections, and the
      compiled gallery now proves generated roving tabindex plus DOM focus movement.
      Checkbox-group now preserves native checkbox `form` ownership through headless/styled
      wrappers, avoids trapping keyboard navigation for disabled/empty collections, and proves
      generated roving focus plus browser `FormData` updates. Slider now preserves native range
      input `form` ownership through headless/styled wrappers, static gallery contracts, refreshed
      generated artifacts, and browser-backed external `FormData` evidence. Toast action controls
      now expose non-dismissing action intent through headless/styled attrs, and the compiled
      gallery proves a canceled action keeps visible/open state before a later dismiss closes it.
      Checkbox mixed state now has an exported native `indeterminate` property helper; the compiled
      checkbox demo clears the property after generated state transitions, and the route-level axe
      gate enforces `aria-conditional-attr` without a checkbox exception. Toast disabled
      non-dismissing actions now prevent native follow-up behavior in the primitive, render disabled
      state through styled/static and compiled gallery surfaces, and stay stable under route-level
      axe plus browser state checks.

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
      artifacts and browser tests prove roving tabindex plus DOM focus movement. Number-field
      native form ownership and generated direct input handling are covered by headless/styled
      tests, static gallery contracts, refreshed generated artifacts, and browser-backed
      `FormData` checks for input and stepper paths. Radio-group native form ownership is covered
      by headless/styled tests, static gallery contracts, refreshed generated artifacts, and a
      browser-backed `FormData` check across generated keyboard and click selection paths.
      Toggle-group disabled/empty keyboard no-op behavior is covered by headless tests, while
      refreshed generated toggle-group artifacts and browser tests prove roving tabindex plus DOM
      focus movement. Radio-group keyboard handling now no-ops without trapping keys for disabled,
      empty, or fully disabled collections, with existing static/generated/browser gallery gates
      re-run for the radio route. Checkbox-group native form ownership and disabled/empty keyboard
      no-trap behavior are covered by headless/styled tests, static gallery contracts, refreshed
      generated artifacts, and browser-backed `FormData` plus roving DOM focus evidence.
      Tabs activation keys now no-op without trapping default behavior when the tab set is
      disabled, empty, or focused on a disabled value; refreshed generated artifacts and browser
      coverage prove manual roving focus remains separate from selected panel activation. Slider
      external form ownership is covered by headless/styled tests, static gallery contracts,
      refreshed generated artifacts, and a browser-backed `FormData` check across the generated
      native range input update path. OTP aggregate hidden-input external form ownership is covered
      by headless/styled tests, static gallery contracts, refreshed generated artifacts, and a
      browser-backed `FormData` check across generated value updates.
- [ ] Add G3 axe checks and G4 visual baselines once route/state coverage is stable enough to avoid
      churn-heavy baselines.
      Evidence 2026-06-13: compiled interactive gallery now has a browser-backed `axe-core` route
      gate over all generated demos, with focused rule exceptions documented next to the test for
      current combobox/section role-table drift. Context-menu triggers now expose `role="button"`,
      OTP requiredness stays
      on native inputs instead of unsupported group `aria-required`, and toast live regions render
      on neutral elements. Menubar compiled demos now keep state outputs and popup menu content
      outside the `role="menubar"` root, so `aria-required-children` is enforced by the route-level
      axe gate. Checkbox mixed state now applies the native `indeterminate` DOM property before the
      route scan and removes the `aria-conditional-attr` exception; verified by
      `packages/headless-ui/src/primitives/checkbox.test.ts` and
      `examples/gallery/src/interactive-gallery.browser.test.ts`. Dialog route snapshots no longer
      require the route-level `aria-hidden-focus` exception; verified by
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`.
      Evidence 2026-06-13: `examples/gallery/src/interactive-gallery.browser.test.ts` now includes
      a deterministic Chromium visual-baseline scaffold for the compiled interactive route plus
      switch and dropdown-menu representative states, asserting viewport geometry and stable
      screenshot hashes without committing binary screenshots.
      Evidence 2026-06-13: combobox inputs now relate to popup listboxes with `aria-controls`
      without the native datalist `list` attribute, and generated radio-group/toolbar demos render
      role-bearing roots on neutral `div` hosts. The compiled route axe gate now runs with no
      disabled rules, and a browser-backed state axe test covers generated dropdown open, command
      dialog open, field invalid/error, and toast live-region states.
      Evidence 2026-06-13: styled static gallery visual fixtures now cover representative H2
      tabs, H3 select, and pure-markup table routes with raw HTML synchronized against
      `renderGalleryRoute()`. The Chromium visual baseline gate asserts deterministic geometry and
      screenshot hashes for those `@jiso/ui` static routes.
      Evidence 2026-06-13: the static visual baseline now also covers the H3 command route,
      including its dialog, combobox input, listbox, empty state, close button, and value output;
      `examples/gallery/src/visual-fixtures/command.html.txt` is synchronized against
      `renderGalleryRoute()`, and the Chromium browser gate asserts deterministic `860x512`
      geometry plus hash `d46c4bd3`.
      Evidence 2026-06-13: the static visual baseline now covers the H2 native form-control route
      family: checkbox-group, radio-group, number-field, otp-field, and slider. Their raw route
      fixtures are synchronized against `renderGalleryRoute()`, and the Chromium browser gate
      asserts deterministic route geometry plus screenshot hashes `e9a5f503`, `80d7704e`,
      `d5277948`, `6b72f908`, and `5ff031a5`.
      Evidence 2026-06-13: the static visual baseline now covers the H3 menu/navigation route
      family: context-menu, dropdown-menu, menubar, and navigation-menu. Their raw route fixtures
      are synchronized against `renderGalleryRoute()`, and the Chromium browser gate asserts
      deterministic route geometry plus screenshot hashes `08c100b6`, `bc8bc631`, `279cb945`,
      and `3c8e6a99`.
      Evidence 2026-06-13: the static visual baseline now covers the H3 toast route, including
      success variant action/close controls and the closed assertive toast state. The raw route
      fixture is synchronized against `renderGalleryRoute()`, and the Chromium browser gate
      asserts deterministic `860x543` geometry plus hash `31f9f1c4`.
      Evidence 2026-06-13: the static visual baseline now covers the overlay route family:
      hover-card, popover, and tooltip. Tooltip's static route now renders the styled
      `@jiso/ui` wrapper surface, the raw route fixtures are synchronized against
      `renderGalleryRoute()`, and the Chromium browser gate asserts deterministic route geometry
      plus screenshot hashes `5e6e6eb4`, `cf798fae`, and `fcf88f35`.
      Evidence 2026-06-13: the static visual baseline now covers the H3 autocomplete and combobox
      input route family. Their raw route fixtures are synchronized against `renderGalleryRoute()`,
      and the Chromium browser gate asserts deterministic route geometry plus screenshot hashes
      `b23aee53` and `38d910c8`.
      Evidence 2026-06-13: the static visual baseline now covers the simple styled route family:
      badge, breadcrumb, button, card, kbd, and skeleton. The button route also proves external
      native `form` ownership in authored TSX per SPEC §3.1 light-DOM/native-form fallback. Raw
      route fixtures are synchronized against `renderGalleryRoute()`, and the Chromium browser gate
      asserts deterministic route geometry plus screenshot hashes `4af1bf12`, `fa14c61f`,
      `ff922618`, `d3536b91`, `70bf25ac`, and `827c88ad`.
      Evidence 2026-06-13: the `@jiso/ui` root barrel now exports `Drawer` from authored
      `packages/ui/src/drawer.tsx` plus `drawerContentClassNames`/`drawerContentClasses`, matching
      the `./drawer` package subpath. The static visual baseline now covers the drawer/sheet dialog
      route family; raw route fixtures are synchronized against `renderGalleryRoute()`, and the
      Chromium browser gate asserts deterministic `860x503` geometry plus hashes `d6203776` and
      `538e1a6e`.
      Evidence 2026-06-13: `packages/ui/src/field.tsx` now exports `FieldSelectOption` plus
      option class helpers so field select options can be authored as vendorable TSX while
      preserving SPEC §3.1 light-DOM/native form participation. The field static route now uses
      authored option wrappers, `examples/gallery/src/visual-fixtures/field.html.txt` is
      synchronized against `renderGalleryRoute()`, and the Chromium visual gate asserts
      deterministic `860x874` geometry plus hash `d1dab468`.
      Evidence 2026-06-13: the static visual baseline now covers the native status/display route
      family: avatar, meter, progress, scroll-area, and separator. Avatar, meter, progress, and
      separator static routes now render the styled `@jiso/ui` wrapper surface while preserving
      native light-DOM semantics from SPEC §3.1; raw route fixtures are synchronized against
      `renderGalleryRoute()`, and the Chromium visual gate asserts deterministic route geometry
      plus screenshot hashes `4bc833e5`, `fa0430d8`, `4c10b845`, `c3e213c2`, and `75cba077`.
      Evidence 2026-06-13: the static visual baseline now covers the H1/native toggle route
      family: accordion, alert, alert-dialog, checkbox, collapsible, dialog, disclosure, switch,
      and toggle. Accordion, alert-dialog, and dialog static routes now render the styled
      `@jiso/ui` wrapper surface while preserving native light-DOM semantics from SPEC §3.1;
      checkbox now preserves external native `form` ownership through the styled wrapper and
      static gallery route. Raw route fixtures are synchronized against `renderGalleryRoute()`,
      and the Chromium visual gate asserts deterministic route geometry plus screenshot hashes
      `22704a32`, `0de1166f`, `38a73445`, `acf6aad0`, `6bd00d65`, `cd8996f0`, `0653d48e`,
      `14372e1a`, and `d9dab2de`.
      Evidence 2026-06-13: the static visual baseline now covers the remaining H2 roving-control
      route family: toggle-group and toolbar. Raw route fixtures are synchronized against
      `renderGalleryRoute()`, and the Chromium visual gate asserts deterministic `860x635`
      geometry plus screenshot hashes `ad8d5436` and `c1d2d1b8`.
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
      Select's compiled interactive gallery handler now reads the native change target instead of
      toggling synthetic state and restores the previous native value when a disabled option change
      is attempted. Dropdown-menu, context-menu, and menubar selection now restore unselected state
      when the required item-select close transition is canceled, with context-menu anchor point
      preservation covered by primitive tests and existing compiled gallery browser route checks
      rerun for dropdown/context and menubar. Command keyboard selection now prevents native
      follow-up behavior when Enter selection or Escape close is canceled, with primitive tests,
      styled wrapper smoke coverage, refreshed generated artifacts, and browser-backed command
      route evidence for a canceled Enter that leaves the dialog open and value restored.
- [ ] Close remaining state, focus, menu, and canceled-change restoration gaps for select,
      combobox, autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast,
      and command with primitive tests plus gallery evidence where user-visible.
      Evidence 2026-06-13: `packages/headless-ui/src/primitives/combobox.ts` and
      `packages/headless-ui/src/primitives/autocomplete.ts` select the highlighted option on Enter
      through the same cancelable option-select path as click; their tests cover keyboard
      selection and value/input restoration when close or input follow-up changes are canceled.
      `examples/gallery/src/interactive/{combobox,autocomplete}-demo.tsx` and refreshed generated
      artifacts prove delegated keydown handlers, with static and browser gallery tests covering
      the generated behavior. Evidence 2026-06-13: `examples/gallery/src/interactive/select-demo.tsx`
      now restores disabled option changes through app-authored TSX; refreshed generated artifacts,
      `examples/gallery/src/interactive-gallery.test.ts`, and
      `examples/gallery/src/interactive-gallery.browser.test.ts` prove state and native `<select>`
      restoration in generated/client and Chromium-backed paths. Evidence 2026-06-13:
      select now preserves native external `form` ownership through headless/styled wrappers,
      static gallery contracts, refreshed generated artifacts, and a browser-backed `FormData`
      check across the generated native select change and disabled-option restoration paths.
      Evidence 2026-06-13:
      `selectDropdownMenuItem()`, `selectContextMenuItem()`, and `selectMenubarItem()` now report
      `selected: false` and preserve the previous open state when their follow-up item-select
      close change is canceled; context-menu also preserves its previous anchor point. Verified by
      focused headless tests, styled wrapper smoke coverage, static/generated gallery contracts,
      and browser route tests for generated dropdown/context menu and menubar demos.
      Evidence 2026-06-13: `sliderInputAttributes()` and styled `SliderInput` now preserve native
      external `form` ownership for the range control; static and compiled gallery routes prove the
      authored TSX remains generated-artifact fresh and Chromium `FormData` follows the generated
      input handler from `25` to `75`. Evidence 2026-06-13:
      `toastActionAttributes({ dismissOnAction: false })` and styled `ToastAction` now preserve a
      non-dismissing action marker; static fixtures, refreshed generated artifacts, generated-client
      tests, and a browser-backed compiled gallery test prove the canceled toast action prevents
      default, leaves `fw-state`/DOM visibility open, and a following dismiss closes the toast.
      Evidence 2026-06-13: toast action/close controls now preserve explicit variant state through
      headless attributes and styled wrappers; the static gallery route proves success variant
      action and dismiss controls, and the raw visual fixture plus Chromium baseline gate cover the
      rendered route.
      Evidence 2026-06-13: `navigationMenuKeyDown()` now prevents native follow-up activation for
      enabled content triggers when keyboard open is unchanged or canceled, styled
      `NavigationMenu`/`NavigationMenuList` render primitive `data-state`, and the compiled
      navigation-menu gallery proves Enter keyboard open, canceled Escape restoration, roving
      focus, and link selection through refreshed generated artifacts plus a browser-backed check.
      Evidence 2026-06-13: combobox and autocomplete now preserve native external `form`
      ownership through headless input attributes and styled input wrappers; static gallery
      contracts and refreshed compiled demos prove the app-authored TSX, while browser checks
      assert generated-handler value changes update `FormData` for the external form. Evidence
      2026-06-13: `commandKeyDown()` now prevents default for canceled Enter selection and
      canceled Escape close paths; the compiled command gallery records a canceled Enter action
      through refreshed generated artifacts and Chromium-backed DOM/state assertions. Evidence
      2026-06-13: command input now preserves native `autocomplete`, `form`, `name`, `required`,
      and invalid state through headless/styled wrappers; static fixtures and refreshed compiled
      command artifacts prove the authored TSX, while Chromium-backed gallery tests assert the
      external `FormData` value moves from empty to `invite` through the generated input handler.
      Evidence 2026-06-13: `toastActionClick()` now prevents default for disabled
      non-dismissing actions before returning unchanged state; `ToastAction` and the static toast
      route prove disabled `data-disabled`/native `disabled` forwarding, while refreshed compiled
      toast artifacts and Chromium-backed gallery checks prove the disabled action remains inert
      and axe-clean.
- [ ] Keep vendored source app-authored TSX: no `@jiso/ui` self-imports, no hand-authored lowered
      IR, no `fw-c=`, and no `data-bind=` in vendored component source.
- [ ] Keep CLI add-catalog tests synchronized with `packages/ui/package.json` exports and resolve
      catalog fixture drift whenever new UI subpaths are exported.
- [ ] Expand G1/G2 until every primitive and styled component has a static route, source/markup
      snapshot, relevant behavior contract, and provenance coverage.
- [ ] Keep G6 compiled interactive demos app-authored TSX, checked in, generated-artifact fresh,
      and browser-tested when behavior changes.

## Latest Gates

- [x] Styled checkbox/switch description and static form-owner slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts packages/ui/src/index.test.tsx`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "preserves styled checkbox and switch native form ownership in static routes")`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "keeps stable visual baselines for representative styled static gallery routes")`;
      exact `pnpm exec vp check packages/ui/src/checkbox.tsx packages/ui/src/switch.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/checkbox.html.txt examples/gallery/src/visual-fixtures/switch.html.txt plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] H2 roving-control static visual-baseline slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "static visual fixture"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static gallery routes")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/toggle-group.html.txt examples/gallery/src/visual-fixtures/toolbar.html.txt plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] H1/native toggle static visual-baseline and checkbox form-owner slice:
      `pnpm exec vitest --run packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static gallery routes")`;
      exact `pnpm exec vp check packages/ui/src/checkbox.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Native status/display static visual-baseline slice:
      `pnpm exec vitest --run packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts`;
      `pnpm exec tsc -p examples/gallery/tsconfig.json --noEmit`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static gallery routes")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/avatar.html.txt examples/gallery/src/visual-fixtures/meter.html.txt examples/gallery/src/visual-fixtures/progress.html.txt examples/gallery/src/visual-fixtures/scroll-area.html.txt examples/gallery/src/visual-fixtures/separator.html.txt plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Simple styled static visual-baseline and button form-owner slice:
      `pnpm exec vitest --run packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static gallery routes")`;
      exact `pnpm exec vp check packages/ui/src/button.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/badge.html.txt examples/gallery/src/visual-fixtures/breadcrumb.html.txt examples/gallery/src/visual-fixtures/button.html.txt examples/gallery/src/visual-fixtures/card.html.txt examples/gallery/src/visual-fixtures/kbd.html.txt examples/gallery/src/visual-fixtures/skeleton.html.txt plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Toast disabled non-dismissing action closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/toast.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toast`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "toast fixture|static visual fixture|styled component fixtures"`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/toast.ts packages/headless-ui/src/primitives/toast.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive/toast-demo.tsx examples/gallery/src/generated/interactive/toast-demo.tsx examples/gallery/src/generated/interactive/toast-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/toast.html.txt plans/ui.md`;
      `git diff --check`.
- [x] Toast styled variant and static visual-baseline slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/toast.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toast`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "toast fixture|static visual fixture|styled component fixtures"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static")`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/toast.ts packages/headless-ui/src/primitives/toast.test.ts packages/ui/src/toast.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/toast.html.txt plans/ui.md`;
      `git diff --check`.
- [x] H3 autocomplete/combobox static visual-baseline slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "static visual fixture"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/autocomplete.html.txt examples/gallery/src/visual-fixtures/combobox.html.txt plans/ui.md`;
      `git diff --check`;
      `git diff --cached --check`.
- [x] H3 menu/navigation styled static visual-baseline slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "static visual fixture"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/context-menu.html.txt examples/gallery/src/visual-fixtures/dropdown-menu.html.txt examples/gallery/src/visual-fixtures/menubar.html.txt examples/gallery/src/visual-fixtures/navigation-menu.html.txt plans/ui.md`;
      `git diff --check`.
- [x] Styled static gallery visual-baseline slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "static visual fixture"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/raw-modules.d.ts examples/gallery/src/visual-fixtures/select.html.txt examples/gallery/src/visual-fixtures/table.html.txt examples/gallery/src/visual-fixtures/tabs.html.txt plans/ui.md`;
      `git diff --check`.
- [x] Command styled static visual-baseline slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "static visual fixture"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/command.html.txt plans/ui.md`;
      `git diff --check`.
- [x] H2 native form-control styled static visual-baseline slice:
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts -t "static visual fixture"`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "representative styled static")`;
      exact `pnpm exec vp check examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/visual-fixtures/checkbox-group.html.txt examples/gallery/src/visual-fixtures/number-field.html.txt examples/gallery/src/visual-fixtures/otp-field.html.txt examples/gallery/src/visual-fixtures/radio-group.html.txt examples/gallery/src/visual-fixtures/slider.html.txt plans/ui.md`;
      `git diff --check`.
- [x] Checkbox native mixed-state axe closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/checkbox.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t checkbox`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/checkbox.ts packages/headless-ui/src/primitives/checkbox.test.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/index.ts examples/gallery/src/interactive/checkbox-demo.tsx examples/gallery/src/generated/interactive/checkbox-demo.tsx examples/gallery/src/generated/interactive/checkbox-demo.client.js examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Command native input form-owner closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/command.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t command`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      `git diff --check`.
- [x] Compiled gallery no-exception axe closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/combobox.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t combobox`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/combobox.ts packages/headless-ui/src/primitives/combobox.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive/radio-group-demo.tsx examples/gallery/src/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/radio-group-demo.tsx examples/gallery/src/generated/interactive/radio-group-demo.client.js examples/gallery/src/generated/interactive/toolbar-demo.tsx examples/gallery/src/generated/interactive/toolbar-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Menubar compiled axe structure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/menubar.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t menubar`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check examples/gallery/src/interactive/menubar-demo.tsx examples/gallery/src/generated/interactive/menubar-demo.tsx examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/interactive-gallery.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Switch native external form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/switch.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/switch.ts packages/headless-ui/src/primitives/switch.test.ts packages/ui/src/switch.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive/switch-demo.tsx examples/gallery/src/generated/interactive/switch-demo.tsx examples/gallery/src/generated/interactive/switch-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] OTP aggregate external form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/otp-field.test.ts packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/otp-field.ts packages/headless-ui/src/primitives/otp-field.test.ts packages/ui/src/otp-field.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/otp-field-demo.tsx examples/gallery/src/generated/interactive/otp-field-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Command canceled keyboard default-prevention slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/command.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t command`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t command)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/command.ts packages/headless-ui/src/primitives/command.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/command-demo.tsx examples/gallery/src/generated/interactive/command-demo.tsx examples/gallery/src/generated/interactive/command-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Slider native external form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/slider.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t slider`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t slider)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/slider.ts packages/headless-ui/src/primitives/slider.test.ts packages/ui/src/slider.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive/slider-demo.tsx examples/gallery/src/generated/interactive/slider-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Toast non-dismissing action and compiled cancellation slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/toast.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toast`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t toast)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/toast.ts packages/headless-ui/src/primitives/toast.test.ts packages/ui/src/toast.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/toast-demo.tsx examples/gallery/src/generated/interactive/toast-demo.tsx examples/gallery/src/generated/interactive/toast-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Navigation-menu keyboard restoration and styled state slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/navigation-menu.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t navigation-menu`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "updates generated menubar and navigation-menu roving/open state")`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/navigation-menu.ts packages/headless-ui/src/primitives/navigation-menu.test.ts packages/ui/src/navigation-menu.tsx packages/ui/src/index.test.tsx examples/gallery/src/interactive/navigation-menu-demo.tsx examples/gallery/src/generated/interactive/navigation-menu-demo.tsx examples/gallery/src/generated/interactive/navigation-menu-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Select external form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/select.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t select`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t select)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/select.ts packages/headless-ui/src/primitives/select.test.ts packages/ui/src/select.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/select-demo.tsx examples/gallery/src/generated/interactive/select-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Checkbox-group form ownership and keyboard/focus closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/checkbox-group.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t checkbox-group`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t checkbox-group)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/checkbox-group.ts packages/headless-ui/src/primitives/checkbox-group.test.ts packages/ui/src/checkbox-group.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/interactive/checkbox-group-demo.tsx examples/gallery/src/generated/interactive/checkbox-group-demo.tsx examples/gallery/src/generated/interactive/checkbox-group-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Radio-group disabled/empty keyboard no-trap slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/radio-group.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t radio-group`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t radio-group)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/radio-group.ts packages/headless-ui/src/primitives/radio-group.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Select compiled disabled-option restoration slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/select.test.ts`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t select`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t select)`;
      exact `pnpm exec vp check examples/gallery/src/interactive/select-demo.tsx examples/gallery/src/generated/interactive/select-demo.tsx examples/gallery/src/generated/interactive/select-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Menu-family item-select close restoration slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/menubar.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t "dropdown-menu|context-menu|menubar"`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "opens and selects from generated dropdown and context menu handlers|updates generated menubar and navigation-menu roving/open state")`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/dropdown-menu.ts packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/primitives/context-menu.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/menubar.ts packages/headless-ui/src/primitives/menubar.test.ts plans/ui.md`;
      `git diff --check`.
- [x] Combobox/autocomplete native form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/autocomplete.test.ts packages/headless-ui/src/primitives/combobox.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t "autocomplete|combobox"`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t "combobox|autocomplete")`;
      `pnpm exec tsc -p examples/gallery/tsconfig.json --noEmit`;
      `pnpm exec vp check`;
      `git diff --check`.
- [x] Compiled gallery axe and accessibility contract slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/otp-field.test.ts packages/headless-ui/src/primitives/toast.test.ts packages/ui/src/index.test.tsx -t "context-menu|otp-field|toast"`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `pnpm exec vitest --run examples/gallery/src/merge-fixtures.test.tsx`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/context-menu.ts packages/headless-ui/src/primitives/context-menu.test.ts packages/headless-ui/src/primitives/otp-field.ts packages/headless-ui/src/primitives/otp-field.test.ts packages/ui/src/context-menu.tsx packages/ui/src/toast.tsx packages/ui/src/index.test.tsx examples/gallery/src/interactive/toast-demo.tsx examples/gallery/src/generated/interactive/toast-demo.tsx examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/merge-fixtures.test.tsx plans/ui.md examples/gallery/package.json pnpm-lock.yaml`;
      `git diff --check`.
- [x] Toggle-group keyboard/focus closure slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/toggle-group.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t toggle-group`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t toggle-group)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/toggle-group.ts packages/headless-ui/src/primitives/toggle-group.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/toggle-group-demo.tsx examples/gallery/src/generated/interactive/toggle-group-demo.tsx examples/gallery/src/generated/interactive/toggle-group-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
- [x] Number-field native form/input slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/number-field.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t number-field`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t number-field)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/number-field.ts packages/headless-ui/src/primitives/number-field.test.ts packages/ui/src/number-field.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/number-field-demo.tsx examples/gallery/src/generated/interactive/number-field-demo.tsx examples/gallery/src/generated/interactive/number-field-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
      `git diff --check`.
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
- [x] Tabs activation no-trap/manual roving slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/tabs.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t tabs`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/demo-fixtures.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t tabs)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/tabs.ts packages/headless-ui/src/primitives/tabs.test.ts packages/ui/src/index.test.tsx examples/gallery/src/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.tsx examples/gallery/src/generated/interactive/tabs-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
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
- [x] Radio-group native form ownership slice:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/radio-group.test.ts`;
      `pnpm exec vitest --run packages/ui/src/index.test.tsx -t radio-group`;
      `pnpm --filter @jiso/example-gallery run emit:interactive-gallery`;
      `pnpm exec vitest --run examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive-gallery.test.ts`;
      `(cd examples/gallery && pnpm exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.browser.test.ts -t radio-group)`;
      exact `pnpm exec vp check packages/headless-ui/src/primitives/radio-group.ts packages/headless-ui/src/primitives/radio-group.test.ts packages/ui/src/radio-group.tsx packages/ui/src/index.test.tsx examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts examples/gallery/src/interactive/radio-group-demo.tsx examples/gallery/src/generated/interactive/radio-group-demo.tsx examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts plans/ui.md plans/codebase-quality-round2.md`;
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
