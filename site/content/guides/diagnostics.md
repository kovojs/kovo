---
title: Diagnostics reference (KV codes)
description: One indexed table of every KV diagnostic code Kovo defines — what it catches, why it fires, and how to fix it.
order: 9.5
---

# Diagnostics reference (KV codes)

Kovo's checks speak in KV codes. Each one is a contract violation with a fixed severity from the
shared `diagnosticDefinitions` registry — surfaces (Vite transform, `kovo check`, the editor, MCP)
render the same code, severity, and help, and may not override severity or invent local blocking
policy (SPEC §11.3). This guide is the single lookup. The codes are scattered across the other guides'
footers and across `SPEC.md`; here they are collected and grouped, every entry sourced from the SPEC
registry (SPEC §11.3) unless a tighter section is cited.

## How severity maps to behavior

The severity column is load-bearing, not advisory (SPEC §11.3):

- **error** — blocks the Vite dev transform (teaching error in the overlay and terminal), blocks build
  and static export before output is written, and makes dependent dev page/fragment/mutation requests
  return a server-rendered teaching-error document with HTTP 500.
- **warn**, **lint**, **notice** — non-blocking on transform, build, and export; summarized or streamed
  through the surface's non-blocking channel. Coverage warnings (KV310, KV311) are suppressible, but
  the suppression is recorded in source rather than left silent.
- **internal** — fixpoint/IR invariants that should never reach an app author; a bug if seen.

The asymmetry in the verification family is deliberate: **excess** declaration degrades to a warning
and to over-invalidation (wasteful but correct), while **missing** declaration is an error, because it
means UI renders stale with no error anywhere — the bug class the layer exists to kill.

## Compiler, lowering & authoring (KV201–KV242)

These police the boundary between authored TSX and emitted IR: serializable closures, the closed
trigger/event sets, derived stamps, the HTML content model, and registry-key uniqueness. Source:
SPEC §11.3 registry; cross-referenced to §4 (component model), §5.2 (hard rules), §6.1.1 (prefixes),
§8 (navigation), §9 (wire/request shell).

| Code  | Severity | Meaning                                  | Cause                                                                                    | Fix                                                                         |
| ----- | -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| KV201 | error    | Unserializable closure capture           | A handler closure captures a value that can't be serialized to the wire                  | Pass it as a serializable prop/stamp; the diagnostic shows lowering + fixes |
| KV210 | lint     | Anonymous handler                        | A handler has no stable name, so its identity isn't stable across renders                | Name the handler                                                            |
| KV211 | lint     | `on:load` eager trigger                  | An eager (non-interaction) trigger ships JS up front — the eager-JS budget               | Add the required justification comment, or move to an interaction trigger   |
| KV212 | lint     | Unknown `on:*` event or trigger          | An `on:*` name isn't a DOM event or a member of the closed trigger set (§4.7)            | Use a known event/trigger name                                              |
| KV220 | error    | `href`/`action` matches no route         | A literal `href` or form `action` doesn't match any declared route                       | Fix the path, or opt out with a full-origin URL / `external`                |
| KV221 | error    | IDREF target not in scope                | `commandfor`/`popovertarget`/`for`/`aria-*` references an id not in scope                | Reference an id present in the same scope                                   |
| KV222 | error    | Hand-written binding stamp disagrees     | A hand-written stamp contradicts the typed expression it wraps (§4.8)                    | Delete the stamp and let the compiler derive it                             |
| KV223 | lint     | Redundant hand-written stamp             | A hand-written stamp in sugar duplicates what the compiler derives (§4.8)                | Remove the redundant stamp                                                  |
| KV224 | error    | Static `id` in repeatable / duplicate id | A static `id` in a repeatable component, or a duplicate id in a page (§4.5)              | Use `key`/derived identity; make ids unique per composition                 |
| KV225 | error    | JSX violates HTML content model          | The parser would re-parent the nesting at runtime (§4.2)                                 | Restructure to valid HTML nesting                                           |
| KV226 | internal | Unknown `kovo-deps`/`kovo-c` name        | Emitted IR fixpoint names an unknown query instance or component                         | Compiler bug — not author-facing                                            |
| KV227 | error    | Nullable binding path without `?.`       | A binding path traverses a nullable segment without `?.` or a null derive (§4.8)         | Add `?.` or a null-handling derive                                          |
| KV228 | error    | Ambiguous route table                    | Two routes can match the same canonical path, or a duplicate path (§9.5)                 | Disambiguate the route table                                                |
| KV229 | error    | Static export constraint violation       | A route/session/mutation/param usage can't be exported as L0/L1 (§9.5)                   | Make it static, or exclude per export policy                                |
| KV230 | error    | Fragment-target children not lowerable   | Fragment-target children don't reduce to a component reference                           | Hoist into a component (the diagnostic shows the hoisting)                  |
| KV231 | error    | Unmergeable attribute conflict           | Primitive composition has conflicting attributes that can't merge (§4.6)                 | Resolve per the §4.6 merge rule (shown in the error)                        |
| KV232 | lint     | Override of primitive-owned attribute    | Author overrides a primitive-owned ARIA/state attribute                                  | Let the primitive own it, or use the documented override                    |
| KV233 | error    | Two writers for one binding target       | Two sources write the same binding target                                                | Leave one writer for the target                                             |
| KV234 | error    | Package prefix conflict                  | A package component prefix registration conflicts or violates a reservation (§6.1.1)     | Choose a non-conflicting prefix                                             |
| KV235 | error    | Hand-authored lowered IR                 | App source hand-writes lowered IR / string-rendered components / derivable stamps (§5.2) | Write TSX (`queries`, `key`, typed expressions); let the compiler emit IR   |
| KV236 | error    | Unsafe output context                    | An unsafe output context is used without an explicit trusted escape hatch (§1, §5.2)     | Use the trusted Kovo escape hatch deliberately                              |
| KV237 | error    | Duplicate derived component registry key | Two components derive the same registry key (§4.2, §4.8, §6.1.1)                         | Disambiguate the component identity                                         |
| KV238 | error    | Duplicate fragment-target registry key   | Two fragment targets derive the same registry key (§4.5, §6.2, §9.1)                     | Disambiguate the target identity                                            |
| KV239 | error    | Duplicate view-transition name           | Two elements share a static view-transition name (§8)                                    | Use distinct `view-transition-name` values                                  |
| KV240 | error    | Duplicate query-shape fact               | Two query-shape facts exist for one query name (§4.8)                                    | Resolve the conflicting shape declaration                                   |
| KV241 | warn     | Derived component key changed            | A derived component registry key changed since the previous emitted graph                | Confirm the identity change is intended; commit the new graph               |
| KV242 | error    | Form control names mismatch input schema | Enhanced mutation form control `name`s don't match the bound input schema (§6.2, §6.3)   | Match the `name`s to the input schema fields                                |

