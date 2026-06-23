# Source/Sink Security Plan

**Date:** 2026-06-23
**Primary objective:** make Kovo's non-SQL security boundaries auditable the same way `plans/sql-injection.md` treats executable SQL: every attacker-controlled or cross-trust input source must have a named, tested path to every dangerous output sink, with default-safe framework handling and explicit branded/audited escape hatches.

## Review Conclusion

Yes, SQL is only one source/sink class. The broader framework has at least eight security-relevant source/sink families beyond executable SQL text:

1. HTML/DOM/script-data/CSS output.
2. URL, navigation, redirect, module, and selector sinks.
3. HTTP response headers and cookies.
4. Request ingress, CSRF, endpoint, and webhook authority boundaries.
5. Query/live transport, cache, BroadcastChannel, SSE, and fragment target trust.
6. File upload, file download, static export, storage key, and path containment.
7. Authorization/IDOR data access and session-derived ownership.
8. Resource-exhaustion and replay/idempotency chokepoints.

Most high-severity non-SQL incidents have already been fixed or specified in `SPEC.md` and `plans/fix-security.md`, but that work is scattered across XSS, redirect, file, replay, header, cache, and auth fixes. The missing plan is a **single generated source/sink inventory and corpus** that prevents future drift: when a new framework source or sink is added, it should be enrolled in a matrix with a static diagnostic, runtime guard, or a documented reason it is outside the framework boundary.

This plan does not replace `plans/sql-injection.md`; it indexes SQL as one sink family and leaves SQL-specific text/parameter provenance to that plan.

## Explicit Non-Goals

- [x] Remove CSV/TSV/spreadsheet export as a framework-owned capability.
  - Evidence: `rg -n -i "\\b(csv|tsv|spreadsheet|excel|formula)\\b|text/csv|orders\\.csv|inventory\\.csv" packages tests examples site docs -g '!node_modules' -g '!packages/icons/**'` now finds only disclaimer text in `site/content/guides/{security,endpoints-webhooks,streaming}.md`; framework tests and API examples use neutral binary/PDF/text fixtures instead of spreadsheet-like exports.
  - Kovo v1 should not ship first-party CSV/TSV/spreadsheet helpers, diagnostics, corpus fixtures, examples, templates, guide recipes, or public API surface that makes spreadsheet export look supported by the framework. Spreadsheet formula execution is a separate application format hazard, not a Kovo core web-framework sink to bless.
- [x] Keep only generic raw response escape hatches for app-owned exports.
  - Evidence: `pnpm exec vitest run packages/core/src/storage.test.ts packages/server/src/route-response.test.ts packages/server/src/static-export-route-guards.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/document.test.ts packages/server/src/endpoint.test.ts packages/browser/src/inline-loader-navigation.test.ts packages/cli/src/index.kovo-explain.test.ts` and `pnpm --dir tests/integration exec playwright test specs/respond-file.spec.ts` verify the remaining file/download/static-export coverage uses generic raw file/stream responses without CSV/TSV/spreadsheet helpers.
  - If an app needs spreadsheet export, it must be ordinary app-owned code behind `endpoint()` or `respond.file()`/`respond.stream()` with explicit app security review. The source/sink plan must not add a Kovo spreadsheet-safe helper or formula-hardening lane.
- [x] Remove copyable CSV/TSV export patterns from examples, templates, tutorials, and docs.
  - Evidence: `rg -n -i "csv|tsv|spreadsheet|excel|formula|text/csv|orders\\.csv|inventory\\.csv|exports?/.*csv" docs examples site -g '!node_modules'` now surfaces only the two intentional disclaimer lines in `site/content/guides/endpoints-webhooks.md` and `site/content/guides/streaming.md`; the prior tutorial/reference-app promotion was removed from `site/content/tutorial/08-wrap-up.md`.

## Current Evidence

- [x] Identify the normative output-safety contract.
  - Evidence: `SPEC.md` §4.8 and §5.2 rule 10 require contextual encoding for text, attributes, URL-scheme attributes, script/JSON islands, raw HTML, style, `srcdoc`, and related unsafe contexts; diagnostics registry lists KV236 for unsafe output contexts.
