# Baseline publication custody: 2026-08-21

Status: **complete evidence set, blocked verdict**. This is the reviewed publication derivation for
source `01b2c759468f41a3fc4739225eb13c8f5aa11406`, not authorization to publish comparative claims.
The committed 23-file output is in
[`reports/performance-publication-2026-08-21/`](../../reports/performance-publication-2026-08-21/).

## Fixed campaign boundary

- The campaign was fixed before measurement at 24 pulses, bounded by workflow runs
  `32446745655` and `32447270730`. It produced 14 successful and 10 failed workflow runs. There
  were no top-ups, replacement pulses, reruns, or metric-informed dispatches.
- The measured checkout was clean at source `01b2c759468f41a3fc4739225eb13c8f5aa11406`, tree
  `dc738e259fe265fe3be0ad6264b7253aada68585`. The collector used commit
  `d8a8dc492fde4c4828ad5f752bb1e2de2b1dd579`, tree
  `222fbeb1c826451a603cf16eba653e613b932aa5`.
- The one-shot coordinator was 74,836 bytes with SHA-256
  `a3b209c72e7c590479d25442fe44745637d004f2efac57039448634b70d6b1a0`. Its command,
  environment, broker closure, prior-attempt custody, and permitted-mutation boundary were sealed
  before collection.
- Collection ran from `2026-08-21T20:09:46.220Z` through
  `2026-08-21T20:47:42.999Z`, exited 0, and produced empty stderr. It fetched 179 artifact
  archives. The retry audit reconciled 179 route starts, 179 delegated finals, 179 route finals,
  and zero metadata or artifact retries.

## Salvaged sealed collection

The collector finished and sealed `collection.provisional`, but the coordinator's sole permitted
post-collection mutation—the final same-filesystem rename—failed at
`2026-08-21T20:47:49.143Z` with `EACCES`. The destination remained absent. Nothing retried,
renamed, copied, or rewrote that custody tree afterward.

The read-only provisional directory was therefore retained explicitly as a salvaged sealed
collection, not represented as the missing final rename. Independent inventory verification found
exactly 410 directories, 945 regular files, no aliases, and 337,771,120 file bytes. The audit
inventory was 437,106 bytes with SHA-256
`329e92176f7d6bb05fd946bdb9cced6314c36349e59796b6b5e36a154458d6aa`; the sealed output
inventory was 266,966 bytes with SHA-256
`dd4b724bf4204ae090c0b97ca47ad07a0e8344f1e96a1af85f4c10b35e33d219`.
Raw archives and API responses remain in external custody and are intentionally not committed.

## Manifest and derivation

- The one-shot collector produced a `kovo-performance-publication-input/v7` manifest with SHA-256
  `b86b41165911bdf7950f61185c34ff9fa696af1042f647aa268ab6c16d79c5bb`. It retains every
  admitted candidate, failed-producer exclusion, fixed pulse, selected five-run baseline, and
  independent sixth-run holdout for all seven families, plus the Production-bytes sidecar.
- The publication gate used commit `3a6ad4ae07f12bd6cc8b091b857e170c4ffa26ab`, tree
  `99e504b9ed3fa0df666acf848e215b9b2795b878`. The difference from the collection tool is the
  reviewed evidence-shape repair that requires response-dependent navigation phases only in the
  matched lanes where they are observable; it does not change samples, cohort selection, values,
  or thresholds.
- Live authentication completed all source, workflow, job, artifact, report, and byte-sidecar
  checks before creating output. The gate exited 1 with schema
  `kovo-performance-publication/v9`, verdict `blocked`, no unproven reasons, 192 literal failures,
  and aggregate semantic digest
  `sha256:ae401c5f890a55ddaa4ea7304fcbfedbed78e3006973367bc5873d7b233ae12b`.

## Committed output verification

The output contains exactly two directories and 23 single-link regular files: aggregate JSON and
Markdown plus baseline, budget, and holdout-evaluation JSON for each of seven families. There are
no symlinks, alternate names, nested extras, or missing documents. Independent readback verified:

- all 21 evidence byte digests, semantic digests, and schemas against their aggregate references;
- aggregate canonical digest recomputation;
- aggregate JSON SHA-256
  `92d1e85ba20f69ea495a73cf89fddc9dd20ada592600f6d5a6eaed7734533615`; and
- aggregate Markdown SHA-256
  `d51c4e6d73e74ac1aca1199b5b229f940623dd66bdca7e932b7b78359d9579b9`.

Production bytes and the check family pass. The browser completion targets pass, including matched
L1 navigation at no more than 2x Next; its holdout still fails the preregistered all-metric point
census. The substantive completion misses are developer recovery p95 above 2 seconds and
production build wall/RSS above 6x/2x Next at both corpus sizes. Server competitive misses remain
follow-on, although its all-metric holdout census also blocks this derivation.

This campaign is not reinterpreted under a later policy. Any statistically revised holdout policy
must be committed prospectively with a new policy/source identity, then evaluated only by a fresh,
disjoint, fixed campaign after the accepted performance changes.
