# Build source-trust candidate decision

Status: accepted and integrated.

This decision tests one profile-driven compiler candidate against clean packed-product builds. It is
not evidence for a source-checkout-only optimization and it does not use emitted bytes, module
counts, or phase duration proxies as a substitute for end-to-end wall time. The build still executes
the complete current-source proof required by `SPEC.md` §5.2; the candidate changes how repeated
lexical declaration lookups are indexed within one exact AST.

## Candidate custody

- Durable ref: `refs/heads/perf-spike/build-source-trust-20260814`
- Commit: `c89e179a9e9b179dd75b0bebabd357f4aa9e36a6`
- Parent: `4ffd0b24c27f72b9e1b6250a267de325564a4d6f`
- Tree: `bad908875754f4fe748d5e62f5ca9b3f61b7a7e5`
- Stable patch ID: `c8be3545899c135489152f0a82322b64a3208768`
- Full-index binary patch: 18,234 bytes,
  `sha256:0beca6e2ee833234dc85040d52644d3d7c10b65d3ddbe1199560507d53cd6253`
- Exact path census:
  - added `packages/compiler/src/scan/lexical-scope-declaration-index.test.ts`
  - modified `packages/compiler/src/scan/parse.ts`
  - modified `scripts/check-security-classifier-corpus.mjs`
  - modified `security/security-carrier-grammar.json`

The hosted runner fetches that durable object, creates distinct clean worktrees at the measurement
source, and cherry-picks the candidate. The measured spike must be exactly one direct commit over
the measured baseline. Before preparation, the runner reproduces the full-index patch bytes, stable
patch ID, byte length, and status/path census from the sealed object. Any mismatch is unproven.

## Why this candidate

The exact N=216 static-trust profile attributed 48.159% of weighted busy samples to repeated
`scopeDeclaresIdentifierNamed` traversal. A diagnostic candidate profile reduced that subtree to
0.014% while preserving the proof payload, source-fact, and source-set digests. The diagnostic wall
observations (67.87s baseline and 34.70s candidate) came from a shared development host and are only
candidate-selection evidence; they are not accepted timing results.

The candidate creates one declaration index per exact AST scope object. It does not cache across
source contents or parser invocations. Ambiguous declarations and excluded bindings remain
fail-closed, and poisoned collection prototypes are covered by the candidate tests.

The resealed candidate also enrolls the source-provenance classifier in the required C13 structural
closure corpus. Its current security evidence covers 358 anchors and all 25 required corpora; those
changes are part of the exact candidate patch rather than an unmeasured follow-up.

## Product and workload boundary

For each arm independently, the runner builds, packs, authenticates, and frozen-installs the exact
Kovo release closure from that arm. Product identities and tarball digests are report-bound per arm;
they are intentionally not required to equal each other because the candidate changes compiler
package bytes.

Each generated Kovo corpus lives in a fresh operating-system temporary directory external to both
Git worktrees. Corpus generation uses deferred dependency binding, so it never creates a workspace
dependency link. The shared packed-product isolation guard rejects any ancestor `node_modules`, and
the packed fixture binds the app-local dependency root. That frozen consumer declares the root
lock's exact TypeScript version directly, because Kovo's preflight resolves the compiler from the
app root rather than from the CLI package's pnpm-local peer scope. Its resolution and frozen-install
snapshots must both equal the root-lock-authenticated TypeScript file census and digest. The shared
command materializer then authenticates the declared `node_modules/.bin/kovo` wrapper inside that
consumer and executes the authenticated packed CLI entry directly.
Therefore a missing package cannot climb an app ancestor into either workspace. Every raw adapter
report must contain exact packed Kovo evidence with `required`, `beforeVerified`, and
`afterVerified` all true. This candidate decision has exactly zero Next.js cells and records the
Next.js product artifact as `null`.