- [x] Confirm the SQL-specific plan already covers executable SQL text.
  - Evidence: `plans/sql-injection.md` defines sources (`input`, `req.search`, `req.params`, form bodies, headers/cookies) and sinks (`db.execute`/`query`/`exec`/`prepare`, `sql.raw`, `sql.identifier`, untagged SQL text) plus static and runtime gates.
- [x] Confirm the prior security plan covered many non-SQL incident fixes but not a durable source/sink inventory.
  - Evidence: `plans/fix-security.md` covers XSS, URL attributes, redirect normalization, file/stream `nosniff`, header/cookie safety, idempotency, path containment, hardcoded secrets, and workflow/container hardening as incident lanes.
- [x] Identify concrete HTML/DOM/URL/CSS sink code.
  - Evidence: `packages/core/src/internal/security-url.ts`, `packages/server/src/html.ts`, `packages/browser/src/security-output.ts`, and `packages/compiler/src/output-context-facts.ts` define shared URL attributes, unsafe scheme detection, trusted HTML/URL brands, output contexts, and server/client escaping.
- [x] Identify concrete header/cookie/file/redirect sink code.
  - Evidence: `packages/server/src/response.ts` builds `respond.file`/`respond.stream` headers with `X-Content-Type-Options: nosniff`; `packages/server/src/cookies.ts` validates/encodes typed cookies; `packages/server/src/match.ts` normalizes authority-forming slash/backslash and dot segments; `packages/server/src/mutation.ts` sanitizes mutation redirects through `sanitizeNext`.
- [x] Identify concrete ingress, CSRF, replay, and rate-limit source code.
  - Evidence: `packages/server/src/csrf.ts` binds session and anonymous CSRF tokens; `packages/server/src/app-load-shed.ts` enforces pre-dispatch body-size and rate limits; `packages/server/src/guards.ts` owns session/provider/guard/rate-limit/ownership request channels; `packages/server/src/replay.ts` and mutation tests cover idempotency replay.
- [x] Identify concrete query/live/cache/fragment source/sink code.
  - Evidence: `packages/server/src/query.ts` stamps `Cache-Control: private, no-store`, `Vary: Cookie`, and `Kovo-Build` on `/_q/` responses; `packages/browser/src/broadcast.ts` stamps/discards per-principal rebroadcasts; `packages/browser/src/fragment-targets.ts` and `packages/browser/src/inline-loader-build.ts` escape selector-based fragment target lookups.
- [x] Identify concrete file/storage/path source/sink code.
  - Evidence: `packages/server/src/schema.ts` models uploaded files; `packages/core/src/storage.ts` and related tests cover storage writes; `packages/cli/src/index.kovo-export.test.ts`, `packages/compiler/src/persistent-compile-cache.test.ts`, and `packages/server/src/static-export-*` tests cover path containment/static export references.

## Source Taxonomy

- [x] Treat these as first-class untrusted or cross-trust sources in the inventory:
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the source/sink inventory enrolls the required source taxonomy tokens.
  - `route().params`, `route().search`, GET form URL state, `/_q/` search args, mutation/form `input`, `FormData`, file upload metadata and bytes, request headers, cookies, raw request bodies, endpoint/webhook bodies, webhook provider headers/signatures, `req.session` from app providers, `req.db` records, streamed/model output, compiler-read app source, generated/live DOM stamps (`Kovo-Targets`, `Kovo-Live-Targets`, fragment targets, `data-stream-text`), URL fragments/hashes used by navigation, static-export route paths/assets/manifests, and app config/env values that become secrets, origins, paths, or response headers.