## Islands, state & update coverage (KV301–KV320)

These keep server truth out of island-local state and ensure every query/state-dependent DOM position
has a declared update strategy. Source: SPEC §11.3; cross-referenced to §4.8–§4.9 (update plan and
coverage), §10.6 (optimistic exhaustiveness).

| Code  | Severity | Meaning                                      | Cause                                                                                         | Fix                                                                       |
| ----- | -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| KV301 | lint     | Server fact in island-local state            | An island stores a server-owned fact in local state                                           | Read it from the query instead of mirroring it                            |
| KV302 | error    | `data-bind` path not in query shape          | A `data-bind` path doesn't exist in the declared query shape (§4.8)                           | Bind a path the query actually ships                                      |
| KV303 | error    | Refresh-target input not declared            | An inferred refresh-target render input isn't query data or stamped serializable props (§4.5) | Declare it as query data or serializable stamped props                    |
| KV304 | error    | Reserved query name                          | A query uses a reserved name such as `state` (§4.8 binding roots)                             | Rename the query                                                          |
| KV310 | warn     | Invalidated query lacks optimistic transform | An invalidated query has no transform / defer / derive (§10.6)                                | Hand-write a transform, declare `'await-fragment'`, or rely on derivation |
| KV311 | warn     | DOM position with no update status           | A query/state-dependent position has no update status (§4.9)                                  | Give it plan / isomorphic / fragment / renderOnce coverage                |
| KV320 | lint     | Event payload overlaps query data            | A fire-and-forget event payload overlaps server query data                                    | Use an optimistic transform instead of sending server facts               |

## Data access (KV330)

Source: SPEC §11.3; §10.3 (writes route through domains). See [the data-layer guide](/guides/data-layer/).

| Code  | Severity | Meaning                       | Cause                                                       | Fix                                      |
| ----- | -------- | ----------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| KV330 | lint     | Direct db access in a handler | A mutation handler calls `db.insert/update/delete` directly | Route the write through a `domain` write |

## Touch-graph verification (KV402–KV411)

The 4xx family polices the boundary between declared dataflow and actual dataflow — from both the
write side and the read side — and is the family the runtime verifier enforces via `observed ⊆ static
∪ KV406-declared`. Source: SPEC §11.3 registry; the verification mechanics in SPEC §11.1–§11.2 and the
write/read rules in §10.1–§10.2. See [testing](/guides/testing/).

| Code  | Severity | Meaning                               | Cause                                                                                | Fix / note                                                    |
| ----- | -------- | ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| KV402 | error    | Write touched an undeclared domain    | A write touches a domain the static graph didn't list — silent stale UI              | Add the domain to the write's touch set (or fix the write)    |
| KV403 | warn     | Declared domain never observed        | A declared domain was never actually written — stale claim or untested branch        | Remove the claim, or add a test exercising the branch         |
| KV404 | error    | Write to an unmapped table            | A write hit a table with no `kovo({ domain })` mapping (write-side only, §10.1)      | Map the table, or mark `kovo({ exempt: true })`               |
| KV405 | error    | Unexecuted conditional writes         | Conditional write branches were never executed under instrumentation                 | Add coverage so the branches run, or confirm they're dead     |
| KV406 | error    | Statically un-analyzable write site   | A write the static pass can't follow (raw SQL, node_modules helper, §11.1)           | Declare manual `touches` and `tables:` for raw SQL; runtime-verified |
| KV407 | error    | Query read from an undeclared domain  | A query reads a domain not in its declared read set — missed invalidations           | Add the domain to the query's `reads`                         |
| KV408 | error    | Declared row key != observed predicate | The declared row key disagrees with the observed row predicate                      | Align the declared key with the actual WHERE predicate        |
| KV409 | notice   | Non-eq predicate degraded             | A non-eq predicate degraded invalidation to table level                              | Acceptable; use eq on the key column for row-level keys       |
| KV410 | error    | Opaque projection without schema      | A `sql<T>` / raw projection has no declared output schema (§10.2)                    | Declare an `s.*` output schema; the shape is runtime-verified |
| KV411 | error    | Query reads an `exempt` table         | A query's read set includes an `exempt` table — exemption is write-side only (§10.1) | Map the table instead; `exempt` is for tables nothing queries |

