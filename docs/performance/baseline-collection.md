# Baseline artifact collection

`scripts/perf-publication-collect.mjs` is the metrics-blind operator helper for the seven-family
publication campaign. It never writes into the measured checkout. The checkout must be clean at
the exact requested source commit, and each output must be a new directory whose parent already
exists outside that checkout. The checkout, every collection input, and the manifest output must
be pairwise disjoint: no one may equal, contain, or be contained by another.

Collect any completed baseline runs into an atomic custody pool. Focused runs may contain one
family; an all-family run may contain several:

```sh
vp exec node scripts/perf-publication-collect.mjs collect \
  --checkout /absolute/path/to/clean/measured-checkout \
  --source <exact-source-sha> \
  --repository kovojs/kovo \
  --out /external/custody/batch-1 \
  --run <workflow-run-id> \
  --run <workflow-run-id>
```

Collection preserves the exact artifact API, workflow-run API, all-attempt jobs API, ZIP, and
extracted report bytes. It accepts only the seven literal baseline artifacts and validates their
run, source, workflow, producer job, family workload, retention, archive digest, and one-member ZIP
identity before the output directory appears. Additional batches use additional new `--out`
directories; collection directories are immutable manifest inputs.

Once every family has a six-run cohort, emit the self-contained input for the authoritative
publication gate:

```sh
vp exec node scripts/perf-publication-collect.mjs manifest \
  --checkout /absolute/path/to/clean/measured-checkout \
  --source <exact-source-sha> \
  --repository kovojs/kovo \
  --collection /external/custody/batch-1 \
  --collection /external/custody/batch-2 \
  --out /external/custody/final-publication
```

The cohort key contains the exact source, dependency locks, workload identity, full host digest,
and, for dev/build, concrete packed-product policy and identity. Analysis values and raw benchmark
timings never enter grouping or ordering. Within the one qualifying cohort, immutable workflow-run
`created_at` then run ID chooses the first five baselines and the sixth holdout.

If a family has multiple qualifying cohorts, the command fails and prints their digests. Select
one exact cohort digest, or a host digest that uniquely identifies one qualifying cohort:

```sh
  --cohort dev-n216=sha256:<64-lowercase-hex>
```

The result is `performance-publication-input.json` plus all 210 raw custody files. Run
`scripts/perf-publication-gate.mjs` from the same clean measured checkout; that gate remains the
authority for live GitHub/workflow authentication, re-ratification, budget derivation, holdout
evaluation, and the final publishable/blocked/unproven verdict. Optional N=216 build-profile
evidence is a separate conditional input and is not selected by this baseline-only helper.