- [x] Record source provenance at the narrowest useful level.
  - Evidence: `packages/cli/src/sources-sinks.ts` records `trust`, `schema`, `firstParser`, and `consumers` for each inventory row; `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies those fields are printed and serialized.
  - Examples: distinguish browser ambient authority (`Cookie`/session) from machine auth (`webhook.verify`); distinguish author-trusted content (`trustedHtml`, `trustedUrl`) from DB/user text; distinguish route-literal URL output from user-supplied redirect/`next`.
- [x] Define source ownership in `kovo explain --sources-sinks`.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies `kovo explain --sources-sinks` prints source ownership columns including `source`, `trust`, `schema`, `firstParser`, `consumers`, `diagnostic`, and `escapeHatch`.
  - Output target: a diffable table with columns `source`, `trust`, `schema`, `first parser`, `consumers`, `diagnostics`, and `escape hatch`.

## Sink Taxonomy

- [x] Enroll HTML/DOM sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the HTML/DOM sink taxonomy tokens.
  - Sinks: JSX text, attribute values, raw HTML insertion (`rawHtml`, `trustedHtml`, fragment HTML, morph/`innerHTML`/`insertAdjacentHTML`), `<script type="application/json">`, `<kovo-query>`, `<kovo-text>`, `srcdoc`, event-handler attributes, live property writes, template stamps, and registry-bounded rich-text rendering.
- [x] Enroll URL/navigation/module/selector sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the URL/navigation/module/selector sink taxonomy tokens.
  - Sinks: `href`, `src`, `action`, `formaction`, `poster`, `ping`, `xlink:href`, meta URL content, redirect `Location`, auth `next`, route normalization redirects, enhanced-navigation fetch targets, dynamic `import(url#export)` handler refs, immutable `/c/__v/...` client module URLs, `querySelector` selector construction, hash scrolling, and static-export references to `/_m`/`/_q`/`/c`.
- [x] Enroll CSS/style sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the CSS/style sink taxonomy tokens.
  - Sinks: `style` attribute, `<style>` text/raw CSS, StyleX extraction, CSS custom properties, `url()` inside CSS, `view-transition-name`, runtime style property writers, and generated keyframe/theme output.
- [x] Enroll HTTP header/cookie sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the HTTP header/cookie sink taxonomy tokens.
  - Sinks: mutation response header channel, route outcome headers, `Set-Cookie`, `Location`, `Content-Disposition`, `Content-Type`, `Cache-Control`, `Vary`, `ETag`, `Last-Modified`, `Retry-After`, framework `Kovo-*` headers, and adapter-level Node/Bun/Workers header conversion.
- [x] Enroll endpoint/webhook/query/live transport sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the endpoint/webhook/query/live transport sink taxonomy tokens.
  - Sinks: `endpoint()` raw `Response`, `webhook()` responses, `/_q/` typed reads, SSE live query pushes, BroadcastChannel rebroadcast, HMR/dev-only refresh endpoints, mutation/defer streams, `Kovo-Changes`, and fragment target selection.
- [x] Enroll file/storage/path/static-export sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the file/storage/path/static-export sink taxonomy tokens.
  - Sinks: upload schema storage, storage keys/metadata, filesystem and S3 adapters, `respond.file`, `respond.stream`, static export output paths, Vite manifest asset copies, compiler persistent cache refs, generated graph/output files, and content-disposition filenames.
- [x] Enroll auth/data-authorization sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the auth/data-authorization sink taxonomy tokens.
  - Sinks: owner-annotated table reads/writes, guard/refinement results, session-provider cookies, unauthenticated redirects, CSRF-exempt mutations/endpoints, webhook `verify: none`, replay stores, rate-limit keys, and query cacheability.
- [x] Enroll dynamic code/process sinks.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies the inventory enrolls the dynamic code/process sink taxonomy tokens.
  - Sinks: `import()` of handler module URLs, compiler/dev HMR module loading, build preset runtime API compatibility, `new Function`/`eval`/`vm`, `child_process`, shell commands in scripts, and adapter-provided asset fetch fallbacks. Current scan found these mainly in tests/build tooling, but the plan should keep a request-path deny/audit gate.

## Phase 1: Inventory Generator

- [x] Add a repository-level source/sink extraction command.
  - Evidence: `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verified `kovo explain --sources-sinks` and `kovo check sources-sinks` command parsing/output.
  - Proposed command: `kovo check --sources-sinks` or `kovo explain --sources-sinks`.
  - It should merge compiler output-context facts, route/query/mutation/endpoint registries, app audit metadata, storage/file routes, header/cookie usage, and known raw escape hatches.
- [x] Emit a machine-readable artifact for CI.
  - Evidence: `packages/cli/src/sources-sinks.test.ts` verifies `.kovo/sources-sinks.json` is written deterministically with `source`, `sink`, `context`, `trust`, `firstParser`, `consumers`, `guard`, `schema`, `runtimeGuard`, `diagnostic`, `escapeHatch`, `specAnchor`, and `testEvidence` fields.
  - Proposed artifact: `.kovo/sources-sinks.json`, plus stable text output for review.
  - Required fields: `source`, `sink`, `context`, `trust`, `firstParser`, `consumers`, `guard`, `schema`, `runtimeGuard`, `diagnostic`, `escapeHatch`, `specAnchor`, and `testEvidence`.
- [x] Build a sink registry shared by compiler, server, browser, and CLI checks.
  - Evidence: `packages/core/src/internal/source-sink-registry.ts` now owns the framework source/sink registry and registered drift tokens behind `@kovojs/core/internal/source-sink-registry`; `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts`, `pnpm run check:imports`, `pnpm run check:api-surface`, and `pnpm exec vitest --run scripts/public-packages.test.mjs` verified the CLI consumes the shared registry without import/API boundary drift.
  - Start from existing facts in `packages/core/src/internal/security-url.ts`, `packages/compiler/src/output-context-facts.ts`, `packages/browser/src/security-output.ts`, server response/header/cookie helpers, route matcher, mutation wire parser, query endpoint, storage/static export helpers, and SQL seam predicates from `plans/sql-injection.md`.
- [x] Add drift detection.
  - Evidence: `node packages/cli/src/bin.ts check sources-sinks` emitted `DRIFT-SCAN roots=packages|examples|site|tests files=3467 hits=1938 findings=587 unregistered=0 status=accounted`; `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verifies registered dangerous sink tokens are scanned by owner and serialized into `.kovo/sources-sinks.json`.
  - New sinks named in source (`innerHTML`, `insertAdjacentHTML`, `setAttribute`, `new Response`, `Headers`, `Location`, `Set-Cookie`, `respond.file`, `respond.stream`, `querySelector`, `import(`, `new Function`, `child_process`, `fs`, `path.resolve`) must either map to a registered sink or carry a repo-internal justification.

## Phase 2: Red Corpus by Sink Family

- [ ] HTML/DOM corpus.
  - Payloads: `<script>`, `<img onerror>`, `</script><script>`, malformed entities, raw JSON breakouts, `srcdoc`, event attributes, SVG payloads, nested fragment payloads, streamed model text, registry rich-text XML, and template-stamp/list update paths.
  - Expected: default text/JSON contexts encode; unsafe raw contexts require `trustedHtml`/`trustedUrl` and surface in explain output.
- [ ] URL/navigation/redirect/selector corpus.
  - Payloads: `javascript:`, `data:`, mixed-case/control-character schemes, protocol-relative `//host`, backslash authority `/\host`, dot segments, hash/id selector breakouts, malformed CSS selectors, hostile `next`, route params used in targets, and stale `/c/__v` module URLs.
  - Expected: URL sinks neutralize/deny unless branded; redirects stay same-origin single-leading-slash; selectors are escaped or caught; old versioned modules recover by build-skew policy.
- [ ] Header/cookie corpus.
  - Payloads: CR/LF/NUL/DEL/control chars, multi-cookie injection attempts, semicolon cookie value attempts, quoted filename breakouts, bad header names, reserved `Kovo-*` app writes, cache header overrides on private data, and raw `Set-Cookie` forwarding from session providers.
  - Expected: typed builder rejects or encodes; KV415 covers app-authored channels; private/query/session responses keep `no-store`/`Vary: Cookie`.
- [ ] Endpoint/webhook/CSRF corpus.
  - Payloads: missing/wrong CSRF, CSRF-exempt mutation with session read, raw endpoint with ambient cookie reliance, webhook signature over prettified body, stale timestamp, rotated signatures, `verify: none`, duplicate event id, malformed body, and provider retry.
  - Expected: browser authority requires CSRF; machine endpoints require verifier/justification; raw bytes verify before parse; duplicates replay without handler re-execution.
- [ ] Query/live/broadcast corpus.
  - Payloads: guarded query through `/_q`, unauthenticated read, cross-principal BroadcastChannel envelope, session switch, live push after guard revocation, stale build token, delta without base, hostile `Kovo-Targets`, and excessive live-target descriptors.
  - Expected: guard re-check, private cache posture, cross-principal discard, token mismatch refetch/reload, target spoofing cannot bypass authorization, and target caps hold.
- [ ] File/storage/static-export corpus.
  - Payloads: traversal in params/filenames/storage keys, dot segments, backslashes, absolute paths, symlinks where relevant, unsafe MIME/SVG/HTML inline, content-disposition injection, oversized uploads, metadata control chars, Vite manifest path escapes, cache ref tampering, and static export links to reserved dynamic endpoints.
  - Expected: containment and output path checks reject; downloads default attachment + `nosniff`; MIME trust limits are documented; static export fails loudly for dynamic/reserved references.
- [ ] Dynamic code/process corpus.
  - Payloads: request-derived import URL/export name, app-authored handler ref strings outside compiler registry, dev HMR URL influence, build preset with unsupported Node APIs, request-path `new Function`/`eval`/`child_process`.
  - Expected: app request path cannot reach dynamic code/process sinks except compiler-owned versioned handler imports; build/deploy checks fail unsupported or unregistered execution surfaces.

## Phase 3: Diagnostics and Static Gates

- [x] Make `endpoint()` `auth` executable, not just declared — close the highest-severity endpoint gap (rank this above the audit/metadata items below: a complete audit table over unenforced declarations is the more dangerous state).
  - Evidence: `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts`, `pnpm exec vitest run packages/server/src/webhook.test.ts`, `pnpm --dir tests/integration exec playwright test specs/endpoint-raw-request.spec.ts`, `pnpm run check`, `pnpm run check:api-surface`, and `git diff --check` verify executable endpoint auth enforcement, webhook name-only self-enforcement, integration dispatch behavior, type/import boundaries, public API surface, and whitespace.
  - Gap: `dispatchMatchedAppRequest` (`packages/server/src/app-dispatch.ts:79-85`) runs CSRF then `runEndpoint`; it never resolves or runs the declared verifier, so `auth: { kind: 'verifier', name }` passes the audit while the handler runs fully unauthenticated. `webhook()` is the only enforced path (`packages/server/src/webhook.ts:245-257` verifies fail-closed before parse). There is no verifier registry — `webhook()` embeds its verifier object inline — so executable endpoint auth must carry the verifier on the declaration, not a name to resolve.
  - [x] Extend `EndpointAuthDeclaration` (`packages/server/src/endpoint.ts:14-17`): add an optional `verify?: WebhookVerifier` to the `verifier`/`custom` variants, reusing the core kit (`packages/core/src/verifier.ts`: `hmacSignature`/`standardWebhooks`/`customVerifier`). No new public types; inherits constant-time compare, timestamp tolerance, rotated secrets/multi-sig. `verify` stays optional so name-only declarations and webhook's own metadata are unaffected.
    - Evidence: `pnpm run check:api-surface` verified the public type surface stayed within the existing baseline.
  - [x] Add `runEndpointAuth(endpoint, request)` to `endpoint.ts` (mirrors `runEndpoint`/`endpointMatches`): clone the request, verify over raw wire bytes `{ headers, payload }`, fail-closed (catch → `401`); `kind: 'none'` or absent `verify` → skip. Call it before `validateEndpointCsrf` in `app-dispatch.ts`.
    - Evidence: `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts` verified fail-closed auth, body preservation, and auth-before-CSRF ordering.
  - [x] Keep `webhookAuth()` (`packages/server/src/webhook.ts:395-411`) emitting name-only declarations so `webhook()` self-enforces in its own lifecycle and the dispatcher skips it (no double verification).
    - Evidence: `pnpm exec vitest run packages/server/src/webhook.test.ts` verified webhook raw-byte verification and metadata behavior after dispatcher auth enforcement was added.
  - [x] Add a normative note to SPEC §9.1 (`SPEC.md:898`): an endpoint `auth` declaration MAY carry an executable verifier that the dispatcher enforces fail-closed over wire bytes before the handler runs, the same signature-before-parse guarantee `webhook()` makes.
    - Evidence: `SPEC.md` §9.1 now states executable endpoint auth runs fail-closed over cloned raw wire bytes before CSRF and handler dispatch.
  - [x] Tests (`packages/server/src/endpoint.test.ts` + `tests/integration/fixtures/endpoint-raw-request/app.tsx`): bad signature → 401, good signature → 200, handler still reads the body, `customVerifier` predicate path, and fail-closed on a verifier throw.
    - Evidence: `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts` and `pnpm --dir tests/integration exec playwright test specs/endpoint-raw-request.spec.ts`.
  - Note: this makes the declared `verifier:`/`custom:` posture an enforced guarantee. The metadata/justification items below (required `method`, `reason`, `mountJustification`, omitted-auth diagnostic) remain valuable but are secondary to enforcement.
- [x] Allocate source/sink diagnostic codes after checking `diagnosticDefinitions`.
  - Evidence: `pnpm exec vitest run packages/core/src/diagnostics.test.ts`, `pnpm run check:api-surface`, and `git diff --check` verify KV422-KV425 are allocated in `diagnosticDefinitions`, the inline registry snapshot, SPEC §11.3, and the diagnostics guide without widening the public API baseline.
  - Do not reuse KV236/KV415/KV418/KV414 for unrelated classes; keep each code's question narrow.
- [x] Make raw `endpoint()` declarations always auditable.
  - Require an endpoint-level `reason`/`purpose` string for every `endpoint()` because it is the raw HTTP escape hatch. The audit row should print that reason even when auth and CSRF are otherwise safe.
  - Require explicit `method`; no implicit `ANY` for app-authored endpoints. Prefix mounts require an additional `mountJustification` because they enlarge the routed surface.
  - Auth posture is covered structurally by the single-source-of-truth item above (mandatory executable verifier, or explicit `none: <justification>`, fail-closed default) — not restated here. The audit row prints the scheme derived from `auth.verify`, or `unauthenticated` for `none`.
  - Keep the existing `csrf: false` named justification, and keep KV418 for any CSRF-exempt endpoint that depends on ambient session/cookie authority.
  - Require declared output posture for raw responses: `body: 'html' | 'json' | 'text' | 'bytes' | 'stream' | 'redirect'`, cache posture, and whether app code owns all encoding/header safety. This is metadata for audit and drift checks; it does not make raw endpoints part of the safe component/mutation protocol.
  - Evidence: `packages/server/src/endpoint.ts` requires explicit `method`, endpoint `reason`/`purpose`, prefix `mountJustification`, and `response` posture metadata; `packages/server/src/endpoint.test.ts` proves missing metadata and missing prefix justification are type errors and that declarations retain the metadata structurally.
  - Evidence: `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/app.test.ts packages/server/src/shell.test.ts packages/better-auth/src/index.session.test.ts` verified endpoint declaration metadata, dispatch behavior, Better Auth mount metadata, and no implicit any-method matching.
- [ ] Add a general "unregistered sink" diagnostic for app source.
  - Any app-authored direct dangerous sink not behind a Kovo helper or explicit trust API should fail with a teaching message pointing to the safe surface.
- [x] Extend `kovo explain --endpoints`.
  - Evidence: `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/commands-manifest.test.ts` verifies endpoint explain rows include surface kind, auth, CSRF, cache, body/body-size, rate-limit, header, file, dynamic, and write posture columns for webhook and file-route examples.
  - Include routes returning `respond.file`/`respond.stream`, endpoints/webhooks, CSRF posture, auth scheme, cache posture, body-size/rate-limit posture, header writes, file outputs, and dynamic export surfaces in one ingress table.
- [ ] Add `kovo explain --trust`.
  - List every `trustedHtml`, `trustedUrl`, future `trustedSql`, raw endpoint, webhook custom/none verifier, and static export path override with source spans and justifications.

## Phase 4: Runtime Chokepoints

- [ ] Keep runtime guards at framework-owned chokepoints, not at scattered call sites.
  - Chokepoints: server renderer, browser update plan, fragment/morph apply, route/mutation/query response builders, header/cookie builder, request shell, CSRF/replay lifecycle, query endpoint, endpoint/webhook dispatcher, storage adapter, static export writer, client module registry, and DB handle guard from `plans/sql-injection.md`.
- [ ] Add parity tests for each paired server/browser sink.
  - Required pairs: server URL attributes vs browser bound attributes, server text/JSON vs browser query/fragment apply, modular vs inline loader selector escaping, route redirects vs mutation redirects/auth `next`, and query endpoint vs BroadcastChannel/live transports.
- [ ] Fail closed where runtime can prove shape safety.
  - Examples: bad headers/cookies, unsafe URL scheme, selector construction failure, CSRF mismatch, body too large, cross-principal broadcast, stale build token, disallowed storage path, and unbranded raw SQL per `plans/sql-injection.md`.

## Phase 5: Docs, Examples, and Templates

- [x] Update the security guide with the source/sink model.
  - Evidence: `pnpm --dir site run content` and `git diff --check` verified `site/content/guides/security.md` renders with a source/safe-path/dangerous-sink/escape-hatch/diagnostic table.
  - Include one table: "source", "safe Kovo path", "dangerous sink", "escape hatch", "diagnostic".
- [x] Add copyable rules for common app code.
  - Evidence: `site/content/guides/security.md` now lists rules forbidding unreviewed interpolation into HTML, URL, SQL, headers, cookies, filesystem paths, or raw endpoints and explicitly excludes CSV/TSV/spreadsheet export from Kovo's safe-by-default contract; `pnpm --dir site run content` passed.
  - Never interpolate request/DB/model data into HTML, URL, SQL, headers, cookies, filesystem paths, or raw endpoints without the corresponding Kovo safe helper or trust API; do not present CSV/TSV/spreadsheet export as a Kovo-supported safe-by-default pattern.
- [x] Audit examples/templates against the inventory.
  - Evidence: `node packages/cli/src/bin.ts check sources-sinks` scanned `packages|examples|site|tests` and reported `unregistered=0 status=accounted`, covering starter templates, tutorial/site demos, examples, and package-hosted template code.
  - Starter templates, tutorial steps, reference apps, examples, site demos, and gallery code should have zero unregistered app-authored sinks.

## Phase 6: Verification and Acceptance

- [x] Acceptance: the generated inventory is complete for the current repo.
  - Evidence: `node packages/cli/src/bin.ts check sources-sinks` generated `.kovo/sources-sinks.json` and reported `unregistered=0 status=accounted` across the plan's source roots for all registered dangerous sink tokens.
  - Run: `rg -n "innerHTML|outerHTML|insertAdjacentHTML|setAttribute\\(|new Response|Headers|Location|Set-Cookie|respond\\.(file|stream)|querySelector\\(|import\\(|new Function|eval\\(|child_process|path\\.resolve|fs\\." packages examples site tests` and account for every request-path/framework sink in the registry or an explicit exclusion.
- [ ] Acceptance: every sink family has at least one negative and one positive test.
  - Negative tests prove the dangerous source is rejected/encoded/neutralized.
  - Positive tests prove the blessed helper path still works without forcing apps into raw escape hatches.
- [ ] Acceptance: existing security lanes remain green.
  - Include the focused suites from `plans/fix-security.md`, SQL corpus from `plans/sql-injection.md` once implemented, endpoint/webhook conformance, query cache tests, static export containment tests, browser fragment/morph tests, and `git diff --check`.
- [ ] Keep this ledger compact.
  - As implementation lands, replace checklist prose with the narrowest evidence: one test command or authoritative file/artifact per completed item, plus a short latest verification section.

## Latest Verification

- `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/app.test.ts packages/server/src/shell.test.ts packages/better-auth/src/index.session.test.ts` verified explicit endpoint audit metadata, structural retention, no implicit any-method dispatch, prefix mount justification, and Better Auth mount metadata.
- `pnpm exec vitest run packages/server/src/endpoint.test.ts packages/server/src/app-dispatch.test.ts` verified executable endpoint HMAC/custom auth, fail-closed verifier throws, body preservation, and auth-before-CSRF dispatch ordering.
- `pnpm exec vitest run packages/server/src/webhook.test.ts` verified webhook raw-byte verification and name-only endpoint auth metadata still self-enforce without dispatcher double verification.
- `pnpm --dir tests/integration exec playwright test specs/endpoint-raw-request.spec.ts` verified full request-handler bad signature → 401 and good signature → 200 with the handler still reading the raw body.
- `pnpm run check`, `pnpm run check:api-surface`, and `git diff --check` verified type/import boundaries, example typechecks, public API surface baseline, and whitespace.
- `pnpm exec vitest run packages/core/src/diagnostics.test.ts` verified source/sink diagnostic allocation KV422-KV425 in `diagnosticDefinitions` and snapshots.
- `pnpm --dir site run content` verified the security-guide source/sink model and common app-code rules render through the site content pipeline.
- `pnpm exec vitest --run packages/cli/src/sources-sinks.test.ts packages/cli/src/commands-manifest.test.ts packages/cli/src/index.kovo-check.test.ts packages/cli/src/index.kovo-explain.test.ts` verified Phase 1 source/sink CLI output, source/sink taxonomy enrollment, source ownership columns, and `.kovo/sources-sinks.json` artifact writing.
- `node packages/cli/src/bin.ts check sources-sinks` verified current-repo drift scan output: `DRIFT-SCAN roots=packages|examples|site|tests files=3467 hits=1938 findings=587 unregistered=0 status=accounted`.
- `pnpm exec vitest --run packages/cli/src/index.kovo-explain.test.ts packages/cli/src/commands-manifest.test.ts` verified expanded `kovo explain --endpoints` ingress posture output.
- `pnpm exec vitest --run scripts/public-packages.test.mjs` verified the shared core-internal source/sink registry export is classified as internal in `public-packages.json`.
- `pnpm exec vitest run packages/core/src/storage.test.ts packages/server/src/route-response.test.ts packages/server/src/static-export-route-guards.test.ts packages/server/src/static-export-replay.test.ts packages/server/src/document.test.ts packages/server/src/endpoint.test.ts packages/browser/src/inline-loader-navigation.test.ts packages/cli/src/index.kovo-explain.test.ts`, `pnpm --dir tests/integration exec playwright test specs/respond-file.spec.ts`, and `rg -n -i "\\b(csv|tsv|spreadsheet|excel|formula)\\b|text/csv|orders\\.csv|inventory\\.csv" packages tests examples site docs -g '!node_modules' -g '!packages/icons/**'` verified spreadsheet export is absent from framework-owned helpers/examples/tests except disclaimer text.
- `sed -n '1,260p' SPEC.md`, `sed -n '360,1140p' SPEC.md`, and `sed -n '1290,1390p' SPEC.md` inspected the normative source/sink, wire, typed-surface, lifecycle, and diagnostic contracts.
- `sed -n '1,260p' plans/sql-injection.md` inspected the SQL-specific source/sink plan.
- `sed -n '1,260p' plans/fix-security.md` inspected prior non-SQL security remediation lanes.
- `rg -n "security|XSS|CSRF|csrf|sanitize|escape|trusted|raw|unsafe|script|style|cookie|header|redirect|endpoint|webhook|file|asset|upload|download|path|URL|url|href|src|innerHTML|outerHTML|HTML|json|JSON|CSP|content-security|nonce|origin|Host|Referer|referrer|Authorization|auth|session|credential|token|secret|eval|Function|import\\(|on:\\*|handler|params|search" SPEC.md` inspected normative source/sink vocabulary.
- `rg -n "innerHTML|outerHTML|insertAdjacentHTML|setAttribute\\(|href|srcdoc|trustedHtml|trustedUrl|safeUrl|sanitize|escapeHtml|escapeText|escapeAttribute|kovoBoundAttributeValue|javascript:|data:" packages tests examples site -g '!packages/icons/src/**'` inspected output sinks.
- `rg -n "headers\\.|new Headers|Set-Cookie|serializeCookie|cookies\\.set|Content-Disposition|Content-Type|nosniff|Location|redirect|safeSameOrigin|same-origin|same origin|normalizePathname|nodeRequestUrl" packages tests examples site` inspected header, cookie, redirect, and cache sinks.
- `rg -n "respond\\.(file|stream)|FileSchema|StoredFile|parseFile|contentType|mime|upload|download|storage|path\\.resolve|path\\.join|fs\\.|readFile|writeFile|createReadStream|sendFile|static" packages tests examples site -g '!packages/icons/src/**'` inspected file/storage/static-export sinks.
- `rg -n "endpoint\\(|webhook\\(|csrf:\\s*false|csrf|Origin|Sec-Fetch|signature|hmac|constantTime|rateLimit|pre-dispatch|body size|maxBody|Kovo-Idem|replay|idempot" packages tests examples conformance site -g '!packages/icons/src/**'` inspected ingress, CSRF, endpoint, webhook, and replay surfaces.
- `sed -n '1,220p' packages/core/src/internal/security-url.ts`, `sed -n '1,260p' packages/server/src/html.ts`, `sed -n '1,260p' packages/compiler/src/output-context-facts.ts`, and `sed -n '1,260p' packages/browser/src/security-output.ts` inspected shared output-safety implementations.
- `sed -n '1,340p' packages/server/src/response.ts`, `sed -n '1,260p' packages/server/src/cookies.ts`, `sed -n '1,260p' packages/server/src/app-load-shed.ts`, `sed -n '1,260p' packages/server/src/csrf.ts`, and `sed -n '1,260p' packages/server/src/match.ts` inspected server chokepoints.
