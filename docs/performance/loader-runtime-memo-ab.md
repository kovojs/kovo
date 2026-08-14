# Loader-runtime selection memo A/B

This experiment is the highest-priority production-runtime candidate in `plans/good-perf.md`. It
tests whether a framework-private memo can remove repeated canonicalization and SHA-256 work from
forced-dynamic document rendering without weakening loader-module publication validation. Fresh
decision evidence, not the historical exploratory numbers below, owns adoption.

## Authenticated origin

The original spike is preserved by
`refs/heads/perf-spike/loader-memo-e54c595b5` at
`e54c595b5906df9ab9b9b5e3fbf18e76c99e79b9`. Its removed throwaway worktree was
`/Users/mini/kovo-wasm-loader-memo`; its direct production patch is baseline
`ce327123caf5b73a205d8c537f89191413a6edb4` to candidate
`b545756ae94e0717d5e043b9f9b60e23014130a8`, followed by posture commit
`3279995d3469d045ec8f37fe9ddbcff79f8230f8` and benchmark-only commit
`e54c595b5906df9ab9b9b5e3fbf18e76c99e79b9`.

The publishable rerun uses durable ref
`refs/heads/perf-spike/loader-memo-profiled-pair-20260813`. Its tooling baseline is
`3010e8df33869413727003c659bb555ac824d104`; its direct candidate is
`d87b4a1320087c512e25f02a57e88920ae9b1777`. Both arms include the corrected CPU-profile launcher,
and their only difference is the loader memo production patch. That patch retains stable patch ID
`f06d58878c8997bca537fd61bb08d7896660d60c`, matching the previously authenticated current-tree
candidate.

The machine-readable origin manifest is
`docs/performance/loader-runtime-memo-origin.json`. The runner authenticates its own pinned manifest
digest, the commit-parent chain, the canonical binary patch SHA-256 and stable patch ID. When the
host-local scratchpad still exists, it also re-hashes all 13 raw artifacts, including both CPU
profiles, `ab-results.jsonl`, the original driver, rendered documents, and the Wasm spike report.
The manifest records the exact argv used to serialize the production patch; its digest is over the
command's raw stdout bytes.

The authenticated exploratory evidence says the benchmark rendered the same 276,420-byte module
on every forced render. Product-route medians were 623.7 to 854.3 req/s at c=1, 712.5 to 946.8 at
c=8, and 758.0 to 1006.8 at c=32. The original hit-count analyzer attributed 1700 of 6498 busy hits
(26.16%) to `ensureKovoLoaderRuntimeClientModule` before and 0 of 6504 afterward. Root and product
documents had identical before/after SHA-256 digests. These results remain exploratory: the old
driver used five 5-second baseline-then-candidate samples after a 3-second warmup, ran amid other
spikes, and omitted paired confidence intervals, p95, process CPU, peak process-tree RSS, quiet-host
admission, and current clean worktrees. The raw Wasm report bounds its whole-render opportunity at
about 3.6%; the loader result's roughly 33–37% exploratory throughput delta is about ten times that
ceiling, but only the protocol below may promote the candidate.

## Fresh decision protocol

The candidate must be one final production commit directly above the tooling baseline. Both roots
must be clean, distinct worktrees at those exact objects. The runner refuses extra candidate paths,
records the exact candidate binary-patch digest/path census, requires identical frozen locks and
benchmark bytes, installs both roots independently with
`pnpm install --offline --frozen-lockfile --ignore-scripts`, and builds each production entrant
independently. The historical evidence ref must be fetched so commit-object authentication cannot
degrade to manifest-only validation.

Preparation is a non-timing smoke:

```sh
node scripts/perf-loader-runtime-memo-ab.mjs \
  --baseline-root /path/to/baseline-worktree \
  --spike-root /path/to/candidate-worktree \
  --prepare-only \
  --profile-dir /path/to/artifacts/profiles \
  --out /path/to/artifacts/prepare.json
```

Before either build, the runner parses (without evaluating) the reviewed
`kovoDeferredRuntimeModuleSource` declaration in each clean worktree. It requires one
no-substitution constant, requires both arms to have the same bytes, and records the source path,
byte count, and SHA-256 in the workload identity. The current committed pair independently
re-authenticates the historical 276,420-byte input; a future size or content change remains valid
evidence only when it is reported explicitly rather than inheriting that historical number.

The full decision run is:

```sh
node scripts/perf-loader-runtime-memo-ab.mjs \
  --baseline-root /path/to/baseline-worktree \
  --spike-root /path/to/candidate-worktree \
  --measure \
  --profile-dir /path/to/artifacts/profiles \
  --out /path/to/artifacts/report.json
```

Full defaults are seven samples per arm, a 5-second warmup, a 15-second measured window, and the
serialized repeated order baseline, spike, spike, baseline. It measures forced-dynamic identity
listing and detail routes at c=1, 8, and 32. Every raw sample retains throughput, p50/p95/p99,
process-tree CPU time/percent, peak process-tree RSS, correctness, source, and host evidence. A
global timing lock prevents overlapping Kovo performance lanes, and each window waits for load1 per
CPU at or below 0.75 for up to 30 seconds. The run rejects any wrong status, body, representation,
rate limit, transport error, zero-request sample, source drift, schedule gap, or before/after body
digest mismatch.

