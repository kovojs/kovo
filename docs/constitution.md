# Jiso Constitution

`SPEC.md` is the source of truth for framework behavior. This page is the repo-facing normative summary of SPEC section 2.

Every shipped feature must satisfy these design tests:

1. Legibility is load-bearing. Runtime names that appear in HTML attributes, wire traffic, or graph output must remain readable and must not depend on minifier-only semantics.
2. Local code must not require global knowledge. Authors should declare the local fact once and let generated registries, graphs, and checks derive distant consequences.
3. Sugar must lower to authorable IR. Generated output must be valid Jiso source, and compiling generated output must be a no-op; that property keeps output auditable and mechanically checked while app authors still write TSX.
4. The wire is the documentation. Mutation names, response headers, fragments, query JSON, and diagnostics must stay readable from the Network panel and test fixtures.
5. Server truth always wins. Optimistic UI is provisional and reconciles by morphing authoritative server output.

If a proposal conflicts with this page, update `SPEC.md` first or reject the proposal.
