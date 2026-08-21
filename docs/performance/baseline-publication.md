# Realistic performance baseline publication

The `perf-measure-baselines` label runs seven independently hosted baseline jobs. A publication
campaign is exactly 13 predeclared, all-family label pulses against one frozen pull-request head.
Each subject needs one admitted six-report cohort with the same source commit, dependency locks,
workload digest, and normalized host digest: the first five reports ratify the baseline and the
sixth is its independent holdout. Jobs from one workflow run can land on different machines;
cohorts are selected per subject, not by assuming all seven jobs shared a host. Multiple attempts of
one Actions run are forbidden in the campaign; all six admitted reports need distinct run IDs.

Use the metrics-blind collection and five-plus-one holdout workflow in
[`baseline-collection.md`](./baseline-collection.md) to preserve raw GitHub custody and select exact
cohorts. The manual commands below describe the same individual ratification stages and remain
useful for inspecting a selected family; they are not a substitute for the aggregate collector and
publication gate.

## Preflight separately; collect a fixed PR-label campaign

Manual dispatch accepts two optional collection controls. `baseline_focus` selects `all`, `check`,
`browser`, `dev-n24`, `dev-n216`, `build-n24`, `build-n216`, or `server`. The selected dev or build
focus reduces that job's matrix to the exact corpus size. Use `workflow_dispatch` only to establish
readiness before the inclusive publication boundary. Scheduled runs are also preflight evidence,
not publication-campaign samples. Neither event is admitted inside a campaign or supplied to its
collector. A focused preflight's expected non-selected jobs stop before setup or measurement; this
is useful for diagnosing one producer without spending on the other families.

`baseline_cpu_model_sha256` optionally admits only runners whose exact UTF-8 Node
`os.cpus()[0].model` string has the requested SHA-256. The value must be exactly 64 lowercase
hexadecimal characters with no `sha256:` prefix. An empty value remains allowed for preflights and
label-triggered runs. Invalid or mismatched values fail before setup and print the observed model
digest. Resolve every readiness problem before starting the fixed campaign.

For example, the currently observed `AMD EPYC 7763 64-Core Processor` model hashes to
`f56edd1ddb32e98359af80267bba52d80fedc60bf40440adea1c3ea0e0f429c7`:

```sh
gh workflow run perf-realistic.yml \
  --ref <collection-branch> \
  -f measurement_scope=baselines \
  -f baseline_focus=dev-n216 \
  -f baseline_cpu_model_sha256=f56edd1ddb32e98359af80267bba52d80fedc60bf40440adea1c3ea0e0f429c7
```

Use a labeled pull request for the inclusive publication campaign. Its PR-only `Production bytes`
producer and `kovo-perf-bytes` upload are the declared literal-artifact floor for every pulse; a
missing or invalid bytes artifact invalidates the campaign. The only CPU alias is
`perf-baseline-cpu-amd-7763`, which resolves to the full digest above. Before triggering anything,
predeclare outside the measured checkout:

- the exact source SHA and pull request;
- exactly 13 all-family pulses, with every `perf-baseline-focus-*` label absent;
- the frozen non-trigger label census, including either the one CPU alias or no CPU alias;
- the identity-only cohort rule: for multiple qualifying cohorts choose the largest admitted
  report count, breaking a tie by the lexicographically smallest cohort digest.

Before launch, require the current exact-source workflow census plus the 13 pulses and any planned
pre-boundary CPU-label run to total at most 100. The collector rejects a census that cannot fit in
one complete API page.

The repository can preserve that declaration but cannot cryptographically prove when it was made;
its timing remains a procedural trust boundary. Freeze the PR head and all non-trigger labels and
activity through the live publication gate. Do not synchronize or reopen the PR, dispatch the exact
source, or permit another exact-source performance run inside the boundary. Apply the CPU alias, if
predeclared, before the first pulse; wait for that ordinary PR run to register and finish outside
the boundary. Ensure the trigger's absence is visible, then perform exactly 13 add/remove pairs
without changing any other label:

```sh
# Omit this command if the campaign was predeclared as CPU-unconstrained.
gh pr edit <pr-number> --add-label perf-baseline-cpu-amd-7763
# Wait for this pre-boundary run to become terminal.

# Repeat this pair exactly 13 times; do not choose the count from observed outcomes.
gh pr edit <pr-number> --add-label perf-measure-baselines
# Record exactly one new run ID, without opening its status or outcome.
gh pr edit <pr-number> --remove-label perf-measure-baselines
# Confirm that removal is visible before the next add.
```

Each add event runs the full seven-family matrix. The 13 workflow runs may overlap because they use
distinct hosted runners. That is not campaign-wide serialization: only the measurements within one
report share the harness's one serialized process tree. Pull-request jobs receive empty dispatch
inputs, and the frozen CPU alias, if present, is enforced by the env-only admission step.

