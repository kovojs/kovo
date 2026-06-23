# Performance Benchmark: Kovo vs Next.js vs TanStack Start

## Context

A credible, reproducible head-to-head performance benchmark of **Kovo** against
the two leading React meta-frameworks — **Next.js (App Router)** and **TanStack
Start** — using a realistic-ish e-commerce app built to each framework's
production best practices.

The axis under test: Kovo is a **server-rendered MPA with no hydration** — the
implemented entrant uses platform-native L0 dialog interaction (SPEC §4
interactivity levels L0/L1). Next.js (RSC) and TanStack Start are **React
frameworks that ship and hydrate a client bundle**. The
benchmark is designed to expose where that difference shows up: initial
bytes/paint, **time-to-interactive (click → JS responds)**, and page navigation.

User decisions (confirmed): fresh parallel trio (not reuse of
`examples/commerce`); measure **both** desktop-unthrottled and mobile-throttled;
**custom Playwright harness + Lighthouse**.

This benchmark is **standalone** under `benchmarks/`; the only existing repo file
touched is `pnpm-workspace.yaml` (one line). No framework code changes.

## Directory layout

```
benchmarks/
  README.md                # build/run commands, methodology, fairness notes
  shared/
    catalog.json           # 24 products (id, slug, name, price, blurb, img)
    images/                 # ~8 identical small WebP assets, reused across apps
  kovo/                    # Kovo entrant  (IN pnpm workspace; uses @kovojs/* workspace deps)
  nextjs/                  # Next.js App Router entrant (ISOLATED install, NOT a workspace member)
  tanstack/               # TanStack Start entrant      (ISOLATED install, NOT a workspace member)
  harness/                 # Playwright + Lighthouse measurement runner (own package.json)
    run.mjs                # build? -> serve -> drive -> collect
    scenarios.mjs          # cold load, TTI probe, navigation
    lighthouse.mjs         # programmatic Lighthouse (mobile + desktop presets)
    report.mjs             # results.json -> report.md tables
  results/
    results.json           # raw per-run metrics
    report.md              # comparison tables + narrative + fairness disclaimers
  run-all.mjs              # orchestrator: build all 3, run harness x conditions, write report
```

**Workspace boundary (critical):** `pnpm-workspace.yaml` globs are explicit
(`packages/*`, `examples/*`, …). Add **only** `benchmarks/kovo` (it needs
`@kovojs/*` `workspace:*` deps). Keep `nextjs/`, `tanstack/`, `harness/` OUT of
the workspace; install them with their own lockfile via
`pnpm install --ignore-workspace` (or `npm install`) so React/Next deps never
leak into the monorepo.

## App spec (identical across all three)

- **`/` Listing:** nav bar (logo + `Cart (n)` button) + responsive grid of 24
  product cards (image, name, price, "Add to cart"); cards link to detail.
- **`/product/<slug>` Detail:** large image, name, price, blurb, qty, "Add to
  cart", "Review cart".
- **Cart dialog/form** (not a route): modal opened by `Cart` / `Review cart`;
  Kovo uses native L0 popover controls, while Next.js and TanStack use hydrated
  client JS. The dialog contains line-item/total copy and a small checkout form
  (name, email, Place order → confirmation). **This is the TTI probe target.**
- **Data:** shared `benchmarks/shared/catalog.json` rendered server-side. Cart is
  **client-only session state** (no DB) — keeps the comparison framework-pure.
- **Images:** identical small WebP set, plain `<img>` with explicit
  `width`/`height` + `loading="lazy"` in **all three**, to isolate the framework
  variable. (`next/image` noted in the report as a variant; headline run uses
  plain `<img>` everywhere.)

## Per-framework production build (best practices)

| Framework                               | Authoring                                                                                                                                                    | Build                                    | Serve                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------- |
| **Kovo**                                | `route()` in `src/app.tsx`; server-rendered listing/detail; cart dialog via platform-native popover controls to exercise SPEC §4 L0 no-hydration interaction | `kovo build ./src/app.tsx --preset node` | `node dist/server/server.mjs` |
| **Next.js** (App Router, latest stable) | Server Components for listing/detail; `next/link` nav; `'use client'` cart dialog + cart store; `output:'standalone'`                                        | `next build`                             | `next start`                  |
| **TanStack Start** (latest stable)      | file-based routes, SSR + streaming; `Link` nav; client cart dialog component                                                                                 | framework prod build                     | its node server entry         |

Reference Kovo files: `examples/commerce/src/app.tsx` (routes),
`examples/commerce/src/components/cart-badge.tsx` (component+query),
`examples/gallery/src/interactive/dialog-demo.tsx` (interactive dialog/handlers).

## Measurement harness

Playwright (chromium, existing repo dep) + CDP. For each **app × condition**, run
**N=10** iterations per scenario in a **fresh, cache-cleared context**; report
**median, p75, min**.

- **Conditions:** (a) desktop unthrottled; (b) mobile-throttled — CDP
  `Emulation.setCPUThrottlingRate(4)` + `Network.emulateNetworkConditions`
  (~1.6 Mbps down / 750 Kbps up / 150 ms RTT). Profiles documented in the report.
