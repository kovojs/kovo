# Speculation Rules repair and decision

The safe compiler repair is eligible to integrate. The performance counterfactual is not.
`spec/07-navigation.md` therefore remains unchanged: Speculation Rules are explicit opt-in and
default off.

## Historical candidate authentication

The historical candidate still exists as `refs/heads/perf/speculation-rules` at
`c478c52e46b1b8977a25c5740c5744f4e8afab2c` (parent
`a1f916a765aa75785fabea495aa69343797f9017`, tree
`f5845a4199a2e672cfa6a10d554100aae0207bbd`). Its stable patch ID is
`e16f3bbd5e9df1078cd67c3965de8858b5e3aca3`. The branch reflog records that commit at
2026-08-08 06:32:32 -0700. The historical throwaway worktree is no longer registered.

The only surviving performance record is the commit message. It says two interleaved seven-sample
mobile passes measured 362/364 ms with rules stripped and 198/196 ms with rules emitted, plus 246
identity bytes and 170 Brotli bytes. Those figures are not authenticated decision evidence:

- the commit labels them indicative and records load 7.8/23.4/29.8;
- the commit tree contains no raw sample report, CPU profile, or benchmark driver for that A/B;
- a repository/worktree search found no separate raw report or registered originating worktree; and
- it lacks the current paired interval, correctness, resource, source, and host fields.

The rejection record is authenticated independently at
`1699f34f053c6da1670254e2caebec45ca05f245` (parent
`9f5b02fb18f1c9eadd9f148e54fddeeac62e26f5`, tree
`76375fae17021eaa87e84fefb2039b44410ec445`). It reproduces three material defects:

1. `/user/:id/posts` was lowered to `/user/*/posts`, then rejected by the runtime pattern floor at
   top-level minting, crashing build/startup.
2. `page: someIdentifier` and shorthand `page` were treated as side-effect-free without following
   an async/I/O body.
3. route-table completeness was name-based and failed under reassignment and inner-scope shadowing.

The historical branch also changes the default and authored documentation. That directly conflicts
with current SPEC §8 and `spec/07-navigation.md`; rebasing or merging it is not a viable repair.

## Integrable repair

Branch `agent/speculation-repair-decision-20260813`, commit
`01f4efc24e3d3417311e77febac6963c60c18f3a`, is based directly on integration object
`af567b131f459261ce29559c31e78a1bfcb4dd8e`. Its stable patch ID is
`6108705f2dbcca7286af08538c4e2196e97729a1`. It changes only:

- `packages/compiler/src/scan/route-pages.ts`; and
- `packages/compiler/src/route-pages.test.ts`.

The repair does not import the historical route-table/pattern machinery and does not emit rules for
ordinary routes. It adds a typed-AST, fail-closed KV419 check only when an author explicitly writes
`prefetch: 'moderate'` (or an unresolved posture that might be moderate). Without the named SPEC §8
justification, the compiler now requires a public, unguarded, locally inspectable synchronous
page/meta/region/layout chain with no visible call, await, construction, mutation, query, spread,
ambiguous member, indirect body, mutable layout binding, or unresolved parent. Route access takes
precedence over inherited layout access. A bounded non-empty literal `prefetchJustification` remains
the normative audit hatch.

The C13-superset corpus covers the historical indirect async and shorthand page cases, inline await
and helper calls, indirect metadata, route and layout spreads, inline layout guards, session access
overriding a public layout, mutable/non-final layout and page bindings, and a non-final dynamic route
path. The last case compiles because the repaired design does not mint a compiler-derived path
pattern for the runtime to reject. A default-off indirect async route also proves that no new default
was introduced.

Verification on the repair commit:

```text
vp check packages/compiler/src/scan/route-pages.ts packages/compiler/src/route-pages.test.ts
  PASS
vp exec vitest --run packages/compiler/src/route-pages.test.ts --reporter=dot
  PASS, 36/36
```

`pnpm run check:security-classifier-corpus` reached 4,140 passing tests in its first 141-file batch,
then failed on five unrelated integration-base failures. A detached clean worktree at the exact
parent `af567b131` reproduced the same five failures with the four focused files: three stale
browser/CLI/server posture-digest failures routed through KV448, one framework-posture gate failure,
and the existing `no-store` versus `private, no-store` assertion. The route-page corpus is green;
the full gate is not represented as passing.

## Current matched-L1 counterfactual

The measurement arms are separate throwaway worktrees and must not be integrated:

| Arm               | Worktree                                                  | Clean committed head                       |
| ----------------- | --------------------------------------------------------- | ------------------------------------------ |
| Default off       | `/Users/mini/kovo-spike-speculation-default-off-20260813` | `e666ee49ee017b4bc6b9a1dee4b27123e0c20c4f` |
| Explicit moderate | `/Users/mini/kovo-spike-speculation-opt-in-20260813`      | `55bdd900900606255654399d341fe912f2891d69` |