After the thirteenth trigger label is removed, wait only for GitHub to register the 13 run
identities; do not look at status or conclusions. Then fetch the complete exact-source workflow
census, identify the first and last pulse IDs, and include every exact-source run between those
inclusive endpoints. Preregister the complete census's ordered immutable tuple projection
`{id, run_attempt, created_at, event, head_sha, name, path}` outside the checkout, marking the 13-run
boundary slice. Every boundary tuple must use the frozen source SHA, the `pull_request` event, the
name `Perf Realistic Tier`, and the path `.github/workflows/perf-realistic.yml`. An unexpected
exact-source run invalidates the campaign; never repair the boundary by dropping it.

That AMD digest is a collection-time operator choice based on the current hosted-runner cohort, not
a permanent default or a portable hardware requirement. CPU admission only reduces wasted jobs.
It does not replace or weaken the report's normalized `kovo-performance-host/v2` facts, and the
ratifier/publication gate still requires the exact full `host.digest` for each cohort. CPU count,
memory capacity class, Node version, OS release, runner image, and browser versions can therefore
still separate two reports that passed the same CPU-model admission.

After sealing the tuples, observe only statuses and immutable run, job, and artifact metadata. Do
not manually open report payloads, artifact ZIPs, logs, or job summaries; leave payload access to the
metrics-blind collector and authoritative gate. Do not add metric-dependent pulses, rerun a workflow
run, or replace a failed sample. A genuine metric failure is the campaign's result, not retry
permission.

Wait for all 13 pulses to become terminal. Fetch the complete exact-source census again immediately
before collection, re-require `total_count` to equal the complete returned census, project the same
seven immutable fields, and compare the ordered tuples and boundary membership byte-for-byte. The
raw API response is not compared byte-for-byte because status, conclusion, and update fields may
change. A changed attempt, an added or missing run, a dispatch/schedule tuple, or any other identity
drift invalidates the campaign; start a fresh disjoint 13-pulse campaign.

If the build-persistence decision requires the optional N=216 build profile, dispatch
`measurement_scope=decisions` outside the baseline campaign boundary with
`decision_focus=build-profile` and the same `baseline_cpu_model_sha256`; the profile producer uses
the same early CPU admission, while publication still requires its exact host identity to match the
build-N=216 evidence.

## Artifact map

| Subject       | Artifact                   | Report inside the artifact | Required reports |
| ------------- | -------------------------- | -------------------------- | ---------------: |
| check scaling | `kovo-perf-check-scaling`  | `check-scaling.json`       |                6 |
| browser       | `kovo-perf-browser-matrix` | `comparison.json`          |                6 |
| dev N=24      | `kovo-perf-dev-n24`        | `comparison.json`          |                6 |
| dev N=216     | `kovo-perf-dev-n216`       | `comparison.json`          |                6 |
| build N=24    | `kovo-perf-build-n24`      | `comparison.json`          |                6 |
| build N=216   | `kovo-perf-build-n216`     | `comparison.json`          |                6 |
| server        | `kovo-perf-server-matrix`  | `comparison.json`          |                6 |

The separate `kovo-perf-bytes` / `bytes.json` artifact contributes one Production-bytes sidecar,
not another six-report family. It is emitted only by the PR-only `bytes` / `Production bytes` job.
The metrics-blind collector retains every such artifact in the selected runs and chooses the
earliest authenticated candidate by immutable run chronology for the final manifest.

A recognized family artifact name is only a listing identity. The collector and live gate admit it
as a candidate only after authenticating the exact current-attempt family producer as successful.
If a terminal non-success producer still uploads a named artifact, the complete raw listing and an
explicit `{runId,family,artifactId,producerJobId,conclusion}` exclusion remain in custody, but the
artifact ZIP and report are never opened or counted. A successful producer's missing or malformed
artifact still invalidates the campaign. This classification uses only job authority, never report
metrics or budget outcomes, and does not permit replacement or top-up samples.

Use the canonical artifact page URL, not a signed download URL, for every `--location`:

```text
https://github.com/kovojs/kovo/actions/runs/<run-id>/artifacts/<artifact-id>
```

