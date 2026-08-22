# Build compiler-facts candidate

Status: preregistered; measurement not started.

This spike tests whether reusing one immutable parsed project and carrying a data-only compiler-facts
capsule across source proof removes enough repeated build work to meet the production-build first
milestone. It does not relax the fresh source/deployment proof boundary in `SPEC.md` §5.2 rules 6
and 9, and it does not claim to remove the remaining structural-JSX project walk.

## Candidate custody

- Durable ref: `refs/heads/perf-spike/build-compiler-facts-sealed-20260822`
- Commit: `c81817ac801b4171b806cca1702e31dee90b6080`
- Parent: `01b2c759468f41a3fc4739225eb13c8f5aa11406`
- Tree: `73740d7e6f8ad898b1283e2dac7254f22636fd2f`
- Stable patch ID: `9aa6b1bd0179e34ce3ec896573333348ec628099`
- Full-index binary patch: 133,773 bytes,
  `sha256:a7757b4146a44ad89b7d5bea6fc3ed99a744c29feff0b60f3a43cb9df5439f8f`
- Exact 18-path status census: `scripts/perf-build-source-trust-spike.mjs` constant
  `BUILD_SOURCE_TRUST_CANDIDATE`.

The sealed commit is one direct child of the clean pre-change baseline. Its tree is byte-identical
to the independently reviewed development candidate at `e882954e8`; the multi-commit history is
not part of the timed identity. The runner reproduces the direct-child topology, full-index patch,
patch ID, byte length, tree, and complete path/status census before preparation.

## Security and correctness boundary

The source worker parses the immutable project once, reuses one invocation-scoped framework
identity lookup, and clears the transformed-root overlay in `finally`. Extensionless `.ts`/`.tsx`
collisions remain ambiguous through a module-private sentinel, independent of compile order or the
active root. Explicit imports, re-exports, and cycles retain legacy behavior.

The cross-process capsule contains only closed data facts: source paths, lengths, SHA-256 digests,
the source-set digest, app-contract static facts without source text, pure mutation bindings and
inputs, and a boolean saying whether deployment must freshly derive optimistic modules. It cannot
carry a TypeScript Program, SourceFile, AST, lowered module, or executable source. The deployment
path validates the complete capsule against current approved source. The common no-optimism path
uses the pure facts directly; the optimism path builds one fresh exact-source Program and compares
the complete pure subset before admitting newly derived executable modules.

Independent review found no semantic blocker after the generated posture, pack snapshot, and
certificate identities converged. Focused suites, the full compiler suite, build/dist, generated
artifact, posture, pack-security, certificate, module-identity, API, import, and VP checks passed.
The certificate/policy changes are derived identity changes only; roots, doors, capability verdicts,
thresholds, and opaque reasons are unchanged.

## Timed protocol

Run N=24 and N=216 separately on a quiet host. Each corpus uses five serialized
`baseline, spike, spike, baseline` repetitions, one cold packed Kovo build per block, zero timed
warmups, and exactly 10 samples per arm. Preparation occurs outside timing. Each block rechecks host
admission, clean source and locks, packed-product identity, external-corpus isolation, artifact
provenance, diagnostics, phase order, and the exact non-cache `.kovo` plus `dist` output tree.

The runner retains raw wall time, peak process-tree RSS, median, MAD, p95, paired-bootstrap 95%
confidence interval, exact artifact bytes/digest/census, transient-cache custody, source/worker
phase census, and every raw failure envelope. Any wrong identity, dirty source, unquiet host, missing
sample, command failure, diagnostic drift, artifact mismatch, or cache-accounting mismatch is
`unproven`.

## Preregistered decision rule

This rule is committed before either timed run and applies identically at both N=24 and N=216:

- 10/10 valid samples per arm, zero errors/misses, and exact artifacts and non-timing diagnostics;
- median total wall-time improvement of at least 10%;
- paired-bootstrap 95% confidence interval for baseline-minus-candidate wall time strictly above
  zero; and
- total-wall p95 and peak-RSS p95 each no more than 5% worse than baseline.

Both independent corpus reports must return `accept`. A complete threshold miss is a rejection and
will not be retried or reinterpreted; incomplete or integrity-failed evidence is unproven. Only an
accepted candidate may be integrated. Final Kovo-vs-Next build wall, p95, RSS, artifact-size, and
foreground-session disposition remain subject to the later fixed publication campaign.
