# kovo

## What this codebase does

Kovo is a pre-v1 TypeScript **web framework** (a pnpm monorepo, not a single
app). The framework lives in `packages/*` — `compiler` (lowers TSX components
to server/client modules), `server` (JSX runtime, mutations, queries, guards,
wire protocol), `browser` (loader, morph, optimistic protocol), `better-auth`
(better-auth adapter), `headless-ui` + `ui` (component libraries). Reference
apps under `examples/*` (commerce, stackoverflow, crm, reference) are readable
demos. Because this is a framework, an insecure default propagates to *every*
downstream app — weight findings in framework code higher than in one example.

## Auth shape

- `guards` object (`packages/server/src/guards.ts`): `guards.authed()`,
  `guards.rateLimit({max,key,per})`, session provider plumbing. Guards compose
  *before* the handler; order matters (auth must precede rate-limit).
- `packages/better-auth`: `authed` / `role` guards, `betterAuthSession`,
  `betterAuthSignIn/SignUp/SignOut` mutations, `redirectPath` / `sanitizeNext`
  same-origin guards.
- Session is re-derived per request (`request.session` / `auth.api.getSession`).
- `packages/headless-ui/src/lib/safe-url.ts` — the one allowlist helper for
  `href`/`src` schemes. CSRF is default-on (`csrfField`).

## Threat model

Framework defaults are the highest-impact target: an unescaped output path or a
weak redirect/normalization helper becomes stored/reflected XSS or open-redirect
in every app at once. Rank: (1) HTML/attr injection sinks that bypass the
compiler/library escaping; (2) open-redirect via path/redirect helpers
(backslash and leading `//` authority bypasses); (3) auth-state confusion and
guard-composition gaps; (4) insecure patterns in `examples/*` that apps copy.

## Project-specific patterns to flag

- **New output sinks that skip escaping.** Text interpolation is escaped by the
  *compiler* (`escapeText` in `packages/server/src/html.ts`) and by `@kovojs/ui`
  components, not by `jsx()` at runtime. Flag any NEW raw sink: hand-rolled HTML
  string concat (cf. `table.tsx` `tablePart`), `String(children)` without
  `escapeText`, or browser `innerHTML`/`insertAdjacentHTML`/morph writing
  un-escaped values.
- **Redirect/normalization helpers** that emit a `Location` or resolve a `next`
  param without `sanitizeNext` / a same-origin check — verify both `/\` and
  leading `//` are rejected after normalization.
- **Reactive attribute binding** (`inline-derives`, `query-bindings`
  `setBoundAttribute`) targeting URL/script/style attrs (`href`/`src`/`srcdoc`/
  `formaction`/`style`) with no scheme policy.
- **`guards.rateLimit`** on a public/anonymous endpoint with no `key` (anonymous
  requests must not collapse into one bucket), or auth ordered after rate-limit.
- **Mutation idempotency/replay** (`mutation.ts`/`replay.ts`): reservation must
  happen *before* the handler runs, not after.
- **File handling** (`server/src/{schema,response}.ts`): client-declared
  Content-Type trusted without sniffing, or `respond.file`/`.stream` missing
  `X-Content-Type-Options: nosniff`.

## Known false-positives

- **All 16 findings in `SECURITY_FINDINGS.md` (C1, H1–H5, M1–M10) were
  remediated 2026-06-15** (`SECURITY_REMEDIATION.md` has the fix map). Don't
  re-report them unless current code has regressed past the documented fix.
- `jsx()` returning a raw `string` is a load-bearing contract — composed
  component output is intentionally *not* branded/escaped at runtime; escaping
  is at the compiler + `@kovojs/ui` layer. A bare `jsx(...)` string is not a sink.
- `escapeHtml` covering only `& < >` is by design (paired with `escapeAttribute`
  for `"`; text uses `escapeText`).
- **Generated/lowered artifacts are not app code** (SPEC §5.2 KV235 forbids
  hand-authoring them): `**/generated/**`, `dist/`, `.kovo/`, emitted
  `*.client.js` / lowered server modules, and `data/**/*.json` mirrors. An
  `innerHTML` stamp in generated output is a compiler artifact, not a hand-written sink.
- `packages/conformance-fixtures/**`, `fixtures/`, `scratch/`, and test files
  (`*.test.ts`, `tests/*.node.mjs`) are deliberately adversarial/insecure.
- Some hardening intentionally lives in framework fixtures rather than the
  readable `examples/*` apps (upload ownership, webhook signing, CSV escaping).
</content>
</invoke>
