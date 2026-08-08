# Benchmark results

**There is deliberately no committed benchmark report here.**

`report.md` and `results.json` (generated 2026-06-23) were deleted on 2026-08-07 under
`plans/good-perf.md` decision **D14**: "Committed benchmark report — regenerate or delete it; it
currently errs in Kovo's favour."

## Why the old snapshot had to go

It was not merely stale. Every one of these defects moved the published numbers in Kovo's favour,
and none of them was visible in the report itself:

- **The navigation column did not measure navigation.** The probe clicked a product link and waited
  for `main h1` to exist — but the listing page also has a `main h1`, so the selector was already
  satisfied by the origin document and the probe resolved before the navigation committed. It timed
  two harness round-trips. That is why the snapshot reported ~49-50 ms desktop for Kovo, Next.js
  **and** TanStack alike. Measured to actual paint on the repaired harness, Kovo's mobile navigation
  is 1,153 ms and replaces the document on 3/3 attempts.
- **"JS bytes: 0" was an artifact.** Bytes were collected at `load` + 150 ms, and Kovo imports its
  deferred client runtime on a double `requestAnimationFrame` **after** `load`. The same build that
  the old window recorded as `total 164,673 / js 0` on mobile measures `total 434,847 / js 267,948`
  when collection runs to network quiescence — a 2.64x understatement of total bytes, and a
  headline "ships no JavaScript" claim for an app shipping 267,948 B of it. The Next.js control was
  unaffected, so the error was one-sided.
- **Kovo was measured in development posture.** `run-all.mjs` never set `NODE_ENV`, so Kovo ran in
  development against a Next.js production standalone build.
- **Lighthouse cells were single samples.** Repeated runs of the same URL on the repaired harness
  show up to an 8-point performance-score spread across two runs, and one cell returns `null`
  metrics for several samples.
- **It is not reproducible from the tree.** The TanStack entrant did not build at all until the
  repair on this branch, so the TanStack rows could not be regenerated.

## What may be committed here

A report may be committed only when all of the following hold. Otherwise leave this directory with
just this README and keep the run under `--out-dir`.

1. It was produced by a single uninterrupted `node benchmarks/run-all.mjs` at the committed tree, by
   the harness as committed — not by a patched or in-flight harness.
2. Every entrant built and started in the run (no `--skip-build` against stale `dist/`).
3. The load average recorded in the report header is below roughly 1.0 per core for the whole run.
   Wall-clock numbers taken on a loaded box are not comparable to anything.
4. The report's `Doc replaced`, `Capped runs`, `Null samples` and posture columns are read and
   accepted, not skipped. They exist to make a bad run look bad.

Byte counts are robust to machine load; wall-clock numbers are not. If a run must be published from
a loaded machine, publish the byte columns and say explicitly that the timing columns are indicative.

## Generating a run

```sh
# All entrants, results written outside the repo snapshot.
node benchmarks/run-all.mjs --iterations 10 --lighthouse-runs 5 --out-dir /tmp/kovo-bench

# Two entrants, no Lighthouse, on shifted ports so a concurrent run cannot collide.
node benchmarks/run-all.mjs --apps kovo,nextjs --skip-lighthouse --port-base 4820 \
  --out-dir /tmp/kovo-bench
```

The run aborts rather than publishing if a port is already held, if a server exits early, if a
server reports development posture under `NODE_ENV=production`, or if any request was rate-limited
or returned `>= 400`.
