# Build compiler-facts candidate

Status: repaired candidate N=24 evidence unproven and below the performance floor; not integrated.

This spike tests whether reusing one immutable parsed project and carrying a data-only compiler-facts
capsule across source proof removes enough repeated build work to meet the production-build first
milestone. It does not relax the fresh source/deployment proof boundary in `SPEC.md` §5.2 rules 6
and 9, and it does not claim to remove the remaining structural-JSX project walk.

## Candidate custody

- Durable ref: `refs/heads/perf-spike/build-compiler-facts-sealed-v2-20260822`
- Commit: `20782ca320b7999d6a8e2f0c0226a39c3aa4e65d`
- Parent: `01b2c759468f41a3fc4739225eb13c8f5aa11406`
- Tree: `8ab4b1cd0fd2f91d038ff117b757c0aa0e773705`
- Stable patch ID: `0944365d5dcbf37f15d855f2973149c3316ef08c`
- Full-index binary patch: 144,432 bytes,
  `sha256:a36d58240f1786190af8ded6a21df3a3a5a8c9da7741176143e058015cacd995`
- Exact 20-path status census: `scripts/perf-build-source-trust-spike.mjs` constant
  `BUILD_SOURCE_TRUST_CANDIDATE`.

The sealed commit is one direct child of the clean pre-change baseline. Its tree is byte-identical
to the independently reviewed development candidate at `b2f18ab18`; the multi-commit history is
not part of the timed identity. The runner reproduces the direct-child topology, full-index patch,
patch ID, byte length, tree, and complete path/status census before preparation.

Independent repair review passed query/mutation/task root parity, existing endpoint/fake-app
coverage, ambiguous-alias refusal, parse/compile exception cleanup, data-only handoff, generated
posture/pack/certificate convergence, and the SPEC §5.2 source/deployment proof boundary. The
repair keeps KV424 fail closed; it restores the missing roots by running initial model parsing and
compilation under the same exact per-entry app-contract resolver while retaining one immutable
shared SourceFile/project.

## Attempt 1 disposition

The first local N=24 run stopped after its first baseline/candidate pair and is **unproven**, not a
timing rejection. Its retained aggregate is
`/private/tmp/kovo-build-compiler-facts-n24-n7diAF/report.json` (SHA-256
`abbd0c047ac31a451be3f9a3b962671f19a7d560185e7e7f25aadc60ca7bb5d5`). Baseline cell 0 was
complete. Candidate cell 1 failed closed with KV424 at generated `src/kovo.ts:11`: the
`query:load` opaque-source sink expected one exact semantic root and found zero. The raw candidate
report is SHA-256 `261c095bafc19700919668d2cb4ef4103a5102058a1acbe314672c2df9dbf847`;
its bounded failure envelope is
`ed06f3bb05ab26cff694eea41e77f6c6d8bf1e48edc0279628b283f643b5b2de`.

Only two of the required 20 cells ran, so the displayed one-pair wall/RSS deltas are inadmissible.
The harness correctly reported 18 misses and refused artifact, diagnostic, phase, and acceptance
claims. No N=216 run started. A repaired implementation requires a new independently reviewed
direct-child seal and candidate binding committed before any fresh timing; this report will not be
topped up, relabeled, or combined with later samples.

The superseded seal remains available at
`refs/heads/perf-spike/build-compiler-facts-sealed-20260822` (`c81817ac8`) solely to authenticate
attempt 1. It is not the candidate for the fresh run.

## Attempt 2 disposition

The repaired seal completed the exact 20-cell N=24 schedule on the same quiet Apple M4 host. The
retained report is
`/private/tmp/kovo-build-compiler-facts-v2-n24-GdBUEO/report.json` (SHA-256
`95d9dc6f96395a0f1b4014f62aa528ae15eff30cad8e839eff4cf6be1d622ee4`); its 20 raw reports have
sorted-digest aggregate
`bf0621ccdd426b1cc56437cec734129fbbeb18c9884e9da84064fef046ed28c7`.

The run is **unproven**, not accepted or relabeled as a clean timing rejection. Every lane was
internally stable, but the cross-lane exactness gate found different build-graph diagnostics and
different 13,954,081-byte output trees: baseline artifact digest
`sha256:a4653684012d07679e2d452f69a831fc49a6c4ab820013f7f22274cbb1928daa`, candidate
`sha256:baecc3b862c90ae0486b89118cafe7942647edf4127b85583e12067f04abbcb5`. Seven exact paths differed:
the certificate policy, certificate, escape census, escape obligations, graph, and the two copies
of the emitted server handler. The harness therefore refused correctness and artifact claims.

The disclosed timing also cannot meet the preregistered floor: wall medians were 32,340.83 ms and
32,202.79 ms, only 0.4268% faster, with paired baseline-minus-candidate 95% CI
`[-1.59, 268.81]` ms. Wall p95 improved 0.7498%; peak-RSS median/p95 improved 0.4719%/0.2846%.
Because N=24 can no longer satisfy the required ≥10% win and positive CI, N=216 did not start and
cannot rescue this candidate. Attempt 2 will not be rerun, topped up, or combined with later work.

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
