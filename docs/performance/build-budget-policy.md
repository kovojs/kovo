# Production-build performance budgets

Kovo's production-build budgets are derived from raw reports rather than typed in by hand. A
budget is eligible only after `scripts/perf-baseline-ratify.mjs` has accepted five independent
GitHub Actions comparison reports for one exact host, dependency-lock, workload, and source
subject. Keep the five raw reports as linked CI artifacts.

Each report must contain ten serialized samples per framework for both N=24 and N=216 as separate
workload subjects, covering `clean`, `unchanged`, and one-line `edit` builds in Kovo, Next, Next,
Kovo order. Every sample carries wall time, peak process-tree RSS, artifact bytes, output and source
integrity, and the unmodified nested Kovo phase census. Kovo's source-check phases run inside the
`analyze` worker; they are not added to worker durations. The CLI/startup tail is only the
nonnegative measured wall time minus the authenticated sequential worker envelope. This preserves
the current-source/deploy-proof boundary required by SPEC §5.2 rule 9.

After ratification, derive a budget while supplying the same five raw files. The command re-hashes
each local download and recovers its durable artifact URL from the ratified content digest, so the
download directory does not need to reproduce any CI-side path:

```sh
vp exec node scripts/perf-build-budget.mjs derive \
  --baseline reports/perf-baseline-build-n24.json \
  --report artifacts/run-1/comparison.json \
  --report artifacts/run-2/comparison.json \
  --report artifacts/run-3/comparison.json \
  --report artifacts/run-4/comparison.json \
  --report artifacts/run-5/comparison.json \
  --out reports/perf-build-budget-n24.json
```

The derivation re-hashes, parses, validates, and re-ratifies all five reports. It then derives the
median and within-run p95 ceilings for wall time, RSS, and artifact bytes in every build mode. The
default regression envelope is 5%. The plan-declared first milestone remains explicit and
separate: Kovo wall median at most 6× Next and peak-RSS median at most 2× Next.
Matched Next median/p95 and paired-median evidence remain embedded beside each derived Kovo
ceiling, so the reviewed summary does not depend on copied raw-report numbers.

Evaluate a new clean comparison report with:

```sh
vp exec node scripts/perf-build-budget.mjs evaluate \
  --budget reports/perf-build-budget-n24.json \
  --candidate artifacts/candidate/comparison.json \
  --out artifacts/candidate/build-evaluation.json
```

The candidate may have a newer source commit, but its runner, locks, and workload must match the
ratified subject exactly. Missing phase evidence, changed locks, busy-host evidence, short samples,
wrong corpus or mode, reused execution identity, or a forged/negative CLI residual yields
`unproven`, never a pass.
