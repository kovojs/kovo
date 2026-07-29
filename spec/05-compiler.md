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

\* Minification may never rename exported handler symbols or anything appearing in HTML attributes (Constitution #1 — enforced because those names are load-bearing at runtime); this holds in prod too, where payloads are delta-encoded (§9.1.1) but names stay verbatim. The prod build gives each final client representation one immutable content-addressed URL and stamps the separate **app build token** defined in §5.2.1 into documents and data/fragment responses, so §9.1.1 base-version validation can fail loud on deploy skew instead of patching stale DOM silently.

### 5.2 Hard rules (normative)

1. **Source-derived names and content-addressed modules.** Extracted handlers are named `Component$fnName`, or `Component$element_event` when anonymous (lint `KV210` nudges naming). Framework client modules use only the immutable path grammar `/c/__v/<representation-digest>/<module>` from §5.2.1. Author version strings, `?v=` cache busters, truncated hashes, ETag-selected identity, and render-plan fingerprints are not module identity.
2. **1:1 file mapping.** `x.tsx` → exactly `x.server.js` + `x.client.js`. No heuristic chunking. A prod-only merge pass for tiny modules is opt-in (`kovo.config: mergeClientModules`), defaulting off.
3. **Fixpoint invariant.** `compile(compile(src)) === compile(src)`; the IR is valid input. CI test ships in the starter template. Paired with a **semantic gate**: `render(src) ≡ render(compile(src))` — authored and lowered components must produce byte-identical HTML over the test corpus (a browser-free differential suite), so the fixpoint proves behavior preservation, not merely syntactic idempotence.
4. **Platform-behavior emission.** Where the compiler proves a handler equivalent to a declarative platform feature (dialog open/close → invoker commands; popovers; `<details>`; pure-CSS state via `:has()`), it emits the attribute and drops the handler. `kovo explain` reports each substitution.
5. **Teaching errors.** Every diagnostic shows the lowering: what would have been generated, why it can't be, and the fix menu.
6. **Registry and app-membership atomicity.** Registry `.d.ts` emission and the app-contract
   membership check (§6.2.1) are part of every compile; `kovo dev`, `kovo check`, and `kovo build`
   derive both from one immutable project snapshot before type-checking or authored evaluation.
   A stale registry, a compiled app-scoped declaration omitted from `assemble`, or membership from
   another module generation is unrepresentable, not just unlikely. Emitted registries contain
   source-derived identities; they are not an ambient runtime registration mechanism.
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
    generated-ABI imports. An app-scoped root additionally carries the exact proved `defineKovo`
    receiver and owning `assemble` identities from §6.2.1. Direct receiver calls and ordinary
    immutable local import/re-export aliases are supported; a destructured factory, wrapper result,
    computed member, cast/structural copy, mutable or ambiguous receiver, duplicate package
    identity, missing assembly membership, or second assembly is closed before output. Once
    enrolled, `app.query`/`app.mutation`/`app.endpoint`/`app.task` emit the same
    `server.handler.root` family and callback facts as their primitive counterparts. A missing,
    spread/computed, imported, aliased, reassigned, or otherwise unresolved callback root is KV449;
    it cannot disappear by producing no manifest row.

#### 5.2.1 Client representation, render-plan, and app-build identities (normative)

Kovo derives exactly three distinct build-coherence values but exposes exactly two external carriers. The immutable client-module URL carries the representation digest; `Kovo-Build` and its response/meta equivalents carry the app build token. The render-plan fingerprint is an internal input folded into the app build token and is never stamped separately. These values prevent cache aliases and mixed-deploy merges; they are not signatures, do not authenticate a producer, and are never an app security principal.

1. **Client representation digest.** Every immutable client-module URL contains one full 64-character lowercase hexadecimal SHA-256 digest. Its domain-separated, UTF-8 byte-length-framed preimage is exactly: the domain `kovo-client-module-representation/v1`, the fixed media type `text/javascript; charset=utf-8`, and the exact final well-formed UTF-8 JavaScript bytes after all compiler/browser import rewriting. The canonical URL is `/c/__v/<representation-digest>/<module>` with no query string. A fragment may select an export at a reference site, but is not part of the stored representation identity. The URL contains no render-plan fingerprint, author version, custom content type, truncated digest, or second content hash. Identical final representations keep the same digest when only render/query grammar changes. A resolver MUST re-verify the returned 200 body and fixed metadata against the requested digest before serving it; mismatch fails closed.
2. **Render-plan fingerprint.** The compiler derives a separate full 64-character lowercase hexadecimal SHA-256 fingerprint over canonical byte-length-framed facts that include, at minimum: (a) the **projected shape of every query** — field set, nesting, nullability, and element type, including each `kovo-key` field per keyed collection (§4.8); (b) the **update-plan grammar version** — the binding/derive/stamp lowering vocabulary and §9.1.1 delta deep-merge semantics; and (c) the core-owned **wire-input grammar schema** defining canonical target, query-dependency, and live-target identities (§9.1). A change to any projected query shape, keyed-collection identity field, update-plan grammar, or wire-input grammar schema MUST change this fingerprint even when every client-module byte remains unchanged. This is one centrally derived compatibility fingerprint, not a module URL component, direct wire token, or authenticator.
3. **App build token.** The framework derives one full 64-character lowercase hexadecimal SHA-256 token directly from byte-length-framed values: the domain `kovo-app-build-token/v1`, the render-plan fingerprint, and the ascending sorted set of exact active immutable client-module hrefs. There is no nested module-graph digest, delimiter-only encoding, truncation, author version, custom content type, or caller-supplied token. The active set MAY contain simultaneous representations of one logical module path and MUST exclude resolver history retained only for skew recovery. A module-less app hashes the empty active set and still has a non-empty token.
4. **Ownership and finalization.** An injected `VersionedClientModuleStore` supplies only four storage operations: `retain` stores one immutable representation without changing the active deployment; `readActiveSnapshot` returns the durable exact `{ modules, renderPlanFingerprint }` snapshot; `replaceActiveSnapshot` atomically commits that complete snapshot; and `resolve` reads retained representation history. The framework closes it behind a `VersionedClientModuleRegistry` facade and derives every representation href and app build token itself. Store-supplied hrefs, `buildToken`, or fingerprint setters have no authority. A store replacement that is not atomic or whose immediate readback differs from the requested exact snapshot fails closed. Production registration/finalization stages every compiler module together with framework-mandatory and stable/manual modules, performs one complete snapshot replacement, and then seals it: after finalization the manifest and token are frozen, request handling performs no hashing or storage writes, and later `put` attempts fail with KV417. Development/HMR replaces the render fingerprint and complete active module set as one atomic snapshot and publishes the new token only after all entries validate, retain, commit, and read back successfully; retained history is not silently promoted into that snapshot. The framework-mandatory loader participates in the active href set and in §14 retention requirements even when it is the deployment's only client module.
5. **Two external carriers.** The app build token — not either component value — is carried by every full page render (document meta, §9.5), every `<kovo-query>`/`<kovo-fragment>` delta or full response (§9.1.1), and every `/_q/<key>` read response (§9.4). Client-module URLs carry only their representation digest. The render-plan fingerprint has no third stamp, header, URL component, or manifest carrier.
6. **Comparison.** The client applies a delta only when the response app build token equals the token the held base was produced against (§9.1.1); on mismatch it discards and refetches full (§9.4). Every enhanced typed-read, mutation, and HMR request carries the immutable document token as `Kovo-Build`; once dispatched to one app build, a missing or unequal value fails before target/query decoding or handler work. A `/_q/` or target-bearing response whose token differs from the receiving document's token is a §14 build-skew event. A retained serving layer MAY select the matching immutable app and decoder by exact token, but may never heuristically dual-decode one request. All three identities are opaque to app code; only equality is defined.

#### 5.2.2 Prod render-equivalence gate (normative)

The prod build is sound only if delta encoding reconstructs the dev full render. The gate, over the differential corpus (§5.2 rule 3): for every query and every change record, `apply_delta(base, render_prod(Δ)) ≡ render_dev(full)`, where `apply_delta` is the §9.1.1 deep-merge plus update plan and `base` is the prior full value. The gate MUST also assert the three-value separation and monotonicity plus the two-carrier rule: a projected-shape or update-grammar change moves the §5.2.1 render-plan fingerprint and app build token, while an unchanged final client representation keeps its representation digest and href; the internal fingerprint never becomes a separate external stamp. A prod build whose delta path or these identity properties fail is **KV416**.

#### 5.2.3 Build artifact provenance (normative)

Every successful `kovo build` MUST add a top-level `provenance` object to the emitted
`dist/.kovo/graph.json`. The object has schema `kovo.artifact.provenance/v1` and contains exactly the
path-independent inputs later certificates and advisories use to identify the framework posture:

- `graphSchemaVersion` is the compiler-owned graph grammar identifier (`kovo.graph/v2`).
  Any incompatible meaning or shape change in the graph moves this value.
- `frameworkPackages` is the unique, ascending sequence of `{name, version}` pairs for resolved
  `@kovojs/*` packages. Resolution starts from the executing `@kovojs/cli` package and the nearest app
  `package.json` inside the lockfile root, follows declared Kovo dependencies recursively under Node's
  actual resolution contexts, and retains simultaneous versions of one package as separate pairs.
  App `dependencies`, `devDependencies`, optional dependencies, and peers seed the walk; resolved Kovo
  packages contribute their production dependencies, optional dependencies, and peers. Missing
  optional packages are absent; a missing required declared package fails the build.
- `pnpmLock.contentHash` is `sha256:<lowercase-hex>` over the exact bytes of the nearest ancestor
  `pnpm-lock.yaml`, with no newline, path, or text normalization. A production build with no such
  lockfile fails before app or config evaluation.
- `securityGuarantees` records schema `kovo.security.guarantees/v1` plus `canonicalHash`. The hash is
  SHA-256 over UTF-8 canonical JSON of the fenced guarantee register in `SECURITY.md`: arrays retain
  order; object keys sort by JavaScript/Unicode UTF-16 code-unit order at every depth; strings,
  numbers, booleans, and null use ordinary JSON encoding; and the serialization contains no
  whitespace. The executing CLI's package manifest embeds this identity, and the security-guarantee
  gate MUST reject a digest that does not match the normative register before that CLI ships.

The stamp contains no absolute paths, filesystem identities, wall-clock time, random values, or
output-directory names. Capturing it before authored config/app evaluation and sorting every set-like
field makes two no-op builds byte-identical; changing any listed input MUST change the emitted graph
bytes. The stamp identifies the build inputs. It is not a signature and does not by itself prove that
the artifact is safe or that the package contents match their version labels.

### 5.3 `kovo explain`

The compiler's decision tree, on demand. Sub-commands (all output stable, diffable text — agents consume the same artifact humans read):

```bash
kovo explain component cart        # lowerings: extracted handlers, derives, capture channels, platform substitutions, attribute merges, triggers
kovo explain mutation cart/add     # writes → domains → invalidated queries → consumers; guard chain
kovo explain mutation cart/add --optimistic   # transform coverage per query; derivation traces + punts (§10.5)
kovo explain query cart            # read set, consumers, every mutation that invalidates it
kovo explain page /products/:id    # emitted modulepreloads, per-route prefetch config, param/search schemas, query payloads
kovo explain --capabilities        # held capabilities plus untrusted roots, reviewed doors, exact package verdicts, and closed provenance paths
kovo mcp                           # the same compile/check/explain results over the finite stdio protocol in §11.5
```

The capability-closure rows are the stable rendering of the pre-evaluation proof from §6.6, not a
runtime sandbox trace. Root, door, package-summary, and closed rows are sorted independently of
source traversal order; a closed row retains the exact root-to-terminal path also emitted by KV448.

`kovo mcp` is only a machine-readable command surface for these framework decisions. It MUST use
the dependency-free, finite stdio protocol in §11.5; it is not a general MCP server or an extension
point for application code.

---
