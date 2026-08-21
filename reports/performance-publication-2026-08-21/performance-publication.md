# Kovo realistic performance publication gate

Verdict: **blocked**. Source: `01b2c759468f41a3fc4739225eb13c8f5aa11406`.

A Kovo-vs-Next first-milestone publication is eligible only when all seven family gates pass. The check row is deliberately Kovo-only and does not manufacture a Next.js comparison. Competitive follow-on misses remain reported as failures, but do not masquerade as completion failures or block this first-milestone gate.

| Family | Posture | Host | Workload | Baseline completion | Baseline follow-on | Holdout completion | Holdout follow-on | Publication gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| browser | kovo-vs-next | `sha256:152275f7cd1f95ce305a472c5e19940cdd1866436a5203b9da91d3b08945217d` | `sha256:7be3e1eb449e5fd9d7d1bbaa6ae9924dcb74934b32b993dcdf42834c441a04c0` | pass | pass | pass | pass | blocked |
| dev-n24 | kovo-vs-next | `sha256:8d205d64a3d0bccd5a1615987eae0fded94694c4003ab8b57ad148f0d3ac6af7` | `sha256:6e74fcae39b3917ec54bb84b2420ef6c513031d5b6673fa5c45966b75ed012b7` | fail | fail | fail | fail | blocked |
| dev-n216 | kovo-vs-next | `sha256:8d205d64a3d0bccd5a1615987eae0fded94694c4003ab8b57ad148f0d3ac6af7` | `sha256:fe5303872421428332576d8c07dd7e38fbb132abed20f01954351be1ef890f99` | fail | fail | fail | fail | blocked |
| build-n24 | kovo-vs-next | `sha256:f1182961bbda39a54ca990b7611b5005d9891c8c154e95e9e3ca846e73816ce2` | `sha256:7131a6859d9513678ae656c371272286fe64af01223229b5aad3cf7828dff1d7` | fail | not-applicable | fail | not-applicable | blocked |
| build-n216 | kovo-vs-next | `sha256:f1182961bbda39a54ca990b7611b5005d9891c8c154e95e9e3ca846e73816ce2` | `sha256:c3ff97dfc91c82d7b78073d7b3708113524870e7f65e6c0ad470620384879c08` | fail | not-applicable | fail | not-applicable | blocked |
| server | kovo-vs-next | `sha256:f1182961bbda39a54ca990b7611b5005d9891c8c154e95e9e3ca846e73816ce2` | `sha256:e3b1f69533da28ae85f2a155c39943edf4933ed413986661a0ae78dd15100f1b` | not-applicable | fail | not-applicable | fail | blocked |
| check | kovo-only | `sha256:52d9b97e280b9f0fcd83ba5369a5eb89e75a0d6205fd7df7e8f2960f1efa0457` | `sha256:9fed31834b66d7dedbdcf66056655960dc563c06066997d25e1fcb9b68473d40` | pass | not-applicable | pass | not-applicable | pass |

## Production bytes sidecar

Outcome: **pass** at componentCount=24.

Committed budget: `perf-budgets.json` (11744 bytes, `sha256:720ce5f11488fe6a4ad42e5c2003d76ed88ba3ca46e38201c4cdb5fab7aabbcf`).