## Advanced app-flow diagnostics (KV414–KV420)

These newer diagnostics cover the app-authoring surfaces that cross security, transport, deployment,
and fragment refresh. Source: SPEC §11.3 with tighter references below.

| Code  | Severity | Meaning                             | Cause                                                                 | Fix / note                                                                 |
| ----- | -------- | ----------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| KV414 | error    | IDOR ownership gap                  | An `owner:` table is reached through a key not traceable to session or `owns()` | Scope by `req.session`, add an `owns()` guard, or record a public-read justification |
| KV415 | error    | Unsafe response header channel      | Header name/value is outside the typed allowlist or contains CR/LF/NUL/control chars | Use typed header/cookie builders; reject rather than sanitize              |
| KV416 | error    | Prod render-equivalence failed      | Delta output cannot reconstruct the dev full render, or a query/update-plan shape changed without moving the token | Fix the delta/update-plan path or move the render-plan token               |
| KV417 | error    | Deploy-skew retention is too weak   | The serving layer cannot keep prior `/c/__v/*` modules and prior-token `/_q/` reads for at least 24 hours | Increase retention or change hosting shape                                 |
| KV418 | error    | Unsound `csrf: false` mutation      | A CSRF-exempt mutation reads `req.session` or runs a cookie/session-derived guard | Keep CSRF on, or move non-browser writes to `endpoint()` / `webhook()`     |
| KV419 | error    | Unsafe moderate prerender           | `prefetch: 'moderate'` is set on guarded/session-dependent/not-proven-side-effect-free route without justification | Use `conservative`, prove safety, or add a named justification             |
| KV420 | error    | Stateful island inside refresh target | A local-state island renders inside another component's server-refreshable fragment target | Lift state to a query, make the child isomorphic, disable server refresh, or move it |

## Where each grouping comes from

- **KV201–KV242, KV301–KV330, KV402–KV420** are all defined in the **SPEC §11.3 diagnostic-code
  registry** (the single severity source). The section headings above group them by the SPEC area each
  cites (compiler/lowering §4–§6, islands/coverage §4.8–§4.9 and §10.6, data access §10.3, touch-graph
  verification §10.1–§11.2, advanced flows §8–§14).
- The **KV402–KV411 family** is additionally described in [testing](/guides/testing/) (the
  `observed ⊆ static ∪ declared` verifier) and the runtime cross-check in SPEC §11.2.
- **KV414–KV420** are additionally described in [security](/guides/security/),
  [endpoints & webhooks](/guides/endpoints-webhooks/), [deployment](/guides/deployment/), and
  [interactive islands](/guides/islands/).
- **KV310** and **KV311** also appear in [reading kovo check & kovo explain](/guides/kovo-explain/) as
  the coverage gates `kovo check` enforces.
- **KV330** appears in [mutations](/guides/mutations/) and [the data-layer guide](/guides/data-layer/).

No codes outside the SPEC §11.3 registry are listed here; if a guide footer mentions a KV code, it is
one of the above.

## Next

- [Testing with @kovojs/test](/guides/testing/) — the runtime verifier behind KV402–KV411.
- [Reading kovo check & kovo explain](/guides/kovo-explain/) — the surface that prints these codes.
- [Endpoints & webhooks](/guides/endpoints-webhooks/) — KV415, KV418, and the endpoint audit.
- [Deployment](/guides/deployment/) — KV417 deploy-skew retention.
- [Domains, writes & data access](/guides/data-layer/) — KV330, KV402–KV411 in context.

<details>
<summary>Spec & diagnostics</summary>

The full diagnostic-code registry and severity-to-behavior mapping: SPEC §11.3. Touch-set extraction
(behind KV402–KV409): SPEC §11.1. Runtime cross-check `observed ⊆ static ∪ KV406-declared` and the
read-side half of KV410/KV411: SPEC §11.2. Update plan and coverage (KV302, KV311): SPEC §4.8–§4.9.
Optimistic exhaustiveness (KV310): SPEC §10.6. Schema-as-domain-registry and `exempt` (KV404, KV411):
SPEC §10.1. Advanced-flow diagnostics KV414-KV420: SPEC §11.3. The verification surface that prints
these: SPEC §11.4.

</details>
