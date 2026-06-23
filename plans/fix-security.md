# Security Fix Plan

**Date:** 2026-06-23
**Source report:** `.deepsec/data/kovo/reports/report.md` (62 findings: 18 high, 30 medium, 14 bug)
**Primary objective:** close the XSS class at the framework boundary, not just at individual example call sites.

## Review Conclusion

The report's XSS findings are mostly symptoms of one framework-level gap: Kovo currently lets the same
unbranded `string` channel mean either "already-rendered HTML" or "text to be escaped." The compiler
partially compensates by injecting `escapeText(...)`, but that protection is incomplete for expression
children, query-bound SSR children, direct `.definition.render({ children: string })` calls, framework
helpers, UI scalar props, and any serve path that bypasses the compiler.

The systematic prevention target is: **no unbranded scalar value may cross an HTML parse boundary.** Text is
escaped by default; raw markup and raw URLs require the explicit `trustedHtml(...)` / `trustedUrl(...)`
escape hatches already described by `SPEC.md` section 4.8 and enforced by `SPEC.md` section 5.2 rule 10.

## Intake

- [x] Review the DeepSec report and categorize findings by root cause.
  - Evidence: `rg -n "^### " .deepsec/data/kovo/reports/report.md` lists all 62 report findings; the XSS cluster centers on text-child escaping, raw component slots, form error output, data-bind SSR, inline-loader URL writes, and compiler-disabled demo serve paths.
- [x] Cross-check the report against the normative framework contract.
  - Evidence: `SPEC.md` section 4.8 requires contextual encoding for `data-bind` text/attributes and URL scheme allowlisting; `SPEC.md` section 5.2 rule 10 says output safety is contextual and default-on with no raw-string ejection.
- [x] Confirm the current implementation has raw-string boundaries that explain the XSS class.
  - Evidence: `packages/server/src/jsx-runtime.ts` `renderJsxChildren()` returns `String(children)`; `packages/core/src/index.ts` `renderFailureOutput()` interpolates `String(message)`; `packages/browser/src/inline-loader-build.ts` `wa()` writes `setAttribute(name, fb(val))`; `packages/ui/src/badge.tsx`, `table.tsx`, `dropdown-menu.tsx`, and `context-menu.tsx` still expose scalar/raw child paths.

## Phase 1: Red Security Corpus

- [x] Add a focused XSS regression corpus before broad implementation changes.
  - Target coverage: SSR text children containing `<img onerror>` / `<script>` through property access, ternaries, nullish expressions, call expressions, template expressions, arrays, and component children.
  - Evidence: `pnpm exec vitest --run packages/compiler/src/text-escaping.test.ts ...` covers property access, ternary, nullish, call, template, array/join, query/state derive, and component render composition byte output.
- [x] Add query-bound SSR tests for `data-bind` and `data-derive` initial markup.
  - Target coverage: query/state values rendered as sole text children, mixed text children, list template stamps, nullable paths, and inline derives.
  - SPEC anchor: `SPEC.md` section 4.8 text bindings are escaped text writes and never HTML parses.
  - Evidence: `packages/compiler/src/text-escaping.test.ts` asserts escaped query/state `data-bind` and `data-derive` SSR fallback markup; focused suite passed.
- [x] Add framework-helper sink tests.
  - Target coverage: `FieldError`/`FormError` validation messages and callback messages containing HTML metacharacters render escaped inside `<output>`.
  - Evidence: `packages/core/src/index.test.ts` covers validation and callback form-error escaping; focused suite passed.
- [x] Add UI scalar-prop and direct-render tests.
  - Target coverage: `Badge`, `DropdownMenuItem`, `ContextMenuItem`, `TableCell`, `TableHeaderCell`, and any component that renders `itemLabel`, `itemValue`, `label`, `title`, `description`, or scalar `children` into element text.
  - Evidence: `packages/ui/src/xss-escaping.test.tsx` covers `Badge`, menu fallbacks, and table cell/header escaping; focused suite passed.
- [x] Add inline-loader parity tests for URL-bearing attribute updates.
  - Target coverage: `data-bind:href`, `src`, `action`, `poster`, `data`, `ping`, and `xlink:href` neutralize `javascript:`/`data:` exactly like `packages/browser/src/security-output.ts` and server `safeUrlAttribute()`.
  - Evidence: `packages/browser/src/inline-loader-security.test.ts` covers href/src/action/poster/data/ping/xlink:href plus `on*`/`srcdoc`; focused suite passed.
- [x] Add hosted-demo smoke tests for compiler-disabled serve paths.
  - Target coverage: StackOverflow and CRM demo routes that render stored user content must escape payloads even when served through the multitenant demo runner.
  - Evidence: multitenant smoke returned `crm 200 true true` and `stackoverflow 200 true true`; demo Vite configs enable the compiler pre-plugin only in `KOVO_DEMO_MULTITENANT=1`.

## Phase 2: Framework Output Boundary