The browser report's ratified analysis includes the 30 scenario samples, five raw Lighthouse
samples per cell, and ten bfcache traversals. Every lane and form factor must include absolute cold
JavaScript and total-byte metrics. Derivation also reads the exact 12 raw browser cells in each of
the five baseline reports and the holdout. Each lane must retain the serialized Kovo, Next, Next,
Kovo order and the exact per-occurrence split: 15/15 scenario samples, 2/1 warmups, 3/2 samples for
each Lighthouse route/form-factor cell, and 5/5 bfcache traversals. Aggregate totals cannot hide a
skewed occurrence. Kovo default and matched-L0 cold samples must have zero script elements and zero
JavaScript bytes; every matched-L1 cold sample must retain a script element; and JavaScript bytes
cannot exceed total bytes. Kovo matched L1 must show document-parts without replacing the document;
Next matched L1 must show a `text/html` document navigation that replaces it. Every matched-L1
sample must also pass the authoritative navigation-attribution schema, digest, primary-response,
network-witness, trace, timing, and observation-boundary validation. Its trace target and both
response URLs must be the exact `/matched/l1/product/linen-field-jacket` detail route, and the
successful `GET` must retain Kovo's fetch/non-navigation witness or Next's document/navigation
witness. Resealing an aggregate or a different internally consistent route cannot replace this raw
posture proof. The check report uses the same authenticated execution, source/lock, normalized
host-v2, quiet-host, and workload identities as the comparison reports. A dirty, busy, incomplete,
duplicate, or identity-mismatched report produces `unproven`.

Baseline jobs request 90-day Actions retention, while the PR-only Production-bytes artifact requests
14 days. Complete collection, manifest creation, and the live publication gate before the oldest
included bytes artifact expires, including every unselected bytes candidate retained by complete
campaign custody. The canonical artifact-page URL is stable during retention, but it is not
permanent storage.

## Ratify each subject

Create a custody directory outside the measured checkout, then supply the first five admitted
baseline report paths and their matching artifact URLs. Retain the sixth admitted report separately
as the independent holdout:

```sh
kovo_perf_custody="$(realpath "$(mktemp -d)")"
vp exec node scripts/perf-baseline-ratify.mjs \
  --report "$kovo_perf_custody/run-1/<report>.json" --location <artifact-url-1> \
  --report "$kovo_perf_custody/run-2/<report>.json" --location <artifact-url-2> \
  --report "$kovo_perf_custody/run-3/<report>.json" --location <artifact-url-3> \
  --report "$kovo_perf_custody/run-4/<report>.json" --location <artifact-url-4> \
  --report "$kovo_perf_custody/run-5/<report>.json" --location <artifact-url-5> \
  --out "$kovo_perf_custody/<subject>-baseline.json"
```

Do not combine N=24 with N=216 or browser with server: each is a different authenticated workload
digest. For ad hoc ratification, fewer than five matching reports is unproven. For the fixed
publication campaign, any family without one six-report cohort invalidates the campaign and
requires a fresh disjoint 13-pulse campaign; never top up or relax the identity check.

Publication derivation additionally requires the exact declared subject profile: isolated dev or
build cells, the full browser default/L0/L1 matrix (30/5/10 plus three warmups), the full server
route/encoding/mode/concurrency matrix (seven 15-second samples after five-second warmups), or the
N={8,24,72,216} one-sample check ladder. A generic scratch ratification with local file locations,
skipped Lighthouse, missing bfcache metrics, or shortened matrix cannot produce a budget.

## Derive reviewed budgets

Supply the same five raw files again. Each derivation re-hashes the downloads, recovers the reviewed
artifact links by digest, revalidates every raw report, and reproduces the ratified baseline before
writing a budget.

Browser and server use the common comparison derivation. `--markdown-out` creates a clean linked
Kovo-vs-Next table, derives the 5% regression envelope, records every ratified target with its
`completion` or `follow-on` role, and preserves the architectural lane/posture warning. A failed
follow-on row remains `fail`; the role says how the aggregate publication gate uses that result and
does not rewrite the result itself:

```sh
vp exec node scripts/perf-comparison-budget.mjs derive \
  --baseline "$kovo_perf_custody/browser-baseline.json" \
  --report "$kovo_perf_custody/run-1/browser/comparison.json" \
  --report "$kovo_perf_custody/run-2/browser/comparison.json" \
  --report "$kovo_perf_custody/run-3/browser/comparison.json" \
  --report "$kovo_perf_custody/run-4/browser/comparison.json" \
  --report "$kovo_perf_custody/run-5/browser/comparison.json" \
  --out "$kovo_perf_custody/browser-budget.json" \
  --markdown-out "$kovo_perf_custody/browser-baseline.md"

vp exec node scripts/perf-comparison-budget.mjs derive \
  --baseline "$kovo_perf_custody/server-baseline.json" \
  --report "$kovo_perf_custody/run-1/server/comparison.json" \
  --report "$kovo_perf_custody/run-2/server/comparison.json" \
  --report "$kovo_perf_custody/run-3/server/comparison.json" \
  --report "$kovo_perf_custody/run-4/server/comparison.json" \
  --report "$kovo_perf_custody/run-5/server/comparison.json" \
  --out "$kovo_perf_custody/server-budget.json" \
  --markdown-out "$kovo_perf_custody/server-baseline.md"
```

