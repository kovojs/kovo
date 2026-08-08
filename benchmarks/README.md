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
`--settle-quiet-ms` / `--settle-max-ms`.

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
  document, and what the superseded DOM-presence probe would have reported;
- back/forward cache: a separate probe in full Chromium with Playwright's
  `--disable-back-forward-cache` removed (the default `chrome-headless-shell`
  cannot participate in bfcache at all). Frameworks that navigate in-document are
  reported `n/a` rather than scored as non-restores.

The run aborts rather than publishing if a port is already held, if a server exits
early, if a server reports development posture under `NODE_ENV=production`, or if
any request was rate-limited or returned `>= 400`.

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