- [ ] Design and document the internal `Html` versus text boundary.
  - Decision target: component render output and composition slots are branded rendered HTML; unbranded `string`/`number`/`boolean` values are text and get escaped at the sink. Raw markup uses `trustedHtml(...)`.
  - SPEC anchor: `SPEC.md` section 5.2 rule 10 already forbids raw-string ejection; update comments/types/tests to make the boundary enforceable.
- [ ] Prototype the branded-rendered-HTML path in `@kovojs/server` and `@kovojs/core`.
  - Target files: `packages/server/src/jsx-runtime.ts`, component render plumbing, mutation helper rendering, and any helper that composes HTML fragments.
  - Proof target: existing component composition still works, while raw scalar children no longer inject markup.
- [x] If the full brand migration is too large for one checkpoint, land a compatibility layer that closes known sinks first.
  - Required stopgaps: escape scalar text in `renderFailureOutput()`, UI scalar props, table cell/header scalar content, `Badge` children, and direct-render example/template call sites.
  - Constraint: do not make `props.children` raw by convention without either a brand, an escape, or a test proving it came from compiler-escaped JSX.
  - Evidence: `packages/core/src/index.ts`, `packages/ui/src/{badge,dropdown-menu,context-menu,table}.tsx`, and `packages/compiler/src/lower/structural-jsx.ts` close known scalar sinks; focused suite passed.
- [x] Add a mechanical guard for framework-maintained components.
  - Target: a test or lint that fails when a `packages/ui/src/*` component renders scalar props or fallback text children without `escapeHtml`/`escapeText` or a trusted rendered-HTML brand.
  - Evidence: `packages/ui/src/xss-escaping.test.tsx` fails on unescaped maintained UI scalar sinks; focused suite passed.
- [ ] Revisit route `page()` string returns and tutorial examples.
  - Decision target: raw string page returns are either explicitly branded raw HTML, replaced with TSX in copyable docs, or accompanied by diagnostics/docs that every interpolation must use `escapeText`/`escapeAttribute`.

## Phase 3: Compiler SSR Escaping

- [x] Make text-context escaping expression-complete.
  - Target: `packages/compiler/src/lower/structural-jsx.ts` should escape every dynamic text-context expression that remains in SSR HTML, not only sole property-access children.
  - Report coverage: CRM ternaries, `.toUpperCase()` calls, nullish coalescing in table cells, and other non-property expression children.
  - Evidence: `packages/compiler/src/text-escaping.test.ts` covers call, conditional, nullish, template, array/join, query/state derive, and `.toUpperCase()` expressions; focused suite passed.
- [x] Ensure query-bound SSR children are escaped while preserving client `textContent` semantics.
  - Target: lowered SSR for `data-bind` / `data-derive` should emit escaped initial text, while client updates continue to use `textContent`.
  - Report coverage: StackOverflow question title/body data-bind SSR path.
  - Evidence: `packages/compiler/src/lower/structural-jsx.ts` wraps query/state SSR fallback text in `escapeText(...)`; `packages/compiler/src/text-escaping.test.ts` asserts the emitted bytes.
- [ ] Keep unsafe rawtext contexts fail-closed.
  - Target: dynamic `<script>` and `<style>` text, `srcdoc`, `innerHTML`/`rawHtml`, event-handler attributes, and style sinks are KV236 unless the value is explicitly trusted.
  - Existing evidence to preserve: `packages/compiler/src/output-context-security.test.ts` already has A3/B1-style coverage; extend rather than duplicate it.
- [ ] Add a security-specific render-equivalence gate.
  - Target: the semantic equivalence normalizer must not erase the difference between raw and escaped attacker payloads; security corpus checks should compare emitted bytes for dangerous payloads.

## Phase 4: Client/Server Encoding Parity

- [x] Route inline-loader bound attribute writes through the same policy as the modular runtime.
  - Target: `packages/browser/src/inline-loader-build.ts` `wa()` uses the `kovoBoundAttributeValue()` policy: skip `on*`/`srcdoc`, URL-scheme allowlist URL attributes, and preserve `trustedUrl`.
  - Follow-up: regenerate `packages/browser/src/inline-loader.ts`.
  - Evidence: `packages/browser/src/inline-loader-build.ts` and regenerated `packages/browser/src/inline-loader.ts` neutralize unsafe bound attributes; `pnpm run check:inline-loader` passed.
- [ ] Single-source URL attribute classification and scheme allowlists.
  - Target: server `safeUrlAttribute()`, browser `kovoBoundAttributeValue()`, compiler output-context validation, and inline loader all share the same URL attribute set and allowlist.
  - SPEC anchor: `SPEC.md` section 4.8 and section 5.2 rule 10 require byte-identical server/client encoding.

## Phase 5: Examples, Templates, and Demos

- [x] Keep the Kovo compiler enabled, or precompile through Kovo, for hosted demos that render user content.
  - Report coverage: CRM and StackOverflow multitenant demo paths disable the compiler and render stored user content through raw runtime strings.
  - Evidence: `examples/{crm,stackoverflow}/vite.config.ts` enable `exampleKovoCompilerPlugin(...)` in `KOVO_DEMO_MULTITENANT=1`; multitenant smoke returned 200 for both demos.
