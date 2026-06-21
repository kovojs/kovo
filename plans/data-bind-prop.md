# `data-bind-prop:*` — reactive live-property binding

**Goal:** Add a reactive binding that sets a live DOM **property** (not just an attribute), so
components can reactively drive `.checked`, `.indeterminate`, `.value`, `.scrollTop`/`.scrollLeft`,
etc. Today `data-bind:*` is **attribute-only**, which is correct for most cases but silently wrong for
the handful of attributes whose authoritative state lives on the element **property** after user
interaction. This unblocks the deferred items from `plans/more-ui-primitives.md` (checkbox-group
styled select-all **C**) and `plans/better-components-ux.md` (scroll-area imperative scroll, checkbox
indeterminate) and removes a whole class of "the attribute updated but nothing happened" bugs.

**Status (2026-06-20):** Implemented on `agent/primitives-infra`. Runtime (both loaders) + compiler
emission + consumer migration (styled select-all Checkbox, checkbox/switch indeterminate, scroll-area
`.scrollTop`) all landed behind the closed allowlist; SPEC §4.8 documented. Phases 0–4 complete (see
checklist). Open follow-up: retiring the `applyCheckboxIndeterminate` axe shim is deferred (lives in
out-of-scope `@kovojs/headless-ui` + gallery fixtures).

**Behavior source of truth:** `SPEC.md` (§4.6 chained client handlers; §5.2 #3 render-equivalence
gate — server render and loader must agree; §6.2 binding grammar; security/unsafe-sink rules around
**KV236**), `rules/compiler-hard-rules.md`, `rules/api-surface.md`, `rules/accessibility-conformance.md`.
Mark `- [x]` only when this session verifies the cited test for the exact item.

---

## Background — why `data-bind:*` can't do this

The loader applies reactive bindings and morph patches via `setAttribute`/`removeAttribute`:

- The inline loader `inlineKovoLoaderInstallerSource` (`packages/browser/src/inline-loader.ts`) morphs
  with `xa(cur, next)` / `xd(...)` which only `setAttribute`/`removeAttribute`.
- The client loader (`@kovojs/browser/client` `installKovoLoader`) and `query-bindings.ts` apply
  derive results the same attribute-only way.

For most attributes that's correct (attribute === rendered state). But several DOM attributes are
**property-authoritative** — the browser stops reflecting attribute changes onto the property once the
property is "dirty" (touched by the user or script):