Check scaling uses its Kovo-only derivation; it does not manufacture a Next.js subject:

```sh
vp exec node scripts/perf-check-budget.mjs derive \
  --baseline "$kovo_perf_custody/check-baseline.json" \
  --report "$kovo_perf_custody/run-1/check-scaling.json" \
  --report "$kovo_perf_custody/run-2/check-scaling.json" \
  --report "$kovo_perf_custody/run-3/check-scaling.json" \
  --report "$kovo_perf_custody/run-4/check-scaling.json" \
  --report "$kovo_perf_custody/run-5/check-scaling.json" \
  --out "$kovo_perf_custody/check-budget.json"
```

Use `scripts/perf-dev-budget.mjs` and `scripts/perf-build-budget.mjs` for each corpus size as
documented in `dev-budget-policy.md` and `build-budget-policy.md`. Those specialized derivations add
the plan's ready/edit/recovery and wall/RSS targets to the same five-run evidence rule. The aggregate
publication policy, described below, keeps the first-milestone completion floor distinct from the
stronger competitive follow-on goals.

Commit only the reviewed baseline/budget JSON and concise publication Markdown. Keep the raw reports
in their linked Actions artifacts; local download paths are not evidence locations.

## Close the seven-family publication boundary

Individual budgets are not permission to publish a Kovo-vs-Next claim. The aggregate gate requires
all seven subjects together, re-runs the existing ratifier and family-specific budget derivation on
exactly five reports, and evaluates a sixth report as an independent holdout. It additionally
requires one exact-final-source Production-bytes sidecar; this deterministic regression check is
not ratified as an eighth family. The browser, dev, build, and server families are Kovo-vs-Next
subjects. Check scaling is deliberately Kovo-only; the aggregate must not manufacture a Next.js
check result.

For each report, retain five local files from the same artifact and workflow run:

1. The unmodified artifact API response from
   `GET /repos/kovojs/kovo/actions/artifacts/<artifact-id>`.
2. The unmodified workflow-run API response from
   `GET /repos/kovojs/kovo/actions/runs/<run-id>`.
3. The unmodified all-attempt job census from
   `GET /repos/kovojs/kovo/actions/runs/<run-id>/jobs?filter=all&per_page=100`.
4. The ZIP bytes returned by the artifact response's `archive_download_url`.
5. The expected report extracted from the ZIP (`comparison.json`, or `check-scaling.json` for the
   check family).

These files and the publication manifest must remain outside the measured checkout. Custody checks
the entire checkout, including untracked files, so placing even one input under the repository
makes the source dirty. For example, continuing with the external `kovo_perf_custody` directory:

```sh
mkdir -p "$kovo_perf_custody/run-1"
gh api repos/kovojs/kovo/actions/artifacts/2001/zip > "$kovo_perf_custody/run-1/browser.zip"
gh api repos/kovojs/kovo/actions/artifacts/2001 > "$kovo_perf_custody/run-1/browser.api.json"
gh api repos/kovojs/kovo/actions/runs/1001 > "$kovo_perf_custody/run-1/browser.run.api.json"
gh api 'repos/kovojs/kovo/actions/runs/1001/jobs?filter=all&per_page=100' \
  > "$kovo_perf_custody/run-1/browser.jobs.api.json"
unzip -p "$kovo_perf_custody/run-1/browser.zip" comparison.json \
  > "$kovo_perf_custody/run-1/comparison.json"
```

The input manifest is `kovo-performance-publication-input/v6`. This abridged, non-runnable example
shows one family's shape:

