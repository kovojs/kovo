# Development query-identity spike

Status: **rejected; do not integrate `e52ddaf84` through `64abadb44`.** The candidate met the
syntax-error/recovery milestone and every causal edit requirement at N=24 and N=216, but N=216
fresh-ready p95 regressed 6.92% against the plan's 5% limit. This is a complete rejection, not a
request to repeat the same candidate.

## Candidate custody and correctness

The authenticated development profiles in `docs/performance/dev-edit-profile.md` attributed the
largest recovery cost to query-runtime identity resolution (75% at N=24 and 68% at N=216). The
candidate replaced a complete TypeScript `Program` for the common direct-import/app-query shape
with fresh, fail-closed analysis. It does not retain query identities across generations.

The exact clean baseline is `01b2c759468f41a3fc4739225eb13c8f5aa11406` (tree
`dc738e259fe265fe3be0ad6264b7253aada68585`). The pushed durable ref
`refs/heads/perf-spike/dev-query-mode-safe-20260821` identifies this exact linear series:

1. `e52ddaf846b8729abcc2d9887ff648429407f86c`, tree
   `09bc74a747ddd309a407dede73a13eba5340e01c`: production optimization.
2. `53eef7c028089c6ef8be33594a4626a849c957ca`, tree
   `08d5f1874f9533eb1f5ba1b52bbeec49796e16ae`: fail-closed resolution/freshness tests.
3. `64abadb44c02d9414ddc684684c67ab1a921fbea`, tree
   `fcacdc88f1bab2375c7fa46c768489dfc9a7b16d`: renamed-import identity coverage.

The v7 benchmark binding authenticates the two-path census, each commit boundary, tree and blob
IDs, stable patch ID `d83573b16a2d720679da6803b51a0a856f742092`, and canonical candidate-delta digest
`sha256:84f38d677e176183fc84a7adadc89305513ec20f3b2a396ce4a4315f401fdb1e`.

Independent review approved the production logic and final test shape before timing. The direct
path admits only one exact named import whose resolved provider is confined to the project, parse
clean, and contains one direct compiler-proved `app.query` declaration at the expected source span.
Current/default, ES import, and CommonJS require resolution must agree on every public identity
field plus TypeScript's runtime-only `alternateResult`, `originalPath`, and package peer identity.
Missing, malformed, accessor-backed, conditional, outside-root, barrel, or otherwise ambiguous
state executes the complete `Program` path. Tests cover conditional exports, `.mts`/`.cts`,
same-mtime package-type changes, extensionless NodeNext fallback, in/out-root final symlinks,
renamed imports, barrels, config changes, and provider-byte changes. This preserves SPEC §4.1,
§5.2, and §11.4's fresh-source and fail-closed boundaries.

## Measurement

Committed harness checkpoint `b0f7e24bd` binds the exact series under
`kovo-dev-generation-candidate-binding/v7`. On an Apple M4, 10 logical CPUs, 16 GiB RAM, macOS
25.2.0, and Node 24.19.0, it prepared separate frozen packed products and isolated matched corpora,
then ran one process tree at a time in exact `baseline, spike, spike, baseline` order. Each corpus
contains 15 fresh-ready samples, 30 measured edits per lane and edit class after three warmups,
10,000 paired-bootstrap iterations, and pre-preparation/pre-block quiet-host admission. All four
raw cells authenticated in both reports; source, lockfiles, products, tooling, corpus, and host
remained stable.

