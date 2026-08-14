# Exact dev edit-to-paint profiling

`benchmarks/corpora/dev-loop.mjs` can bracket Inspector CPU and allocation sampling around the exact
measured source-write-to-destination-paint window. This is diagnostic evidence, not a latency lane:
the report sets `verdict.status` to `diagnostic-only`, preserves all ordinary corpus/state/browser/
RSS/source-integrity gates, and refuses timing claims because both samplers perturb the process.

The authenticated corpus posture is
`refresh-surfaces-sibling-to-local-state/v1`: leaf, entry, and data are separate component roots,
and the local counter is their sibling. Kovo measures query-backed inferred live-target refreshes;
Next.js measures the matching Fast Refresh component topology. This keeps `Count 1` outside every
replacement boundary, as required by SPEC §4.1/§4.9/§9.5.1 and KV420, so a passing state gate
means the edited surface preserved unrelated browser state rather than reconstructing it.

The profile classifies directly observed self samples into module evaluation, Vite transform, SSR
generation, and asynchronous proof convergence. The stack-v3 classifier attributes a leaf sample
only from functions observed in its complete Inspector ancestry; a generic TypeScript scanner below
Kovo's asynchronous project-analysis frame therefore remains proof-convergence work, while the same
scanner under another stack does not. Allocation uses the same ancestry rule. Categories are ranked
by their larger observed CPU/allocation share, never by comparing microseconds with bytes. Every
category receives an explicit ruling: present in the current top five, observed outside it, or
retired because it was absent. Work that matches no reviewed classifier stays in the raw profiles and
the census as unattributed; it is never assigned by guess.

