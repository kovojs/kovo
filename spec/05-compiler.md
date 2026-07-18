# Compiler (SPEC §5)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 5. Compiler

### 5.1 Pipeline

```
cart.tsx ──parse──▶ analyze ──lower──▶ cart.server.js + cart.client.js ──(prod only)──▶ minify*
                       │
                       ├─▶ generated/registries/*.d.ts   (module aliases, fragment targets, query keys, domains,
                       │                                  routes, element ids, invalidation sets)
                       ├─▶ generated/touch-graph.ts      (§11.3 — reproducible/checkable on demand)
                       └─▶ generated/optimistic/*.ts     (§10.4; emitted output; authored transforms override)
```

\* Minification may never rename exported handler symbols or anything appearing in HTML attributes (Constitution #1 — enforced because those names are load-bearing at runtime); this holds in prod too, where payloads are delta-encoded (§9.1.1) but names stay verbatim. The prod build additionally stamps a **render-plan version token** (defined in §5.2.1) into emitted module URLs (alongside the cache-busting hash) and into every delta/patch response, so §9.1.1 base-version validation can fail loud on deploy skew instead of patching stale DOM silently.

### 5.2 Hard rules (normative)

1. **Source-derived names.** Extracted handlers are named `Component$fnName`, or `Component$element_event` when anonymous (lint `KV210` nudges naming). Content hashes appear only in cache-busting query strings on the emitted module URLs (or ETag-driven — a deployment choice the framework controls server-side).
2. **1:1 file mapping.** `x.tsx` → exactly `x.server.js` + `x.client.js`. No heuristic chunking. A prod-only merge pass for tiny modules is opt-in (`kovo.config: mergeClientModules`), defaulting off.
3. **Fixpoint invariant.** `compile(compile(src)) === compile(src)`; the IR is valid input. CI test ships in the starter template. Paired with a **semantic gate**: `render(src) ≡ render(compile(src))` — authored and lowered components must produce byte-identical HTML over the test corpus (a browser-free differential suite), so the fixpoint proves behavior preservation, not merely syntactic idempotence.
4. **Platform-behavior emission.** Where the compiler proves a handler equivalent to a declarative platform feature (dialog open/close → invoker commands; popovers; `<details>`; pure-CSS state via `:has()`), it emits the attribute and drops the handler. `kovo explain` reports each substitution.
5. **Teaching errors.** Every diagnostic shows the lowering: what would have been generated, why it can't be, and the fix menu.
6. **Registry atomicity.** Registry `.d.ts` emission is part of every compile; `vp dev` and `vp check` regenerate registries before type-checking runs. A stale registry is unrepresentable, not just unlikely — the typegen failure modes (fresh clone red until first generation, watch-mode races) are designed out.
7. **TSX-only authoring.** TSX is the sole app-authoring surface. The lowered IR is an output format: valid Kovo source for fixpoint/render-equivalence gates and readable artifacts, but not something app code hand-authors or vendors. Hand-authored lowered IR in app source is **KV235** with a teaching message that shows the TSX equivalent. There is no suppression pragma or ejection workflow in v1; a front-end gap is fixed in the compiler or recorded as a SPEC conflict.
8. **Public imports in app source.** App-authored source may import Kovo packages only through documented public entrypoints. Imports from framework-maintenance subpaths (`@kovojs/*/internal`, `kovo/internal`) and compiler-emitted ABI subpaths (`@kovojs/*/generated`) are invalid in app source and must produce a teaching diagnostic. Compiler-emitted modules may import generated ABI subpaths such as `@kovojs/browser/generated`; those imports are compiler-owned artifacts, not app-authored API. Generated app artifacts are reproducible outputs, not app dependencies: app-authored modules MUST NOT import app-local generated modules such as `src/generated/*`, and app-local generated artifacts MUST NOT be checked in. App-facing tests and scripts use authored entry points plus public `kovo emit`/`kovo explain`/`kovo check` flows; direct generated reads are reserved for compiler/build internals and on-demand verification artifacts that are created during the command.
9. **Production build preflights.** `kovo build` MUST fail before writing deploy artifacts when the app's nearest TypeScript project fails `tsc --noEmit` or when the build-derived graph fails the full `kovo check` verifier. The standalone `kovo check` command remains the stable, inspectable `kovo-check/v1` surface for CI logs and agent debugging; build reuses that verifier as a deployment gate, not a separate policy.
10. **Post-parse decisions use typed facts, not source strings.** After parsing, the compiler's post-parse phases (`lower/**`, `validate/**`, `analyze/**`, `emit/**`, and `graph.ts`) MUST decide from typed model facts and spans, never from raw source snippets, regexes, `getText()`/`getFullText()`, or ad hoc string slicing; the scanner/parser is the sole boundary that reads source text into typed facts. Permitted source-text uses elsewhere are narrow: diagnostic source-frame rendering, span-based source-patch application by known offsets, generated-artifact body carry and `renderSource()` emission, generated-artifact verification, IR-header provenance checks (`source.startsWith(compilerIrHeader)`), binding-path grammar parsing on typed `.path` fields, URL/route parsing of an extracted literal `attribute.value`, import-specifier boundary validation for the public/generated/internal Kovo subpath rule above, and name-formatting of model-derived identifiers. A mechanical kovo-check guard enforces this.
11. **Output safety is contextual and default-on.** The server renderer and the client update plan MUST contextually encode every interpolated query/state value for its sink — escaped text for text content, attribute-value escaping for attributes, the §9.1 script-data encoding for JSON islands — and MUST encode identically (bound by render-equivalence, rule #3). Pair-dependent HTML sinks MUST classify the browser-effective tuple from the same pinned attribute snapshot and renderer order: attribute names use HTML ASCII-case-insensitive matching, omitted values do not participate, and the first emitted duplicate owns the browser decision. In particular, `<meta>` refresh `content` is an executable navigation sink whenever the first rendered `http-equiv` attribute has the ASCII-case-insensitive value `refresh`; a later differently-cased duplicate cannot replace that decision. Plain bindings may reach only safe contexts; the unsafe output contexts and the URL-scheme allowlist are defined in §4.8 and gated by **KV236**. The only suppression is the typed trusted-HTML escape hatch (§4.8); there is no raw-string ejection. A sink renderer or any other app-authored presentation layer that consumes streamed/model output is bound by the same obligation (§9.1).
12. **Security-critical effects lower to a finite compiler-owned IR.** The scanner derives every
    supported browser-handler and structured-server effect as one exact
    `kovo-security-operation-ir/v1` operation before emission (§4.3, §6.6). The same closed union
    contains two compiler-control records: `server.handler.root` proves that each supported
    query/mutation/endpoint/webhook/task root was enrolled, and `server.helper.call` records an exact
    same-file authority transfer discharged by the bounded bottom-up summaries in §6.6.
    Generated client
    modules carry their browser subset through the compiler-only `@kovojs/browser/generated`
    `securityHandler` ABI; generated server modules carry the corresponding immutable manifest for
    component-graph and explain consumers. Neither manifest is caller-supplied enforcement or a
    runtime sandbox: the pre-evaluation compiler gate owns the supported-subset decision, and the
    C9 sink inventory owns each real runtime door and the capability-closure owner for those two
    control records. Unknown terminal calls, raw capability/DOM
    escapes, ambiguous receiver joins, and unreviewed authority transfer fail with **KV449** before
    output. The generated wrapper and manifest are valid only as provenance-marked compiler IR for
    the rule #3 fixpoint/render-equivalence gates; rule #7/#8 still forbid app-authored lowered IR or
    generated-ABI imports. A missing, spread/computed, imported, aliased, reassigned, or otherwise
    unresolved root is KV449; it cannot disappear by producing no manifest row.

#### 5.2.1 Render-plan version token (normative)

The **render-plan version token** is a single opaque build-stable string that identifies the exact server/client render contract a payload was produced against. It is the currency §9.1.1 base-version validation compares.

1. **Inputs (mandatory).** The token MUST be a collision-resistant hash whose preimage includes, at minimum: (a) the **projected shape of every query** — the field set, nesting, nullability, and element type of each query value, including each `kovo-key` field per keyed collection (§4.8); and (b) the **update-plan grammar version** — the binding/derive/stamp lowering vocabulary and the delta deep-merge semantics (§9.1.1) the client runtime applies. A change to any projected query shape, to any keyed-collection identity field, or to the update-plan grammar MUST change the token. The token MUST NOT be derived from client-module content hashes alone: a query-shape change that leaves a module's bytes unchanged MUST still move the token.
2. **Stamping points (mandatory).** The prod build stamps the token into (a) emitted client-module URLs (alongside the cache-busting hash, §5.1), (b) every full page render (as document meta, §9.5), (c) every `<kovo-query>`/`<kovo-fragment>` delta or full response (§9.1.1), and (d) every `/_q/<key>` read response (§9.4) so a plain refetch into a stale tab is detected, not only mutation-driven deltas.
3. **Comparison (mandatory, server and client).** The client applies a delta only when the response token equals the token the held base was produced against (§9.1.1); on mismatch it discards and refetches full (§9.4). A `/_q/` response whose token differs from the receiving document's token MUST be treated as a build-skew event: the client discards the in-place merge and performs the §14 recovery. A skew-aware server that receives a stale token on a mutation or read request MAY emit full directly (§9.1.1). The token is opaque to app code; only equality is defined.

#### 5.2.2 Prod render-equivalence gate (normative)

The prod build is sound only if delta encoding reconstructs the dev full render. The gate, over the differential corpus (§5.2 rule 3): for every query and every change record, `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)`, where `apply_delta` is the §9.1.1 deep-merge plus update plan and `base` is the prior full value. The gate MUST also assert token monotonicity: any corpus edit that changes a projected query shape or the update-plan grammar changes the §5.2.1 token. A prod build whose delta path fails this equivalence, or whose token fails to move on a shape change, fails the build (**KV416**).

### 5.3 `kovo explain`

The compiler's decision tree, on demand. Sub-commands (all output stable, diffable text — agents consume the same artifact humans read):

```bash
kovo explain component cart        # lowerings: extracted handlers, derives, capture channels, platform substitutions, attribute merges, triggers
kovo explain mutation cart/add     # writes → domains → invalidated queries → consumers; guard chain
kovo explain mutation cart/add --optimistic   # transform coverage per query; derivation traces + punts (§10.5)
kovo explain query cart            # read set, consumers, every mutation that invalidates it
kovo explain page /products/:id    # emitted modulepreloads, per-route prefetch config, param/search schemas, query payloads
kovo explain --capabilities        # held capabilities plus untrusted roots, reviewed doors, exact package verdicts, and closed provenance paths
```

The capability-closure rows are the stable rendering of the pre-evaluation proof from §6.6, not a
runtime sandbox trace. Root, door, package-summary, and closed rows are sorted independently of
source traversal order; a closed row retains the exact root-to-terminal path also emitted by KV448.

---