- [ ] Validate or derive attacker-controlled fields that amplify XSS reach.
  - Target: CRM `stage` becomes an enum, record IDs are generated or constrained server-side, `contactId` references an owned contact, and query/mutation access is owner-scoped.
  - Partial evidence: CRM `stage` is parsed as `CrmStage`, `contactId`/`dealId` are owner-checked, and mutation writes derive `ownerId`; record IDs are still client-provided hidden fields.
- [x] Remove client-controlled identity from example mutations.
  - Target: StackOverflow `authorId`/`userId` and CRM `ownerId` are derived from `request.session.user.id`; write mutations use `guards.authed()` plus ownership checks where appropriate.
  - Evidence: StackOverflow mutation inputs no longer accept `authorId`/`userId`; CRM inputs no longer accept `ownerId`; `examples/{crm,stackoverflow}/src/interactive-app.test.ts` passed.
- [ ] Fix copyable scaffold/template XSS patterns.
  - Target: create-kovo contact `Badge` usage, duplicate-email `FormError`, tutorial raw string pages, and reference app route string interpolation.

## Phase 6: Non-XSS Security Follow-Up From The Report

- [x] Harden GitHub workflows.
  - Target: explicit least-privilege `permissions`, deploy-only `pages: write` / `id-token: write`, and SHA pinning for third-party actions per `rules/github-workflows.md`.
  - Evidence: `.github/workflows/{ci,pages}.yml` pin actions by SHA and scope permissions; `pnpm run check:imports` and `git diff --check` passed after edits.
- [x] Harden container images.
  - Target: non-root `USER` in demo/docs images and digest-pinned base images.
  - Evidence: `Dockerfile` and `site/Dockerfile` pin `node:24-slim` by digest and run as `node`.
- [x] Fix path containment and cache integrity bugs.
  - Target: `kovo export --manifest` rejects `.`/`..` segments and verifies resolved paths stay under `--dist`; persistent compiler cache refs are confined to `blobs/<sha>.json` and content hashes are verified.
  - Evidence: `packages/cli/src/index.kovo-export.test.ts` and `packages/compiler/src/persistent-compile-cache.test.ts` passed in the focused suite.
- [x] Close redirect and request-origin hardening gaps.
  - Target: sanitize mutation `redirectTo`, sanitize guard `next` before custom handlers, and make `nodeRequestUrl()` honor pinned `origin` for absolute-form/protocol-relative request targets.
  - Evidence: `packages/server/src/{mutation-endpoint,guards,node}.test.ts` passed in the focused suite; Node adapter also handles multi-Link Early Hints for hosted demo pages.
- [ ] Replace copyable demo secrets and default credentials.
  - Target: tutorial/example CSRF secrets come from per-deployment env, scaffolded demo user is dev-only or randomly generated, and mock auth warns against production reuse.
  - Partial evidence: example CSRF secrets now read deployment env vars and fail closed in production; default/demo credential guidance remains to audit.
- [ ] Address replay/idempotency and race bugs.
  - Target: no-JS mutation replay uses the same atomic reservation helper as JS, replay `set()` never evicts pending records, duplicate-email has a backing unique constraint, and filesystem storage writes blob+metadata atomically.
  - Partial evidence: CRM duplicate email has a unique constraint and filesystem storage writes are atomic; no-JS/replay store coverage was not rerun in this checkpoint.
- [ ] Triage remaining non-security bugs separately after the security lanes land.
  - Target: diagnostic `Object.hasOwn`, style hash/property-priority issues, `createTheme` typo handling, tutorial transaction race, and demo command empty-state bug.
  - Partial evidence: `packages/core/src/diagnostics.ts` now uses `Object.hasOwn`; other listed bugs remain open.

## Latest Verification

- `pnpm exec vitest --run packages/compiler/src/text-escaping.test.ts packages/core/src/index.test.ts packages/core/src/storage.test.ts packages/core/src/diagnostics.test.ts packages/ui/src/xss-escaping.test.tsx packages/ui/src/table.stylex.test.tsx packages/browser/src/inline-loader-security.test.ts packages/cli/src/index.kovo-export.test.ts packages/compiler/src/persistent-compile-cache.test.ts packages/server/src/mutation-endpoint.test.ts packages/server/src/guards.test.ts packages/server/src/node.test.ts packages/drizzle/src/derive-codegen.test.ts examples/crm/src/interactive-app.test.ts examples/crm/src/optimistic.test.ts examples/stackoverflow/src/interactive-app.test.ts` passed: 16 files, 170 tests.
- `vp run typecheck-examples`, `pnpm run check:inline-loader`, `pnpm run check:imports`, `pnpm run check:no-committed-generated`, and `git diff --check` passed.
- Hosted demo smoke passed: `crm 200 true true`, `stackoverflow 200 true true`.
- `pnpm run check` remains blocked in repo-wide `vp check` by unrelated unused-symbol warnings in existing packages/conformance/tests; formatting passed before those warnings.
