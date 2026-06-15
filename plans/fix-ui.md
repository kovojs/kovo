# Fix UI: make gallery components behave like their base-ui / shadcn models

Status: **open — Phase 0 done; Phase 1 target reactive migration verified; Phase 2 explicit-reducer
pattern is landing across demos; remaining primitive behavior and per-component parity remain.**
Created 2026-06-14. `SPEC.md` is the source of truth for framework behavior; this file is the active
remediation ledger for the `@jiso/headless-ui` (modeled on **Base UI**) and `@jiso/ui` (modeled on
**shadcn/ui**, i.e. Radix) component layers as exercised by `examples/gallery`.

## Goal

**Every interactive component in the Jiso gallery behaves like its Base UI / shadcn model when the
_shipped_ static export is driven in a real browser — proven by a no-shim Playwright gate that asserts
each model's keyboard, ARIA, focus, and pointer contract — achieved by fixing the framework gaps
(runtime resolution, full `on:*` delegation, island-local state→DOM reactivity) and rewriting the
demos to drive the existing headless-ui primitives declaratively, rather than hand-scripting DOM.**

Done when:

- [x] **Loads & runs:** `node examples/gallery/scripts/export-static.mjs` produces an export that,
      served as-is (no import-map shim, no custom loader), runs every client handler — zero
      `Failed to resolve module specifier` errors, and `keydown`/`contextmenu`/`paste`/`cancel`/
      `focus`/`blur`/hover intent all fire (SPEC §4.4). Gallery renders styled. _(Phase 0 done +
      verified via `scratch/gallery-verify-noshim.mjs`.)_
- [x] **Reactive by default:** a handler that only mutates `ctx.state` reflects to the DOM
      (aria/`data-state`/text/`hidden`) with no hand-authored `setAttribute` — the §4.8 update plan runs
      for island-local state, and FW311 coverage flags unstamped state reads at compile time.
  - Evidence 2026-06-15: see `plans/reactive-ui.md` S1-S8 and acceptance evidence; focused no-shim
    Playwright verification passed `switch`, `toggle`, `disclosure`, and `checkbox` state, ARIA,
    `data-state`, native `checked`/`hidden`, and text-output assertions against the unmodified static
    export.
- [ ] **Primitive-driven:** no demo contains hand-rolled `Reflect['get'](globalThis,'document')`
      keyboard logic or hardcoded element-id/state-value scripts; each reads `event.key` via the chained
      primitive reducer (`tabsKeyDown`, `comboboxKeyDown`, `radioGroupKeyDown`, …).
- [ ] **Per-component parity:** all 35 components reach their committed status — the 15 `broken` become
      functional; the locked-scope items land (custom `select`/`slider`, imperative `toast`,
      directional-sheet `drawer`, documented-native `progress`/`meter`); `partial` items close their
      listed gaps.
- [ ] **Regression-proof:** the no-shim static-export Playwright harness is a CI gate asserting the
      **model contracts** (ArrowRight roving, Home/End, typeahead, Escape, focus-into-menu, hover-open,
      …) — not the old canned behavior — with axe clean on real interactive end-states; `vp check` and
      the gzip-budget/fixpoint parity gates stay green.

**Success metric:** re-run `scratch/gallery-probe3.mjs` semantics against the **unmodified** export —
every component that is `broken`/`wrong-primitive`/`partial` today returns the model-correct result
(keyboard navigates, state reflects, hover opens, no console errors), i.e. the probe that surfaced the
bugs passes without the shim or full-delegation crutches it needed to see them.

## TL;DR

Almost every interactive gallery component fails to behave like its Base UI / shadcn model, for
**four layered reasons** (bottom three are framework-level; the top one is per-demo authoring):

1. **The shipped gallery loads no client JS at all** — generated modules `import { handler } from
'@jiso/runtime'` (a bare specifier) and the exported HTML has no resolution, so the browser throws
   `Failed to resolve module specifier "@jiso/runtime"` and every handler module fails. Native-only
   widgets (`<dialog command>`, `<details>`) are the only things that move.
2. **The loader delegates only 4 events** (`click/submit/input/change`); `keydown` (25 handlers),
   `contextmenu`, `paste`, `cancel`, `focus`, `blur` never fire — SPEC §4.4 requires delegation of
   **all** `on:*`. `pointerenter/leave` (tooltip, hover-card) are non-delegable even if added.
3. **Local island-state has no state→DOM reactivity.** The §4.8 update plan (bindings/derives/stamps)
   is wired only for **queries**, not island-local `state` — despite SPEC §4.8 explicitly saying
   "island-local state; same machinery, two data sources." The compiler emits no state-driven stamps
   and the loader applies no state update plan after writing `fw-state`.
4. **The demos bypass the (correct) primitives.** The headless-ui primitives are real, tested,
   Base-UI-faithful reducers (`tabsKeyDown`, `comboboxKeyDown`, `dropdownMenuMove`, `toggleCheckbox`,
   …) but 27/35 demos hand-write imperative DOM with **hardcoded element ids and hardcoded state
   values** (only 2 demos even read `event.key`). They are scripted single-path mockups — e.g. the
   tabs `onKeyDown` ignores the key, the combobox only reacts to `'chicago'`, ArrowDown closes it.

Because of #3, the demos that DO work only do so by hand-authoring imperative DOM in the demo source
(verbose, duplicated, often wrong); the demos that author clean declarative TSX (switch, toggle,
disclosure) are visibly inert. Fixing #1–#3 lets demos be authored declaratively against the
primitives; #4 is then the per-component rewrite.

## How this was diagnosed (methodology, so it's reproducible)

- Built the static gallery: `cd examples/gallery && node scripts/export-static.mjs --out dist`
  (`html=1 client-modules=35 assets=0 diagnostics=0`).
