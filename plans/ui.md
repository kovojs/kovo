# UI libraries — `@jiso/headless-ui` + vendored `@jiso/ui` + gallery (D7)

Status: design agreed 2026-06-11; F1 SPEC text landed; F2 compiler/Vite/CLI prefix discovery landed
Scope: a behavior-layer package (`packages/headless-ui`, published `@jiso/headless-ui`), a vendored styled layer (`@jiso/ui`, distributed as source via `fw add`), a gallery app in this workspace (`examples/gallery`) that is also the conformance/a11y/visual test surface, and the small framework seams they require (package prefix registration, behavior-attribute namespace, primitive-author lint). Referenced from `IMPLEMENT_v1.md` as workstream **D7**.

## Progress checklist

- [x] F1 SPEC text: package prefix registration (manifest field, app-wide uniqueness, alias escape, `jiso-` reserved for `@jiso/*`), behavior-attribute namespace implications, FW234 teaching error. Evidence: SPEC §6.1.1 defines the manifest field, effective-prefix uniqueness, alias escape, `jiso-*` reservation, `fw-c`/CSS/behavior-attribute implications, and FW234 example; SPEC §4.6 now uses `jiso-tooltip`; SPEC §11.3 lists FW234.
- [x] F2 compiler: prefix enforcement + FW234; `fw explain component <prefixed>` prints the owning package. Evidence so far: compiler accepts explicit package prefix facts and emits FW234 for duplicate effective prefixes, malformed/missing prefixes, and non-`@jiso/*` `jiso-*` misuse; explicit effective-prefix aliases are covered as the collision escape hatch.
      Additional evidence 2026-06-11: explicit `packageComponentPrefixes` facts now flow through
      the core explain graph schema and compiler `deriveAppGraph`; `fw explain component
jiso-dialog` resolves dashed wire names and prints provenance including package, declared
      prefix, effective prefix, and source. Covered by `packages/core/src/graph.test.ts`,
      `packages/compiler/src/index.test.ts`, and `packages/cli/src/index.test.ts`. Same-session
      evidence: `pnpm exec vitest --run packages/core/src/graph.test.ts packages/compiler/src/index.test.ts packages/cli/src/index.test.ts`
      and `pnpm run check`.
      Additional evidence 2026-06-11: `@jiso/core` now exports
      `packageComponentPrefixFactFromPackageManifest()`, which derives package-prefix facts from
      real `package.json` metadata including the new `packages/headless-ui/package.json`
      `jiso.prefix: "jiso-"` manifest field and optional app-side effective-prefix aliases.
      Same-session evidence:
      `pnpm exec vitest --run packages/core/src/package-prefix.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts`
      and
      `pnpm exec vp check packages/core/src/package-prefix.ts packages/core/src/package-prefix.test.ts packages/core/src/index.ts packages/headless-ui/src/index.ts packages/headless-ui/src/tooling/index.ts packages/headless-ui/src/tooling/primitive-handler-lint.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts packages/headless-ui/package.json pnpm-lock.yaml`.
      Additional evidence 2026-06-12: `packages/compiler/src/package-prefixes.ts` discovers
      package prefix facts from static imported package manifests, merges explicit aliases, and
      feeds the combined facts through `compileComponentModule`; `packages/compiler/src/vite.ts`
      supplies the Vite app root for package manifest lookup; `packages/cli/src/index.ts` exposes
      `packagePrefixDiscoveryRoot` on the compile/v1 surface. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/package-prefixes.test.ts packages/compiler/src/vite.test.ts packages/cli/src/index.test.ts`,
      `pnpm exec vp check packages/compiler/src/package-prefixes.ts packages/compiler/src/package-prefixes.test.ts packages/compiler/src/index.ts packages/compiler/src/types.ts packages/compiler/src/vite.ts packages/compiler/src/vite.test.ts packages/cli/src/index.ts packages/cli/src/index.test.ts`,
      and `git diff --check`.
- [x] F3 behavior-attribute namespace: `fw-*` stays framework-reserved; package behaviors ride the package prefix (`jiso-tooltip="id"`), wired through FW221 IDREF validation. Evidence: `packages/compiler/src/validate/package-prefixes.ts` rejects package `fw-*` prefixes with FW234 per SPEC §6.1.1, `packages/compiler/src/validate/markup.ts` feeds package-declared IDREF behavior attributes through FW221, and `packages/compiler/src/index.test.ts` covers valid/missing package-prefixed behavior IDREFs plus `fw-*` reservation.
- [x] F4 primitive-author lint: chained handlers contractually no-op on `event.defaultPrevented` (lives in `@jiso/headless-ui` tooling, not the loader).
      Partial evidence 2026-06-11: `packages/headless-ui/src/tooling/primitive-handler-lint.ts`
      provides a dependency-light tooling API that scans marked primitive handlers and reports
      `JISO_HUI001` when they do not begin by no-oping on the first event parameter's
      `defaultPrevented` state, with diagnostic text citing `SPEC.md` section 4.6. Focused tests
      cover function and arrow handlers, accepted guards, missing guards, and wrong-event guards.
      Same-session evidence:
      `pnpm exec vitest --run packages/core/src/package-prefix.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts`
      and
      `pnpm exec vp check packages/core/src/package-prefix.ts packages/core/src/package-prefix.test.ts packages/core/src/index.ts packages/headless-ui/src/index.ts packages/headless-ui/src/tooling/index.ts packages/headless-ui/src/tooling/primitive-handler-lint.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts packages/headless-ui/package.json pnpm-lock.yaml`.
      Additional evidence 2026-06-11: `packages/headless-ui` now exposes a `lint:primitives`
      package script over `src/tooling/lint-primitives.ts`, recursively scans real
      `src/**/*.ts(x)` sources, and fails on marked primitive handlers that do not begin with
      the `event.defaultPrevented` no-op. `src/primitives/disclosure.ts` is the first real
      primitive source fixture, and `src/tooling/lint-primitives.test.ts` covers pass/fail CLI
      behavior plus the real package source scan. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/tooling/primitive-handler-lint.test.ts src/tooling/lint-primitives.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`, and
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/primitives/disclosure.ts packages/headless-ui/src/tooling/index.ts packages/headless-ui/src/tooling/lint-primitives.ts packages/headless-ui/src/tooling/lint-primitives.test.ts`.
- [x] F5 platform audit: CSS anchor positioning + `@starting-style`/`transition-behavior: allow-discrete` coverage check; lazy-loaded floating fallback module decided.
      Evidence 2026-06-11: `packages/headless-ui/src/platform-audit.ts` exports an executable
      H1 primitive audit matrix covering native dialog/popover/details/form-control/semantic
      substitutions, `@starting-style` + `transition-behavior: allow-discrete` as progressive
      exit-animation enhancement, and a lazy `floating-positioning` fallback loaded on first
      trigger interaction only for hover-card/popover/tooltip. `platform-audit.test.ts` proves
      H1 coverage, native mechanism decisions, and fallback boundaries. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/platform-audit.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts packages/headless-ui/src/tooling/lint-primitives.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`, and
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/platform-audit.ts packages/headless-ui/src/platform-audit.test.ts`.
- [x] H0 shared lib: state-attributes, keyboard/menu navigation maps, typeahead, change-details (reason + `defaultPrevented` contract), positioning fallback.
      Partial evidence 2026-06-12: `packages/headless-ui/src/lib/` now exposes
      executable pure helpers for state/data attributes, cancelable change details,
      APG-style collection keyboard movement, and typeahead matching through the
      package root and `@jiso/headless-ui/lib`. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/lib/state-attributes.test.ts packages/headless-ui/src/lib/change-details.test.ts packages/headless-ui/src/lib/keyboard-navigation.test.ts packages/headless-ui/src/lib/typeahead.test.ts packages/headless-ui/src/platform-audit.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts packages/headless-ui/src/tooling/lint-primitives.test.ts`
      and `pnpm --filter @jiso/headless-ui run lint:primitives`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/lib/positioning-fallback.ts`
      adds a DOM-free bounded floating-position helper for popover/menu-style primitives,
      covering placement, offsets, viewport collision scoring, automatic opposite-side flip,
      explicit fallback ordering, shift into padded bounds, RTL start/end alignment, and residual
      overflow reporting. It is exported through `@jiso/headless-ui` and
      `@jiso/headless-ui/lib`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/lib/positioning-fallback.test.ts src/lib/state-attributes.test.ts src/lib/change-details.test.ts src/lib/keyboard-navigation.test.ts src/lib/typeahead.test.ts src/platform-audit.test.ts src/tooling/primitive-handler-lint.test.ts src/tooling/lint-primitives.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`, and
      `pnpm exec vp check packages/headless-ui/src/lib/positioning-fallback.ts packages/headless-ui/src/lib/positioning-fallback.test.ts packages/headless-ui/src/lib/index.ts packages/headless-ui/src/index.ts plans/ui.md`.
      Additional evidence 2026-06-12: `src/primitives/disclosure.ts` is now a small L0
      disclosure primitive integrated with the shared H0 helpers: `openState`,
      `dataDisabled`, `mergeDataAttributes`, and cancelable change details. It exports
      root/trigger/content attribute builders plus programmatic and trigger-click state
      transitions through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/disclosure`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/disclosure.test.ts src/lib/state-attributes.test.ts src/lib/change-details.test.ts src/lib/keyboard-navigation.test.ts src/lib/typeahead.test.ts src/lib/positioning-fallback.test.ts src/tooling/primitive-handler-lint.test.ts src/tooling/lint-primitives.test.ts src/platform-audit.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`, and
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/disclosure.ts packages/headless-ui/src/primitives/disclosure.test.ts plans/ui.md`.
      This completes the H0 shared-lib prerequisite; H1 remains open for the remaining
      wave 1 primitive set.
- [x] H1 wave 1 primitives (L0-heavy): dialog, alert-dialog, popover, tooltip, hover-card, collapsible, accordion, separator, progress, meter, avatar, toggle, switch, checkbox.
      Partial evidence 2026-06-12: disclosure is the first H1 L0 primitive with DOM-light
      attribute builders, cancelable open-state transitions, the SPEC §4.6 primitive handler
      no-op guard, package exports, and focused tests. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/disclosure.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`, and
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/disclosure.ts packages/headless-ui/src/primitives/disclosure.test.ts plans/ui.md`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/collapsible.ts`
      adds the H1 collapsible primitive as a native `<details>/<summary>`-oriented L0 helper:
      root/trigger/content attribute builders, cancelable open-state transitions, the SPEC §4.6
      primitive handler no-op guard, and prevention of native summary toggling when disabled or
      canceled. It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/collapsible`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/collapsible.test.ts src/primitives/disclosure.test.ts src/lib/state-attributes.test.ts src/lib/change-details.test.ts src/tooling/primitive-handler-lint.test.ts src/tooling/lint-primitives.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/collapsible.ts packages/headless-ui/src/primitives/collapsible.test.ts packages/headless-ui/src/tooling/lint-primitives.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/separator.ts`
      adds the H1 separator primitive as a semantic-only L0 helper: decorative separators default
      to `role="none"` with `data-orientation`, and non-decorative separators emit explicit
      `role="separator"` plus `aria-orientation`. It is exported through `@jiso/headless-ui`,
      `@jiso/headless-ui/primitives`, and `@jiso/headless-ui/primitives/separator`.
      Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/separator.test.ts src/primitives/collapsible.test.ts src/primitives/disclosure.test.ts src/lib/state-attributes.test.ts src/tooling/lint-primitives.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/separator.ts packages/headless-ui/src/primitives/separator.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/progress.ts`
      adds the H1 progress primitive as a native `<progress>`-oriented L0 helper:
      normalized determinate/indeterminate value state, clamped range behavior, `data-state`,
      `data-value`, `data-max`, optional `aria-valuetext`, package exports, and focused
      behavior/attribute tests. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/progress.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/progress.ts packages/headless-ui/src/primitives/progress.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/meter.ts`
      adds the H1 meter primitive as a native `<meter>`-oriented L0 helper: normalized
      min/max/value/low/high/optimum state, clamped range behavior, `data-state`, threshold
      data attributes, optional `aria-valuetext`, package exports, and focused
      behavior/attribute tests. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/meter.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/meter.ts packages/headless-ui/src/primitives/meter.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/toggle.ts`
      adds the H1 toggle primitive as a native `<button>`-oriented L0 helper: pressed/off
      attributes, `aria-pressed`, disabled handling, cancelable pressed-state transitions, the
      SPEC §4.6 primitive handler no-op guard, package exports, and focused behavior/attribute
      tests. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/toggle.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/toggle.ts packages/headless-ui/src/primitives/toggle.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/checkbox.ts`
      adds the H1 checkbox primitive as a native `<input type="checkbox">`-oriented L0 helper:
      checked/unchecked/indeterminate attributes, real `checked`/`disabled`/`name`/`value`
      form-control attributes, cancelable checked-state transitions, the SPEC §4.6 primitive
      handler no-op guard, package exports, and focused behavior/attribute tests. Same-session
      evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/checkbox.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/checkbox.ts packages/headless-ui/src/primitives/checkbox.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/switch.ts`
      adds the H1 switch primitive as a native `<input type="checkbox" role="switch">` L0
      helper: checked/unchecked attributes, real `checked`/`disabled`/`name`/`value`
      form-control attributes, cancelable checked-state transitions, the SPEC §4.6 primitive
      handler no-op guard, package exports, and focused behavior/attribute tests. Same-session
      evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/switch.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/switch.ts packages/headless-ui/src/primitives/switch.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/avatar.ts`
      adds the H1 avatar primitive as a semantic-only L0 helper: root/image/fallback attribute
      builders, normalized loading/loaded/error image state, native `<img>` attributes,
      fallback visibility data, package exports, and focused behavior/attribute tests. Same-session
      evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/avatar.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/avatar.ts packages/headless-ui/src/primitives/avatar.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/accordion.ts`
      adds the H1 accordion primitive as a DOM-light root/item/header/trigger/content helper:
      single and multiple value state, native-friendly open/hidden attributes, ARIA
      trigger/content wiring, cancelable value transitions, the SPEC §4.6 primitive handler
      no-op guard, and prevention of native summary toggling when disabled or canceled.
      It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/accordion`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/accordion.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/accordion.ts packages/headless-ui/src/primitives/accordion.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/tooltip.ts`
      adds the H1 tooltip primitive as a native-popover-oriented L0 helper: root/trigger/content
      attribute builders, `jiso-tooltip` behavior IDREF attributes per SPEC §4.6, tooltip
      `aria-describedby` wiring, manual popover content attributes, cancelable open-state
      transitions, and guarded focus/pointer/Escape handlers following the SPEC §4.6 primitive
      handler no-op contract. It is exported through `@jiso/headless-ui`,
      `@jiso/headless-ui/primitives`, and `@jiso/headless-ui/primitives/tooltip`.
      Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/tooltip.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/tooltip.ts packages/headless-ui/src/primitives/tooltip.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/popover.ts`
      adds the H1 popover primitive as a native popover L0 helper: root/trigger/content
      attribute builders, trigger `popovertarget` wiring, auto popover content attributes,
      cancelable open-state transitions, and guarded trigger/beforetoggle/Escape handlers
      following the SPEC §4.6 primitive handler no-op contract. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/popover`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/popover.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/popover.ts packages/headless-ui/src/primitives/popover.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/hover-card.ts`
      adds the H1 hover-card primitive as a native manual-popover L0 helper: root/trigger/content
      attribute builders, `jiso-hover-card` behavior IDREF attributes per SPEC §4.6,
      trigger `aria-controls` wiring, cancelable open-state transitions, and guarded
      pointer/focus/Escape handlers following the SPEC §4.6 primitive handler no-op contract.
      It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/hover-card`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/hover-card.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/hover-card.ts packages/headless-ui/src/primitives/hover-card.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/dialog.ts`
      adds the H1 dialog primitive as a native `<dialog>`/invoker-command L0 helper:
      root/trigger/content/close attribute builders, trigger `commandfor` + `command="show-modal"`
      wiring, close `command="request-close"` wiring, cancelable open-state transitions, and
      guarded trigger/close/cancel/beforetoggle handlers following the SPEC §4.6 primitive
      handler no-op contract. It is exported through `@jiso/headless-ui`,
      `@jiso/headless-ui/primitives`, and `@jiso/headless-ui/primitives/dialog`.
      Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/dialog.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/dialog.ts packages/headless-ui/src/primitives/dialog.test.ts plans/ui.md`,
      and `git diff --check`.
      Additional evidence 2026-06-12: `packages/headless-ui/src/primitives/alert-dialog.ts`
      completes the remaining H1 primitive as a native `<dialog>`/invoker-command L0 helper:
      root/trigger/content/cancel/action attribute builders, `role="alertdialog"` plus
      `aria-modal` and IDREF label/description helpers, cancel/action intent attributes for
      destructive confirmation surfaces, cancelable open-state transitions, and guarded
      trigger/cancel/action/cancel-event/beforetoggle handlers following the SPEC §4.6
      primitive handler no-op contract. It is exported through `@jiso/headless-ui`,
      `@jiso/headless-ui/primitives`, and `@jiso/headless-ui/primitives/alert-dialog`.
      Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/alert-dialog.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/alert-dialog.ts packages/headless-ui/src/primitives/alert-dialog.test.ts plans/ui.md`,
      and `git diff --check`. Caveat: this completes the DOM-light H1 helper slice; styled
      `@jiso/ui` wrappers and gallery conformance remain tracked by U3+ and the gallery gates.
