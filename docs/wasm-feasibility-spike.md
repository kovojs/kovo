# WebAssembly feasibility for Kovo

Investigated 2026-08-13 against `ce327123c`. Four-way recon plus three measured
throwaway-worktree spikes. Nothing was merged; this page records the evidence so the question
does not have to be re-opened from scratch.

**Verdict: no. Not for app code, not for framework request paths, not for the client.** The
Wasm-addressable share of Kovo's CPU is ~3.6% on an uncached render, ~1% on a product render, and
~0% on the cache path, `kovo check`, and the dev loop — and the one genuinely Wasm-shaped frame
loses to tuned JavaScript even after the boundary cost is eliminated entirely. The same profiles
handed out a conventional win an order of magnitude larger than Wasm's whole theoretical ceiling.

## Can Kovo's TypeScript be compiled to Wasm?

No, and this was tested rather than asserted.

| Path | Result |
| --- | --- |
| **AssemblyScript** | Rejects Kovo source on its first line; fails 17 of 21 core TS constructs. It is a TS-*like* language with its own type system, not a TS compiler. A hand-optimized AssemblyScript `escapeHtml` came out **6.89x slower** than Kovo's existing JS — and still 1.36x slower with marshalling artificially removed. |
| **Porffor** (AOT JS/TS → Wasm) | Research project, ~61% of test262. Cannot host a real server. |
| **Javy / QuickJS-in-Wasm** | Runs JS *inside* a Wasm interpreter. Slower than V8 by construction — a portability and sandboxing play, not a performance one. |
| **Static Hermes** | Research-stage and native-only. |
| **Rust/Zig/C for hot paths** | Technically viable, and the only real option — but see the boundary model and the falsification spike below. |

The deeper reason is structural: Kovo's hottest render work is `Object.defineProperty` / `freeze` /
`getOwnPropertyDescriptor` over live JS objects (the per-prop own-data snapshotting that enforces
its security invariants, ~27% self on an uncached render). That has no Wasm representation at all.
It is precisely the workload Wasm cannot host.

## The boundary cost model

Measured on this box (Node v24.19.0, Apple Silicon), hand-assembled modules, warmed monomorphic
call sites.

Wasm **calls** are nearly free — 1.1 ns over a JS call. Moving **data** is not:

| Input | encode into linear memory | decode back | round trip | the whole JS answer |
| ---: | ---: | ---: | ---: | ---: |
| 64 B | 35 ns | 77 ns | 103 ns | 22 ns |
| 1 KB | 57 ns | 125 ns | 165 ns | 44 ns |
| 16 KB | 320 ns | 644 ns | 969 ns | 552 ns |
| 256 KB | 6,430 ns | 28,604 ns | 34,557 ns | 8,700 ns |

The round trip alone exceeds the entire JS answer at every size. For anything that takes a JS string
and returns a JS string, no Wasm implementation can win — the computation would have to take
negative time. The asymmetry is worth remembering: `encodeInto` is cheap, `decode` is the expensive
half, so Wasm *can* win when it scans a large buffer and returns a small scalar, and cannot when it
transforms text. HTML escaping, attribute serialization and document assembly are all the latter.

A caution for anyone re-running this: the first version of this benchmark compared hand-optimized
Wasm against a naive `charCodeAt` loop and made Wasm look 4x better than it deserved. V8's regex and
string intrinsics run in optimized native code; benchmark against those.

## The falsification spike (`spike/wasm-escape`)

One configuration remained untested: **js-string builtins** (`wasm:js-string`), which let Wasm
operate on JS strings zero-copy and skip linear memory entirely. They work on Node 24.19 via
`new WebAssembly.Module(bytes, { builtins: ['js-string'] })`.

The escape traffic was **instrumented rather than modeled** — 762 real calls captured from uncached
renders of `benchmarks/kovo` `/` and `/product/linen-field-jacket`:

- median input length **11 chars**, p99 80, max 93
- **0 of 762 inputs contained a single escapable character** (0.000% density)

Replayed on that real corpus, after proving all implementations output-identical across 10,810
differential checks (empty, all-escapable, lone surrogates, astral plane, 100 K strings, 10 K fuzz
rounds):

| Implementation | ns/op | vs current |
| --- | ---: | ---: |
| current `replaceAll` chain | 122.4 | 1.0x |
| zero-copy Wasm (js-string builtins) | 23.2 | 5.3x |
| tuned single-pass JS | 20.5 | 6.0x |
| **regex-probe JS** | **13.0** | **9.4x** |

**Wasm loses to the best JS by 1.79x while paying no marshalling at all.** The builtins genuinely
removed the toll; Wasm still lost on compute, because V8's native string scanners run at ~0.05
ns/char against the Wasm `charCodeAt` builtin's ~0.9 ns/char. On 64 KB strings Wasm is 4–25x slower.

Materiality: the entire escape workload is ~93 µs per uncached render pair — under 1% of render CPU.
The best possible outcome here was never worth the machinery.

## Why it is also inadmissible, independent of speed

