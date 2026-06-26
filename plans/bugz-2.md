# Bug Ledger (`bugz-2`)

**Date:** 2026-06-26
**Scope:** Follow-on adversarial sweep beyond `plans/bugz.md`, at current `main`.
**Method:** Five parallel throwaway-worktree audits (server request/streaming, compiler routing,
browser runtime, Drizzle/Better Auth, build/CLI/static export) plus main-thread source review.
Do not treat this as a replacement for `plans/bugz.md`; every item below is distinct from that
ledger's H1-H9/M1-M4/L1-L5 list.

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| High     |     4 | H1-H4 |
| Medium   |     4 | M1-M4 |
| Low      |     2 | L1-L2 |

---

## HIGH

- [x] **H1 - `stream.fragment()` accepts forged `{ html: string }` objects as raw fragment HTML.** `packages/server/src/mutation/streaming.ts:17-24,96-106,345-354,372-383`
  - The public type/comment says streaming fragments accept rendered JSX or explicit `trustedHtml` (SPEC §9.1 / §4.8 KV236), but `renderMutationStreamFragmentHtml` has a structural fallback: any object with an `html` string is returned raw. An attacker-shaped JSON object can be accidentally passed through `stream.fragment({ html: value, target })`; `stream.text()` would escape the same bytes.
  - **Exploit:** model/user/CMS output `{ html: '<img src=x onerror=...>' }` reaches a streaming mutation fragment and is emitted as live markup in `<kovo-fragment>`.
  - **Verified:** server sub-agent throwaway worktree vitest drove exported `stream.fragment()` + `renderStreamingMutationWireResponse`; forged object emitted raw `<img ...onerror...>`, control `stream.text()` escaped it.
  - **Distinct from `bugz.md`:** related shape to H6 trust-brand forgery, but this is a separate server streaming primitive and does not depend on `__kovoTrustedHtml`.
  - **Fix:** delete the structural `{ html: string }` fallback; accept only `isRenderedHtml(value)` or a non-forgeable `trustedHtml` witness, otherwise fail closed / emit empty with a KV236 event.
  - Evidence 2026-06-26: `renderMutationStreamFragmentHtml` now accepts only rendered HTML or `trustedHtml`; `pnpm exec vitest --run packages/server/src/mutation-response.test.ts`, `git diff --check`, and `pnpm run check:vp` passed after integration.

- [x] **H2 - Aliased/namespace `kovo()` table annotations are ignored, dropping owner/governed facts.** `packages/drizzle/src/static/schema.ts:1464-1468`, `packages/drizzle/src/static.ts:2066-2106,2115-2117`
  - `isKovoAnnotationCall` recognizes only a call expression whose callee text is literally the identifier `kovo`. Valid public imports such as `import { kovo as kv } from '@kovojs/drizzle'` and namespace calls `d.kovo(...)` are missed. `tableAnnotation` then falls back to a default domain/name annotation, silently losing `key`, `owner`, `governed`, secret, and related schema facts.
  - **Exploit:** an owner/governed table annotated via `kv({ owner: ..., governed: [...] })` compiles, but KV414 owner-scope and KV438 mass-assignment gates have no owner/governed facts to enforce.
  - **Verified:** data/auth sub-agent throwaway vitest compared bare `kovo(...)` vs `kovo as kv`; aliased form produced `ownerDomains === []`, `scopeAudits === []`, `mass === []`; bare form produced owner and governed findings.
  - **Distinct from `bugz.md`:** not the H3/H5 session-provenance laundering and not H4 SQL helper aliasing; this loses the table facts before those gates run.
  - **Fix:** resolve the callee binding to `@kovojs/drizzle`'s `kovo` export, including import aliases and namespace members, anywhere `isKovoAnnotationCall` is used.
  - Evidence 2026-06-26: `isKovoAnnotationCall` now recognizes `@kovojs/drizzle` named aliases and namespace members; `pnpm exec vitest --run packages/drizzle/src/index.kovo-annotation-alias.test.ts`, `git diff --check`, and `pnpm run check:vp` passed after integration.