- [ ] H2 wave 2 primitives (stateful L1 islands): tabs, radio-group, toggle-group, checkbox-group, toolbar, number-field, otp-field, scroll-area, field/fieldset as `form()` integration.
      Partial evidence 2026-06-12: `packages/headless-ui/src/primitives/field.ts`
      adds the H2 field/fieldset form-integration primitive as DOM-light label/help/error
      wiring around native typed `form()` controls per SPEC §6.3: field root/label/control,
      description/error, fieldset root, and legend attribute builders preserve real `name`,
      `required`, and `disabled` control attributes while deriving `aria-describedby`,
      `aria-invalid`, `data-invalid`, and `data-required`. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/field`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/field.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/field.ts packages/headless-ui/src/primitives/field.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for the other wave 2 primitives and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/radio-group.ts`
      adds the H2 radio-group primitive as a native `<input type="radio">`-oriented L1 helper:
      radiogroup root/item/radio/label attribute builders, roving tabindex over a group item
      collection via shared keyboard maps, disabled-item skipping, cancelable value transitions,
      and guarded click/keyboard handlers following the SPEC §4.6 primitive handler no-op
      contract. It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`,
      and `@jiso/headless-ui/primitives/radio-group`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/radio-group.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/radio-group.ts packages/headless-ui/src/primitives/radio-group.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for the other wave 2 primitives and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/toggle-group.ts`
      adds the H2 toggle-group primitive as a native `<button>`-oriented L1 helper:
      group/item/button attribute builders, single and multiple pressed value transitions,
      optional single-item collapse, roving focus over enabled items via shared keyboard maps,
      and guarded click/keyboard handlers following the SPEC §4.6 primitive handler no-op
      contract. It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`,
      and `@jiso/headless-ui/primitives/toggle-group`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/toggle-group.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/toggle-group.ts packages/headless-ui/src/primitives/toggle-group.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for the other wave 2 primitives and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/toolbar.ts`
      adds the H2 toolbar primitive as a native-control-preserving L1 helper: toolbar
      root/item/button attribute builders, horizontal/vertical orientation attributes,
      roving tabindex over enabled toolbar items via shared keyboard maps, optional pressed
      button state, disabled-item skipping, and a guarded keyboard handler following the
      SPEC §4.6 primitive handler no-op contract. It is exported through `@jiso/headless-ui`,
      `@jiso/headless-ui/primitives`, and `@jiso/headless-ui/primitives/toolbar`.
      Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/toolbar.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/toolbar.ts packages/headless-ui/src/primitives/toolbar.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for tabs, checkbox-group, number-field,
      otp-field, scroll-area, and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/checkbox-group.ts`
      adds the H2 checkbox-group primitive as a native `<input type="checkbox">`-oriented
      L1 helper: group/item/control/label attribute builders, shared-name native checkbox
      controls, checked-value array transitions, roving focus over enabled items via shared
      keyboard maps, disabled-item skipping, and guarded click/keyboard handlers following the
      SPEC §4.6 primitive handler no-op contract. It is exported through `@jiso/headless-ui`,
      `@jiso/headless-ui/primitives`, and `@jiso/headless-ui/primitives/checkbox-group`.
      Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/checkbox-group.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/checkbox-group.ts packages/headless-ui/src/primitives/checkbox-group.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for tabs, number-field, otp-field, scroll-area,
      and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/tabs.ts`
      adds the H2 tabs primitive as a native `<button>`-oriented L1 helper: root/list/trigger/panel
      attribute builders, tablist/tab/tabpanel ARIA wiring, active/inactive data-state tokens,
      automatic and manual activation modes, roving focus over enabled tabs via shared keyboard
      maps, disabled-item skipping, cancelable value transitions, and guarded click/keyboard
      handlers following the SPEC §4.6 primitive handler no-op contract. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/tabs`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/tabs.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/lib/state-attributes.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/tabs.ts packages/headless-ui/src/primitives/tabs.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for number-field, otp-field, scroll-area,
      and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/number-field.ts`
      adds the H2 number-field primitive as a native `<input type="number">`-oriented L1
      helper: root/input/increment/decrement attribute builders, real `name`/`required`/`min`/
      `max`/`step` form-control attributes per SPEC §6.3, cancelable value transitions,
      bounded stepper behavior, input-string parsing, and guarded input/click handlers following
      the SPEC §4.6 primitive handler no-op contract. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/number-field`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/number-field.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/number-field.ts packages/headless-ui/src/primitives/number-field.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for otp-field, scroll-area, and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/otp-field.ts`
      adds the H2 otp-field primitive as a native-input-slot L1 helper: group root,
      aggregate named input, visible slot input attribute builders, one-time-code autocomplete
      wiring, normalized/paste-filled aggregate value transitions, focus movement helpers,
      cancelable value changes, and guarded input/keydown/paste handlers following the
      SPEC §4.6 primitive handler no-op contract. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/otp-field`. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/otp-field.test.ts packages/headless-ui/src/tooling/lint-primitives.test.ts packages/headless-ui/src/tooling/primitive-handler-lint.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/otp-field.ts packages/headless-ui/src/primitives/otp-field.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for scroll-area and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/scroll-area.ts`
      adds the H2 scroll-area primitive as a native-scroll-viewport L1 helper: root/viewport/
      scrollbar/thumb/corner attribute builders, scrollbars mode attributes, visible/hidden
      data-state tokens, vertical/horizontal data-orientation tokens, disabled-state propagation,
      and decorative custom-scrollbar parts that leave scrolling semantics on the native viewport.
      It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/scroll-area`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/scroll-area.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/lib/state-attributes.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/scroll-area.ts packages/headless-ui/src/primitives/scroll-area.test.ts plans/ui.md`,
      and `git diff --check`. H2 remains open for full gates.
