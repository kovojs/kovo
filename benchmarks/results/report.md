# Benchmark Report

Generated: 2026-06-23T06:08:13.864Z

## Methodology

Each app renders the same 24-product catalog, serves the same WebP assets, and exposes the same listing, product detail, cart dialog, and checkout confirmation flow. The custom harness uses fresh browser contexts, cache-cleared runs, Chromium CDP throttling for the mobile profile, request-size accounting, a cart-dialog TTI proxy, and a navigation probe. Lighthouse runs cover the listing and one product detail page for desktop and mobile presets.

The headline comparison is architectural, not a claim that one implementation is the only possible tuning for each framework: Kovo is measured as a server-rendered MPA with a platform-native L0 cart dialog and no hydration, while Next.js App Router and TanStack Start are measured with hydrated client cart UI. All apps use plain `<img>` tags to isolate framework behavior from image optimizer behavior.

## Versions

| App | Framework | Key versions |
| --- | --- | --- |
| kovo | Kovo | kovo workspace:* |
| nextjs | Next.js App Router | next 16.2.9, react 19.2.7, react-dom 19.2.7 |
| tanstack | TanStack Start | @tanstack/react-start 1.168.26, @tanstack/react-router 1.168.26, react 19.2.7, react-dom 19.2.7 |

## Custom Harness Medians

### Desktop

| App | FCP ms | LCP ms | TBT ms | JS bytes | Total bytes | TTI proxy ms | Nav detail ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| kovo | 24 | 24 | 0 | 0 | 165271 | 14 | 49 |
| nextjs | 32 | 32 | 0 | 152515 | 203044 | 59 | 49 |
| tanstack | 40 | 40 | 0 | 331500 | 351929 | 71 | 50 |

### Mobile

| App | FCP ms | LCP ms | TBT ms | JS bytes | Total bytes | TTI proxy ms | Nav detail ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| kovo | 980 | 980 | 0 | 0 | 162989 | 987 | 102 |
| nextjs | 416 | 416 | 11 | 152515 | 161975 | 1241 | 114 |
| tanstack | 432 | 432 | 0 | 331500 | 350881 | 2067 | 111 |

## Lighthouse

| App | Form factor | Path | Perf | FCP ms | LCP ms | TBT ms | TTI ms | Bytes |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| kovo | desktop | / | 85 | 1534 | 1909 | 0 | 1932 | 188832 |
| kovo | desktop | /product/linen-field-jacket | 88 | 1509 | 1659 | 0 | 1659 | 147646 |
| kovo | mobile | / | 99 | 1505 | 1730 | 0 | 1752 | 165271 |
| kovo | mobile | /product/linen-field-jacket | 99 | 1510 | 1660 | 0 | 1660 | 147646 |
| nextjs | desktop | / | 89 | 753 | 2171 | 9 | 2269 | 205803 |
| nextjs | desktop | /product/linen-field-jacket | 90 | 757 | 2085 | 2 | 2092 | 163968 |
| nextjs | mobile | / | 98 | 754 | 2481 | 3 | 2488 | 176660 |
| nextjs | mobile | /product/linen-field-jacket | 99 | 754 | 2083 | 2 | 2091 | 163968 |
| tanstack | desktop | / | 67 | 2856 | 3006 | 0 | 3021 | 353474 |
| tanstack | desktop | /product/linen-field-jacket | 70 | 2704 | 2704 | 0 | 2704 | 338391 |
| tanstack | mobile | / | 89 | 2861 | 3011 | 0 | 3026 | 351929 |
| tanstack | mobile | /product/linen-field-jacket | 92 | 2703 | 2703 | 0 | 2703 | 338391 |

## Conditions

- Desktop: Chromium, 1440x900 viewport, no CPU or network throttling.
- Mobile: Chromium, 390x844 viewport, 4x CPU throttle, about 1.6 Mbps down / 750 Kbps up / 150 ms RTT.
- Iterations per app, condition, and custom scenario: 10.