- [x] **H3 - Aliased/namespace `route()` calls disappear from route-page graph facts, bypassing KV436.** `packages/compiler/src/scan/route-pages.ts:123-134,361-372`, `packages/compiler/src/app-graph.ts:55-82`, `packages/cli/src/graph-output.ts:808-813`
  - `routePageFromCall` accepts only `route(...)` where the callee is the literal identifier `route`; `layout` scanning has the same exact-name issue. Runtime-valid code using `import { route as r } from '@kovojs/server'` or `server.route(...)` still serves the page, but `compileRouteModule` emits no `routePageFacts`. `deriveAppGraph` therefore has no page to classify, and `kovo check` never emits missing-access `KV436`.
  - **Exploit:** a sensitive route declared as `r('/secret', { page: ... })` can ship with no access decision because the default-deny access fact is never created.
  - **Verified:** compiler sub-agent throwaway vitest compared canonical, aliased, and namespace calls. Canonical emitted one page and a `decision:'missing'` access fact; alias/namespace emitted no page and no access fact.
  - **Distinct from `bugz.md`:** separate from SQL aliasing, ReDoS, output escaping, list stamps, and session provenance; this is routing graph/import-binding soundness.
  - **Fix:** collect `@kovojs/server` import bindings for `route`/`layout`, accept namespace members, and remove raw text prefilters that skip aliased route modules.
  - Evidence 2026-06-26: route-page scanning now resolves aliased and namespace `route`/`layout` imports; focused compiler/CLI tests, `git diff --check`, and `pnpm run check:vp` passed after integration.

- [x] **H4 - Structured document primitives render attacker-shaped attribute names verbatim.** `packages/server/src/document-structured.ts:125-132,151-166,261-275,366-376,379-394`
  - `renderShellAttributes` and `renderAttributes` escape values but concatenate attribute names directly. `HtmlAttrs`/`BodyAttrs` allow arbitrary `data-*` keys, and `Link(props)` renders all own props, so a spread object can inject a name like `data-x><script>alert(1)</script>` into the framework-owned document shell/head. This is the same sink class as `bugz.md` H1, but in the structured document API rather than JSX runtime spreads.
  - **Exploit:** `BodyAttrs({ 'data-x><script>alert(1)</script>': 'y' } as any)` renders an unescaped attribute name into `<body ...>`, breaking out of the tag in the top-level document shell. A spread into `Link({ href:'/safe.css', rel:'stylesheet', ...record })` has the same name sink.
  - **Verified:** main-thread source proof: allowed-name filtering checks only `allowed.has(name) || name.startsWith('data-')`; both renderers interpolate `${name}` without a token-name allowlist.
  - **Distinct from `bugz.md`:** not the server JSX runtime attribute-name spread path; this is the structured `createApp({ document })` surface.
  - **Fix:** use a shared attribute-name validator for all document renderers; reject names containing whitespace, quotes, `=`, `<`, `>`, `/`, or invalid XML/HTML token characters before rendering.
  - Evidence 2026-06-26: structured document renderers now validate attribute-name tokens before rendering; `pnpm exec vitest --run packages/server/src/document.test.ts`, `git diff --check`, and `pnpm run check:vp` passed after integration.

---

## MEDIUM