- **Cold load (listing):** FCP, LCP, DOMContentLoaded, load, Total Blocking Time
  (Long Tasks observer), **bytes over the wire** (`response.encodedDataLength`)
  broken down by HTML/JS/CSS/img, request count.
- **TTI / click-to-interactive probe (differentiator):** from navigation start,
  a tight in-page poll loop keeps attempting `Cart`/`Review cart` and resolves
  the instant `[role=dialog]` is visible. `TTI_proxy = t_open − navigationStart`;
  also "time to first successful click". Captures React hydration dead-time vs
  Kovo first-click `import()` latency.
- **Navigation:** click a product card → time until detail main content (h1 / LCP
  image) painted; record nav bytes. SPA client nav (Next/TanStack) vs MPA nav
  (Kovo, incl. Speculation-Rules enhanced nav).
- **Lighthouse pass:** programmatic per app for `/` + a detail page, mobile +
  desktop presets → Performance score, FCP, LCP, TBT, TTI, Speed Index, total
  byte weight. Cross-checks the custom harness.
- **Output:** `results/results.json` + `results/report.md` (side-by-side tables,
  medians + deltas, narrative, **fairness/methodology** section: versions,
  hardware, conditions, MPA-vs-SPA caveat, plain-`<img>` choice).

## Checklist

- [x] Scaffold `benchmarks/` tree, `shared/catalog.json`, WebP image assets,
      harness skeleton, `run-all.mjs`; add `benchmarks/kovo` to `pnpm-workspace.yaml`.
  - Evidence: `pnpm-workspace.yaml`; `benchmarks/README.md`; `benchmarks/shared/catalog.json`; `benchmarks/run-all.mjs`.
- [x] **Kovo app** — builds via `kovo build --preset node`, serves on a port,
      renders all 3 pages, cart dialog opens + checkout form submits.
  - Evidence: `pnpm --dir benchmarks/kovo run build`; `node benchmarks/run-all.mjs --skip-build` completed N=10 custom scenarios and Lighthouse.
- [x] **Next.js app** — App Router, `output:'standalone'`, `next build`/`next
start`, 1:1 parity (same 24 products, same dialog/form, same nav).
  - Evidence: `pnpm --dir benchmarks/nextjs run build`; `benchmarks/results/report.md` includes Next.js custom and Lighthouse rows.
- [x] **TanStack Start app** — SSR prod build + node server, 1:1 parity.
  - Evidence: `pnpm --dir benchmarks/tanstack run build`; `benchmarks/results/report.md` includes TanStack custom and Lighthouse rows.
- [x] **Harness** — scenarios (cold load, TTI probe, navigation), CDP metric
      collection, both throttle conditions, N=10 median/p75, validated vs first app.
  - Evidence: `node benchmarks/run-all.mjs --skip-build` produced 10 iterations per app/condition/scenario in `benchmarks/results/results.json`.
- [x] **Lighthouse** — programmatic mobile+desktop pass per app, scores populate.
  - Evidence: `benchmarks/results/report.md` has 12 Lighthouse rows: 3 apps × 2 routes × 2 form factors.
- [x] **Integrate + run** — build all three, full N across both conditions,
      generate `results/report.md`, sanity-check (expect Kovo JS bytes ≪ others).
  - Evidence: `benchmarks/results/report.md` shows Kovo custom cold-load JS bytes 0 vs Next.js 152515 and TanStack 331500.
- [x] **README** — exact build/run commands + methodology + fairness disclaimers.
  - Evidence: `benchmarks/README.md` documents install/build/run commands, methodology, and fairness notes.

## Sequencing (fan-out)

1. Scaffold + shared data (main worktree).
2. Three apps **in parallel** — independent slices, each a sub-agent in its own
   worktree owning one app dir (per `AGENTS.md` fan-out rules); strict 1:1 parity.
3. Harness (after one app serves) — scenarios, CDP, Lighthouse, report.
4. Integrate, run full benchmark, generate report.

## Verification

- Each app: prod build succeeds; `curl` `/` + a detail page; Playwright sanity
  that the cart dialog opens and the checkout form submits.
- 1:1 parity confirmed: same 24 products, same dialog/form, same nav targets.
- Harness smoke run N=2, then full N=10; all metrics populate; byte breakdowns
  plausible (Kovo JS ≪ Next/TanStack).
- Lighthouse completes; Performance scores land for all three.
- `benchmarks/results/report.md` renders coherent side-by-side tables;
  `benchmarks/README.md` documents commands + methodology.

## Risks / notes

- Network installs required for Next.js, TanStack Start, Lighthouse.
- TanStack Start is younger / API churn → pin a known-good latest-stable version
  via its official template; isolate its install from the workspace.
- Fairness framing matters for credibility — report must state versions,
  conditions, and the MPA-vs-SPA architectural caveat (not a strawman win).
- Three prod servers + browser → deterministic ports + ready-waits in orchestrator.
