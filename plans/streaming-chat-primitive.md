# Plan: Streaming chat primitive

Created 2026-06-18. Behavioral source of truth is `SPEC.md`. This plan proposes
a Kovo-native streaming mutation primitive for chat-style token rendering while
preserving Kovo's mutation, fragment, guard, CSRF, idempotency, and server-truth
contracts.

## Goal

Let authors build ChatGPT-style message streaming without dropping to ad-hoc
client DOM mutation or a custom JSON/text wire protocol.

The user submits a real Kovo mutation form. The server answers with an
incremental response whose chunks reuse the existing wire vocabulary wherever
possible:

- append the submitted user message as a `<kovo-fragment mode="append">`
- append an assistant message shell as a fragment
- append escaped text into a declared stream source target
- optionally notify a declared sink renderer, such as an app-authored Markdown renderer
- finish by reconciling with canonical server-rendered HTML

When JS is absent, the same mutation remains a normal POST-redirect-GET or
failure render. When streaming is unsupported or interrupted, the runtime falls
back to the existing server-truth path rather than leaving unverified client
state as the final UI.

## Existing Baseline

- [x] **Document the current escape hatch.**
  - Today `route()` can return `respond.stream(...)` for raw streamed bodies
    (`SPEC.md` §6.4), and raw `endpoint()` can return a `Response` with a
    `ReadableStream`. This is enough to hand-build chat streaming with a client
    island, but it bypasses the enhanced mutation apply path.
  - Evidence: `SPEC.md` §6.4 now states `respond.stream()` and raw endpoints are
    app-owned streaming protocols outside enhanced mutation apply/query truth.
- [x] **Document the current Kovo deferred stream boundary.**
  - `renderDeferredStream(...)` and `<kovo-defer>` stream first-render
    fragments (`SPEC.md` §8, §9.1). They are not a post-submit token streaming
    primitive; runtime programmatic apply currently consumes a completed string,
    while initial document streaming uses inline chunk scripts.
  - Evidence: `SPEC.md` §8 now distinguishes `<kovo-defer>` first-render
    streaming from mutation response streaming.
- [x] **Keep SSE out of the MVP.**
  - `SPEC.md` mentions SSE live queries as L4/future transport, while
    `fixtures/wire/README.md` says the SSE fixture is intentionally absent.
    Chat response streaming should be a single POST response stream, not a live
    subscription system.
  - Evidence: `SPEC.md` §8 says chat-style post-submit streams are not SSE and
    are one enhanced mutation POST response.

## Required SPEC Reconciliation

- [x] **Add a streaming mutation response contract.**
  - Amend `SPEC.md` §6.3/§9.1/§9.2 to define an enhanced mutation response that
    may be applied incrementally from `ReadableStream` chunks. The non-streaming
    mutation contract remains the default and the no-JS path remains a real
    form submission.
  - Evidence: `SPEC.md` §9.1 defines incremental enhanced mutation response
    application from `ReadableStream` wire elements.
- [x] **Define the stream text primitive.**
  - Add a narrowly scoped `<kovo-text target="..." mode="append">...</kovo-text>`
    for escaped text append into a compiler/runtime-declared stream source. The
    primitive appends text, not raw HTML, and must not target arbitrary
    selectors.
  - Evidence: `SPEC.md` §9.1 defines `<kovo-text>` against `data-stream-text`;
    `corepack pnpm exec vitest --run packages/browser/src/wire-parser.test.ts packages/browser/src/mutation-response-apply.test.ts --reporter verbose`.
- [x] **Reaffirm server truth.**
  - A stream may show incremental text and renderer-updated presentation, but
    the final successful chunk must reconcile the affected assistant message or
    message list with server-rendered HTML or query truth. Text append is a
    progressive rendering path, not a new source of authority.
  - Evidence: `SPEC.md` §9.1 says streamed text is progressive rendering and the
    final successful chunk must reconcile with ordinary fragment/query truth.
