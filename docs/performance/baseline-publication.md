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
