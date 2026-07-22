# Deploy Skew & Version Recovery (SPEC §14)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 14. Deploy Skew & Version Recovery

A long-open tab, a stale prerender, or a cached document may outlive the build it was produced by. Kovo makes this **loud and recoverable** rather than silently wrong (§9.1.1): a payload whose app build token (§5.2.1) does not match the receiver is never merged.

**Recovery contract (normative).** On a token mismatch the client MUST NOT apply the delta, the `/_q/` read, or the fragment merge. It instead refetches the full value over the typed read endpoint (`/_q/<key>`, §9.4). If the refetch itself returns a token that still differs from the document token, the document is fundamentally skewed: the client performs a full navigation reload of the current route so the document, its modules, and its query bases are all reissued against one build. Optimistic state on a discarded delta is reconciled or rolled back per §10.4; recovery never promotes an unconfirmed prediction. Recovery is idempotent and side-effect-free: it issues GETs and, at most, one reload.

**Build-bound request routing (normative).** Every enhanced `/_q/` read and every enhanced mutation
or HMR request MUST carry the immutable document app build token in `Kovo-Build`. Mutation dispatch
recognizes enhanced traffic from the framework fragment, target, live-target, form-target,
idempotency, and streaming carriers; a matching build header alone does not classify a native form
as enhanced. A serving layer may route build-bound traffic only to the exact retained app/decoder
identified by the token. Once dispatched to one app build, a missing or unequal token is rejected
before query-key decoding, either target-header decoder, query/component selection, or mutation
handler work. That typed 409 carries the current app build token, the framework-reserved
`Kovo-Build-Skew: true` marker, and the inline fragment envelope. The marker has meaning only on
that admitted 409; an unmarked application 409 is an ordinary typed conflict. App response channels
cannot mint or override the marker. Equality proves compatibility only, never authentication. The
sole prior-token override is the explicit `oldBuild` selector on the Vite-dev-only HMR endpoint
(§9.5.1); production dispatch has no exception and no heuristic dual decoder.

**Prior-version retention window (required minimum).** The serving layer MUST retain prior immutable artifacts so a skewed document can recover without a 404. For the **supported deploy-skew window** (§6.6) — a deployment-configured duration with a normative floor of **24 hours** of wall-clock retention across redeploys, configurable upward but not below the floor — the server MUST keep resolving: (a) every emitted immutable client-module URL `/c/__v/<representation-digest>/<module>` (§9.5) and its generated-ABI imports, and (b) the `/_q/<key>` read surface for every prior in-window app build token, returning a token-tagged full value the stale document can recover from. An interaction or refetch from an in-window document MUST NOT 404 (§6.6). The current active-module manifest used to derive a new app build token is distinct from this retained resolver history: history never enters the token merely because it is still resolvable, while simultaneous active representations of one logical path remain distinct exact hrefs. Artifacts older than the window MAY be evicted; a request for an out-of-window digest/token is answered as a build-skew event that triggers the full navigation reload above, never a silent stale patch. Retention MUST survive process restart and cover every serving replica; the default in-memory store does not prove that production property. A deployment that cannot meet the retention floor MUST surface the gap; shipping a window below the floor is **KV417**.