After the unprofiled matrix, diagnostic-only CPU profiles run for both listing and detail at c=32
on baseline and candidate. Raw `.cpuprofile` files and their adapter reports live below the declared
profile directory. Their loader-selection attribution uses the original spike's V8 node-hit-count
definition and excludes `(idle)`, `(program)`, `(garbage collector)`, and `(root)` from busy hits.
Profiled throughput is never acceptance evidence.

Acceptance is exactly the active plan rule across all paired forced-dynamic samples, with zero
correctness misses:

- criterion A: median throughput improvement is at least 10% and its paired bootstrap 95% CI lower
  bound is above zero; or
- criterion B: median throughput improvement is at least 5%, the same CI excludes zero, and no
  route/concurrency cell regresses median p95 or peak RSS by more than 5%.

Non-default `--quick-smoke` or matrix/timing overrides can verify wiring but always report
`smoke`; they cannot produce an acceptance verdict. The durable GitHub Actions decision job owns
the quiet-host full run and uploads the report plus all four raw profiles.

## Fresh decision result

[Run `31754297930`](https://github.com/kovojs/kovo/actions/runs/31754297930) completed on
2026-08-14 with [artifact `9203129430`](https://github.com/kovojs/kovo/actions/runs/31754297930/artifacts/9203129430).
The live GitHub artifact API records the downloaded ZIP as 899,959 bytes with SHA-256
`f65c453f5a75fcd5717ae8f4465ae96a0e41017960fd6f234ce2f80712661ccd`; the ZIP's exact
`report.json` member has SHA-256
`752ec351e6dd8f124e2b48eb2f99d42460f18acb13a7146264c7ad4617e410ad`.
The runner independently authenticated clean commits `3010e8df33869413727003c659bb555ac824d104`
and `d87b4a1320087c512e25f02a57e88920ae9b1777`, the one-path patch, stable patch ID
`f06d58878c8997bca537fd61bb08d7896660d60c`, frozen locks, and the identical 276,420-byte module
with SHA-256 `4d82afe10bceef7fa903d218472a2e2d7f6ccba8500050ede7878ecdf841af4b`.
The 84 raw windows formed 42 exact baseline/spike pairs in the declared order and served 307,428
successful requests with zero status, representation, content, transport, or source-integrity
misses. Maximum admitted load was 0.6125 per CPU, below the 0.75 ceiling.

The table reports medians; CPU is process-tree CPU percentage and RSS is process-tree MiB.

| Forced-dynamic cell | req/s baseline → memo | p50 ms baseline → memo | p95 ms baseline → memo | p99 ms baseline → memo | CPU % baseline → memo | RSS MiB baseline → memo |
| ------------------- | --------------------: | ---------------------: | ---------------------: | ---------------------: | --------------------: | ----------------------: |
| listing c=1         |       158.44 → 196.92 |            5.79 → 4.69 |            9.29 → 7.85 |          13.89 → 11.14 |       106.65 → 106.65 |         330.09 → 320.83 |
| listing c=8         |       179.95 → 222.74 |          37.43 → 30.32 |          80.59 → 64.93 |          85.17 → 68.76 |       113.03 → 113.09 |         397.82 → 358.42 |
| listing c=32        |       181.29 → 228.65 |        169.82 → 134.69 |        191.09 → 152.46 |        342.73 → 272.22 |       112.03 → 112.31 |         362.87 → 347.30 |
| detail c=1          |       246.13 → 322.16 |            3.78 → 2.90 |            6.07 → 4.87 |            8.80 → 5.77 |        99.99 → 100.00 |         333.23 → 327.24 |
| detail c=8          |       250.74 → 340.09 |          27.22 → 20.03 |          55.53 → 41.70 |          62.12 → 45.55 |       113.08 → 113.15 |         376.78 → 340.74 |
| detail c=32         |       255.03 → 338.39 |         121.51 → 90.93 |        137.81 → 107.64 |        244.80 → 183.59 |       112.39 → 112.66 |         342.01 → 354.23 |

Overall paired throughput improved 29.0848%, with bootstrap 95% CI
`[26.0654%, 30.2256%]`; every cell's median p95 improved by 13.98–24.02%. CPU stayed effectively
flat. Five RSS cells improved and detail c=32 regressed 7.37%; criterion A accepts independently of
the criterion-B RSS guardrail because throughput exceeded 10% with a strictly positive paired CI.

The raw CPU profiles independently reproduced the causal attribution. The loader-selection subtree
fell from 4,970/33,389 busy samples (14.8851%) to 7/33,116 (0.0211%) on listing and from
7,204/33,393 (21.5734%) to 8/33,404 (0.0240%) on detail. Listing and detail response bodies remained
byte-identical across every arm and window. The publishable verdict is therefore **accept,
criterion A**; the memoization candidate remains in production.

## Candidate safety contract

The production change remains private to `@kovojs/server`. Its cache key is the closed registry
facade plus a private active-publication epoch. Every successful publication swaps that epoch,
including byte-identical republication through fresh compiler provenance, so the next selection
fully revalidates roles, hrefs, bytes, and render-plan identity. Refusals are never memoized. A
registry poisoned during publication continues to fail closed even if a prior selection was cached.
This follows `SPEC.md` §5.2.1's compiler-owned publication boundary and §14's atomic-publication and
deploy-skew requirements; it adds no public export.
