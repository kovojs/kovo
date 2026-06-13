# UI libraries - `@jiso/headless-ui`, vendored `@jiso/ui`, and gallery

Status: active. Last compacted on 2026-06-12.

Scope: `packages/headless-ui`, `packages/ui`, `examples/gallery`, and the framework seams needed
for package prefixes, behavior attributes, primitive authoring lint, vendoring, and gallery
conformance. Keep this ledger compact: status, open work, and current gates only.

## Progress Checklist

- [x] F1 SPEC text: package prefix registration, `jiso-*` reservation, alias escape, behavior
      namespace implications, FW234.
- [x] F2 compiler/CLI prefix enforcement: package manifest prefix facts, aliasing, `fw explain`
      component provenance, Vite/CLI discovery.
- [x] F3 behavior-attribute namespace: `fw-*` reserved; package behaviors use package prefixes
      and participate in FW221 IDREF validation.
- [x] F4 primitive-author lint: primitive handlers no-op on `event.defaultPrevented`.
- [x] F5 platform audit: native platform decisions, CSS anchor/starting-style/discrete-transition
      coverage, lazy floating fallback boundary.
- [x] H0 shared lib: state/data attrs, cancelable change details, keyboard maps, typeahead,
      positioning fallback.
- [x] H1 wave 1 primitives: dialog, alert-dialog, popover, tooltip, hover-card, collapsible,
      accordion, separator, progress, meter, avatar, toggle, switch, checkbox.
- [ ] H2 wave 2 primitives: tabs, radio-group, toggle-group, checkbox-group, toolbar,
      number-field, otp-field, scroll-area, field/fieldset integration.
- [ ] H3 wave 3 primitives: select, combobox, autocomplete, dropdown-menu, context-menu, menubar,
      navigation-menu, slider, toast, command.
- [x] U1 styled foundation: token sheet, `cn()`, statically analyzable variant helper.
- [x] U2 `fw add <component>` vendoring pipeline.
- [ ] U3 styled H1 and pure-markup components.
- [x] U4 styled H2 components.
- [x] U5 styled H3 components.
- [ ] G1 gallery static fixture surface: one route per component with source/markup snapshot.
- [ ] G2 behavior-contract gates: keyboard/ARIA/native state checks and `fw explain` coverage.
- [ ] G3 axe checks per component state.
- [ ] G4 visual regression baseline for `@jiso/ui`.
- [x] G5 merge fixtures for primitive attrs plus author elements.
- [ ] G6 compiled interactive gallery authored as app TSX and exercised in browser.

## Current Evidence Rollup

Implemented areas:

- Headless UI exports shared H0 helpers and H1/H2/H3 primitive helpers through package subpaths.
- `@jiso/ui` ships vendorable styled source for pure-markup components plus checkbox,
  checkbox-group, switch, tabs, toggle, radio-group, toggle-group, toolbar, select, combobox,
  autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast, and command
  wrappers over the headless primitive attrs.
- `fw add` vendors package-synchronized TSX source and rejects unknown names with the generated
  catalog list.
- Gallery routes and tests cover a growing fixture matrix, static behavior contracts, merge
  fixtures, compiled interactive demos, and generated-client DOM ref/export contracts.
- The compiled interactive gallery now includes progress and meter value-display demos with
  generated handlers covering native value, `data-state`, `aria-valuetext`, and output updates.
- The compiled interactive gallery now has static docs deployment wiring:
  `examples/gallery/src/app-shell.ts` serves `/interactive`, registers the checked-in generated
  client modules under their versioned `/c/` refs, and `examples/gallery/vite.config.ts` exposes a
  `vp run export` task that writes the route plus all generated client modules to `dist/` while
  tracking generated `.js` client modules as task inputs.
- The compiled interactive gallery now includes a scroll-area demo with browser-backed generated
  handler coverage for `scrollTop`, viewport labelling/focusability, scrollbar/thumb data attrs,
  static docs wiring, and generated-client DOM sync.
- G5 exported primitive attrs inventory is closed: `examples/gallery/src/merge-fixtures.test.tsx`
  renders inline merge goldens for all 134 exported primitive `*Attributes` builders, with author
  stress attrs, merged HTML, and SPEC §4.6 diagnostic checks.

Recent gates:

