# Security Remediation — C1: Default HTML Output Encoding

**Date:** 2026-06-15
**Finding:** `SECURITY_FINDINGS.md` **C1 (Critical)** — _No default HTML output encoding: text interpolations are emitted unescaped at every layer (systemic stored/reflected XSS)._
**Status:** Remediated. Verified green on `check` (typecheck + lint + format), the full unit suite (2479 tests), `check:build`, `check:inline-loader`, `prod-emit-check`, and the fixpoint (`check:fw`).

This document covers C1 in depth. The complementary reactive-DOM XSS sinks identified by the same root-cause analysis — **H1** (compiled reactive list-stamp `innerHTML`) and **H2** (reactive attribute binding to URL attributes) — are part of the same output-encoding story and are summarized in §7. The remaining findings (H3–H5, M1–M10) are listed in the appendix.

---

## 1. The vulnerability

The Jiso server JSX runtime renders component trees to HTML strings. `renderJsxChildren` (`packages/server/src/jsx-runtime.ts`) inserted text children **verbatim** (`String(children)`); only _attributes_ were escaped. The compiler — the framework's lowering/validation layer — never injected escaping for text interpolations either. So any app-authored `{data.field}` rendered as JSX text, and any `@jiso/ui` scalar text prop (`title`, `description`, option `itemLabel`/`itemValue`, …), reached the browser unescaped:

- in the **initial SSR document** the browser parses on load, and
- in **fragment updates** re-injected via `innerHTML` / `insertAdjacentHTML` / morph (`packages/runtime/src/{response-fragment-apply,morph}.ts`), which execute `<img src=x onerror=…>` / `<svg onload=…>`.

There was **no escape hatch and no diagnostic**, so this was the framework default. It was proven end-to-end in the stackoverflow reference app (`postAnswer` body → `answers.body` → `{answer.body}`).

---

## 2. Approach: compiler + library escaping (contract-preserving)

The report's first-choice fix was to make `renderJsxChildren` escape by default and return a branded `RawHtml` value for composed output. We **rejected** that for this change because it is destabilizing: `jsx()` returning a primitive `string` is a load-bearing contract — **177 assertions across ~50 files** do `jsx(...).toBe('<html>')`, and dozens of server consumers concatenate component output as `string`. Branding the return value ripples across the entire repo and its tests.

Crucially, the framework also enforces a **render-equivalence fixpoint** (`renderEquivalenceSourceCheck`, `packages/compiler/src/compile.ts`): the lowered server source must render identically to the authored source (modulo framework stamps). Escaping must therefore be applied in a place where authored and lowered stay equivalent.

The chosen approach satisfies both constraints and is **safe-by-default for the framework's actual authoring model** (all app components are compiled):

1. **The compiler escapes static data-path text interpolations** during lowering — `{product.name}` → `{escapeText(product.name)}`. App authors are safe by default with no source change.
2. **`@jiso/ui` library components escape their own scalar text props** — these bypass the compiler (the app passes them in attribute position, e.g. `itemLabel={user.name}`), so the component must escape what it renders as a text child.
3. **`table.tsx`** routes its hand-rolled `tablePart` concat through escaping.

The runtime contract (`jsx()` → `string`) is unchanged; zero test-assertion churn from the contract.

---

## 3. Implementation

### 3.1 `escapeText` helper — `packages/server/src/html.ts`

```ts
export function escapeText(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map((item) => escapeText(item)).join('');
  return escapeHtml(String(value));
}
```

It **mirrors `renderJsxChildren`'s coercion exactly** — `null`/`undefined`/`boolean` → `''`, arrays flatten, everything else `String(...)` — then HTML-escapes scalar values. This guarantees byte-identical output to the unescaped path for values without HTML metacharacters (so it does not change render-equivalence semantics or existing snapshots), while neutralizing `& < >` for attacker/DB strings. Exported from `@jiso/server` via `packages/server/src/api/rendering.ts`.

### 3.2 Compiler lowering — `packages/compiler/src/lower/inline-derives.ts`

`escapeStaticTextInterpolations(model, replacements, boundElementStarts)` wraps each JSX **child** expression container `{expr}` → `{escapeText(expr)}`, under tight safety filters:

| Filter                                                                                           | Why                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only expressions with `solePropertyAccessPath` defined (`a.b`, `a.b.c`)                          | Never touches nested JSX elements, `.map()`, ternaries, or calls — those have no `solePropertyAccessPath`, so they can't be corrupted. Covers the dominant sink (`{item.productId}`, `{question.body}`). |
| Skip elements in `boundElementStarts` or with a hand-written `data-bind`/`data-derive` attribute | Reactive-bound elements are owned by the data-bind mechanism (client updates via `textContent`, which is safe); leaving them avoids interfering with bindings and lint diagnostics.                      |
| Skip containers overlapping an existing binding/derive replacement                               | Mixed-text reactive sub-expressions are wrapped in `<span data-bind>` by the existing pass; the static siblings in the same element still escape.                                                        |
| Iterate `element.childExpressionContainers` (not attribute expressions)                          | Attribute values are already escaped by the runtime; never double-handle them.                                                                                                                           |