- [x] **Specify interruption semantics.**
  - If the stream aborts, disconnects, fails validation, or hits a guard/session
    failure, the runtime marks the form/message as failed or refetches the
    affected target. It must not silently present a partial assistant answer as
    confirmed server truth.
  - Evidence: `SPEC.md` §9.1 defines interruption/failure/skew recovery as
    failed UI or refetch/navigation to server truth.
- [x] **Define no-JS and deploy-skew behavior.**
  - Without JS, the mutation uses the existing PRG/failure route. With build-token
    skew, the runtime discards the streaming path and refetches or navigates to
    server truth, following the `SPEC.md` §9.1.1 render-plan token posture.
  - Evidence: `SPEC.md` §9.1 states no-JS and non-stream-opted forms stay on the
    existing PRG or buffered enhanced mutation path, and skew must recover to
    server truth.

## Proposed Author API

- [ ] **Streaming mutation authoring.**
  - Add one streaming declaration shape, tentatively `async *stream(...)`, to
    `mutation(...)`. The regular `handler(...)` remains the canonical
    non-streaming/no-JS behavior, or the framework derives the final commit path
    from the same implementation only when the contract is unambiguous.
  - Evidence: pending type tests.
- [ ] **Stream chunk builders.**
  - Add typed server helpers, tentatively `stream.fragment(...)`,
    `stream.text(...)`, `stream.query(...)`, and `stream.done(...)`. These emit
    the same legible wire chunks the runtime consumes.
  - Evidence: pending public API baseline diff and server unit tests.
- [ ] **Form opt-in syntax.**
  - Define author TSX syntax, tentatively `<form enhance stream
mutation={sendMessage}>`, lowering to a real form plus a streaming-enhanced
    submit path. The absence of `stream` uses today's buffered enhanced mutation
    apply.
  - Evidence: pending compiler fixture and runtime submit test.
- [ ] **Target declaration for stream text sources.**
  - Define how a rendered component exposes a stream source target. Candidate
    spelling: `data-stream-text="message-markdown:a1"` on an element whose text
    source is appendable by `<kovo-text>`. App code must not rely on arbitrary
    CSS selectors.
  - Evidence: pending compiler fixture and DOM target validation tests.
- [ ] **Optional stream sink renderer contract.**
  - Define how a component can declare an app/client-module renderer for the
    accumulated stream source, tentatively
    `data-stream-renderer="/c/markdown.client.js#renderMarkdownStream"`. Kovo
    buffers and delivers escaped text; the component owns Markdown, log, JSON,
    transcript, or other presentation behavior.
  - Evidence: pending runtime renderer hook tests and docs example.

## Proposed Wire Shape

- [x] **Fragment append remains the message-row primitive.**
  - User messages and assistant shells should be appended with existing
    `<kovo-fragment target="messages:c1" mode="append">...</kovo-fragment>`
    semantics from `SPEC.md` §9.1.
  - Evidence: `packages/browser/src/mutation-response-apply.test.ts` streams an
    assistant shell with `<kovo-fragment mode="append">` before `<kovo-text>`.
- [x] **Text append is escaped and target-scoped.**
  - Token chunks use escaped text payloads and append only to a validated stream
    source target. A sink renderer may re-render presentation from the
    accumulated source, but Kovo never inserts streamed model output as raw HTML.
  - Evidence: `packages/browser/src/wire-parser.test.ts` and
    `packages/browser/src/mutation-response-apply.test.ts` cover escaped
    HTML-looking `<kovo-text>` payloads and `data-stream-text` target lookup.
- [ ] **High-volume text append is coalesced.**
  - The wire/runtime must support many model tokens without one DOM write per
    token. `stream.text(...)` yields may be coalesced into larger `<kovo-text>`
    chunks by the server adapter, and the runtime buffers incoming text per
    stream source before flushing to the DOM or sink renderer.
  - Evidence: pending runtime batching tests and browser performance fixture.
- [x] **Checkpoint chunks are allowed for long streams.**
  - Long-running streams may send a checkpoint with canonical source text so far,
    letting the runtime replace accumulated text with server-confirmed content
    before final message reconciliation.
  - Evidence: `packages/browser/src/mutation-response-apply.test.ts` verifies
    `mode="checkpoint"` replaces accumulated source text before later appends.