Both descend from `af567b131`, contain the same repair and sanctioned generated-posture reseal, use
the same frozen locks, and pass `node benchmarks/matched-fixture-gate.mjs`. Their complete source
diff is six added lines in `benchmarks/kovo/src/app.tsx`: `prefetch: 'moderate'` plus the same named
read-only benchmark justification on the matched-L1 listing and detail routes. The binary diff
SHA-256 is `111dab70a942ec961d2c41319c52cbe42f04d2e5c3f09786e1004798ccb38a4e`;
no framework, security posture, lock, or harness file differs.

The serialized order was baseline, spike, spike, baseline. Each occurrence used two warmups and
seven recorded samples for both desktop and emulated mobile:

```text
node benchmarks/run-all.mjs --apps kovo --lane matched-l1 --iterations 7 --warmups 2 \
  --skip-lighthouse --bfcache-iterations 1 --skip-build --out-dir <arm-directory>
```

All four reports identify clean source, the expected arm SHA, Node 24.19.0, Kovo 0.3.0, arm64,
10 CPUs, 16 GiB RAM, and identical lock digests. Chromium was 148.0.7778.96. End-of-run one-minute
loads were 2.71, 1.78, 2.54, and 2.45, all below 1.0 per core. One earlier baseline pass that ended
at load 13.30 was discarded before analysis and retained only as `invalid-B1-load13.30`.

### Click-to-paint decision metric

Positive paired differences mean baseline minus candidate, so positive is an improvement. The
confidence intervals use 100,000 deterministic paired-bootstrap resamples.

| Condition | Default off median / MAD / p95 | Moderate median / MAD / p95  | Median change | Paired median and 95% CI      | n/arm |
| --------- | ------------------------------ | ---------------------------- | ------------: | ----------------------------- | ----: |
| Desktop   | 56.581 / 1.075 / 59.957 ms     | 55.727 / 1.310 / 60.351 ms   |        +1.51% | -0.351 ms, [-2.416, 1.513]    |    14 |
| Mobile    | 204.519 / 1.168 / 224.384 ms   | 220.074 / 2.752 / 224.401 ms |        -7.61% | -13.306 ms, [-17.984, -2.798] |    14 |

The desktop result is below the plan's 10% threshold and its interval crosses zero. Mobile is a
statistically supported regression. The candidate therefore fails the primary acceptance rule.

### Causal transport and correctness evidence

| Condition | Default nav bytes / requests (median) | Moderate nav bytes / requests (median) | Transport-proven prefetches                   |
| --------- | ------------------------------------- | -------------------------------------- | --------------------------------------------- |
| Desktop   | 2,730 B / 2                           | 10,185 B / 3                           | default 0/14; candidate 8/14, 7,249 B median  |
| Mobile    | 2,743 B / 2                           | 10,198 B / 3                           | default 0/14; candidate 13/14, 7,262 B median |

The harness classifies automatic prefetch only from transport headers such as `Sec-Purpose`, not
from timing. Every measured primary navigation response was HTTP 200
`application/vnd.kovo.document-parts+json`. Across all 56 condition/arm samples there were zero page
errors, failed requests, error responses, rate limits, settle timeouts, or document replacements.
The fixture gate additionally proved matched rendered content, cart state, and enhanced navigation.

A direct production response audit found the current rule adds 183 identity bytes and 107 Brotli
bytes to the listing document. Removing the single `type="speculationrules"` element made the two
identity documents byte-identical at SHA-256
`bb46b200301c01e36ee8e934a4fcb9fc376b62fec4a23e1a1265720cc6776866`.

The likely explanation is architectural: current matched L1 uses enhanced navigation and fetches a
document-parts representation on click, while browser Speculation Rules prefetch a document before
the click. The reports show the click request still occurs, so the speculative transfer adds work
instead of replacing the measured critical-path request. This is an inference from the authenticated
transport records, not a claim about every browser/workload.

The current browser harness does not record per-sample process-tree CPU or peak RSS, nor pre-run load
inside each report. Under the plan those missing fields would prevent accepting a candidate even if
latency passed. They do not weaken this rejection: the candidate already misses the 10% threshold,
has a desktop interval crossing zero, and has a significant mobile regression.

## Raw report custody and decision

The four raw reports remain outside the active plan at
`/tmp/kovo-speculation-bsbs-20260813/{B1,S1,S2,B2}/results.json`:

| Occurrence | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| B1         | `403306925dd616a14b40fc659beea5543f35b609190d7167bf2b5d1ee4350642` |
| S1         | `d69747b8abaff2cf4802051bf878a89a2e20ba1bcf19e479786e563275de9d6d` |
| S2         | `f205b034adee3214ee7ef75534f2d85bbe5d69e1d2ccdb7af0dfadc72e2d241e` |
| B2         | `774856ded9f4c0b9759d8f3156ed1779a4b194df222e23d8e4be1e420b6a07f0` |

Decision: integrate the compiler safety commit, reject both benchmark-arm branches, retain explicit
opt-in for reviewed applications, and keep framework default-off. Do not revive the historical
auto-emission route-table proof.