An external app also cannot inherit the measured repository's `pnpm-lock.yaml` ancestor. Before
binding the packed product, the runner copies the exact source-provenance-authenticated root lock
into the app and reseals the generated manifest's file census and source digest around those bytes.
The build therefore receives the lock required for `SPEC.md` §5.2.3 artifact provenance without
weakening external-root isolation or inventing a different dependency identity.
The reseal rejects symlink and hardlink aliases and replaces the checked manifest atomically, so it
cannot mutate a file outside the corpus through an aliased path.

The A/B boundary has its own exact structured policy because its order is deliberately stricter
than the general comparison policy: one timing lock starts before a quiet-host admission, packed
preparation happens only after that admission and outside measured samples, and every measured
block receives another quiet-host admission. Policy-schema, isolation-schema, order, zero-warmup,
Kovo-only, and report-bound-per-arm fields are authenticated during preparation and again at the
cell/report boundary; policy drift makes the result unproven.

Cold Kovo builds also produce one invocation-local incremental file,
`.kovo/cache/tsc-preflight.tsbuildinfo`. It embeds absolute packed-consumer and app-root paths, so it
is a derived source-check cache under `SPEC.md` §5.2 rule 9 rather than deploy output under
§5.2.3/§5.2.4: path-independent deploy provenance lives in `dist/.kovo/graph.json`, and the staged,
promoted `dist` tree is the deploy artifact. The decision runner does not normalize, filter, or
silently subtract those bytes.
After the adapter returns and timing has ended, it first authenticates that `.kovo/cache` contains
exactly one regular, single-link `tsc-preflight.tsbuildinfo`, retaining its byte count and SHA-256.
It then unlinks that exact file, removes the now-empty cache directory, and proves `.kovo` remains
present and empty. A read-only `dist` digest/census taken before removal must equal one taken after.
Only then does the official compared-artifact census run over retained non-cache `.kovo` plus
`dist`, with `.kovo/cache` required absent. Raw adapter bytes must equal compared-artifact bytes plus
the authenticated removed-cache bytes. Any extra entry, alias, accounting mismatch, cache residue,
or `dist` change makes the cell unproven.

## Hosted protocol

The `perf-measure-build-source-trust` pull-request label starts two independent GitHub-hosted
Ubuntu 24.04 jobs, one for N=24 and one for N=216. Each job:

1. Authenticates the checked-out feature-head source, candidate object, three dependency locks,
   runner image, toolchain, corpus, and packed-product boundary.
2. Acquires one timing lock covering pre-preparation admission through the final host diagnostic.
3. Admits a quiet host before packed-product preparation and again before every measured block.
   One 30-second settling budget is shared by the entire job.
4. Runs five serialized `B,S,S,B` repetitions. Every block is one clean Kovo build with one measured
   sample and zero timed warmups, yielding exactly 10 samples per arm.
5. Retains every raw adapter report or bounded failure envelope and records total wall time, peak
   process-tree RSS, the exact post-cache-custody `.kovo` plus `dist` tree/content digest, removed
   cache custody/accounting, and raw source/worker phase censuses.
   Failed commands retain bounded stdout/stderr text plus full-stream byte counts and SHA-256
   digests, so a framework refusal cannot be masked by the necessarily empty output tree.

Preparation, artifact hashing, and host settling are outside the adapter's timed build window. A
later block cannot start unless its immediate host admission passes.

## Preregistered decision rule

Both corpora require 10/10 valid samples per arm, zero adapter errors or misses, clean stable source
and locks, exact packed-product verification, byte-identical post-custody non-cache `.kovo` plus
`dist` output trees/content, exact raw-to-compared cache byte accounting, and identical non-timing
diagnostics plus exact phase order across all 20 cells. Incomplete, dirty, unquiet,
identity-mismatched, or short evidence is **unproven** rather than a rejection.

For N=216, acceptance requires:

- median total wall-time improvement of at least 10%; and
- the lower bound of a deterministic paired-bootstrap 95% confidence interval for
  baseline-minus-spike wall time to be greater than zero.

For N=24, median total wall-time regression must be no more than 5%. For both N=24 and N=216, total
wall p95 and peak-RSS p95 regressions must each be no more than 5%. A complete run that misses any
threshold is a rejection. The report includes count, median, MAD, p95, paired evidence, artifact
bytes/digest/census, raw phases, host samples, and full source/candidate/product provenance.

