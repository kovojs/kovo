# Authenticated `check --watch` reuse decision

The current check-watch candidate is accepted under `plans/good-perf.md`, while the first-milestone
latency target remains open as a performance target rather than an evidence gap. The production
implementation follows `SPEC.md` §11.4: every revision freshly evaluates the app and rebuilds the
check graph and diagnostics, while only exact compiler-owned facts with source/config/package and
tool-version digests can report `reused-authenticated`.

## Authenticated pair and protocol

[Run `31759466475`, job `94642512598`](https://github.com/kovojs/kovo/actions/runs/31759466475/job/94642512598)
independently fetched and authenticated the durable evidence ref
`refs/heads/perf-spike/check-watch-repaired-sealed-20260814`. The clean sealed baseline was
`e3a78ca901035ada82a564943db808255c94ac82`; the clean sealed candidate was
`2ce61f50b4df290796272e7ea836369e51537e22`. The workflow proved that the candidate contains one
seven-path production commit, `0590083172c0cbdeef4d58219ea384da7cb9f985`, followed only by its
five-path security seal. It also authenticated the frozen lock digest
`sha256:b44051d7c24ac90744743140c794ccee83991dd07d2e15d2e893fcc3d2b6d0a4` and workload digest
`sha256:f58bf9da3cebe70e2287bf6560879cf3b67ddae13dda431646636a091f195416`.

The hosted runner used four logical CPUs and the pinned Ubuntu 24.04 image identity
`sha256:2b6609a52a5119a507edca34ac6f2cb455ec20f2622cc7ec9cdd96322329ae9a`.
Its maximum admitted load was 0.715 per CPU, below the preregistered 0.75 ceiling. The run executed
30 measured closure edits per arm plus three warmups per occurrence in exact
`baseline, spike, spike, baseline` order. All 60 measured revisions completed with zero misses,
zero-duration samples, integrity errors, or order gaps.

The raw report is [artifact `9204437112`](https://github.com/kovojs/kovo/actions/runs/31759466475/artifacts/9204437112),
retained through 2026-09-13. Its unpacked `report.json` SHA-256 is
`fea6ae68e0a8e4ecb7bc12890b6c0dc04da6af8f6c640d7534ca9c5ab8bbb952`; the uploaded archive digest
is `sha256:4368d70bba968df788ed465d1772e6fd2664fa4ed542ab3514d95efe72e4d4e5`.

## Result

| Metric                       |     Baseline |    Candidate |        Change |
| ---------------------------- | -----------: | -----------: | ------------: |
| Median closure edit          | 11,605.65 ms |  9,390.72 ms | 19.08% faster |
| p95 closure edit             | 12,678.88 ms |  9,670.31 ms | 23.73% faster |
| Median peak process-tree RSS | 2,293.96 MiB | 2,654.64 MiB | 15.72% higher |
| p95 peak process-tree RSS    | 2,339.08 MiB | 2,773.13 MiB | 18.56% higher |

The median of paired per-edit improvements was 19.87%, with paired bootstrap 95% CI
`[19.05%, 20.83%]`. The plan's criterion A therefore accepts the candidate: arm-median improvement
is at least 10%, the paired interval excludes zero, and correctness is complete. Criterion A does
not waive disclosure of the memory cost; the retained semantic builder and authenticated facts add
about 361 MiB to median peak RSS. The candidate also remains above the plan's 5-second first
milestone, so neither the memory increase nor the remaining 9.39-second latency is presented as a
competitive endpoint.

The phase census proves the intended honesty boundary. Across all 30 candidate samples,
`config-trust`, `typescript`, and `stylesheet` were `reused-authenticated`; their median durations
changed from 2,125.03/1,073.83/104.67 ms to 23.09/876.88/5.02 ms. The edited source changed the
static-trust digest, so `app-source-trust` correctly executed on every revision. `session-authority`,
fresh app evaluation, check-graph construction, and graph diagnostics also executed on every
revision. No app object, authority, diagnostic, or partial graph crossed revisions.

## Decision

Keep the authenticated producer-fact cache and TypeScript semantic `BuilderProgram` in production.
The next measured opportunity is the still-fresh `app-source-trust` plus app-evaluation path, which
accounts for most of the remaining wall time; it must not be shortened by retaining app objects or
relaxing the current-source proof boundary.
