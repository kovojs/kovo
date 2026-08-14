# Realistic performance baseline publication

The `perf-measure-baselines` label runs seven independently scheduled baseline jobs. Repeat the
label cycle until each subject has at least five reports with the same source commit, dependency
locks, workload digest, and normalized host digest. Jobs from one workflow run can land on
different machines; cohorts are selected per subject, not by assuming all seven jobs shared a host.
Five attempts of one Actions run do not count: every accepted report has a distinct run ID.

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

For each row above, supply the five downloaded report paths and their matching artifact URLs:

```sh
vp exec node scripts/perf-baseline-ratify.mjs \
  --report artifacts/run-1/<report>.json --location <artifact-url-1> \
  --report artifacts/run-2/<report>.json --location <artifact-url-2> \
  --report artifacts/run-3/<report>.json --location <artifact-url-3> \
  --report artifacts/run-4/<report>.json --location <artifact-url-4> \
  --report artifacts/run-5/<report>.json --location <artifact-url-5> \
  --out reports/<subject>-baseline.json
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
  --baseline reports/browser-baseline.json \
  --report artifacts/run-1/browser/comparison.json \
  --report artifacts/run-2/browser/comparison.json \
  --report artifacts/run-3/browser/comparison.json \
  --report artifacts/run-4/browser/comparison.json \
  --report artifacts/run-5/browser/comparison.json \
  --out reports/browser-budget.json \
  --markdown-out reports/browser-baseline.md

vp exec node scripts/perf-comparison-budget.mjs derive \
  --baseline reports/server-baseline.json \
  --report artifacts/run-1/server/comparison.json \
  --report artifacts/run-2/server/comparison.json \
  --report artifacts/run-3/server/comparison.json \
  --report artifacts/run-4/server/comparison.json \
  --report artifacts/run-5/server/comparison.json \
  --out reports/server-budget.json \
  --markdown-out reports/server-baseline.md
```

Check scaling uses its Kovo-only derivation; it does not manufacture a Next.js subject:

```sh
vp exec node scripts/perf-check-budget.mjs derive \
  --baseline reports/check-baseline.json \
  --report artifacts/run-1/check-scaling.json \
  --report artifacts/run-2/check-scaling.json \
  --report artifacts/run-3/check-scaling.json \
  --report artifacts/run-4/check-scaling.json \
  --report artifacts/run-5/check-scaling.json \
  --out reports/check-budget.json
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

For each report, retain three local files from the same artifact:

1. The unmodified artifact API response from
   `GET /repos/kovojs/kovo/actions/artifacts/<artifact-id>`.
2. The ZIP bytes returned by that response's `archive_download_url`.
3. The expected report extracted from the ZIP (`comparison.json`, or `check-scaling.json` for the
   check family).

For example:

```sh
gh api repos/kovojs/kovo/actions/artifacts/2001 > artifacts/run-1/browser.api.json
gh api repos/kovojs/kovo/actions/artifacts/2001/zip > artifacts/run-1/browser.zip
unzip -p artifacts/run-1/browser.zip comparison.json > artifacts/run-1/comparison.json
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
          "apiMetadata": "artifacts/run-1/browser.api.json",
          "archive": "artifacts/run-1/browser.zip",
          "report": "artifacts/run-1/comparison.json"
        },
        {
          "apiMetadata": "artifacts/run-2/browser.api.json",
          "archive": "artifacts/run-2/browser.zip",
          "report": "artifacts/run-2/comparison.json"
        },
        {
          "apiMetadata": "artifacts/run-3/browser.api.json",
          "archive": "artifacts/run-3/browser.zip",
          "report": "artifacts/run-3/comparison.json"
        },
        {
          "apiMetadata": "artifacts/run-4/browser.api.json",
          "archive": "artifacts/run-4/browser.zip",
          "report": "artifacts/run-4/comparison.json"
        },
        {
          "apiMetadata": "artifacts/run-5/browser.api.json",
          "archive": "artifacts/run-5/browser.zip",
          "report": "artifacts/run-5/comparison.json"
        }
      ],
      "holdout": {
        "apiMetadata": "artifacts/run-6/browser.api.json",
        "archive": "artifacts/run-6/browser.zip",
        "report": "artifacts/run-6/comparison.json"
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
reports under the optional top-level `buildProfiles` object. Each descriptor uses the same
`apiMetadata`/`archive`/`report` custody shape; the artifact must be named
`kovo-perf-build-profile-n216`. Its exact member census includes `profile-unchanged.json` and
`profile-edit.json`, both derived `build-*.cpuprofile` views, both `process-cpu-*.txt` members, and
every report-declared original `raw-*-<role>-pid-<pid>.cpuprofile`. Undeclared, missing,
digest-mismatched, or duplicate members fail closed:

```json
{
  "buildProfiles": {
    "unchanged": {
      "apiMetadata": "artifacts/build-profile/profile.api.json",
      "archive": "artifacts/build-profile/profile.zip",
      "report": "artifacts/build-profile/profile-unchanged.json"
    },
    "edit": {
      "apiMetadata": "artifacts/build-profile/profile.api.json",
      "archive": "artifacts/build-profile/profile.zip",
      "report": "artifacts/build-profile/profile-edit.json"
    }
  }
}
```

Supplying only one mode is invalid. Profiles are unnecessary when all four warm cells meet the
first milestone or both N=216 upper/wall medians are below 10%.

Run the aggregate gate after collecting one same-host/workload six-run cohort for every family:

```sh
vp exec node scripts/perf-publication-gate.mjs \
  --manifest artifacts/performance-publication-input.json \
  --evidence-dir reports/performance-publication \
  --out reports/performance-publication.json \
  --markdown-out reports/performance-publication.md
```

The evidence directory receives the re-ratified baseline, derived budget, and independent holdout
evaluation for every family. The aggregate JSON content-addresses those 21 files and retains every
canonical artifact page, API URL, API-response digest, artifact ZIP digest, report digest, execution,
source, lock, host, and workload identity. Its Markdown surfaces baseline and holdout target
assessments for all seven families, links exact fixture sources at the measured commit, and preserves
the architectural lane warning beside each subject. It also embeds and renders the cross-corpus
foreground build-session assessment, including its four milestone/residual cells and any
custody-authenticated profile references.

The gate derives the API and artifact-page URLs from the API response's repository-scoped artifact
ID and workflow-run ID; there is no user-supplied evidence URL. It requires the GitHub API's SHA-256
artifact digest and byte size to match the downloaded ZIP, safely reads and CRC-checks the expected
ZIP member, then requires the extracted report to be byte-identical. It also requires the API head
SHA to match the report, an unexpired retention record, five distinct baseline workflow runs, and a
sixth workflow run not used by that family's baseline. All 42 reports must share the exact source and
dependency locks; each holdout must match its family's ratified host and workload.

Exit status is `0` only for `publishable`, `1` for measured evidence blocked by a target or regression,
and `2` for unproven custody, identity, workload, or integrity. The command requires authenticated
`gh` network access and live-fetches every canonical artifact API endpoint. Each live response must be
byte-identical to the saved `gh api` output; an offline run, stale/pretty-printed response, API error,
or expired artifact is unproven. API responses and extracted reports are bounded to 1 MiB and 128 MiB,
respectively, and an artifact ZIP is rejected before reading or parsing when it exceeds 512 MiB. The
gate's bounded claim is that a live GitHub response, GitHub-published archive digest, ZIP, and report
form one exact byte chain; repository-controlled evidence does not replace GitHub's external
authority.