Inspector keeps one `timeDeltas` integer for every sample; the first delta is relative to profile
start and later deltas are between adjacent samples. Under load V8 can serialize a small signed delta
when sample timestamps arrive out of order. Following Chromium's
[`CPUProfileDataModel`](https://chromium.googlesource.com/devtools/devtools-frontend/+/main/front_end/models/cpu_profile/CPUProfileDataModel.ts),
Kovo reconstructs timestamps and stably sorts only the derived timestamp/sample pairs before
attribution. It never rewrites the retained `.cpuprofile`. Validation still requires exact
sample/delta cardinality, safe-integer deltas and timestamps, every cumulative timestamp inside the
authenticated `[startTime, endTime]` range, and a valid node graph with known sample and child IDs.
The report calls the exact anomaly count `negativeCpuTimeDeltas`; it does not mislabel that count as
the number of samples moved by sorting. The stack-v3 identity prevents summaries produced by the old
nonnegative-delta rule from passing the current audit.

The hosted diagnostic census is three measured windows per edit class after three warmups (15 raw
CPU/heap pairs per corpus). A clean N=24 calibration at `8afdec2c9` retained 379 MiB for only one
window per class, which projects to about 11.4 GiB at 30 iterations before the repository,
dependencies, browser, or upload staging. A standard `ubuntu-24.04` GitHub-hosted runner has 14 GB of
SSD ([runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)),
so a 30-window profile census is not fail-closed evidence. The separate unprofiled comparison keeps
30 measured edits per class and owns every latency claim; the bounded profile census owns only the
current ranking and hypothesis retirements.

## Current hosted evidence

Run [`31799441158`](https://github.com/kovojs/kovo/actions/runs/31799441158) checked out exact clean
commit `89b39c999de6a7c60f3091831916ddb2c4c5037c`. Both jobs completed on the same hosted-runner
cohort with stable lock and posture digests, corpus verification before and after, 15/15 windows
(three per edit class), all 30 declared CPU/heap files, 46 successful browser responses, zero
request or unexpected browser errors, zero edit misses, and exact non-ephemeral port evidence.

| Corpus | Job / artifact                                                                                               | ZIP SHA-256                                                        | `report.json` / `audit.json` SHA-256                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| N=24   | `94763687906` / [`9218931767`](https://github.com/kovojs/kovo/actions/runs/31799441158/artifacts/9218931767) | `7ba2f29517d68489dd8e3959e7785f0467f55f26d4ca0eb79d71894b47126e3e` | `e07e6535025d51b4dd477dd175c76d4b888191ac2941cb3fd7efc027b3fabd0d` / `9176bcf084df6a0f3304aa97397020a67da1093cd4fd5e6fb358e2a0d90a278f` |
| N=216  | `94763687934` / [`9219104452`](https://github.com/kovojs/kovo/actions/runs/31799441158/artifacts/9219104452) | `4ec0d64e79099f3afb6a1144949af609b2b3e929d8a483f7b942f56e15a1db24` | `2667a6efe8bae8626c8d2fc25f0ddf3aea0d7e58c01fec0f5358415c5b38115f` / `6d77776cdb4fcd5eefaa71eee59c6179cfa46b8470a4629b2cd055ce5d3a3ccd` |

The N=24 and N=216 authenticated profile-set digests are respectively
`4cc4185287ed571de6b05a0a3b12bf2848b14b48b3c31eb671c2357f57b3c052` and
`6f51369cd21add66e25ed8388d78fdb1d897c978ee09a28f6e62096f6f2d5768`. A separate raw replay
re-read both corpora, reproduced every census/category/integrity result, and bound the combined
91,588-byte ranking as
`sha256:50a29441af7bcd9f151029ee0b4f45f039ceb28e716f9d4347ae3e41a9163c2f`.

## Current ranking and decision

The percentages below are stack-attributed shares of each complete corpus profile. Self time and
allocation are census totals rather than implementation hypotheses; the remaining rows are the
reviewed categories ranked by the larger CPU/allocation share.

| Category                       | N=24 CPU / allocation | N=216 CPU / allocation | Ruling                                  |
| ------------------------------ | --------------------: | ---------------------: | --------------------------------------- |
| Asynchronous proof convergence |       46.09% / 49.00% |        61.04% / 70.11% | Current top-five target                 |
| Module evaluation              |         2.98% / 5.08% |          2.00% / 2.67% | Retain in ranking, not the first target |
| Vite transform                 |       0.032% / 0.056% |        0.027% / 0.044% | Retire as an implementation hypothesis  |
| SSR generation                 |       0.008% / 0.003% |        0.006% / 0.001% | Outside top five; retire                |

Per-class replay makes the actionable boundary sharper. For ordinary leaf, entry, and data edits,
whole-project analysis owns about 50% of N=24 CPU and 62--63% of N=216 CPU; the category reaches
roughly 52%/55--56% CPU/allocation at N=24 and 66%/75.5% at N=216. The settle timer starts before
HMR completes, so this nominally asynchronous work begins while the edit-to-paint window is still
active. The next candidate must start convergence only after the HMR outcome has been published.

Recovery is a distinct compiler hotspot. `recordViteCompileResult` through
`resolveComponentQueryRuntimeNames` owns 75.03% of N=24 recovery CPU and 67.50% at N=216;
`host.getSourceFile` alone owns 52.66% and 47.74%. The resolver constructs a fresh TypeScript
program for the same unchanged query binding on each render-only edit. The next candidate may reuse
that result only from a plugin-scoped exact binding preimage and must invalidate on dependency,
configuration, or other-file change; ambiguity still executes the full resolver.

Syntax-error windows are already a separate fast parser/diagnostic path with no module-evaluation or
SSR attribution. They remain a correctness and p95 guardrail, not a target inferred from absent
profile evidence. All durations in these profiled reports remain diagnostic-only.

The earlier N=216 run `31766167951` remains useful only as validator-repair history: its retained raw
profiles exposed 13 signed deltas from -1 through -57 microseconds, and stack-v3 replay proved the
repair before this clean two-corpus rerun. It no longer owns the current ranking.

## Run

Generate the authenticated N=24 and N=216 corpora using `benchmarks/corpora/generate.mjs`, then run
one Kovo corpus at a time from a clean committed worktree. Profile directories must be outside both
the corpus and source worktree so raw artifacts cannot dirty or alter either identity.

```sh
node benchmarks/corpora/dev-loop.mjs \
  --manifest /absolute/corpus/kovo/n24/manifest.json \
  --iterations 3 \
  --ready-iterations 1 \
  --warmups 3 \
  --port 49120 \
  --inspector-port 50120 \
  --profile-dir /tmp/kovo-dev-profile-n24 \
  --out /tmp/kovo-dev-profile-n24.json
```

The dev port is the base of the adapter's exact per-session range: this example uses 49120 for its
fresh-ready session and 49121 for its edit session. Keep the Inspector port outside that entire
range. The adapter samples only the three measured edits per class; the three warmups remain
unprofiled. Raw `.cpuprofile` and `.heapprofile` files are mode `0600` and each is bound into the
report by name, byte count, and SHA-256. Re-read and reproduce the report from those retained bytes
before publication:

```sh
node scripts/perf-dev-edit-profile-audit.mjs \
  --report /tmp/kovo-dev-profile-n24.json \
  --profile-dir /tmp/kovo-dev-profile-n24 \
  --out /tmp/kovo-dev-profile-n24-audit.json
```

Hosted CI additionally passes `--require-provider github-actions`, binding the report to its GitHub
run identity and exact runner-image cohort. The audit rejects a missing/surplus profile, a byte-count
or SHA-256 mismatch, a non-regular file, a stale classifier, or a ranking that cannot be reproduced
from the raw Inspector payloads.

Do not compare the profiled durations with the unprofiled Kovo/Next baseline or use them to accept a
spike. Use the diagnostic ranking to select or retire hypotheses, then measure any implementation in
the ordinary serialized `Kovo, Next, Next, Kovo` or `baseline, spike, spike, baseline` lane.
