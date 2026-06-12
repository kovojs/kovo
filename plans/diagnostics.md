# Diagnostics Surfacing — dev loop, build gate, and agent surface

Status: in progress; designed 2026-06-11
Scope: how FW diagnostics reach humans and agents — the Vite dev transform, the build/static-export
gate, dev-mode error documents, and an MCP surface. No new FW codes and no changes to diagnostic
content or severities (SPEC §11.3 owns those); `fw check`/`fw explain` semantics and their frozen
`fw-check/v1`/`fw-explain/v1` output formats are out of scope.

## Progress checklist

- [x] SPEC PR: normative surfacing policy (severity → blocking behavior per surface) landed.
      Evidence 2026-06-12: SPEC §11.3 now makes shared `diagnosticDefinitions` the source of
      severity, states that `error` blocks Vite dev transform, build, and static export, requires
      dev teaching-error documents with HTTP 500 for failed-module page/fragment/mutation requests,
      keeps `warn`/`lint`/`notice` non-blocking, and defines MCP as a structured rendering/query
      surface over existing compile/check/explain diagnostics rather than a second channel.
- [x] V1 Vite dev: `transform` fails on `error`-severity diagnostics with formatted teaching
      errors (`file:line:col`, message, help/fix menu), surfaced by Vite's overlay + terminal.
- [x] V2 Vite dev: non-blocking channel for `warn`/`lint`/`notice` diagnostics.
- [x] V3 build/static export: `error` diagnostics fail `vp build` and the D8 R6 static export
      unconditionally — no `ignoreBuildErrors`-style escape hatch.
- [x] E1 server: dev-only teaching-error document renderer (FW code, message, fix menu, source
      frame) reusing the document assembly pipeline.
      Evidence 2026-06-12: `packages/server/src/document.ts` exports
      `renderDiagnosticDocument()` from `@jiso/server`, returning a deterministic HTTP 500 HTML
      document assembled through `renderDocument()` with FW code, shared SPEC §11.3 severity,
      escaped message, fix menu, optional location, and optional source frame. Same-session
      evidence: `pnpm exec vitest --run packages/server/src/shell.test.ts` and
      `pnpm exec vp check packages/server/src/document.ts packages/server/src/index.ts packages/server/src/shell.test.ts plans/diagnostics.md`.
- [x] E2 dev middleware: page/fragment/mutation requests against a module with `error`
      diagnostics answer with the diagnostic document (500), covering the requests a
      client-injected overlay cannot see (direct navigation, no-JS form posts, fragment fetches).
      Evidence 2026-06-12: page-route slice landed. `createJisoAppShellDevDiagnosticLedger()`
      records per-module diagnostics keyed by compiler source file/client-module href and
      `jisoAppShellVitePlugin(..., { devDiagnostics })` returns the E1
      `renderDiagnosticDocument()` HTTP 500 before the app handler for matched page routes whose
      `modulepreloads` depend on failed modules. `createJisoVitePlugin()` now reports each
      component transform through `onModuleDiagnostics` before throwing on shared-registry
      `error` diagnostics, so Vite overlay blocking and app-shell document rendering can share one
      ledger. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/vite.test.ts`,
      `pnpm exec vitest --run packages/compiler/src/index.test.ts --testNamePattern "jisoVitePlugin"`,
      and
      `pnpm exec vp check packages/server/src/vite.ts packages/server/src/index.ts packages/server/src/vite.test.ts packages/compiler/src/vite.ts packages/compiler/src/index.ts packages/compiler/src/index.test.ts plans/diagnostics.md`.
      Additional evidence 2026-06-12: mutation request dependency mapping now uses the same
      dev diagnostic ledger via explicit module hrefs such as `/_m/cart/add`; enhanced mutation
      requests with `FW-Fragment: true` receive a `text/vnd.jiso.fragment+html` HTTP 500
      `<fw-fragment>` carrying the diagnostic document, while no-JS mutation POSTs receive the
      HTTP 500 diagnostic document before app mutation dispatch. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/vite-diagnostics.test.ts packages/server/src/vite.test.ts`
      and `pnpm exec vp check packages/server/src/vite.ts packages/server/src/vite-diagnostics.test.ts`.
- [x] M1a `fw mcp`: stdio-compatible JSON-RPC line server exposing compile/check/explain as
      structured tools wrapping the existing public APIs — no second diagnostic channel.
- [x] M1b SDK-backed MCP adapter using `@modelcontextprotocol/sdk` over stdio once the dependency
      and protocol lifecycle are accepted for `fw`.
      Evidence 2026-06-12: `fw mcp` now lazy-loads `@modelcontextprotocol/sdk` and connects an
      SDK `Server` to `StdioServerTransport`, with MCP `initialize`, advertised tools capability,
      `tools/list`, and `tools/call` lifecycle covered by an in-memory SDK transport test.
      Existing object-level JSON-RPC fallback tests still exercise the shared tool dispatch and
      the newline-delimited fallback stdio seam remains covered. Same-session evidence:
      `pnpm exec vitest --run packages/cli/src/index.test.ts` and
      `pnpm exec vp check packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json plans/diagnostics.md pnpm-lock.yaml`.