```json
{
  "schema": "kovo-performance-publication-input/v6",
  "repository": "kovojs/kovo",
  "campaign": {
    "boundary": { "firstRunId": 1001, "lastRunId": 1013 },
    "workflowRunsApiMetadata": {
      "path": "campaign/workflow-runs.api.json",
      "byteLength": 1234,
      "contentDigest": "sha256:<64-lowercase-hex>"
    },
    "cohortSelections": {},
    "runs": ["13 content-addressed run API and artifact-list API pairs"],
    "familyCandidates": ["every exact successful-producer family candidate and descriptor"],
    "excludedFamilyArtifacts": [
      {
        "runId": 1002,
        "family": "browser",
        "artifactId": 2002,
        "producerJobId": 3002,
        "conclusion": "failure"
      }
    ],
    "productionBytes": ["complete created_at/run-ID chronology"],
    "productionBytesCandidates": [
      "every literal Production-bytes candidate and its five-file descriptor"
    ],
    "selectedProductionBytes": { "artifactId": 9001, "runCreatedAt": "...", "runId": 1001 }
  },
  "productionBytes": {
    "apiMetadata": "run-1/bytes.api.json",
    "archive": "run-1/bytes.zip",
    "jobsApiMetadata": "run-1/bytes.jobs.api.json",
    "runApiMetadata": "run-1/bytes.run.api.json",
    "report": "run-1/bytes.json"
  },
  "families": {
    "browser": {
      "baseline": [
        {
          "apiMetadata": "run-1/browser.api.json",
          "archive": "run-1/browser.zip",
          "jobsApiMetadata": "run-1/browser.jobs.api.json",
          "runApiMetadata": "run-1/browser.run.api.json",
          "report": "run-1/comparison.json"
        },
        {
          "apiMetadata": "run-2/browser.api.json",
          "archive": "run-2/browser.zip",
          "jobsApiMetadata": "run-2/browser.jobs.api.json",
          "runApiMetadata": "run-2/browser.run.api.json",
          "report": "run-2/comparison.json"
        },
        {
          "apiMetadata": "run-3/browser.api.json",
          "archive": "run-3/browser.zip",
          "jobsApiMetadata": "run-3/browser.jobs.api.json",
          "runApiMetadata": "run-3/browser.run.api.json",
          "report": "run-3/comparison.json"
        },
        {
          "apiMetadata": "run-4/browser.api.json",
          "archive": "run-4/browser.zip",
          "jobsApiMetadata": "run-4/browser.jobs.api.json",
          "runApiMetadata": "run-4/browser.run.api.json",
          "report": "run-4/comparison.json"
        },
        {
          "apiMetadata": "run-5/browser.api.json",
          "archive": "run-5/browser.zip",
          "jobsApiMetadata": "run-5/browser.jobs.api.json",
          "runApiMetadata": "run-5/browser.run.api.json",
          "report": "run-5/comparison.json"
        }
      ],
      "holdout": {
        "apiMetadata": "run-6/browser.api.json",
        "archive": "run-6/browser.zip",
        "jobsApiMetadata": "run-6/browser.jobs.api.json",
        "runApiMetadata": "run-6/browser.run.api.json",
        "report": "run-6/comparison.json"
      }
    }
  }
}
```

The example expands only `browser` for readability. A real manifest must contain that exact
five-plus-one shape for `browser`, `dev-n24`, `dev-n216`, `build-n24`, `build-n216`, `server`, and
`check`, plus exactly one top-level `productionBytes` descriptor and the complete campaign custody
object. Missing or additional families, a missing sidecar, an omitted eligible campaign candidate,
or an invented/altered exclusion fails before publication. Every path is canonical and relative to
the manifest directory. Before live
API access, the gate recursively opens every exact file without following symlinks, including the
manifest, and pins its SHA-256, device, inode, mode, link count, size, modification time, and change
time. Each contained, single-link descriptor read must match that opening identity and digest; path
or inode reuse across descriptors fails closed. After all descriptor authentication, the gate
independently re-hashes the exact recursive tree, requires the closing census to equal the opening
census byte-for-byte, and completes a final no-follow path/identity sweep against the closing
snapshots. Extra or missing files/directories, non-regular nodes, unlink/recreate replacement,
same-inode rewriting, and attempted timestamp restoration all fail closed.

The filesystem checks establish custody through the final sweep; they are not an atomic snapshot or
an external timestamp. The operator must prevent concurrent writes throughout the gate invocation
and preserve the input directory after return for later audit or reproduction. Any writer allowed
to race a completed per-file check is outside this local custody assumption.

If the build-persistence predicate returns `profile-required`, add the two current N=216 profile
reports under the optional top-level `buildProfiles` object. The two descriptors may share only the
one exact archive path, through the gate's narrow `build-profile-archive` policy. Their artifact API,
jobs API, run API, and report paths must be distinct regular files even when the API bytes are
identical. The raw diagnostic members remain inside the authenticated ZIP. The artifact must be named
`kovo-perf-build-profile-n216`. For each mode it contains the
`profile-<mode>.json` report, a derived `build-<mode>.cpuprofile` convenience merge, the numeric-only
`process-cpu-<mode>.txt` recursive CPU record, and every original process profile as
`raw-<mode>-<role>-pid-<pid>.cpuprofile`. The convenience merge is not publication authority; the
gate reclassifies the original process-local bytes. The union declared by both authenticated
reports must equal the shared ZIP's complete member census; undeclared, missing, digest-mismatched,
or duplicate members fail closed:

```json
{
  "buildProfiles": {
    "unchanged": {
      "apiMetadata": "build-profile/profile.api.json",
      "archive": "build-profile/profile.zip",
      "jobsApiMetadata": "build-profile/profile.jobs.api.json",
      "runApiMetadata": "build-profile/profile.run.api.json",
      "report": "build-profile/profile-unchanged.json"
    },
    "edit": {
      "apiMetadata": "build-profile/profile-edit.api.json",
      "archive": "build-profile/profile.zip",
      "jobsApiMetadata": "build-profile/profile-edit.jobs.api.json",
      "runApiMetadata": "build-profile/profile-edit.run.api.json",
      "report": "build-profile/profile-edit.json"
    }
  }
}
```