- [x] **M1 - Streamed raw endpoint bodies can run handler side effects before max-body 413.** `packages/server/src/app-request.ts:45-57`, `packages/server/src/app-load-shed.ts:175-191,295-330,333-350`, `packages/server/src/app-dispatch.ts:80-87`
  - The pre-dispatch load-shed check rejects only when `Content-Length` is present and over limit. Otherwise the request is wrapped so `text()`/`json()`/`body` throw after reading too many bytes, but raw `endpoint()` handlers have already been dispatched. A handler can perform side effects before or while consuming the oversized stream, then the framework returns 413.
  - **Exploit:** CSRF-exempt raw endpoint increments a counter or writes an audit row before `await request.text()`; oversized chunked request returns 413 but side effect happened.
  - **Verified:** server sub-agent throwaway vitest with `maxBodyBytes:4` and no `Content-Length` produced `{ status: 413, sideEffects: 1 }`.
  - **Fix:** for raw endpoints, drain/check the limited body before handler dispatch when a body is present, or expose a separate declared streaming endpoint class whose side-effect ordering is explicitly opt-in.
  - Evidence 2026-06-26: raw endpoint bodies are now verified and buffered before endpoint auth/CSRF/handler dispatch; `pnpm exec vitest --run packages/server/src/app.test.ts`, `git diff --check`, and `pnpm run check:vp` passed after integration.

- [x] **M2 - Inline loader writes `false` boolean-presence attrs as present.** `packages/browser/src/inline-loader-build.ts:220-255`, generated `packages/browser/src/inline-loader.ts:8`; contrast `packages/browser/src/query-bindings.ts:610-669`
  - The module runtime treats all boolean-presence attributes (`hidden`, `disabled`, `required`, `selected`, etc.) as remove-on-false. The inline loader only special-cases `checked` and `indeterminate`; `data-bind:hidden=false` becomes `hidden="false"`, which is still present in HTML.
  - **Impact:** after inline delegated handlers run, panels can remain hidden and controls disabled/required/selected despite false state, diverging from the module runtime and SPEC §4.8 binding semantics.
  - **Verified:** browser sub-agent throwaway simulation observed `{"hidden":"false","disabled":"false","checked":null}`; source contrast shows the full `BOOLEAN_PRESENCE_ATTRIBUTES` set exists only in `query-bindings.ts`.
  - **Fix:** share or inline the full boolean-presence attribute set in `inline-loader-build.ts`, regenerate `inline-loader.ts`, and pin parity tests for false/null/true.
  - Evidence 2026-06-26: inline `data-bind:*` now applies the full boolean-presence set with property parity for `checked`/`indeterminate`; `pnpm --filter @kovojs/browser exec vitest run src/inline-loader-security.test.ts src/inline-loader-delegated.test.ts`, `pnpm run check:inline-loader`, `git diff --check`, and `pnpm run check:vp` passed after integration.

- [x] **M3 - `create-kovo` starter CI calls `kovo` as a bare command.** `packages/create-kovo/templates/.github/workflows/ci.yml:14-20`, `rules/github-workflows.md:5-16`
  - The generated workflow installs via `voidzero-dev/setup-vp` and `vp install`, then runs `kovo build ./src/app.tsx` directly. The workflow rules explicitly say setup actions should not assume underlying package binaries are available as bare commands in later steps.
  - **Impact:** a newly scaffolded app can fail GitHub Actions with `kovo: command not found` even though dependencies installed, making the starter's CI red out of the box.
  - **Verified:** build/CLI sub-agent inspected the template and rule; package template scripts already define `build:prod`, but the workflow bypasses them.
  - **Fix:** run through the installed toolchain/package manager, e.g. `vp exec pnpm run build:prod` or `vp exec pnpm exec kovo build ./src/app.tsx`.
  - Evidence 2026-06-26: starter CI now runs `vp exec pnpm run build:prod`; `pnpm exec vitest --run packages/create-kovo/src/index.test.ts -t "declares the building-block dependencies"`, `git diff --check`, and `pnpm run check:vp` passed.

