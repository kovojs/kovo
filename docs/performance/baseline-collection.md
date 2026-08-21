# Baseline artifact collection

`scripts/perf-publication-collect.mjs` is the metrics-blind operator helper for the seven-family
publication campaign and its separate Production-bytes sidecar. The sidecar is not an eighth
ratified family. The collector never writes into the measured checkout. The checkout must be clean at
the exact requested source commit, and each output must be a new directory whose parent already
exists outside that checkout. The checkout, every collection input, and the manifest output must
be pairwise disjoint: no one may equal, contain, or be contained by another.

## Seal the fixed campaign before opening payloads

The publication campaign is exactly 13 all-family `perf-measure-baselines` PR-label pulses declared
before triggering. `workflow_dispatch` and schedule runs are preflight-only and are never admitted.
Freeze the exact PR head and every non-trigger label and activity through the live publication gate.
In particular, keep every `perf-baseline-focus-*` label absent; predeclare either the one reviewed
CPU alias or no CPU alias. The fixed pulses may overlap on distinct hosted runners. That does not
make the campaign one serialized process tree: serialization is a per-report harness property.

Before any pulse, also predeclare this identity-only rule for multiple qualifying cohorts: choose
the cohort with the largest admitted report count, breaking a tie by the lexicographically smallest
cohort digest. The rule is fixed before report access and leaves no operator discretion.

If the predeclared CPU alias must be added, wait for its ordinary PR run to register and finish
before pulse one so it is outside the endpoints. Before looking at campaign status or conclusions,
inspect only the immutable registration metadata needed to capture exactly one new run ID per label
add; confirm the trigger label's removal is visible before the next add. After the thirteenth removal,
fetch GitHub's complete exact-source `perf-realistic.yml` census. The inclusive endpoints are the
first and last pulse IDs. Include every exact-source run whose ID falls between them, require exactly
the intended PR-label pulses, and preregister the complete census's ordered immutable projection
`{id, run_attempt, created_at, event, head_sha, name, path}`, marking the 13-run boundary slice.
Every boundary tuple must bind the frozen source, the `pull_request` event, workflow name
`Perf Realistic Tier`, and workflow path `.github/workflows/perf-realistic.yml`.

After that seal, inspect only status and immutable run, job, and artifact metadata. Do not manually
open report payloads, ZIPs, logs, or job summaries; leave payload access to the metrics-blind
collector and authoritative gate. Do not append a top-up pulse, rerun an Actions run, or replace a
failed sample after seeing an outcome. A genuine metric failure is a result, not retry permission.

After all 13 runs are terminal, fetch the complete exact-source census again immediately before
collection. Re-require `total_count` to equal the complete returned census, project the same seven
immutable fields, and compare the ordered tuples and boundary membership byte-for-byte. The raw API
response is not expected to match because status, conclusion, and update fields may change. Any
attempt change, added or missing run, dispatch/schedule event, or other identity drift invalidates the
campaign and requires a fresh disjoint 13-pulse campaign. Never omit a run from inside the endpoints.

The command cross-checks repeated `--run` values against GitHub's complete exact-source workflow-run
census and fails closed when the census exceeds one 100-run API page.

The one-page limit is an invalidation boundary, not an implicit truncation policy. Before launch,
require the current exact-source `total_count` plus 13 pulses and any planned pre-boundary CPU-label
run to be at most 100. Any cleanup of obsolete exploratory runs must happen and be recorded before
the campaign declaration. Never delete or alter a run after the campaign starts. GitHub deletion
history and the timing of the pulse declaration, tuple preregistration, and endpoint seal remain
procedural facts; this repository does not claim to prove them cryptographically.

Run collection only after the immutable tuple comparison succeeds:

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

Collection schema `kovo-performance-publication-collection/v4` preserves and content-addresses the
raw campaign workflow-run census and every run's complete raw artifact listing, in addition to the
exact artifact API, workflow-run API, all-attempt jobs API, ZIP, and extracted report bytes for
admitted evidence. A recognized family artifact name is not sufficient evidence: the collector
first authenticates the one exact current-attempt producer for every family. It admits and downloads
that family's artifact only when the producer concluded `success`. A named artifact from an
authenticated terminal non-success producer stays in the raw listing and is recorded in the
ledger's exact exclusion census
`{runId,family,artifactId,producerJobId,conclusion}`, but its ZIP and report are never opened or
treated as a sample. A successful producer with a missing, duplicate, multi-member, malformed, or
wrong-source artifact invalidates the campaign rather than becoming an exclusion. Missing,
ambiguous, non-terminal, or foreign producer authority also fails closed.

The collection ledger, manifest reload, and live gate independently rederive the eligible inventory
as the intersection of the complete artifact listing and exact successful producer jobs. Removing
an eligible family candidate, inventing one from a failed producer, altering an exclusion, or
omitting a run, listing, or Production-bytes candidate is rejected. The manifest is
`kovo-performance-publication-input/v6`; it carries the complete raw listings, admitted candidates,
and explicit exclusions without copying excluded payloads.