Supplying only one mode is invalid. Profiles are unnecessary when all four warm cells meet the
first milestone or both N=216 upper/wall medians are below 10%. Profile evidence must come from the
exact successful `build-profile` / `N=216 build CPU profiles` job. Its trusted condition admits only
a decision dispatch focused on `build-profile` (or `all`) or a labeled pull request carrying
`perf-measure-decisions` or `perf-measure-build-profile`; it is not a scheduled timing sample.

Run the aggregate gate after collecting one same-host/workload six-run cohort for every family:

```sh
vp exec node scripts/perf-publication-gate.mjs \
  --manifest "$kovo_perf_custody/performance-publication-input.json" \
  --evidence-dir "$kovo_perf_custody/publication/evidence" \
  --out "$kovo_perf_custody/publication/performance-publication.json" \
  --markdown-out "$kovo_perf_custody/publication/performance-publication.md"
```

The three output paths must be canonical absolute paths in the one documented layout. The
`publication` root must be absent or empty; a partial prior run, nested file, alternate output name,
directory alias, or symlink is rejected instead of overwritten.

The CLI completes all 42 selected baseline/holdout custody calls, the selected Production-bytes
custody call, every carried family and Production-bytes candidate custody call, live
reauthentication of the complete campaign workflow-run, artifact-list, and all-attempt jobs
chronology, exact rederivation of admitted candidates and exclusions, and both optional build-profile
calls before it creates an evidence, JSON, Markdown, staging, or output path. A requested
in-repository output is therefore created only after the whole measured checkout has passed every
clean-source check; using the external directory above avoids coupling collection and publication
to repository state.

The output schema is `kovo-performance-publication/v8`. Browser/server budget and holdout documents
use `kovo-comparison-performance-budget/v2` and
`kovo-comparison-performance-evaluation/v2`. The output root contains exactly 23 regular files:
`performance-publication.json`, `performance-publication.md`, and exactly 21 JSON files under
`evidence/` (baseline, budget, and independent holdout evaluation for each of seven families).
There is no Production-bytes family document; the authenticated sidecar remains in the aggregate.
Extra or missing files, nested directories, alternate placement, and symlinks fail both the
pre-write and readback inventory gates. The aggregate JSON content-addresses those 21 files and
retains every canonical artifact page, API URL, API-response digest, artifact ZIP digest, report
digest, execution, source, lock, host, and workload identity. The aggregate also retains the
preregistered boundary,
every authenticated run and literal publication-artifact identity, every authenticated
failed-producer exclusion, the complete Production-bytes chronology, every authenticated family/byte
candidate reference, the independently re-derived cohort selection, and the earliest selected
candidate. Its Markdown surfaces baseline and holdout
completion and follow-on assessments for all seven families, links exact fixture sources at the
measured commit, and preserves the architectural lane warning beside each subject. It also embeds
and renders the cross-corpus
foreground build-session assessment, including its four milestone/residual cells and any
custody-authenticated profile references. The same aggregate JSON and Markdown retain the selected
Production-bytes artifact custody, the exact `perf-budgets.json` byte length and SHA-256 from the
clean measured-source checkout, all five observed values and budget maxima, and the derived
pass/blocked/unproven sidecar status.

The 23-file publication is atomic at the contract level: if any family, including browser, cannot
derive all three documents, result validation returns exit status 2 before creating the output
root. An aggregate-level unproven decision that still has all 21 family documents (for example, a
conditional build-profile decision) remains renderable and retains its unproven verdict; the gate
never emits a partial family inventory.

The browser section is not a curated headline subset. It deterministically partitions every metric
in `evidence/browser-budget.json` into Default/as shipped, Matched L0, or Matched L1 and renders each
lane sorted with `Metric | Kovo median | Kovo p95 | Next median | Next p95 | Budget policy`.
The median is the median of the five run medians; p95 is the median of the five within-run p95s. The
sixth run is the independent holdout and is not pooled. The section links the derived budget, all
five baseline artifacts, the holdout, the exact measured source, and the exact fixture sources.
It keeps the required caveats beside the tables: default compares Kovo's native L0 with Next's
hydrated mutable cart; zero JavaScript applies only to Kovo L0 and Next matched L0 still ships
JavaScript; matched L1 equalizes capability while Kovo preserves the document and Next replaces it;
and `responseProcessingDomApply` overlaps transfer/parser/style/layout, so it is neither additive
nor a decode/morph split.

