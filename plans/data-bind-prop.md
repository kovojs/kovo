# `data-bind-prop:*` — reactive live-property binding

**Goal:** Add a reactive binding that sets a live DOM **property** (not just an attribute), so
components can reactively drive `.checked`, `.indeterminate`, `.value`, `.scrollTop`/`.scrollLeft`,
etc. Today `data-bind:*` is **attribute-only**, which is correct for most cases but silently wrong for
the handful of attributes whose authoritative state lives on the element **property** after user
interaction. This unblocks the deferred items from `plans/more-ui-primitives.md` (checkbox-group
styled select-all **C**) and `plans/better-components-ux.md` (scroll-area imperative scroll, checkbox
indeterminate) and removes a whole class of "the attribute updated but nothing happened" bugs.

**Status (2026-06-20):** Planning. Framework feature (compiler + runtime). High leverage, high blast
radius — sequence runtime-first behind an allowlist, then compiler emission, then migrate consumers.

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

| Attribute   | Why attribute-only is wrong                                                       |
| ----------- | -------------------------------------------------------------------------------- |
| `checked`   | After interaction, `.checked` ignores the `checked` attribute. `FormData` reads `.checked`. (This is exactly the checkbox-group select-all **C** regression.) |
| `indeterminate` | Not an HTML attribute at all — property-only; the `applyCheckboxIndeterminate` test shim exists only because the binding can't set it. |
| `value` (inputs) | `.value` decouples from the `value` attribute after typing. |
| `scrollTop`/`scrollLeft` | Not attributes; `data-bind:scrolltop` is a no-op (the scroll-area "Jump to end" workaround had to imperatively set `.scrollTop`). |
| `selected`, `open` | Same dirty-property semantics. |

The current escape hatches are per-component imperative client actions (`scrollAreaScrollTo`) or test
shims (`applyCheckboxIndeterminate`) — neither composes. One reactive primitive fixes all of them.

---

## Design

A new binding kind **`data-bind-prop:<prop>="/c/…client.js#<derive>"`** that the loader applies by
**assigning the element property**, complementing (not replacing) the SSR attribute.

1. **Authoring surface — allowlist-driven, automatic.** Keep authoring unchanged: a component still
   writes `checked={…}` / `value={…}` / `scrollTop={…}`. The compiler, for a fixed **allowlist of
   property-authoritative attributes**, emits *both* the SSR attribute (initial paint) *and* a
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

- [ ] Compiler: find where `attr={expr}` lowers to `data-bind:<attr>` (`packages/compiler/src/emit/*`)
      and where the binding-kind/derive table lives — the emission site for the new kind.
- [ ] Runtime: map both apply paths — inline loader `xa`/`xd` (`inline-loader.ts`) and the client
      loader (`@kovojs/browser/client`, `query-bindings.ts`, `handler-context.ts`) — and the post-morph
      hook where property re-application must run.
- [ ] Render-equivalence: how the §5.2 #3 gate compares server vs loader output, to thread the
      attribute-only comparison + the new property output.

### Phase 1 — Runtime: apply `data-bind-prop:*` (behind the allowlist)

- [ ] Inline + client loaders recognize `data-bind-prop:<prop>`, assign `el[prop]` with per-property
      coercion, on hydration and after morph; ignore non-allowlisted props defensively.
- [ ] Browser tests: a fixture element with `data-bind-prop:checked`/`indeterminate`/`scrollTop` whose
      derive flips with state → assert the live property updates across re-renders and `FormData`
      reflects `.checked`.

### Phase 2 — Compiler: emit `data-bind-prop:*` for allowlisted attrs

- [ ] Emit both the SSR attribute and `data-bind-prop:<prop>` derive when a reactive value targets an
      allowlisted property-authoritative attribute; keep all other attrs on `data-bind:*`.
- [ ] Compiler unit tests (emission shape) + render-equivalence gate green + the inline-loader size
      budget check (`check:inline-loader`).

### Phase 3 — Migrate consumers (cash the unblocks)

- [ ] checkbox-group items + restore the styled select-all `Checkbox` (closes **C**); gallery browser
      test toggles select-all on/off and asserts `FormData.getAll(...)` across all transitions + axe.
- [ ] checkbox/switch `indeterminate` via the binding (retire the `applyCheckboxIndeterminate` shim
      where possible).
- [ ] scroll-area: bind `.scrollTop` reactively (optionally retire the imperative `scrollAreaScrollTo`,
      or keep it for the event-driven case); confirm the browser test still scrolls.

### Phase 4 — Docs + surface

- [ ] SPEC §6.2 note for `data-bind-prop:*` + the allowlist + security rationale; `api-surface` for any
      new exports; `rules/compiler-hard-rules.md` if a new diagnostic is added.

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