| Attribute                | Why attribute-only is wrong                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checked`                | After interaction, `.checked` ignores the `checked` attribute. `FormData` reads `.checked`. (This is exactly the checkbox-group select-all **C** regression.) |
| `indeterminate`          | Not an HTML attribute at all — property-only; the `applyCheckboxIndeterminate` test shim exists only because the binding can't set it.                        |
| `value` (inputs)         | `.value` decouples from the `value` attribute after typing.                                                                                                   |
| `scrollTop`/`scrollLeft` | Not attributes; `data-bind:scrolltop` is a no-op (the scroll-area "Jump to end" workaround had to imperatively set `.scrollTop`).                             |
| `selected`, `open`       | Same dirty-property semantics.                                                                                                                                |

The current escape hatches are per-component imperative client actions (`scrollAreaScrollTo`) or test
shims (`applyCheckboxIndeterminate`) — neither composes. One reactive primitive fixes all of them.

---

## Design

A new binding kind **`data-bind-prop:<prop>="/c/…client.js#<derive>"`** that the loader applies by
**assigning the element property**, complementing (not replacing) the SSR attribute.

1. **Authoring surface — allowlist-driven, automatic.** Keep authoring unchanged: a component still
   writes `checked={…}` / `value={…}` / `scrollTop={…}`. The compiler, for a fixed **allowlist of
   property-authoritative attributes**, emits _both_ the SSR attribute (initial paint) _and_ a
   `data-bind-prop:<prop>` derive (client property). Proposed allowlist (closed, security-reviewed):
   `checked`, `indeterminate`, `value` (form controls), `scrollTop`, `scrollLeft`, `selected`, `open`.
   No arbitrary properties — explicitly **not** `innerHTML`/`outerHTML`/`srcdoc`/`on*` (KV236 unsafe
   sinks stay forbidden).
2. **Runtime — assign the property with coercion.** Both loaders recognize `data-bind-prop:<prop>` and,
   on hydration **and after every morph/derive re-render**, assign `el[prop] = coerce(prop, value)`:
   boolean for `checked`/`indeterminate`/`selected`/`open`, number for `scrollTop`/`scrollLeft`, string
   for `value`. Re-apply must run **after** `xa`/`xd` (morph patches attributes first, then properties
   are set).
3. **SSR parity / render-equivalence (§5.2 #3).** SSR emits the attribute as today (so first paint and
   no-JS are correct); the client additionally owns the property. The render-equivalence gate must
   treat `data-bind-prop:*` as a non-attribute output so server/loader stay byte-identical on the
   attribute and agree on the property.
4. **Security.** Strict property allowlist + per-property coercion; values are still contextually
   encoded (the `value` string write is escaped). No path to an unsafe sink — keep the KV236 wall.

---

## Plan

### Phase 0 — Investigation (pinpoint the exact seams)

- [x] Compiler: `attr={expr}` lowers to `data-bind:<attr>` in two seams — `lower/inline-derives.ts`
      (source-replacement) and `lower/structural-jsx.ts` `lowerInlineAttributeDerivesInIr` (the IR
      path actually used for raw elements) + the primitive-reactive pass `lowerPrimitiveReactiveAttributes`
      (forwarded `@kovojs/ui` control props). Derive URL versioning lives in `compile.ts`.
- [x] Runtime: inline loader source-of-truth is `inline-loader-build.ts` readable bootstrap (`ba`/`wa`/
      `as`; `inline-loader.ts` is GENERATED). Client loader chokepoints: `handlers.ts` →
      `query-bindings.ts` `applyStateBindings`→`applyRootBindings`/`applyStateDeriveBindings` (state),
      `applyCompiledQueryUpdatePlan` (query); morph copies attrs only, re-apply rides these chokepoints.
- [x] Render-equivalence: §5.2 #3 gate skips generated-only stamps via `isGeneratedOnlyRenderAttribute`
      (`emit/server.ts`); `data-bind-prop:*` added there as a non-attribute output.

### Phase 1 — Runtime: apply `data-bind-prop:*` (behind the allowlist)

- [x] Inline + client loaders recognize `data-bind-prop:<prop>`, assign `el[prop]` with per-property
      coercion after the attribute pass; non-allowlisted props ignored (KV236 wall). Shared allowlist +
      coercion in `packages/browser/src/bind-prop.ts`; client in `query-bindings.ts` (state-path,
      state-derive, item-relative); inline in `inline-loader-build.ts` (`bp`/`wp`/`wpd`, regenerated,
      7305/8192 gzip bytes — `check:inline-loader` green).
- [x] Browser tests: `bind-prop.test.ts` (allowlist + coercion + `<progress>.value` carve-out + KV236),
      `query-bindings.test.ts` (state checked/indeterminate/scrollTop across re-renders + KV236 guard),
      `inline-loader-delegated.test.ts` (inline-source parity for checked/indeterminate/scrollTop).
      `FormData.checked` correctness proven via the gallery checkbox-group browser test (Phase 3).

### Phase 2 — Compiler: emit `data-bind-prop:*` for allowlisted attrs

- [x] Emit the SSR attribute + `data-bind:<attr>` + `data-bind-prop:<prop>` for the allowlist
      [checked, indeterminate, value, scrollTop, scrollLeft, selected, open]; other attrs stay
      `data-bind:*` only. Allowlist in `compiler/src/shared.ts`; emission in `lower/structural-jsx.ts`
      (inline-derive IR path + primitive pass, incl. a property-only `data-bind-prop:indeterminate`
      derive for tri-state checkboxes) + `lower/inline-derives.ts`; URL-versioned in `compile.ts`.
- [x] `bind-prop-emission.test.ts` (allowlist gating, property-only indeterminate, fixpoint stable);
      full compiler suite (575) + `render-equivalence-boundary.test.ts` green; `check:inline-loader` OK.

### Phase 3 — Migrate consumers (cash the unblocks)

- [x] Restored the styled select-all `Checkbox` in `checkbox-group-demo.tsx` (closes **C**).
      `interactions-a.browser.test.ts` "updates checkbox-group ARIA…" asserts `all.checked` /
      `all.indeterminate` + `FormData.getAll('gallery-notifications')` across select-all
      on/off/indeterminate, then axe-clean — passes (16/16). Required a `pass-through.ts` `bindings:false`
      fix so the wrapper `<label>` no longer forwards input-only `data-bind:aria-checked`/`checked`
      (axe `aria-allowed-attr` on a roleless label).
- [x] checkbox/switch `indeterminate` via the primitive `data-bind-prop:indeterminate` derive.
      `applyCheckboxIndeterminate` axe shim NOT retired — it lives in `@kovojs/headless-ui` +
      `interactive-gallery.browser-fixtures.ts` (out of this slice's scope); left as-is (see Risks).
- [x] scroll-area: `scrollTop={state.scrollTop}` now emits `data-bind-prop:scrolltop` (reactive
      `.scrollTop`); kept imperative `scrollAreaScrollTo` for the event-driven jump.
      `interactions-b.browser.test.ts` passes (17/17, incl. scroll-area + progress carve-out).

### Phase 4 — Docs + surface

- [x] SPEC §4.8 addendum for `data-bind-prop:<prop>` (allowlist + coercion + render-equivalence + KV236
      security rationale). No new PUBLIC exports (`bind-prop.ts` is internal, not in `client.ts`/barrels;
      api-surface gate count unchanged 1338); no new diagnostic, so `rules/compiler-hard-rules.md`
      untouched.

---

## Verification protocol

- Runtime: browser tests through the real loader (property updates + `FormData` correctness across
  morphs). Compiler: emission unit tests + the §5.2 render-equivalence gate. Integration:
  `pnpm exec vp check`, `npx vitest run`, gallery `test:browser`, `check:api-surface`,
  `check:inline-loader` (loader size budget).
- If a fix conflicts with `SPEC.md`, follow SPEC and record it.

## Risks & non-goals

- **Risk:** core compiler + runtime change with wide blast radius; the inline loader is a hand-tuned
  size-budgeted string — keep the addition minimal. Render-equivalence drift is **KV222**; the
  property write must not change attribute output.
- **Non-goals:** arbitrary/author-specified property binding (allowlist only), two-way binding, and any
  unsafe sink (`innerHTML`/`on*` stay forbidden — KV236).
