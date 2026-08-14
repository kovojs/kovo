# Realistic performance baseline publication

The `perf-measure-baselines` label runs seven independently scheduled baseline jobs. Repeat the
label cycle until each subject has at least five reports with the same source commit, dependency
locks, workload digest, and normalized host digest. Jobs from one workflow run can land on
different machines; cohorts are selected per subject, not by assuming all seven jobs shared a host.
Five attempts of one Actions run do not count: every accepted report has a distinct run ID.

Use the metrics-blind collection and five-plus-one holdout workflow in
[`baseline-collection.md`](./baseline-collection.md) to preserve raw GitHub custody and select exact
cohorts. The manual commands below describe the same individual ratification stages and remain
useful for inspecting a selected family; they are not a substitute for the aggregate collector and
publication gate.

## Collect one host cohort without repeating completed families

Manual dispatch accepts two optional collection controls. `baseline_focus` selects `all`, `check`,
`browser`, `dev-n24`, `dev-n216`, `build-n24`, `build-n216`, or `server`. The selected dev or build
focus reduces that job's matrix to the exact corpus size. The five publication-authenticated job
conditions remain unchanged: an early admission step stops every non-selected producer before Kovo
setup, isolated dependency installs, browser installation, corpus generation, or measurement. Those
expected non-selected jobs fail without an artifact; their failure does not invalidate the selected
successful producer. Use another focused dispatch for each family still missing a report instead of
rerunning already-complete three-hour families.

`baseline_cpu_model_sha256` optionally admits only runners whose exact UTF-8 Node
`os.cpus()[0].model` string has the requested SHA-256. The value must be exactly 64 lowercase
hexadecimal characters with no `sha256:` prefix. An empty value remains allowed for schedules,
label-triggered runs, and unconstrained manual collection. Invalid or mismatched values fail before
setup and print the observed model digest so the operator can retry without paying measurement cost.

For example, the currently observed `AMD EPYC 7763 64-Core Processor` model hashes to
`f56edd1ddb32e98359af80267bba52d80fedc60bf40440adea1c3ea0e0f429c7`:

```sh
gh workflow run perf-realistic.yml \
  --ref <collection-branch> \
  -f measurement_scope=baselines \
  -f baseline_focus=dev-n216 \
  -f baseline_cpu_model_sha256=f56edd1ddb32e98359af80267bba52d80fedc60bf40440adea1c3ea0e0f429c7
```

When workflow dispatch is unavailable, a labeled pull request provides a closed fallback. The only
CPU alias is `perf-baseline-cpu-amd-7763`, which resolves to the full digest above. The reviewed
focus aliases are `perf-baseline-focus-check`, `perf-baseline-focus-browser`,
`perf-baseline-focus-dev-n24`, `perf-baseline-focus-dev-n216`,
`perf-baseline-focus-build-n24`, `perf-baseline-focus-build-n216`, and
`perf-baseline-focus-server`. Apply at most one CPU alias and at most one focus alias, then apply
`perf-measure-baselines` last:

```sh
gh pr edit <pr-number> \
  --add-label perf-baseline-cpu-amd-7763 \
  --add-label perf-baseline-focus-dev-n216
gh pr edit <pr-number> --add-label perf-measure-baselines
```

The selector-label events do not pass the publication-authenticated producer condition; the final
`perf-measure-baselines` labeled event does, and its pull-request label census carries both
selectors into the env-only admission step. For another family, remove the old focus and trigger
labels, add the next exact focus, then re-add `perf-measure-baselines`. With no selector labels the
PR path remains all-family and CPU-unconstrained. More than one CPU/focus selector, malformed label
JSON, or any unknown label beginning `perf-baseline-cpu` or `perf-baseline-focus` fails closed before
setup. Workflow-dispatch inputs remain the primary, general API and take precedence over label
aliases; pull-request jobs deliberately receive empty dispatch-input environment values so their
reviewed labels can apply.

That AMD digest is a collection-time operator choice based on the current hosted-runner cohort, not
a permanent default or a portable hardware requirement. CPU admission only reduces wasted retries.
It does not replace or weaken the report's normalized `kovo-performance-host/v2` facts, and the
ratifier/publication gate still requires the exact full `host.digest` for each cohort. CPU count,
memory capacity class, Node version, OS release, runner image, and browser versions can therefore
still separate two reports that passed the same CPU-model admission.

After a mismatch, rerun only the affected `baseline_focus` until the family has five independent
baseline run IDs plus its sixth holdout. If the build-persistence decision requires the optional
N=216 build profile, dispatch `measurement_scope=decisions` with
`decision_focus=build-profile` and the same `baseline_cpu_model_sha256`; the profile producer uses
the same early CPU admission, while publication still requires its exact host identity to match the
build-N=216 evidence. On the PR-label fallback, apply `perf-baseline-cpu-amd-7763` (and, if a focus
selector is present, `perf-baseline-focus-build-n216`) before applying
`perf-measure-build-profile`.

