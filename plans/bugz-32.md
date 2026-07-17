# Security Bug Ledger (`bugz-32`)

**Date:** 2026-07-16

**Resolved:** 2026-07-17
**Baseline:** `c7d9aa11d748c293bf86c3fdff969c578e23a0cb`

**Scope:** Deploy-adapter, endpoint-lifecycle, and browser-enhancement findings from the fresh pass
after `bugz-31`. All six reproduced families are closed.

## Severity summary

| Severity | Open | Closed |
| -------- | ---: | -----: |
| High     |    0 |      1 |
| Medium   |    0 |      5 |

## High

- [x] **H1 - The Vercel preset lost authenticated client-IP and external-HTTPS provenance.**
  - The bridge used its loopback peer as the per-IP identity and reconstructed externally HTTPS
    requests as HTTP, collapsing limiter buckets and breaking CSRF/HSTS posture.
  - **Fixed:** `845cde7a2` binds Vercel-owned ingress metadata before dispatch. Direct Node still
    ignores forwarded headers unless explicitly configured.
  - **Evidence:** generated-adapter review plus `build{,-runtime-lockdown}.test.ts` (55/55).

## Medium

- [x] **M1 - Enhanced mutation dispatch discarded submitter `formaction`/`formmethod`.**
  - The loader could invoke a destructive base mutation when native submission selected a preview
    target; failure fallback also lost the submitter.
  - **Fixed:** `4f56f14a0`, `5f7481f50`, `03ab84411`, and the compiler/form-authority stack through
    `4403ce740` bind the effective target, reject unsupported typed overrides, and preserve native
    submitter semantics on fallback.

- [x] **M2 - The Cloudflare preset omitted or ambiguously trusted the platform client IP.**
  - Direct edge traffic had no per-IP shedding, while same-zone subrequests could expose a
    Worker-mutable identity.
  - **Fixed:** `845cde7a2` + `b01d6d3ba` bind direct-edge facts and fail ambiguous Worker ingress
    before handler import.
  - **Evidence:** independent re-review and the 55/55 generated-adapter suite.

- [x] **M3 - Endpoint CSRF/effect posture recognized only four unsafe verbs and let safe methods
      retain write/browser-state authority.**
  - **Fixed:** `05eb90f78`, `b7a1de4e3`, and `71b51311b` define the closed safe-method set, gate
    unknown/custom methods, remove safe-method Writer/browser-state authority without an executable
    verifier, and print `csrf=safe:read-only` instead of the false `checked` claim.
  - **Evidence:** endpoint/app-dispatch/CSRF/audit regressions plus the synchronized docs-output gate.

- [x] **M4 - Enhanced clients sent URL fragments in `Kovo-Current-Url`.**
  - OAuth/history fragments could reach mutation handlers and no-Referer fallback redirects even
    though SPEC §9.1 excludes fragments from the source-document URL.
  - **Fixed:** `4f56f14a0` strips fragments client-side and rejects/normalizes them at server ingress;
    `7d394096e` proves redirect isolation.

- [x] **M5 - Inline enhancement admitted foreign/non-mutation forms and both runtimes trusted
      wrong-origin or wrong-media responses.**
  - A CORS-enabled foreign endpoint could receive mutation metadata/body and return Kovo-shaped UI
    vocabulary for application inside the app origin.
  - **Fixed:** `4f56f14a0`, `85d88f616`, `461a797d1`, `335e9cb31`, `65018b3aa`, and the ownership
    stack through `4403ce740` enforce same-origin `POST /_m/` eligibility, exact mutation media and
    final-origin checks, opaque-origin denial, and document-wide typed form ownership.

## Latest verification

- Browser/runtime affected suite: 363/363.
- Server affected suite: 839/839.
- `pnpm run check:vp`
- `pnpm run check:api-surface`
- `pnpm run check:docs-snippets`
