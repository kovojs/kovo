# Baseline artifact collection

`scripts/perf-publication-collect.mjs` is the metrics-blind operator helper for the seven-family
publication campaign and its separate Production-bytes sidecar. The sidecar is not an eighth
ratified family. The collector never writes into the measured checkout. The checkout must be clean at
the exact requested source commit, and each output must be a new directory whose parent already
exists outside that checkout. The checkout, every collection input, and the manifest output must
be pairwise disjoint: no one may equal, contain, or be contained by another.

Before looking at report metrics, preregister one inclusive workflow-run ID boundary. Collect every
exact-source `perf-realistic.yml` run in that boundary into one atomic custody pool. The command
cross-checks repeated `--run` values against GitHub's complete exact-source workflow-run census and
fails closed when the census exceeds one 100-run API page. Focused runs may contain one family; an
all-family run may contain several:

The one-page limit is an invalidation boundary, not an implicit truncation policy. If the
exact-source census grows beyond 100 runs, do not collect or publish from it. Before preregistering
the boundary, an operator may delete obsolete exploratory runs until the complete census fits one
page, then record that cleanup and preregister the retained endpoints out of band. GitHub deletion
history and the timing of preregistration remain procedural facts; this repository does not claim
to prove either one cryptographically.

```sh
vp exec node scripts/perf-publication-collect.mjs collect \
  --checkout /absolute/path/to/clean/measured-checkout \
  --source <exact-source-sha> \
  --repository kovojs/kovo \
  --out /external/custody/complete-campaign \
  --campaign-first-run <first-inclusive-run-id> \
  --campaign-last-run <last-inclusive-run-id> \
  --run <workflow-run-id> \
  --run <workflow-run-id>
```

Collection preserves and content-addresses the raw campaign workflow-run census and every run's raw
artifact listing, in addition to the exact artifact API, workflow-run API, all-attempt jobs API,
ZIP, and extracted report bytes. Its ledger must enumerate every literal publication artifact in
those listings; removing a run, listing, family candidate, or Production-bytes candidate is rejected.
It accepts the seven literal baseline artifacts plus every literal
`kovo-perf-bytes` artifact present in the selected runs. Family reports retain their existing
run/source/workload rules. A Production-bytes candidate must be the PR-only `bytes` / `Production
bytes` producer, a one-member `bytes.json` ZIP, clean and stable exact-source provenance with the
three required lock digests, `suite=bytes`, `componentCount=24`, complete integrity, and the exact
five deterministic byte metrics. The report itself may be measured even when its budget-evaluation
step makes the producer job fail. That exception is authenticated from the all-attempt jobs API: the
measurement step must have succeeded, budget evaluation must be the sole failed step, and the later
commit-pinned artifact-upload step must have succeeded. A skipped, cancelled, failed, duplicated, or
out-of-order required step is rejected. This preserves a measured block without admitting a stale or
partial report as evidence. The single complete campaign directory is an immutable manifest input.
The moment at which its run-ID endpoints were preregistered remains a procedural trust boundary;
without an external timestamping service the repository cannot prove that timing cryptographically.

Once every family has a six-run cohort, emit the self-contained input for the authoritative
publication gate:

```sh
vp exec node scripts/perf-publication-collect.mjs manifest \
  --checkout /absolute/path/to/clean/measured-checkout \
  --source <exact-source-sha> \
  --repository kovojs/kovo \
  --collection /external/custody/complete-campaign \
  --out /external/custody/final-publication
```

The cohort key contains the exact source, dependency locks, workload identity, full host digest,
and, for dev/build, concrete packed-product policy and identity. Analysis values and raw benchmark
timings never enter grouping or ordering. Within the one qualifying cohort, immutable workflow-run
`created_at` then run ID chooses the first five baselines and the sixth holdout.
Passing `--cohort` when only one cohort qualifies is rejected as unnecessary; an explicit selector
is accepted only to resolve multiple qualifying cohorts.

The manifest also selects exactly one authenticated Production-bytes sidecar by the same immutable
`created_at`, run-ID chronology, choosing the earliest candidate in the complete campaign. Metric
values, budget outcomes, verdicts, and report payload ordering never enter that choice. The selected report must share the
exact source and dependency-lock identity of all 42 family reports.

If a family has multiple qualifying cohorts, the command fails and prints their digests. Select
one exact cohort digest, or a host digest that uniquely identifies one qualifying cohort:

```sh
  --cohort dev-n216=sha256:<64-lowercase-hex>
```

The result is `performance-publication-input.json` plus `216 + 2R + 5F + 5B` raw custody files,
excluding optional build profiles, where `R` is the campaign-run count, `F` is every authenticated
literal family candidate, and `B` is every authenticated literal Production-bytes candidate. The
fixed 216 comprises 210 files for the selected 42 family reports, five for the selected top-level
Production-bytes sidecar, and one exact-source workflow-run census. Campaign authority contributes
two files per run, and complete candidate custody contributes five files per family or byte
candidate. Unselected seventh-or-later family reports and later byte candidates are retained.

Before any live GitHub request, the gate recursively opens every exact file without following
symlinks, including the manifest, and records its SHA-256 plus device, inode, mode, link count,
size, modification time, and change time. Every later descriptor read must match that opening
identity and digest. After authentication, the gate independently repeats the recursive hash and
identity census, requires it to equal the opening census byte-for-byte, then performs one more
complete no-follow path/identity sweep to catch a file changed after its closing hash but before
its final identity check. The tree must equal the manifest plus all referenced raw files exactly.
Missing or extra files and directories, traversal, unlink/recreate, same-inode rewrites, metadata
restoration attempts, symlinks, hardlinks, FIFOs, sockets, devices, and file/directory substitution
fail closed.

This is a local custody proof through the final sweep, not an atomic filesystem snapshot or an
external timestamp. The operator must exclude concurrent writers for the entire gate invocation
and preserve the custody directory after the gate returns if it is to remain reproducible audit
evidence. Raw campaign, profile, and Production-bytes custody stays in this external directory and
is never copied into the committed publication tree. The separately generated publication root is
only the exact 23-file derived inventory: aggregate JSON and Markdown plus 21 evidence JSON files.
Returning from the gate does not transfer custody responsibility to those derived files. Run
`scripts/perf-publication-gate.mjs` from the same clean measured checkout; that gate remains the
authority for live GitHub/workflow authentication, re-ratification, budget derivation, holdout
evaluation, and the final publishable/blocked/unproven verdict. Optional N=216 build-profile
evidence is a separate conditional input and is not selected by this baseline-only helper.
