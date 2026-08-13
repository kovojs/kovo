# Compressed proved-document cache A/B benchmark

Use `scripts/perf-compressed-cache-ab.mjs` to decide whether Kovo's compressed proved-document
cache is a measured production win. The runner compares one freshly built Kovo artifact against
itself. The `baseline` arm sets the internal disable-only seam
`KOVO_BENCHMARK_DISABLE_PROVED_DOCUMENT_COMPRESSION_CACHE=1`; the `spike` arm removes that variable.
The seam can remove acceleration but cannot create cache authority.

Run the publishable matrix from a clean committed worktree on a quiet host:

```sh
node scripts/perf-compressed-cache-ab.mjs --out reports/compressed-cache-ab.json
```

The default matrix is deliberately long-running: seven samples per arm in serialized
`baseline, spike, spike, baseline` order, 5-second warmups, and 15-second measured windows for every
combination of concurrency `1/8/32`, listing/detail, identity/Brotli, and HIT/304/dynamic. Use smaller
dimensions only for smoke checks; their verdict is `smoke`, never accepted performance evidence.

Before each build or sample, the runner waits up to 30 seconds for load per logical CPU to fall to
0.75 or lower, polling once per second. Every rejected and accepted settle observation is retained
in `environment.hostSamples`. The run stops after the bound instead of timing through background
load. Change the bound only for investigation with `--host-settle-max-ms` and
`--host-settle-poll-ms`.

The report retains source and lock provenance, a digest and file census for the workload, pre/post
identity, raw adapter reports, correctness/error/miss totals, process-tree CPU/RSS, p50/p95/p99,
requests per second, median/MAD/p95 summaries, and paired bootstrap 95% intervals. A report is
eligible for acceptance only with the exact default matrix, clean stable provenance, stable workload
identity, every expected raw sample, and zero transport, representation, adapter, or zero-request
failures.

Acceptance applies to cached Brotli HIT cells across both routes and all three concurrencies. It
implements the plan contract exactly:

- criterion A: median throughput improves by at least 10% and the paired bootstrap 95% interval is
  above zero; or
- criterion B: median throughput improves by at least 5%, the interval is above zero, and no
  cached-Brotli HIT cell's median p95 latency or RSS regresses by more than 5%.

The final status is `accepted`, `rejected`, `smoke`, or `unproven`. Do not infer a win from an
individual cell when the final status is not `accepted`.

## Unsupported comparator representations

`scripts/perf-server-benchmark.mjs` probes identity before timing a requested representation. If the
pinned Next.js entrant answers a Brotli request with the exact identity representation, the adapter
records the actual response as structured `support.status: "unsupported"` evidence and emits no
timing sample. It does not label identity bytes as Brotli. `benchmarks/compare.mjs` retains those raw
cells under `integrity.comparator.serverMatrix.excludedUnsupported`, excludes them from paired
statistics, and still requires every supported condition and occurrence to pass its full
correctness, timing, CPU, RSS, source, and host checks.
