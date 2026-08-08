# Kovo / Next.js / TanStack Start Benchmark

This benchmark compares a Kovo server-rendered MPA against Next.js App Router
and TanStack Start using the same small commerce app shape:

- listing route with 24 products;
- product detail route at `/product/<slug>`;
- cart dialog and checkout confirmation; Kovo uses native popover controls for
  this L0 interaction, while the React entrants use hydrated client state;
- shared `catalog.json` and identical WebP image assets;
- plain `<img>` tags in all entrants.

The benchmark is intentionally standalone under `benchmarks/`. Only
`benchmarks/kovo` is a pnpm workspace package because it depends on local
`@kovojs/*` packages via `workspace:*`. The Next.js, TanStack Start, and harness
packages are isolated installs and should be installed with `--ignore-workspace`.

## Install

From the repo root:

```sh
pnpm install
pnpm --dir benchmarks/nextjs install --ignore-workspace
pnpm --dir benchmarks/tanstack install --ignore-workspace
pnpm --dir benchmarks/harness install --ignore-workspace
```

## Build And Run

Build all three apps and run the full benchmark:

```sh
node benchmarks/run-all.mjs
```

The default run uses 10 iterations per app, per condition, per custom scenario
and also runs Lighthouse for `/` and `/product/linen-field-jacket` on mobile and
desktop presets, repeating each Lighthouse cell 3 times. Every entrant is started
with `NODE_ENV=production`; Kovo additionally receives per-run
`KOVO_ATTESTATION_DEPLOYMENT_ID`/`KOVO_ATTESTATION_SECRET`, without which it
refuses to boot in that posture (SPEC §11.2).

Results are written to `results.json` and `report.md` under `--out-dir`, which
defaults to `benchmarks/results/`. **That directory deliberately holds no committed
report** — see [`results/README.md`](results/README.md) for why, and for the
conditions a committed report must meet. Prefer `--out-dir` outside the repo.

For a faster local smoke run:

```sh
node benchmarks/run-all.mjs --iterations 2 --skip-lighthouse --out-dir /tmp/kovo-bench
```

