---
title: Risk register
description: Active design risks that shape Kovo's public docs and implementation priorities.
order: 6
---

# Risk register

The main guides describe the intended path. The risk register records pressure points that need extra
care in implementation and docs. The source ledger is
[`docs/risk-register.md`](https://github.com/kovojs/kovo/blob/main/docs/risk-register.md).

High-value risks for app authors to understand:

- **Type soundness boundaries.** Kovo's guarantees rely on strict TypeScript and runtime validation at
  the wire, deploy-skew, and CSRF boundaries.
- **Public API shape.** Public symbols must be manifest-declared and documented; raw source and
  internal subpaths are not app dependencies.
- **Stateful islands inside server-refreshable regions.** Local island state is not serialized through
  fragment refreshes; KV420 protects this boundary.
- **Deploy skew.** Long-lived documents must keep resolving versioned client modules and typed query
  reads for the supported retention window.
- **Data-layer analyzability.** Drizzle analysis follows real table identity and pinned dialect
  surfaces; raw SQL and opaque projections require explicit declarations.

When a guide links here, treat it as a signal that a small-looking API choice carries framework-level
invariants.
