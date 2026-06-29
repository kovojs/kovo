# Papercuts 16

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
framework papercuts found while dogfooding fresh local sqlite `create-kovo`
apps across style/forms, state islands, uploads, endpoints/webhooks, and
data/optimistic mutation flows.

## Scope

- Apps: `/Users/mini/kovo-dogfood-exhaustive-20260629/t1-style-form`,
  `t2-islands-live`, `t3-file-upload`, `t4-endpoints-webhooks`, and
  `t5-data-optimistic`, all scaffolded from local Kovo packages with
  `--sqlite --disable-git` and link-local installs.
- Gates exercised: scaffold/link/install; `pnpm run check`, `pnpm run test`,
  `pnpm exec tsc --noEmit`, `pnpm run build:prod`, dev HTTP smokes, signed
  endpoint/webhook smokes, multipart upload POST, and enhanced mutation
  response inspection where relevant.
- No security/soundness defect was confirmed in this sweep; no `bugz-16.md`
  was created.

## Issues

### A. Stateful island authoring is blocked at the public type and shape gates

- [ ] **A1 — `component({ state })` rejects ordinary JSON state in a generated app, and the `satisfies JsonValue` workaround hides state keys from KV302.** (high, framework; found by `t2-islands-live`)
  - Observed behavior: `state: () => ({ open: false })` fails `tsc`/`vp check` with `TS2322: Type '() => { open: boolean; }' is not assignable to type 'never'`. Changing it to `state: () => ({ open: false }) satisfies JsonValue` still fails typecheck and also makes `build:prod` emit `KV302 ... state.open` when a state binding is present.
  - Root cause: `packages/core/src/index.ts:187-198` intersects inferred definitions with the recursive `Serializable<State>` conditional and collapses normal JSON state to `never` in app typechecking. Separately, `packages/compiler/src/scan/parse.ts:2185-2195` only records direct object-literal arrow bodies; a `SatisfiesExpression` is missed, so `packages/compiler/src/validate/bindings.ts:188-200` sees no `state.open` key.
  - Why it matters: SPEC §4.1/§4.8 present JSON island state as the normal L1 authoring path. The current public surface blocks a basic boolean state island before runtime.
  - Repro evidence: `cd /Users/mini/kovo-dogfood-exhaustive-20260629/t2-islands-live && pnpm exec tsc --noEmit` fails with TS2322; `pnpm run build:prod` also emits KV302 for `state.open` with the `satisfies JsonValue` form.
  - Acceptance: core type tests prove inline, `satisfies JsonValue`, and annotated JSON state compile while Date/Map/function state still fail; compiler tests prove wrapped state return object literals still expose state keys to KV302 validation.

### B. Upload authoring misses a standard file input hint

- [ ] **B1 — JSX `HtmlAttributes` lacks the native `accept` attribute, so typed Kovo TSX rejects `<input type="file" accept="...">`.** (low, framework; found by `t3-file-upload`)
  - Observed behavior: an upload form using `s.file().accept(['application/pdf']).store(...)` passes once rendered without the client hint, but adding the standard browser hint `<input type="file" accept="application/pdf" ...>` fails `tsc` with `Property 'accept' does not exist on type 'HtmlAttributes'`.
  - Root cause: `packages/server/src/jsx-runtime.ts:810-850` enumerates intrinsic `HtmlAttributes` and includes `acceptCharset`, but not `accept`; the server schema's file allowlist exists separately at `packages/server/src/schema.ts:323-342`.
  - Why it matters: server sniffing remains the security boundary, but app authors cannot provide the normal file-picker UX hint in strict Kovo TSX.
  - Repro evidence: `cd /Users/mini/kovo-dogfood-exhaustive-20260629/t3-file-upload && pnpm exec tsc --noEmit --pretty false` fails with TS2322 after adding `accept="application/pdf"`; removing only `accept` makes the same command pass. The actual multipart storage path posts successfully with HTTP 303 after the mutation is registered.
  - Acceptance: `accept?: AttributeValue` is part of Kovo JSX `HtmlAttributes`, with a type test proving `<input type="file" accept="application/pdf" name="receipt" />` compiles; existing file schema accept tests remain green.

### C. A fixed Drizzle output-schema binding path regressed

- [ ] **C1 — `build:prod` again rejects direct bindings to Drizzle query `output` computed fields, reopening super-5 A1.** (high, framework; found by `t5-data-optimistic`)
  - Observed behavior: a stats query declares `output: s.object({ active, archived, lead, statusById, total })`, but direct JSX bindings such as `{stats.total}` fail `build:prod` with KV302 for `stats.total`, `stats.lead`, `stats.active`, and `stats.archived`. Laundering through render-local constants makes the app build.
  - Root cause: KV302 comes from `packages/compiler/src/validate/bindings.ts:50-57` after the query shape lacks the declared output fields. This is the same user-visible failure class as `plans/papercuts-super-5.md` A1, which was marked fixed, so this is a regression or missed expression shape.
  - Why it matters: dashboard/summary query outputs are a normal Drizzle read shape. The workaround pushes authors toward render-local constants, the stale-coverage pattern previous ledgers tried to remove.
  - Repro evidence: `cd /Users/mini/kovo-dogfood-exhaustive-20260629/t5-data-optimistic && pnpm run build:prod` fails with four KV302 diagnostics when `src/components/contacts.tsx` binds `{stats.total}` etc. directly; restoring local constants makes `build:prod` pass.
  - Acceptance: a build/data-plane test covers a Drizzle query with declared `output` computed fields bound directly in JSX; `build:prod` accepts `{stats.total}` without local-const laundering.

## Refuted / Not Carried Forward

- Style CSP hashes for inline style attributes stayed fixed: `t1-style-form` passed `check`, `test`, `tsc`, and dev HTML included the generated `style-src` unsafe-hash for the literal style probe.
- Upload storage/multipart handling worked after the throwaway app registered the new mutation: `t3-file-upload` passed `check`, `test`, `build:prod`, rendered `enctype="multipart/form-data"`, and a tiny PDF POST returned HTTP 303.
- Endpoint/webhook body, auth, cookie stripping, replay, and audit posture were refuted by `t4-endpoints-webhooks`: `check`, `test`, `build:prod`, endpoint-posture, dev and built-server signed HTTP smokes all passed.
- Data/optimistic live target response handling did not reopen `bugz-14` B2: with `Kovo-Live-Targets`, the enhanced mutation response included both query chunks and the expected fragment.
- `vp dev` port contention was a duplicate of prior dev-port papercuts; using an explicit alternate port worked.

## Latest Verification

- `rg -n "^- \[ \]" plans/bugz-15.md plans/papercuts-super-6.md plans/papercuts-*.md plans/bugz-*.md plans/papercut-super-*.md`: no open prior dogfood checklist items.
- `t1-style-form`: `pnpm run check`, `pnpm run test`, `pnpm exec tsc --noEmit`, plus dev CSP/hash smoke all passed.
- `t2-islands-live`: `pnpm exec tsc --noEmit` and `pnpm run build:prod` reproduce A1.
- `t3-file-upload`: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, dev rendered-form smoke, and multipart POST passed without the unsupported `accept` hint; adding `accept` reproduces B1.
- `t4-endpoints-webhooks`: sub-agent ran `tsc`, `test`, `check`, endpoint-posture, dev signed HTTP smoke, built-server signed HTTP smoke, and `kovo explain --endpoints`; no candidates.
- `t5-data-optimistic`: sub-agent ran `tsc`, `test`, `check`, `build:prod`, dev enhanced mutation smokes; direct `{stats.*}` binding self-reproduced C1 with `pnpm run build:prod`.