For each dev family, the rendered baseline and holdout target assessments include the exact median
and p95 regression census for leaf, entry, data-plane, syntax-error, recovery, ready, and
process-tree RSS metrics, followed by the fixed competitive/latency targets. `edit.dataMs` is not an
optional diagnostic: a missing row makes the publication malformed, and a measured data-plane
regression blocks the aggregate even when every other developer-loop row passes.

Publication eligibility follows the completion floor in `plans/good-perf.md`; stronger competitive
targets are retained as separately reported follow-on checks:

- Browser matched-L1 mobile navigation at no more than 2x Next is completion-blocking. Matched-L1
  session bytes at no more than 50% of Next is follow-on.
- Server identity HIT at least 0.9x Next and forced-dynamic throughput at least 0.8x Next are
  follow-on. The full authenticated matrix, holdout correctness, and ratified regression envelope
  still prevent publication when unproven or failing.
- Dev ready at no more than 2x Next, leaf edit at no more than 2x, and entry edit at no more than 3x
  are follow-on. Syntax-error p95 at most 1 second, recovery p95 at most 2 seconds, all regression
  checks, and correctness remain completion-blocking.
- The build 6x wall / 2x RSS milestones and the check/product targets remain completion-blocking.

The selected six-report cohorts have no authenticated historical-current-Kovo comparator for the
dev 30% ready and 20% leaf/entry improvement rows or the server 10% forced-dynamic improvement row.
Those historical deltas are therefore explicitly unassessed in the rendered architecture notes;
the gate never infers them from a Kovo-vs-Next ratio. Browser session-byte and cached-server
“establish baseline” milestones are instead proved by the required metric and raw-evidence census.

The foreground-session assessment has three distinct aggregate effects. `not-warranted` is a
complete decision and adds no publication failure. `profile-required` and `unproven` leave the
aggregate unproven. A valid `warranted` outcome is also a complete predicate decision, but it proves
that implementation and serialized baseline/candidate measurement are still required; the
aggregate is therefore `blocked` and retains
`build-persistence:foreground-session-implementation-and-measured-decision-required` until that
production decision has been completed and represented by a reviewed gate contract.

The gate derives the API and artifact-page URLs from the repository-scoped artifact and run IDs;
there is no user-supplied evidence URL. It retains the saved and live artifact, run, and job API
response digests for audit, then canonicalizes only their reviewed immutable fields and requires the
saved/live authority digests to match. Whole-response equality is deliberately not authority: an
old run's embedded `pull_requests[].head.sha` follows the current PR head after the measured run.
The run must be completed, use `.github/workflows/perf-realistic.yml`, belong to `kovojs/kovo`, and
retain the exact immutable head/source SHA, run attempt, and expected producer job. Every ratified
family producer must succeed. The Production-bytes producer may conclude `failure` only when the
all-attempt jobs API proves this ordered step outcome: measurement succeeded, the separate budget
evaluation was the sole failed step, and the later commit-pinned `always()` upload succeeded. These
step facts participate in saved/live authority equality and remain in the publication reference. A
skipped, cancelled, failed, duplicated, or out-of-order measurement/upload is rejected; the report
must also remain complete, measured, clean, and byte-authenticated. A failed unrelated sibling job
does not invalidate an accepted producer's artifact.

The report separately retains `GITHUB_WORKFLOW_SHA`, the commit whose workflow GitHub evaluated.
For the required pull-request campaign it is the synthetic merge/event SHA. The gate fetches the
workflow file from GitHub's Contents API at that
evaluated workflow SHA, verifies its Git blob and bytes against the clean local workflow, and
requires local checkout `HEAD` to equal the measured source SHA and the whole checkout to be clean.
It then extracts the exact reviewed job `if` expression (folded for baseline/profile producers and
the literal PR-only condition for Production bytes) and requires one uniquely owned, commit-pinned
`actions/upload-artifact` step with the reviewed literal name template and path. Each admitted
campaign family job authenticates the exact `perf-measure-baselines` labeled-PR condition instead
of trusting an event name alone. Dispatch and schedule remain preflight-only even though the
lower-level producer contract can authenticate them. The
measured source remains the immutable run/artifact/job `head_sha`; neither the synthetic merge
identity nor the mutable PR object is substituted for it.

The artifact API's SHA-256 digest and byte size must match the downloaded ZIP; GitHub exposes no
download-receipt field, so the gate does not invent one. The gate requires the ZIP's complete member
census to equal the reviewed family contract, safely reads and CRC-checks each expected member, then
requires the extracted report to be byte-identical. It
also requires an unexpired retention record, five distinct baseline workflow runs, and a sixth run
not used by that family's baseline. All 42 reports and the Production-bytes sidecar must share the
exact source and dependency locks; each holdout must match its family's ratified host and workload.
The sidecar additionally requires the exact `kovo-perf-report/v1` source/sourceAfter, execution,
integrity, `suite=bytes`, `componentCount=24`, and five-metric census.