The production patch is eligible for integration only if both hosted corpus reports return
`accept` under these rules.

## Authenticated result

[Run `31821610014`](https://github.com/kovojs/kovo/actions/runs/31821610014) checked out exact
source `1e1300962bcb2862d29a65d7c6bf5ab2bfd67b52` and completed both independent hosted jobs with an
`accept` verdict. The N=24 evidence is
[artifact `9228047402`](https://github.com/kovojs/kovo/actions/runs/31821610014/artifacts/9228047402):
its ZIP SHA-256 is `0e8d24c2cecee0670b033fb3473b04a49471366eee83d9fda02c09492ae08615`
and its unpacked `report.json` SHA-256 is
`547638de719777205b4b99ef8181caf97fdb675095867798d663f9f4977042ce`. The N=216 evidence is
[artifact `9229624306`](https://github.com/kovojs/kovo/actions/runs/31821610014/artifacts/9229624306):
its ZIP SHA-256 is `0372cbd0ba81aba1d49ea86cdd188467b3d4ba8cf0b2f8e81e52171c7a5aeaef`
and its unpacked `report.json` SHA-256 is
`4fb46ecfa375b37f6522e5c9b33b63bd180963aa2bb767b79e1f2ad4c2396216`.

| Corpus |           Median wall, baseline → candidate |              p95 wall, baseline → candidate |        Median RSS, baseline → candidate |          p95 RSS, baseline → candidate |
| ------ | ------------------------------------------: | ------------------------------------------: | --------------------------------------: | -------------------------------------: |
| N=24   |    72,052.28 → 71,358.35 ms (0.963% faster) |    72,401.98 → 72,002.13 ms (0.552% faster) | 1,738.11 → 1,739.68 MiB (0.090% higher) | 1,765.89 → 1,756.57 MiB (0.528% lower) |
| N=216  | 271,109.81 → 206,593.43 ms (23.797% faster) | 277,559.43 → 208,301.32 ms (24.953% faster) |  1,934.01 → 1,870.82 MiB (3.267% lower) | 2,014.66 → 1,969.34 MiB (2.249% lower) |

For N=216, the paired baseline-minus-candidate median was 65,565.70 ms and the deterministic
bootstrap 95% CI was `[61,552.30, 68,376.15]` ms. The 23.797% median improvement clears the 10%
primary threshold and the interval is strictly positive. N=24 clears its non-regression rule, and
both corpora clear the wall-p95 and RSS-p95 guardrails.

Both artifacts retain 20 raw cells—10 samples per arm in five exact `B,S,S,B` repetitions—with all
21 quiet-host admissions comparable. Authentication found zero misses, process failures, findings,
source drift, lock drift, or Next.js cells. Every packed product verified before and after its
sample; transient-cache custody was complete; the retained `dist` census was unchanged by cache
removal; and non-timing diagnostics and artifact contents were exact between arms. N=24 produced
13,952,063 bytes across 72 entries with digest
`sha256:9f7981c71905b7e1d5483e5d18ddcaaef4fc2042b663630a7c41f8b43e4a7490`; N=216 produced
15,285,510 bytes across 72 entries with digest
`sha256:4bca384ce7c601a42e602a07a2b97e81b1377c5fc14291b65d16e808e6c3ff13`.

The accepted patch is integrated as
`135645d719f49c0d41939ed65b274a9a068b7cbf`. Its `--binary --full-index` diff is byte-identical to
sealed candidate `c89e179a9e9b179dd75b0bebabd357f4aa9e36a6`: 18,234 bytes with SHA-256
`0beca6e2ee833234dc85040d52644d3d7c10b65d3ddbe1199560507d53cd6253`. Both commits have stable
patch ID `c8be3545899c135489152f0a82322b64a3208768`. The implementation therefore keeps the full
current-source proof required by `SPEC.md` §5.2 rule 9 while indexing repeated declaration lookups
only within one exact AST.