Even a Wasm win would have to clear gates Kovo already enforces:

- `WebAssembly.instantiate` / `compile` are **eval-class dangerous sinks**
  (`packages/cli/src/sources-sinks.ts:484-486`), and the `WebAssembly` global maps to the `vm`
  capability (`packages/compiler/src/scan/capability-closure.ts:36,61`). App usage is refused by
  KV424, KV448 and KV449 in every position, including boot-time module scope and via third-party
  packages. There is no existing door.
- The shipped CSP **cannot express `wasm-unsafe-eval`** (keywords are structurally unreachable from
  config, `csp.ts:621-643`), and adding it would grant page-wide dynamic code execution to every
  script — inverting the framework's posture.
- The certificate checker rejects native-or-wasm imports (`verify/index.ts:2150`), and the emitted
  server's locked request-safe realm excludes `WebAssembly` entirely.
- The deepest objection: Kovo proves capability closure, provenance and sink safety **by reading
  TypeScript source**. Any logic moved into Wasm becomes opaque to every one of those analyses.
  Adopting request-path Wasm is not a performance decision, it is a revocation of the analyzability
  the framework is built on.

The spike hit this first-hand: instrumenting `@kovojs/server` tripped KV448 until the posture digest
was regenerated.

Note the irony worth keeping: **Wasm already runs in this repo where it belongs** — Node's
amaro/SWC type-stripping is 8.2% of the `app-source-trust` worker. Build-time text transforms behind
a pinned binary are the shape that works.

## What the investigation actually found instead

### Adopt — loader-digest memoization (`spike/loader-memo`, measured 1.33–1.37x)

Every document render re-canonicalized (`Buffer.from` → `toString`) and re-SHA-256'd the **constant
276,420-byte** generated client runtime. The registry is immutable per deploy, so the digest is a
constant being recomputed per request.

| Metric | before | after |
| --- | ---: | ---: |
| `/product` forced render, c=1 | 623.7 req/s | 854.3 (**1.37x**) |
| c=8 | 712.5 | 946.8 (**1.33x**) |
| c=32 | 758.0 | 1006.8 (**1.33x**), p50 −25% |
| subtree share of busy CPU | 26.16% | **0.00%** |
| cached `/` path | — | ~1.0x (unaffected, as predicted) |

Served documents are byte-identical across builds. The memo is keyed on the registry facade plus a
publish-epoch token, so any republication — including a byte-identical one under different compiler
provenance — invalidates it and re-runs the identity checks; refusal paths are never memoized.

Recon's branch attribution was **wrong** and the spike corrected it: the cost is in the per-entry
role/href loop reached by the *fallback* branch, not the app-runtime branch.

### Available, cheap — regex-probe escape fast path (~9.4x on the escape path)

Falls out of the falsification spike: ~6 lines in `html.ts`, output-identical across 10,810 checks,
keeps the native `replaceAll` win on long dense strings. Worth ~83 µs per uncached render pair, so
small in absolute terms — take it if the escape path is ever touched anyway.

### Not yet — native `tsgo` (`spike/tsgo-preflight`)

The direct counterexample to "compile the compiler to Wasm": the same compiler as a native Go
binary, already vendored. **The isolated speedup is 5.5–9.3x and it does not convert.**

| | warm | cold |
| --- | ---: | ---: |
| isolated preflight | 7.0–9.3x | 5.5–8.6x |
| end-to-end `kovo check` | **2.5–7.9%** (median ~3.6%) | 12.5–19.3% |
| end-to-end `kovo build` | **1.5%** | 8.4–10.9% |

Pass-through was verified 1:1 (typescript phase 858 → 117 ms, paired wall delta 747 ms) — nothing is
being lost to overlap. The preflight is simply only 2–5% of a warm run, and the warm loop is the one
developers feel. Blockers beyond the number: message-text divergence in two classes (union member
ordering; the NodeNext import-attribute suffix), a dated dev prerelease, TCB enrollment obligations
under `rules/dependency-policy.md`, and two type-checker implementations in one `kovo check`.

Revisit on a stable release, message-text parity or an explicit decision that rendered type strings
sit outside the diagnostic contract, and TCB enrollment.

## If the goal is speed, the ranked list is

1. Loader-digest memo — **1.33–1.37x forced render**, measured, ~15 lines.
2. Snapshot-shape rework of the `formHelper` intrinsics — ~27% of uncached render CPU; security-sensitive, days.
3. Raw `ts.forEachChild` traversal replacing ts-morph wrapper iteration — 36% of the dominant check worker.
4. Regex-probe escape — 9.4x on a path worth <1%.
5. `tsgo` — revisit when the blockers above clear.
6. WebAssembly — **0%.**

## Reproducing

Branches `spike/wasm-escape`, `spike/loader-memo`, `spike/tsgo-preflight` retain the harnesses,
captured corpora and raw samples. Every wall-clock number was taken with concurrent spikes running
(load 3.0–14.3, recorded per sample), so absolute figures are indicative; all A/B ratios were
measured back-to-back, interleaved, and are the trustworthy quantity.
