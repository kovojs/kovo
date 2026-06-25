# Runtime Backstops

Status: complete.

## Purpose

Add runtime defense-in-depth for unsafe output sinks so a missed compiler diagnostic fails closed
instead of becoming executable HTML, script, CSS, or navigation behavior.

This plan does not replace compiler enforcement. `KV236` and the compiler's contextual
output-safety checks remain the by-construction guarantee. Runtime backstops are a separate
fail-closed floor for server rendering, client updates, and generated runtime helpers.

## Policy

Runtime guards are sink-specific and shared across server and browser code paths. They reject the
dangerous operation before writing to the DOM or serialized HTML.

Default runtime posture follows `SPEC.md §4.8`:

- URL-bearing sinks allow relative URLs, same-document hashes, `http:`, `https:`, `mailto:`,
  `tel:`, and `ftp:`.
- `javascript:`, `vbscript:`, `file:`, malformed schemes, control-character-obfuscated schemes,
  and unreviewed `data:` URLs are blocked unless an explicit `trustedUrl(...)` value is used.
- String event-handler attributes such as `onclick` are blocked.
- Raw HTML sinks such as `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and `srcdoc` are blocked
  unless the value is a framework trusted-HTML value.
- Raw CSS text and CSS `url(...)` values are blocked unless parsed and proven safe for the sink.

Blocked writes fail closed and produce a redacted `KV236`-style runtime security event. Trusted
escape hatches can carry optional `reason`/`source` metadata for runtime inspection and explain
surfaces.

## Roadmap

### Phase 0: inventory and shared policy

- [x] Inventory every runtime sink that writes URLs, HTML, CSS, or event-handler attributes in the
      server renderer, browser runtime, mutation/update path, query refresh path, and generated
      helper surface.
  - Evidence: sinks covered are `packages/server/src/jsx-runtime.ts` render attributes/raw HTML,
    `packages/server/src/html.ts` safe attributes, `packages/browser/src/security-output.ts`
    bound attributes/style/trust wrappers, `packages/browser/src/query-bindings.ts` query/state
    writes and template stamps, `packages/browser/src/morph.ts` fragment adoption,
    `packages/browser/src/response-fragment-apply.ts` decoded fragments, and
    `packages/browser/src/inline-loader-build.ts`/`inline-loader.ts` generated helpers.
- [x] Create one shared internal sink-policy module for URL schemes and sink classification.
  - Evidence: `packages/core/src/internal/sink-policy.ts` is exported through
    `@kovojs/core/internal/sink-policy`; server/browser imports use it, and inline helpers carry
    the byte-budgeted generated equivalent.
- [x] Define the per-sink decision table for URL attributes, `srcset`, raw HTML, `srcdoc`, event
      attributes, CSS text, CSS properties, and trusted escape hatches.
  - Evidence: `pnpm exec vitest --configLoader runner --run packages/core/src/sink-policy.test.ts packages/browser/src/security-output.test.ts packages/server/src/jsx-runtime.test.ts`.

### Phase 1: URL sink backstops

- [x] Guard server-side serialization of URL-bearing attributes before HTML is emitted.
  - Evidence: `packages/server/src/jsx-runtime.test.ts` proves dynamic `href`/`src`
    `javascript:` values render as `#`.
- [x] Guard browser-side generated updates before `setAttribute`, property writes, or derived URL
      updates apply to the DOM.
  - Evidence: `packages/browser/src/query-bindings.test.ts` and
    `packages/browser/src/inline-loader-security.test.ts` prove unsafe query/state URL updates
    are neutralized before writes.
- [x] Add a dedicated `srcset` parser/guard instead of treating `srcset` as a plain URL string.
  - Evidence: `packages/core/src/sink-policy.test.ts`,
    `packages/server/src/jsx-runtime.test.ts`, and
    `packages/browser/src/security-output.test.ts` cover mixed safe/unsafe candidates and
    all-unsafe candidate lists.
- [x] Add policy tests for obfuscated schemes, whitespace/control characters, casing, percent-ish
      encodings, and absolute/relative URL edge cases.
  - Evidence: `pnpm exec vitest --configLoader runner --run packages/core/src/security-url.test.ts packages/core/src/sink-policy.test.ts`.

### Phase 2: HTML, event, and CSS sink backstops

- [x] Block runtime serialization and browser writes of string `on*` event-handler attributes.
  - Evidence: `packages/server/src/html.test.ts`, `packages/server/src/jsx-runtime.test.ts`,
    `packages/browser/src/security-output.test.ts`, and `packages/browser/src/query-bindings.test.ts`
    cover lowercase and mixed-case event sinks.
- [x] Block runtime writes to `srcdoc` and raw HTML sinks unless the value is trusted HTML.
  - Evidence: `packages/server/src/jsx-runtime.test.ts` covers trusted and untrusted raw HTML;
    `packages/browser/src/query-bindings.test.ts`,
    `packages/browser/src/response-fragment-apply.browser.test.ts`, and
    `packages/browser/src/inline-loader-response-apply.browser.test.ts` cover untrusted
    `srcdoc`/`innerHTML` removal.
