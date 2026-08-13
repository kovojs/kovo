# Developer-loop budget policy

Developer-loop budgets are derived independently for the generated N=24 and N=216 corpora. A
comparison declares 30 measured edits, 15 fresh-ready starts, and three warmups **per framework**.
`benchmarks/compare.mjs` splits those totals across serialized `Kovo, Next, Next, Kovo`
occurrences as 15/15 edits, 8/7 starts, and 2/1 warmups. The occurrence schedule is part of the
workload digest and every raw cell repeats its assigned slice.

This policy follows the honesty boundary in SPEC §1.1: a missing diagnostic, lost browser state,
partial sample series, dirty source, changed lock, mismatched corpus, busy host, or reused execution
identity is `unproven`, not a passing budget result.

## Ratify and derive

Collect five independent comparison reports for one exact source, host, lock set, workload, and
corpus size. Ratify their linked raw reports:

```sh
node scripts/perf-baseline-ratify.mjs \
  --report artifacts/run-1/comparison.json \
  --report artifacts/run-2/comparison.json \
  --report artifacts/run-3/comparison.json \
  --report artifacts/run-4/comparison.json \
  --report artifacts/run-5/comparison.json \
  --out reports/dev-n24-baseline.json
```

Then derive a reviewable budget without authoring timing or RSS numbers:

```sh
node scripts/perf-dev-budget.mjs derive \
  --baseline reports/dev-n24-baseline.json \
  --out reports/dev-n24-budget.json
```

Repeat with the N=216 reports. Each timing and RSS ceiling is the ratified median statistic plus
the plan's 5% regression allowance. Ratification retains both run medians and the distribution of
each run's p95, so a p95 ceiling is not inferred from medians.

## Evaluate a later commit

```sh
node scripts/perf-dev-budget.mjs evaluate \
  --budget reports/dev-n24-budget.json \
  --candidate artifacts/candidate/comparison.json \
  --out artifacts/candidate/dev-n24-evaluation.json
```

The candidate may be a new clean source commit, but it must preserve the exact ratified host, locks,
and workload identity. The evaluator covers leaf and entry edit-to-paint latency, syntax-diagnostic
latency and availability, recovery latency, ready latency, fresh-ready and edit-session process-tree
RSS, every edit class's browser-state survival, and exact sample availability. In addition to the
data-derived regression ceilings, it enforces the declared plan targets: ready and leaf medians at
most 2x matched Next, entry median at most 3x matched Next, syntax-error p95 at most one second, and
recovery p95 at most two seconds.