Every literal `kovo-perf-bytes` artifact remains required and is outside the family-exclusion rule.
A Production-bytes candidate must be the PR-only `bytes` / `Production bytes` producer, a one-member
`bytes.json` ZIP, clean and stable exact-source provenance with the three required lock digests,
`suite=bytes`, `componentCount=24`, complete integrity, and the exact five deterministic byte
metrics. The report itself may be measured even when its budget-evaluation step makes the producer
job fail. That exception is authenticated from the all-attempt jobs API: the measurement step must
have succeeded, budget evaluation must be the sole failed step, and the later commit-pinned
artifact-upload step must have succeeded. A skipped, cancelled, failed, duplicated, or out-of-order
required step is rejected. This preserves a measured block without admitting a stale or partial
report as evidence. The single complete campaign directory is an immutable manifest input. The
moment at which its run-ID endpoints were preregistered remains a procedural trust boundary; without
an external timestamping service the repository cannot prove that timing cryptographically.

Collection prints each family's identity-only cohort digest and admitted report count. If any
family has no cohort of at least six reports, the campaign is insufficient and invalid: do not top
it up, and start a fresh disjoint 13-pulse campaign. First invoke `manifest` without any selector:

```sh
vp exec node scripts/perf-publication-collect.mjs manifest \
  --checkout /absolute/path/to/clean/measured-checkout \
  --source <exact-source-sha> \
  --repository kovojs/kovo \
  --collection /external/custody/complete-campaign \
  --out /external/custody/final-publication
```

That invocation succeeds when every family has exactly one qualifying cohort and rejects a
selector as unnecessary in that case. If it fails only because one or more families have multiple
qualifying cohorts, use the identity-only digest/count lines already printed by `collect`. For each
ambiguous family, apply the predeclared rule mechanically: choose the greatest admitted count, then
the lexicographically smallest digest on a tie. Invoke `manifest` again into a new output directory,
passing `--cohort <family>=<exact-digest>` only for those ambiguous families:

```sh
vp exec node scripts/perf-publication-collect.mjs manifest \
  --checkout /absolute/path/to/clean/measured-checkout \
  --source <exact-source-sha> \
  --repository kovojs/kovo \
  --collection /external/custody/complete-campaign \
  --cohort dev-n216=sha256:<predeclared-rule-result> \
  --out /external/custody/final-publication-selected
```

Never use report metrics, budget outcomes, operator preference, or a uniquely matching host shortcut
to choose a cohort. Any selector pass not forced by the predeclared rule is invalid.

The cohort key contains the exact source, dependency locks, workload identity, full host digest,
and, for dev/build, concrete packed-product policy and identity. Analysis values and raw benchmark
timings never enter grouping, deterministic cohort choice, or ordering. Within the selected
qualifying cohort, immutable workflow-run `created_at` then run ID chooses the first five baselines
and the sixth holdout. Passing `--cohort` when only one cohort qualifies is rejected as unnecessary;
for multiple qualifying cohorts, pass only the exact digest selected by the predeclared
count-then-lexicographic rule.

The manifest also selects exactly one authenticated Production-bytes sidecar by the same immutable
`created_at`, run-ID chronology, choosing the earliest candidate in the complete campaign. Metric
values, budget outcomes, verdicts, and report payload ordering never enter that choice. The selected
report must share the exact source and dependency-lock identity of all 42 family reports.

Complete collection, manifest creation, and the live publication gate before the oldest included
Production-bytes artifact expires. This deadline covers every literal bytes candidate in the
boundary, including candidates the manifest does not select, because complete custody and live
reauthentication retain them all.

The result is `performance-publication-input.json` plus `216 + 2R + 5F + 5B` raw custody files,
excluding optional build profiles, where `R` is the campaign-run count, `F` is every authenticated
successful-producer family candidate, and `B` is every authenticated literal Production-bytes
candidate. The fixed 216 comprises 210 files for the selected 42 family reports, five for the
selected top-level Production-bytes sidecar, and one exact-source workflow-run census. Campaign
authority contributes two files per run, and complete candidate custody contributes five files per
family or byte candidate. Unselected seventh-or-later successful family reports and later byte
candidates are retained. Exclusions are identities in the ledger and manifest, not copied payload
files, so they do not change this count.

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
Returning from the gate does not transfer custody responsibility to those derived files. Normally,
run `scripts/perf-publication-gate.mjs` from the same clean measured checkout. If a committed
evidence-interpreter repair is required after measurement, seal its commit, tree, and stable patch
identity separately from the measured source and invoke the repaired collector/gate by absolute
path while the process working directory remains the clean measured checkout. The measured checkout
continues to own source, workflow, budget, and dependency authority; the separate committed tool is
only the evidence interpreter. Never use an uncommitted interpreter or move the measured PR head
before the live gate. The gate remains the authority for live GitHub/workflow/jobs authentication,
re-ratification, budget derivation, holdout evaluation, and the final
publishable/blocked/unproven verdict. Optional N=216 build-profile evidence is a separate conditional
input and is not selected by this baseline-only helper.