- [x] Guard raw CSS text and CSS `url(...)` values in server and client output paths.
  - Evidence: `packages/core/src/sink-policy.test.ts`,
    `packages/server/src/html.test.ts`, `packages/server/src/jsx-runtime.test.ts`, and
    `packages/browser/src/security-output.test.ts` cover unsafe CSS URLs and safe CSS property
    updates.
- [x] Make trusted escape hatches auditable at runtime.
  - Evidence: `packages/browser/src/security-output.test.ts` asserts `trustedHtml(...)` and
    `trustedUrl(...)` carry optional `reason`/`source` metadata while preserving existing brands.

### Phase 3: failure behavior and observability

- [x] Define consistent dev and production failure behavior for each sink family.
  - Evidence: `packages/core/src/sink-policy.test.ts` asserts the decision table; server/browser
    tests above assert fail-closed output by sink family.
- [x] Add structured runtime security events for blocked sink writes without leaking attacker data.
  - Evidence: `packages/core/src/sink-policy.test.ts` asserts `KV236` event `message`, `reason`,
    sink family, action, and redacted value preview.
- [x] Ensure runtime backstops cannot mask compiler regressions in tests.
  - Evidence: `pnpm exec vitest --configLoader runner --run packages/compiler/src/output-context-security.test.ts` passed and still expects `KV236` for statically known unsafe author input.

### Phase 4: integration gates

- [x] Add end-to-end SSR coverage for unsafe URL, event, HTML, `srcdoc`, and CSS values.
  - Evidence: `packages/server/src/jsx-runtime.test.ts` inspects rendered bytes for URL, event,
    raw HTML, `srcdoc`, and CSS sinks.
- [x] Add end-to-end client update coverage for the same sink families.
  - Evidence: `packages/browser/src/inline-loader-security.test.ts`,
    `packages/browser/src/query-bindings.test.ts`, and
    `packages/browser/src/security-output.test.ts` prove unsafe query/state updates fail closed.
- [x] Add mutation/query response coverage so runtime backstops apply after partial refreshes.
  - Evidence: `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/mutation-response-dom.browser.test.ts packages/browser/src/response-fragment-apply.browser.test.ts packages/browser/src/inline-loader-response-apply.browser.test.ts`.
- [x] Document the boundary: compiler checks are by-construction, runtime backstops are
      defense-in-depth.
  - Evidence: Purpose and policy sections above cite `SPEC.md §4.8` and explicitly label runtime
    guards as fail-closed floors, not a replacement for `KV236`.

## Acceptance Bar

- [x] A missed compiler `href="javascript:..."` case cannot produce a clickable unsafe link in SSR,
      client updates, mutation refreshes, or query refreshes.
  - Evidence: server JSX, browser query/inline, mutation fragment, and query response tests listed
    in Phases 1 and 4.
- [x] String event handlers cannot be serialized or written by generated runtime paths.
  - Evidence: event-sink tests listed in Phase 2.
- [x] Raw HTML and `srcdoc` cannot be serialized or written without a trusted-HTML value.
  - Evidence: raw HTML/`srcdoc` tests listed in Phase 2.
- [x] CSS text and CSS URL sinks fail closed for unsafe values.
  - Evidence: CSS tests listed in Phase 2.
- [x] Runtime backstops use one shared policy, not divergent server/browser allowlists.
  - Evidence: `@kovojs/core/internal/sink-policy` is imported by server/browser paths; inline
    helpers carry the budgeted generated equivalent and `check:inline-loader` passed.
- [x] Development failures are loud enough to debug, and production failures are safe by default.
  - Evidence: `RuntimeSinkSecurityEvent.message` carries `KV236`/sink/action/reason; callers
    fail closed by removal or inert `#` in the tests above.
- [x] Compiler diagnostics remain required and tested; runtime backstops are not used as a reason to
      weaken `KV236` or contextual output-safety coverage.
  - Evidence: `packages/compiler/src/output-context-security.test.ts` still passes with existing
    `KV236` assertions.

## Latest Verification

- `pnpm --filter @kovojs/browser run build:inline-loader` and
  `pnpm --filter @kovojs/browser run check:inline-loader` passed.
- `pnpm exec vitest --configLoader runner --run packages/core/src/sink-policy.test.ts packages/core/src/security-url.test.ts packages/server/src/html.test.ts packages/server/src/jsx-runtime.test.ts packages/browser/src/security-output.test.ts packages/browser/src/inline-loader-security.test.ts packages/browser/src/query-bindings.test.ts packages/browser/src/response-fragment-apply.test.ts packages/browser/src/inline-loader-build.test.ts packages/browser/src/inline-loader-artifact-minifier.test.ts packages/browser/src/inline-loader-response-apply-extract.test.ts packages/browser/src/inline-loader-response-apply-runtime.test.ts` passed.
- `pnpm exec vitest --config vitest.browser.config.ts --run packages/browser/src/response-fragment-apply.browser.test.ts packages/browser/src/mutation-response-dom.browser.test.ts packages/browser/src/inline-loader-response-apply.browser.test.ts` passed.
- `pnpm exec vitest --configLoader runner --run packages/compiler/src/output-context-security.test.ts` passed.
- `pnpm --filter @kovojs/core run build:dist`, `pnpm --filter @kovojs/server run build:dist`,
  and `pnpm --filter @kovojs/browser run build:dist` passed.
- `pnpm run check:api-surface` passed.
- `git diff --check` passed.