- [ ] H3 wave 3 primitives (list-driven & isomorphic): select, combobox, autocomplete, dropdown-menu, context-menu, menubar, navigation-menu, slider, toast, command.
      Partial evidence 2026-06-12: `packages/headless-ui/src/primitives/select.ts`
      adds the H3 select primitive as a native `<select>/<option>`-oriented helper:
      root/trigger/content/item/value attribute builders, real `name`/`required`/`disabled`
      select control attributes per SPEC §6.3, selected/placeholder/open/closed data attrs,
      disabled-item protection, cancelable value transitions, selected value text resolution,
      and a guarded change handler following the SPEC §4.6 primitive handler no-op contract.
      It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/select`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/select.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/select.ts packages/headless-ui/src/primitives/select.test.ts plans/ui.md`,
      and `git diff --check`. H3 remains open for combobox, autocomplete, dropdown-menu,
      context-menu, menubar, navigation-menu, slider, toast, command, and full gates.
      Additional partial evidence 2026-06-12: `packages/headless-ui/src/primitives/combobox.ts`
      adds the H3 combobox primitive as a native `<input type="text">`-oriented list helper:
      root/input/listbox/option/value attribute builders, real `name`/`required`/`disabled`
      input attributes per SPEC §6.3, listbox and active-option ARIA wiring, selected/
      highlighted/placeholder/open/closed data attrs, disabled-option protection, cancelable
      value and open-state transitions, shared typeahead matching, and guarded input/option/
      keyboard handlers following the SPEC §4.6 primitive handler no-op contract. It is
      exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/combobox`. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/select.test.ts packages/headless-ui/src/lib/typeahead.test.ts packages/headless-ui/src/lib/change-details.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/combobox.ts packages/headless-ui/src/primitives/combobox.test.ts plans/ui.md`,
      and `git diff --check`. H3 remains open for autocomplete, dropdown-menu, context-menu,
      menubar, navigation-menu, slider, toast, command, and full gates.
      Additional partial evidence 2026-06-12:
      `packages/headless-ui/src/primitives/autocomplete.ts` adds the H3 autocomplete
      primitive as a native `<input type="text">` + `<datalist>`-oriented helper:
      root/input/list/option/value attribute builders, real `name`/`required`/`disabled`
      input attributes per SPEC §6.3, datalist and active-option ARIA wiring, selected/
      highlighted/placeholder/open/closed data attrs, disabled-option protection, cancelable
      input/value/open-state transitions, shared typeahead matching, suggestion filtering, and
      guarded input/option/keyboard handlers following the SPEC §4.6 primitive handler no-op
      contract. It is exported through `@jiso/headless-ui`, `@jiso/headless-ui/primitives`,
      and `@jiso/headless-ui/primitives/autocomplete`. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/autocomplete.test.ts packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/lib/typeahead.test.ts packages/headless-ui/src/lib/change-details.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/src/primitives/autocomplete.ts packages/headless-ui/src/primitives/autocomplete.test.ts`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts`,
      and `git diff --check`. H3 remains open for dropdown-menu, context-menu, menubar,
      navigation-menu, slider, toast, command, and full gates. Caveat: grouped changed-file
      `vp check` formatted all six files but the Vite+/typescript-go linter crashed before
      completing lint analysis; the source and export checks above passed when split.
      Additional partial evidence 2026-06-12:
      `packages/headless-ui/src/primitives/dropdown-menu.ts` adds the H3 dropdown-menu
      primitive as a DOM-free menu helper: root/trigger/content/item/group/separator
      attribute builders, menu/menuitem/group/separator ARIA wiring, open/closed,
      highlighted, active/inactive, and disabled data attrs, disabled-item protection,
      cancelable open and select transitions, shared vertical menu keyboard movement,
      shared typeahead matching, and guarded trigger/item/keyboard handlers following the
      SPEC §4.6 primitive handler no-op contract. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/dropdown-menu`. Same-session evidence:
      `pnpm exec vitest --run packages/headless-ui/src/primitives/dropdown-menu.test.ts packages/headless-ui/src/lib/typeahead.test.ts packages/headless-ui/src/lib/change-details.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/dropdown-menu.ts packages/headless-ui/src/primitives/dropdown-menu.test.ts plans/ui.md`,
      and `git diff --check`. H3 remains open for context-menu, menubar, navigation-menu,
      slider, toast, command, and full gates.
      Additional partial evidence 2026-06-12:
      `packages/headless-ui/src/primitives/context-menu.ts` adds the H3 context-menu
      primitive as a trigger-area menu helper: root/trigger/content/item/group/separator
      attribute builders, `jiso-context-menu` behavior IDREF attributes per SPEC §4.6,
      contextmenu point extraction via `data-anchor-x`/`data-anchor-y`, open/closed,
      highlighted, active/inactive, and disabled data attrs, disabled-item protection,
      cancelable open and select transitions, shared vertical menu keyboard movement,
      shared typeahead matching, and guarded trigger/item/keyboard handlers following the
      SPEC §4.6 primitive handler no-op contract. It is exported through
      `@jiso/headless-ui`, `@jiso/headless-ui/primitives`, and
      `@jiso/headless-ui/primitives/context-menu`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/primitives/context-menu.test.ts src/primitives/dropdown-menu.test.ts src/lib/typeahead.test.ts src/lib/change-details.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/package.json packages/headless-ui/src/index.ts packages/headless-ui/src/primitives/index.ts packages/headless-ui/src/primitives/context-menu.ts packages/headless-ui/src/primitives/context-menu.test.ts plans/ui.md`,
      and `git diff --check HEAD~1..HEAD`. H3 remains open for menubar, navigation-menu,
      slider, toast, command, and full gates.
