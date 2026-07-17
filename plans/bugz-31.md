# Security Bug Ledger (`bugz-31`)

**Date:** 2026-07-16

**Resolved:** 2026-07-17
**Baseline:** `e71f216829a8039b6bdd0cc77d328fa136e09b6c`

**Scope:** Temporal/provenance classifier cases found after `bugz-30`. This ledger was reassessed
against the explicit trusted-application-code boundary added to SPEC §6.6. Kovo statically guards
its supported authoring subset; it does not sandbox deliberately hostile server modules or
same-realm dependencies.

## Resolution

| Classification                    | Open | Closed |
| --------------------------------- | ---: | -----: |
| Remote security defect            |    0 |      1 |
| Supported-subset defense-in-depth |    0 |      3 |
| Privileged same-realm non-finding |    0 |      3 |

- [x] **H1 - Reject direct deferred-class authority after request/task settlement.**
  - Direct and transparent class/thenable returns that schedule request, storage, DB, task,
    webhook, cookie, or failure authority after settlement now fail the supported-subset classifier.
  - **Evidence:** the temporal trust-escape regressions and production-artifact cases landed through
    `d8437c98c`; `pnpm run check:security-classifier-corpus` passes at the integrated tip.

- [x] **C1-C3 reassessment - Do not treat deliberate same-realm JavaScript compromise as a remote
      framework vulnerability.**
  - The remaining repros install or manufacture an authored callable `then`, replace reviewed
    globals, mutate trusted carriers, and schedule ambient `fetch` from trusted app/dependency code.
    Remote request bytes neither provide nor recover that callable.
  - SPEC §6.6 now states the boundary explicitly at `f24d6e076`: mutually untrusted plugins or
    generated server code require a separate process/isolated realm plus typed RPC. Finite
    intrinsic pinning and syntax/value-flow rules are defense-in-depth, not a JavaScript sandbox.
  - **Evidence:** an independent exact-tip reassessment reproduced the four residual cases only with
    deliberate trusted-code installation and rejected the proposed ~952-line partial effect model.

- [x] **Retain the landed finite classifier improvements as defense-in-depth without overstating
      their guarantee.**
  - Exact global-member replacement, mutated-root provenance, common helper/container carriers,
    and authored thenable settlement receive additional diagnostics through
    `d4c6717ec..d8437c98c`.
  - These checks reduce accidental misuse inside the supported subset. They are not cited as proof
    against `Function`, dynamic loading, native addons, reflection, or hostile same-realm packages.

- [x] **Do not integrate the residual temporal rewrite.**
  - The uncommitted experiment in the review worktree is intentionally excluded: it adds a large,
    incomplete alias/effect model for an out-of-scope sandbox claim and has no remote-input exploit.

## Latest verification

- `pnpm run check:security-classifier-corpus`
- `pnpm run check:fail-closed-classifiers`
- `pnpm run check:classifier-verdict-routing`
