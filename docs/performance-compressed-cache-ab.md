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

## 2026-08-14 decision: accept

[Run `31751766130`](https://github.com/kovojs/kovo/actions/runs/31751766130),
[job `94618836258`](https://github.com/kovojs/kovo/actions/runs/31751766130/job/94618836258),
and [artifact `9205286040`](https://github.com/kovojs/kovo/actions/runs/31751766130/artifacts/9205286040)
completed the default matrix at clean source
`c2c21e79a82798ae63ba540c8c609dc15d5808a4`. The source contains production implementation
`f2da7687e3a94a137efda717ddb757ed8b71e746` and benchmark implementation
`e965941febfc0713a8fa5ad285dcea50ca1b9226`. Both arms used the same freshly built committed
artifact; the baseline only set the disable-only seam, so it could remove acceleration without
minting cache authority.

The report contains 504/504 raw windows: seven samples per arm across all 36 cells, in repeated
`baseline, spike, spike, baseline` order. The six cached-Brotli HIT cells supply 84 windows and 42
paired observations. Every window used a 5-second warmup and 15-second measured interval. Maximum
observed pre/post load was 0.5475 per logical CPU, below the declared 0.75 quiet-host ceiling.

All values below are medians. Latency is milliseconds; CPU is process-tree percentage and RSS is
process-tree MiB.

| Cached Brotli HIT cell | req/s baseline → cache | p50 baseline → cache | p95 baseline → cache | p99 baseline → cache |
| ---------------------- | ---------------------: | -------------------: | -------------------: | -------------------: |
| listing c=1            |    1,018.07 → 1,671.50 |          0.89 → 0.53 |          1.10 → 0.70 |          3.04 → 2.27 |
| listing c=8            |    1,503.71 → 2,329.02 |          4.69 → 2.69 |          8.73 → 7.04 |         13.99 → 9.69 |
| listing c=32           |    1,533.28 → 2,287.51 |        19.24 → 12.20 |        29.55 → 22.57 |        37.24 → 29.20 |
| detail c=1             |    1,227.07 → 1,616.89 |          0.72 → 0.61 |          0.94 → 0.71 |          2.97 → 2.35 |
| detail c=8             |    1,599.56 → 2,374.70 |          4.38 → 2.64 |          8.72 → 6.85 |        13.37 → 10.02 |
| detail c=32            |    1,616.25 → 2,300.66 |        18.03 → 11.88 |        27.91 → 22.76 |        35.57 → 31.37 |

| Cached Brotli HIT cell | CPU ms baseline → cache | CPU % baseline → cache | RSS MiB baseline → cache |
| ---------------------- | ----------------------: | ---------------------: | -----------------------: |
| listing c=1            |         16,000 → 14,000 |         106.66 → 93.33 |          314.71 → 308.41 |
| listing c=8            |         23,000 → 17,000 |        153.31 → 113.30 |          333.93 → 322.55 |
| listing c=32           |         25,000 → 17,000 |        166.56 → 113.22 |          374.48 → 349.55 |
| detail c=1             |         16,000 → 14,000 |         106.66 → 93.33 |          297.17 → 326.80 |
| detail c=8             |         20,000 → 17,000 |        133.31 → 113.31 |          322.59 → 340.29 |
| detail c=32            |         21,000 → 17,000 |        139.90 → 113.22 |          357.90 → 366.09 |

Across the 42 primary pairs, median throughput improved **48.8418%** with paired bootstrap 95%
CI `[46.8611%, 51.3939%]`. All six median p95 values improved. The worst median RSS regression was
9.9025% in detail c=1; that would fail criterion B's resource guardrail, but criterion A accepts
independently because throughput improved by at least 10% with a strictly positive interval.

Correctness and integrity were complete: zero adapter errors, failed requests, representation
misses, report errors, or zero-request samples. Exact status/header/encoding evidence was retained
for every adapter report, including fresh `Kovo-Pad` behavior. The decoded listing body was always
12,469 bytes with SHA-256
`265f82fd4c4444c47dce088b5062e4ecd39b54ee5f94db64332948f3f7baa9f8`; detail was always 1,713
bytes with SHA-256 `ec5c1b97d94562be984dc10078c3fbdc7f891559e32b2465789d89ee49c70b60`.
The cache therefore changes compression work, not the rendered document. This preserves the
compiler-owned identity and deploy-skew boundaries in SPEC §5.2.1 and §14.

### Evidence identity and custody

- Report schema: `kovo-compressed-cache-ab/v1`; report SHA-256
  `1c0db986b2baf732aca7fdc6038a80702a47a6eb32433db2abae27a0a9ac74f2`; 3,698,184 bytes.
- Artifact ZIP SHA-256: `84a287214850e1751495188aae6c0f5835e3095ba4ca6360ff329343c9da2d17`;
  its only regular entry is `report.json`. GitHub reports expiry at `2026-09-13T02:12:32Z`.
- Evidence digest: `sha256:11bef91f9a34c96e97631c1799e3a27dfbaec16a96c3d229dff5f6756561df75`;
  workload digest: `sha256:d8cc40129b3ca6475dcbd3e6b0fd8dbdb7b02cae46e311145c5d5c9e6cabe89c`.
- Host digest: `sha256:a2b92f6a2fb10e1d43ee707796d383d31a11123121152e250444ab3af6effa2d`
  (Ubuntu 24.04 image digest `sha256:eb877395211fabde17c25e5bfbcd37a31a31e9b3799fa1518742f86fdd6ae06f`,
  Node 24.18.0, x64, four Intel Xeon 6973P-C CPUs, 16 GiB memory class).
- Frozen-lock SHA-256 identities: root
  `b44051d7c24ac90744743140c794ccee83991dd07d2e15d2e893fcc3d2b6d0a4`, Next.js
  `a9e68be4a032b6e2cc40a5f5392f942d14eae0277b6fc93408446b61d565086b`, and harness
  `bfbf3b2e8725c5ef8a844f62c0907a154a1d5f68af4ff6ec26a91658d1227663`.

The authenticated verdict is **accept, criterion A**. Keep the cache enabled in production. The
artifact link is temporary evidence custody and should not be described as durable after its stated
expiry; the exact identities above remain the audit record.

## Unsupported comparator representations

`scripts/perf-server-benchmark.mjs` probes identity before timing a requested representation. If the
pinned Next.js entrant answers a Brotli request with the exact identity representation, the adapter
records the actual response as structured `support.status: "unsupported"` evidence and emits no
timing sample. It does not label identity bytes as Brotli. `benchmarks/compare.mjs` retains those raw
cells under `integrity.comparator.serverMatrix.excludedUnsupported`, excludes them from paired
statistics, and still requires every supported condition and occurrence to pass its full
correctness, timing, CPU, RSS, source, and host checks.
