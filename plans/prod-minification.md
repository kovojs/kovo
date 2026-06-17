# Plan: Production name minification with server-gated legibility reconstruction

Created 2026-06-16. Behavioral source of truth is `SPEC.md`; this ledger sequences the work and
records evidence. This proposal **changes the Constitution** (§2 #1 and #4) and the success criteria
(§16.2), so the SPEC edits below are the load-bearing deliverable — the implementation work is
downstream of agreeing the contract.

## Goal & framing

Today legibility is an **intrinsic property of the shipped artifact**. Constitution #1 ("Legibility
is load-bearing… names structurally cannot be mangled") and #4 ("the wire is the documentation…
auditable from the Network panel or `tcpdump`") make the *source* name and the *runtime* name the
same string everywhere: `on:click="cart.js#Cart$remove"` is resolved by the 4KB loader as
`import('cart.js').then(m => m.Cart$remove)`, so the attribute, the export, and the source identifier
are one name. That powers four claims: #1, #4, the §1.2 machine-auditable-generation driver, and the
§16.2 "debug from devtools alone in <1 min" criterion.

This plan **splits legibility by environment**:

1. **Dev** — fully legible, exactly as today. No mangling. The wire *is* the documentation.
2. **Prod (default on)** — the compiler consistently mangles every load-bearing name across
   HTML + `*.server.js` + `*.client.js` + wire JSON, and emits a **server-gated name map** that
   reconstructs source names on demand via `kovo mcp` / `kovo explain`. Legibility becomes a
   property *reconstructable by the owner and their agents*, not a property of the artifact.

### Decisions (locked with maintainer, 2026-06-16)

- [x] **Map access: server-gated.** The name map is **not** shipped to the browser. It is reachable
      only through `kovo mcp` (and CLI `kovo explain`/`kovo demangle`) backed by the build's map
      artifact. Obfuscation is preserved on the wire; the owner/their agents retain full legibility.
- [x] **Default posture: minify-on-by-default in prod.** Legible prod is the opt-out
      (`kovo.config: minifyNames: false`), not the opt-in. Dev is always legible.
- [x] **Deliverable now: this design doc.** SPEC edits and implementation are sequenced below but
      gated on review of the contract changes.

### Consciously accepted trade-off (must be stated in the SPEC, not buried)

Server-gating the map **drops the third-party / `tcpdump` audit clause of Constitution #4 by
design.** An observer holding only the deployed bytes (Network panel, packet capture, no repo, no
MCP access) can no longer read what a button does or what a mutation changed. We keep:

- developer/owner debugging (has the repo + MCP),
- agent verification *of their own deployment* (has MCP access),

and we give up:

- third-party / unauthenticated-observer auditability of a live deployment.

The SPEC currently fuses "a developer can debug" with "any observer can audit" under one invariant.
This plan un-fuses them and keeps only the first. That is a real narrowing of Kovo's stated promise
and the §16.2 usability claim must be re-scoped to "a developer with repo/MCP access," not "a
developer who has never seen the codebase, from devtools alone."

## Why this is feasible (and where it bites)

**Feasible because the compiler owns all four emitters.** Names are load-bearing and resolved at
runtime, so mangling cannot be a local pass — it must be a *consistent global rename* across served
HTML, `*.server.js`, `*.client.js`, and wire JSON simultaneously. The compiler already emits all of
them (§3, §5.1), so a sound global rename is mechanically achievable. The mangle is the **last pass**
(after analyze/lower/validate), so every §11.3 validator still runs on source names.

**What must be mangled consistently (one name table):**

- handler export names in `on:*` (`cart.js#Cart$remove` → `c#a3`)
- query keys (`kovo-query`, `kovo-deps`, `data-bind` path roots: `cart` → `q1`)
- `kovo-c` stamps / dashed host tags (morph identity)
- fragment-target names (`kovo-fragment-target`, registry-keyed)
- module aliases / emitted module URL leaves
- derive names, capture-channel names, element-id stamps

**What is NOT touched:** wire JSON *shape* stays schema-shaped (Constitution #4's "schema-shaped
JSON" survives even when key roots are renamed — the structure is still inspectable); the §5.2.8
"no source strings post-parse" rule is unaffected (mangling is a typed-symbol → name-table
transform, not string slicing).

## Hazards introduced by mangling (each needs a SPEC answer)

- [ ] **Deploy skew goes from visible to silently catastrophic.** Today a stale cached/prerendered
      HTML with `on:click="cart.js#Cart$remove"` still resolves by name against a redeployed module.
      With mangling, prerendered HTML carrying `#a3` against a bundle where `a3` now means something
      else resolves to the *wrong export, silently*. **Required:** bake the name-table version/hash
      into the emitted module URL (it already carries cache-busting the framework controls, §5.2.1)
      and/or an attribute-namespace token, so a table mismatch fails loud at load. The §15
      "deploy skew is runtime-validated" risk row must be extended to cover the name table.
- [ ] **Fixpoint must stay idempotent (§5.2.3).** `compile(compile(src)) === compile(src)` requires
      a **deterministic, content-stable name table**: assign short ids by a stable ordering (e.g.
      sort source names, then assign), never by emission order or anything time/hash-volatile, so
      rebuilds don't churn the map and bust caches. Mangling a second time over already-mangled IR
      must be a no-op (the IR header / map presence signals "already mangled").
- [ ] **Render-equivalence gate (§5.2.3) gains a demangle step.** Currently
      `render(src) ≡ render(compile(src))` byte-identical. Prod render is no longer byte-identical to
      dev render, so the gate becomes `demangle(render_prod(src)) ≡ render_dev(src)` over the test
      corpus. The differential suite must run both modes and apply the name map.
- [ ] **`kovo check` / `kovo explain` speak source names** (fine — mangle is last), but must learn to
      **demangle a live prod artifact on request**: an agent handed a prod fragment or network
      response needs `kovo demangle <fragment>` / `kovo explain wire-token a3` to map back. This is
      the new MCP surface and the *only* sanctioned legibility path in prod.
- [ ] **Teaching errors / diagnostics (§11.3)** are authored against source names; confirm no
      diagnostic ever embeds a mangled token (they run pre-mangle, so this should hold — verify).

## Recommended SPEC edits (the load-bearing deliverable)

- [ ] **Constitution #1** — reword from absolute to environment-conditional:
      _"Legibility is load-bearing and **reconstructable**. In dev, source names appear verbatim in
      HTML and wire traffic. In prod, names may be consistently mangled, but every wire token,
      attribute, and handler is deterministically demangleable to its source name via the compiler's
      name map without executing a browser. The load-bearing invariant is that each prod token has a
      single recoverable source name — not that the token is the source name."_
- [ ] **Constitution #4** — scope the audit claim:
      _"The wire is the documentation **for the owner and their agents**. In dev, named POSTs,
      schema-shaped JSON, and readable HTML fragments are directly inspectable. In prod, JSON stays
      schema-shaped and POST routes stay named, but handler/query/component identifiers are mangled;
      legibility is reconstructed through `kovo mcp`/`kovo explain` against the name map. Kovo no
      longer promises live-deployment auditability to an observer without repo or MCP access."_
- [ ] **§5.1 pipeline** — promote the `(prod only) minify*` step to a first-class **name-mangle pass**
      with the name-map artifact (`generated/name-map.json`, committed and reviewable; *not* deployed
      to the browser) added to the emitted-artifacts list. Footnote at line 346 changes from "may
      never rename load-bearing names" to "renames load-bearing names *consistently and reversibly*
      via the name map; only the map (server-gated) recovers source names."
- [ ] **§5.2.1 / §5.2.3** — state the deterministic stable-name-table requirement and the demangle
      extension to the render-equivalence gate; state mangle is idempotent and last.
- [ ] **§5.3 / §11.3** — add `kovo explain wire-token` and `kovo demangle` to the MCP/CLI surface;
      restate "MCP is a rendering/query surface" to include *demangling* as a sanctioned query.
- [ ] **§15 risks** — extend the deploy-skew row with the name-table-version requirement.
- [ ] **§16.2 success criterion** — re-scope: "a developer **with repo or MCP access**" replaces "a
      developer who has never seen the codebase… from devtools alone." Add a prod criterion: a prod
      artifact + `kovo demangle` reconstructs the same answers the dev artifact gives directly.
- [ ] **§16.3 / §1.2** — confirm machine-auditable-generation still holds: an agent with MCP access
      answers "what updates when X is clicked" at 100% accuracy against a *mangled* deployment.

## Open question worth resolving before SPEC edits land

- [ ] **Measure the byte/obfuscation payoff on the reference commerce app** (post-brotli, HTML vs JS
      separately). Repeated `on:*` attributes compress heavily and JS export-name cost is O(distinct
      symbols), so the *byte* win may be small — in which case the real and primary justification for
      this plan is **obfuscation / IP**, not payload. The SPEC rationale should name the true
      motivation rather than assert a byte win we haven't measured. (Maintainer chose minify-on-by-
      default before measuring; this item records the gap, not a blocker.)

## Sequencing

1. SPEC edits above land first (contract before code), reviewed as a unit.
2. Compiler: deterministic name table + global mangle pass (last pass) + `name-map.json` emission.
3. Deploy-skew safety: name-table hash in module URLs + loud load-time mismatch.
4. Gates: extend fixpoint (idempotent mangle) and render-equivalence (demangle step).
5. Surface: `kovo demangle` + `kovo explain wire-token` over MCP/CLI, server-gated map.
6. Reference commerce app: prove prod build mangled, MCP demangle round-trips, skew fails loud.

## Proving commands (to fill in as slices land)

- [ ] fixpoint + render-equivalence green with mangle on (name a test/command)
- [ ] `kovo demangle` round-trips a prod fragment to dev-equivalent legibility (name a test)
- [ ] deploy-skew mismatch fails loud (name a test)
- [ ] byte/obfuscation measurement recorded (name the artifact)