- [x] **M4 - Inline dynamic-import guard is wider than the module guard.** `packages/browser/src/inline-loader-build.ts:197-213`, generated `packages/browser/src/inline-loader.ts:8`; contrast `packages/browser/src/dynamic-import-url.ts:29-50`
  - The inline guard allows any same-origin pathname starting `/c/` or merely ending with the two letters `ts`. The module guard allows local-dev TS/TSX only on localhost and otherwise restricts to `/c/` plus any available modulepreload manifest. On production origins, inline accepts paths like `/admin/upload.ts` and `/assets`.
  - **Impact:** if a DOM-control attribute (`on:*`, stream renderer, or derive ref) can be introduced by another bug or app-owned CMS markup, the inline loader may import same-origin modules outside the compiler-emitted client-module surface.
  - **Verified:** browser sub-agent reproduced guard drift: module guard rejected `/admin/upload.ts` and `/assets`; inline predicate accepted both.
  - **Fix:** make the inline predicate byte-equivalent to `isAllowedKovoDynamicImportUrl`, including localhost-only dev TS modules and production `/c/`/manifest restrictions.
  - Evidence 2026-06-26: inline import validation now matches the module runtime's same-origin, localhost TS/TSX dev, `/c/`, and modulepreload-manifest restrictions; `pnpm --filter @kovojs/browser exec vitest run src/inline-loader-security.test.ts src/inline-loader-delegated.test.ts`, `pnpm run check:inline-loader`, `git diff --check`, and `pnpm run check:vp` passed after integration.

---

## LOW

- [x] **L1 - Route CSS target extraction skips aliased `route()` modules before AST scanning.** `packages/compiler/src/package-styles.ts:119-141`
  - `extractAppRouteCssTargets` prefilters source files with `source.includes('route(')`. A module using `import { route as r }` and `r('/x', ...)` is skipped before `compileRouteModule` can inspect it. This is closely related to H3 but affects route-level CSS splitting rather than access enforcement.
  - **Verified:** compiler sub-agent source review; same alias condition as H3.
  - **Fix:** remove the string prefilter or broaden it to import-aware AST scanning.
  - Evidence 2026-06-26: CSS target extraction no longer skips modules that import `@kovojs/server` without literal `route(`; `pnpm exec vitest --run packages/compiler/src/route-pages.test.ts packages/compiler/src/package-styles.test.ts packages/compiler/src/registry.test.ts`, `git diff --check`, and `pnpm run check:vp` passed.

- [x] **L2 - Structured document `Link` accepts extra props despite a fixed primitive contract.** `packages/server/src/document-structured.ts:151-166,366-376`
  - `Link`'s public type lists a fixed attribute set, but the implementation passes the whole `props` object to `renderAttributes`, so any extra own property supplied via spread or `as any` is rendered. This is folded into H4 for XSS when the extra prop name is malicious; independently, it undermines the structured-document contract by permitting unreviewed head attributes.
  - **Verified:** main-thread source proof.
  - **Fix:** render only the explicit known `Link` fields, not arbitrary `Object.entries(props)`.
  - Evidence 2026-06-26: `Link` now filters to explicit supported fields, and focused document tests prove extra props are dropped; `git diff --check` and `pnpm run check:vp` passed.

---

## Refuted / not carried forward

- Server endpoint auth over raw body: verified by server worker as using a cloned body for verifier/CSRF paths; no bypass found.
- `respond.stream()` inline active content: already covered by existing KV428 tests and overlaps `plans/bugz.md` upload-sniff findings.
- Static-export output path traversal/root overwrite: build/CLI worker found existing planner checks for decoded dot segments, separators, invalid encodings, and target conflicts.
- Better Auth plugin/schema materialization drift: data/auth worker found unsupported plugin tables are already surfaced as KV406 degradation facts.
- Initial query hydration delta miss: browser worker found it likely inert because initial document scripts should carry full query bodies, not deltas.

## Latest verification

- Sub-agent throwaway worktrees reproduced H1, H2, H3, M1, M2, and M4 with temporary tests/scripts and removed the worktrees afterward.
- Build/CLI worker ran `pnpm run check:api-surface` and `pnpm exec vitest run scripts/public-packages.test.mjs packages/conformance-fixtures/src/package-exports.test.ts` successfully.
- Main-thread source inspection verified H4, L1, and L2 line-level dataflows. No production code was changed for this ledger.