- [x] M2 in-memory compile tool contract documented and versioned (`compile/v1`), proving the
      generate→compile→repair loop works before a file touches disk.
- [ ] Gate wiring: seeded-diagnostic fixtures prove each surface red/green behaviorally (per the
      round-2 Phase 1 rule: behavior, never source-text grepping).
      Evidence 2026-06-12: page-route dev middleware gate now has a focused red/green test in
      `packages/server/src/vite-diagnostics.test.ts`: a seeded FW225 error diagnostic returns the
      E1 diagnostic document with HTTP 500 for a matching page modulepreload, then a same-module
      FW210 lint diagnostic clears the ledger and the app route returns HTTP 200. Same-session
      evidence: `pnpm exec vitest --run packages/server/src/vite-diagnostics.test.ts`.
      Additional evidence 2026-06-12: the same focused gate now seeds a mutation module href and
      proves both the enhanced fragment response and no-JS POST response return diagnostic HTTP
      500s before app dispatch. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/vite-diagnostics.test.ts packages/server/src/vite.test.ts`.

## Background

`jisoVitePlugin().transform` (`packages/compiler/src/vite.ts:71-87`) calls
`compileComponentModule` and discards `result.diagnostics` entirely: a component with
FW201/FW225/FW227 errors compiles to whatever the pipeline produced and is served. SPEC's posture
is "compile error, not runtime surprise" (§4.2's FW225 rationale), and Constitution #5 (SPEC §2)
makes teaching errors the product — so the current dev loop silently drops the product.

The policy layer already exists and needs no new design:
`DiagnosticSeverity = 'error' | 'warn' | 'lint' | 'notice'`
(`packages/core/src/diagnostics.ts:1`), assigned per FW code in the shared
`diagnosticDefinitions` registry and the SPEC §11.3 table; compiler diagnostics carry optional
`line`/`column` positions. What is missing is rendering, not policy.

### Decision: severity is decided once; surfaces only render

Recorded so we don't relitigate. Blocking behavior is a pure function of (severity, surface),
derived from `diagnosticDefinitions` — no surface gets its own opinion about what blocks:

| Severity          | `vp dev` (transform)           | `vp build` / static export | dev document (E) | MCP (M)    |
| ----------------- | ------------------------------ | -------------------------- | ---------------- | ---------- |
| `error`           | transform throws → overlay     | build fails                | rendered, 500    | structured |
| `warn`            | non-blocking channel           | non-blocking summary       | not rendered     | structured |
| `lint` / `notice` | non-blocking channel (quieter) | non-blocking summary       | not rendered     | structured |

`fw check` already derives its exit code from structured findings and is not changed by this
plan. Prior art informing the table: Next.js and Svelte block dev on compile errors via the
overlay; the React Compiler's silent per-component bail-out is the one model jiso cannot borrow,
because its compilation is an optional optimization while jiso's is semantic (stamps,
invalidation sets, and morph identity are the behavior). TanStack-style editor types remain
jiso's zero-latency channel and are already in place (FW310 via `OptimisticFor`, FW221 via the
IDREF registry).

### Decision: blocking transform, no last-good serving

When a module has `error` diagnostics, dev does not serve stale last-good IR with an overlay on
top (Next.js Fast Refresh does this; jiso must not). Served HTML, registry facts, morph identity,
and invalidation sets must agree — serving old IR against new source is exactly the drift the
fixpoint and registry-atomicity rules (SPEC §5.2.6) exist to prevent. The error-tolerant parser
keeps producing rich diagnostics on mid-edit code; tolerance lives at diagnostic production, not
at serving.

### Decision: server-rendered dev error documents, not an injected client overlay

Jiso is SSR-first with no client framework; Vite's overlay only appears on pages whose module
graph imports the failed module through Vite. Direct navigations, no-JS form posts (the §6.3
fallback), and fragment/mutation requests need the dev server itself to answer with a teaching
error document. Host: the D8 app-shell dev middleware (`plans/app-shell.md` R5, landed). Strictly
dev-only — production builds have already failed at V3 before this path could be reached.

### Decision: MCP wraps existing APIs, stdio-first

The MCP surface is the agent-facing query interface, not a new diagnostic channel: tools call the
same `compileComponentModule`/`fwCheck`/`fwExplain` the CLI and gates use, and return the same
structured diagnostics (code, severity, message, help, position). The differentiating tool is
in-memory compile — generate → compile → read fix menu → regenerate, before any file exists —
which is the Dyad verifiable-generation-target loop; teaching errors' fix menus are repair
prompts by construction. Precedent: Next.js 16 ships an MCP endpoint in the dev server by
default (`/_next/mcp`, `get_errors`). We start with stdio (`fw mcp`) because it needs no running
dev server and works with today's agent harnesses; a dev-server-attached endpoint is a possible
follow-up after D8 R7 adoption, not v1 scope.

## Phase V — Vite dev + build gate (do first; fixes a live correctness hole)

- [x] **V1 — transform fails on `error` diagnostics.** In `createJisoVitePlugin`: after compile,
      partition `result.diagnostics` by severity from `diagnosticDefinitions`; if any `error`,
      throw one aggregated `Error` whose message is the formatted teaching errors
      (`FW201 file.tsx:12:5 — <message>` + help lines). Vite renders thrown transform errors in
      the overlay and terminal natively — no Vite import needed, the structural adapter stays
      host-free. Add a shared `formatDiagnostic(diagnostic)` helper (likely `@jiso/core`, next to
      `diagnosticDefinitions`) so the CLI, gate, and dev document render identically.
- [x] **V2 — non-blocking channel.** `createJisoVitePlugin` (and the public `jisoVitePlugin()`
      wrapper) gains an optional `onDiagnostic(diagnostic)` callback defaulting to a formatted
      `console.warn`/`console.info` by severity. Real-Vite `this.warn` wiring can layer on later
      without changing the adapter's structural types.
      Evidence 2026-06-11: `packages/compiler/src/vite.ts` now derives blocking behavior from
      shared `diagnosticDefinitions`, throws an aggregated teaching error for `error` severity
      transform diagnostics with `FWxxx file:line:col` plus help lines, and reports non-error
      diagnostics through an optional `onDiagnostic` callback. `packages/compiler/src/index.ts`
      exports the options while keeping `jisoVitePlugin()` backward compatible, and
      `packages/compiler/src/index.test.ts` seeds Vite transform diagnostics for both blocking
      and non-blocking paths. Same-session evidence:
      `pnpm exec vitest --run packages/compiler/src/index.test.ts -t "jisoVitePlugin"` and
      `pnpm exec vp check packages/compiler/src/index.ts packages/compiler/src/vite.ts packages/compiler/src/index.test.ts`.
- [x] **V3 — build and static export refuse errors.** Verify the V1 throw fails `vp build`
      through the plugin path (S1 production emit), and make the D8 R6 static export check
      compile diagnostics before writing any file. No suppression option — strict→loose is the
      non-breaking ratchet direction pre-1.0 (same posture as FW235).
      Evidence 2026-06-12: `exportStaticApp(app, { diagnostics })` now refuses any
      `error`-severity diagnostic according to shared `diagnosticDefinitions` before route
      replay or file writes, while allowing non-blocking lint diagnostics through. `fw export`
      forwards an app module's exported compile diagnostics to the server exporter and renders
      the resulting stable `fw-export/v1` error output. Same-session evidence:
      `pnpm exec vitest --run packages/server/src/static-export.test.ts packages/cli/src/index.test.ts -t "static export|fw export"` and
      `pnpm exec vp check packages/server/src/static-export.ts packages/server/src/static-export.test.ts packages/server/src/index.ts packages/cli/src/index.ts packages/cli/src/index.test.ts`.

Verification: compiler vitest for the plugin (seeded FW201/FW225 fixture → transform throws with
position and help text; warn-severity fixture → compiles, callback invoked); a behavioral
`tests/fw-check.node.mjs` tranche driving the built `jisoVitePlugin` transform with a seeded
error; `pnpm run check` + `pnpm run check:fw`. Commit per item.

## Phase E — Dev teaching-error documents (after V1; host is D8 R5 middleware)

- [x] **E1 — diagnostic document renderer.** `renderDiagnosticDocument(diagnostics, source?)` in
      `@jiso/server` (dev-only export): FW code, severity, message, help/fix menu, and a source
      frame from `line`/`column`. Reuses the existing document assembly; styling minimal and
      framework-owned (no Tailwind dependency in the error path).
- [ ] **E2 — middleware integration.** The dev middleware records per-module compile diagnostics
      (the Vite plugin already holds compile results for `/c/` serving — extend that ledger);
      page routes render the document, fragment/mutation requests get a wire-shaped 500 carrying
      the formatted diagnostic so enhanced submits surface it too. Production code path: throw if
      ever invoked outside dev.

Verification: server vitest (document rendering, middleware roundtrip for page + fragment +
no-JS form post against a seeded failing module); existing dev-middleware tests stay green.

## Phase M — MCP surface (after V1; independent of E)

- [x] **M1a — `fw mcp` stdio-compatible fallback.** `packages/cli` exposes a newline-delimited
      JSON-RPC surface using MCP method names (`tools/list`, `tools/call`) without adding
      `@modelcontextprotocol/sdk` yet. Tools: `compile_component` (fileName + source + optional
      query-shape/registry/prefix facts → structured diagnostics, emitted file kinds,
      handler exports, update coverage), `fw_check` and `fw_explain` (graph path or inline graph
      → existing public API output), and `list_diagnostics` (the `diagnosticDefinitions` registry
      — codes, severities, messages — so agents can look up a code without a round trip). This
      records the dependency choice for this bounded slice: no SDK in `fw` until the full MCP
      lifecycle is worth freezing.
      Evidence 2026-06-12: `packages/cli/src/index.ts` adds `mainAsync(['mcp'])`, JSON-RPC line
      handling, `tools/list`/`tools/call`, and tool dispatch that calls `compileComponentV1`,
      `fwCheck`, `fwExplain`, and `diagnosticDefinitions` directly. Same-session evidence:
      `pnpm exec vitest --run packages/cli/src/index.test.ts` and
      `pnpm exec vp check packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json plans/diagnostics.md pnpm-lock.yaml`.
- [x] **M1b — SDK-backed MCP adapter.** Replace or wrap the fallback server with
      `@modelcontextprotocol/sdk` over stdio, including MCP initialize/capability lifecycle tests.
      Evidence 2026-06-12: `packages/cli/src/index.ts` adds a lazy SDK-backed `fw mcp` server
      using `@modelcontextprotocol/sdk/server` and `StdioServerTransport`; SDK request handlers
      share the same `compile_component`, `fw_check`, `fw_explain`, and `list_diagnostics`
      dispatch as the fallback JSON-RPC handler. `packages/cli/src/index.test.ts` adds an
      in-memory SDK transport test that performs `initialize`, `notifications/initialized`,
      `tools/list`, and a diagnostic-producing `tools/call`, while the existing fallback JSON-RPC
      object tests and newline stdio fallback test remain green. Same-session evidence:
      `pnpm exec vitest --run packages/cli/src/index.test.ts` and
      `pnpm exec vp check packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json plans/diagnostics.md pnpm-lock.yaml`.
- [x] **M2 — versioned tool contract.** Document the `compile_component` result shape as
      `compile/v1` alongside `fw-check/v1`/`fw-explain/v1`; snapshot-test it (agents consume
      this format, so it freezes like the CLI output did in P8). Include one end-to-end test:
      adversarial source in → FW201 diagnostic out with fix menu → corrected source in → clean
      compile, proving the repair loop without filesystem writes.
      Evidence 2026-06-12: `packages/cli/src/index.ts` exports `CompileComponentV1Input`,
      `CompileComponentV1Result`, and `compileComponentV1()` with explicit `compile/v1` version
      tagging, diagnostics copied from compiler facts and shared `diagnosticDefinitions` per
      SPEC §11.3, emitted file kind/byte metadata, handler exports, update coverage,
      query-update plans, render-equivalence summaries, and graph facts.
      `packages/cli/src/index.test.ts` inline-snapshots a clean `compile/v1` result and proves
      the in-memory repair loop with FW201 help text followed by a clean corrected source.
      Same-session evidence:
      `pnpm exec vitest --run packages/cli/src/index.test.ts`.

Verification: cli vitest with an in-process MCP client; `pnpm run check:build` (new dependency
and any new entry point); snapshot tests for `compile/v1`.

## Non-goals

- No new FW codes, severities, or message changes (SPEC §11.3 discussion first, per CLAUDE.md).
- No client-injected overlay or dev-toolbar framework — the browser overlay is Vite's; jiso's
  contribution is server-rendered documents.
- No last-good-module serving in dev (decision above).
- No build-error suppression flags.
- No production error reporting/telemetry — operators have the `onError` seam from round-2
  Phase 5; this plan is compile-time diagnostics only.
- No dev-server-attached MCP endpoint in v1 (revisit after D8 R7 adoption).

## Sequencing summary

| Step | Deliverable                       | Depends on                 | Gate before commit                  |
| ---- | --------------------------------- | -------------------------- | ----------------------------------- |
| SPEC | surfacing policy text             | —                          | SPEC review                         |
| V1-2 | blocking transform + warn channel | SPEC PR (or lands with it) | compiler vitest + check:fw          |
| V3   | build/static-export refusal       | V1, D8 R6                  | check + check:build + check:fw      |
| E1-2 | dev teaching-error documents      | V1, D8 R5 (landed)         | server vitest + check               |
| M1-2 | `fw mcp` + `compile/v1` contract  | V1 (shares formatting)     | cli vitest + check:build + snapshot |

V is independently shippable and should land first — it closes the silent-drop hole. E and M are
parallel tracks after V1.
