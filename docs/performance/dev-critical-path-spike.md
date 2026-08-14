# Profile-driven development critical-path spike

This is the packed-product v3 decision contract for the candidate selected from the authenticated
development edit profiles. It supersedes the source-checkout v2 runner as well as the rejected
fresh-generation v1 comparison. A v1 or v2 outer report, preparation report, retained-failure
envelope, candidate binding, or product-boundary policy is not valid input to this decision.

## Causal basis

The candidate is limited to the two costs established by the clean N=24 and N=216 profile census in
[`dev-edit-profile.md`](./dev-edit-profile.md):

- Whole-project asynchronous proof convergence starts before HMR has published its outcome and
  competes with the leaf, entry, and data edit-to-paint critical path.
- Recovery repeatedly builds a TypeScript program to recover the same component query runtime
  identity. Reuse is permitted only for an exact plugin-scoped binding preimage; dependency,
  configuration, or other-file uncertainty must take the full fail-closed resolver path (SPEC
  §4.1, §5.2, and §9.5).

The causal source is hosted run
[`31799441158`](https://github.com/kovojs/kovo/actions/runs/31799441158) at exact clean commit
`89b39c999de6a7c60f3091831916ddb2c4c5037c`. Its authenticated N=24 and N=216 profile-set digests
are respectively `4cc4185287ed571de6b05a0a3b12bf2848b14b48b3c31eb671c2357f57b3c052` and
`6f51369cd21add66e25ed8388d78fdb1d897c978ee09a28f6e62096f6f2d5768`; the linked profile report
owns the raw artifact custody and replay digests.

Syntax-error handling had neither hotspot. It is a correctness, regression, and absolute-latency
guardrail, not a metric from which the candidate may claim a causal win.

## Candidate binding

The durable candidate ref is
`refs/heads/perf-spike/dev-critical-path-profile-20260814`. The adversarially reviewed production
commit is bound as:

- commit: `336925d40e11024b54206908997dbdfe0f43a391`
- parent: `eb16f11734a2ab635a8207f2e6ece4612713f248`
- tree: `a0fe15cde24918aad0ce69a759441586bfd1663b`
- stable patch ID: `5e5fb7c71081a556bf8c83824ab3858637714547`
- 108,321-byte raw binary/full-index patch SHA-256:
  `sha256:766a13947b40a065b67013ae4b357c24b036bfb2a0f373cb5f9b93658989b913`
- changed paths, all simple modifications:
  `packages/compiler/src/query-runtime-identities.test.ts`,
  `packages/compiler/src/scan/query-runtime-identities.ts`,
  `packages/compiler/src/vite.test.ts`, `packages/compiler/src/vite.ts`,
  `packages/server/src/vite-data-plane-gate.test.ts`, and `packages/server/src/vite.ts`.

The baseline and spike are separate clean committed worktrees. The spike must be exactly one commit
above the selected baseline. Its raw binary patch bytes, stable patch ID, and simple-modification
path census must exactly match the durable candidate commit. This allows a measurement source that
contains newer unrelated harness or documentation changes while preventing any unrelated path from
entering the timed candidate. A conflict-resolved cherry-pick is a different candidate and must not
be measured under this binding.

## Serialized measurement

Run N=24 and N=216 as independent decisions on a quiet host. Each corpus uses one process at a time
in exact `baseline, spike, spike, baseline` order. Per lane, split 30 measured edits of every class,
15 fresh-ready samples, and three warmups across the two occurrences. The two blocks receive 15/15
edits, 8/7 ready samples, and 2/1 warmups. Host admission occurs before preparation and each timed
block; a process-wide timing lock covers all four blocks. The full command is:

```sh
vp exec node scripts/perf-dev-generation-spike.mjs \
  --baseline-root ../kovo-dev-critical-path-baseline \
  --spike-root ../kovo-dev-critical-path-candidate \
  --size 24 \
  --ready-samples 15 \
  --ready-timeout-ms 600000 \
  --edit-samples 30 \
  --warmups 3 \
  --timeout-ms 3600000 \
  --measure \
  --out /tmp/kovo-dev-critical-path-n24/report.json
```

Repeat with `--size 216` and a distinct output directory. `--quick-smoke` verifies only transport,
lifecycle, and report shape; v3 marks it `unproven` because it does not meet the decision sample
policy.

After the first quiet-host admission and before the timing lock, the runner independently performs
the following preparation for the baseline and spike source worktrees:

1. Run the exact worktree's frozen repository install, package builds, package closure pack, isolated
   consumer lock resolution, and frozen consumer install.
2. Authenticate that lane's tarballs, installed package census, CLI resolution trace, source commit,
   and three lock digests as `kovo-packed-product-identity/v1`.
3. Generate a new Kovo corpus with `dependencyMode: 'deferred'` below a lane-specific fresh
   `os.tmpdir()` root, outside either repository worktree and without an ancestor `node_modules`.
4. Bind that corpus to only the lane's authenticated consumer. The baseline and spike concrete
   product digests are deliberately not required to be equal. Their regular descriptor files and
   consumer roots must be distinct, and each descriptor must remain directly inside its own
   consumer root.

Every raw dev-loop report must then carry the exact product identity prepared for its own lane,
declare the product required, verify it before and after the measured block, bind its normalized
packed CLI command to the same digest, and report the exact external corpus manifest. Missing or
drifted evidence is `unproven`. The exact A/B policy is
`kovo-dev-generation-packed-product-policy/v3`; it deliberately differs from the general comparison
policy because this preregistration admits the host before preparation as well as before every timed
block. Product preparation remains outside every warmup and measured sample.

When `--out` is present, every child adapter report remains under the adjacent `raw/` directory.
Failed children retain bounded process status, report availability, byte count, SHA-256, schema,
verdict, and diagnostics. The outer report embeds every successful child report and binds source,
locks, corpus shape and bytes, tool bytes, port allocation, host admission, and the exact candidate
patch. Missing or extra cells cannot disappear into aggregation.

## Preregistered acceptance

The numerical thresholds and correctness rules are unchanged from v2; v3 adds the mandatory packed
product boundary above. N=24 and N=216 must each pass independently. The four profile-causal
edit-to-paint metrics are
`leafMs`, `entryMs`, `dataMs`, and `recoveryMs`. Every one must improve by at least 10% at the
candidate median, and every paired bootstrap 95% confidence interval must have a lower bound above
zero.

The following guardrails also apply in each corpus:

- Syntax error: every sample exposes the expected diagnostic, candidate p95 is at most 1,000 ms,
  and both median and p95 regress by no more than 5%.
- Recovery: candidate p95 is at most 2,000 ms in addition to the causal win rule.
- Fresh-ready latency, ready process-tree peak RSS, and edit-session process-tree peak RSS: both
  median and p95 regress by no more than 5%.
- Every B,S,S,B cell is measured with the exact sample policy; there are zero misses, child adapter
  errors or unproven cells, unexpected browser errors, browser request failures, and state-loss
  events across every edit class.

`bundleBytes`, `emittedBytes`, and `moduleCount` are excluded from the decision. A complete,
correct, quiet-host result that misses any threshold is `reject`. Missing, malformed, short,
incorrect, load-shed, source-unstable, or candidate-mismatched evidence is `unproven` rather than a
performance loss. Acceptance requires both corpus reports to say `accept`; neither result alone
authorizes integration.

## Result

Packed-product v3 status: **rejected; do not integrate candidate `336925d40`**.

[Run `31821573222`](https://github.com/kovojs/kovo/actions/runs/31821573222) checked out exact clean
source `1e1300962bcb2862d29a65d7c6bf5ab2bfd67b52` and authenticated the sealed candidate binding above
in both independent hosted jobs. N=24
[artifact `9228112748`](https://github.com/kovojs/kovo/actions/runs/31821573222/artifacts/9228112748)
has ZIP SHA-256 `362dcb0f3f5d72b2214bfdeb0ef47fcb5f71c84ef0b2300211af52760eaada16`
and unpacked report SHA-256
`acc9a86e0709c8ed2a696b91d75a5f723d087e0e1b1529d9e54c4a368e3d977d`. N=216
[artifact `9230349567`](https://github.com/kovojs/kovo/actions/runs/31821573222/artifacts/9230349567)
has ZIP SHA-256 `606cf457bd10fe354dc5a85eef9754cd6bf67162085bb840be700d21ec312452`
and unpacked report SHA-256
`1ff42d2f31c26671f9259eaf5e9db15f201eb35cc492e97c1d4c948fbf8c3044`.

| Browser-visible metric |      N=24 median, baseline → candidate |     N=216 median, baseline → candidate |
| ---------------------- | -------------------------------------: | -------------------------------------: |
| Leaf edit-to-paint     | 4,164.24 → 1,563.94 ms (62.44% faster) | 8,430.09 → 1,730.00 ms (79.48% faster) |
| Entry edit-to-paint    | 4,147.11 → 1,515.13 ms (63.47% faster) | 8,366.31 → 1,614.24 ms (80.71% faster) |
| Data edit-to-paint     | 4,152.85 → 1,530.71 ms (63.14% faster) | 8,380.80 → 1,647.49 ms (80.34% faster) |
| Recovery               | 2,176.27 → 1,465.26 ms (32.67% faster) | 2,731.67 → 1,631.83 ms (40.26% faster) |

All eight causal comparisons clear the 10% median threshold with strictly positive paired
bootstrap 95% confidence intervals. Recovery p95 is 1,637.13 ms at N=24 and 1,815.28 ms at N=216;
syntax-error p95 is 120.20 and 147.29 ms. Those absolute targets, every syntax median/p95 guardrail,
and every ready/edit RSS median/p95 guardrail pass.

The sole failed condition is N=216 fresh-ready p95: 155,835.58 → 164,261.47 ms is a 5.4069%
regression against the preregistered 5% maximum. Its median regression is 2.0667% and passes; N=24
fresh-ready p95 regresses only 1.7228% and passes. The N=24 report therefore says `accept`, while the
complete N=216 report correctly says `reject`.

Both reports contain the exact four-cell `B,S,S,B` schedule, 15 fresh-ready samples, 30 measured
edits per class, and three warmups per lane. All host admissions were comparable; product-boundary
verification covered all eight cells; and there were zero adapter errors, unproven cells, misses,
browser failures, unexpected browser errors, or state-loss events. This is a measured guardrail
rejection, not missing evidence, and an identical rerun cannot authorize integration.

## Ready-neutral follow-up

The first ready-neutral refinement was sealed as commit
`2da4640f18af0dd37ae851658dddace5c3fa96c5`, parent
`eb16f11734a2ab635a8207f2e6ece4612713f248`, tree
`600ac33b324f411586039b6739628bb340ebbf76`, stable patch ID
`d32a93bfd31cd1b8d0b4d8fd696a0d421e126987`, and full-index binary patch SHA-256
`206cd87527a7d32d636af69fb9de6fb1e03ee45e93831b0c3b82b5a509c96241` over the same six paths.
Its focused compiler/server suite passed 165/165, but independent adversarial review rejected it
before push or measurement.

The candidate retained one path-only `watchChange(update)` token and allowed a matching component
HMR to reuse query names without authenticating imported declarations, barrels, package/config
resolution, or their byte identities. Its own test changed an imported Kovo query to a structural
forgery without delivering that dependency event, delivered the real component watcher/HMR pair,
and observed stale generated `queryNames` after the bound generation stage ran. Vite does not
provide a global cross-file notification fence that could make the component event authoritative
for those dependencies. That is a concrete fail-closed/source-derived identity violation under
SPEC §4.1, so `2da4640f1` must not be pushed, measured, or integrated.

The next candidate keeps only the separately profiled async whole-project analysis settlement for
ordinary edits and removes dependency-sensitive query reuse entirely. It is a new sealed candidate,
not a retry of either rejected patch, and must independently pass the same full packed-product N=24
and N=216 contract before integration.