- [ ] **Final reconciliation uses existing fragment/query machinery.**
  - Completion sends a canonical `<kovo-fragment>` or `<kovo-query>` update for
    the assistant message or full message list. The final state must be
    equivalent to a non-streaming mutation response.
  - Evidence: pending render-equivalence test.
- [ ] **Errors use the existing mutation failure vocabulary.**
  - Validation and typed mutation failures should still re-render the submitted
    form target with typed failure state. Mid-stream generation failures need a
    declared error chunk that the same form/error policy can handle.
  - Evidence: pending failure wire fixture and runtime test.

## Load-Bearing Invariants

- [x] **No custom JSON/text side channel for Kovo-owned UI.**
  - Raw `respond.stream(...)` remains available for app-specific protocols, but
    Kovo-native chat streaming must use Kovo chunks so the Network panel remains
    self-describing (`SPEC.md` Constitution #4).
  - Evidence: `SPEC.md` §6.4 and §9.1 define raw streams as escape hatches and
    Kovo-native chat streaming as mutation wire chunks.
- [x] **No raw streamed HTML from model output.**
  - Fancy output such as Markdown tables, code blocks, images, citations, and
    attachments must flow through a trusted component renderer or final
    server-rendered reconciliation. The runtime must not insert model-supplied
    HTML chunks directly into the document.
  - Evidence: `packages/browser/src/mutation-response-apply.test.ts` verifies
    HTML-looking streamed payloads remain textContent, not inserted HTML.
- [ ] **Text flushing is bounded and deterministic.**
  - The default flush policy should be framework-owned: flush on a short time
    budget, a byte/character threshold, a checkpoint, completion, or error.
    Apps may tune coarse latency/throughput policy later, but ordinary chat
    should not hand-author per-token throttling.
  - Evidence: pending unit tests with fake timers and a no-layout-thrash browser
    assertion.
- [ ] **CSRF, guards, session, replay, and idempotency still run first.**
  - The server must validate the mutation request before streaming user-visible
    assistant chunks. Duplicate idempotency keys must not create duplicate
    message rows or duplicate generation jobs.
  - Evidence: pending server tests for guard, CSRF, and replay.
- [ ] **Targets are derived or registry-checked.**
  - `messages:c1` and `assistant-message:a1` must be validated against the same
    fragment/live-target model as other mutation responses. Streaming must not
    introduce hand-authored global selectors.
  - Evidence: pending compiler/runtime target tests.
- [ ] **Abort is structural.**
  - User cancellation, navigation, island removal, or request disconnect should
    abort the generation signal and close the response. Removed islands must not
    continue receiving chunks.
  - Evidence: pending browser abort and island-removal tests.
- [ ] **Accessibility is part of the primitive.**
  - The recommended assistant shell must support `aria-live`/status semantics
    without spamming announcements per token. Define default guidance and tests
    for screen-reader-stable message updates.
  - Evidence: pending accessibility rule/docs and browser semantic snapshot.

## Implementation Plan

- [ ] **0. Contract gate.**
  - Land SPEC edits for streaming mutation responses, `<kovo-text>`, optional
    sink renderers, final reconciliation, no-JS behavior, interruption, and skew
    handling before implementation.
  - Evidence: pending.
- [x] **1. Wire parser and apply path.**
  - Extend the shared runtime response scanner/parser to recognize incremental
    stream chunks and `<kovo-text>`, then add an async apply API over
    `ReadableStream<Uint8Array>` that applies chunks as they arrive.
  - Evidence: `corepack pnpm exec vitest --run packages/browser/src/wire-parser.test.ts packages/browser/src/mutation-response-apply.test.ts --reporter verbose`; `corepack pnpm exec tsc --noEmit --pretty false`.
- [ ] **2. Runtime text buffering and checkpoints.**
  - Maintain per-stream-source text buffers, coalesce appends, flush with
    fake-timer testability, and support checkpoint replace semantics for long
    streams.
  - Evidence: pending runtime batching/checkpoint tests.
- [ ] **3. Runtime sink renderer hook.**
  - When a stream source declares a renderer, call the referenced client module
    with the target element, accumulated source text, and abort signal on
    coalesced flushes. Renderer failures must surface through the same streaming
    error policy and must not corrupt the source buffer.
  - Evidence: pending renderer hook tests.
- [ ] **4. Runtime enhanced submit integration.**
  - Add a streaming submit path for opted-in forms. It should set streaming
    accept headers, read `response.body`, apply chunks incrementally, publish
    query events, preserve pending/error behavior, and fall back cleanly.
  - Evidence: pending runtime submit tests and browser fixture.
- [ ] **5. Server streaming mutation response.**
  - Add server support for async chunk emission from mutations after CSRF,
    schema, guard, idempotency, and replay checks. Preserve the existing
    buffered mutation path for ordinary enhanced forms.
  - Evidence: pending `packages/server` mutation stream tests.
- [ ] **6. Server text coalescing policy.**
  - Coalesce many small `stream.text(...)` yields into larger wire chunks using a
    deterministic default policy such as 25-50ms, 1-4KB, checkpoint,
    completion, or error. The exact numbers belong in SPEC/tests before coding.
  - Evidence: pending server fake-timer/coalescing tests.
- [ ] **7. Compiler authoring support.**
  - Lower `<form enhance stream mutation={...}>`, stream text targets, and
    optional stream renderer refs into authorable IR. Reject unvalidated or
    ambiguous stream targets with teaching diagnostics.
  - Evidence: pending compiler fixtures and fixpoint tests.
- [ ] **8. Chat reference fixture.**
  - Add a small chat fixture proving user-message append, assistant-shell append,
    Markdown source streaming, app-authored Markdown renderer updates for
    tables/code/images, high-volume text coalescing, checkpoint replacement,
    final reconciliation, abort, and failure behavior.
  - Evidence: pending integration browser spec.
- [ ] **9. Docs and examples.**
  - Add a guide section comparing raw `respond.stream(...)`, first-render
    `<kovo-defer>`, and streaming mutations. Include the chat example and the
    recommended accessibility pattern.
  - Evidence: pending docs build and link check.

## Proving Commands

- [x] SPEC/API contract: `corepack pnpm run check:api-surface`
  - Evidence: passed with `api-surface/v1 public-exports-needing-attention=1571 (baseline=1571)`.
- [x] runtime parser/apply: `corepack pnpm exec vitest --run packages/browser/src/wire-parser.test.ts packages/browser/src/mutation-response-apply.test.ts --reporter verbose`
  - Evidence: 2 files / 32 tests passed.
- [ ] runtime text batching/checkpoints: pending targeted `packages/browser` test file
- [ ] runtime sink renderer hook: pending targeted `packages/browser` test file
- [ ] runtime streaming submit: pending targeted `packages/browser` test file
- [ ] server text coalescing: pending targeted `packages/server` test file
- [ ] server streaming mutation path: pending targeted `packages/server` test file
- [ ] compiler lowering/fixpoint: pending targeted `packages/compiler` test file
- [ ] chat browser fixture: pending `tests/integration/specs/streaming-chat.spec.ts`
- [ ] root import/build gates after implementation: `pnpm run check && pnpm run test`

## Open Design Questions

- [ ] **Do streaming mutations require both `handler` and `stream`, or can one
      async generator define both streaming and no-JS behavior?**
  - Bias: keep a clear non-streaming final server-truth path until equivalence is
    proven.
- [ ] **Should typed blocks exist later?**
  - Bias: keep typed blocks out of the MVP. Revisit only after the generic
    stream-source plus sink-renderer contract proves insufficient.
- [ ] **How does Markdown render during streaming?**
  - Bias: Markdown is not special to Kovo. Stream escaped source text into a
    declared target; an app/component-library renderer reparses on coalesced
    flushes; the final server-rendered fragment reconciles the canonical HTML.
- [ ] **Where does generation persistence happen?**
  - Bias: the framework owns transport and UI reconciliation only. Apps own model
    calls, message persistence, retry policy, and moderation/domain rules.
