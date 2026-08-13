# Kovo vs Next.js performance spike — 2026-08-13

This is exploratory evidence for `plans/good-perf.md`, not a publication baseline. Framework
behaviour remains governed by `SPEC.md`, especially §1.1 goal 3, §4.4, §5.2, §8, §9.5, and
§11.4. The measured tree was `c661a9ff5`; it was dirty only for the pre-existing `.DS_Store`
changes and Next's generated quote-format change in `next-env.d.ts`. Lock digests are recorded in
the raw browser report below.

## What the current default benchmark says

The default commerce entrants are not capability-matched. Kovo uses an inert L0 native popover
whose confirmation is already in the HTML; Next.js uses hydrated cart, email, and order state.
These figures describe the frameworks as the fixtures currently ship, not equivalent applications.

Three browser iterations per condition and three Lighthouse runs per cell, production posture,
Chromium 148, load average 2.23/2.79/2.86 at completion:

| Metric                      |   Kovo 0.3.0 |     Next.js 16.2.9 | Reading                                             |
| --------------------------- | -----------: | -----------------: | --------------------------------------------------- |
| Desktop cold-session bytes  |      8,186 B |          203,039 B | Kovo 24.8x smaller                                  |
| Mobile cold-session bytes   |      8,190 B |          175,266 B | Kovo 21.4x smaller                                  |
| JavaScript bytes            |          0 B |          152,515 B | Expected from unequal L0/L1 fixtures                |
| Mobile FCP/LCP              |   388/388 ms |         400/400 ms | Approximately tied                                  |
| Mobile navigation to paint  |       535 ms |             100 ms | Kovo 5.34x slower; it replaced the document 3/3     |
| Mobile cart-readiness proxy |       211 ms |           1,219 ms | Not comparable until the cart is capability-matched |
| Lighthouse mobile `/` LCP   |       770 ms |           2,154 ms | Kovo 2.80x faster on the default fixtures           |
| bfcache                     | 3/3 restored | n/a, same-document | Both behaved correctly for their navigation model   |

The navigation instrument favours document replacement, so the 5.34x mobile Kovo loss is, if
anything, conservative. Small desktop navigation differences are not reportable with this probe.

The current-head Kovo-only interactive workload remains within every deterministic byte budget:
6,383 B critical path, 5,747 B document, 1,101 B document-parts response, and 4,824 B gzip / 22,820 B
identity bootstrap (`node scripts/perf-gate.mjs --suite bytes --components 24`).

## Build and developer spikes

Back-to-back warm-ish production builds of the current default fixtures:

| Metric           |     Kovo | Next.js |             Ratio |
| ---------------- | -------: | ------: | ----------------: |
| Build wall       |  30.87 s |  3.22 s | Kovo 9.59x slower |
| Peak process RSS | 1,754 MB |  617 MB | Kovo 2.84x higher |

This is an as-shipped comparison, not yet the required 10-sample equal-shape matrix. Next printed
843 ms compile, 756 ms TypeScript, and 206 ms static generation; Kovo needs its phase census carried
into the paired report before attribution.

The developer spike `04a976394` routes fresh HMR generations through the trusted dev-only profile
instead of the broad build/static-export barrel. Its deterministic bundle proxy removes 25/177
modules and 788,308/2,034,129 emitted bytes (38.8%). Four serialized 7-edit sessions all landed
7/7, but their medians followed host load rather than the patch: main 665 ms at load 4.26 and
525 ms at 3.28; spike 473 ms at 3.60 and 626 ms at 4.63. The wall-clock effect is unresolved, so
the spike is not integrated.

The production spike found the warm document cache still Brotli-compresses the same proved public
document on every response. Caching compressed bytes is plausible but must be keyed by a
module-private proved-document witness, build token, body digest, and encoding—not a forgeable
public ETag. No unsafe patch was produced.

## Raw evidence

- Browser report: `/tmp/kovo-next-20260813/report.md`
- Browser JSON: `/tmp/kovo-next-20260813/results.json`
- Interactive bytes: `/tmp/kovo-perf-bytes-20260813.json`
- Dev controls: `/tmp/kovo-dev-edit-main-{a,b}-20260813.json`
- Dev spike: `/tmp/kovo-dev-edit-narrow-04a976394.json` and
  `/tmp/kovo-dev-edit-narrow-b-04a976394.json`

The `/tmp` artifacts are session-local. The concise measurements and provenance needed to plan the
next work are retained here; a publishable baseline must be produced from a clean committed tree.
