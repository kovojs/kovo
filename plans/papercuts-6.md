# Papercuts 6

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
confirmed framework/template papercuts found during exhaustive Kovo dogfooding on
current local `main`.

Meta-theme: the starter baseline and several previously open security/posture
concerns are now green, but generated CSS identifiers and id-less headless
primitive instances still need tighter framework-owned validity.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628b`:
`base-pristine`, `session-cache`, `deferred-stream`, `endpoint-csrf`,
`headless-a11y`, and `style-theme`.

The baseline app passed `pnpm run check`, `pnpm run test`, `pnpm run build:prod`,
and a dev HTTP smoke. Track apps exercised session/cache headers and logout
lifecycle, deferred streaming boundaries, endpoint JSON CSRF and `csrf:false`
cookie stripping, headless UI accessibility contracts, and style/theme token
safety.

## Issues

### A. Style / Theme CSS Validity

- [x] **`defineVars()` accepts token names that compile into invalid CSS custom-property names.** (low, framework; found by `style-theme`)
  - Observed behavior: `style.defineVars({ 'AT&TAccent': ..., 'R&D_gap2': ... })`
    succeeds, `pnpm run check` and `pnpm run build:prod` pass, and the built route
    CSS contains invalid identifiers such as
    `--kovo-style-theme-audit--a-t&-t-accent` and
    `var(--kovo-style-theme-audit--r&-d_gap2)`.
  - Root cause: `packages/style/src/engine.ts:384` validates token names with
    `assertCssNameSafe`, but that check only rejects controls, whitespace, and
    breakout delimiters (`packages/style/src/engine.ts:653`). `defineVars()` then
    concatenates `toKebabCase(token)` into `--kovo-${namespace}-${token}` without
    slugging or enforcing CSS custom-property identifier grammar
    (`packages/style/src/engine.ts:385`, `packages/style/src/engine.ts:879`).
  - Why it matters: SPEC §13.1 defines theme tokens as document CSS custom
    properties. App authors can get a green build but ship CSS that parsers reject
    or browsers drop, so themed styles fail after framework generation.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628b/style-theme`,
    `pnpm exec vitest run src/style-theme-probes.test.ts src/app.test.ts` passed,
    but parsing `dist/server/client/assets/routes/style-theme-d9771b8e.css` with
    the repo's installed `lightningcss` failed with `Unexpected token Delim('&')`.
  - Acceptance: `style.defineVars()` and `style.createTheme()` must either reject
    CSS-ident-invalid token names with a clear error or deterministically encode
    them into valid custom-property identifiers. Focused coverage must prove
    `&`-bearing token names cannot produce invalid emitted CSS.
  - Evidence: `pnpm exec vitest run packages/style/src/engine.test.ts packages/headless-ui/src/primitives/command.test.ts packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/select.test.ts packages/headless-ui/src/primitives/autocomplete.test.ts` proves `defineVars()` rejects `AT&TAccent` / `R&D_gap2` before emitting custom properties and `createTheme()` rejects forged invalid `var(...)` references.

### B. Headless UI IDREF Validity

- [x] **Id-less duplicate command/combobox/select instances synthesize duplicate option IDs.** (low, framework; found by `headless-a11y`; duplicate/variant of `plans/bugz-3.md` L17)
  - Observed behavior: rendering two ordinary id-less instances with the same item
    set produced duplicate IDs:
    `command-17y9j0i-item-0`, `combobox-14vfsm8-option-0`, and
    `select-17y9j0i-option-0` each appeared twice. The `aria-activedescendant`
    references were not dangling, but they resolved to non-unique document IDs.
  - Root cause: the fallback prefixes in
    `packages/headless-ui/src/primitives/command.ts:1414`,
    `packages/headless-ui/src/primitives/combobox.ts:1062`, and
    `packages/headless-ui/src/primitives/select.ts:1099` fingerprint only the
    item set. That is stable within an instance, but identical sibling widgets
    have the same fingerprint and collide.
  - Why it matters: SPEC §4.6 and §13.1 rely on valid light-DOM primitive
    relationships. Duplicate IDs make IDREF resolution ambiguous for assistive
    tech and browser APIs, and the framework generated them without an app-authored
    ID mistake.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628b/headless-a11y`,
    fetching `http://localhost:5196/a11y` and counting `id="..."` attributes
    produced duplicate counts for those three option IDs; `aria-activedescendant`
    had six references and zero missing targets.
  - Acceptance: id-less duplicate instances must not emit duplicate option IDs.
    Either require a unique app-provided owner/listbox ID with a diagnostic, or
    synthesize a per-instance-valid prefix that keeps each input/trigger and its
    rendered options in the same ID space.
  - Evidence: `pnpm exec vitest run packages/style/src/engine.test.ts packages/headless-ui/src/primitives/command.test.ts packages/headless-ui/src/primitives/combobox.test.ts packages/headless-ui/src/primitives/select.test.ts packages/headless-ui/src/primitives/autocomplete.test.ts` proves id-less generated option IDs now require unique `listboxId` / `listId` prefixes and identical sibling item sets no longer share generated option IDs when the required owner IDs differ.

## Refuted / Not Carried Forward

- Session/cache lifecycle: authenticated documents, guarded typed reads, enhanced
  mutation fragments, logout, and post-logout redirects carried `Vary: Cookie` /
  `no-store` where expected; the emitted runtime contains the `pageshow` /
  `event.persisted` reload defense for `meta[name="kovo-session"]`.
- Endpoint JSON CSRF and `csrf:false`: a JSON-body endpoint token was accepted,
  missing tokens failed 422, and `csrf:false` handlers saw stripped `Cookie`
  headers on both the original request and `request.clone()`.
- Deferred streaming: visible targets containing `</script>` were serialized as
  `\u003c/script>`, deferred fallback/render text escaped markup, and boundary
  collision probes rerolled the stream boundary.
- UI URL sanitization and CSS value breakout: tested breadcrumb, hover-card, and
  navigation-menu links preserved benign `&` path segments and rewrote
  `javascript:` URLs to `#`; exercised style values rejected declaration/rule and
  `</style>` breakouts.
- Dev port `strictPort`: a worker saw `pnpm run dev` fail when 5173 was already
  occupied, but this is the intentional fix recorded in `plans/papercut-super-1.md`
  B3, not a fresh regression.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`: rebuilt the local scaffold CLI used
  by all track apps.
- In `/Users/mini/kovo-dogfood-20260628b/base-pristine`, `pnpm run check`,
  `pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke passed.
- In `/Users/mini/kovo-dogfood-20260628b/style-theme`,
  `pnpm exec vitest run src/style-theme-probes.test.ts src/app.test.ts` passed,
  and `lightningcss` parsing of the built route CSS failed with
  `Unexpected token Delim('&')`.
- In `/Users/mini/kovo-dogfood-20260628b/headless-a11y`, a direct rendered-HTML
  count of `/a11y` confirmed duplicate generated IDs for command, combobox, and
  select id-less sibling instances.
- `pnpm install` at the monorepo root completed after dogfood linking; resolving
  `@material/material-color-utilities` from `packages/style` succeeds.
- `pnpm run check:vp` in `/Users/mini/kovo-papercuts-6-20260628-083706`: pass
  after the papercuts-6 implementation slices.
- `git diff --check` in `/Users/mini/kovo-papercuts-6-20260628-083706`: pass.
