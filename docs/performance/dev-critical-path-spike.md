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
SHA-256. The source, baseline, and applied repositories must all report the same exact Git object
format (`sha1` for this series); only a full 40-hex SHA-1 or full 64-hex SHA-256 object ID is
admissible. Every blob returned by Git is independently reframed as `blob <byte-length>\0<bytes>`
and hashed with that repository format before its separate SHA-256 and byte length are recorded.
The combined source and applied censuses must be byte-for-byte equal under canonical JSON; for the
series above their object-format-bound content digest is
`sha256:73d211d9d5018ae499c4bfc1b2b325c000939ae11ecad37cf4679153a22b831b`.

Every clean-state admission is stronger than `git status`. Without changing the index, the runner
requires an exact stage-zero index-to-HEAD path/mode/object census, rejects assume-unchanged,
skip-worktree, and other nonordinary index tags, then reads every tracked regular file or symlink
and independently verifies its live mode and Git-framed object identity. Descriptor/path identity
is stable across each read. This prevents a clean-looking index flag, `core.fileMode=false`, or a
hidden tracked-byte mutation from changing what packed preparation builds. Ordinary staged,
unstaged, and untracked status checks and the before/after source-stability checks remain mandatory.

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
delta. Missing or extra cells cannot disappear into aggregation.

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

Status: **rejected; do not integrate the repaired async-analysis series**.

[Run `32191978426`](https://github.com/kovojs/kovo/actions/runs/32191978426) checked out exact clean
source `85a9feddc50340c8c17df2144140e11211be1beb`, authenticated the durable ref at exact tip
`1c591eca2fa7d1ba9c5cf90673cea36c54ee158f`, and reproduced the three declared source commits,
parents, trees, six-path blob census, and canonical delta digest `sha256:73d211d9…`. Fresh external
baseline/candidate worktrees independently replayed the same applied trees. The N=24 and N=216
jobs ran separately on the same normalized AMD EPYC 7763 hosted-runner posture:

- [N=24 job `95888055564`](https://github.com/kovojs/kovo/actions/runs/32191978426/job/95888055564),
  [artifact `9345412871`](https://github.com/kovojs/kovo/actions/runs/32191978426/artifacts/9345412871):
  ZIP SHA-256 `f97cf7bd2248daa17dcad4b64d5377c5fc96e9ef10f3e602f188eccf1d318433`, report SHA-256
  `11d37fd373aa1c9c64e609b102dd47a7630dd4c8976e49c85f6ad43c71a2ab64`.
- [N=216 job `95888055524`](https://github.com/kovojs/kovo/actions/runs/32191978426/job/95888055524),
  [artifact `9346485781`](https://github.com/kovojs/kovo/actions/runs/32191978426/artifacts/9346485781):
  ZIP SHA-256 `64ea0bf504814e3f51cbf66ba9c64a4816a90d5da2e5df8347c5ffa339ff30f9`, report SHA-256
  `0e93792fd48e3f0e349a2b987c18860926967ae99cc5dc513c3da6c077bf9c7c`.

Both ZIPs contain exactly `report.json` and the four CRC-valid raw `B,S,S,B` reports. Independent
aggregation replay reproduced each checked-in analysis. Both decisions are complete measured
`reject` results, not infrastructure or evidence failures:

| Browser-visible metric |       N=24 median, baseline → candidate |        N=216 median, baseline → candidate |
| ---------------------- | --------------------------------------: | ----------------------------------------: |
| Fresh ready            | 26,934.78 → 28,194.30 ms (4.68% slower) | 74,833.50 → 111,834.20 ms (49.44% slower) |
| Leaf edit-to-paint     |  4,164.27 → 2,280.28 ms (45.24% faster) |    8,597.17 → 2,413.40 ms (71.93% faster) |
| Entry edit-to-paint    |  4,147.14 → 2,252.29 ms (45.69% faster) |    8,532.63 → 2,347.06 ms (72.49% faster) |
| Data edit-to-paint     |  4,114.16 → 2,245.37 ms (45.42% faster) |    8,580.26 → 2,296.89 ms (73.23% faster) |
| Recovery               |   2,182.20 → 2,148.64 ms (1.54% faster) |    2,803.16 → 2,312.72 ms (17.50% faster) |

N=24 fails three declared conditions: recovery improves only 1.54%, its paired 95% confidence
interval `[-133.80, +125.43] ms` crosses zero, recovery p95 is 2,382.57 ms, and syntax median
regresses 8.99%. N=216 fails fresh-ready decisively: median and p95 regress 49.44% and 49.09%, with
paired baseline-minus-candidate confidence interval `[-37,993.60, -36,240.01] ms`; its recovery
p95 is also 2,476.41 ms. N=216's four causal edit medians and confidence intervals otherwise pass,
as do its syntax and RSS guardrails. N=24's leaf, entry, and data causal checks pass, but that cannot
override its recovery and syntax failures.

Each report retains the exact four-cell schedule, 15 fresh-ready samples, 30 measured edits per
class, and three warmups per lane. All host admissions passed; product-boundary verification covered
all eight cells; and there were zero adapter errors, unproven cells, misses, browser request
failures, unexpected browser errors, or state-loss events. Every class survived state 60/60 per
corpus and produced all 60 syntax diagnostics. The workflow jobs conclude `failure` only because a
measured rejection exits nonzero; both commit-pinned artifact uploads succeeded.

Earlier [run `32187892588`](https://github.com/kovojs/kovo/actions/runs/32187892588) remains
diagnostic evidence only. It authenticated the same source transition but stopped before sampling
because v5 treated a Git-version-dependent textual patch rendering as durable identity. V6 replaced
that check with the canonical object-format-bound blob census used by the final run above; the
earlier run is neither an accept nor an additional rejection.

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
atomic registry publication and frozen-byte repairs. It is a distinct sealed candidate, not a retry
of either earlier patch, but the complete N=24 and N=216 measurements above reject it. None of its
three commits may enter production history under this decision.