The `escapeText` import is added via the same prefix-insertion mechanism as the existing `derive` import, gated on whether escaping was applied and on the **typed** `model.namedImports` facts (not a raw-source scan) to avoid a duplicate-binding `SyntaxError` if an author imported `escapeText` manually.

### 3.3 `@jiso/ui` scalar text props

Library components escape the data-derived scalar props they render as children, leaving `{props.children}` composition slots raw (those are escaped at the app call site by the compiler). Pattern: `{props.children ?? escapeHtml(props.itemLabel ?? props.itemValue ?? '')}` and `{escapeHtml(valueTextHelper(props))}`. Applied to `autocomplete`, `combobox`, `command`, `select`, `menubar`, `drawer`, `sheet`, `navigation-menu`, and `table` (caption). `dialog.tsx` and `field.tsx` needed no change — they only render `{props.children}` slots, which the app-site compiler escaping covers.

---

## 4. Safety properties (why the fixpoint stays green)

- **Render-equivalence holds.** The escaping is added in `lowerInlineAttributeDerives`, whose output is the _common base_ (`modelPatch.state.source`) that both the equivalence "expected" (authored-lowered) and "actual" (server-stamped) sides derive from. Both sides carry the `escapeText` wraps, so they remain equal modulo framework stamps — no normalization change was required.
- **Fixpoint idempotency holds.** Recompiling a generated module must reproduce it. `escapeText(item.x)` is a **call expression**, so it has no `solePropertyAccessPath` and is never re-wrapped; and because no new wraps are applied on recompile, the `escapeText` import is not re-added. This is structural, not a `startsWith` guard.
- **SPEC §5.2 parser boundary respected.** Idempotency and import-detection use typed parser facts (`solePropertyAccessPath`, `model.namedImports`), never raw-source `startsWith`/regex `.test()` — the framework's `tests/fw-check.node.mjs` meta-lint enforces this and is green.

---

## 5. Coverage and residual gaps

**Covered (safe-by-default):**

- App-authored `{obj.field}` text children (sole and mixed position) in any compiled component — escaped by the compiler.
- All `@jiso/ui` scalar text props and table cells/caption — escaped by the library / app-site compiler escaping.
- Initial SSR render _and_ fragment-update render (both go through the same escaped lowered output).

**Residual (documented, lower-severity):**

- **Bare-identifier (`{name}`) and call-expression (`{format(x)}`) text children** are not auto-escaped (they have no `solePropertyAccessPath`; a bare identifier could legitimately be a nested element, so escaping it blindly is unsafe). The flagged real sinks are all property-access paths; authors rendering a bare string identifier should use `escapeText`/`escapeHtml`. _Recommended follow-up: a compiler diagnostic nudging authors on un-escaped non-property-path string text children._
- **Reactive-bound values' initial paint.** A query/state value bound via `data-bind` renders its initial value through the binding span and is updated client-side via `textContent` (safe post-hydration). The initial SSR value of a _bound_ expression is not escaped by this pass; bound values are typically controlled (counts/flags). _Follow-up: escape inside the synthesized `data-bind` span emission._
- **Route `page()` handlers returning raw template strings** (e.g. `account:${session.user.email}`) are outside JSX and not compiler-escaped — authors must `escapeHtml` there (this was a separate low-rated finding).

---

## 6. Verification

- **New regression tests:** `packages/compiler/src/text-escaping.test.ts` (static data-path escaped end-to-end; nested elements/calls/attributes untouched; fixpoint idempotency) and `packages/ui/src/xss-escaping.test.tsx` (every scalar text prop escapes an `<img onerror>` payload; `children` slots pass through). Updated diagnostic-expectation tests (`fragment-targets`, `fw-check.node.mjs`) reflect the escaped lowered artifact.
- **Regenerated committed artifacts:** `examples/commerce/src/generated/*` and `site/tutorial/steps/*/src/generated/*` now show `escapeText(...)` (e.g. `order-history.tsx`: `{escapeText(item.productId)} x {escapeText(item.qty)} - {escapeText(item.total)}`).
- **Gates green:** `pnpm run check` (0 errors), `pnpm run test` (2479 passed), `pnpm run check:build`, `pnpm run check:inline-loader`, `prod-emit-check`, `pnpm run check:fw` (fixpoint + render-equivalence).

---

## 7. Complementary reactive-DOM encoding fixes (H1, H2)

The C1 analysis identified two further default-on XSS sinks on the _client_ codegen path; both were fixed alongside C1:

- **H1 — reactive list-stamp (`packages/compiler/src/emit/client.ts`).** The compiled `render(item)` built an HTML string assigned via `innerHTML` from `String(read(...))` with no escaping. Now each value placeholder is wrapped in an inline `esc(...)` (escapes `& < > "`, covering both text and double-quoted-attribute positions in the stamp).
- **H2 — reactive attribute binding (`packages/runtime/src/query-bindings.ts`).** `setBoundAttribute` applied live query/state values to attributes via raw `setAttribute`. For URL-bearing attributes (`href`, `src`, `formaction`, `srcdoc`, …) it now neutralizes non-allowlisted schemes (`javascript:`/`data:`/`vbscript:`, including control-char obfuscation) to `#`.

---

## 8. Files changed (C1 + H1 + H2)

- `packages/server/src/html.ts` — `escapeText` helper.
- `packages/server/src/api/rendering.ts` — export `escapeText`.
- `packages/compiler/src/lower/inline-derives.ts` — `escapeStaticTextInterpolations` lowering + typed-fact import.
- `packages/compiler/src/emit/client.ts` — H1 list-stamp `esc(...)`.
- `packages/runtime/src/query-bindings.ts` — H2 URL-scheme guard in `setBoundAttribute`.
- `packages/ui/src/{autocomplete,combobox,command,select,menubar,drawer,sheet,table,navigation-menu}.tsx` — scalar text-prop escaping.
- Tests: `packages/compiler/src/text-escaping.test.ts`, `packages/ui/src/xss-escaping.test.tsx`, plus expectation updates in `fragment-targets.test.ts`, `state-bindings.test.ts`, `query-coverage.test.ts`, `query-bindings.test.ts`, `tests/fw-check.node.mjs`.
- Regenerated: `examples/commerce/src/generated/*`, `site/tutorial/steps/*/src/generated/*`.

---

## 9. Recommended follow-ups

1. Add a **compiler diagnostic** for un-escaped non-property-path string text children (bare identifiers, string-returning calls), so the residual gaps surface to authors at compile time.
2. Escape the **initial SSR value inside synthesized `data-bind` spans** to close the reactive-bound initial-paint residual.
3. Revisit the **runtime `RawHtml` brand** as a longer-term hardening so even hand-authored (non-compiled) server components are safe by default; track the `jsx()`-return-contract migration separately.
4. Define **JSX text-escaping semantics in `SPEC.md §4`** to make the safe default normative.

---

## Appendix — other findings remediated this change

| Finding                                                             | Fix location                                                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H3** — `@jiso/ui` anchor `href` scheme injection                  | `packages/headless-ui/src/lib/safe-url.ts` (new allowlist helper) routed through `breadcrumb`/`hover-card`/`navigation-menu` + `navigationMenuLinkAttributes`. |
| **H4** — `redirectPath` backslash open-redirect                     | `packages/better-auth/src/index.ts` — reject backslash-authority + control chars.                                                                              |
| **H5** — `normalizePathname` `//` open-redirect                     | `packages/server/src/match.ts` — collapse leading authority slashes.                                                                                           |
| **M1** — missing `nosniff` on file/stream                           | `packages/server/src/response.ts`.                                                                                                                             |
| **M2** — auth success-by-absence                                    | `packages/better-auth/src/index.ts` — positive 2xx + session-cookie + non-2FA check.                                                                           |
| **M3** — shared `anonymous` rate-limit bucket                       | `packages/server/src/guards.ts` — throw when session-less keying lacks a `key`.                                                                                |
| **M4** — idempotency reserve-after-handler                          | `packages/server/src/{mutation,replay}.ts` — reserve before run + per-mutation-key scope.                                                                      |
| **M5** — hardcoded scaffolder CSRF secret                           | `packages/create-jiso/{src/index.ts,templates/src/auth.tsx}` — env-read + generated `.env` random secret.                                                      |
| **M6** — static login-CSRF token                                    | `examples/commerce/src/{app.ts,app-shell.ts}` — Origin/Sec-Fetch-Site same-origin guard.                                                                       |
| **M7** — no sign-in brute-force throttle                            | commerce + create-jiso template `guards.rateLimit`.                                                                                                            |
| **M8** — unscoped receipt storage key                               | `examples/commerce/src/app.ts` — `receipts/${uuid}/${sanitized}` namespacing.                                                                                  |
| **M9** — webhook write trust + CSV injection + unscoped order query | `examples/commerce/src/{app.ts,queries.ts}` — secret from env, productId/userId validation, formula-prefix neutralization, per-user scoping.                   |
| **M10** — inline-loader selector injection                          | `packages/runtime/src/inline-loader-build.ts` — try/catch guard around fragment-target `querySelector`.                                                        |
