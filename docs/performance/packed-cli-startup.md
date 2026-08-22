# Packed CLI startup benchmark

`scripts/perf-cli-startup-benchmark.mjs` answers a narrow Phase 1 prioritization question: does
ordinary installed Kovo pay the same startup cost as a source checkout? It does not compare a
published artifact with an unauthenticated local `dist/` directory.

The lanes have intentionally different owners:

- `packed` is product developer experience. The benchmark builds and packs the real transitive
  public-package closure, installs `@kovojs/cli` outside the workspace, and executes the installed
  `dist/bin.mjs`.
- `source-checkout` is maintainer performance. It executes `packages/cli/src/bin.ts`, including the
  normal Node type-transformation bootstrap used by repository contributors.

Both lanes run `--version` with the same Node binary. That workload reaches the trusted dispatcher
graph but has no app, filesystem-corpus, network, or database variability. Startup wall time and
process-tree peak RSS are measured in serialized `source, packed, packed, source` blocks.

## Evidence boundary

Preparation is part of authentication, not a timed sample. The tool:

1. records the committed source SHA and exact root, Next.js, and benchmark-harness lock digests;
2. verifies the declared pnpm version, refreshes the repository through its frozen lock offline,
   runs each enrolled package's real `build:dist`, then its reviewed lifecycle-disabled pack path;
3. authenticates deterministic tarball metadata, package manifests, file censuses, tarball SHA-256,
   and an unpacked package-content SHA-256;
4. resolves a consumer lock outside the workspace, deletes `node_modules`, and reinstalls offline
   with that unchanged lock and `--frozen-lockfile`;
5. byte-compares every tarball-owned installed file and proves the exact package-owned census
   (pnpm's separately locked package-local dependency links and command shims are excluded);
6. runs a separate Node module-resolution proof that fails if the packed command resolves any file
   outside the consumer's real `node_modules`; and
7. records post-run source state, host identity, pre/per-sample/post load, command output digests,
   misses, errors, and process-tree RSS.

A timing run is refused above one load-average unit per logical CPU by default. A single OS-temporary
lock prevents two instances of this timing lane from overlapping. Operators must still schedule it
away from other benchmark families.

## Commands

Authenticate the full build, pack, frozen install, and resolution boundary without collecting a
timing sample:

```sh
node scripts/perf-cli-startup-benchmark.mjs \
  --prepare-only \
  --out /tmp/kovo-cli-startup-prepare.json
```

Run the two-sample-per-lane smoke block used to validate benchmark wiring:

```sh
node scripts/perf-cli-startup-benchmark.mjs \
  --quick-smoke \
  --out /tmp/kovo-cli-startup-smoke.json
```

Run the default three warmups and fifteen measurements per lane only on a quiet host with no other
timing workload:

```sh
node scripts/perf-cli-startup-benchmark.mjs \
  --out /tmp/kovo-cli-startup.json
```

Raw reports belong in CI artifacts or an untracked temporary path. Do not commit a report from a
dirty tree, a load-shed run, an incomplete sample schedule, or changed source/lock provenance.

## Interpreting ownership

The packed lane is always product DevEx and the source-checkout lane is always maintainer
performance. The tool deliberately has no invented default for “fast.” The CI decision lane now
passes a reviewed absolute budget of **1,000 ms p95** with `--packed-fast-budget-ms 1000`.

That ceiling was fixed before measuring the short-circuit candidate. The workload is a deterministic
root `--version` meta command: it reads no app, opens no network or database, and does no compiler
work. One second is intentionally generous for Node startup, an authenticated adjacent package
manifest read, and process-tree observation on the pinned four-vCPU runner; exceeding it means an
ordinary installed meta command is loading product subsystems it does not need. The ceiling is not
derived from the candidate's observed value and does not classify heavier app-owning commands.

When an absolute budget is supplied:

- if the complete packed p95 is within that budget, source transformation or a prebuilt checkout
  command is classified as maintainer-only work;
- if the packed p95 exceeds it, packed startup remains product-priority work; and
- without a budget, the report says `budget-required` rather than treating a relative win as proof
  that users are already fast.

Every complete report includes median, MAD, p95, sample count, raw samples, zero/miss/error counts,
and paired bootstrap 95% confidence intervals for `packed - source-checkout` wall time and RSS.

## Dev and build comparison boundary

The ordinary `benchmarks/compare.mjs --cells dev,build` Kovo lane reuses the same preparation
contract. It builds and packs once before host admission, resolves then frozen-reinstalls the
isolated consumer, proves the first and frozen installed trees agree, and generates a second,
shape-authenticated Kovo corpus under the comparator's OS-temporary root. The measured app is
outside the repository, and every ancestor up to the filesystem root must lack `node_modules`.
Only then does the comparator create the app-local dependency link to the isolated consumer. This
prevents Node's ancestor search from silently falling back to `benchmarks/kovo/node_modules` and
workspace source. Pack, install, corpus generation, and binding are outside every timed
ready/edit/build sample. Next.js continues to use its independently frozen entrant install.

The workload digest records the stable comparison policy: Kovo must carry a report-bound packed
artifact, Next must not, preparation precedes quiet-host admission, and the corpus has the external
ancestor-isolation posture. Concrete tarball and installed-byte identity is deliberately not part
of workload equality because a later clean candidate commit must have different artifact bytes.
Instead, each report binds its concrete identity at the top level and repeats it exactly in every
Kovo raw cell. The identity covers the clean commit, root/Next/harness lock digests, canonical
tarball manifests and content, frozen consumer lock, installed package census, exact
`dist/bin.mjs`, and installed TypeScript package. Next cells must carry exact `null` product
identity plus `afterVerified: true`, `beforeVerified: false`, and `required: false`.

The private descriptor retains temporary paths solely as execution capabilities. Each Kovo adapter
reopens and re-authenticates the descriptor, tarballs, installed Kovo closure, TypeScript tree, CLI
entry, and app-local dependency link before timing and after teardown. Raw-report, baseline,
budget, candidate, and publication validators independently reject missing or mismatched Kovo
identity and any Kovo identity on Next. Corpus source capture ignores only the generated dependency
link; it never follows that link or treats packed output as app-authored TSX (SPEC §5.2 rules 7 and
9).