- [x] U1 token sheet + `cn()` + statically-analyzable variant helper (Tailwind-first, §13.1 discoverability rules).
      Evidence 2026-06-12: `packages/headless-ui/src/lib/class-names.ts`
      provides the dependency-free `cn()` helper, `packages/headless-ui/src/lib/variants.ts`
      provides `defineVariants()` and `variantClassNames()` over explicit class strings with
      a SPEC §13.1 comment, and `packages/headless-ui/src/lib/token-sheet.ts` adds the bounded
      `jisoUiTokenSheet` CSS custom-property contract plus Tailwind v4 `@theme inline` aliases
      for the future vendored `@jiso/ui` styled layer. The foundation helpers are exported
      through both `@jiso/headless-ui` and `@jiso/headless-ui/lib`. Same-session evidence:
      `pnpm --filter @jiso/headless-ui exec vitest --run src/lib/token-sheet.test.ts src/lib/class-names.test.ts src/lib/variants.test.ts src/lib/foundation-exports.test.ts`,
      `pnpm --filter @jiso/headless-ui run lint:primitives`,
      `pnpm exec vp check packages/headless-ui/src/lib/token-sheet.ts packages/headless-ui/src/lib/token-sheet.test.ts packages/headless-ui/src/lib/class-names.ts packages/headless-ui/src/lib/class-names.test.ts packages/headless-ui/src/lib/variants.ts packages/headless-ui/src/lib/variants.test.ts packages/headless-ui/src/lib/foundation-exports.test.ts packages/headless-ui/src/lib/index.ts packages/headless-ui/src/index.ts plans/ui.md`,
      and `git diff --check`.
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
  - Partial CLI slice landed on branch `agent/d7-u2-fw-add-audit-20260612s`: `fw add button card [--out <dir>]` vendors app-local TSX source for the two pure-markup components, refuses unknown component names, skips already-current files, and refuses to overwrite app-owned divergent files. Evidence: `packages/cli/src/index.test.ts` asserts the copied sources contain TSX component definitions and no lowered `fw-c`/`data-bind` stamps per SPEC §5.2; same-session check `pnpm exec vitest --run packages/cli/src/index.test.ts -t "fw add|add component|unknown component"`.
  - Additional partial evidence 2026-06-12: `packages/cli/src/add-catalog.ts` extracts the
    vendored source catalog out of the CLI command body while keeping `fw add` file output
    idempotent and TSX-only per SPEC §5.2. Same-session evidence:
    `pnpm exec vitest --run packages/cli/src/index.test.ts -t "fw add"`,
    `pnpm exec vp check packages/cli/src/add-catalog.ts packages/cli/src/index.ts packages/cli/src/index.test.ts plans/ui.md`,
    and `git diff --check`.
  - Additional partial evidence 2026-06-12: `packages/cli/src/add-catalog.ts` now includes
    pure-markup `badge` and `kbd` TSX source alongside `button` and `card`, with
    `packages/cli/src/index.test.ts` asserting the stable available list, vendored file output,
    and absence of lowered `fw-c`/`data-bind` stamps per SPEC §5.2. Same-session evidence:
    `pnpm exec vitest --run packages/cli/src/index.test.ts -t "fw add"`,
    `pnpm exec vp check packages/cli/src/add-catalog.ts packages/cli/src/index.ts packages/cli/src/index.test.ts plans/ui.md`,
    and `git diff --check`.
  - Additional partial evidence 2026-06-12: `packages/cli/src/add-catalog.ts` now includes
    pure-markup `alert` and `skeleton` TSX source in the `fw add` catalog, keeping the
    available list sorted and vendored output TSX-only with no lowered `fw-c`/`data-bind`
    stamps per SPEC §5.2. `packages/cli/src/index.test.ts` covers the expanded stable list,
    copied `alert.tsx`/`skeleton.tsx` output, unknown-component output, idempotence, and
    overwrite refusal. Same-session evidence:
    `pnpm exec vitest --run packages/cli/src/index.test.ts -t "fw add"`,
    `pnpm exec vp check packages/cli/src/add-catalog.ts packages/cli/src/index.test.ts plans/ui.md`,
    and `git diff --check`.
  - Remaining before U2 can be checked complete: promote the extracted catalog into whatever
    distributable contract/package asset shape `@jiso/ui` needs, add styled wrappers that import
    `@jiso/headless-ui`, and run the vendored output through the same TSX authoring/FW235 gate as
    local app code.
  - Remaining before U3 can be checked complete: add the rest of the pure-markup set
    (`table`, `breadcrumb`) and sheet/drawer styled dialog variants, then
    verify them through the gallery/conformance surface rather than only CLI copy tests.
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