Before writing, the aggregate gate re-ratifies every baseline from its five authenticated raw
reports, re-derives each family budget, and re-evaluates each holdout. It recomputes the exact target
assessment, including each check's completion/follow-on role and separate failure partitions, and
the byte and semantic digests for all 21 baseline/budget/evaluation documents. The
Markdown renderer accepts only that complete `{documents, publication}` result and repeats the
authenticated derivation; it never renders a bare aggregate merely because its self-hash is valid.
After writing, it reads those 21 files and the aggregate JSON back, verifies canonical bytes and
digests, and repeats the result-level validation. A self-consistently edited target, evaluation, or
document plus a recomputed aggregate self-hash therefore cannot produce exit status 0. It also reloads
`perf-budgets.json` from a clean checkout whose `HEAD` equals the measured source, requires disk
bytes to equal `git show HEAD:perf-budgets.json`, evaluates exactly the five deterministic byte
metrics, and canonically reproduces the sidecar assessment during result and readback validation.
Every check remains an explicit `pass` or `fail`. A completion/regression/milestone failure blocks
publication; a competitive follow-on failure stays visible in JSON and Markdown but does not by
itself block the first-milestone publication. Any missing, unbudgeted, malformed, unclassified, or
otherwise undecidable failure is treated as blocking or unproven, never as follow-on by default. The
same result gate
re-derives the foreground-build assessment from the exact N=24/N=216 budgets and authenticated
profiles. For each optional mode it reads every mode-prefixed original `.cpuprofile` directly from
the authenticated ZIP and checks each report-declared member, PID, role, byte length, and SHA-256.
It validates the bounded sanitized exec/PID/parent census, its nonnegative fork-only count, and exact
executable hashes. The producer preserves an exact ordered source-phase posture from the profiled
sample. The gate requires the eight unconditional Node roles plus `config-static-trust` if and only
if that posture marks `config-trust` as `executed`; a missing required profile or an extra profile
under either non-executed posture (`not-applicable` or `reused-authenticated`) fails closed. Exclusive
reviewed V8 function/module markers cross-check those authenticated roles. The gate then
independently derives the per-profile sample census, complete cause census, `topFive`, and full
profile-set analysis from the original bytes using the same phase-derived eight-or-nine-role posture.
Exact V8 `(idle)` and exact Node `spawnSync` child-wait samples remain separate diagnostic censuses
and are excluded from CPU-work attribution; signed safe-integer time deltas remain evidence and do
not weight the ranking. The gate also losslessly rebuilds the merged `build-<mode>.cpuprofile` and
exact-compares it, but that file remains a convenience view rather than authority.

The profile run also wraps the exact manifest-owned build in recursive GNU `time` accounting and a
temporary process-exec trace. The raw trace can contain static-trust authentication material, so it
is held only in a mode-0700 scratch directory, parsed with bounded generic diagnostics into PID,
parent, executable-identity, and role facts, and deleted; it is never uploaded or rendered. The
numeric-only GNU-time member contains no argv or environment. The gate compares recursive user plus
system CPU with active V8 sample weight at the fixed 10 ms profiler interval. The uncertainty bound
is the two GNU-time decimal resolutions plus two profiler intervals per raw profile. A positive
residual must exceed that bound before its conservatively floored equivalent samples are ranked as
the one-shot/ineligible `native-or-unprofiled` cause. A missing process profile, incomplete role or
descendant census, unauthenticated executable, negative CPU residual, or positive residual inside
the uncertainty bound makes the diagnostic unproven. Phase-clock durations are never converted
into CPU samples.

Exit status is `0` only for `publishable`, including a result whose only misses are explicitly
classified competitive follow-on checks. Exit status `1` is for measured evidence blocked by a
completion target, regression, milestone, product check, unknown failure, or
warranted-but-not-yet-measured foreground-session implementation; status `2` is for unproven custody,
identity, workload, or integrity. The command must run from the clean
measured-source checkout with authenticated `gh` network access. It live-fetches every canonical
artifact, run, all-attempt jobs, and commit-addressed workflow-file endpoint. The first three live
responses must produce the same canonical immutable authority projections as their saved `gh api`
outputs; their raw digests remain audit facts and may differ when GitHub updates a mutable field. The
workflow response must decode to the exact clean local workflow bytes. An offline run, stale
authority projection, API error, incomplete run, disallowed producer conclusion, wrong workflow/scope, dirty
checkout, or expired artifact is unproven. API responses and extracted reports are bounded to 1 MiB and 128 MiB,
respectively, and an artifact ZIP is rejected before reading or parsing when it exceeds 512 MiB. The
gate's bounded claim is that live GitHub authority, GitHub's published archive digest, exact ZIP
census, and report form one exact byte chain;
repository-controlled evidence does not replace GitHub's external authority.
