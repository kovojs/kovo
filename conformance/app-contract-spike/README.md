# D1 app-contract spike

This package executes the preregistered D1 v6 comparison in
[`criteria-v6.json`](./criteria-v6.json). Earlier v1-v5 evidence is invalid for the reasons recorded
in that file.

The measurement builds and packs exactly `@kovojs/browser`, `@kovojs/compiler`, `@kovojs/core`, and
`@kovojs/server`; extracts those tarballs; authenticates `dist/index.mjs` and `dist/internal.mjs`
against the compiler tarball content subject; links the compiler's browser and core dependencies
from their authenticated extracted package subjects; and dynamically imports those extracted
entrypoints. The matrix, public-forgery probes, exact-source project resolver, IR comparison, and
graph comparison all execute through those loaded modules. Workspace compiler, browser, and core
imports are not part of the measurement path.

Run:

```sh
pnpm --filter @kovojs/conformance-app-contract-spike measure
pnpm --filter @kovojs/conformance-app-contract-spike test
pnpm --filter @kovojs/conformance-app-contract-spike measure:verify
```

`measure` requires a clean source tree and refreshes `raw-evidence-v6.json` and `results-v6.json`.
`measure:verify` rebuilds and reruns both arms, reevaluates committed evidence, compares all gate
verdicts, and compares deterministic evidence exactly while recomputing timing summaries from fresh
samples. D1 closure requires two consecutive clean `measure:verify` passes.

The v6 evaluator makes these claims enforcement-bearing:

- all 19 matrix rows per arm, including direct/named/star/same-owner duplicate-package paths;
- a separate nested app-derived receiver fail-closed probe and unrelated same-named-member negative;
- exact canonical full IR and graph equality for all six declaration families, plus add/delete/change
  adversarial mutations;
- runtime, compiled, generated, source-file, physical-package, and packed-compiler bindings;
- provider, config, compiler, server, generated-module, and completion-token generator mutations;
- all six measurement orders in complete blocks and explicit runner metadata.

No result from this package changes `SPEC.md` or the active plan automatically. The plan owner must
review the committed evidence and decision before adopting the proposed API.