- `pnpm --filter @jiso/headless-ui run lint:primitives`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts src/merge-fixtures.test.tsx`
- `pnpm --filter @jiso/example-gallery test`
- `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized"`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts src/merge-fixtures.test.tsx`
- `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`
- `pnpm exec vp check packages/ui/src/toggle-group.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts`
- `pnpm exec vp check packages/ui/src/radio-group.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts plans/ui.md`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`
- `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`
- `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`
- `pnpm --filter @jiso/example-gallery run test:browser`
- `pnpm exec vp check packages/ui/src/command.tsx packages/ui/src/context-menu.tsx packages/ui/src/dropdown-menu.tsx packages/ui/src/menubar.tsx packages/ui/src/navigation-menu.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts plans/ui.md IMPLEMENT_v1.md`
- `git diff --check`
- `pnpm exec vp check packages/ui/src/autocomplete.tsx packages/ui/src/combobox.tsx packages/ui/src/select.tsx packages/ui/src/slider.tsx packages/ui/src/toast.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`
- `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`
- `pnpm exec vp check packages/ui/src/field.tsx packages/ui/src/number-field.tsx packages/ui/src/otp-field.tsx packages/ui/src/scroll-area.tsx packages/ui/src/index.tsx packages/ui/src/index.test.tsx packages/ui/package.json examples/gallery/src/demo-fixtures.tsx examples/gallery/src/demo-fixtures.test.ts examples/gallery/src/behavior-contracts.test.ts packages/cli/src/index.test.ts`
- `git diff --check`
- `git diff --check`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/demo-fixtures.test.ts src/behavior-contracts.test.ts`
- `pnpm --filter fw exec vitest --run src/index.test.ts -t "vendored UI catalog|refuses unknown components|vendors package-synchronized|compiles vendored catalog"`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery test`
- `pnpm --filter @jiso/example-gallery run test:browser`
- `pnpm exec vp check examples/gallery/src/interactive-gallery.test.ts plans/ui.md IMPLEMENT_v1.md`
- `git diff --check`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/merge-fixtures.test.tsx`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery test`
- `pnpm --filter @jiso/example-gallery run test:browser`
- `pnpm --filter @jiso/example-gallery exec vitest --run src/interactive-gallery.test.ts`
- `pnpm exec vp check examples/gallery/scripts/export-static.mjs examples/gallery/src/app-shell.ts examples/gallery/src/index.ts examples/gallery/src/interactive-gallery.test.ts examples/gallery/vite.config.ts plans/ui.md IMPLEMENT_v1.md`
- `pnpm --filter @jiso/ui exec vitest --run`
- `pnpm --filter @jiso/example-gallery test`
- `pnpm --filter @jiso/example-gallery run test:browser`
- `pnpm exec vp check examples/gallery/package.json examples/gallery/scripts/emit-interactive-gallery.mjs examples/gallery/src/interactive-docs.tsx examples/gallery/src/interactive/scroll-area-demo.tsx examples/gallery/src/generated/interactive/scroll-area-demo.tsx examples/gallery/src/generated/interactive/scroll-area-demo.client.js examples/gallery/src/interactive-gallery.test.ts examples/gallery/src/interactive-gallery.browser.test.ts examples/gallery/vite.config.ts plans/ui.md IMPLEMENT_v1.md`

## Open Work

H2:

- Confirm which H2 primitives still need implementation versus only styled/gallery/conformance
  closure, then update the checklist only from code evidence.
- Toggle-group now has a styled vendorable wrapper, gallery route, behavior-contract snippets,
  catalog sync, and merge coverage via existing roving-groups fixture; broader H2 remains open for
  other H2 families.
- Checkbox-group, number-field, otp-field, scroll-area, and field/fieldset now have styled
  vendorable wrappers, static gallery routes, behavior-contract snippets, and catalog sync;
  broader H2 remains open until all primitive and conformance evidence is rechecked together.
- Toolbar now has a styled vendorable wrapper, static gallery route, behavior-contract snippets,
  and catalog sync; broader H2 remains open for other H2 families.
- Keep field/fieldset tied to `form()` integration rather than a standalone styled-only surface.

H3:

- Confirm wave-3 primitive implementation completeness against package exports and tests.
- Select, combobox, autocomplete, slider, and toast now have styled vendorable wrappers, static
  gallery routes, behavior-contract snippets, and catalog sync.
- Dropdown-menu, context-menu, menubar, navigation-menu, and command now have styled vendorable
  wrappers, static gallery routes, behavior-contract snippets, catalog sync, and browser-backed
  gallery regression coverage through the existing compiled interactive H3 demos; broader H3
  remains open for full primitive/conformance closure.
- Close any remaining state/focus/typeahead/menu edge cases with focused tests before checking H3.

Styled UI:

- Finish styled wrappers for remaining H1/pure-markup gaps, then H3 wrappers.
- Keep vendored source app-authored TSX: no `@jiso/ui` self-imports, no hand-authored lowered IR,
  no `fw-c=` or `data-bind=` in vendored component source.
- Keep CLI add-catalog tests synchronized with `packages/ui/package.json` exports.

Gallery:

- Expand route coverage until every primitive/styled component has a gallery fixture.
- Add G2 `fw explain` coverage for representative primitives.
- Add G3/G4 once the gallery surface is stable enough to avoid churn-heavy baselines.
- G5 is closed for the exported primitive attrs inventory and rendered merge goldens; keep future
  merge work scoped to new primitive exports or compiler/runtime diagnostic parity.
- Progress and meter now have compiled interactive gallery coverage; continue extending remaining
  non-commanding display/native families only where browser-observable state can move.
- Scroll-area now has compiled interactive gallery and Chromium coverage for browser-observable
  viewport scroll movement plus generated-client DOM sync.
- G6 docs deployment wiring now exports the compiled `/interactive` route and generated client
  module set; continue full browser-backed stateful-family coverage. Generated client DOM
  ref/export inventory is covered for every checked-in compiled interactive demo.

## Rules

- Evidence updates belong near the relevant checklist item only when they change current status.
- Do not paste repeated command transcripts; list the latest proving commands.
- Do not check broad H/G/U items from a narrow primitive slice.
