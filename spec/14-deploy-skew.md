# Deploy Skew & Version Recovery (SPEC §14)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 14. Deploy Skew & Version Recovery

A long-open tab, a stale prerender, or a cached document may outlive the build it was produced by. Kovo makes this **loud and recoverable** rather than silently wrong (§9.1.1): a payload whose render-plan version token (§5.2.1) does not match the receiver is never merged.

**Recovery contract (normative).** On a token mismatch the client MUST NOT apply the delta, the `/_q/` read, or the fragment merge. It instead refetches the full value over the typed read endpoint (`/_q/<key>`, §9.4). If the refetch itself returns a token that still differs from the document token, the document is fundamentally skewed: the client performs a full navigation reload of the current route so the document, its modules, and its query bases are all reissued against one build. Optimistic state on a discarded delta is reconciled or rolled back per §10.4; recovery never promotes an unconfirmed prediction. Recovery is idempotent and side-effect-free: it issues GETs and, at most, one reload.

**Prior-version retention window (required minimum).** The serving layer MUST retain prior immutable artifacts so a skewed document can recover without a 404. For the **supported deploy-skew window** (§6.6) — a deployment-configured duration with a normative floor of **24 hours** of wall-clock retention across redeploys, configurable upward but not below the floor — the server MUST keep resolving: (a) every emitted immutable client-module URL `/c/__v/<version>/<module>` (§9.5) and its generated-ABI imports, and (b) the `/_q/<key>` read surface for every prior in-window token, returning a token-tagged full value the stale document can recover from. An interaction or refetch from an in-window document MUST NOT 404 (§6.6). Artifacts older than the window MAY be evicted; a request for an out-of-window version is answered as a build-skew event that triggers the full navigation reload above, never a silent stale patch. A deployment that cannot meet the retention floor MUST surface the gap; shipping a window below the floor is **KV417**.