## Artifact map

| Subject       | Artifact                   | Report inside the artifact | Required reports |
| ------------- | -------------------------- | -------------------------- | ---------------: |
| check scaling | `kovo-perf-check-scaling`  | `check-scaling.json`       |                5 |
| browser       | `kovo-perf-browser-matrix` | `comparison.json`          |                5 |
| dev N=24      | `kovo-perf-dev-n24`        | `comparison.json`          |                5 |
| dev N=216     | `kovo-perf-dev-n216`       | `comparison.json`          |                5 |
| build N=24    | `kovo-perf-build-n24`      | `comparison.json`          |                5 |
| build N=216   | `kovo-perf-build-n216`     | `comparison.json`          |                5 |
| server        | `kovo-perf-server-matrix`  | `comparison.json`          |                5 |

Use the canonical artifact page URL, not a signed download URL, for every `--location`:

```text
https://github.com/kovojs/kovo/actions/runs/<run-id>/artifacts/<artifact-id>
```

The browser report's ratified analysis includes the 30 scenario samples, five raw Lighthouse
samples per cell, and ten bfcache traversals. The check report uses the same authenticated execution,
source/lock, normalized host-v2, quiet-host, and workload identities as the comparison reports.
A dirty, busy, incomplete, duplicate, or identity-mismatched report produces `unproven`.

Baseline jobs request 90-day Actions retention. Finish review and commit the summary/budgets before
the effective repository retention window closes; the canonical artifact-page URL is stable during
retention, but it is not permanent storage.

## Ratify each subject

Create a custody directory outside the measured checkout, then supply the five downloaded report
paths and their matching artifact URLs:

```sh
kovo_perf_custody="$(mktemp -d)"
vp exec node scripts/perf-baseline-ratify.mjs \
  --report "$kovo_perf_custody/run-1/<report>.json" --location <artifact-url-1> \
  --report "$kovo_perf_custody/run-2/<report>.json" --location <artifact-url-2> \
  --report "$kovo_perf_custody/run-3/<report>.json" --location <artifact-url-3> \
  --report "$kovo_perf_custody/run-4/<report>.json" --location <artifact-url-4> \
  --report "$kovo_perf_custody/run-5/<report>.json" --location <artifact-url-5> \
  --out "$kovo_perf_custody/<subject>-baseline.json"
```

Do not combine N=24 with N=216 or browser with server: each is a different authenticated workload
digest. If fewer than five reports share a host cohort, collect more independent runs rather than
relaxing the identity check.

Publication derivation additionally requires the exact scheduled subject profile: isolated dev or
build cells, the full browser default/L0/L1 matrix (30/5/10 plus three warmups), the full server
route/encoding/mode/concurrency matrix (seven 15-second samples after five-second warmups), or the
N={8,24,72,216} one-sample check ladder. A generic scratch ratification with local file locations,
skipped Lighthouse, missing bfcache metrics, or shortened matrix cannot produce a budget.

## Derive reviewed budgets

Supply the same five raw files again. Each derivation re-hashes the downloads, recovers the reviewed
artifact links by digest, revalidates every raw report, and reproduces the ratified baseline before
writing a budget.

Browser and server use the common comparison derivation. `--markdown-out` creates a clean linked
Kovo-vs-Next table, derives the 5% regression envelope, records the ratified target assessment, and
preserves the architectural lane/posture warning:

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
the plan's ready/edit/recovery and wall/RSS competitive targets to the same five-run evidence rule.

Commit only the reviewed baseline/budget JSON and concise publication Markdown. Keep the raw reports
in their linked Actions artifacts; local download paths are not evidence locations.

## Close the seven-family publication boundary

Individual budgets are not permission to publish a Kovo-vs-Next claim. The aggregate gate requires
all seven subjects together, re-runs the existing ratifier and family-specific budget derivation on
exactly five reports, and evaluates a sixth report as an independent holdout. The browser, dev,
build, and server families are Kovo-vs-Next subjects. Check scaling is deliberately Kovo-only; the
aggregate must not manufacture a Next.js check result.

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

The input manifest is `kovo-performance-publication-input/v1`. This abridged, non-runnable example
shows one family's shape:

```json
{
  "schema": "kovo-performance-publication-input/v1",
  "repository": "kovojs/kovo",
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
`check`; missing or additional families fail before any file is read. Paths are resolved relative to
the input manifest.

If the build-persistence predicate returns `profile-required`, add the two current N=216 profile
reports under the optional top-level `buildProfiles` object. Each descriptor uses the same exact
five-file local custody shape because the raw diagnostic members remain inside the authenticated
ZIP. The artifact must be named `kovo-perf-build-profile-n216`. For each mode it contains the
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
      "apiMetadata": "build-profile/profile.api.json",
      "archive": "build-profile/profile.zip",
      "jobsApiMetadata": "build-profile/profile.jobs.api.json",
      "runApiMetadata": "build-profile/profile.run.api.json",
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

The CLI completes all 42 baseline/holdout custody calls and both optional build-profile calls before
it creates an evidence, JSON, Markdown, staging, or output path. A requested in-repository output is
therefore created only after the whole measured checkout has passed every clean-source check; using
the external directory above avoids coupling collection and publication to repository state.

The evidence directory receives the re-ratified baseline, derived budget, and independent holdout
evaluation for every family. The aggregate JSON content-addresses those 21 files and retains every
canonical artifact page, API URL, API-response digest, artifact ZIP digest, report digest, execution,
source, lock, host, and workload identity. Its Markdown surfaces baseline and holdout target
assessments for all seven families, links exact fixture sources at the measured commit, and preserves
the architectural lane warning beside each subject. It also embeds and renders the cross-corpus
foreground build-session assessment, including its four milestone/residual cells and any
custody-authenticated profile references.

For each dev family, the rendered baseline and holdout target assessments include the exact median
and p95 regression census for leaf, entry, data-plane, syntax-error, recovery, ready, and
process-tree RSS metrics, followed by the fixed competitive/latency targets. `edit.dataMs` is not an
optional diagnostic: a missing row makes the publication malformed, and a measured data-plane
regression blocks the aggregate even when every other developer-loop row passes.

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
retain the exact immutable head/source SHA, run attempt, and expected successful family job. A
failed unrelated sibling job does not invalidate that producer's artifact; the uniquely bound
producer job, report, ZIP, and workflow authority remain the evidence boundary.

The report separately retains `GITHUB_WORKFLOW_SHA`, the commit whose workflow GitHub evaluated.
For a pull request it is the synthetic merge/event SHA; for other reviewed triggers it equals the
run head and measured source. The gate fetches the workflow file from GitHub's Contents API at that
evaluated workflow SHA, verifies its Git blob and bytes against the clean local workflow, and
requires local checkout `HEAD` to equal the measured source SHA and the whole checkout to be clean.
It then extracts the exact folded job `if` expression and requires one uniquely owned, commit-pinned
`actions/upload-artifact` step with the reviewed literal name template and path. A successful family
job therefore authenticates the scheduled baseline scope, `measurement_scope=baselines|all`, or the
exact `perf-measure-baselines` labeled-PR condition instead of trusting an event name alone. The
measured source remains the immutable run/artifact/job `head_sha`; neither the synthetic merge
identity nor the mutable PR object is substituted for it.

The artifact API's SHA-256 digest and byte size must match the downloaded ZIP; GitHub exposes no
download-receipt field, so the gate does not invent one. The gate requires the ZIP's complete member
census to equal the reviewed family contract, safely reads and CRC-checks each expected member, then
requires the extracted report to be byte-identical. It
also requires an unexpired retention record, five distinct baseline workflow runs, and a sixth run
not used by that family's baseline. All 42 reports must share the exact source and dependency locks;
each holdout must match its family's ratified host and workload.

Before writing, the aggregate gate re-ratifies every baseline from its five authenticated raw
reports, re-derives each family budget, and re-evaluates each holdout. It recomputes the exact target
assessment and the byte and semantic digests for all 21 baseline/budget/evaluation documents. After
writing, it reads those 21 files and the aggregate JSON back, verifies canonical bytes and digests,
and repeats the result-level validation. A self-consistently edited target, evaluation, or document
plus a recomputed aggregate self-hash therefore cannot produce exit status 0. The same result gate
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

Exit status is `0` only for `publishable`, `1` for measured evidence blocked by a target, regression,
or warranted-but-not-yet-measured foreground-session implementation, and `2` for unproven custody,
identity, workload, or integrity. The command must run from the clean
measured-source checkout with authenticated `gh` network access. It live-fetches every canonical
artifact, run, all-attempt jobs, and commit-addressed workflow-file endpoint. The first three live
responses must produce the same canonical immutable authority projections as their saved `gh api`
outputs; their raw digests remain audit facts and may differ when GitHub updates a mutable field. The
workflow response must decode to the exact clean local workflow bytes. An offline run, stale
authority projection, API error, incomplete run, failed producer job, wrong workflow/scope, dirty
checkout, or expired artifact is unproven. API responses and extracted reports are bounded to 1 MiB and 128 MiB,
respectively, and an artifact ZIP is rejected before reading or parsing when it exceeds 512 MiB. The
gate's bounded claim is that live GitHub authority, GitHub's published archive digest, exact ZIP
census, and report form one exact byte chain;
repository-controlled evidence does not replace GitHub's external authority.
