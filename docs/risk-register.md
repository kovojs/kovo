# Risk Register

This document records design risks and mitigations. It is explanatory context,
not the source of framework behavior.

| Risk                                                         | Mitigation / Position                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium-led enhancements (speculation rules, invokers)      | Graceful degradation is structural; baseline is a working website.                                                                                                                 |
| Cold-cache first-interaction latency                         | `modulepreload` from rendered attributes, 103 Early Hints, HTTP/3; measure, don't hide.                                                                                            |
| Drizzle API drift breaks inference                           | Pinned conformance suite; declared-`touches` floor always works.                                                                                                                   |
| Over-invalidation storms (coarse domains)                    | Row-level keys via schema annotations; KV403 surfaces excess.                                                                                                                      |
| `derive`/shared-client-state creep toward SPA heap           | Lints with required justifications; isomorphic opt-in is the sanctioned escape.                                                                                                    |
| Derived-optimism wrong predictions                           | All-or-nothing derivation; property-tested soundness; punts are loud; deferred to v2 so v1 ships the proven hand-written path first.                                               |
| Two-file IR + explicit data channels feel austere vs. React  | Single-file sugar + editor tooling; day-100 matters more than day-1.                                                                                                               |
| Query-binding layer moves some rendering clientward          | Bounded to paths, stamps, and named derives; complex rendering flips to fragments or isomorphic islands.                                                                           |
| Live bus introduces stateful infra                           | Deferred to v2 wholesale; the v1 server is stateless.                                                                                                                              |
| Prerender discards cost server renders                       | Off by default; per-route opt-in where renders are idempotent, plus response caching.                                                                                              |
| TypeScript unsoundness (`any`, casts) hollowing proof claims | Starter ships strict config + lint bans in app code; wire and deploy-skew boundaries are runtime-validated.                                                                        |
| Deep template-literal types slow `tsc`                       | Paths are shallow by construction; registry types stay trivial lookups, not recursive solves.                                                                                      |
| Projected children all ship in initial HTML                  | `<kovo-defer>` is the escape hatch for expensive subtrees; payload is measured by the v1 acceptance perf gate.                                                                     |
| `on:*` chaining + trigger observers grow the loader          | Gated by the S2 8KB budget before the composition API freezes.                                                                                                                     |
| Prod delta/patch applied against a stale base                | Every delta carries the render-plan version token; base mismatch fails loud and refetches full. Dev ships full self-describing payloads, so the failure mode does not exist there. |