[Authenticated Production bytes artifact 9434348014](https://github.com/kovojs/kovo/actions/runs/32446745655/artifacts/9434348014)

| Metric | Observed | Maximum | Verdict |
| --- | ---: | ---: | --- |
| production.criticalPath.wireBytes | 6387 | 7000 | pass |
| production.document.wireBytes | 5751 | 6300 | pass |
| production.inlineBootstrap.gzipBytes | 4832 | 5200 | pass |
| production.inlineBootstrap.identityBytes | 22820 | 23500 | pass |
| production.navigation.wireBytes | 1090 | 1250 | pass |

## Foreground build-session decision

Outcome: **not-warranted** (both-n216-upper-residuals-below-ten-percent).

| Corpus | Mode | Wall ratio | RSS ratio | Kovo p95 (ms) | Artifact p95 (bytes) | Upper / wall | Milestone |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| N=24 | unchanged | 11.5936 | 2.1426 | 77921.5519 | 14087325 | 0.0543 | fail |
| N=24 | edit | 11.7079 | 2.1472 | 78640.0832 | 14087598 | 0.0570 | fail |
| N=216 | unchanged | 34.0770 | 2.2846 | 271057.4943 | 15454786 | 0.0206 | fail |
| N=216 | edit | 34.1568 | 2.2908 | 275435.6401 | 15455059 | 0.0213 | fail |

## Exact fixture sources

- [Kovo fixture](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/kovo)
- [Next.js fixture](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/nextjs)
- [generated corpus source](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/corpora)
- [matched fixture contract](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/shared)

## Browser comparison: explicit lanes

Default/as-shipped, matched L0, and matched L1 remain separate. Zero JavaScript is proved only for Kovo L0; Next matched L0 still ships JavaScript. Same-document and document-replacing navigation are not conflated. Matched-L1 mobile navigation at no more than 2x Next is the blocking first milestone; session bytes at no more than 50% of Next remain a separately reported follow-on target.

Each median is the median of five independent run medians. Each p95 is the median of the five within-run p95 values. The sixth run is the independent holdout and is not pooled into either baseline statistic.

The default/as-shipped lane is intentionally capability-mismatched: Kovo uses its native L0 cart while Next uses a hydrated mutable cart. Zero JavaScript applies only to Kovo L0; Next matched L0 still ships JavaScript. Matched L1 equalizes cart capability, but Kovo uses an observed document-parts response and preserves the document while Next uses an observed `text/html` document navigation and replaces it. `responseProcessingDomApply` overlaps transfer, parser, style, and layout; it is not additive and is not a decode or morph split.

Authenticated derivation inputs:

- [Derived browser budget](evidence/browser-budget.json)
- [Measured source](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406)
- [Kovo fixture](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/kovo)
- [Next.js fixture](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/nextjs)
- [generated corpus source](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/corpora)
- [matched fixture contract](https://github.com/kovojs/kovo/tree/01b2c759468f41a3fc4739225eb13c8f5aa11406/benchmarks/shared)
- [baseline 1: sha256:5a84d7d7f4086f76b13618ba5350d5aa50feb03108b6f5a06dd8b87815871680](https://github.com/kovojs/kovo/actions/runs/32446817670/artifacts/9435223007)
- [baseline 2: sha256:c0cfca6a4625de69869369189a543101cdf2abc3f47b154d750445bd64756690](https://github.com/kovojs/kovo/actions/runs/32446851107/artifacts/9435378653)
- [baseline 3: sha256:5044b4cee693cc7c21dcde8bc074c8cab53e3bc6088dfccdbd1284bc9fae97ae](https://github.com/kovojs/kovo/actions/runs/32446940258/artifacts/9437817121)
- [baseline 4: sha256:a6f972f26263350e2ac0072d2e936e0d05235ae1350437e85ecf2314fc44b87b](https://github.com/kovojs/kovo/actions/runs/32446958451/artifacts/9438025537)
- [baseline 5: sha256:4c6f55d9a4037fa3f90c1519acefe27cef4bfab8f622d54cb5067fce2d3d7b57](https://github.com/kovojs/kovo/actions/runs/32446977676/artifacts/9438974132)
- [independent holdout: sha256:c3a2ce9e080c42b7b4c9a323fea0c3b72da8d15f849e8f971319d9f2f269d20e](https://github.com/kovojs/kovo/actions/runs/32447067595/artifacts/9440978980)

### Default/as shipped

| Metric | Kovo median | Kovo p95 | Next median | Next p95 | Budget policy |
| --- | ---: | ---: | ---: | ---: | --- |
| default/browser//bfcache.applicable | 1 | 1 | 0 | 0 | informational |
| default/browser//bfcache.evidenceComplete | 1 | 1 | 1 | 1 | minimum 1 |
| default/browser//bfcache.restored | 1 | 1 | 0 | 0 | median >= 0.9500; p95 >= 0.9500 |
| default/browser//desktop.coldLoad.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//desktop.coldLoad.bytes.html | 3929 | 3958 | 6639 | 6639 | median <= 4125.4500; p95 <= 4155.9000 |
| default/browser//desktop.coldLoad.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//desktop.coldLoad.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.coldLoad.bytes.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.coldLoad.bytes.total | 8262 | 8291 | 206419 | 206419 | median <= 8675.1000; p95 <= 8705.5500 |
| default/browser//desktop.coldLoad.domContentLoadedMs | 46.9000 | 55.3000 | 19.1000 | 49.1000 | median <= 49.2450; p95 <= 58.0650 |
| default/browser//desktop.coldLoad.fcpMs | 92 | 112 | 76 | 88 | median <= 96.6000; p95 <= 117.6000 |
| default/browser//desktop.coldLoad.lcpMs | 92 | 112 | 76 | 88 | median <= 96.6000; p95 <= 117.6000 |
| default/browser//desktop.coldLoad.loadMs | 49.2000 | 56.7000 | 108.7000 | 119.8000 | median <= 51.6600; p95 <= 59.5350 |
| default/browser//desktop.coldLoad.loadWindow.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//desktop.coldLoad.loadWindow.bytes.html | 3929 | 3958 | 6639 | 6639 | median <= 4125.4500; p95 <= 4155.9000 |
| default/browser//desktop.coldLoad.loadWindow.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//desktop.coldLoad.loadWindow.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.coldLoad.loadWindow.bytes.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.coldLoad.loadWindow.bytes.total | 8262 | 8291 | 206419 | 206419 | median <= 8675.1000; p95 <= 8705.5500 |
| default/browser//desktop.coldLoad.requestStartMs | 1.1000 | 1.4000 | 1.1000 | 1.7000 | median <= 1.1550; p95 <= 1.4700 |
| default/browser//desktop.coldLoad.responseEndMs | 3.7000 | 4.4000 | 4.2000 | 6.2000 | median <= 3.8850; p95 <= 4.6200 |
| default/browser//desktop.coldLoad.serverResponseMs | 1.7000 | 2.3000 | 2.2000 | 3.8000 | median <= 1.7850; p95 <= 2.4150 |
| default/browser//desktop.coldLoad.settleMs | 675 | 690 | 723 | 747 | median <= 708.7500; p95 <= 724.5000 |
| default/browser//desktop.coldLoad.tbtMs | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.coldLoad.ttfbMs | 3 | 3.5000 | 3.5000 | 5 | median <= 3.1500; p95 <= 3.6750 |
| default/browser//desktop.navigation.bytes.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| default/browser//desktop.navigation.bytes.html | 6054 | 6096 | 6639 | 6639 | median <= 6356.7000; p95 <= 6400.8000 |
| default/browser//desktop.navigation.bytes.img | 3114 | 3114 | 2792 | 2792 | median <= 3269.7000; p95 <= 3269.7000 |
| default/browser//desktop.navigation.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.bytes.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.bytes.total | 11005 | 11047 | 206419 | 206419 | median <= 11555.2500; p95 <= 11599.3500 |
| default/browser//desktop.navigation.navAttribution.phases.layout.durationMs | 1.0230 | 1.7300 | 0.7230 | 0.7690 | median <= 1.0741; p95 <= 1.8165 |
| default/browser//desktop.navigation.navAttribution.phases.paint.durationMs | 0.7910 | 1.5900 | 0.6850 | 0.7410 | median <= 0.8306; p95 <= 1.6695 |
| default/browser//desktop.navigation.navAttribution.phases.style.durationMs | 0.5800 | 0.6520 | 0.3350 | 0.3770 | median <= 0.6090; p95 <= 0.6846 |
| default/browser//desktop.navigation.navLegacyDomPresenceMs | 42.5449 | 50.1379 | 26.0081 | 26.7749 | median <= 44.6722; p95 <= 52.6448 |
| default/browser//desktop.navigation.navToDomMs | 47.2578 | 55.7378 | 33.6580 | 35.4749 | median <= 49.6207; p95 <= 58.5247 |
| default/browser//desktop.navigation.navToPaintMs | 17.5740 | 21.1880 | 28.6250 | 29.4190 | median <= 18.4527; p95 <= 22.2474 |
| default/browser//desktop.navigation.sessionBytes.automaticPrefetch.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.automaticPrefetch.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.automaticPrefetch.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.automaticPrefetch.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.automaticPrefetch.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.automaticPrefetch.total | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.click.css | 272 | 272 | 0 | 0 | median <= 285.6000; p95 <= 285.6000 |
| default/browser//desktop.navigation.sessionBytes.click.html | 2124 | 2156 | 0 | 0 | median <= 2230.2000; p95 <= 2263.8000 |
| default/browser//desktop.navigation.sessionBytes.click.img | 346 | 346 | 0 | 0 | median <= 363.3000; p95 <= 363.3000 |
| default/browser//desktop.navigation.sessionBytes.click.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.click.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.click.total | 2742 | 2774 | 0 | 0 | median <= 2879.1000; p95 <= 2912.7000 |
| default/browser//desktop.navigation.sessionBytes.initial.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//desktop.navigation.sessionBytes.initial.html | 3932 | 3958 | 6639 | 6639 | median <= 4128.6000; p95 <= 4155.9000 |
| default/browser//desktop.navigation.sessionBytes.initial.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//desktop.navigation.sessionBytes.initial.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.initial.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.initial.total | 8263 | 8291 | 165366 | 165366 | median <= 8676.1500; p95 <= 8705.5500 |
| default/browser//desktop.navigation.sessionBytes.postClick.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.postClick.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.postClick.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.postClick.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.postClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.postClick.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.preClickBackground.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.preClickBackground.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.preClickBackground.img | 0 | 2768 | 0 | 0 | median <= 0; p95 <= 2906.4000 |
| default/browser//desktop.navigation.sessionBytes.preClickBackground.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.preClickBackground.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.preClickBackground.total | 0 | 2768 | 0 | 0 | median <= 0; p95 <= 2906.4000 |
| default/browser//desktop.navigation.sessionBytes.settledSession.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| default/browser//desktop.navigation.sessionBytes.settledSession.html | 6054 | 6096 | 6639 | 6639 | median <= 6356.7000; p95 <= 6400.8000 |
| default/browser//desktop.navigation.sessionBytes.settledSession.img | 3114 | 3114 | 2792 | 2792 | median <= 3269.7000; p95 <= 3269.7000 |
| default/browser//desktop.navigation.sessionBytes.settledSession.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.settledSession.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.settledSession.total | 11005 | 11047 | 206419 | 206419 | median <= 11555.2500; p95 <= 11599.3500 |
| default/browser//desktop.navigation.sessionBytes.throughClick.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//desktop.navigation.sessionBytes.throughClick.html | 3932 | 3958 | 6639 | 6639 | median <= 4128.6000; p95 <= 4155.9000 |
| default/browser//desktop.navigation.sessionBytes.throughClick.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//desktop.navigation.sessionBytes.throughClick.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.throughClick.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.throughClick.total | 8265 | 8291 | 206419 | 206419 | median <= 8678.2500; p95 <= 8705.5500 |
| default/browser//desktop.navigation.sessionBytes.throughDestinationPaint.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| default/browser//desktop.navigation.sessionBytes.throughDestinationPaint.html | 6054 | 6096 | 6639 | 6639 | median <= 6356.7000; p95 <= 6400.8000 |
| default/browser//desktop.navigation.sessionBytes.throughDestinationPaint.img | 3114 | 3114 | 2792 | 2792 | median <= 3269.7000; p95 <= 3269.7000 |
| default/browser//desktop.navigation.sessionBytes.throughDestinationPaint.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.throughDestinationPaint.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.navigation.sessionBytes.throughDestinationPaint.total | 11005 | 11047 | 206419 | 206419 | median <= 11555.2500; p95 <= 11599.3500 |
| default/browser//desktop.ttiProbe.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//desktop.ttiProbe.bytes.html | 3929 | 3957 | 6639 | 6639 | median <= 4125.4500; p95 <= 4154.8500 |
| default/browser//desktop.ttiProbe.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//desktop.ttiProbe.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//desktop.ttiProbe.bytes.other | 0 | 0 | 41055 | 41055 | median <= 0; p95 <= 0 |
| default/browser//desktop.ttiProbe.bytes.total | 8262 | 8290 | 206419 | 206419 | median <= 8675.1000; p95 <= 8704.5000 |
| default/browser//desktop.ttiProbe.domContentLoadedMs | 46.2000 | 57.3000 | 35.5000 | 52 | median <= 48.5100; p95 <= 60.1650 |
| default/browser//desktop.ttiProbe.fcpMs | 96 | 120 | 76 | 88 | median <= 100.8000; p95 <= 126 |
| default/browser//desktop.ttiProbe.firstSuccessfulClickMs | 72.1000 | 85.5000 | 105 | 118.2000 | median <= 75.7050; p95 <= 89.7750 |
| default/browser//desktop.ttiProbe.lcpMs | 96 | 120 | 76 | 88 | median <= 100.8000; p95 <= 126 |
| default/browser//desktop.ttiProbe.loadMs | 48.8000 | 57.6000 | 117.8000 | 136.4000 | median <= 51.2400; p95 <= 60.4800 |
| default/browser//desktop.ttiProbe.requestStartMs | 1 | 1.3000 | 1.1000 | 1.5000 | median <= 1.0500; p95 <= 1.3650 |
| default/browser//desktop.ttiProbe.responseEndMs | 3.7000 | 4.8000 | 4 | 6 | median <= 3.8850; p95 <= 5.0400 |
| default/browser//desktop.ttiProbe.serverResponseMs | 1.9000 | 2.6000 | 2.2000 | 3.8000 | median <= 1.9950; p95 <= 2.7300 |
| default/browser//desktop.ttiProbe.settleMs | 736 | 749 | 774 | 797 | median <= 772.8000; p95 <= 786.4500 |
| default/browser//desktop.ttiProbe.tbtMs | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//desktop.ttiProbe.ttfbMs | 3 | 3.8000 | 3.2000 | 5 | median <= 3.1500; p95 <= 3.9900 |
| default/browser//desktop.ttiProbe.ttiProxyMs | 75.2000 | 90.1000 | 137.7000 | 148.9000 | median <= 78.9600; p95 <= 94.6050 |
| default/browser//lighthouse.desktop.detail.bytes | 4036 | 4064 | 167143 | 167143 | median <= 4237.8000; p95 <= 4267.2000 |
| default/browser//lighthouse.desktop.detail.fcpMs | 759.8872 | 765.1866 | 760.1786 | 767.0178 | median <= 797.8816; p95 <= 803.4459 |
| default/browser//lighthouse.desktop.detail.lcpMs | 909.8257 | 914.1145 | 1810.1035 | 2168.9386 | median <= 955.3170; p95 <= 959.8202 |
| default/browser//lighthouse.desktop.detail.performanceScore | 0.9900 | 0.9900 | 0.9200 | 0.9300 | median >= 0.9405; p95 >= 0.9405 |
| default/browser//lighthouse.desktop.detail.speedIndexMs | 759.8872 | 765.1866 | 760.1786 | 767.0178 | median <= 797.8816; p95 <= 803.4459 |
| default/browser//lighthouse.desktop.detail.tbtMs | 0 | 0 | 40 | 40.5000 | median <= 0; p95 <= 0 |
| default/browser//lighthouse.desktop.detail.ttiMs | 909.8257 | 914.1145 | 2252.6735 | 2258.9386 | median <= 955.3170; p95 <= 959.8202 |
| default/browser//lighthouse.desktop.listing.bytes | 8280 | 9604 | 206419 | 208804 | median <= 8694; p95 <= 10084.2000 |
| default/browser//lighthouse.desktop.listing.fcpMs | 796.0950 | 813.7581 | 756.3930 | 756.9144 | median <= 835.8998; p95 <= 854.4460 |
| default/browser//lighthouse.desktop.listing.lcpMs | 802.3776 | 943.0316 | 1731.5335 | 2212.8021 | median <= 842.4965; p95 <= 990.1832 |
| default/browser//lighthouse.desktop.listing.performanceScore | 0.9900 | 0.9900 | 0.9300 | 0.9300 | median >= 0.9405; p95 >= 0.9405 |
| default/browser//lighthouse.desktop.listing.speedIndexMs | 796.0950 | 813.7581 | 756.3930 | 756.9144 | median <= 835.8998; p95 <= 854.4460 |
| default/browser//lighthouse.desktop.listing.tbtMs | 0 | 0 | 42 | 53.5000 | median <= 0; p95 <= 0 |
| default/browser//lighthouse.desktop.listing.ttiMs | 802.3776 | 943.0316 | 2351.7256 | 2492.7388 | median <= 842.4965; p95 <= 990.1832 |
| default/browser//lighthouse.mobile.detail.bytes | 4025 | 4062 | 167143 | 167143 | median <= 4226.2500; p95 <= 4265.1000 |
| default/browser//lighthouse.mobile.detail.fcpMs | 758.3620 | 761.4923 | 760.9175 | 763.9713 | median <= 796.2801; p95 <= 799.5669 |
| default/browser//lighthouse.mobile.detail.lcpMs | 904.3999 | 906.2267 | 1704.1862 | 2134.6834 | median <= 949.6199; p95 <= 951.5380 |
| default/browser//lighthouse.mobile.detail.performanceScore | 1 | 1 | 1 | 1 | median >= 0.9500; p95 >= 0.9500 |
| default/browser//lighthouse.mobile.detail.speedIndexMs | 758.3620 | 761.4923 | 760.9175 | 763.9713 | median <= 796.2801; p95 <= 799.5669 |
| default/browser//lighthouse.mobile.detail.tbtMs | 0 | 0 | 38.5000 | 40 | median <= 0; p95 <= 0 |
| default/browser//lighthouse.mobile.detail.ttiMs | 904.3999 | 906.2267 | 2228.5636 | 2253.2517 | median <= 949.6199; p95 <= 951.5380 |
| default/browser//lighthouse.mobile.listing.bytes | 6875 | 6907 | 179524 | 179524 | median <= 7218.7500; p95 <= 7252.3500 |
| default/browser//lighthouse.mobile.listing.fcpMs | 782.7017 | 791.3341 | 760.3540 | 762.3673 | median <= 821.8368; p95 <= 830.9008 |
| default/browser//lighthouse.mobile.listing.lcpMs | 784.9394 | 791.3341 | 1662.3673 | 1810.3540 | median <= 824.1864; p95 <= 830.9008 |
| default/browser//lighthouse.mobile.listing.performanceScore | 1 | 1 | 1 | 1 | median >= 0.9500; p95 >= 0.9500 |
| default/browser//lighthouse.mobile.listing.speedIndexMs | 782.7017 | 791.3341 | 760.3540 | 762.3673 | median <= 821.8368; p95 <= 830.9008 |
| default/browser//lighthouse.mobile.listing.tbtMs | 0 | 0 | 40.5000 | 42.5000 | median <= 0; p95 <= 0 |
| default/browser//lighthouse.mobile.listing.ttiMs | 784.9394 | 791.3341 | 2337.8737 | 2414.3164 | median <= 824.1864; p95 <= 830.9008 |
| default/browser//mobile.coldLoad.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//mobile.coldLoad.bytes.html | 3926 | 3959 | 6639 | 6639 | median <= 4122.3000; p95 <= 4156.9500 |
| default/browser//mobile.coldLoad.bytes.img | 2422 | 2422 | 1396 | 1396 | median <= 2543.1000; p95 <= 2543.1000 |
| default/browser//mobile.coldLoad.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.coldLoad.bytes.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.coldLoad.bytes.total | 7913 | 7946 | 178477 | 178477 | median <= 8308.6500; p95 <= 8343.3000 |
| default/browser//mobile.coldLoad.domContentLoadedMs | 230.3000 | 247.2000 | 385.5000 | 395.3000 | median <= 241.8150; p95 <= 259.5600 |
| default/browser//mobile.coldLoad.fcpMs | 416 | 432 | 384 | 396 | median <= 436.8000; p95 <= 453.6000 |
| default/browser//mobile.coldLoad.lcpMs | 416 | 432 | 384 | 396 | median <= 436.8000; p95 <= 453.6000 |
| default/browser//mobile.coldLoad.loadMs | 402 | 414.1000 | 1300 | 1311.1000 | median <= 422.1000; p95 <= 434.8050 |
| default/browser//mobile.coldLoad.loadWindow.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//mobile.coldLoad.loadWindow.bytes.html | 3926 | 3959 | 6639 | 6639 | median <= 4122.3000; p95 <= 4156.9500 |
| default/browser//mobile.coldLoad.loadWindow.bytes.img | 0 | 346 | 1396 | 1396 | median <= 0; p95 <= 363.3000 |
| default/browser//mobile.coldLoad.loadWindow.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.coldLoad.loadWindow.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.coldLoad.loadWindow.bytes.total | 5497 | 5838 | 163970 | 163970 | median <= 5771.8500; p95 <= 6129.9000 |
| default/browser//mobile.coldLoad.requestStartMs | 1.2000 | 1.9000 | 1.2000 | 1.8000 | median <= 1.2600; p95 <= 1.9950 |
| default/browser//mobile.coldLoad.responseEndMs | 168.7000 | 175.2000 | 183 | 188.6000 | median <= 177.1350; p95 <= 183.9600 |
| default/browser//mobile.coldLoad.serverResponseMs | 1.9000 | 2.8000 | 2.6000 | 4.8000 | median <= 1.9950; p95 <= 2.9400 |
| default/browser//mobile.coldLoad.settleMs | 928 | 985 | 1359 | 1378 | median <= 974.4000; p95 <= 1034.2500 |
| default/browser//mobile.coldLoad.tbtMs | 0 | 0 | 103 | 117 | median <= 0; p95 <= 0 |
| default/browser//mobile.coldLoad.ttfbMs | 3.1000 | 4.9000 | 4.1000 | 6.5000 | median <= 3.2550; p95 <= 5.1450 |
| default/browser//mobile.navigation.bytes.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| default/browser//mobile.navigation.bytes.html | 6062 | 6103 | 6639 | 6639 | median <= 6365.1000; p95 <= 6408.1500 |
| default/browser//mobile.navigation.bytes.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//mobile.navigation.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.bytes.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.bytes.total | 10667 | 10708 | 178477 | 178477 | median <= 11200.3500; p95 <= 11243.4000 |
| default/browser//mobile.navigation.navAttribution.phases.layout.durationMs | 4.8470 | 8.7770 | 2.5400 | 3.1790 | median <= 5.0894; p95 <= 9.2158 |
| default/browser//mobile.navigation.navAttribution.phases.paint.durationMs | 0.6990 | 1.1830 | 0.7110 | 1.0780 | median <= 0.7339; p95 <= 1.2422 |
| default/browser//mobile.navigation.navAttribution.phases.style.durationMs | 4.9660 | 6.7100 | 1.5090 | 2.3220 | median <= 5.2143; p95 <= 7.0455 |
| default/browser//mobile.navigation.navLegacyDomPresenceMs | 264.9009 | 273.4031 | 101.9661 | 109.8831 | median <= 278.1459; p95 <= 287.0732 |
| default/browser//mobile.navigation.navToDomMs | 355.3970 | 361.9719 | 112.4661 | 120.5830 | median <= 373.1668; p95 <= 380.0705 |
| default/browser//mobile.navigation.navToPaintMs | 337.2510 | 341.3160 | 52.5990 | 56.6360 | median <= 354.1135; p95 <= 358.3818 |
| default/browser//mobile.navigation.sessionBytes.automaticPrefetch.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.automaticPrefetch.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.automaticPrefetch.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.automaticPrefetch.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.automaticPrefetch.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.automaticPrefetch.total | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.click.css | 272 | 272 | 0 | 0 | median <= 285.6000; p95 <= 285.6000 |
| default/browser//mobile.navigation.sessionBytes.click.html | 2129 | 2155 | 0 | 0 | median <= 2235.4500; p95 <= 2262.7500 |
| default/browser//mobile.navigation.sessionBytes.click.img | 346 | 346 | 0 | 0 | median <= 363.3000; p95 <= 363.3000 |
| default/browser//mobile.navigation.sessionBytes.click.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.click.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.click.total | 2747 | 2773 | 0 | 0 | median <= 2884.3500; p95 <= 2911.6500 |
| default/browser//mobile.navigation.sessionBytes.initial.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//mobile.navigation.sessionBytes.initial.html | 3931 | 3960 | 6639 | 6639 | median <= 4127.5500; p95 <= 4158 |
| default/browser//mobile.navigation.sessionBytes.initial.img | 2422 | 2422 | 1396 | 1396 | median <= 2543.1000; p95 <= 2543.1000 |
| default/browser//mobile.navigation.sessionBytes.initial.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.initial.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.initial.total | 7918 | 7947 | 163970 | 163970 | median <= 8313.9000; p95 <= 8344.3500 |
| default/browser//mobile.navigation.sessionBytes.postClick.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.postClick.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.postClick.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.postClick.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.postClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.postClick.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.preClickBackground.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.preClickBackground.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.preClickBackground.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.preClickBackground.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.preClickBackground.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.preClickBackground.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.settledSession.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| default/browser//mobile.navigation.sessionBytes.settledSession.html | 6062 | 6103 | 6639 | 6639 | median <= 6365.1000; p95 <= 6408.1500 |
| default/browser//mobile.navigation.sessionBytes.settledSession.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//mobile.navigation.sessionBytes.settledSession.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.settledSession.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.settledSession.total | 10667 | 10708 | 178477 | 178477 | median <= 11200.3500; p95 <= 11243.4000 |
| default/browser//mobile.navigation.sessionBytes.throughClick.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//mobile.navigation.sessionBytes.throughClick.html | 3931 | 3960 | 6639 | 6639 | median <= 4127.5500; p95 <= 4158 |
| default/browser//mobile.navigation.sessionBytes.throughClick.img | 2422 | 2422 | 1396 | 1396 | median <= 2543.1000; p95 <= 2543.1000 |
| default/browser//mobile.navigation.sessionBytes.throughClick.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.throughClick.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.throughClick.total | 7918 | 7947 | 178477 | 178477 | median <= 8313.9000; p95 <= 8344.3500 |
| default/browser//mobile.navigation.sessionBytes.throughDestinationPaint.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| default/browser//mobile.navigation.sessionBytes.throughDestinationPaint.html | 6062 | 6103 | 6639 | 6639 | median <= 6365.1000; p95 <= 6408.1500 |
| default/browser//mobile.navigation.sessionBytes.throughDestinationPaint.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| default/browser//mobile.navigation.sessionBytes.throughDestinationPaint.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.throughDestinationPaint.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total | 10667 | 10708 | 178477 | 178477 | median <= 11200.3500; p95 <= 11243.4000 |
| default/browser//mobile.ttiProbe.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| default/browser//mobile.ttiProbe.bytes.html | 3929 | 3962 | 6639 | 6639 | median <= 4125.4500; p95 <= 4160.1000 |
| default/browser//mobile.ttiProbe.bytes.img | 2422 | 2422 | 1396 | 1396 | median <= 2543.1000; p95 <= 2543.1000 |
| default/browser//mobile.ttiProbe.bytes.js | 0 | 0 | 154360 | 154360 | median <= 0; p95 <= 0 |
| default/browser//mobile.ttiProbe.bytes.other | 0 | 0 | 14509 | 14509 | median <= 0; p95 <= 0 |
| default/browser//mobile.ttiProbe.bytes.total | 7916 | 7949 | 178477 | 178477 | median <= 8311.8000; p95 <= 8346.4500 |
| default/browser//mobile.ttiProbe.domContentLoadedMs | 224.3000 | 246.7000 | 384.3000 | 398.4000 | median <= 235.5150; p95 <= 259.0350 |
| default/browser//mobile.ttiProbe.fcpMs | 424 | 436 | 384 | 396 | median <= 445.2000; p95 <= 457.8000 |
| default/browser//mobile.ttiProbe.firstSuccessfulClickMs | 233 | 254.5000 | 394.8000 | 407.7000 | median <= 244.6500; p95 <= 267.2250 |
| default/browser//mobile.ttiProbe.lcpMs | 424 | 436 | 384 | 396 | median <= 445.2000; p95 <= 457.8000 |
| default/browser//mobile.ttiProbe.loadMs | 405.7000 | 416.8000 | 1297.8000 | 1341.3000 | median <= 425.9850; p95 <= 437.6400 |
| default/browser//mobile.ttiProbe.requestStartMs | 1.2000 | 1.9000 | 1.2000 | 1.5000 | median <= 1.2600; p95 <= 1.9950 |
| default/browser//mobile.ttiProbe.responseEndMs | 168.9000 | 174.2000 | 182.8000 | 188.9000 | median <= 177.3450; p95 <= 182.9100 |
| default/browser//mobile.ttiProbe.serverResponseMs | 1.9000 | 2.6000 | 2.5000 | 4.4000 | median <= 1.9950; p95 <= 2.7300 |
| default/browser//mobile.ttiProbe.settleMs | 914 | 939 | 1280 | 1293 | median <= 959.7000; p95 <= 985.9500 |
| default/browser//mobile.ttiProbe.tbtMs | 0 | 0 | 143 | 160 | median <= 0; p95 <= 0 |
| default/browser//mobile.ttiProbe.ttfbMs | 3.2000 | 4 | 3.8000 | 5.5000 | median <= 3.3600; p95 <= 4.2000 |
| default/browser//mobile.ttiProbe.ttiProxyMs | 250.8000 | 260.5000 | 1397.6000 | 1420.6000 | median <= 263.3400; p95 <= 273.5250 |

### Matched L0

| Metric | Kovo median | Kovo p95 | Next median | Next p95 | Budget policy |
| --- | ---: | ---: | ---: | ---: | --- |
| matched-l0/browser//bfcache.applicable | 1 | 1 | 1 | 1 | informational |
| matched-l0/browser//bfcache.evidenceComplete | 1 | 1 | 1 | 1 | minimum 1 |
| matched-l0/browser//bfcache.restored | 1 | 1 | 1 | 1 | median >= 0.9500; p95 >= 0.9500 |
| matched-l0/browser//desktop.coldLoad.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//desktop.coldLoad.bytes.html | 3813 | 3844 | 6488 | 6488 | median <= 4003.6500; p95 <= 4036.2000 |
| matched-l0/browser//desktop.coldLoad.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//desktop.coldLoad.bytes.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.coldLoad.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.coldLoad.bytes.total | 8146 | 8177 | 160335 | 160335 | median <= 8553.3000; p95 <= 8585.8500 |
| matched-l0/browser//desktop.coldLoad.domContentLoadedMs | 46.1000 | 52.8000 | 19.1000 | 57.2000 | median <= 48.4050; p95 <= 55.4400 |
| matched-l0/browser//desktop.coldLoad.fcpMs | 88 | 112 | 80 | 96 | median <= 92.4000; p95 <= 117.6000 |
| matched-l0/browser//desktop.coldLoad.lcpMs | 88 | 112 | 80 | 96 | median <= 92.4000; p95 <= 117.6000 |
| matched-l0/browser//desktop.coldLoad.loadMs | 48 | 53.6000 | 110.5000 | 122.8000 | median <= 50.4000; p95 <= 56.2800 |
| matched-l0/browser//desktop.coldLoad.loadWindow.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//desktop.coldLoad.loadWindow.bytes.html | 3813 | 3844 | 6488 | 6488 | median <= 4003.6500; p95 <= 4036.2000 |
| matched-l0/browser//desktop.coldLoad.loadWindow.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//desktop.coldLoad.loadWindow.bytes.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.coldLoad.loadWindow.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.coldLoad.loadWindow.bytes.total | 8146 | 8177 | 160335 | 160335 | median <= 8553.3000; p95 <= 8585.8500 |
| matched-l0/browser//desktop.coldLoad.requestStartMs | 1.1000 | 1.4000 | 1.2000 | 1.5000 | median <= 1.1550; p95 <= 1.4700 |
| matched-l0/browser//desktop.coldLoad.responseEndMs | 3.6000 | 4.6000 | 4.6000 | 7.1000 | median <= 3.7800; p95 <= 4.8300 |
| matched-l0/browser//desktop.coldLoad.serverResponseMs | 1.8000 | 2.6000 | 2.5000 | 4.7000 | median <= 1.8900; p95 <= 2.7300 |
| matched-l0/browser//desktop.coldLoad.settleMs | 672 | 696 | 600 | 617 | median <= 705.6000; p95 <= 730.8000 |
| matched-l0/browser//desktop.coldLoad.tbtMs | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.coldLoad.ttfbMs | 2.9000 | 3.9000 | 3.7000 | 6 | median <= 3.0450; p95 <= 4.0950 |
| matched-l0/browser//desktop.navigation.bytes.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l0/browser//desktop.navigation.bytes.html | 5841 | 5888 | 9874 | 9874 | median <= 6133.0500; p95 <= 6182.4000 |
| matched-l0/browser//desktop.navigation.bytes.img | 3114 | 3114 | 2792 | 2792 | median <= 3269.7000; p95 <= 3269.7000 |
| matched-l0/browser//desktop.navigation.bytes.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.bytes.total | 10792 | 10839 | 163721 | 163721 | median <= 11331.6000; p95 <= 11380.9500 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.documentConstruction.durationMs | 0.5130 | 0.6780 | 1.1330 | 1.3190 | median <= 0.5387; p95 <= 0.7119 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.layout.durationMs | 0.8500 | 1.5890 | 0.7820 | 1.0160 | median <= 0.8925; p95 <= 1.6684 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.paint.durationMs | 0.8120 | 1.1980 | 0.7030 | 0.9330 | median <= 0.8526; p95 <= 1.2579 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.responseProcessingDomApply.durationMs | 7.4240 | 8.1370 | 9.6910 | 10.6940 | median <= 7.7952; p95 <= 8.5439 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.server.durationMs | 1.7000 | 2.1810 | 2.1840 | 3.9190 | median <= 1.7850; p95 <= 2.2901 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.style.durationMs | 0.5280 | 0.5760 | 0.4750 | 0.6160 | median <= 0.5544; p95 <= 0.6048 |
| matched-l0/browser//desktop.navigation.navAttribution.phases.transfer.durationMs | 0.5730 | 0.6110 | 0.5500 | 0.6640 | median <= 0.6017; p95 <= 0.6416 |
| matched-l0/browser//desktop.navigation.navLegacyDomPresenceMs | 44.2258 | 47.3232 | 61.6709 | 66.7029 | median <= 46.4371; p95 <= 49.6894 |
| matched-l0/browser//desktop.navigation.navToDomMs | 49.0779 | 52.4231 | 66.8708 | 72.6028 | median <= 51.5318; p95 <= 55.0443 |
| matched-l0/browser//desktop.navigation.navToPaintMs | 18.0920 | 24.9890 | 16.4310 | 18.6710 | median <= 18.9966; p95 <= 26.2385 |
| matched-l0/browser//desktop.navigation.sessionBytes.automaticPrefetch.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.automaticPrefetch.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.automaticPrefetch.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.automaticPrefetch.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.automaticPrefetch.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.automaticPrefetch.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.click.css | 272 | 272 | 0 | 0 | median <= 285.6000; p95 <= 285.6000 |
| matched-l0/browser//desktop.navigation.sessionBytes.click.html | 2031 | 2056 | 3386 | 3386 | median <= 2132.5500; p95 <= 2158.8000 |
| matched-l0/browser//desktop.navigation.sessionBytes.click.img | 346 | 346 | 0 | 0 | median <= 363.3000; p95 <= 363.3000 |
| matched-l0/browser//desktop.navigation.sessionBytes.click.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.click.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.click.total | 2649 | 2674 | 3386 | 3386 | median <= 2781.4500; p95 <= 2807.7000 |
| matched-l0/browser//desktop.navigation.sessionBytes.initial.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//desktop.navigation.sessionBytes.initial.html | 3812 | 3840 | 6488 | 6488 | median <= 4002.6000; p95 <= 4032 |
| matched-l0/browser//desktop.navigation.sessionBytes.initial.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//desktop.navigation.sessionBytes.initial.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.initial.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.initial.total | 8138 | 8172 | 160335 | 160335 | median <= 8544.9000; p95 <= 8580.6000 |
| matched-l0/browser//desktop.navigation.sessionBytes.postClick.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.postClick.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.postClick.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.postClick.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.postClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.postClick.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.preClickBackground.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.preClickBackground.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.preClickBackground.img | 0 | 2768 | 0 | 0 | median <= 0; p95 <= 2906.4000 |
| matched-l0/browser//desktop.navigation.sessionBytes.preClickBackground.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.preClickBackground.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.preClickBackground.total | 0 | 2768 | 0 | 0 | median <= 0; p95 <= 2906.4000 |
| matched-l0/browser//desktop.navigation.sessionBytes.settledSession.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l0/browser//desktop.navigation.sessionBytes.settledSession.html | 5841 | 5888 | 9874 | 9874 | median <= 6133.0500; p95 <= 6182.4000 |
| matched-l0/browser//desktop.navigation.sessionBytes.settledSession.img | 3114 | 3114 | 2792 | 2792 | median <= 3269.7000; p95 <= 3269.7000 |
| matched-l0/browser//desktop.navigation.sessionBytes.settledSession.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.settledSession.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.settledSession.total | 10792 | 10839 | 163721 | 163721 | median <= 11331.6000; p95 <= 11380.9500 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughClick.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughClick.html | 3812 | 3845 | 6488 | 6488 | median <= 4002.6000; p95 <= 4037.2500 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughClick.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughClick.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughClick.total | 8145 | 8178 | 160335 | 160335 | median <= 8552.2500; p95 <= 8586.9000 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughDestinationPaint.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughDestinationPaint.html | 5841 | 5888 | 9874 | 9874 | median <= 6133.0500; p95 <= 6182.4000 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughDestinationPaint.img | 3114 | 3114 | 2792 | 2792 | median <= 3269.7000; p95 <= 3269.7000 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughDestinationPaint.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughDestinationPaint.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//desktop.navigation.sessionBytes.throughDestinationPaint.total | 10792 | 10839 | 163721 | 163721 | median <= 11331.6000; p95 <= 11380.9500 |
| matched-l0/browser//lighthouse.desktop.detail.bytes | 3929 | 3953 | 154790 | 154790 | median <= 4125.4500; p95 <= 4150.6500 |
| matched-l0/browser//lighthouse.desktop.detail.fcpMs | 762.3804 | 766.8175 | 765.2285 | 773.7400 | median <= 800.4994; p95 <= 805.1584 |
| matched-l0/browser//lighthouse.desktop.detail.lcpMs | 912.3804 | 916.8175 | 2057.5186 | 2105.7400 | median <= 957.9994; p95 <= 962.6584 |
| matched-l0/browser//lighthouse.desktop.detail.performanceScore | 0.9900 | 0.9900 | 0.9000 | 0.9400 | median >= 0.9405; p95 >= 0.9405 |
| matched-l0/browser//lighthouse.desktop.detail.speedIndexMs | 762.3804 | 766.8175 | 765.2285 | 773.7400 | median <= 800.4994; p95 <= 805.1584 |
| matched-l0/browser//lighthouse.desktop.detail.tbtMs | 0 | 0 | 78 | 81 | median <= 0; p95 <= 0 |
| matched-l0/browser//lighthouse.desktop.detail.ttiMs | 912.3804 | 916.8175 | 2095.2658 | 2133.1711 | median <= 957.9994; p95 <= 962.6584 |
| matched-l0/browser//lighthouse.desktop.listing.bytes | 8170 | 9507 | 160335 | 162719 | median <= 8578.5000; p95 <= 9982.3500 |
| matched-l0/browser//lighthouse.desktop.listing.fcpMs | 793.7608 | 800.6372 | 773.2106 | 774.8934 | median <= 833.4488; p95 <= 840.6691 |
| matched-l0/browser//lighthouse.desktop.listing.lcpMs | 800.6372 | 941.3613 | 1822.8955 | 2189.6862 | median <= 840.6691; p95 <= 988.4294 |
| matched-l0/browser//lighthouse.desktop.listing.performanceScore | 0.9900 | 0.9900 | 0.9200 | 0.9500 | median >= 0.9405; p95 >= 0.9405 |
| matched-l0/browser//lighthouse.desktop.listing.speedIndexMs | 793.7608 | 800.6372 | 773.2106 | 774.8934 | median <= 833.4488; p95 <= 840.6691 |
| matched-l0/browser//lighthouse.desktop.listing.tbtMs | 0 | 0 | 41 | 47 | median <= 0; p95 <= 0 |
| matched-l0/browser//lighthouse.desktop.listing.ttiMs | 800.6372 | 941.3613 | 2269.8955 | 2292.5654 | median <= 840.6691; p95 <= 988.4294 |
| matched-l0/browser//lighthouse.mobile.detail.bytes | 3949 | 3963 | 154790 | 154790 | median <= 4146.4500; p95 <= 4161.1500 |
| matched-l0/browser//lighthouse.mobile.detail.fcpMs | 759.9359 | 761.2254 | 763.9330 | 767.6513 | median <= 797.9327; p95 <= 799.2867 |
| matched-l0/browser//lighthouse.mobile.detail.lcpMs | 905.0526 | 907.5801 | 1960.0060 | 2058.7914 | median <= 950.3052; p95 <= 952.9591 |
| matched-l0/browser//lighthouse.mobile.detail.performanceScore | 1 | 1 | 0.9900 | 0.9900 | median >= 0.9500; p95 >= 0.9500 |
| matched-l0/browser//lighthouse.mobile.detail.speedIndexMs | 759.9359 | 761.2254 | 763.9330 | 767.6513 | median <= 797.9327; p95 <= 799.2867 |
| matched-l0/browser//lighthouse.mobile.detail.tbtMs | 0 | 0 | 76 | 80 | median <= 0; p95 <= 0 |
| matched-l0/browser//lighthouse.mobile.detail.ttiMs | 905.0526 | 907.5801 | 2092.4307 | 2096.4463 | median <= 950.3052; p95 <= 952.9591 |
| matched-l0/browser//lighthouse.mobile.listing.bytes | 6768 | 6789 | 159986 | 159986 | median <= 7106.4000; p95 <= 7128.4500 |
| matched-l0/browser//lighthouse.mobile.listing.fcpMs | 783.7257 | 790.9480 | 770.8335 | 772.7345 | median <= 822.9120; p95 <= 830.4954 |
| matched-l0/browser//lighthouse.mobile.listing.lcpMs | 785.5995 | 792.3852 | 1523.5697 | 1672.7345 | median <= 824.8795; p95 <= 832.0045 |
| matched-l0/browser//lighthouse.mobile.listing.performanceScore | 1 | 1 | 1 | 1 | median >= 0.9500; p95 >= 0.9500 |
| matched-l0/browser//lighthouse.mobile.listing.speedIndexMs | 783.7257 | 790.9480 | 770.8335 | 772.7345 | median <= 822.9120; p95 <= 830.4954 |
| matched-l0/browser//lighthouse.mobile.listing.tbtMs | 0 | 0 | 39.5000 | 42.5000 | median <= 0; p95 <= 0 |
| matched-l0/browser//lighthouse.mobile.listing.ttiMs | 785.5995 | 792.3852 | 2262.6836 | 2273.5697 | median <= 824.8795; p95 <= 832.0045 |
| matched-l0/browser//mobile.coldLoad.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//mobile.coldLoad.bytes.html | 3815 | 3844 | 6488 | 6488 | median <= 4005.7500; p95 <= 4036.2000 |
| matched-l0/browser//mobile.coldLoad.bytes.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//mobile.coldLoad.bytes.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.coldLoad.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.coldLoad.bytes.total | 8148 | 8177 | 158939 | 158939 | median <= 8555.4000; p95 <= 8585.8500 |
| matched-l0/browser//mobile.coldLoad.domContentLoadedMs | 226.6000 | 243.2000 | 383.2000 | 392.9000 | median <= 237.9300; p95 <= 255.3600 |
| matched-l0/browser//mobile.coldLoad.fcpMs | 412 | 420 | 384 | 392 | median <= 432.6000; p95 <= 441 |
| matched-l0/browser//mobile.coldLoad.lcpMs | 412 | 420 | 384 | 392 | median <= 432.6000; p95 <= 441 |
| matched-l0/browser//mobile.coldLoad.loadMs | 397.2000 | 406.7000 | 1271 | 1284.9000 | median <= 417.0600; p95 <= 427.0350 |
| matched-l0/browser//mobile.coldLoad.loadWindow.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//mobile.coldLoad.loadWindow.bytes.html | 3815 | 3844 | 6488 | 6488 | median <= 4005.7500; p95 <= 4036.2000 |
| matched-l0/browser//mobile.coldLoad.loadWindow.bytes.img | 0 | 346 | 1396 | 1396 | median <= 0; p95 <= 363.3000 |
| matched-l0/browser//mobile.coldLoad.loadWindow.bytes.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.coldLoad.loadWindow.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.coldLoad.loadWindow.bytes.total | 5385 | 5736 | 158939 | 158939 | median <= 5654.2500; p95 <= 6022.8000 |
| matched-l0/browser//mobile.coldLoad.requestStartMs | 1.2000 | 2 | 1.2000 | 1.8000 | median <= 1.2600; p95 <= 2.1000 |
| matched-l0/browser//mobile.coldLoad.responseEndMs | 168.8000 | 174.7000 | 182.9000 | 188.6000 | median <= 177.2400; p95 <= 183.4350 |
| matched-l0/browser//mobile.coldLoad.serverResponseMs | 2 | 2.8000 | 2.5000 | 3.7000 | median <= 2.1000; p95 <= 2.9400 |
| matched-l0/browser//mobile.coldLoad.settleMs | 934 | 986 | 445 | 457 | median <= 980.7000; p95 <= 1035.3000 |
| matched-l0/browser//mobile.coldLoad.tbtMs | 0 | 0 | 106 | 118 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.coldLoad.ttfbMs | 3.2000 | 4.1000 | 3.8000 | 4.8000 | median <= 3.3600; p95 <= 4.3050 |
| matched-l0/browser//mobile.navigation.bytes.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l0/browser//mobile.navigation.bytes.html | 5846 | 5889 | 9874 | 9874 | median <= 6138.3000; p95 <= 6183.4500 |
| matched-l0/browser//mobile.navigation.bytes.img | 3114 | 3114 | 1396 | 1396 | median <= 3269.7000; p95 <= 3269.7000 |
| matched-l0/browser//mobile.navigation.bytes.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.bytes.total | 10797 | 10840 | 162325 | 162325 | median <= 11336.8500; p95 <= 11382 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.documentConstruction.durationMs | 2.6330 | 3.4620 | 5.3670 | 8.6080 | median <= 2.7647; p95 <= 3.6351 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.layout.durationMs | 5.1780 | 7.5640 | 2.3990 | 3.5730 | median <= 5.4369; p95 <= 7.9422 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.paint.durationMs | 0.4210 | 1.3060 | 0.7100 | 1.0530 | median <= 0.4420; p95 <= 1.3713 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.responseProcessingDomApply.durationMs | 28.9380 | 30.9470 | 38.4520 | 42.8540 | median <= 30.3849; p95 <= 32.4944 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.server.durationMs | 154.9950 | 158.2500 | 154.4560 | 158.3710 | median <= 162.7448; p95 <= 166.1625 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.style.durationMs | 4.6020 | 5.8310 | 2.0550 | 2.8460 | median <= 4.8321; p95 <= 6.1226 |
| matched-l0/browser//mobile.navigation.navAttribution.phases.transfer.durationMs | 7.7730 | 8.5610 | 14.2450 | 15.0930 | median <= 8.1616; p95 <= 8.9891 |
| matched-l0/browser//mobile.navigation.navLegacyDomPresenceMs | 263.4941 | 274.7942 | 369.6296 | 387.9250 | median <= 276.6688; p95 <= 288.5339 |
| matched-l0/browser//mobile.navigation.navToDomMs | 349.4541 | 359.1650 | 378.6296 | 398.4250 | median <= 366.9268; p95 <= 377.1233 |
| matched-l0/browser//mobile.navigation.navToPaintMs | 332.2940 | 341.1230 | 206.9770 | 213.8570 | median <= 348.9087; p95 <= 358.1791 |
| matched-l0/browser//mobile.navigation.sessionBytes.automaticPrefetch.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.automaticPrefetch.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.automaticPrefetch.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.automaticPrefetch.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.automaticPrefetch.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.automaticPrefetch.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.click.css | 272 | 272 | 0 | 0 | median <= 285.6000; p95 <= 285.6000 |
| matched-l0/browser//mobile.navigation.sessionBytes.click.html | 2026 | 2058 | 3386 | 3386 | median <= 2127.3000; p95 <= 2160.9000 |
| matched-l0/browser//mobile.navigation.sessionBytes.click.img | 346 | 346 | 0 | 0 | median <= 363.3000; p95 <= 363.3000 |
| matched-l0/browser//mobile.navigation.sessionBytes.click.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.click.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.click.total | 2644 | 2676 | 3386 | 3386 | median <= 2776.2000; p95 <= 2809.8000 |
| matched-l0/browser//mobile.navigation.sessionBytes.initial.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//mobile.navigation.sessionBytes.initial.html | 3819 | 3845 | 6488 | 6488 | median <= 4009.9500; p95 <= 4037.2500 |
| matched-l0/browser//mobile.navigation.sessionBytes.initial.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//mobile.navigation.sessionBytes.initial.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.initial.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.initial.total | 8152 | 8178 | 158939 | 158939 | median <= 8559.6000; p95 <= 8586.9000 |
| matched-l0/browser//mobile.navigation.sessionBytes.postClick.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.postClick.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.postClick.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.postClick.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.postClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.postClick.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.preClickBackground.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.preClickBackground.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.preClickBackground.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.preClickBackground.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.preClickBackground.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.preClickBackground.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.settledSession.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l0/browser//mobile.navigation.sessionBytes.settledSession.html | 5846 | 5889 | 9874 | 9874 | median <= 6138.3000; p95 <= 6183.4500 |
| matched-l0/browser//mobile.navigation.sessionBytes.settledSession.img | 3114 | 3114 | 1396 | 1396 | median <= 3269.7000; p95 <= 3269.7000 |
| matched-l0/browser//mobile.navigation.sessionBytes.settledSession.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.settledSession.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.settledSession.total | 10797 | 10840 | 162325 | 162325 | median <= 11336.8500; p95 <= 11382 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughClick.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughClick.html | 3819 | 3845 | 6488 | 6488 | median <= 4009.9500; p95 <= 4037.2500 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughClick.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughClick.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughClick.total | 8152 | 8178 | 158939 | 158939 | median <= 8559.6000; p95 <= 8586.9000 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughDestinationPaint.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughDestinationPaint.html | 5846 | 5889 | 9874 | 9874 | median <= 6138.3000; p95 <= 6183.4500 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughDestinationPaint.img | 3114 | 3114 | 1396 | 1396 | median <= 3269.7000; p95 <= 3269.7000 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughDestinationPaint.js | 0 | 0 | 149480 | 149480 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughDestinationPaint.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l0/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total | 10797 | 10840 | 162325 | 162325 | median <= 11336.8500; p95 <= 11382 |

### Matched L1

| Metric | Kovo median | Kovo p95 | Next median | Next p95 | Budget policy |
| --- | ---: | ---: | ---: | ---: | --- |
| matched-l1/browser//bfcache.applicable | 0 | 0 | 1 | 1 | informational |
| matched-l1/browser//bfcache.evidenceComplete | 1 | 1 | 1 | 1 | minimum 1 |
| matched-l1/browser//bfcache.restored | 0 | 0 | 1 | 1 | median >= 0; p95 >= 0 |
| matched-l1/browser//desktop.coldLoad.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//desktop.coldLoad.bytes.html | 8947 | 8973 | 6361 | 6361 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//desktop.coldLoad.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.coldLoad.bytes.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.coldLoad.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.coldLoad.bytes.total | 62967 | 62993 | 161472 | 161472 | median <= 66115.3500; p95 <= 66142.6500 |
| matched-l1/browser//desktop.coldLoad.domContentLoadedMs | 66.3000 | 75.4000 | 20.2000 | 59.1000 | median <= 69.6150; p95 <= 79.1700 |
| matched-l1/browser//desktop.coldLoad.fcpMs | 96 | 116 | 80 | 92 | median <= 100.8000; p95 <= 121.8000 |
| matched-l1/browser//desktop.coldLoad.lcpMs | 96 | 116 | 80 | 92 | median <= 100.8000; p95 <= 121.8000 |
| matched-l1/browser//desktop.coldLoad.loadMs | 66.5000 | 75.5000 | 109 | 124.7000 | median <= 69.8250; p95 <= 79.2750 |
| matched-l1/browser//desktop.coldLoad.loadWindow.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//desktop.coldLoad.loadWindow.bytes.html | 8947 | 8973 | 6361 | 6361 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//desktop.coldLoad.loadWindow.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.coldLoad.loadWindow.bytes.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.coldLoad.loadWindow.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.coldLoad.loadWindow.bytes.total | 62967 | 62993 | 161472 | 161472 | median <= 66115.3500; p95 <= 66142.6500 |
| matched-l1/browser//desktop.coldLoad.requestStartMs | 1.1000 | 1.4000 | 1.1000 | 1.5000 | median <= 1.1550; p95 <= 1.4700 |
| matched-l1/browser//desktop.coldLoad.responseEndMs | 11.9000 | 15.7000 | 4.5000 | 6.7000 | median <= 12.4950; p95 <= 16.4850 |
| matched-l1/browser//desktop.coldLoad.serverResponseMs | 9.4000 | 13.5000 | 2.5000 | 4 | median <= 9.8700; p95 <= 14.1750 |
| matched-l1/browser//desktop.coldLoad.settleMs | 674 | 698 | 600 | 614 | median <= 707.7000; p95 <= 732.9000 |
| matched-l1/browser//desktop.coldLoad.tbtMs | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.coldLoad.ttfbMs | 10.7000 | 14.5000 | 3.8000 | 4.9000 | median <= 11.2350; p95 <= 15.2250 |
| matched-l1/browser//desktop.navigation.bytes.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l1/browser//desktop.navigation.bytes.html | 8942 | 8974 | 9658 | 9658 | median <= 9389.1000; p95 <= 9422.7000 |
| matched-l1/browser//desktop.navigation.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.navigation.bytes.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.navigation.bytes.other | 2459 | 2488 | 0 | 0 | median <= 2581.9500; p95 <= 2612.4000 |
| matched-l1/browser//desktop.navigation.bytes.total | 65697 | 65743 | 164769 | 164769 | median <= 68981.8500; p95 <= 69030.1500 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.documentConstruction.durationMs | 0.0340 | 0.0380 | 1.2360 | 1.4250 | median <= 0.0357; p95 <= 0.0399 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.layout.durationMs | 1.0850 | 2.3680 | 0.8020 | 1.2720 | median <= 1.1393; p95 <= 2.4864 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.paint.durationMs | 0.7650 | 0.8310 | 0.7370 | 0.8830 | median <= 0.8033; p95 <= 0.8726 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.responseProcessingDomApply.durationMs | 27.2550 | 29.4660 | 10.0300 | 10.8260 | median <= 28.6177; p95 <= 30.9393 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.server.durationMs | 7.5620 | 10.0730 | 2.1870 | 3.6850 | median <= 7.9401; p95 <= 10.5767 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.style.durationMs | 1.5610 | 1.6800 | 0.4670 | 0.5870 | median <= 1.6391; p95 <= 1.7640 |
| matched-l1/browser//desktop.navigation.navAttribution.phases.transfer.durationMs | 0.6960 | 1.3330 | 0.5420 | 0.6360 | median <= 0.7308; p95 <= 1.3997 |
| matched-l1/browser//desktop.navigation.navLegacyDomPresenceMs | 24.8550 | 28.1379 | 60.4421 | 64.0442 | median <= 26.0977; p95 <= 29.5448 |
| matched-l1/browser//desktop.navigation.navToDomMs | 44.0742 | 45.9602 | 65.0049 | 68.5972 | median <= 46.2779; p95 <= 48.2582 |
| matched-l1/browser//desktop.navigation.navToPaintMs | 59.4620 | 62.1290 | 16.7770 | 18.8950 | median <= 62.4351; p95 <= 65.2355 |
| matched-l1/browser//desktop.navigation.sessionBytes.automaticPrefetch.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.automaticPrefetch.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.automaticPrefetch.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.automaticPrefetch.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.automaticPrefetch.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.automaticPrefetch.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.click.css | 272 | 272 | 0 | 0 | median <= 285.6000; p95 <= 285.6000 |
| matched-l1/browser//desktop.navigation.sessionBytes.click.html | 0 | 0 | 3298 | 3298 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.click.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.click.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.click.other | 2459 | 2488 | 0 | 0 | median <= 2581.9500; p95 <= 2612.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.click.total | 2731 | 2760 | 3298 | 3298 | median <= 2867.5500; p95 <= 2898 |
| matched-l1/browser//desktop.navigation.sessionBytes.initial.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//desktop.navigation.sessionBytes.initial.html | 8942 | 8974 | 6361 | 6361 | median <= 9389.1000; p95 <= 9422.7000 |
| matched-l1/browser//desktop.navigation.sessionBytes.initial.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.initial.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.navigation.sessionBytes.initial.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.initial.total | 62944 | 62994 | 161472 | 161472 | median <= 66091.2000; p95 <= 66143.7000 |
| matched-l1/browser//desktop.navigation.sessionBytes.postClick.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.postClick.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.postClick.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.postClick.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.postClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.postClick.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.preClickBackground.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.preClickBackground.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.preClickBackground.img | 0 | 2768 | 0 | 0 | median <= 0; p95 <= 2906.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.preClickBackground.js | 0 | 49687 | 0 | 0 | median <= 0; p95 <= 52171.3500 |
| matched-l1/browser//desktop.navigation.sessionBytes.preClickBackground.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.preClickBackground.total | 0 | 52455 | 0 | 0 | median <= 0; p95 <= 55077.7500 |
| matched-l1/browser//desktop.navigation.sessionBytes.settledSession.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l1/browser//desktop.navigation.sessionBytes.settledSession.html | 8942 | 8974 | 9658 | 9658 | median <= 9389.1000; p95 <= 9422.7000 |
| matched-l1/browser//desktop.navigation.sessionBytes.settledSession.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.settledSession.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.navigation.sessionBytes.settledSession.other | 2459 | 2488 | 0 | 0 | median <= 2581.9500; p95 <= 2612.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.settledSession.total | 65697 | 65743 | 164769 | 164769 | median <= 68981.8500; p95 <= 69030.1500 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughClick.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughClick.html | 8942 | 8974 | 6361 | 6361 | median <= 9389.1000; p95 <= 9422.7000 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughClick.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughClick.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughClick.total | 62962 | 62994 | 161472 | 161472 | median <= 66110.1000; p95 <= 66143.7000 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughDestinationPaint.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughDestinationPaint.html | 8942 | 8974 | 9658 | 9658 | median <= 9389.1000; p95 <= 9422.7000 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughDestinationPaint.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughDestinationPaint.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughDestinationPaint.other | 2459 | 2488 | 0 | 0 | median <= 2581.9500; p95 <= 2612.4000 |
| matched-l1/browser//desktop.navigation.sessionBytes.throughDestinationPaint.total | 65697 | 65743 | 164769 | 164769 | median <= 68981.8500; p95 <= 69030.1500 |
| matched-l1/browser//desktop.ttiProbe.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//desktop.ttiProbe.bytes.html | 8946 | 8974 | 6361 | 6361 | median <= 9393.3000; p95 <= 9422.7000 |
| matched-l1/browser//desktop.ttiProbe.bytes.img | 2768 | 2768 | 2792 | 2792 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//desktop.ttiProbe.bytes.js | 51101 | 51101 | 150744 | 150744 | median <= 53656.0500; p95 <= 53656.0500 |
| matched-l1/browser//desktop.ttiProbe.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.ttiProbe.bytes.total | 64380 | 64408 | 161472 | 161472 | median <= 67599; p95 <= 67628.4000 |
| matched-l1/browser//desktop.ttiProbe.domContentLoadedMs | 62.7000 | 70 | 21.1000 | 59.8000 | median <= 65.8350; p95 <= 73.5000 |
| matched-l1/browser//desktop.ttiProbe.fcpMs | 96 | 112 | 80 | 92 | median <= 100.8000; p95 <= 117.6000 |
| matched-l1/browser//desktop.ttiProbe.firstSuccessfulClickMs | 78.1000 | 94.9000 | 103.5000 | 118.8000 | median <= 82.0050; p95 <= 99.6450 |
| matched-l1/browser//desktop.ttiProbe.lcpMs | 96 | 112 | 80 | 92 | median <= 100.8000; p95 <= 117.6000 |
| matched-l1/browser//desktop.ttiProbe.loadMs | 62.8000 | 70.1000 | 119.4000 | 131.3000 | median <= 65.9400; p95 <= 73.6050 |
| matched-l1/browser//desktop.ttiProbe.requestStartMs | 1.1000 | 1.4000 | 1.1000 | 1.5000 | median <= 1.1550; p95 <= 1.4700 |
| matched-l1/browser//desktop.ttiProbe.responseEndMs | 11.2000 | 14.2000 | 4.5000 | 6.3000 | median <= 11.7600; p95 <= 14.9100 |
| matched-l1/browser//desktop.ttiProbe.serverResponseMs | 9.1000 | 11.7000 | 2.6000 | 3.8000 | median <= 9.5550; p95 <= 12.2850 |
| matched-l1/browser//desktop.ttiProbe.settleMs | 592 | 595 | 632 | 634 | median <= 621.6000; p95 <= 624.7500 |
| matched-l1/browser//desktop.ttiProbe.tbtMs | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//desktop.ttiProbe.ttfbMs | 10.2000 | 13.1000 | 3.7000 | 4.9000 | median <= 10.7100; p95 <= 13.7550 |
| matched-l1/browser//desktop.ttiProbe.ttiProxyMs | 158.7000 | 186.5000 | 137.1000 | 147.7000 | median <= 166.6350; p95 <= 195.8250 |
| matched-l1/browser//lighthouse.desktop.detail.bytes | 58707 | 58728 | 155966 | 155966 | median <= 61642.3500; p95 <= 61664.4000 |
| matched-l1/browser//lighthouse.desktop.detail.fcpMs | 986.9704 | 989.6154 | 763.1719 | 773.0231 | median <= 1036.3189; p95 <= 1039.0962 |
| matched-l1/browser//lighthouse.desktop.detail.lcpMs | 1211.7079 | 1212.8250 | 1811.0181 | 2139.4805 | median <= 1272.2933; p95 <= 1273.4663 |
| matched-l1/browser//lighthouse.desktop.detail.performanceScore | 0.9600 | 0.9600 | 0.9200 | 0.9300 | median >= 0.9120; p95 >= 0.9120 |
| matched-l1/browser//lighthouse.desktop.detail.speedIndexMs | 986.9704 | 989.6154 | 763.1719 | 773.0231 | median <= 1036.3189; p95 <= 1039.0962 |
| matched-l1/browser//lighthouse.desktop.detail.tbtMs | 10 | 10.5000 | 38.5000 | 77.0000 | median <= 10.5000; p95 <= 11.0250 |
| matched-l1/browser//lighthouse.desktop.detail.ttiMs | 1250.4249 | 1253.6654 | 2146.1140 | 2167.8492 | median <= 1312.9461; p95 <= 1316.3487 |
| matched-l1/browser//lighthouse.desktop.listing.bytes | 62985 | 64312 | 161472 | 163856 | median <= 66134.2500; p95 <= 67527.6000 |
| matched-l1/browser//lighthouse.desktop.listing.fcpMs | 794.7582 | 1022.0799 | 769.7506 | 773.1796 | median <= 834.4961; p95 <= 1073.1839 |
| matched-l1/browser//lighthouse.desktop.listing.lcpMs | 926.4681 | 1544.6726 | 2073.6375 | 2230.6457 | median <= 972.7915; p95 <= 1621.9062 |
| matched-l1/browser//lighthouse.desktop.listing.performanceScore | 0.9800 | 0.9900 | 0.9000 | 0.9300 | median >= 0.9310; p95 >= 0.9405 |
| matched-l1/browser//lighthouse.desktop.listing.speedIndexMs | 794.7582 | 1022.0799 | 769.7506 | 773.1796 | median <= 834.4961; p95 <= 1073.1839 |
| matched-l1/browser//lighthouse.desktop.listing.tbtMs | 10 | 12.5000 | 44.5000 | 47 | median <= 10.5000; p95 <= 13.1250 |
| matched-l1/browser//lighthouse.desktop.listing.ttiMs | 1318.5090 | 1582.2723 | 2276.7506 | 2317.6589 | median <= 1384.4344; p95 <= 1661.3859 |
| matched-l1/browser//lighthouse.mobile.detail.bytes | 58711 | 58730 | 155966 | 155966 | median <= 61646.5500; p95 <= 61666.5000 |
| matched-l1/browser//lighthouse.mobile.detail.fcpMs | 993.2746 | 996.0625 | 764.8031 | 766.7316 | median <= 1042.9383; p95 <= 1045.8656 |
| matched-l1/browser//lighthouse.mobile.detail.lcpMs | 1207.8630 | 1209.0625 | 1968.4124 | 2173.7261 | median <= 1268.2562; p95 <= 1269.5156 |
| matched-l1/browser//lighthouse.mobile.detail.performanceScore | 1 | 1 | 0.9900 | 1 | median >= 0.9500; p95 >= 0.9500 |
| matched-l1/browser//lighthouse.mobile.detail.speedIndexMs | 993.2746 | 996.0625 | 764.8031 | 766.7316 | median <= 1042.9383; p95 <= 1045.8656 |
| matched-l1/browser//lighthouse.mobile.detail.tbtMs | 9.5000 | 11.5000 | 37.5000 | 48 | median <= 9.9750; p95 <= 12.0750 |
| matched-l1/browser//lighthouse.mobile.detail.ttiMs | 1248.3564 | 1249.7304 | 2142.2603 | 2186.2316 | median <= 1310.7742; p95 <= 1312.2169 |
| matched-l1/browser//lighthouse.mobile.listing.bytes | 61589 | 61607 | 161123 | 161123 | median <= 64668.4500; p95 <= 64687.3500 |
| matched-l1/browser//lighthouse.mobile.listing.fcpMs | 812.3902 | 1014.4742 | 767.7579 | 773.1046 | median <= 853.0097; p95 <= 1065.1979 |
| matched-l1/browser//lighthouse.mobile.listing.lcpMs | 812.3902 | 1378.4841 | 1672.9312 | 1708.9888 | median <= 853.0097; p95 <= 1447.4083 |
| matched-l1/browser//lighthouse.mobile.listing.performanceScore | 1 | 1 | 1 | 1 | median >= 0.9500; p95 >= 0.9500 |
| matched-l1/browser//lighthouse.mobile.listing.speedIndexMs | 812.3902 | 1014.4742 | 767.7579 | 773.1046 | median <= 853.0097; p95 <= 1065.1979 |
| matched-l1/browser//lighthouse.mobile.listing.tbtMs | 9.5000 | 10 | 39.5000 | 44 | median <= 9.9750; p95 <= 10.5000 |
| matched-l1/browser//lighthouse.mobile.listing.ttiMs | 1251.6001 | 1431.9841 | 2263.0938 | 2270.7579 | median <= 1314.1801; p95 <= 1503.5833 |
| matched-l1/browser//mobile.coldLoad.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//mobile.coldLoad.bytes.html | 8947 | 8975 | 6361 | 6361 | median <= 9394.3500; p95 <= 9423.7500 |
| matched-l1/browser//mobile.coldLoad.bytes.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.coldLoad.bytes.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//mobile.coldLoad.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.coldLoad.bytes.total | 62967 | 62995 | 160076 | 160076 | median <= 66115.3500; p95 <= 66144.7500 |
| matched-l1/browser//mobile.coldLoad.domContentLoadedMs | 418.9000 | 428.4000 | 382.8000 | 393.3000 | median <= 439.8450; p95 <= 449.8200 |
| matched-l1/browser//mobile.coldLoad.fcpMs | 424 | 440 | 384 | 396 | median <= 445.2000; p95 <= 462 |
| matched-l1/browser//mobile.coldLoad.lcpMs | 424 | 440 | 384 | 396 | median <= 445.2000; p95 <= 462 |
| matched-l1/browser//mobile.coldLoad.loadMs | 419.2000 | 428.4000 | 1274.3000 | 1289 | median <= 440.1600; p95 <= 449.8200 |
| matched-l1/browser//mobile.coldLoad.loadWindow.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//mobile.coldLoad.loadWindow.bytes.html | 8947 | 8975 | 6361 | 6361 | median <= 9394.3500; p95 <= 9423.7500 |
| matched-l1/browser//mobile.coldLoad.loadWindow.bytes.img | 0 | 346 | 1396 | 1396 | median <= 0; p95 <= 363.3000 |
| matched-l1/browser//mobile.coldLoad.loadWindow.bytes.js | 0 | 0 | 150744 | 150744 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.coldLoad.loadWindow.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.coldLoad.loadWindow.bytes.total | 10517 | 10867 | 160076 | 160076 | median <= 11042.8500; p95 <= 11410.3500 |
| matched-l1/browser//mobile.coldLoad.requestStartMs | 1.1000 | 1.8000 | 1.2000 | 2 | median <= 1.1550; p95 <= 1.8900 |
| matched-l1/browser//mobile.coldLoad.responseEndMs | 190 | 196 | 182.8000 | 188.7000 | median <= 199.5000; p95 <= 205.8000 |
| matched-l1/browser//mobile.coldLoad.serverResponseMs | 8.7000 | 11.9000 | 2.4000 | 3.8000 | median <= 9.1350; p95 <= 12.4950 |
| matched-l1/browser//mobile.coldLoad.settleMs | 1175 | 1187 | 444 | 456 | median <= 1233.7500; p95 <= 1246.3500 |
| matched-l1/browser//mobile.coldLoad.tbtMs | 24 | 31 | 101 | 113 | median <= 25.2000; p95 <= 32.5500 |
| matched-l1/browser//mobile.coldLoad.ttfbMs | 10 | 13.6000 | 3.6000 | 5.1000 | median <= 10.5000; p95 <= 14.2800 |
| matched-l1/browser//mobile.navigation.bytes.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l1/browser//mobile.navigation.bytes.html | 8947 | 8973 | 9658 | 9658 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//mobile.navigation.bytes.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.navigation.bytes.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//mobile.navigation.bytes.other | 2465 | 2490 | 0 | 0 | median <= 2588.2500; p95 <= 2614.5000 |
| matched-l1/browser//mobile.navigation.bytes.total | 65698 | 65747 | 163373 | 163373 | median <= 68982.9000; p95 <= 69034.3500 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.documentConstruction.durationMs | 0.0300 | 0.7320 | 5.1200 | 8.2550 | median <= 0.0315; p95 <= 0.7686 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.layout.durationMs | 2.9200 | 5.0300 | 2.6200 | 4.9080 | median <= 3.0660; p95 <= 5.2815 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.paint.durationMs | 0.7510 | 1.2210 | 0.6750 | 1 | median <= 0.7886; p95 <= 1.2821 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.responseProcessingDomApply.durationMs | 48.0850 | 53.5230 | 38.2990 | 42.6110 | median <= 50.4893; p95 <= 56.1992 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.server.durationMs | 155.0680 | 157.7320 | 155.3770 | 158.3440 | median <= 162.8214; p95 <= 165.6186 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.style.durationMs | 7.1610 | 9.0610 | 2.0890 | 2.9360 | median <= 7.5191; p95 <= 9.5141 |
| matched-l1/browser//mobile.navigation.navAttribution.phases.transfer.durationMs | 7.3360 | 8.0450 | 14.3010 | 14.9060 | median <= 7.7028; p95 <= 8.4473 |
| matched-l1/browser//mobile.navigation.navLegacyDomPresenceMs | 63.6938 | 71.9758 | 365.5442 | 378.5959 | median <= 66.8785; p95 <= 75.5746 |
| matched-l1/browser//mobile.navigation.navToDomMs | 232.1489 | 242.9370 | 374.8442 | 388.9529 | median <= 243.7564; p95 <= 255.0839 |
| matched-l1/browser//mobile.navigation.navToPaintMs | 233.1790 | 236.5170 | 207.9390 | 216.3630 | median <= 244.8380; p95 <= 248.3428 |
| matched-l1/browser//mobile.navigation.sessionBytes.automaticPrefetch.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.automaticPrefetch.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.automaticPrefetch.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.automaticPrefetch.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.automaticPrefetch.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.automaticPrefetch.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.click.css | 272 | 272 | 0 | 0 | median <= 285.6000; p95 <= 285.6000 |
| matched-l1/browser//mobile.navigation.sessionBytes.click.html | 0 | 0 | 3298 | 3298 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.click.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.click.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.click.other | 2465 | 2490 | 0 | 0 | median <= 2588.2500; p95 <= 2614.5000 |
| matched-l1/browser//mobile.navigation.sessionBytes.click.total | 2737 | 2762 | 3298 | 3298 | median <= 2873.8500; p95 <= 2900.1000 |
| matched-l1/browser//mobile.navigation.sessionBytes.initial.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//mobile.navigation.sessionBytes.initial.html | 8947 | 8973 | 6361 | 6361 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//mobile.navigation.sessionBytes.initial.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.navigation.sessionBytes.initial.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//mobile.navigation.sessionBytes.initial.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.initial.total | 62967 | 62993 | 160076 | 160076 | median <= 66115.3500; p95 <= 66142.6500 |
| matched-l1/browser//mobile.navigation.sessionBytes.postClick.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.postClick.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.postClick.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.postClick.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.postClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.postClick.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.preClickBackground.css | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.preClickBackground.html | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.preClickBackground.img | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.preClickBackground.js | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.preClickBackground.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.preClickBackground.total | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.settledSession.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l1/browser//mobile.navigation.sessionBytes.settledSession.html | 8947 | 8973 | 9658 | 9658 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//mobile.navigation.sessionBytes.settledSession.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.navigation.sessionBytes.settledSession.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//mobile.navigation.sessionBytes.settledSession.other | 2465 | 2490 | 0 | 0 | median <= 2588.2500; p95 <= 2614.5000 |
| matched-l1/browser//mobile.navigation.sessionBytes.settledSession.total | 65698 | 65747 | 163373 | 163373 | median <= 68982.9000; p95 <= 69034.3500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughClick.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughClick.html | 8947 | 8973 | 6361 | 6361 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughClick.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughClick.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughClick.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughClick.total | 62967 | 62993 | 160076 | 160076 | median <= 66115.3500; p95 <= 66142.6500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.css | 1837 | 1837 | 1575 | 1575 | median <= 1928.8500; p95 <= 1928.8500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.html | 8947 | 8973 | 9658 | 9658 | median <= 9394.3500; p95 <= 9421.6500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.js | 49687 | 49687 | 150744 | 150744 | median <= 52171.3500; p95 <= 52171.3500 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.other | 2465 | 2490 | 0 | 0 | median <= 2588.2500; p95 <= 2614.5000 |
| matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total | 65698 | 65747 | 163373 | 163373 | median <= 68982.9000; p95 <= 69034.3500 |
| matched-l1/browser//mobile.ttiProbe.bytes.css | 1565 | 1565 | 1575 | 1575 | median <= 1643.2500; p95 <= 1643.2500 |
| matched-l1/browser//mobile.ttiProbe.bytes.html | 8943 | 8975 | 6361 | 6361 | median <= 9390.1500; p95 <= 9423.7500 |
| matched-l1/browser//mobile.ttiProbe.bytes.img | 2768 | 2768 | 1396 | 1396 | median <= 2906.4000; p95 <= 2906.4000 |
| matched-l1/browser//mobile.ttiProbe.bytes.js | 51101 | 51101 | 150744 | 150744 | median <= 53656.0500; p95 <= 53656.0500 |
| matched-l1/browser//mobile.ttiProbe.bytes.other | 0 | 0 | 0 | 0 | median <= 0; p95 <= 0 |
| matched-l1/browser//mobile.ttiProbe.bytes.total | 64377 | 64409 | 160076 | 160076 | median <= 67595.8500; p95 <= 67629.4500 |
| matched-l1/browser//mobile.ttiProbe.domContentLoadedMs | 418.4000 | 426.7000 | 382.5000 | 392 | median <= 439.3200; p95 <= 448.0350 |
| matched-l1/browser//mobile.ttiProbe.fcpMs | 428 | 436 | 380 | 396 | median <= 449.4000; p95 <= 457.8000 |
| matched-l1/browser//mobile.ttiProbe.firstSuccessfulClickMs | 434.2000 | 443.3000 | 391.2000 | 401.8000 | median <= 455.9100; p95 <= 465.4650 |
| matched-l1/browser//mobile.ttiProbe.lcpMs | 428 | 436 | 380 | 396 | median <= 449.4000; p95 <= 457.8000 |
| matched-l1/browser//mobile.ttiProbe.loadMs | 419 | 426.8000 | 1273.7000 | 1346.9000 | median <= 439.9500; p95 <= 448.1400 |
| matched-l1/browser//mobile.ttiProbe.requestStartMs | 1.2000 | 1.5000 | 1.2000 | 1.7000 | median <= 1.2600; p95 <= 1.5750 |
| matched-l1/browser//mobile.ttiProbe.responseEndMs | 190.2000 | 195.8000 | 183.1000 | 188.7000 | median <= 199.7100; p95 <= 205.5900 |
| matched-l1/browser//mobile.ttiProbe.serverResponseMs | 8.6000 | 10.2000 | 2.4000 | 3.8000 | median <= 9.0300; p95 <= 10.7100 |
| matched-l1/browser//mobile.ttiProbe.settleMs | 22 | 35 | 297 | 328 | median <= 23.1000; p95 <= 36.7500 |
| matched-l1/browser//mobile.ttiProbe.tbtMs | 39 | 44 | 114 | 130 | median <= 40.9500; p95 <= 46.2000 |
| matched-l1/browser//mobile.ttiProbe.ttfbMs | 9.8000 | 11.4000 | 3.9000 | 5.5000 | median <= 10.2900; p95 <= 11.9700 |
| matched-l1/browser//mobile.ttiProbe.ttiProxyMs | 1275.8000 | 1284.5000 | 1353 | 1368.5000 | median <= 1339.5900; p95 <= 1348.7250 |

Browser completion floor: baseline **pass**, holdout **pass**. Reported follow-on targets: baseline **pass**, holdout **pass**.

Browser target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [completion] matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next: 1.1214 <= 2 — pass
- baseline [follow-on] matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next: 0.4021 <= 0.5000 — pass
- holdout [completion] matched-l1/browser//mobile.navigation.navToPaintMs.median-vs-next: 1.1303 <= 2 — pass
- holdout [follow-on] matched-l1/browser//mobile.navigation.sessionBytes.throughDestinationPaint.total.median-vs-next: 0.4022 <= 0.5000 — pass

## dev-n24

The generated N=24 corpus is capability matched. Ready, edit-to-paint, diagnostic, recovery, state-survival, and process-tree RSS evidence remain one indivisible subject. This campaign has no authenticated historical-current-Kovo comparator for the 30% ready and 20% leaf/entry improvement milestones, so those deltas remain explicitly unassessed; the Kovo-vs-Next ratios are separate reported follow-on targets.

Completion floor: baseline **fail**, holdout **fail**. Reported follow-on targets: baseline **fail**, holdout **fail**.

Target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [completion] corpus-n24/dev//edit.leafMs.median: 4180.8436 <= 4389.8858 — pass
- baseline [completion] corpus-n24/dev//edit.leafMs.p95: 4341.6662 <= 4558.7495 — pass
- baseline [completion] corpus-n24/dev//edit.entryMs.median: 4158.8443 <= 4366.7865 — pass
- baseline [completion] corpus-n24/dev//edit.entryMs.p95: 4230.3191 <= 4441.8350 — pass
- baseline [completion] corpus-n24/dev//edit.dataMs.median: 4164.0877 <= 4372.2920 — pass
- baseline [completion] corpus-n24/dev//edit.dataMs.p95: 4230.9023 <= 4442.4474 — pass
- baseline [completion] corpus-n24/dev//edit.syntaxErrorMs.median: 110.0304 <= 115.5320 — pass
- baseline [completion] corpus-n24/dev//edit.syntaxErrorMs.p95: 144.2362 <= 151.4480 — pass
- baseline [completion] corpus-n24/dev//edit.recoveryMs.median: 2189.3734 <= 2298.8421 — pass
- baseline [completion] corpus-n24/dev//edit.recoveryMs.p95: 2348.6823 <= 2466.1164 — pass
- baseline [completion] corpus-n24/dev//edit.peakRssBytes.median: 2988711936 <= 3138147532.8000 — pass
- baseline [completion] corpus-n24/dev//edit.peakRssBytes.p95: 3003138048 <= 3153294950.4000 — pass
- baseline [completion] corpus-n24/dev//ready.durationMs.median: 26947.2504 <= 28294.6130 — pass
- baseline [completion] corpus-n24/dev//ready.durationMs.p95: 27246.1864 <= 28608.4958 — pass
- baseline [completion] corpus-n24/dev//ready.peakRssBytes.median: 2719158272 <= 2855116185.6000 — pass
- baseline [completion] corpus-n24/dev//ready.peakRssBytes.p95: 2755776512 <= 2893565337.6000 — pass
- baseline [follow-on] corpus-n24/dev//ready.durationMs.median-vs-next: 8.8041 <= 2 — fail
- baseline [follow-on] corpus-n24/dev//edit.leafMs.median-vs-next: 51.8894 <= 2 — fail
- baseline [follow-on] corpus-n24/dev//edit.entryMs.median-vs-next: 51.5584 <= 3 — fail
- baseline [completion] corpus-n24/dev//edit.syntaxErrorMs.p95-target: 144.2362 <= 1000 — pass
- baseline [completion] corpus-n24/dev//edit.recoveryMs.p95-target: 2348.6823 <= 2000 — fail
- holdout [completion] corpus-n24/dev//edit.leafMs.median: 4330.5183 <= 4389.8858 — pass
- holdout [completion] corpus-n24/dev//edit.leafMs.p95: 4596.0828 <= 4558.7495 — fail
- holdout [completion] corpus-n24/dev//edit.entryMs.median: 4214.1447 <= 4366.7865 — pass
- holdout [completion] corpus-n24/dev//edit.entryMs.p95: 4446.8243 <= 4441.8350 — fail
- holdout [completion] corpus-n24/dev//edit.dataMs.median: 4247.5343 <= 4372.2920 — pass
- holdout [completion] corpus-n24/dev//edit.dataMs.p95: 4380.1619 <= 4442.4474 — pass
- holdout [completion] corpus-n24/dev//edit.syntaxErrorMs.median: 108.6780 <= 115.5320 — pass
- holdout [completion] corpus-n24/dev//edit.syntaxErrorMs.p95: 139.4400 <= 151.4480 — pass
- holdout [completion] corpus-n24/dev//edit.recoveryMs.median: 2248.9422 <= 2298.8421 — pass
- holdout [completion] corpus-n24/dev//edit.recoveryMs.p95: 2464.1744 <= 2466.1164 — pass
- holdout [completion] corpus-n24/dev//edit.peakRssBytes.median: 2778546176 <= 3138147532.8000 — pass
- holdout [completion] corpus-n24/dev//edit.peakRssBytes.p95: 3022086144 <= 3153294950.4000 — pass
- holdout [completion] corpus-n24/dev//ready.durationMs.median: 27919.2274 <= 28294.6130 — pass
- holdout [completion] corpus-n24/dev//ready.durationMs.p95: 28326.6372 <= 28608.4958 — pass
- holdout [completion] corpus-n24/dev//ready.peakRssBytes.median: 2719997952 <= 2855116185.6000 — pass
- holdout [completion] corpus-n24/dev//ready.peakRssBytes.p95: 2768322560 <= 2893565337.6000 — pass
- holdout [follow-on] corpus-n24/dev//ready.durationMs.median-vs-next: 8.8306 <= 2 — fail
- holdout [follow-on] corpus-n24/dev//edit.leafMs.median-vs-next: 53.9050 <= 2 — fail
- holdout [follow-on] corpus-n24/dev//edit.entryMs.median-vs-next: 52.6315 <= 3 — fail
- holdout [completion] corpus-n24/dev//edit.syntaxErrorMs.p95-target: 139.4400 <= 1000 — pass
- holdout [completion] corpus-n24/dev//edit.recoveryMs.p95-target: 2464.1744 <= 2000 — fail

Raw evidence:

- [baseline sha256:43a36485c1a8b710f472499cee962bb0463030f7f55f164095ca49fd7314efb5](https://github.com/kovojs/kovo/actions/runs/32446851107/artifacts/9435013825)
- [baseline sha256:1c650f382ec1e66ced9b6b43d50ec35835a6c186b189ae6b7d7d5bbbb9248728](https://github.com/kovojs/kovo/actions/runs/32446881033/artifacts/9435618275)
- [baseline sha256:ab57b5fad242d6c140dd1c57c430507f7df3e2b2ba6627f0ec87450efe1754af](https://github.com/kovojs/kovo/actions/runs/32446907225/artifacts/9435852868)
- [baseline sha256:205100e83f3baf9f1849e0e2f0cc37b0b600343ad5909494918578430973283d](https://github.com/kovojs/kovo/actions/runs/32446922209/artifacts/9436709535)
- [baseline sha256:49ee4e14adaa77d6cf8faa59eb8576d5736955a826b1c35d8874336eef37a602](https://github.com/kovojs/kovo/actions/runs/32446940258/artifacts/9436991789)
- [independent holdout sha256:ce926468d56258acfe21f464b72a45dfe984bafaa7c1e11985c0fdf7c2c49dab](https://github.com/kovojs/kovo/actions/runs/32446958451/artifacts/9437458102)

## dev-n216

The generated N=216 corpus is capability matched. Ready, edit-to-paint, diagnostic, recovery, state-survival, and process-tree RSS evidence remain one indivisible subject. This campaign has no authenticated historical-current-Kovo comparator for the 30% ready and 20% leaf/entry improvement milestones, so those deltas remain explicitly unassessed; the Kovo-vs-Next ratios are separate reported follow-on targets.

Completion floor: baseline **fail**, holdout **fail**. Reported follow-on targets: baseline **fail**, holdout **fail**.

Target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [completion] corpus-n216/dev//edit.leafMs.median: 8664.8989 <= 9098.1439 — pass
- baseline [completion] corpus-n216/dev//edit.leafMs.p95: 8847.0363 <= 9289.3881 — pass
- baseline [completion] corpus-n216/dev//edit.entryMs.median: 8581.2957 <= 9010.3605 — pass
- baseline [completion] corpus-n216/dev//edit.entryMs.p95: 8780.3209 <= 9219.3370 — pass
- baseline [completion] corpus-n216/dev//edit.dataMs.median: 8646.0212 <= 9078.3223 — pass
- baseline [completion] corpus-n216/dev//edit.dataMs.p95: 8780.7266 <= 9219.7629 — pass
- baseline [completion] corpus-n216/dev//edit.syntaxErrorMs.median: 146.1771 <= 153.4860 — pass
- baseline [completion] corpus-n216/dev//edit.syntaxErrorMs.p95: 147.4884 <= 154.8628 — pass
- baseline [completion] corpus-n216/dev//edit.recoveryMs.median: 2881.8826 <= 3025.9767 — pass
- baseline [completion] corpus-n216/dev//edit.recoveryMs.p95: 3015.4217 <= 3166.1928 — pass
- baseline [completion] corpus-n216/dev//edit.peakRssBytes.median: 3179302912 <= 3338268057.6000 — pass
- baseline [completion] corpus-n216/dev//edit.peakRssBytes.p95: 3193708544 <= 3353393971.2000 — pass
- baseline [completion] corpus-n216/dev//ready.durationMs.median: 74928.3502 <= 78674.7678 — pass
- baseline [completion] corpus-n216/dev//ready.durationMs.p95: 76562.1091 <= 80390.2145 — pass
- baseline [completion] corpus-n216/dev//ready.peakRssBytes.median: 2773155840 <= 2911813632 — pass
- baseline [completion] corpus-n216/dev//ready.peakRssBytes.p95: 2974330880 <= 3123047424 — pass
- baseline [follow-on] corpus-n216/dev//ready.durationMs.median-vs-next: 10.8460 <= 2 — fail
- baseline [follow-on] corpus-n216/dev//edit.leafMs.median-vs-next: 58.9657 <= 2 — fail
- baseline [follow-on] corpus-n216/dev//edit.entryMs.median-vs-next: 58.4727 <= 3 — fail
- baseline [completion] corpus-n216/dev//edit.syntaxErrorMs.p95-target: 147.4884 <= 1000 — pass
- baseline [completion] corpus-n216/dev//edit.recoveryMs.p95-target: 3015.4217 <= 2000 — fail
- holdout [completion] corpus-n216/dev//edit.leafMs.median: 8497.1205 <= 9098.1439 — pass
- holdout [completion] corpus-n216/dev//edit.leafMs.p95: 8713.2207 <= 9289.3881 — pass
- holdout [completion] corpus-n216/dev//edit.entryMs.median: 8463.7820 <= 9010.3605 — pass
- holdout [completion] corpus-n216/dev//edit.entryMs.p95: 8614.4401 <= 9219.3370 — pass
- holdout [completion] corpus-n216/dev//edit.dataMs.median: 8480.4434 <= 9078.3223 — pass
- holdout [completion] corpus-n216/dev//edit.dataMs.p95: 8633.4146 <= 9219.7629 — pass
- holdout [completion] corpus-n216/dev//edit.syntaxErrorMs.median: 142.4379 <= 153.4860 — pass
- holdout [completion] corpus-n216/dev//edit.syntaxErrorMs.p95: 147.0451 <= 154.8628 — pass
- holdout [completion] corpus-n216/dev//edit.recoveryMs.median: 2815.0548 <= 3025.9767 — pass
- holdout [completion] corpus-n216/dev//edit.recoveryMs.p95: 2947.4904 <= 3166.1928 — pass
- holdout [completion] corpus-n216/dev//edit.peakRssBytes.median: 3245965312 <= 3338268057.6000 — pass
- holdout [completion] corpus-n216/dev//edit.peakRssBytes.p95: 3289329664 <= 3353393971.2000 — pass
- holdout [completion] corpus-n216/dev//ready.durationMs.median: 73625.9689 <= 78674.7678 — pass
- holdout [completion] corpus-n216/dev//ready.durationMs.p95: 74706.1039 <= 80390.2145 — pass
- holdout [completion] corpus-n216/dev//ready.peakRssBytes.median: 2769936384 <= 2911813632 — pass
- holdout [completion] corpus-n216/dev//ready.peakRssBytes.p95: 2784399360 <= 3123047424 — pass
- holdout [follow-on] corpus-n216/dev//ready.durationMs.median-vs-next: 10.5971 <= 2 — fail
- holdout [follow-on] corpus-n216/dev//edit.leafMs.median-vs-next: 57.8321 <= 2 — fail
- holdout [follow-on] corpus-n216/dev//edit.entryMs.median-vs-next: 57.5721 <= 3 — fail
- holdout [completion] corpus-n216/dev//edit.syntaxErrorMs.p95-target: 147.0451 <= 1000 — pass
- holdout [completion] corpus-n216/dev//edit.recoveryMs.p95-target: 2947.4904 <= 2000 — fail

Raw evidence:

- [baseline sha256:1ca5beb80741148e7b45571cfaf57612d78321f39957e0d1ef1bf9776c972faa](https://github.com/kovojs/kovo/actions/runs/32446745655/artifacts/9435109547)
- [baseline sha256:88aca686da961b0040100660654ddbb2ced46db886abc765a5095dddc2901557](https://github.com/kovojs/kovo/actions/runs/32446817670/artifacts/9435132795)
- [baseline sha256:177c9bb71c4aca9b989b46a20cc1e95fa9b998ee5ce5b8840599cb81f8e51005](https://github.com/kovojs/kovo/actions/runs/32446851107/artifacts/9435289740)
- [baseline sha256:6ba5727d17200109b356f11f105331c00b6b18dd859b3d983f8b9771151cefcd](https://github.com/kovojs/kovo/actions/runs/32446907225/artifacts/9436234549)
- [baseline sha256:b61cac6921082f48c3d4432aca6f48d5aafe4c1af429667f9754f5cf2acc49b1](https://github.com/kovojs/kovo/actions/runs/32446958451/artifacts/9438152941)
- [independent holdout sha256:7367e15022243d2e964e4880fb6c5321b23409a8c86b4018a2c30a04080c6227](https://github.com/kovojs/kovo/actions/runs/32446977676/artifacts/9438506651)

## build-n24

The generated N=24 corpus preserves separate clean, unchanged, and edited production-build modes plus the authenticated source-proof/deploy-proof phase boundary.

Completion floor: baseline **fail**, holdout **fail**. Reported follow-on targets: baseline **not-applicable**, holdout **not-applicable**.

Target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [completion] corpus-n24/build/clean/durationMs.median-vs-next: 11.8263 <= 6 — fail
- baseline [completion] corpus-n24/build/clean/peakRssBytes.median-vs-next: 2.1653 <= 2 — fail
- baseline [completion] corpus-n24/build/unchanged/durationMs.median-vs-next: 11.5936 <= 6 — fail
- baseline [completion] corpus-n24/build/unchanged/peakRssBytes.median-vs-next: 2.1426 <= 2 — fail
- baseline [completion] corpus-n24/build/edit/durationMs.median-vs-next: 11.7079 <= 6 — fail
- baseline [completion] corpus-n24/build/edit/peakRssBytes.median-vs-next: 2.1472 <= 2 — fail
- holdout [completion] corpus-n24/build/clean/durationMs.median-vs-next: 11.7216 <= 6 — fail
- holdout [completion] corpus-n24/build/clean/peakRssBytes.median-vs-next: 2.1731 <= 2 — fail
- holdout [completion] corpus-n24/build/unchanged/durationMs.median-vs-next: 11.5633 <= 6 — fail
- holdout [completion] corpus-n24/build/unchanged/peakRssBytes.median-vs-next: 2.1566 <= 2 — fail
- holdout [completion] corpus-n24/build/edit/durationMs.median-vs-next: 11.7005 <= 6 — fail
- holdout [completion] corpus-n24/build/edit/peakRssBytes.median-vs-next: 2.1524 <= 2 — fail

Raw evidence:

- [baseline sha256:f607c16dbb4d139cf56b73dc9e22d9340f7216b6dd2ab1de4aba39b4a4810d6a](https://github.com/kovojs/kovo/actions/runs/32446817670/artifacts/9435488973)
- [baseline sha256:92f28deef99267f27ef5ef23fed53965dddf799fd7e21ddcc21d218c60b34a93](https://github.com/kovojs/kovo/actions/runs/32446907225/artifacts/9436796034)
- [baseline sha256:1b139b9d6d4df36e2783d88615d0d7489c0dfcc5a07a8da9c0c97bf0e037a111](https://github.com/kovojs/kovo/actions/runs/32446958451/artifacts/9438585540)
- [baseline sha256:d39e36e1dd644e83e0e4c57d306770686bcb5f7c3c7d3dcff55768436645fd14](https://github.com/kovojs/kovo/actions/runs/32447025443/artifacts/9440278044)
- [baseline sha256:d2e5908bb6d443aaa95588e760a27762f008af38bbee4cb7f133e2f3020298a3](https://github.com/kovojs/kovo/actions/runs/32447045761/artifacts/9440716920)
- [independent holdout sha256:7b38f63cdd281a15698b869984f0436b9a1a1e5a01ab21463e34c1256888110e](https://github.com/kovojs/kovo/actions/runs/32447067595/artifacts/9442341720)

## build-n216

The generated N=216 corpus preserves separate clean, unchanged, and edited production-build modes plus the authenticated source-proof/deploy-proof phase boundary.

Completion floor: baseline **fail**, holdout **fail**. Reported follow-on targets: baseline **not-applicable**, holdout **not-applicable**.

Target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [completion] corpus-n216/build/clean/durationMs.median-vs-next: 36.1258 <= 6 — fail
- baseline [completion] corpus-n216/build/clean/peakRssBytes.median-vs-next: 2.3129 <= 2 — fail
- baseline [completion] corpus-n216/build/unchanged/durationMs.median-vs-next: 34.0770 <= 6 — fail
- baseline [completion] corpus-n216/build/unchanged/peakRssBytes.median-vs-next: 2.2846 <= 2 — fail
- baseline [completion] corpus-n216/build/edit/durationMs.median-vs-next: 34.1568 <= 6 — fail
- baseline [completion] corpus-n216/build/edit/peakRssBytes.median-vs-next: 2.2908 <= 2 — fail
- holdout [completion] corpus-n216/build/clean/durationMs.median-vs-next: 35.3575 <= 6 — fail
- holdout [completion] corpus-n216/build/clean/peakRssBytes.median-vs-next: 2.3015 <= 2 — fail
- holdout [completion] corpus-n216/build/unchanged/durationMs.median-vs-next: 34.2795 <= 6 — fail
- holdout [completion] corpus-n216/build/unchanged/peakRssBytes.median-vs-next: 2.2743 <= 2 — fail
- holdout [completion] corpus-n216/build/edit/durationMs.median-vs-next: 34.3583 <= 6 — fail
- holdout [completion] corpus-n216/build/edit/peakRssBytes.median-vs-next: 2.2790 <= 2 — fail

Raw evidence:

- [baseline sha256:5c789604d34ce908538f8dbec5392b1dbfc9377d9c550292705e69fb0ac0024e](https://github.com/kovojs/kovo/actions/runs/32446745655/artifacts/9438070421)
- [baseline sha256:e1abf599a85eca7bc0f7e01de8724415ebd7178385cd1313e0e9ce75623e4897](https://github.com/kovojs/kovo/actions/runs/32446851107/artifacts/9438472401)
- [baseline sha256:dec47c82aaa972777f099f11de11efcc338e1d9046aaa1165a04b667ba94eff6](https://github.com/kovojs/kovo/actions/runs/32446907225/artifacts/9439606116)
- [baseline sha256:bfecbf127e50ae468ecaf5739bd56da55baa4b5307ee8e719fca89781603b674](https://github.com/kovojs/kovo/actions/runs/32446922209/artifacts/9440834873)
- [baseline sha256:58279bd43af2cd489738afaf15cbdcaf4331332a3ce6ba60e4a828707ab410f2](https://github.com/kovojs/kovo/actions/runs/32446940258/artifacts/9441235163)
- [independent holdout sha256:39ab0738b84a339f4c555757a68ea14b577eb974852b21d603e278f2025b82ee](https://github.com/kovojs/kovo/actions/runs/32446958451/artifacts/9441591225)

## server

Proved HIT, conditional 304, and forced-dynamic cells remain separate across route, encoding, and concurrency. Competitive HIT and forced-dynamic checks use representation-matched identity responses and are reported follow-on targets; Kovo Brotli remains required raw measurement evidence because Next Brotli is unsupported, never a fabricated paired win. This campaign has no authenticated historical-current-Kovo comparator for the 10% forced-dynamic improvement milestone, so that delta remains explicitly unassessed rather than inferred from a Kovo-vs-Next ratio.

Completion floor: baseline **not-applicable**, holdout **not-applicable**. Reported follow-on targets: baseline **fail**, holdout **fail**.

Target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [follow-on] matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next: 0.7619 >= 0.8000 — fail
- baseline [follow-on] matched-runtime/server/dynamic-listing-identity-c8/requestsPerSecond.median-vs-next: 0.7291 >= 0.8000 — fail
- baseline [follow-on] matched-runtime/server/dynamic-listing-identity-c32/requestsPerSecond.median-vs-next: 0.7234 >= 0.8000 — fail
- baseline [follow-on] matched-runtime/server/dynamic-detail-identity-c1/requestsPerSecond.median-vs-next: 0.8105 >= 0.8000 — pass
- baseline [follow-on] matched-runtime/server/dynamic-detail-identity-c8/requestsPerSecond.median-vs-next: 0.7723 >= 0.8000 — fail
- baseline [follow-on] matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.median-vs-next: 0.7828 >= 0.8000 — fail
- baseline [follow-on] matched-runtime/server/hit-listing-identity-c1/requestsPerSecond.median-vs-next: 0.9311 >= 0.9000 — pass
- baseline [follow-on] matched-runtime/server/hit-listing-identity-c8/requestsPerSecond.median-vs-next: 0.7630 >= 0.9000 — fail
- baseline [follow-on] matched-runtime/server/hit-listing-identity-c32/requestsPerSecond.median-vs-next: 0.7334 >= 0.9000 — fail
- baseline [follow-on] matched-runtime/server/hit-detail-identity-c1/requestsPerSecond.median-vs-next: 0.8057 >= 0.9000 — fail
- baseline [follow-on] matched-runtime/server/hit-detail-identity-c8/requestsPerSecond.median-vs-next: 0.7008 >= 0.9000 — fail
- baseline [follow-on] matched-runtime/server/hit-detail-identity-c32/requestsPerSecond.median-vs-next: 0.6845 >= 0.9000 — fail
- holdout [follow-on] matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next: 0.7800 >= 0.8000 — fail
- holdout [follow-on] matched-runtime/server/dynamic-listing-identity-c8/requestsPerSecond.median-vs-next: 0.7096 >= 0.8000 — fail
- holdout [follow-on] matched-runtime/server/dynamic-listing-identity-c32/requestsPerSecond.median-vs-next: 0.7242 >= 0.8000 — fail
- holdout [follow-on] matched-runtime/server/dynamic-detail-identity-c1/requestsPerSecond.median-vs-next: 0.8045 >= 0.8000 — pass
- holdout [follow-on] matched-runtime/server/dynamic-detail-identity-c8/requestsPerSecond.median-vs-next: 0.8068 >= 0.8000 — pass
- holdout [follow-on] matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.median-vs-next: 0.8098 >= 0.8000 — pass
- holdout [follow-on] matched-runtime/server/hit-listing-identity-c1/requestsPerSecond.median-vs-next: 0.9327 >= 0.9000 — pass
- holdout [follow-on] matched-runtime/server/hit-listing-identity-c8/requestsPerSecond.median-vs-next: 0.7691 >= 0.9000 — fail
- holdout [follow-on] matched-runtime/server/hit-listing-identity-c32/requestsPerSecond.median-vs-next: 0.7412 >= 0.9000 — fail
- holdout [follow-on] matched-runtime/server/hit-detail-identity-c1/requestsPerSecond.median-vs-next: 0.7981 >= 0.9000 — fail
- holdout [follow-on] matched-runtime/server/hit-detail-identity-c8/requestsPerSecond.median-vs-next: 0.7127 >= 0.9000 — fail
- holdout [follow-on] matched-runtime/server/hit-detail-identity-c32/requestsPerSecond.median-vs-next: 0.6977 >= 0.9000 — fail

Raw evidence:

- [baseline sha256:dec5d600435047029acfb2aa55470278646cc00d332257f0019deab359c298e6](https://github.com/kovojs/kovo/actions/runs/32446778239/artifacts/9437539608)
- [baseline sha256:0ee68c52a952932f4c249090d59480ed37525aca60a732caac132ed468cb4c82](https://github.com/kovojs/kovo/actions/runs/32446817670/artifacts/9437639960)
- [baseline sha256:d217f75eb10974293e6c31d099e0c777cdf84eace3a37ef69606558b14ec6bbd](https://github.com/kovojs/kovo/actions/runs/32447025443/artifacts/9443031209)
- [baseline sha256:738ef0f5d61e0fdfcac5690e01ee8ed82cec46611cf12c7cd094973c8435130c](https://github.com/kovojs/kovo/actions/runs/32447067595/artifacts/9445175016)
- [baseline sha256:3be8f645ba03fd5b21899b6a4f7180158bb2a2398efe9b08e5a65a561f0229b8](https://github.com/kovojs/kovo/actions/runs/32447180722/artifacts/9448096702)
- [independent holdout sha256:0ea872ef12bf6817d3a424ade9caa30f14384b72dea99e647537c76f1393d3d3](https://github.com/kovojs/kovo/actions/runs/32447218549/artifacts/9450673507)

## check

Check scaling is a Kovo-only N=8,24,72,216 ladder. It enforces Kovo product targets and must not be represented as a Kovo-vs-Next comparison.

Completion floor: baseline **pass**, holdout **pass**. Reported follow-on targets: baseline **not-applicable**, holdout **not-applicable**.

Target assessment (a follow-on miss remains `fail`; its role is reported separately):

- baseline [completion] check.appSourceTrust.marginalScalingExponent.ratified-p95-target: 1.0221 <= 1.3000 — pass
- baseline [completion] check.peakRssBytes.ratified-p95-target: 3140702208 <= 3221225472 — pass
- baseline [completion] check.total.marginalScalingExponent.ratified-p95-target: 0.6527 <= 1 — pass
- holdout [completion] check.appSourceTrust.marginalScalingExponent.absolute-target: 0.9838 <= 1.3000 — pass
- holdout [completion] check.peakRssBytes.absolute-target: 3113451520 <= 3221225472 — pass
- holdout [completion] check.total.marginalScalingExponent.absolute-target: 0.6245 <= 1 — pass

Raw evidence:

- [baseline sha256:03cf52656767a588ace4eebab277dbd6f9b0c064b8d8859571bdb767aa35ead5](https://github.com/kovojs/kovo/actions/runs/32446817670/artifacts/9434458339)
- [baseline sha256:1df63433dde2f7d66d76b90ec58f39956b99d96c786e0e6342b73c8cd28cf5af](https://github.com/kovojs/kovo/actions/runs/32446881033/artifacts/9435331567)
- [baseline sha256:987ea6bcc89216d29bdc4489706aeb40ffcbac7c89906c39af460147a42ec715](https://github.com/kovojs/kovo/actions/runs/32446922209/artifacts/9436091517)
- [baseline sha256:33270f4c0a211b900855f24265f86e645a825822a9f7ab214720a81a41f11fd3](https://github.com/kovojs/kovo/actions/runs/32446940258/artifacts/9436601612)
- [baseline sha256:550d7cc677cb1537af010f54812b661d9c6038fbe40aeb127d22a6b65e9d7a27](https://github.com/kovojs/kovo/actions/runs/32446958451/artifacts/9437224137)
- [independent holdout sha256:4e11bfd24cd1e69909ab2404b2b77e45be536974d14b20b431b24565a6ea87dd](https://github.com/kovojs/kovo/actions/runs/32447025443/artifacts/9438721009)

## Blocking failures

- browser:default/browser//desktop.coldLoad.requestStartMs.p95
- browser:default/browser//desktop.coldLoad.responseEndMs.p95
- browser:default/browser//desktop.coldLoad.serverResponseMs.median
- browser:default/browser//desktop.coldLoad.serverResponseMs.p95
- browser:default/browser//desktop.coldLoad.ttfbMs.p95
- browser:default/browser//desktop.navigation.navAttribution.phases.layout.durationMs.p95
- browser:default/browser//desktop.ttiProbe.domContentLoadedMs.median
- browser:default/browser//desktop.ttiProbe.fcpMs.median
- browser:default/browser//desktop.ttiProbe.lcpMs.median
- browser:default/browser//desktop.ttiProbe.loadMs.median
- browser:default/browser//desktop.ttiProbe.requestStartMs.median
- browser:default/browser//desktop.ttiProbe.requestStartMs.p95
- browser:default/browser//desktop.ttiProbe.responseEndMs.median
- browser:default/browser//desktop.ttiProbe.ttiProxyMs.p95
- browser:default/browser//mobile.coldLoad.serverResponseMs.median
- browser:default/browser//mobile.navigation.navAttribution.phases.layout.durationMs.median
- browser:default/browser//mobile.ttiProbe.requestStartMs.p95
- browser:default/browser//mobile.ttiProbe.tbtMs.p95
- browser:default/browser//mobile.ttiProbe.ttfbMs.p95
- browser:matched-l0/browser//desktop.coldLoad.domContentLoadedMs.p95
- browser:matched-l0/browser//desktop.coldLoad.fcpMs.p95
- browser:matched-l0/browser//desktop.coldLoad.lcpMs.p95
- browser:matched-l0/browser//desktop.coldLoad.loadMs.p95
- browser:matched-l0/browser//desktop.coldLoad.serverResponseMs.median
- browser:matched-l0/browser//desktop.coldLoad.serverResponseMs.p95
- browser:matched-l0/browser//desktop.coldLoad.ttfbMs.p95
- browser:matched-l0/browser//desktop.navigation.navAttribution.phases.documentConstruction.durationMs.p95
- browser:matched-l0/browser//desktop.navigation.navAttribution.phases.layout.durationMs.median
- browser:matched-l0/browser//desktop.navigation.navAttribution.phases.layout.durationMs.p95
- browser:matched-l0/browser//desktop.navigation.navAttribution.phases.paint.durationMs.p95
- browser:matched-l0/browser//desktop.navigation.navAttribution.phases.server.durationMs.median
- browser:matched-l0/browser//desktop.navigation.navAttribution.phases.style.durationMs.p95
- browser:matched-l0/browser//desktop.navigation.navLegacyDomPresenceMs.p95
- browser:matched-l0/browser//desktop.navigation.navToDomMs.p95
- browser:matched-l0/browser//lighthouse.mobile.listing.lcpMs.p95
- browser:matched-l0/browser//lighthouse.mobile.listing.ttiMs.p95
- browser:matched-l0/browser//mobile.coldLoad.serverResponseMs.p95
- browser:matched-l0/browser//mobile.navigation.navAttribution.phases.paint.durationMs.median
- browser:matched-l0/browser//mobile.navigation.navAttribution.phases.paint.durationMs.p95
- browser:matched-l1/browser//desktop.coldLoad.requestStartMs.p95
- browser:matched-l1/browser//desktop.navigation.navAttribution.phases.documentConstruction.durationMs.p95
- browser:matched-l1/browser//desktop.navigation.navAttribution.phases.layout.durationMs.median
- browser:matched-l1/browser//desktop.ttiProbe.domContentLoadedMs.p95
- browser:matched-l1/browser//desktop.ttiProbe.firstSuccessfulClickMs.median
- browser:matched-l1/browser//desktop.ttiProbe.loadMs.p95
- browser:matched-l1/browser//desktop.ttiProbe.responseEndMs.median
- browser:matched-l1/browser//desktop.ttiProbe.serverResponseMs.median
- browser:matched-l1/browser//desktop.ttiProbe.serverResponseMs.p95
- browser:matched-l1/browser//desktop.ttiProbe.ttfbMs.median
- browser:matched-l1/browser//lighthouse.desktop.listing.tbtMs.median
- browser:matched-l1/browser//lighthouse.desktop.listing.tbtMs.p95
- browser:matched-l1/browser//lighthouse.desktop.listing.ttiMs.median
- browser:matched-l1/browser//lighthouse.mobile.listing.fcpMs.median
- browser:matched-l1/browser//lighthouse.mobile.listing.lcpMs.median
- browser:matched-l1/browser//lighthouse.mobile.listing.speedIndexMs.median
- browser:matched-l1/browser//lighthouse.mobile.listing.tbtMs.p95
- browser:matched-l1/browser//lighthouse.mobile.listing.ttiMs.median
- browser:matched-l1/browser//mobile.coldLoad.requestStartMs.median
- browser:matched-l1/browser//mobile.coldLoad.serverResponseMs.median
- browser:matched-l1/browser//mobile.coldLoad.ttfbMs.median
- browser:matched-l1/browser//mobile.ttiProbe.requestStartMs.p95
- browser:matched-l1/browser//mobile.ttiProbe.settleMs.p95
- browser:matched-l1/browser//mobile.ttiProbe.ttfbMs.median
- build-n216:baseline:corpus-n216/build/clean/durationMs.median-vs-next
- build-n216:baseline:corpus-n216/build/clean/peakRssBytes.median-vs-next
- build-n216:baseline:corpus-n216/build/edit/durationMs.median-vs-next
- build-n216:baseline:corpus-n216/build/edit/peakRssBytes.median-vs-next
- build-n216:baseline:corpus-n216/build/unchanged/durationMs.median-vs-next
- build-n216:baseline:corpus-n216/build/unchanged/peakRssBytes.median-vs-next
- build-n216:corpus-n216/build/clean/durationMs.median-vs-next
- build-n216:corpus-n216/build/clean/peakRssBytes.median-vs-next
- build-n216:corpus-n216/build/edit/durationMs.median-vs-next
- build-n216:corpus-n216/build/edit/peakRssBytes.median-vs-next
- build-n216:corpus-n216/build/unchanged/durationMs.median-vs-next
- build-n216:corpus-n216/build/unchanged/peakRssBytes.median-vs-next
- build-n216:holdout:corpus-n216/build/clean/durationMs.median-vs-next
- build-n216:holdout:corpus-n216/build/clean/peakRssBytes.median-vs-next
- build-n216:holdout:corpus-n216/build/edit/durationMs.median-vs-next
- build-n216:holdout:corpus-n216/build/edit/peakRssBytes.median-vs-next
- build-n216:holdout:corpus-n216/build/unchanged/durationMs.median-vs-next
- build-n216:holdout:corpus-n216/build/unchanged/peakRssBytes.median-vs-next
- build-n24:baseline:corpus-n24/build/clean/durationMs.median-vs-next
- build-n24:baseline:corpus-n24/build/clean/peakRssBytes.median-vs-next
- build-n24:baseline:corpus-n24/build/edit/durationMs.median-vs-next
- build-n24:baseline:corpus-n24/build/edit/peakRssBytes.median-vs-next
- build-n24:baseline:corpus-n24/build/unchanged/durationMs.median-vs-next
- build-n24:baseline:corpus-n24/build/unchanged/peakRssBytes.median-vs-next
- build-n24:corpus-n24/build/clean/durationMs.median-vs-next
- build-n24:corpus-n24/build/clean/peakRssBytes.median-vs-next
- build-n24:corpus-n24/build/edit/durationMs.median-vs-next
- build-n24:corpus-n24/build/edit/peakRssBytes.median-vs-next
- build-n24:corpus-n24/build/unchanged/durationMs.median-vs-next
- build-n24:corpus-n24/build/unchanged/peakRssBytes.median-vs-next
- build-n24:holdout:corpus-n24/build/clean/durationMs.median-vs-next
- build-n24:holdout:corpus-n24/build/clean/peakRssBytes.median-vs-next
- build-n24:holdout:corpus-n24/build/edit/durationMs.median-vs-next
- build-n24:holdout:corpus-n24/build/edit/peakRssBytes.median-vs-next
- build-n24:holdout:corpus-n24/build/unchanged/durationMs.median-vs-next
- build-n24:holdout:corpus-n24/build/unchanged/peakRssBytes.median-vs-next
- dev-n216:baseline:corpus-n216/dev//edit.recoveryMs.p95-target
- dev-n216:corpus-n216/dev//edit.recoveryMs.p95-target
- dev-n216:holdout:corpus-n216/dev//edit.recoveryMs.p95-target
- dev-n24:baseline:corpus-n24/dev//edit.recoveryMs.p95-target
- dev-n24:corpus-n24/dev//edit.entryMs.p95
- dev-n24:corpus-n24/dev//edit.leafMs.p95
- dev-n24:corpus-n24/dev//edit.recoveryMs.p95-target
- dev-n24:holdout:corpus-n24/dev//edit.entryMs.p95
- dev-n24:holdout:corpus-n24/dev//edit.leafMs.p95
- dev-n24:holdout:corpus-n24/dev//edit.recoveryMs.p95-target
- server:matched-runtime/server/304-detail-identity-c32/p50Ms.p95
- server:matched-runtime/server/304-detail-identity-c32/p95Ms.median
- server:matched-runtime/server/304-detail-identity-c32/p95Ms.p95
- server:matched-runtime/server/304-detail-identity-c32/p99Ms.median
- server:matched-runtime/server/304-detail-identity-c32/p99Ms.p95
- server:matched-runtime/server/304-detail-identity-c32/requestsPerSecond.median
- server:matched-runtime/server/304-detail-identity-c32/requestsPerSecond.p95
- server:matched-runtime/server/304-detail-identity-c32/serverCpuMs.median
- server:matched-runtime/server/304-detail-identity-c32/serverCpuMs.p95
- server:matched-runtime/server/304-detail-identity-c32/serverCpuPercent.median
- server:matched-runtime/server/304-detail-identity-c32/serverCpuPercent.p95
- server:matched-runtime/server/304-detail-identity-c8/p95Ms.median
- server:matched-runtime/server/304-detail-identity-c8/p95Ms.p95
- server:matched-runtime/server/304-detail-identity-c8/p99Ms.median
- server:matched-runtime/server/304-detail-identity-c8/p99Ms.p95
- server:matched-runtime/server/304-detail-identity-c8/peakRssBytes.p95
- server:matched-runtime/server/304-detail-identity-c8/requestsPerSecond.median
- server:matched-runtime/server/304-detail-identity-c8/serverCpuMs.p95
- server:matched-runtime/server/304-detail-identity-c8/serverCpuPercent.p95
- server:matched-runtime/server/304-listing-identity-c32/p50Ms.p95
- server:matched-runtime/server/304-listing-identity-c32/p95Ms.median
- server:matched-runtime/server/304-listing-identity-c32/p95Ms.p95
- server:matched-runtime/server/304-listing-identity-c32/p99Ms.median
- server:matched-runtime/server/304-listing-identity-c32/p99Ms.p95
- server:matched-runtime/server/304-listing-identity-c32/serverCpuMs.median
- server:matched-runtime/server/304-listing-identity-c32/serverCpuMs.p95
- server:matched-runtime/server/304-listing-identity-c32/serverCpuPercent.median
- server:matched-runtime/server/304-listing-identity-c32/serverCpuPercent.p95
- server:matched-runtime/server/dynamic-detail-identity-c32/p50Ms.median
- server:matched-runtime/server/dynamic-detail-identity-c32/p50Ms.p95
- server:matched-runtime/server/dynamic-detail-identity-c32/p95Ms.median
- server:matched-runtime/server/dynamic-detail-identity-c32/p95Ms.p95
- server:matched-runtime/server/dynamic-detail-identity-c32/p99Ms.median
- server:matched-runtime/server/dynamic-detail-identity-c32/p99Ms.p95
- server:matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.median
- server:matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.p95
- server:matched-runtime/server/dynamic-detail-identity-c8/p50Ms.p95
- server:matched-runtime/server/dynamic-detail-identity-c8/p95Ms.p95
- server:matched-runtime/server/dynamic-detail-identity-c8/p99Ms.median
- server:matched-runtime/server/dynamic-detail-identity-c8/p99Ms.p95
- server:matched-runtime/server/dynamic-detail-identity-c8/peakRssBytes.median
- server:matched-runtime/server/dynamic-detail-identity-c8/requestsPerSecond.p95
- server:matched-runtime/server/dynamic-listing-identity-c1/responseBytes.median
- server:matched-runtime/server/dynamic-listing-identity-c1/responseBytes.p95
- server:matched-runtime/server/dynamic-listing-identity-c32/p50Ms.median
- server:matched-runtime/server/dynamic-listing-identity-c32/p50Ms.p95
- server:matched-runtime/server/dynamic-listing-identity-c32/p95Ms.median
- server:matched-runtime/server/dynamic-listing-identity-c32/p95Ms.p95
- server:matched-runtime/server/dynamic-listing-identity-c32/p99Ms.median
- server:matched-runtime/server/dynamic-listing-identity-c32/p99Ms.p95
- server:matched-runtime/server/dynamic-listing-identity-c32/requestsPerSecond.median
- server:matched-runtime/server/dynamic-listing-identity-c32/requestsPerSecond.p95
- server:matched-runtime/server/dynamic-listing-identity-c8/p50Ms.median
- server:matched-runtime/server/dynamic-listing-identity-c8/p50Ms.p95
- server:matched-runtime/server/dynamic-listing-identity-c8/p95Ms.median
- server:matched-runtime/server/dynamic-listing-identity-c8/p95Ms.p95
- server:matched-runtime/server/dynamic-listing-identity-c8/p99Ms.median
- server:matched-runtime/server/dynamic-listing-identity-c8/p99Ms.p95
- server:matched-runtime/server/dynamic-listing-identity-c8/requestsPerSecond.median
- server:matched-runtime/server/dynamic-listing-identity-c8/responseBytes.p95
- server:matched-runtime/server/hit-detail-identity-c1/responseBytes.median
- server:matched-runtime/server/hit-detail-identity-c32/p50Ms.p95
- server:matched-runtime/server/hit-detail-identity-c32/p95Ms.median
- server:matched-runtime/server/hit-detail-identity-c32/p95Ms.p95
- server:matched-runtime/server/hit-detail-identity-c32/p99Ms.median
- server:matched-runtime/server/hit-detail-identity-c32/p99Ms.p95
- server:matched-runtime/server/hit-detail-identity-c32/requestsPerSecond.median
- server:matched-runtime/server/hit-detail-identity-c32/requestsPerSecond.p95
- server:matched-runtime/server/hit-detail-identity-c32/serverCpuMs.median
- server:matched-runtime/server/hit-detail-identity-c32/serverCpuMs.p95
- server:matched-runtime/server/hit-detail-identity-c32/serverCpuPercent.median
- server:matched-runtime/server/hit-detail-identity-c32/serverCpuPercent.p95
- server:matched-runtime/server/hit-detail-identity-c8/p99Ms.median
- server:matched-runtime/server/hit-detail-identity-c8/p99Ms.p95
- server:matched-runtime/server/hit-detail-identity-c8/peakRssBytes.p95
- server:matched-runtime/server/hit-detail-identity-c8/serverCpuMs.p95
- server:matched-runtime/server/hit-detail-identity-c8/serverCpuPercent.p95
- server:matched-runtime/server/hit-listing-identity-c32/p95Ms.median
- server:matched-runtime/server/hit-listing-identity-c32/p95Ms.p95
- server:matched-runtime/server/hit-listing-identity-c32/p99Ms.median
- server:matched-runtime/server/hit-listing-identity-c32/p99Ms.p95
- server:matched-runtime/server/hit-listing-identity-c32/serverCpuMs.p95
- server:matched-runtime/server/hit-listing-identity-c32/serverCpuPercent.p95

## Reported follow-on misses (non-blocking)

- dev-n216:baseline:corpus-n216/dev//edit.entryMs.median-vs-next
- dev-n216:baseline:corpus-n216/dev//edit.leafMs.median-vs-next
- dev-n216:baseline:corpus-n216/dev//ready.durationMs.median-vs-next
- dev-n216:holdout:corpus-n216/dev//edit.entryMs.median-vs-next
- dev-n216:holdout:corpus-n216/dev//edit.leafMs.median-vs-next
- dev-n216:holdout:corpus-n216/dev//ready.durationMs.median-vs-next
- dev-n24:baseline:corpus-n24/dev//edit.entryMs.median-vs-next
- dev-n24:baseline:corpus-n24/dev//edit.leafMs.median-vs-next
- dev-n24:baseline:corpus-n24/dev//ready.durationMs.median-vs-next
- dev-n24:holdout:corpus-n24/dev//edit.entryMs.median-vs-next
- dev-n24:holdout:corpus-n24/dev//edit.leafMs.median-vs-next
- dev-n24:holdout:corpus-n24/dev//ready.durationMs.median-vs-next
- server:baseline:matched-runtime/server/dynamic-detail-identity-c32/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/dynamic-detail-identity-c8/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/dynamic-listing-identity-c32/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/dynamic-listing-identity-c8/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/hit-detail-identity-c1/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/hit-detail-identity-c32/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/hit-detail-identity-c8/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/hit-listing-identity-c32/requestsPerSecond.median-vs-next
- server:baseline:matched-runtime/server/hit-listing-identity-c8/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/dynamic-listing-identity-c1/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/dynamic-listing-identity-c32/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/dynamic-listing-identity-c8/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/hit-detail-identity-c1/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/hit-detail-identity-c32/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/hit-detail-identity-c8/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/hit-listing-identity-c32/requestsPerSecond.median-vs-next
- server:holdout:matched-runtime/server/hit-listing-identity-c8/requestsPerSecond.median-vs-next
