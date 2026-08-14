# Developer-loop budget policy

Developer-loop budgets are derived independently for the generated N=24 and N=216 corpora. A
comparison declares 30 measured edits, 15 fresh-ready starts, and three warmups **per framework**.
`benchmarks/compare.mjs` splits those totals across serialized `Kovo, Next, Next, Kovo`
occurrences as 15/15 edits, 8/7 starts, and 2/1 warmups. The occurrence schedule is part of the
workload digest and every raw cell repeats its assigned slice.

That workload digest authenticates
`editStatePosture: refresh-surfaces-sibling-to-local-state/v1`: leaf, entry, and data are explicit
component refresh roots in both entrants, while the `Count 1` local-state island is their sibling.
For Kovo those roots are query-backed inferred live targets under SPEC §4.1/§4.9/§9.5.1; this
avoids the KV420-invalid and benchmark-invalid shape where a server morph encloses the state gate.

This policy follows the honesty boundary in SPEC §1.1: a missing diagnostic, lost browser state,
partial sample series, dirty source, changed lock, mismatched corpus, busy host, or reused execution
identity is `unproven`, not a passing budget result.

The dev workload identity also fixes a stable packed-product policy rather than one commit's
tarball digest. Each raw report separately authenticates its concrete Kovo artifact against that
report's clean commit and locks, repeats it exactly in every Kovo dev cell, and requires exact null
product evidence in every Next cell. All five baseline reports must share one concrete artifact;
the derived budget retains it. A later candidate must authenticate its own artifact, which normally
differs on a newer commit, while preserving the same workload policy. These checks are repeated at
raw-report, baseline, budget, candidate, and publication boundaries.

## Ratify and derive

Collect five independent comparison reports for one exact source, host, lock set, workload, and
corpus size. Ratify their linked raw reports:

```sh
node scripts/perf-baseline-ratify.mjs \
  --report artifacts/run-1/comparison.json \
  --location https://github.com/kovojs/kovo/actions/runs/1001/artifacts/2001 \
  --report artifacts/run-2/comparison.json \
  --location https://github.com/kovojs/kovo/actions/runs/1002/artifacts/2002 \
  --report artifacts/run-3/comparison.json \
  --location https://github.com/kovojs/kovo/actions/runs/1003/artifacts/2003 \
  --report artifacts/run-4/comparison.json \
  --location https://github.com/kovojs/kovo/actions/runs/1004/artifacts/2004 \
  --report artifacts/run-5/comparison.json \
  --location https://github.com/kovojs/kovo/actions/runs/1005/artifacts/2005 \
  --out reports/dev-n24-baseline.json
```

Each `--location` must be the canonical artifact URL from the corresponding report's authenticated
Actions run. Supply one for every `--report` when the summary will be committed. Omitting all
locations retains the local report paths and is intended only for scratch ratification.

Then derive a reviewable budget without authoring timing or RSS numbers. Supply the same five raw
downloads again; derivation re-hashes them, recovers each retained canonical artifact URL by content
digest, validates the raw dev cells, and reproduces the ratified summary before creating a budget:

```sh
node scripts/perf-dev-budget.mjs derive \
  --baseline reports/dev-n24-baseline.json \
  --report artifacts/run-1/comparison.json \
  --report artifacts/run-2/comparison.json \
  --report artifacts/run-3/comparison.json \
  --report artifacts/run-4/comparison.json \
  --report artifacts/run-5/comparison.json \
  --out reports/dev-n24-budget.json
```

Repeat with the N=216 reports. Each leaf, entry, **data-plane**, syntax-error, recovery, ready, and
process-tree RSS ceiling is the ratified median statistic plus the plan's 5% regression allowance.
Ratification retains both run medians and the distribution of each run's p95, so a p95 ceiling is
not inferred from medians. `edit.dataMs` is an independently required timing metric; a report or
budget that predates that census fails validation under the existing `v1` schema instead of being
silently accepted as a smaller historical shape.
The derived budget also retains the matched Next median/p95 and paired median for each metric, so a
reviewed publication can report the comparison without copying numbers from raw files.

## Evaluate a later commit

```sh
node scripts/perf-dev-budget.mjs evaluate \
  --budget reports/dev-n24-budget.json \
  --candidate artifacts/candidate/comparison.json \
  --out artifacts/candidate/dev-n24-evaluation.json
```

The candidate may be a new clean source commit with a different authenticated packed artifact, but
it must preserve the exact ratified host, locks, and workload identity. The evaluator covers leaf,
entry, and data-plane edit-to-paint latency, syntax-diagnostic latency and availability, recovery
latency, ready latency, fresh-ready and edit-session process-tree RSS, every edit class's
browser-state survival, and exact sample availability. The aggregate publication retains an exact
baseline/holdout census of the median and p95 regression checks for every timing/RSS metric,
including both `edit.dataMs` rows; deleting either row makes the aggregate invalid. In addition to
the data-derived regression ceilings, it enforces the declared plan targets: ready and leaf medians
at most 2x matched Next, entry median at most 3x matched Next, syntax-error p95 at most one second,
and recovery p95 at most two seconds.
