# Profile-driven development critical-path spike

This is the preregistered decision contract for the candidate selected from the authenticated
development edit profiles. It supersedes the rejected fresh-generation v1 comparison; a v1 outer
report, preparation report, retained-failure envelope, candidate binding, or acceptance rule is not
valid input to this decision.

## Causal basis

The candidate is limited to the two costs established by the clean N=24 and N=216 profile census in
[`dev-edit-profile.md`](./dev-edit-profile.md):

- Whole-project asynchronous proof convergence starts before HMR has published its outcome and
  competes with the leaf, entry, and data edit-to-paint critical path.
- Recovery repeatedly builds a TypeScript program to recover the same component query runtime
  identity. Reuse is permitted only for an exact plugin-scoped binding preimage; dependency,
  configuration, or other-file uncertainty must take the full fail-closed resolver path (SPEC
  §4.1, §5.2, and §9.5).

The causal source is hosted run
[`31799441158`](https://github.com/kovojs/kovo/actions/runs/31799441158) at exact clean commit
`89b39c999de6a7c60f3091831916ddb2c4c5037c`. Its authenticated N=24 and N=216 profile-set digests
are respectively `4cc4185287ed571de6b05a0a3b12bf2848b14b48b3c31eb671c2357f57b3c052` and
`6f51369cd21add66e25ed8388d78fdb1d897c978ee09a28f6e62096f6f2d5768`; the linked profile report
owns the raw artifact custody and replay digests.

Syntax-error handling had neither hotspot. It is a correctness, regression, and absolute-latency
guardrail, not a metric from which the candidate may claim a causal win.

## Candidate binding

The durable candidate ref is
`refs/heads/perf-spike/dev-critical-path-profile-20260814`. The adversarially reviewed production
commit is bound as:

- commit: `336925d40e11024b54206908997dbdfe0f43a391`
- parent: `eb16f11734a2ab635a8207f2e6ece4612713f248`
- tree: `a0fe15cde24918aad0ce69a759441586bfd1663b`
- stable patch ID: `5e5fb7c71081a556bf8c83824ab3858637714547`
- 108,321-byte raw binary/full-index patch SHA-256:
  `sha256:766a13947b40a065b67013ae4b357c24b036bfb2a0f373cb5f9b93658989b913`
- changed paths, all simple modifications:
  `packages/compiler/src/query-runtime-identities.test.ts`,
  `packages/compiler/src/scan/query-runtime-identities.ts`,
  `packages/compiler/src/vite.test.ts`, `packages/compiler/src/vite.ts`,
  `packages/server/src/vite-data-plane-gate.test.ts`, and `packages/server/src/vite.ts`.

The baseline and spike are separate clean committed worktrees. The spike must be exactly one commit
above the selected baseline. Its raw binary patch bytes, stable patch ID, and simple-modification
path census must exactly match the durable candidate commit. This allows a measurement source that
contains newer unrelated harness or documentation changes while preventing any unrelated path from
entering the timed candidate. A conflict-resolved cherry-pick is a different candidate and must not
be measured under this binding.

## Serialized measurement

Run N=24 and N=216 as independent decisions on a quiet host. Each corpus uses one process at a time
in exact `baseline, spike, spike, baseline` order. Per lane, split 30 measured edits of every class,
15 fresh-ready samples, and three warmups across the two occurrences. The two blocks receive 15/15
edits, 8/7 ready samples, and 2/1 warmups. Host admission occurs before preparation and each timed
block; a process-wide timing lock covers all four blocks. The full command is:

```sh
vp exec node scripts/perf-dev-generation-spike.mjs \
  --baseline-root ../kovo-dev-critical-path-baseline \
  --spike-root ../kovo-dev-critical-path-candidate \
  --size 24 \
  --ready-samples 15 \
  --ready-timeout-ms 600000 \
  --edit-samples 30 \
  --warmups 3 \
  --timeout-ms 3600000 \
  --measure \
  --out /tmp/kovo-dev-critical-path-n24/report.json
```

Repeat with `--size 216` and a distinct output directory. `--quick-smoke` verifies only transport,
lifecycle, and report shape; v2 marks it `unproven` because it does not meet the decision sample
policy.

When `--out` is present, every child adapter report remains under the adjacent `raw/` directory.
Failed children retain bounded process status, report availability, byte count, SHA-256, schema,
verdict, and diagnostics. The outer report embeds every successful child report and binds source,
locks, corpus shape and bytes, tool bytes, port allocation, host admission, and the exact candidate
patch. Missing or extra cells cannot disappear into aggregation.

## Preregistered v2 acceptance

N=24 and N=216 must each pass independently. The four profile-causal edit-to-paint metrics are
`leafMs`, `entryMs`, `dataMs`, and `recoveryMs`. Every one must improve by at least 10% at the
candidate median, and every paired bootstrap 95% confidence interval must have a lower bound above
zero.

The following guardrails also apply in each corpus:

- Syntax error: every sample exposes the expected diagnostic, candidate p95 is at most 1,000 ms,
  and both median and p95 regress by no more than 5%.
- Recovery: candidate p95 is at most 2,000 ms in addition to the causal win rule.
- Fresh-ready latency, ready process-tree peak RSS, and edit-session process-tree peak RSS: both
  median and p95 regress by no more than 5%.
- Every B,S,S,B cell is measured with the exact sample policy; there are zero misses, child adapter
  errors or unproven cells, unexpected browser errors, browser request failures, and state-loss
  events across every edit class.

`bundleBytes`, `emittedBytes`, and `moduleCount` are excluded from the decision. A complete,
correct, quiet-host result that misses any threshold is `reject`. Missing, malformed, short,
incorrect, load-shed, source-unstable, or candidate-mismatched evidence is `unproven` rather than a
performance loss. Acceptance requires both corpus reports to say `accept`; neither result alone
authorizes integration.

## Result

Status: **unproven**. No full authenticated N=24 and N=216 decision has run for this exact
candidate. The production branch's one-iteration correctness smokes are not statistical evidence
and cannot satisfy this contract.