Useful flags: `--apps kovo,nextjs`, `--port-base 4820` (so two runs on one machine
cannot measure each other's server), `--lighthouse-runs N`, `--bfcache-iterations N`,
`--settle-quiet-ms` / `--settle-max-ms`. Every numeric flag is validated and rejects
a non-integer instead of coercing it to `NaN`: an unvalidated `NaN` count runs its
loop zero times and publishes an empty cell that reads like a measurement.

To regenerate `report.md` from an existing `results.json` without re-running the
benchmark, pass the path explicitly — there is no default, because
`benchmarks/results/` holds no committed run:

```sh
pnpm --dir benchmarks/harness run report -- /tmp/kovo-bench/results.json
```

You can also build or serve an entrant directly:

```sh
pnpm --dir benchmarks/kovo run build
PORT=4310 pnpm --dir benchmarks/kovo run start

pnpm --dir benchmarks/nextjs run build
(cd benchmarks/nextjs && PORT=4311 HOSTNAME=127.0.0.1 node .next/standalone/benchmarks/nextjs/server.js)

pnpm --dir benchmarks/tanstack run build
PORT=4312 pnpm --dir benchmarks/tanstack run start
```

## Methodology

The custom harness uses Playwright Chromium with a fresh browser context for
each iteration. It records:

- cold listing load: TTFB, FCP, LCP, DOMContentLoaded, load, Total Blocking Time,
  request count, and wire bytes bucketed by HTML/JS/CSS/image/other. Bytes are
  collected at **network quiescence**, not at `load` + 150 ms: Kovo imports its
  deferred client runtime on a double `requestAnimationFrame` after `load`, so the
  old window reported `js: 0` for an app shipping 267,948 B of JS. Both windows
  appear in the report so the gap is visible per run;
- TTI proxy: a tight in-page poll loop repeatedly clicks the cart button until
  `[role=dialog]` is visible, exposing hydration dead time versus Kovo's first
  lazy interaction import;
- navigation: click the first product card and measure **to actual paint** — the
  destination document's first contentful paint when the navigation replaced the
  document, otherwise the first frame rendered after the destination content is in
  the DOM. Timestamps are absolute, because a document-replacing navigation resets
  the document timeline. The report also records how many navigations replaced the
  document, and what the superseded DOM-presence probe would have reported.
  **Those two branches are not the same instrument and the difference is one-sided**:
  the document-replacing branch reads a browser-recorded paint timestamp with no
  harness cost in it, while the same-document branch pays a poll interval, CDP
  round-trips and two animation frames. Kovo is the document-replacing entrant, so
  the error runs in Kovo's favour. The report states this under "Known limits of
  this instrument"; do not quote a small navigation gap as a result;
- back/forward cache: a separate probe in full Chromium with Playwright's
  `--disable-back-forward-cache` removed (the default `chrome-headless-shell`
  cannot participate in bfcache at all). Frameworks that navigate in-document are
  reported `n/a` rather than scored as non-restores.

The run aborts rather than publishing if a port is already held, if a server exits
early, if a server reports development posture under `NODE_ENV=production`, or if
any **observed** request was rate-limited (429) or returned `>= 400`.

What "observed" covers, precisely — the gate is only as wide as its instrumentation:

| Traffic source                                         | HTTP status observed via     | Transport failure observed |
| ------------------------------------------------------ | ---------------------------- | -------------------------- |
| Custom scenarios (cold load, TTI, navigation)          | Playwright `requestfinished` | yes, `requestfailed`       |
| Lighthouse cells (4 per entrant x `--lighthouse-runs`) | the `network-requests` audit | no                         |
| Back/forward-cache probe (2 loads per iteration)       | Playwright `response`        | no                         |

Only the custom scenarios can see a request that failed **at the network layer** —
a connection reset or DNS failure produces no HTTP status, so a page whose
subresources all failed that way would otherwise report zero errors.

Aborts are counted separately from failures and do not reject a run, because a
document-replacing navigation legitimately cancels the origin document's in-flight
subresources. This is not hypothetical: a `--iterations 10` run recorded 15 aborted
requests for the Kovo entrant and 0 for both React entrants, exactly tracking which
entrant replaces the document. Folding aborts into the failure count would have
rejected the Kovo entrant on every run, for doing the thing it is being measured for.

A source whose statuses could not be read at all is printed as
`[integrity] untracked: …` on stderr, named in the generated report, and never
silently counted as clean.

### Rate limiting and iteration count

Every request in a run arrives from `127.0.0.1`, so the whole benchmark shares a
single source IP against Kovo's per-IP budget: 600 requests per rolling minute by
framework default (`DEFAULT_PER_IP_RATE`, `packages/server/src/app-load-shed.ts`).
Only the Kovo entrant has such a budget at all; the React entrants do not shed.

**Measured, not assumed.** A `--iterations 10` run of the Kovo entrant — 10
iterations x 2 conditions x 3 scenarios, plus 3 bfcache iterations and 4 Lighthouse
cells x 3 repeats — recorded **zero 429s**, and the integrity gate saw all of it.
That was on a tree that did _not_ yet carry the D12 document-GET exemption. A run of
this shape is simply not dense enough to reach the budget: it spreads on the order of
a hundred page loads across several minutes, against a limit expressed per rolling
minute. For contrast, a tight loop of document GETs against the same server took
**605 requests in 2.1 s and first shed on request 600** — so the budget is real, it
just is not what a benchmark run looks like.

So the earlier worry that a default `--iterations 10` run would trip the limit did
not reproduce, and the D12 exemption is not what makes that iteration count viable.
What the exemption changes is the dense case — load generators, `perf/transport-bytes`
style measurement, or anything hammering documents from one IP. It does not make a
run unlimited either: the mandatory global budget still applies to documents,
mutation and query surfaces keep their own per-IP budgets, and an app-authored
`requestLimits.perIp` is enforced on every surface, so the checkout mutation the TTI
scenario performs is still metered.

If a run is ever refused for 429s, the integrity gate names the entrant, condition
and scenario; lower `--iterations` or space the run out.

Conditions:

- desktop: 1440x900 viewport, no explicit CPU or network throttling;
- mobile: 390x844 viewport, 4x CPU throttle, about 1.6 Mbps down, 750 Kbps up,
  and 150 ms RTT through CDP network emulation.

Lighthouse is programmatic through `chrome-launcher` and `lighthouse`, using the
same locally served app origins.

## Fairness Notes

The headline comparison is architectural. Kovo is measured as a server-rendered
MPA with no hydration and platform-native L0 dialog interaction, matching
SPEC.md interactivity levels L0/L1. Next.js App Router and TanStack Start are
measured as React SSR frameworks with hydrated client cart UI. All three apps use
the same product data and image bytes.

The benchmark does not use `next/image` for the headline run because image
optimization would change the variable under test. It is reasonable to add a
separate variant later, but the default comparison uses plain `<img>` everywhere.
