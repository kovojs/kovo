# Build source-trust candidate decision

Status: preregistered; hosted result pending.

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
the packed fixture binds the app-local dependency root. The shared command materializer then
authenticates the declared `node_modules/.bin/kovo` wrapper inside that consumer and executes the
authenticated packed CLI entry directly.
Therefore a missing package cannot climb an app ancestor into either workspace. Every raw adapter
report must contain exact packed Kovo evidence with `required`, `beforeVerified`, and
`afterVerified` all true. This candidate decision has exactly zero Next.js cells and records the
Next.js product artifact as `null`.

An external app also cannot inherit the measured repository's `pnpm-lock.yaml` ancestor. Before
binding the packed product, the runner copies the exact source-provenance-authenticated root lock
into the app and reseals the generated manifest's file census and source digest around those bytes.
The build therefore receives the lock required for `SPEC.md` §5.2.3 artifact provenance without
weakening external-root isolation or inventing a different dependency identity.

The A/B boundary has its own exact structured policy because its order is deliberately stricter
than the general comparison policy: one timing lock starts before a quiet-host admission, packed
preparation happens only after that admission and outside measured samples, and every measured
block receives another quiet-host admission. Policy-schema, isolation-schema, order, zero-warmup,
Kovo-only, and report-bound-per-arm fields are authenticated during preparation and again at the
cell/report boundary; policy drift makes the result unproven.

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
   process-tree RSS, the exact output tree/content digest, and raw source/worker phase censuses.
   Failed commands retain bounded stdout/stderr text plus full-stream byte counts and SHA-256
   digests, so a framework refusal cannot be masked by the necessarily empty output tree.

Preparation, artifact hashing, and host settling are outside the adapter's timed build window. A
later block cannot start unless its immediate host admission passes.

## Preregistered decision rule

Both corpora require 10/10 valid samples per arm, zero adapter errors or misses, clean stable source
and locks, exact packed-product verification, byte-identical application output trees/content, and
identical non-timing diagnostics plus exact phase order across all 20 cells. Incomplete, dirty,
unquiet, identity-mismatched, or short evidence is **unproven** rather than a rejection.

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