| Metric | N=24 baseline → candidate | N=216 baseline → candidate |
| --- | ---: | ---: |
| Leaf median | 1,032.24 → 498.64 ms (+51.69%) | 1,043.35 → 542.40 ms (+48.01%) |
| Leaf paired 95% CI | +494.33 to +550.54 ms | +469.27 to +550.09 ms |
| Entry median | 1,015.78 → 499.45 ms (+50.83%) | 1,015.87 → 499.07 ms (+50.87%) |
| Entry paired 95% CI | +498.67 to +530.45 ms | +500.44 to +567.15 ms |
| Data median | 1,031.66 → 499.35 ms (+51.60%) | 1,015.74 → 522.20 ms (+48.59%) |
| Data paired 95% CI | +483.01 to +534.03 ms | +460.08 to +549.92 ms |
| Recovery median | 945.02 → 399.50 ms (+57.73%) | 999.31 → 482.69 ms (+51.70%) |
| Recovery paired 95% CI | +517.77 to +549.46 ms | +499.96 to +532.90 ms |
| Recovery p95 | 964.72 → 416.08 ms | 1,032.79 → 515.89 ms |
| Syntax-error p95 | 219.62 → 215.35 ms | 215.78 → 219.45 ms |
| Fresh-ready median | 10,709.10 → 9,812.24 ms (+8.37%) | 28,306.43 → 27,426.82 ms (+3.11%) |
| Fresh-ready p95 | 14,616.10 → 14,339.55 ms (+1.89%) | 30,680.27 → 32,802.59 ms (**−6.92%**) |
| Ready peak-RSS p95 | 2,518,581,248 → 2,568,634,368 B (−1.99%) | 3,049,078,784 → 3,064,807,424 B (−0.52%) |
| Edit peak-RSS p95 | 2,854,993,920 → 2,578,284,544 B (+9.69%) | 3,371,728,896 → 3,377,315,840 B (−0.17%) |

Both reports have zero adapter errors, request failures, unexpected browser errors, missed
revisions, or state losses; all 300 edit-state observations per report survived, and all 60 expected
syntax diagnostics appeared. N=24 is an individual accept. N=216 is a complete reject solely
because fresh-ready p95 exceeds the 5% regression guardrail; the implementation therefore cannot
be integrated under `plans/good-perf.md`.

An independent read-only audit re-read every raw file, proved byte-number equality with its embedded
cell, recomputed all summaries, bootstrap intervals, and predicates, and replayed the live Git
binding. Its result was an unconditional **valid complete rejection**, with no unproven evidence.

## Retained raw evidence

Raw reports remain outside the repository under the locked local custody roots named below. Their
SHA-256 values make any later relocation or archival verifiable.

| Evidence | SHA-256 |
| --- | --- |
| N=24 aggregate `/private/tmp/kovo-dev-query-n24-8b390E/report.json` | `81a6c24e826a923edde107ab9a4b411f956988226f7a6ded9edca5a46f35a07b` |
| N=24 raw `0-baseline.json` | `488e046414fd4ee978a91aa0d14124208a314d25ff229b85703de21b9d35d91b` |
| N=24 raw `1-spike.json` | `c34a29086f69bea8c6ff7d1c9e3b24876ed75b67a32484f2969b3a1b72e55f0d` |
| N=24 raw `2-spike.json` | `6eecc2d6d8509b6431c37b598700ab6a78e522c469514c8d2e338c77e7815654` |
| N=24 raw `3-baseline.json` | `89ea33050e2866df0fb94fddc28b47d119f1c2280f603584cb0c0fe52a7ced81` |
| N=216 aggregate `/private/tmp/kovo-dev-query-n216-PRZFOT/report.json` | `6870f73ea45d580470fe662858dc8fdde0c5a4a8e1d011e84dafa94b4395c753` |
| N=216 raw `0-baseline.json` | `0f06bdfdfd30e67011ef308e358e56d5808f98fc2ff1ed4a62314916fce00934` |
| N=216 raw `1-spike.json` | `c08aec1c535defe615a355687b96f2009e2409c6a73eca2f184a89c8c744d40e` |
| N=216 raw `2-spike.json` | `46b9729938dab52f3f4a56b82c3fe9e1cf4cbbc793d1b6d27417d402cec06560` |
| N=216 raw `3-baseline.json` | `7862393e8635b37a63d5306f6a5ee2bde2aede2822dedf05cffa56c4cec3ff44` |

The first candidate ready sample at N=216 was 32,802.59 ms while the other 14 candidate samples
were 27,276.38–27,822.25 ms. The corresponding first baseline sample was also its maximum at
30,680.27 ms. That shape is useful diagnostic evidence, but the preregistered p95 rule includes
those fresh samples. It cannot be discarded or reinterpreted after measurement. Any follow-up must
be a distinct implementation with its own exact binding and complete N=24/N=216 decision.
