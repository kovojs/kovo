# Kovo Constitution

`SPEC.md` is the source of truth for framework behavior. This page is the standing rule summary of SPEC section 2.

The overriding commitment is the **Prime Principle**: **security is by construction.** A feature crossing a trust boundary (data in, data out, who may act, how much) makes the unsafe state inexpressible at compile time wherever static analysis can prove it (AST symbol-identity provenance, never a branded type or runtime taint — both unsound), falls back to a fail-closed runtime floor where it cannot, and routes every exception through an audited escape hatch in `kovo explain`. Default-deny over default-allow; brands are defense-in-depth, not the mechanism; runtime floors are labeled as floors, never sold as proofs. It is the first primary goal (§1.1) and is delivered by the five tests below.

Every shipped feature must satisfy the Prime Principle and these design tests:

1. Legibility is load-bearing. Runtime names that appear in HTML attributes, wire traffic, or graph output must remain readable and must not depend on minifier-only semantics; legibility is also what makes the Prime Principle auditable without a browser.
2. Local code must not require global knowledge. Authors declare the local fact once — including security facts (`secret`/`owner`/`governed`/`access`) — and let generated registries, graphs, and checks derive distant consequences.
3. Sugar must lower to authorable IR. Generated output must be valid Kovo source, and compiling generated output must be a no-op; that property keeps output auditable and mechanically checked while app authors still write TSX.
4. The wire is the documentation. Mutation names, response headers, fragments, query JSON, and diagnostics must stay readable from the Network panel and test fixtures; and the wire documents what the server chose to send — a `secret`-classified field is ineligible to reach the client, so legibility and confidentiality coexist by construction.
5. Server truth always wins. Optimistic UI is provisional and reconciles by morphing authoritative server output.

If a proposal conflicts with this page, update `SPEC.md` first or reject the proposal.