- Served `dist/` and drove it in real headless Chromium via Playwright (scripts in `scratch/`:
  `gallery-drive.mjs`, `gallery-probe2.mjs`, `gallery-probe3.mjs`). Two passes:
  - **Pass A — as shipped:** only the native `<dialog command>` opened; everything else dead
    (`PAGEERROR: Failed to resolve module specifier "@jiso/runtime"`).
  - **Pass B — with an import-map shim (`@jiso/runtime`→identity `handler`) and all `on:*` delegated:**
    observed the true component-logic behavior, isolating framework infra (#1/#2) from component
    logic (#3/#4).
- Cross-checked every component against the live Base UI (`base-ui.com/react/components/*`) and shadcn
  (`ui.shadcn.com/docs/components/*`) docs and against the headless-ui primitive source + tests.
- Raw evidence digest: `scratch/fix-ui-evidence.md`; full per-component audit: `scratch/family-detail.txt`.

## Per-component verdict (Pass B — handlers actually running)

| status                                                                | components                                                                                                                                                              |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **broken** (non-functional or actively wrong)                         | disclosure, switch, toggle, checkbox, radio-group, tabs, combobox, autocomplete, command, dropdown-menu, context-menu, menubar, navigation-menu, otp-field, scroll-area |
| **wrong-primitive** (native/other element, not the modeled component) | select, slider\*, progress, meter, drawer                                                                                                                               |
| **partial** (core works, model gaps remain)                           | accordion, collapsible, toggle-group, checkbox-group, toolbar, number-field, field, tooltip, hover-card, popover, dialog, alert-dialog, sheet, toast                    |

\* slider is functional via a native `<input type=range>` but is not the Base UI/Radix custom thumb.

---

## Phase 0 — Make interactivity reach the browser (P0 infra; unblocks everything)

**Status: DONE + verified (commit on `agent/fix-ui-impl`).** No-shim acceptance
(`scratch/gallery-verify-noshim.mjs`) against the unmodified export: click/keydown/contextmenu/hover
handlers all fire; **0** `@jiso/runtime` resolution errors; `assets=1` (site.css 58KB). Runtime suite
311/311, gallery suite 86/86 green.

- [x] **Stop emitting a bare `@jiso/runtime` specifier in generated client modules.** SPEC §4.4
      makes load-bearing import maps a non-goal ("the compiler and server emit full module URLs with
      cache-busting they control; import maps remain an optional deployment strategy"), so the fix is
      server/compiler-side, not an import map in the gallery.
  - **Done:** `examples/gallery/src/app-shell.ts` registers a minimal runtime module
    (`export const handler = (fn) => fn;`) at a versioned `/c/.../jiso-runtime.client.js` URL and
    rewrites each demo module's `import { handler } from '@jiso/runtime'` to that URL at registration
    (option (a)). Added to `modulepreloads` so the static export writes it (`client-modules=36`).
    Verified: served modules contain no bare `@jiso/runtime`; no resolution error in the browser.
  - **Follow-up (open):** promote this into `@jiso/server` so every static export (docs site,
    `examples/reference`) gets it, not just the gallery app-shell. Tracked under Phase 4.
  - Every generated module begins `import { handler } from '@jiso/runtime';` and `handler` is the
    identity wrapper `(fn) => fn` (`packages/runtime/src/handlers.ts:38`). Confirmed it is the **only**
    `@jiso/runtime` import across all 35 modules.
  - Options to evaluate (pick one, cite SPEC): (a) the server registers `@jiso/runtime` as a versioned
    client module at a resolvable `/c/...` URL and rewrites the import at emit (mirrors how demo
    modules are served via `createMemoryVersionedClientModuleRegistry`); (b) the client emit inlines
    the identity `handler` (drop the import) since it is type-only sugar; (c) document an import map as
    the optional deployment strategy SPEC permits, but not as the framework default.
  - **Note:** this is NOT gallery-specific — the docs-site export path uses the same `exportStaticApp`
    - loader (`jisoLoaderSource`) and emits the same bare specifier, so any Jiso app deployed statically
      is affected. Fix in `@jiso/server`/`@jiso/compiler`, then re-verify the gallery.
- [x] **Delegate all `on:*` events in both loaders (SPEC §4.4: "Event delegation (capture phase) for
      all `on:*` events").**
  - **Done:** both the inline 4KB loader (`packages/runtime/src/inline-loader-build.ts`, regenerated
    into `inline-loader.ts`) and the full bootstrap loader
    (`loader.ts` `defaultDelegatedEvents` + `loader-lifecycle.ts`) now delegate
    `click/submit/input/change/keydown/keyup/contextmenu/paste/cancel/focus/blur` (capture phase
    reaches non-bubbling `focus`/`blur`).
  - **Non-bubbling pointer intent:** `pointerenter`/`pointerleave` are synthesized from the bubbling
    `pointerover`/`pointerout` pair, firing only when the pointer crosses the `on:*` element's boundary
    (`relatedTarget` outside it) — so demos keep authoring `on:pointerenter`/`on:pointerleave` with no
    change. Verified: tooltip opens on hover in the no-shim acceptance.
  - Stayed within the 4KB gzip budget (build emitted no budget error; ~3.1KB→still under 4KB). Parity
    `--check` passes; loader event-list test assertions updated across runtime test files. (`scroll`
    for scroll-area still needs direct attachment — deferred to the scroll-area item.)
- [x] **Copy the stylesheet into the standalone export so the gallery is styled.**
  - **Done:** `examples/gallery/scripts/export-static.mjs` passes the prebuilt
    `site/dist-css/assets/site.css` as a `StaticExportAssetInput` (filesystem-path `source`, per FW229)
    so the export ships `/assets/site.css` (`assets=1`, 58KB), gracefully skipping with a warning if
    the docs CSS isn't built. (Web-font `.woff2` files still 404 — cosmetic; fonts fall back. Optional
    follow-up to copy `/fonts/*`.)
  - **Follow-up (open):** apply the same to `examples/reference`.

## Phase 1 — Local-state reactivity (P0 framework) → **see `plans/reactive-ui.md`**

The central gap (SPEC §4.8: "island-local state; same machinery, two data sources") is its own
subsystem — compiler lowering + analysis + emit, loader application within the 4KB budget, and the §4.9
coverage gate. **Fleshed out as a standalone plan: `plans/reactive-ui.md`.** Summary of scope:

- [x] **Compiler** — lower `state.*` JSX reads to `data-bind`/`data-bind:<attr>` + named derives
      (`input: 'state'`), mirroring the query path (`lower/inline-derives.ts`,
      `analyze/query-updates.ts`); add state binding/coverage facts for diagnostics and `fw explain`
      only, not a runtime `statePlans` artifact.
- [x] **Loader** — apply state bindings after writing `fw-state` (walk `[data-bind]` under the nearest
      `[fw-state]` host, reuse `query-bindings.ts` with a `state` resolver, lazy-load derives when
      compiler-emitted state derives land), within the inline-loader gzip budget.
  - Evidence 2026-06-15: see `plans/reactive-ui.md` S1/S2/S4/S5 evidence and commits through the
    state attribute derive/runtime application checkpoint.
- [x] **Coverage** — extend the §4.9 / FW311 exhaustiveness check to state reads.
  - Evidence 2026-06-15: see `plans/reactive-ui.md` S3/S6 evidence; FW311 and SPEC §4.9 are broadened
    to query/state-dependent DOM positions, with CLI/check fixture coverage for `source=state`.
- [x] **Migrate** `switch`/`toggle`/`disclosure`/`checkbox` to declarative state binding (handlers
      reduce to a state mutation); verify in the no-shim harness; imperative demos unaffected.
  - Evidence 2026-06-15: see `plans/reactive-ui.md` S7/S8; `pnpm --filter @jiso/example-gallery
emit:interactive-gallery --check`, static export, `node scratch/gallery-verify-noshim.mjs`, and
    the focused target Playwright probe passed.

Note: the `{...primitiveAttrs(state)}` spread hides the dependency from the compiler — Phase 1 migrates
the 4 target demos to direct expressions; the general primitive-composition binding is Phase 2 below.

## Phase 2 — Wire the chained primitive handlers (SPEC §4.6) so demos stop hand-rolling behavior (P1)

The primitives export real reducers tagged `@jisoPrimitiveHandler` (SPEC §4.6): `tabsKeyDown`,
`comboboxKeyDown/Move/Typeahead`, `dropdownMenuKeyDown/Move`, `menubarKeyDown/Move`, `toolbarKeyDown`,
`radioGroupKeyDown`, `otpFieldKeyDown/Paste`, `toggleCheckbox`, etc. SPEC §4.6 says a primitive merges
its `on:*` refs into the author element and the loader **chains** them (author first, then primitive).
The demos use the low-level `*Attributes()` plain-function spelling, which yields static ARIA but does
**not** wire the behavior handlers — so authors hand-rolled keyboard, badly.

- [x] **Preserve primitive reducer imports into generated client handlers and static export modules.**
      Generated client modules now carry referenced named imports from app-authored TSX, and the gallery
      static shell registers the headless-ui primitive module graph under versioned `/c/...` URLs
      (SPEC §4.4) so explicit reducer calls run in the browser without import maps.
  - Evidence 2026-06-15:
    `packages/compiler/src/scan/parse.ts`, `packages/compiler/src/lower/handlers.ts`,
    `packages/compiler/src/emit/client.ts`, and `examples/gallery/src/app-shell.ts` implement the
    parser/lowering/client-import/static-rewrite path.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec vitest run src/scan/parse.test.ts
    src/handler-lowering.test.ts` passed.
  - Evidence 2026-06-15: `pnpm --filter @jiso/compiler exec tsc --noEmit` and
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **Establish the canonical demo pattern** with tabs: declarative state-bound attributes (Phase 1)
      plus explicit primitive reducer calls in the demo handler, no
      `Reflect['get'](globalThis,'document')` hand-rolling.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/tabs-demo.tsx` calls
    `_tabsKeyDown`/`_tabsTriggerClick`, mutates only `state`, and expresses trigger/panel
    `aria-selected`, `data-state`, `tabIndex`, and `hidden` as state-bound TSX attributes.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/tabs-demo.client.js` imports the reducer helpers,
    mutates only `ctx.state`, emits state derives for the changing tabs attributes, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated tabs files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery emit:interactive-gallery`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts`, and
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t tabs` passed.
- [ ] **Implement primitive `on:*` chaining for the framework authoring spelling.** Decide and wire the
      long-term §4.6 attrs-function / `asChild` / behavior-attribute form that merges chained primitive
      `on:keydown`/`on:click` refs into the author element. The gallery now has an explicit-reducer
      pattern to unblock rewrites, but automatic primitive chaining remains open.

## Phase 3 — Per-component demo rewrites (use the primitives + declarative state)

Each item: rewrite the demo to drive behavior from the existing primitive reducer and bind state
declaratively. Grouped by family; severity is the worst gap. Primitives are correct unless noted.

### Menus (all keyboard-first; all currently broken)

- [x] **dropdown-menu** [P1]: trigger has no `onKeyDown` (Enter/Space/ArrowDown/Up should open + move
      focus into menu); once open, ArrowDown/Up/Home/End/typeahead don't move highlight/focus (stays on
      trigger). Wire `dropdownMenuKeyDown`/`dropdownMenuMove`/`dropdownMenuTypeahead`,
      `dropdownMenuItemKeyDown`; move focus into `role=menu` on open and highlight first enabled item;
      Escape/Tab close + restore focus. Styled `@jiso/ui/dropdown-menu.tsx` is stateless SSR — all
      behavior is demo-authored.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/dropdown-menu.ts` exports
    `dropdownMenuTriggerKeyDown` and deferred `dropdownMenuFocusElement`; primitive coverage verifies
    trigger keyboard open, item activation, movement/typeahead, cancelability, ownerDocument fallback,
    deferred focus scheduling, and barrel exports.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/dropdown-menu-demo.tsx` now calls
    `_dropdownMenuTriggerClick`, `_dropdownMenuTriggerKeyDown`, `_dropdownMenuItemKeyDown`,
    `_dropdownMenuKeyDown`, `_dropdownMenuMove`, `_dropdownMenuTypeahead`, and
    `_dropdownMenuItemClick`, with state-bound `aria-expanded`, `data-state`, `hidden`,
    `data-highlighted`, `tabIndex`, and output text.
  - Evidence 2026-06-15: generated `dropdown-menu-demo.client.js` mutates only `ctx.state`, imports
    the dropdown reducers/focus helper, and `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"`
    against the authored and generated dropdown files found no matches.
  - Evidence 2026-06-15: passed `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/dropdown-menu.test.ts`; `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts
    src/interactive-gallery.aria-contracts.test.ts`; `pnpm --filter @jiso/example-gallery exec vitest
    --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts -t
    "dropdown"`; `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts
    --run src/interactive-gallery.axe.browser.test.ts -t "generated interactive"`;
    `pnpm --filter @jiso/headless-ui exec tsc --noEmit`; `pnpm --filter @jiso/example-gallery exec
    tsc --noEmit`; `pnpm --filter @jiso/example-gallery exec node
    scripts/emit-interactive-gallery.mjs --check`; `git diff --check`.
- [ ] **context-menu** [P1]: `onContextMenu` open never fires (loader #2) and the menu has **no
      arrow/typeahead nav and no Escape handler at all**; anchoring is static `data-anchor-x/y=24/40`.
      Wire `contextMenuKeyDown/Move/Typeahead`, read `event.clientX/Y` via `contextMenuPointFromEvent`
      to anchor at the cursor, add Escape + focus-into-menu.
- [ ] **menubar** [P1]: section `onKeyDown` is a stub that ignores the key and hardcodes File→Edit;
      Edit is fully inert (no handler); no ArrowLeft/Right roving, no ArrowDown-to-open, no Escape, no
      "switch open menu while arrowing the bar." Wire `menubarMove`/`menubarKeyDown`/`menubarItemKeyDown`
      across both menus.
- [ ] **navigation-menu** [P1]: no hover-open (signature interaction); ArrowRight is one-way
      Products→Docs with no ArrowLeft/loop; **Escape is actively wrong** — it sets
      `value='escape-canceled'` and leaves the panel open. Wire `navigationMenuMove`,
      `navigationMenuKeyDown` (Escape closes + restores focus), hover-open via `pointerover`/`focusin`.
- [x] **toolbar** [P2]: root `onKeyDown` hardcodes a bold↔link flip ignoring the key (ArrowLeft==Right,
      no Home/End, disabled 'italic' skipped only incidentally). Wire `toolbarKeyDown`/`toolbarMoveFocus`
      (auto-skips disabled). Click-toggle already works (imperative stamps present).
  - Evidence 2026-06-15: `examples/gallery/src/interactive/toolbar-demo.tsx` now calls
    `_toolbarKeyDown`, mutates only `state.activeValue`/`state.pressedValue`, and exposes
    `aria-pressed`, `data-pressed`, roving `tabIndex`, active output, and pressed output as
    state-bound TSX.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/toolbar-demo.client.js` imports `_toolbarKeyDown`,
    emits state derives for toolbar button/output attributes, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated toolbar files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery emit:interactive-gallery`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t "toolbar"`,
    `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`,
    and `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.

### Typeahead / listbox

- [x] **combobox** [P0]: ArrowDown/Up don't move highlight — any non-Enter key runs
      `state.open = !state.open`, so ArrowDown **closes** the listbox; Home/End/Escape unimplemented;
      typing rewrites the committed `value`. Wire `comboboxKeyDown`/`comboboxMove`; on input update
      query/highlight only (commit on Enter/click via `comboboxOptionClick`); drive option
      visibility/highlight from the typed text.
      - Evidence 2026-06-15: `packages/headless-ui/src/primitives/combobox.ts` now accepts delegated
        input values from `event.target`, resolves active descendants from item ids, and exposes
        `comboboxFilteredItems`; covered by
        `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/combobox.test.ts`.
      - Evidence 2026-06-15: `examples/gallery/src/interactive/combobox-demo.tsx` keeps
        `inputValue` separate from committed `value`, routes input/key/click handlers through
        `comboboxInput`, `comboboxFilteredItems`, `comboboxKeyDown`, and `comboboxOptionClick`, and
        drives input/listbox/option/output state through TSX bindings. Generated
        `combobox-demo.client.js` imports those primitive helpers and has no
        `Reflect`/`document`/`globalThis`/`setAttribute`/`ctx.params` escape hatches.
      - Evidence 2026-06-15: gallery client/compile and browser interaction coverage passed via
        `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`
        and
        `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.interactions-a.browser.test.ts -t combobox`.
- [x] **autocomplete** [P1]: popup is a native `<datalist>` with a single hardcoded `<option>` (not a
      navigable `role=listbox`); typing always scripts `'dev'→development`; arrows toggle open instead
      of navigating. Render a real `role=listbox`/`role=option` list from `autocompleteSuggestions`,
      wire `autocompleteKeyDown`/`autocompleteMove`, filter on real input.
      - Evidence 2026-06-15: `packages/headless-ui/src/primitives/autocomplete.ts` now emits
        listbox/option attributes instead of datalist/option attributes, accepts delegated
        `event.target` input values, and resolves active descendants from item ids; covered by
        `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/autocomplete.test.ts`.
      - Evidence 2026-06-15: `examples/gallery/src/interactive/autocomplete-demo.tsx` renders a real
        `div role=listbox` with option buttons, routes input/key/click handlers through
        `autocompleteInput`, `autocompleteSuggestions`, `autocompleteKeyDown`, and
        `autocompleteOptionClick`, and drives input/listbox/option/output state through TSX
        bindings. Generated `autocomplete-demo.client.js` imports those primitive helpers and has no
        `Reflect`/`document`/`globalThis`/`setAttribute`/`ctx.params` escape hatches.
      - Evidence 2026-06-15: gallery client/compile and browser interaction coverage passed via
        `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`
        and
        `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.interactions-a.browser.test.ts -t autocomplete`.
- [x] **command** [P0]: input `onKeyDown` early-returns on any non-Enter key, so Arrow nav does nothing
      and `aria-activedescendant`/`data-highlighted` never move. Wire `commandKeyDown`/`commandMove`,
      live filter + reset-highlight-to-first-match (cmdk model), Escape closes dialog.
      - Evidence 2026-06-15: `examples/gallery/src/interactive/command-demo.tsx` now routes trigger,
        input, keydown, item click, and close handlers through `commandTriggerClick`,
        `commandInput`, `commandFilteredItems`, `commandKeyDown`, `commandItemClick`, and
        `commandCloseClick`; generated `command-demo.client.js` imports those primitive helpers and
        contains no `Reflect`/`document`/`globalThis`/`setAttribute` escape hatches.
      - Evidence 2026-06-15: `packages/headless-ui/src/primitives/command.ts` accepts delegated
        input values from `event.target` with nullable event-target fallback; covered by
        `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/command.test.ts`.
      - Evidence 2026-06-15: command gallery behavior, ARIA derives, generated compile assertions,
        and browser interaction passed via
        `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts`
        and
        `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts -t command`.
- [x] **select** [P1]: demo is a **native `<select>`** (and the primitive itself targets a native
      `<select>`/`<optgroup>`), not the shadcn button+`role=listbox` popup. Even as native, the
      `onChange` hardcodes three outcomes and collapses anything but `'express'` to `'standard'`.
      **Decision (locked 2026-06-14): build the custom listbox** — re-author as a button trigger
      (`aria-haspopup=listbox`) + `role=listbox` popup of `role=option` items, backed by a new
      `select.ts` primitive (reuse `comboboxMove`/`comboboxKeyDown`/`comboboxTypeahead` machinery for
      keyboard + typeahead + highlight). See Phase 4 `select.ts`.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/select.ts` now exposes custom select
    button/listbox/option attributes, `selectHiddenInputAttributes`, `setSelectOpen`,
    `selectTriggerClick`, `selectItemClick`, `selectKeyDown`, `selectMove`, `selectTypeahead`, and
    `selectOption`, while keeping `selectTriggerChange` for legacy native callers.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/select-demo.tsx` now renders a button
    trigger, hidden submitted input, `role=listbox` popup, and `role=option` items. Generated
    `select-demo.client.js` imports the custom select reducers, mutates only `ctx.state`, and has no
    `Reflect`/`document`/`globalThis`/`setAttribute`/`ctx.params` escape hatches or captured
    `shippingOptions`.
  - Verification 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/select.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts
    src/interactive-gallery.aria-contracts.test.ts`, `pnpm --filter @jiso/example-gallery exec
    vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t select`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/merge-fixtures.forms.test.tsx
    src/merge-fixtures.idref-oracle.test.tsx`, `pnpm --filter @jiso/headless-ui exec tsc
    --noEmit`, `pnpm --filter @jiso/ui exec tsc --noEmit`, `pnpm --filter @jiso/example-gallery
    exec node scripts/emit-interactive-gallery.mjs --check`, and `pnpm --filter
    @jiso/example-gallery exec tsc --noEmit` passed.

### Selection controls

- [x] **switch** [P0]: Phase 1 now updates `fw-state`, `aria-checked`, `data-state`, native `checked`,
      and `<output>` from declarative state bindings in the no-shim export. Remaining parity work:
      route through `switchTriggerClick` and add Enter-to-toggle to match shadcn.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/switch-demo.tsx` now calls
    `_switchTriggerClick` for click and Enter key activation, mutates only `state.checked`, and keeps
    `aria-checked`, native `checked`, `data-state`, and output text as state-bound TSX.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts` and
    `packages/runtime/src/inline-loader-build.ts` now reflect `data-bind:checked` updates to the live
    `.checked` property; `packages/runtime/src/query-bindings.test.ts` covers state-derived checked
    property reflection.
  - Evidence 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run src/query-bindings.test.ts
    src/inline-loader-delegated.test.ts src/handlers.test.ts`, `pnpm --filter @jiso/runtime
    check:inline-loader`, and `pnpm --filter @jiso/runtime exec tsc --noEmit` passed.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    focused browser coverage for `switch`, `toggle stamped`, and `checkbox stamped`, and
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **toggle** [P0]: Phase 1 now updates `aria-pressed`, `data-state`, and `<output>` from
      declarative state bindings. Remaining parity work: route through `toggleTriggerClick` and cover
      the modeled keyboard/button contract.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/toggle-demo.tsx` now calls
    `_toggleTriggerClick`, mutates only `state.pressed`, and keeps `aria-pressed`, `data-state`, and
    output text as state-bound TSX.
  - Evidence 2026-06-15: the focused gallery client/compile test, browser interaction test for
    `toggle stamped`, and gallery typecheck commands listed under `switch` passed.
- [x] **checkbox** [P1]: Phase 1 now updates `aria-checked`, `data-state`, native `checked`,
      native `indeterminate`, and `<output>` from the indeterminate initial state on click.
      Remaining parity work: fuller checkbox model coverage.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/checkbox-demo.tsx` now calls
    `_checkboxTriggerClick`, mutates only `state.checked`, and keeps `aria-checked`, native
    `checked`, native `indeterminate`, `data-state`, and output text as state-bound TSX.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts`,
    `packages/runtime/src/loader.ts`, and `packages/runtime/src/inline-loader-build.ts` now reflect
    `data-bind:indeterminate` to the live checkbox property and initialize SSR-native mixed
    checkboxes during modular and inline loader install.
  - Evidence 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run src/query-bindings.test.ts
    src/loader.test.ts src/inline-loader-delegated.test.ts src/handlers.test.ts`,
    `pnpm --filter @jiso/runtime check:inline-loader`, `pnpm --filter @jiso/runtime exec tsc
    --noEmit`, `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t "checkbox stamped"`,
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit`, and `pnpm --filter
    @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check` passed.
  - Evidence 2026-06-15: `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"
    examples/gallery/src/interactive/checkbox-demo.tsx
    examples/gallery/src/generated/interactive/checkbox-demo.tsx
    examples/gallery/src/generated/interactive/checkbox-demo.client.js` found no imperative
    DOM escape-hatch usage in the checkbox authored/generated path.
- [x] **radio-group** [P1]: `onKeyDown` is a direction-blind 2-state `email↔sms` flip that fires on
      every key (Tab/typing flip it) and never wraps/skips disabled; per-item `onClick` is hardcoded
      one-directional and native `checked` desyncs from stamped `aria-checked`. Wire `radioGroupKeyDown` + `radioGroupItemClick`; maintain roving `tabindex` via `radioGroupItemTabIndex`.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/radio-group-demo.tsx` now calls
    `_radioGroupKeyDown`/`_radioGroupItemClick`, mutates only `state.value`, and exposes item/input/
    label `data-state`, input `aria-checked`, native `checked`, and roving `tabIndex` as state-bound
    TSX attributes.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/radio-group-demo.client.js` imports the reducer helpers,
    mutates only `ctx.state`, emits state derives for radio attributes, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated radio-group files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery emit:interactive-gallery`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t radio-group`, and
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **checkbox-group** [P2]: click-toggle works (imperative stamps), but the `onKeyDown` invents
      arrow-roving (wrong model — checkboxes are each Tab-focusable + Space) and is a blind 2-state flip.
      Drop the arrow-roving (or route through `checkboxGroupKeyDown`); refactor clicks to
      `checkboxGroupItemClick`. Demonstrate the indeterminate parent affordance.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/checkbox-group-demo.tsx` removed the
    root Arrow-key roving handler, keeps both item checkboxes as normal Tab stops, routes item clicks
    through `_checkboxGroupItemClick`, and adds a parent "All notifications" checkbox whose
    `aria-checked`, native `checked`, native `indeterminate`, and `data-state` derive from the group
    value.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/checkbox-group-demo.client.js` imports
    `_checkboxGroupItemClick`/`_checkboxTriggerClick`, emits state derives for item, label, output, and
    parent mixed-state bindings, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated checkbox-group files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery emit:interactive-gallery`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t "checkbox-group"`,
    `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`,
    and `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **toggle-group** [P1]: click-toggle works; `onKeyDown` hardcodes bold↔italic ignoring the key and
      the disabled 'strike' middle item. Wire `toggleGroupKeyDown`/`toggleGroupMoveFocus`; route clicks
      through `toggleGroupItemClick`.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/toggle-group-demo.tsx` now calls
    `_toggleGroupKeyDown`/`_toggleGroupItemClick`, mutates only `state.activeValue`/`state.value`, and
    exposes `aria-pressed`, `data-state`, roving `tabIndex`, and output text as state-bound TSX.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/toggle-group-demo.client.js` imports the reducer
    helpers, emits state derives for toggle-group button/output attributes, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated toggle-group files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery emit:interactive-gallery`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t "toggle-group"`,
    `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`,
    and `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.

### Expandables

- [x] **disclosure** [P0]: Phase 1 now updates trigger `aria-expanded`/`data-state` and panel
      `hidden`/`data-state` from declarative state bindings in the no-shim export. Remaining parity
      work: route through the modeled disclosure primitive and add keyboard/focus contract coverage.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/disclosure-demo.tsx` now calls
    `_disclosureTriggerClick`, mutates only `state.open`, and keeps trigger `aria-expanded`/
    `data-state` plus panel `hidden`/`data-state` as state-bound TSX attributes.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/disclosure-demo.client.js` imports the primitive
    reducer helper, mutates only `ctx.state`, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated disclosure files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t disclosure`, and
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **tabs** [P1]: `onKeyDown` is a stub that **never reads `event.key`** (any key flips
      overview→details); no ArrowRight/Left roving, no Home/End, no manual Enter/Space activation, no
      disabled-skip. Replace with `tabsKeyDown` + `tabsMoveFocus`; re-stamp roving `tabIndex`,
      `aria-selected`, `data-state`, panel `hidden`. Click selection already works.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/tabs-demo.tsx` now calls
    `_tabsKeyDown`/`_tabsTriggerClick` and uses declarative state-bound trigger/panel attributes;
    generated client/server artifacts were refreshed under `examples/gallery/src/generated/interactive/`.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts` and
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t tabs` passed.
- [x] **accordion** [P1, needs primitive work]: no `onKeyDown` at all → no Arrow/Home/End roving between
      triggers; the primitive has **no** `accordionKeyDown`/roving-`tabindex` helper (unlike tabs). Add
      `accordionKeyDown` + roving `tabindex` to `accordion.ts` (mirror `tabsKeyDown`/`tabsMoveFocus`),
      then wire it. Click-toggle works but also stamp `data-state` (currently only `aria-expanded` +
      `hidden`, so `data-[state=open]` trigger styling goes stale).
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/accordion.ts` now exports
    `accordionRovingIndex`, `accordionMoveFocus`, and `accordionKeyDown`, with
    `accordionTriggerAttributes` stamping roving `tabIndex`; `accordion.test.ts` covers disabled-skip,
    non-loop edge behavior, and Arrow/Home/End keyboard mapping.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/accordion-demo.tsx` routes root keydown
    through `_accordionKeyDown`, trigger clicks through `_accordionTriggerClick`, and keeps
    `aria-expanded`, `data-state`, roving `tabIndex`, panel `hidden`, and output text as state-bound
    TSX. Regenerated server/client artifacts import the primitive reducers and emit the corresponding
    state derives.
  - Evidence 2026-06-15: `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored and
    generated accordion files found no matches; `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/accordion.test.ts`, `pnpm --filter @jiso/headless-ui exec tsc --noEmit`, `pnpm
    --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest
    --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts
    -t accordion`, `pnpm --filter @jiso/example-gallery exec node
    scripts/emit-interactive-gallery.mjs --check`, and `pnpm --filter @jiso/example-gallery exec tsc
    --noEmit` passed.
- [x] **collapsible** [P2]: native `<details>/<summary>` toggles fine, but `aria-expanded`/`data-state`
      on the summary never update (Phase-1 gap) and `data-[state=closed]:hidden` is dead on native
      `<details>`. Either sync `aria-expanded`/`data-state` from the native toggle, or move to the
      button+panel model; drop the inert `data-state` CSS hook.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/collapsible-demo.tsx` now routes summary
    clicks through `_collapsibleTriggerClick`, prevents the native default toggle after the reducer
    returns, and keeps `<details open>`, root/summary/content `data-state`, and summary
    `aria-expanded` as state-bound TSX.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/collapsible-demo.client.js` imports
    `_collapsibleTriggerClick`, emits derives for `open`, `aria-expanded`, and `data-state`, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated collapsible files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery emit:interactive-gallery`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest
    --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts
    -t "collapsible"`, `pnpm --filter @jiso/example-gallery exec node
    scripts/emit-interactive-gallery.mjs --check`, and `pnpm --filter @jiso/example-gallery exec tsc
    --noEmit` passed.

### Inputs

- [x] **otp-field** [P0]: typing `123` yields slot values `['1212','1','2','','']` — handlers are canned
      per-slot scripts that ignore real keystrokes and stamp literal characters; focus-advance,
      Backspace/Delete, Arrow/Home/End, and paste-distribute are all unmodeled. Rewrite to drive every
      slot from `otpFieldInput`/`otpFieldKeyDown`/`otpFieldPaste`/`otpFieldMoveFocus` (primitive is
      correct and unit-tested). Also needs loader keydown+paste delegation (Phase 0).
  - Evidence 2026-06-15: `examples/gallery/src/interactive/otp-field-demo.tsx` now imports
    `otpFieldInput`/`otpFieldKeyDown`/`otpFieldPaste`, mutates only `state.value`/`state.activeSlot`
    from reducer results, and expresses root/hidden/slot `data-complete`, slot `data-filled`,
    `tabIndex`, native `value`, and output text as state-bound TSX. `packages/headless-ui/src/primitives/otp-field.ts`
    also accepts delegated `event.target.value` for input/paste parity with the loader.
  - Verification 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/otp-field.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t OTP`, and
    `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`
    passed. `pnpm --filter @jiso/headless-ui exec tsc --noEmit`,
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit`, and `git diff --check` passed. `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params|otpSlotValue|applyOtpResult"
    examples/gallery/src/interactive/otp-field-demo.tsx
    examples/gallery/src/generated/interactive/otp-field-demo.tsx
    examples/gallery/src/generated/interactive/otp-field-demo.client.js` found no matches.
- [x] **slider** [P1]: native `<input type=range>` with decorative `aria-hidden` track/thumb — neither
      Base UI's per-thumb nested input nor shadcn/Radix's `role=slider` thumb. No `role=slider`/
      `aria-valuemin/now/max`, no track-click, no drag, no large-step, no multi-thumb.
      **Decision (locked 2026-06-14): build the custom thumb** — add a `role=slider` thumb primitive
      (`aria-valuemin/now/max/valuetext/orientation`, keydown Arrow/Page/Home/End + Shift-large-step,
      pointer drag, track-click) matching shadcn/Radix; drop the native range as the primary control.
      Replace the demo's hardcoded threshold quantizer with `sliderInput`. See Phase 4 `slider.ts`.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/slider.ts` now exposes a custom
    `role=slider` thumb (`aria-valuemin`/`aria-valuemax`/`aria-valuenow`/`aria-valuetext`,
    orientation, focusability), `sliderKeyDown`, `sliderTrackPointerDown`,
    `sliderThumbDragStart`, `sliderThumbDrag`, and `sliderHiddenInputAttributes` for submitted
    form values when the custom thumb is primary. `sliderTrackAttributes` no longer hides a focusable
    thumb subtree with `aria-hidden`.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/slider-demo.tsx` uses the custom thumb as
    the primary control, keeps only a hidden submitted input, removes the previous
    `Reflect`/`document`/`setAttribute` path, and drives all visible value, ratio, output, hidden
    input value, and thumb ARIA updates through state bindings in the generated client.
  - Verification 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/slider.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts
    src/interactive-gallery.aria-contracts.test.ts`, `pnpm --filter @jiso/example-gallery exec
    vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t slider`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/merge-fixtures.forms.test.tsx
    src/merge-fixtures.idref-oracle.test.tsx`, `pnpm --filter @jiso/headless-ui exec tsc
    --noEmit`, `pnpm --filter @jiso/ui exec tsc --noEmit`, `pnpm --filter @jiso/example-gallery
    exec node scripts/emit-interactive-gallery.mjs --check`, and `pnpm --filter
    @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **number-field** [P1]: functional via native `<input type=number>` + `+/-` buttons, but stepping
      is the browser's (not the primitive's aligned-step/clamp), and there's no PageUp/Down, Shift/Meta
      step, press-and-hold repeat, or `Intl` formatting. Add `numberFieldKeyDown` + `largeStep`/
      `smallStep` to the primitive; route demo handlers through `numberFieldInput`/`increment`/`decrement`.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/number-field.ts` now exposes
    `numberFieldKeyDown`, `smallStep`, and `largeStep`; primitive tests cover Arrow/Page/Home/End
    keyboard stepping, aligned-step behavior, and package/primitives barrel exports.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/number-field-demo.tsx` routes input,
    stepper clicks, and keydown through `_numberFieldInput`, `_numberFieldIncrementClick`,
    `_numberFieldDecrementClick`, and `_numberFieldKeyDown`; `value`, stepper `disabled`,
    `data-disabled`, and output text are state-bound TSX. Regenerated artifacts import the primitive
    reducers and emit the corresponding state derives.
  - Evidence 2026-06-15: `packages/runtime/src/query-bindings.ts` and
    `packages/runtime/src/inline-loader-build.ts` now reflect derived `data-bind:value` updates to the
    live control `.value`, with modular and inline tests covering the property reflection.
  - Evidence 2026-06-15: `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored and
    generated number-field files found no matches; `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/number-field.test.ts`, `pnpm --filter @jiso/headless-ui exec tsc --noEmit`,
    `pnpm --filter @jiso/runtime exec vitest run src/query-bindings.test.ts
    src/inline-loader-delegated.test.ts`, `pnpm --filter @jiso/runtime run check:inline-loader`,
    `pnpm --filter @jiso/runtime exec tsc --noEmit`, `pnpm --filter @jiso/example-gallery exec vitest
    run src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t number-field`, `pnpm --filter
    @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`, and `pnpm --filter
    @jiso/example-gallery exec tsc --noEmit` passed. Press-and-hold repeat and `Intl` formatting remain
    future enhancements beyond this verified primitive-routing closeout.
- [x] **field** [P2]: ARIA/`data-*` wiring is correct, but handlers are one-way scripted transitions
      (email always becomes valid; plan `<select>` toggles instead of reading the chosen value) and
      `aria-describedby` is only recomputed valid→invalid one direction. Drive from real constraint
      validation via `fieldControlAttributes`; read `event.target.value` for the select.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/field-demo.tsx` now reads the email input's
    actual `event.target.value`, uses native `checkValidity()` when available, reads the select's
    actual selected value, and reads the shipping toggle's native checked state. Email
    `aria-describedby`, `aria-invalid`, `data-invalid`, error `hidden`, input/select `value`, fieldset
    `disabled`/`data-disabled`, shipping toggle `checked`, and output text are state-bound TSX instead
    of imperative DOM writes.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/field-demo.client.js` mutates only `ctx.state` from
    event values and emits derives for the field validity/value/disabled bindings; `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored and
    generated field files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-a.browser.test.ts -t field`, `pnpm --filter
    @jiso/example-gallery exec tsc --noEmit`, and `pnpm --filter @jiso/example-gallery exec node
    scripts/emit-interactive-gallery.mjs --check` passed.

### Overlays — hover

- [x] **tooltip** [P0 hover]: opens on focus (works) but **never on hover** — wired to
      `pointerenter/leave` (non-delegable, Phase 0). Re-author hover on `pointerover/pointerout` (or
      `mouseover/mouseout`). Also: no open delay (Base UI 600ms), not positioned/hoverable, and
      `showPopover()`/`hidePopover()` are called unguarded (can throw `InvalidStateError`) while also
      toggling `hidden` + a `data-[state]` class — pick **one** visibility mechanism.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/tooltip.ts` now uses `hidden` +
    `data-state` + `role="tooltip"` only; tooltip content no longer emits `popover`, and the platform
    audit treats tooltip separately from popover-backed content.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/tooltip-demo.tsx` calls
    `_tooltipTriggerPointerEnter`, `_tooltipTriggerPointerLeave`, `_tooltipTriggerFocus`,
    `_tooltipTriggerBlur`, and `_tooltipEscapeKeyDown`; the handlers mutate only `state.open`, while
    trigger `aria-describedby`/`data-state`, content `data-state`/`hidden`, and output text are
    state-bound TSX.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/tooltip-demo.client.js` imports the tooltip primitive
    reducers, emits derives for `aria-describedby`, `data-state`, `hidden`, and output text, and captures
    no local `contentId` in the client derive.
  - Evidence 2026-06-15: `rg
    "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params|showPopover|hidePopover|popover"`
    against the authored tooltip demo, generated tooltip files, tooltip primitive, and tooltip primitive
    test found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/tooltip.test.ts src/platform-audit.test.ts`, `pnpm --filter @jiso/headless-ui exec
    tsc --noEmit`, `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/demo-fixtures.test.ts -t
    "renders tooltip fixture"`, `pnpm --filter @jiso/example-gallery exec vitest --config
    vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts -t tooltip`,
    `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`,
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit`, `pnpm --filter @jiso/ui exec vitest run
    src/index.markup.test.tsx`, `pnpm --filter @jiso/ui exec tsc --noEmit`, and `git diff --check`
    passed.
- [x] **hover-card** [P0 hover + P1 ARIA]: same hover gap; additionally the trigger exposes
      `aria-expanded`/`aria-controls`, but Radix/Base UI do **not** treat a hover card as a disclosure —
      drop them from `hoverCardTriggerAttributes`. Wire the existing `hoverCardContentPointerEnter/Leave`
      so the card is hoverable; add a close-delay grace period.
  - Evidence 2026-06-15: `hoverCardTriggerAttributes` no longer emits `aria-expanded`/`aria-controls`,
    the static hover-card behavior contract and visual fixture were reconciled to that model decision, and
    `examples/gallery/src/interactive/hover-card-demo.tsx` no longer writes those attributes imperatively.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/hover-card-demo.tsx` now calls
    `_hoverCardTriggerPointerEnter`, `_hoverCardTriggerPointerLeave`, `_hoverCardTriggerFocus`,
    `_hoverCardTriggerBlur`, `_hoverCardEscapeKeyDown`, `_hoverCardContentPointerEnter`, and
    `_hoverCardContentPointerLeave`; trigger leave returns a 150ms Promise-delayed close, content
    pointer-enter keeps the card open, and content pointer-leave closes it.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/hover-card-demo.client.js` imports the hover-card
    primitive reducers, mutates only `ctx.state.open`, emits derives for root/trigger/content
    `data-state`, content `hidden`, and output text, and contains no `Reflect`, `document`,
    `getElementById`, `setAttribute`, `showPopover`, or `hidePopover` escape hatches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/hover-card.test.ts`, `pnpm --filter @jiso/headless-ui exec tsc --noEmit`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts src/demo-fixtures.test.ts src/behavior-contracts.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t "hover-card|tooltip"`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.visual.browser.test.ts -t "stable visual baselines"`, `pnpm --filter
    @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs --check`, `pnpm --filter
    @jiso/example-gallery exec tsc --noEmit`, the authored/generated hover-card and tooltip forbidden-DOM
    `rg` scan, and `git diff --check` passed.

### Overlays — native dialog family (open/close work via native `<dialog command>`; gaps are dismissal/state/fallback)

- [x] **dialog** [P1]: no outside/backdrop dismissal (native `showModal()` defaults to
      `closedby='closerequest'`) — shadcn/Base UI dismiss on overlay click; emit `closedby='any'` (or a
      backdrop handler). Root `onKeyDown` closes on **any** key (no Escape guard) — remove it (native
      `cancel` already handles Escape). `data-state` never flips client-side (Phase 1). Add a
      `showModal()`/`requestClose()` JS fallback for browsers without `command`/`commandfor`.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/dialog.ts` now emits `closedby='any'`
    for dismissible dialog content and routes accepted trigger/close clicks through a shared
    `showModal()`/`requestClose()` invoker fallback. `examples/gallery/src/interactive/dialog-demo.tsx`
    removed the unguarded root `onKeyDown`, calls `_dialogTriggerClick`/`_dialogCloseClick`/
    `_dialogCancel`, and binds trigger/content/close `data-state`, trigger `aria-expanded`, dialog
    `open`, and output text from state.
  - Evidence 2026-06-15: generated dialog artifacts import the primitive reducers, emit state derives
    for the dynamic slots, and the authored/generated forbidden-DOM scan for the dialog family found no
    `Reflect`/`getElementById`/`setAttribute`/`document`/`globalThis`/`ctx.params` matches.
  - Verification 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/dialog.test.ts src/primitives/alert-dialog.test.ts`, gallery client/compile tests,
    focused browser `alert dialog|native dialog|sheet and drawer`, gallery emit `--check`, package
    typechecks, and visual baseline browser tests passed.
- [x] **alert-dialog** [P2]: correct `role=alertdialog`/`aria-modal`, correct no-backdrop-dismiss
      (must **not** add `closedby='any'`). Remove the unguarded root `onKeyDown`; add the invoker JS
      fallback; `data-state` stamps via Phase 1.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/alert-dialog.ts` reuses the invoker
    fallback for trigger/cancel/action buttons while `alertDialogContentAttributes` continues to omit
    `closedby`; primitive tests assert both facts. `examples/gallery/src/interactive/alert-dialog-demo.tsx`
    removed the unguarded root `onKeyDown`, calls the alert-dialog reducers, and binds
    `aria-expanded`, `data-state`, `open`, and output through state.
  - Verification 2026-06-15: the browser alert-dialog test asserts `role=alertdialog`,
    `aria-modal=true`, `closedby` absent, focus inside the open dialog, axe-clean open state, cancel,
    native close, and destructive action close.
- [x] **sheet** [P1]: native modal `<dialog>` + side variant (closest to its Radix model), but no
      overlay-click dismissal — emit `closedby='any'`. Remove unguarded `onKeyDown`; `data-side`/
      `data-state` slide animation won't run client-side until Phase 1; optional explicit `aria-modal`.
  - Evidence 2026-06-15: `packages/ui/src/sheet.tsx` passes through `closedby='any'`; the gallery
    sheet demo removed the root `onKeyDown`, routes click/cancel through dialog reducers, and binds
    `data-state`, `aria-expanded`, `open`, and output from state while preserving `data-side='right'`.
  - Verification 2026-06-15: `expectGeneratedSideDialog` asserts `closedby='any'` for sheet/drawer,
    open/close state, side placement, and axe-clean open top-layer state in the focused browser slice.
- [x] **drawer** [P2]: shadcn Drawer is **Vaul** (drag-to-dismiss, snap points, background scale, drag
      handle) — Jiso's drawer is the dialog primitive with a side class (a Sheet, identical render to
      `sheet`). **Decision (locked 2026-06-14): re-scope "drawer" as a directional sheet and document
      that Vaul drag/snap/scale gestures are not modeled.** No drag primitive. Add overlay dismissal
      (`closedby='any'`) + the `showModal()` invoker fallback like the rest of the dialog family, add a
      visible (decorative) handle for affordance, and note the deviation in the gallery copy. Downgraded
      P1→P2.
  - Evidence 2026-06-15: `packages/ui/src/drawer.tsx` passes through `closedby='any'` and renders a
    decorative handle; `examples/gallery/src/interactive/drawer-demo.tsx` mirrors the handle, documents
    the Vaul drag/snap/background-scale deviation in visible copy, removes root `onKeyDown`, and uses
    dialog reducers plus state-bound dynamic slots.
  - Verification 2026-06-15: UI markup/overlay tests cover `closedby='any'` and the drawer handle;
    focused gallery browser tests passed, and visual baseline tests passed with the updated compiled
    route height/hash plus the new static dialog hash.
- [x] **popover** [P2]: best-behaved (native Popover API: open/close, outside light-dismiss, Escape all
      native). Trigger `data-state`/`aria-expanded` styling goes stale (Phase 1); the hand-rolled
      Escape/`<output>` imperative block duplicates `popoverEscapeKeyDown` and is dead under loader #2 —
      rely on native `popover='auto'` + chained primitive instead.
  - Evidence 2026-06-15: `packages/runtime/src/loader.ts` and regenerated
    `packages/runtime/src/inline-loader.ts` now delegate `beforetoggle` (SPEC §4.4), so native
    popover transitions can reach component handlers in both loader paths.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/popover-demo.tsx` removed the imperative
    click/Escape DOM block and now relies on native `popovertarget`/`popover="auto"` for visibility,
    with `_popoverBeforeToggle` as the single state-sync reducer. Root/trigger/content `data-state`,
    trigger `aria-expanded`, and output text are state-bound TSX.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/popover-demo.client.js` imports
    `_popoverBeforeToggle`, mutates only `ctx.state.open`, emits derives for `aria-expanded`,
    `data-state`, and output text, and the authored/generated popover scan found no `Reflect`,
    `document`, `getElementById`, `setAttribute`, `showPopover`, `hidePopover`, `on:click`, or
    `on:keydown` matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run src/index.test.ts
    src/loader.test.ts src/inline-loader-build.test.ts src/inline-loader-delegated.test.ts`,
    `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm --filter @jiso/runtime exec tsc
    --noEmit`, `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/popover.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/demo-fixtures.test.ts
    src/behavior-contracts.test.ts src/interactive-gallery.client-behavior.test.ts
    src/interactive-gallery.compile.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest
    --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts
    -t popover`, `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs
    --check`, `pnpm --filter @jiso/example-gallery exec tsc --noEmit`, and `git diff --check` passed.

### Feedback / display

- [x] **progress** [P2]: renders native `<progress>` instead of `<div role=progressbar>` with a
      transform-translated indicator. **Decision (locked 2026-06-14): keep native `<progress>`, document
      the deviation.** No primitive rewrite — but (a) document that the gallery progress is the native
      element (not the Radix/Base UI `role=progressbar` div, so cross-browser fill styling and the
      `data-progressing/complete` attribute surface are intentionally not provided), and (b) fix the demo
      to derive `data-state`/`aria-valuetext` from the value rather than hardcoding. Downgraded P1→P2.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/progress-demo.tsx` keeps the native
    `<progress>` decision, mutates only `state.value`, and exposes progress `value`, `data-value`,
    `data-state`, `aria-valuetext`, and output text as state-bound TSX attributes.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/progress-demo.client.js` mutates only `ctx.state`,
    emits state derives for progress attributes/text, and
    `rg "Reflect|getElementById|setAttribute|document|globalThis|ctx\\.params"` against the authored
    and generated progress files found no matches.
  - Evidence 2026-06-15: `pnpm --filter @jiso/example-gallery exec vitest run
    src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run
    src/interactive-gallery.interactions-b.browser.test.ts -t "progress|meter"`, and
    `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed.
- [x] **meter** [P2]: renders native `<meter>` instead of Base UI `<div role=meter>` + indicator; demo
      hardcodes the `data-state` region (`value===92?optimum:suboptimum`). **Decision (locked 2026-06-14):
      keep native `<meter>`, document the deviation** (and note Jiso's native high/low/optimum is a
      superset of Base UI's plain gauge). No primitive rewrite — fix the demo to derive `data-state`/
      `aria-valuetext` from `meterValueState` instead of the hardcoded literal. Downgraded P1→P2.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/meter-demo.tsx` keeps the native `<meter>`
    decision, computes qualitative `state.dataState` through `_meterValueState` when `state.value`
    changes, and exposes meter `value`, `data-value`, `data-state`, `aria-valuetext`, and output text
    as state-bound TSX attributes.
  - Evidence 2026-06-15: regenerated
    `examples/gallery/src/generated/interactive/meter-demo.client.js` imports `_meterValueState`,
    mutates only `ctx.state`, emits state derives for meter attributes/text, and the focused
    progress/meter browser and gallery client/compile/typecheck commands listed under `progress`
    passed.
- [x] **scroll-area** [P0]: the custom thumb does **not** track real scrolling — no `on:scroll` handler
      on the viewport (and `scroll` doesn't bubble, so the loader needs direct attachment); thumb has no
      proportional size/transform; no thumb-drag or track-click; no `data-has-overflow-*`/auto-hide.
      Wire `scrollAreaViewportScroll` + add a thumb-geometry helper (size = clientH/scrollH, offset =
      ratio) + drag/track-click handlers (Radix `getThumbSize`/`getThumbOffset` math).
  - Evidence 2026-06-15: the first scroll-area slice added `scroll` to the modular and inline loader
    delegated event sets, added `scrollTop`/`scrollLeft` live-property binding parity, added
    `scrollAreaThumbGeometry`, and rewrote `examples/gallery/src/interactive/scroll-area-demo.tsx` so
    viewport `data-scroll-y`/`scrollTop`, thumb `data-scroll-position`/style, button pressed state/text,
    and output text are state-bound. The generated scroll-area client imports
    `_scrollAreaViewportScroll`/`_scrollAreaThumbGeometry`, mutates only `ctx.state`, and contains no
    DOM escape hatches.
  - Verification 2026-06-15: `pnpm --filter @jiso/runtime exec vitest run
    src/query-bindings.test.ts src/index.test.ts src/inline-loader.test.ts
    src/inline-loader-triggers.test.ts src/loader-query-hydration.test.ts`,
    `pnpm --filter @jiso/runtime run check:inline-loader`, `pnpm --filter @jiso/runtime exec tsc
    --noEmit`, `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/scroll-area.test.ts`,
    `pnpm --filter @jiso/headless-ui exec tsc --noEmit`, `pnpm --filter @jiso/example-gallery exec
    vitest run src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts
    src/interactive-gallery.aria-contracts.test.ts`, `pnpm --filter @jiso/example-gallery exec vitest
    --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts -t
    scroll-area`, `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs
    --check`, `pnpm --filter @jiso/example-gallery exec tsc --noEmit`, and `git diff --check` passed.
  - Evidence 2026-06-15: the second scroll-area slice added `scrollAreaTrackPointerDown`,
    `scrollAreaThumbDragStart`, and `scrollAreaThumbDrag`, delegated `pointerdown`/`pointermove`/
    `pointerup` through the modular and inline loaders, and exposed `data-has-overflow-y`,
    `data-scrolling`, `data-hovering`, and `data-dragging` state bindings in
    `examples/gallery/src/interactive/scroll-area-demo.tsx`. The demo now auto-hides the decorative
    scrollbar/thumb unless overflow is active and the area is hovered, scrolling, or dragging.
  - Evidence 2026-06-15: generated `scroll-area-demo.client.js` imports the new primitive helpers,
    mutates only `ctx.state`, and has no `Reflect`/`document`/`globalThis`/`setAttribute`/
    `ctx.params` escape hatches. Verified by `pnpm --filter @jiso/runtime exec vitest run
    src/index.test.ts src/inline-loader.test.ts src/inline-loader-triggers.test.ts`,
    `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/scroll-area.test.ts`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.client-behavior.test.ts src/interactive-gallery.compile.test.ts src/interactive-gallery.aria-contracts.test.ts`,
    and `pnpm --filter @jiso/example-gallery exec vitest --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts -t scroll-area`.
- [x] **toast** [P1]: a single static always-open toast — not the imperative push/stack/auto-dismiss
      (timeout 5000ms)/swipe/pause-on-hover/F6-viewport model of Base UI/Sonner; Escape-dismiss is dead
      (loader #2); live-region announcement is degraded (content pre-rendered). **Decision (locked
      2026-06-14): build the imperative model** — a "show toast" trigger that pushes into an (initially
      empty) `Toast.Viewport` landmark, with `normalizeToastDuration` auto-dismiss timeout,
      `setToastOpen`/`dismissToast`, pause-on-hover, and F6-into-viewport. May need a primitive/loader
      timer affordance — flag during implementation.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/toast.ts` now exports
    `normalizeToastDuration`, `toastAnimationEnd` (CSS `animationend` timeout affordance), and
    `toastViewportKeyDown` (F6 focus), with primitive tests covering timeout, F6, disabled/canceled
    actions, and public barrel exports.
  - Evidence 2026-06-15: `packages/runtime/src/loader.ts` and regenerated
    `packages/runtime/src/inline-loader.ts` delegate `animationend`, so the toast auto-dismiss timer
    runs through the same SPEC §4.4 event path in modular and inline loaders.
  - Evidence 2026-06-15: `examples/gallery/src/interactive/toast-demo.tsx` now starts with an empty
    viewport, uses a `Show toast` trigger to push the active toast, keeps the previous toast visible as
    a two-item stack, pauses the 5000ms CSS auto-dismiss animation on hover/focus-within, supports
    Escape dismissal and F6 viewport focus through primitive reducers, and binds visibility/state/text
    from island state with no DOM escape hatches. Generated toast artifacts import the primitive
    reducers and emit derives for hidden, `data-state`, description text, output text, and count.
  - Verification 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/toast.test.ts`, runtime event-list tests, `pnpm --filter @jiso/runtime
    check:inline-loader`, headless/runtime/gallery typechecks, gallery client/compile/ARIA tests,
    focused browser toast interaction, full gallery axe browser test, gallery visual baseline test,
    gallery emit `--check`, forbidden-DOM scan, and `git diff --check` passed.

## Phase 4 — Primitive / styled-layer changes called out above (consolidated)

These are framework changes the demo rewrites depend on (not just demo edits):

- [x] `accordion.ts`: add `accordionKeyDown` + roving-`tabindex` helper (parity with `tabs.ts`).
  - Evidence 2026-06-15: closed by the Phase 2 accordion slice above; verified by
    `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/accordion.test.ts` and
    `pnpm --filter @jiso/headless-ui exec tsc --noEmit`.
- [x] `hover-card.ts`: remove `aria-expanded`/`aria-controls` from the trigger (model divergence);
      update `hover-card.test.ts`.
  - Evidence 2026-06-15: `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/hover-card.test.ts`, `pnpm --filter @jiso/headless-ui exec tsc --noEmit`,
    `pnpm --filter @jiso/example-gallery exec vitest run src/interactive-gallery.compile.test.ts
    src/interactive-gallery.client-behavior.test.ts`, `pnpm --filter @jiso/example-gallery exec
    vitest --config vitest.browser.config.ts --run src/interactive-gallery.interactions-b.browser.test.ts
    -t hover-card`, `pnpm --filter @jiso/example-gallery exec node scripts/emit-interactive-gallery.mjs
    --check`, and `pnpm --filter @jiso/example-gallery exec tsc --noEmit` passed; `rg -n
    "aria-expanded|aria-controls"` against the hover-card primitive/demo/generated files found no
    matches.
- [x] `number-field.ts`: add `numberFieldKeyDown`, `largeStep`/`smallStep`; optional hold-repeat + `Intl`.
  - Evidence 2026-06-15: closed by the Phase 3 number-field slice above; verified by
    `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/number-field.test.ts` and
    `pnpm --filter @jiso/headless-ui exec tsc --noEmit`. Hold-repeat and `Intl` formatting remain
    optional future enhancements.
- [x] `slider.ts`: `role=slider` thumb + `aria-valuemin/now/max/valuetext/orientation` + keydown
      (Arrow/Page/Home/End/Shift-large-step) + pointer drag + track-click + `largeStep` (custom-thumb
      chosen; native range dropped as primary).
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/slider.ts` exports the custom thumb,
    keyboard, track-click, thumb-drag, large-step, and hidden-input helpers; verified by
    `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/slider.test.ts` and
    `pnpm --filter @jiso/headless-ui exec tsc --noEmit`.
- [x] `select.ts`: custom button-trigger (`aria-haspopup=listbox`) + `role=listbox`/`role=option` popup
      primitive (reuse `comboboxMove`/`comboboxKeyDown`/`comboboxTypeahead` for keyboard + highlight).
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/select.ts` exports the custom listbox
    attrs and reducers; verified by `pnpm --filter @jiso/headless-ui exec vitest run
    src/primitives/select.test.ts` and `pnpm --filter @jiso/headless-ui exec tsc --noEmit`.
- [x] `scroll-area.ts`: thumb-geometry helper + `data-has-overflow-*`/`data-scrolling`/`data-hovering` +
      thumb-drag/track-click handlers.
  - Evidence 2026-06-15: `packages/headless-ui/src/primitives/scroll-area.ts` exports
    `scrollAreaThumbGeometry`, `scrollAreaTrackPointerDown`, `scrollAreaThumbDragStart`, and
    `scrollAreaThumbDrag`; `scrollAreaDataAttributes` emits overflow/scrolling/hovering data attrs.
    Verified by `pnpm --filter @jiso/headless-ui exec vitest run src/primitives/scroll-area.test.ts`.
- [x] dialog/sheet/drawer: `closedby='any'` for light-dismissable variants (NOT alert-dialog) + a
      `showModal()`/`requestClose()` JS fallback for the `command`/`commandfor` invoker dependency.
  - Evidence 2026-06-15: `packages/headless-ui/src/lib/dialog-invoker.ts` centralizes the DOM-scoped
    invoker fallback using the clicked invoker's `ownerDocument`; dialog primitives call it only after
    a reducer accepts the state transition. `dialogContentAttributes` emits `closedby='any'` by default
    and `closedby='closerequest'` only when `dismissible: false`; alert-dialog content emits no
    `closedby`.
  - Verification 2026-06-15: primitive tests cover fallback `showModal()`/`requestClose()` calls and
    alert no-light-dismiss; gallery browser tests assert `closedby='any'` on dialog/sheet/drawer and
    no `closedby` on alert-dialog.
- [x] toast: imperative push/stack/auto-dismiss demo + viewport landmark; add a timer affordance if the
      primitive/loader lacks one.
  - Evidence 2026-06-15: closed by the toast slice above. The timer affordance is delegated
    `animationend` from a 5000ms CSS animation, which preserves the loader's event/state-binding
    update path instead of mutating state from a detached `setTimeout`.
- [ ] _Not doing (locked):_ `progress.ts`/`meter.ts` stay native `<progress>`/`<meter>` (documented
      deviation, demo-only `data-state` derivation fix); no Vaul drag primitive for `drawer`.

## Phase 5 — Verification (make the contracts regression-proof)

- [ ] **Promote the static-export Playwright harness to a CI gate.** The existing browser tests
      (`examples/gallery/src/interactive-gallery.*.browser.test.ts`) mount the generated server modules
      with their own loader + explicit event list + working module resolution — so they pass while the
      _shipped_ export is dead. Add a test that builds `dist/` via `export-static.mjs`, serves it, and
      drives it (no shim) to assert real interactivity end-to-end (this is what surfaced #1/#2). Seed
      from `scratch/gallery-probe2.mjs`/`probe3.mjs`.
- [ ] **Rewrite the interaction assertions to the model contracts, not the canned paths.** Current
      tests assert the hardcoded demo behavior (e.g. tabs flipping on any key), which is why broken
      keyboard passed. Assert the Base UI/shadcn keyboard map per component (ArrowRight roving, Home/End,
      typeahead, Escape, focus-into-menu, etc.).
- [ ] **Keep axe coverage on the real interactive end-states** (open menu with focus moved, expanded
      accordion via keyboard, etc.) — extend `interactive-gallery.axe.browser.test.ts`.
- [ ] **Primitive unit tests already exist and pass** — they are not the gap; the gap is the demos and
      the framework wiring. Add tests that the demos actually call the primitives (or that the chained
      `on:*` refs are present in emitted HTML).

## Sequencing & ownership

1. **Phase 0** (3 infra items) is the unlock — without it the gallery is dead regardless of component
   logic. Land first; re-run the Playwright harness to confirm click-driven components come alive.
2. **Phase 1** (state→DOM reactivity) is the highest-leverage framework change: it fixes
   switch/toggle/disclosure outright and lets every other demo be authored declaratively instead of
   hand-rolling imperative DOM. Largest/riskiest (compiler + loader + SPEC §4.8/§4.9).
3. **Phase 2** then the **Phase 3** per-component rewrites can fan out by family (menus, typeahead,
   selection-controls, expandables, inputs, overlays, feedback) — each is a coherent, mostly-independent
   slice suitable for delegation, pulling in the Phase 4 primitive changes it needs.
4. **Phase 5** lands alongside each family so fixes can't regress.

## Decisions (locked 2026-06-14)

- **Scope: framework changes are in scope.** Phases 0/1/2/4 may change `@jiso/server`,
  `@jiso/compiler`, `@jiso/runtime`, and `@jiso/headless-ui`, not just `examples/gallery`. Re-verify
  the docs site + `examples/reference` for any framework-wide emit/loader change.
- **State→DOM reactivity: do the framework fix (Phase 1), not per-demo hand-patches.** Implement the
  §4.8 update plan for island-local state so demos can be authored declaratively. (If Phase 1 must be
  staged later, individual Phase 3 items fall back to hand-authored stamps and must say so.)
- **Parity bar — split native vs custom:**
  - **select → custom** `role=listbox` popup (shadcn parity).
  - **slider → custom** `role=slider` thumb (Base UI/shadcn parity); native range dropped as primary.
  - **progress → keep native `<progress>`**, document the deviation (no `role=progressbar` div).
  - **meter → keep native `<meter>`**, document the deviation (superset of Base UI's gauge).
- **drawer → re-scope as a directional sheet**; document that Vaul drag/snap/scale gestures are not
  modeled (no drag primitive).
- **toast → build the imperative push/stack/auto-dismiss model** (not a static single notification).

## Risks

- Phase 1 touches the compiler's update-plan/coverage passes and the 4KB-budget inline loader — high
  blast radius across every island, not just the gallery; needs the fixpoint/IR gates (Constitution
  #3) and the gzip-budget parity tests to stay green.
- Phase 0's runtime-specifier fix changes emitted client modules framework-wide (docs site + every
  static export), so re-verify `examples/reference` and the docs site, not only the gallery.
- The native-invoker overlays depend on `command`/`commandfor` (Baseline 2025); the JS fallback must
  not double-fire with the native invoker.

## Artifacts / evidence

- `scratch/fix-ui-evidence.md` — hands-on Playwright evidence + infra root-cause writeup.
- `scratch/family-detail.txt` — full per-component audit (contracts, gaps, root cause, layer, fix) for
  all 35 components, doc-grounded against Base UI + shadcn.
- `scratch/gallery-drive.mjs`, `gallery-probe2.mjs`, `gallery-probe3.mjs` — the Playwright drivers
  (seed for the Phase 5 CI gate).
