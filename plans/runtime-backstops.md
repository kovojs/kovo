# Runtime Backstops

Status: active plan.

## Purpose

Add runtime defense-in-depth for unsafe output sinks so a missed compiler diagnostic fails closed
instead of becoming executable HTML, script, CSS, or navigation behavior.

This plan does not replace compiler enforcement. `KV236` and the compiler's contextual
output-safety checks remain the by-construction guarantee. Runtime backstops are a separate
fail-closed floor for server rendering, client updates, and generated runtime helpers.

## Policy

Runtime guards should be sink-specific and shared across server and browser code paths. They should
reject the dangerous operation before writing to the DOM or serialized HTML.

Default runtime posture:

- URL-bearing sinks allow relative URLs, same-document hashes, and `http:`/`https:`.
- Link-only schemes such as `mailto:` and `tel:` require an explicit per-attribute policy.
- `javascript:`, `vbscript:`, `file:`, malformed schemes, control-character-obfuscated schemes,
  and unreviewed `data:` URLs are blocked.
- String event-handler attributes such as `onclick` are blocked.
- Raw HTML sinks such as `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and `srcdoc` are blocked
  unless the value is a framework trusted-HTML value.
- Raw CSS text and CSS `url(...)` values are blocked unless parsed and proven safe for the sink.

Development should fail loud with a diagnostic-style message. Production should fail closed by
omitting the write, writing an inert value, or returning a safe error response, with optional
structured security logging.

## Roadmap

### Phase 0: inventory and shared policy

- [ ] Inventory every runtime sink that writes URLs, HTML, CSS, or event-handler attributes in the
      server renderer, browser runtime, mutation/update path, query refresh path, and generated
      helper surface.
  - Evidence needed: file/function list naming each sink and the current writer.
- [ ] Create one shared internal sink-policy module for URL schemes and sink classification.
  - Evidence needed: server and browser code import the same policy or generated equivalent.
- [ ] Define the per-sink decision table for URL attributes, `srcset`, raw HTML, `srcdoc`, event
      attributes, CSS text, CSS properties, and trusted escape hatches.
  - Evidence needed: tests cover allowed and blocked examples for every sink family.

### Phase 1: URL sink backstops

- [ ] Guard server-side serialization of URL-bearing attributes before HTML is emitted.
  - Evidence needed: SSR test where `href="javascript:alert(1)"` is omitted or inerted.
- [ ] Guard browser-side generated updates before `setAttribute`, property writes, or derived URL
      updates apply to the DOM.
  - Evidence needed: client runtime test where a query/state update cannot write an unsafe `href`.
- [ ] Add a dedicated `srcset` parser/guard instead of treating `srcset` as a plain URL string.
  - Evidence needed: mixed safe/unsafe `srcset` candidates are parsed and unsafe candidates fail.
- [ ] Add policy tests for obfuscated schemes, whitespace/control characters, casing, percent-ish
      encodings, and absolute/relative URL edge cases.
  - Evidence needed: focused unit tests for the shared URL guard.

### Phase 2: HTML, event, and CSS sink backstops

- [ ] Block runtime serialization and browser writes of string `on*` event-handler attributes.
  - Evidence needed: SSR and client-update tests for lowercase and mixed-case event attributes.
- [ ] Block runtime writes to `srcdoc` and raw HTML sinks unless the value is trusted HTML.
  - Evidence needed: tests for untrusted `srcdoc`, `innerHTML`, and trusted-HTML allowed paths.
- [ ] Guard raw CSS text and CSS `url(...)` values in server and client output paths.
  - Evidence needed: unsafe CSS URL tests fail closed, safe CSS property updates still work.
- [ ] Make trusted escape hatches auditable at runtime.
  - Evidence needed: trusted values carry source/reason metadata in dev or explain output.

### Phase 3: failure behavior and observability

- [ ] Define consistent dev and production failure behavior for each sink family.
  - Evidence needed: tests assert dev failure messages and production fail-closed output.
- [ ] Add structured runtime security events for blocked sink writes without leaking attacker data.
  - Evidence needed: tests assert event shape and redaction.
- [ ] Ensure runtime backstops cannot mask compiler regressions in tests.
  - Evidence needed: compiler tests still expect `KV236` for statically known unsafe author input.

### Phase 4: integration gates

- [ ] Add end-to-end SSR coverage for unsafe URL, event, HTML, `srcdoc`, and CSS values.
  - Evidence needed: integration tests inspect rendered bytes and confirm no executable sink.
- [ ] Add end-to-end client update coverage for the same sink families.
  - Evidence needed: browser/runtime tests prove unsafe query or state updates fail closed.
- [ ] Add mutation/query response coverage so runtime backstops apply after partial refreshes.
  - Evidence needed: enhanced mutation and `/_q` tests cannot patch unsafe sink values.
- [ ] Document the boundary: compiler checks are by-construction, runtime backstops are
      defense-in-depth.
  - Evidence needed: docs or SPEC-adjacent note labels this distinction explicitly.

## Acceptance Bar

- [ ] A missed compiler `href="javascript:..."` case cannot produce a clickable unsafe link in SSR,
      client updates, mutation refreshes, or query refreshes.
- [ ] String event handlers cannot be serialized or written by generated runtime paths.
- [ ] Raw HTML and `srcdoc` cannot be serialized or written without a trusted-HTML value.
- [ ] CSS text and CSS URL sinks fail closed for unsafe values.
- [ ] Runtime backstops use one shared policy, not divergent server/browser allowlists.
- [ ] Development failures are loud enough to debug, and production failures are safe by default.
- [ ] Compiler diagnostics remain required and tested; runtime backstops are not used as a reason to
      weaken `KV236` or contextual output-safety coverage.
