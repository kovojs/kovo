# Profile-driven development critical-path spike

This is the packed-product v3 decision contract for the repaired async-analysis candidate selected
from the authenticated development edit profiles. It supersedes the source-checkout v2 runner and
the rejected fresh-generation v1 comparison. The outer, preparation, retained-failure, and product
boundary schemas remain v3. Candidate identity is now `kovo-dev-generation-candidate-binding/v6`;
an earlier candidate binding cannot be reinterpreted as evidence for this content-census-bound
series.

## Causal basis

The production optimization is limited to the whole-project asynchronous proof-convergence cost
established by the clean N=24 and N=216 profile census in
[`dev-edit-profile.md`](./dev-edit-profile.md):

- Whole-project asynchronous proof convergence starts before HMR has published its outcome and
  competes with the leaf, entry, and data edit-to-paint critical path.

The second and third commits are correctness repairs required by the optimization: compiler/runtime
registry state is assembled as a complete generation and published atomically after compilation,
then the exact virtual-module bytes are frozen into that committed generation. Consumers cannot
observe a mixed generation, silently replace compiler-derived state with a disk recensus, or
re-serialize retained mutable facts during a later module load. The repaired series contains no
dependency-sensitive query-runtime identity reuse and claims no win from that separately observed
recovery hotspot (SPEC §4.1, §5.2, and §9.5).

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
`refs/heads/perf-spike/dev-async-analysis-only-20260814`. The exact linear series is bound as:

- series parent: `eb16f11734a2ab635a8207f2e6ece4612713f248`, tree
  `66aa1edca7a8112ebd708511e462e24bbd9b80b6`
- optimization commit: `1aea7dd0678254ceeaa869c537b8f5317777cb08`, parent
  `eb16f11734a2ab635a8207f2e6ece4612713f248`, tree
  `2b9ecbca08f6ebc7777a21163eead9dd9b3205e4`
- atomic-publication repair: `07d6e5b23245df0d48fc071f78397329750705ee`, parent
  `1aea7dd0678254ceeaa869c537b8f5317777cb08`, tree
  `4c9a0aaa38ce39ddf73c839e083660f131bd951b`
- repaired series tip: `1c591eca2fa7d1ba9c5cf90673cea36c54ee158f`, parent
  `07d6e5b23245df0d48fc071f78397329750705ee`, tree
  `c409518713e7ae1451b4eb3d3524b17b4ac823fa`
- changed paths, all simple modifications:
  `packages/server/src/internal/data-plane-static-analysis.test.ts`,
  `packages/server/src/internal/data-plane-static-analysis.ts`,
  `packages/server/src/internal/runtime-registry-wire.ts`,
  `packages/server/src/registry-facts.test.ts`,
  `packages/server/src/vite-data-plane-gate.test.ts`, and `packages/server/src/vite.ts`.

The baseline and spike are separate clean committed worktrees. The spike must be exactly three
commits above the selected baseline, produced by cherry-picking the bound commits in order. The
durable ref and all three source commit, parent, and tree identities must match. For every source
and applied commit boundary, v6 also authenticates the exact simple-modification path set and a
canonical before/after census containing each regular blob's mode, object ID, byte length, and
SHA-256. The combined source and applied censuses must be byte-for-byte equal under canonical JSON;
for the series above their content digest is
`sha256:fc022810f961fe5b8fc54d89609bef27cd01127a15c241047bc6d8460cd8e41d`.

Raw `git diff` bytes and stable patch IDs remain same-host equivalence diagnostics, not durable
candidate identity. Git 2.50.1 with `diff.algorithm=histogram` rendered the combined source delta as
113,296 bytes, SHA-256
`ef119100be9f3a03d2de44a18a0114a988d0875cde324d23fa8b3cba60181c96`, patch ID
`7ca973eed5467af294c601d41f3ddb1ade04fbff`; hosted Git 2.54's default Myers rendering of the same
objects was 113,290 bytes, SHA-256
`8f91b8b7b78d8d896ed5547ccdf2ab2a0a6c3a822e6a7b8559f5217a13542bcf`, patch ID
`0b5d7f891520eed5d3c77535a7eb3c7ede955085`. V6 passes explicit diff configuration for the
diagnostic and compares source against applied output only on the same host. Machine-global diff
configuration therefore cannot change the canonical binding or weaken the equivalence check.

This allows a measurement source that contains newer unrelated harness or documentation changes
while preventing any unrelated path or changed candidate-path blob from entering the timed
candidate. A conflict-resolved cherry-pick is a different candidate and must not be measured under
this binding.

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

## Repaired candidate status

Status: **awaiting the hosted N=24 and N=216 decision; no result is claimed yet**.

[Run `32187892588`, N=24 job
`95875635162`](https://github.com/kovojs/kovo/actions/runs/32187892588/job/95875635162) is
authenticated diagnostic evidence only. It checked out exact source
`a69f823ccb34aa41ec13b4215e95eb23da6d1197`, fetched the exact durable candidate ref, verified the
three source parents, and cleanly created the three-commit applied series, but failed before its
first benchmark sample because v5 compared Git-version-dependent combined diff constants. Clean
local worktrees at the same source reproduced zero drift on all six candidate paths. The clean
applied series was `406210810a1a3731e118a73540ce32bee60f327e` →
`11adfd50e3a3f0c06ebc8ceb6d7fcb3cbd2fa821` →
`fd52ed21565fd04567280c1f0b43a3b006ee1aa5`, with final tree
`50c0d5f6836518e667cc745be316749d3f1c43cc`; its canonical delta digest exactly matched the source
digest above. The reproduction proved that the two raw identities describe the same source and
applied blob transitions. The run cannot be treated as `accept` or `reject`; a new v6 run is
required.

The workflow prepares clean committed baseline and candidate worktrees, applies the exact bound
three-commit series, and runs the unchanged serialized `B,S,S,B` contract independently for both
corpora. Only two complete reports that each say `accept` can authorize integration.
Candidate binding is evidence identity, not publication authority; a separate independent review
of the repaired tip must also complete before the candidate ref is published.

## Historical rejected candidate result

The superseded six-path candidate `336925d40e11024b54206908997dbdfe0f43a391` was rejected and must
not be integrated. Its result does not apply to the repaired candidate bound above.

[Run `31821573222`](https://github.com/kovojs/kovo/actions/runs/31821573222) checked out exact clean
source `1e1300962bcb2862d29a65d7c6bf5ab2bfd67b52` and authenticated the then-current superseded
six-path candidate in both independent hosted jobs. N=24
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

## Why the earlier ready-neutral candidate is excluded

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

The repaired series bound above keeps only the separately profiled async whole-project analysis
settlement for ordinary edits, removes dependency-sensitive query reuse entirely, and adds the
atomic registry publication and frozen-byte repairs. It is a new sealed candidate, not a retry of
either rejected patch, and remains unmeasured until it independently passes the same full
packed-product N=24 and N=216 contract.
