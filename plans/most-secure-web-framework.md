# Plan: Make Kovo the Most Secure Web Framework

**Status:** open roadmap. Strategic plan ranking the highest-leverage work to make Kovo demonstrably
the most secure web framework, benchmarked against Rails, Laravel, Django, Next.js/React, the JS
meta-frameworks (SvelteKit/Remix/Astro), Spring Security / ASP.NET Core / Phoenix, the modern browser
security platform, supply-chain SOTA (SLSA/Sigstore/pnpm), and the OWASP Top 10 / API Top 10 / LLM Top 10.

This plan is the forward roadmap; it does **not** restate shipped work. Prior security ledgers:
`secure-by-construction.md`, `secure-framework.md`, `secure-framework-2.md`, `secure-framework-3.md`,
`fix-security.md`. Where an item is already tracked there, it is cross-referenced and elevated, not
duplicated.

## The thesis — why "most secure" is a defensible claim, not marketing

Every framework says "secure." Kovo's distinctive claim is **secure by the same machine-auditable
construction that eliminates stale UI** (SPEC §1.2, §2): whole vulnerability classes are compile
errors or fail-closed runtime floors, proven over **AST symbol-identity provenance** — never runtime
taint (unsound: JS string ops produce fresh primitives) and never a branded type (defeated by
`any`/casts). The credibility moat is the **four-tier honesty discipline** (SPEC §6.6): every control
is labeled **by-construction** (static proof, unsafe state inexpressible), **runtime-DiD** (fail-closed
floor, sound at its sink but bypassable by privileged same-process code), **type-only** (tsc
ergonomics), or **audit-only** (surfaced in `kovo explain`). Selling a floor as a proof is the one
move that would forfeit the claim — so this plan tiers every item ruthlessly and **drops/relabels**
over-claims rather than shipping them.

The strategy is four moves, in leverage order:

1. **Close the secure-default gaps** — Kovo has _built, tested, fail-closed floors that are opt-in or
   have legacy passthroughs_. Flipping them on is the highest leverage/risk ratio in the whole plan.
2. **Ship the marquee novel by-construction wins** no other framework can express — the unified
   **sink-token-brand** substrate (§3), agent-capability least-privilege, confidential-at-rest, and
   the over-serialization gate.
3. **Fill the authn/crypto gaps** prior art owns and Kovo delegates today — key rotation, password
   hashing, opaque revocable sessions, enumeration-safe verification.
4. **Harden the floors and emit the free browser headers** — SRI, reporting, BREACH-masking,
   sanitizer single-sourcing, system-response posture.

---

## 1. Coverage matrix (Kovo vs. prior-art best vs. residual gap)

Honest current posture across the threat taxonomy. "Tier" is Kovo's _current_ honest tier.

| Class                                       | Kovo today (tier)                                                                 | Prior-art best                                  | Residual gap → item                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **A01 Broken Access Control / BOLA (IDOR)** | KV436 default-deny + KV414 owner-shape (by-construction _that a decision exists_) | Rails/Django/Spring runtime policies            | KV436 proves a decision exists, not that it's **correct** (`return true` satisfies it). Predicate-correctness → OPP-28 |
| **A03 SQL injection**                       | KV422 static gate + tamper-resistant floor (by-construction + runtime-DiD)        | ORMs parameterize builder; raw escape unchecked | `warn/off` knob fails open; native-object fall-through default-allow → **SINK-01**                                     |
| **A03 XSS (all contexts)**                  | AST output-context escaping (by-construction) + Trusted Types/CSP (runtime-DiD)   | React/Svelte auto-escape HTML-text only         | Inline fragment sanitizer drift (local mini-sanitizers) → OPP-26; no safe rich-HTML sink → OPP-27                      |
| **A03 ReDoS**                               | KV434 blessed linear validators (by-construction, narrow) + budgets               | Zod/Yup ship raw `RegExp`                       | `pattern(literal)` "floor" is **false** vs catastrophic backtracking; non-literal lint open → **SINK-06**              |
| **API3 Mass assignment / BOPLA**            | KV438 write-provenance (by-construction, fail-closed)                             | Rails strong params, Laravel `$fillable`        | Non-secret whole-row over-serialization crosses freely → OPP-21                                                        |
| **A02 Confidential data (in flight)**       | secret()/redacted() + KV435/KV437 wire ineligibility (by-construction + DiD)      | Rails Active Record Encryption (at rest)        | No confidential-**at-rest** classification → OPP-04                                                                    |
| **A05 Security headers**                    | strict CSP/COOP/COEP/Permissions default-on (secure-default + DiD)                | Django/Spring checklists; Laravel ships none    | No SRI on emitted modules → OPP-13; no reporting → OPP-14; no Clear-Site-Data/OAC → OPP-15                             |
| **A07 AuthN failures**                      | KV418 + CSRF + cookie floor (by-construction + DiD); strength out-of-scope        | Rails 8 first-party auth, opaque sessions       | No password hasher (OPP-10), key rotation (OPP-05), opaque session (OPP-11), enumeration-safe (OPP-09)                 |
| **A08 Deserialization / proto-pollution**   | shape-validated decode (runtime-DiD)                                              | SAST flags known sinks                          | No stated floor that _all_ body decode is schema-bound, null-proto, reviver-free → OPP-19                              |
| **A10 SSRF (metadata, rebind)**             | default-on dual-layer egress deny floor (runtime-DiD, 5 enumerated residuals)     | nobody else has any SSRF control                | Dev remains lenient for localhost sidecars; production/explicit config deny by default                                 |
| **API4 Resource consumption**               | KV430 shape budget (runtime-DiD); rate-limit un-hardened                          | Rails 8 `rate_limit`, APIM                      | Limiter key map unbounded (DoS) → OPP-18; no pagination/body caps → OPP-29                                             |
| **Lost-update / TOCTOU**                    | KV429 static flag + CAS helper (static-analysis + library)                        | optimistic-locking columns                      | Not by-construction; multi-row invariants need `forUpdate` → (CAS hardening, secure-framework.md)                      |
| **CSRF**                                    | synchronizer token + Origin floor + KV418 (library + by-construction gate)        | SvelteKit Origin default-on                     | Both-headers-absent compat fallback; no BREACH mask → OPP-16                                                           |
| **Supply chain**                            | publish tarball sha/file-list gates (static-analysis, Kovo's own tarball)         | pnpm-10 default-deny scripts, provenance        | No tarball **content** scan, no dep-confusion gate, no build-egress floor → OPP-22/OPP-23                              |
| **AI: prompt injection (LLM01)**            | out-of-scope as a proof (correct)                                                 | StruQ/CaMeL privilege separation                | Not framed as a **blast-radius** story → OPP-25                                                                        |
| **AI: excessive agency (LLM06)**            | **MISSING**                                                                       | MCP gateways / hand-wired allow-lists           | No agent-tool capability least-privilege layer → **OPP-07/OPP-08**                                                     |
| **CWE-22 Path traversal / file serving**    | upload keys + capability downloads (by-construction); generic serve unclear       | canonicalize-then-contain                       | No general opaque-key file-serve primitive → OPP-20 / **SINK-03**                                                      |
| **Stale-UI / cache completeness**           | static write touch-set (by-construction) + fail-closed executor                   | nobody proves this statically                   | Gated on unbuilt interprocedural write-summaries (signature feature, tracked elsewhere)                                |

---

## 2. Ranked work items

Each item: **tier** (honest, post-adversarial-review) · **leverage** (1–10) · **effort** (S/M/L/XL) ·
**breaking?** · the work · the trade-off. Tiers/scores are from the adversarial verdict pass; items
OPP-28/29/30 were tiered by the main thread (their verdict agents hit the session limit).

### Band 0 — Secure-default corrections (flip built floors on; highest leverage/risk)

These ship _no new mechanism_ — they correct a default on an already-built, tested, fail-closed floor.
This is where Kovo's secure-default bias (technical-preview: prefer security-improving breaks) pays off.

- [x] **OPP-01 — SSRF egress floor default-ON, prod refuse-to-boot.** runtime-DiD · lev 8 · M · breaking.
      `createApp` installs the dual-layer metadata/private-network deny floor only when `egress` config is
      present (`app.ts:101`), so **by default an app has zero SSRF protection** — the sharpest contradiction
      of the secure-default bias. Install unconditionally; dev stays lenient (loud self-probe, never bricks
      localhost), **production refuses BOOT** (mirror `env.ts` `resolveBootMode`, not first-request) when the
      floor is absent/disabled without an audited opt-out. Keep empty-allowlist deny semantics; metadata stays
      non-allowlistable. _Trade-off:_ amends normative SPEC §6.6 ("ships an opt-in floor") and **must** stay
      dev-lenient or it bricks every localhost DB/Redis/OTel/Ollama the AI-agent audience runs. Tracked open
      in `secure-framework-3.md` ("harden egress floor propagation") — elevate to default-on here.
      Evidence: `createApp()` now calls `installEgressFloorSync` by default, production refuses unaudited
      disable, omitted dev config keeps private sidecars reachable while metadata remains blocked, and
      `SPEC.md` §6.6 records the default-on contract. `pnpm exec vitest run packages/server/src --run` passed.

- [x] **OPP-03 — Close the class-less cookie passthrough.** by-construction (app-data half) + runtime-DiD
      (session half) · lev 6 · M · breaking. `cookies.ts` lets an unclassed cookie ship with no
      HttpOnly/Secure/SameSite and no prefix (lines 42/179/265), so the "insecure credential cookie
      inexpressible by default" claim only holds for _classed_ cookies. Remove the passthrough: unclassed →
      app-data floor (SameSite=Lax min); session/auth-shaped names → full credential floor + `__Host-` prefix.
      _Trade-off:_ the app-data default is sound by construction; the "session cookie always hardened" half is
      a name-heuristic runtime floor — label it as such.
      Evidence: `packages/server/src/cookies.ts` defaults classless app-data cookies to `SameSite=Lax` and
      applies the credential floor to session/auth-shaped names. `pnpm exec vitest
packages/server/src/cookies.test.ts packages/server/src/mutation.test.ts packages/server/src/response.test.ts
packages/server/src/node.test.ts packages/server/src/endpoint.test.ts --run` and `pnpm --filter
@kovojs/conformance-better-auth-pin test -- index.session-credentials.test.ts` passed.

- [x] **OPP-18 — Bound the rate-limiter key cardinality.** runtime-DiD · lev 6 · S · non-breaking.
      `app-load-shed.ts` uses unbounded `Map<string,RateBucket>` keyed per-request (global + perIp); an
      attacker-varied `clientIp`/`X-Forwarded-For` exhausts memory — the limiter is itself a DoS vector.
      Replace with bounded LRU + conservative `maxKeys` + periodic sweep; treat `clientIp` cardinality as a DoS
      _input_. _Trade-off:_ bounds memory but per-IP limiting stays meaningless under forgeable `X-Forwarded-For`
      until a trusted-proxy hop count is configured.
      Evidence: `secure-framework-3.md` verifies `packages/server/src/app-load-shed.ts` bounds and evicts rate
      buckets; `pnpm test packages/server/src/app.test.ts` covered the limiter behavior.

- [x] **OPP-17 / SINK-05 — Sanitize the browser `Kovo-Reauth` redirect.** runtime-DiD · lev 8 · S ·
      non-breaking. `inline-loader-build.ts` (~873) does `location.assign(reauth)` on a raw 401 header with no
      client re-sanitization — a live open-redirect/scheme-injection hole if the upstream is compromised. Route
      both the modular and inline mutation-fetch sinks through `sanitizeReauth` (same-origin, single leading
      slash, reject `//`/`/\`/scheme/host/encoded-control, fail closed to `/`). _Trade-off:_ the server already
      emits a safe value, so this hardens the upstream-compromise edge; ship it as a **function-call chokepoint**,
      not a brand object (the value is a runtime header the AST can't see — by-construction is impossible).
      Evidence: `secure-framework-3.md` verifies `packages/browser/src/reauth-directive.ts` and
      `packages/browser/src/inline-loader-build.ts` sanitize modular and inline `Kovo-Reauth`; focused browser
      tests plus `pnpm --filter @kovojs/browser run check:inline-loader` covered generated freshness.

### Band 1 — Marquee novel by-construction wins (things no other framework can express)

- [ ] **§3 Sink-Token Brands** — the unified `Blessed<Sink>` substrate. See the dedicated section below;
      the flagship by-construction items are **SINK-01** (SQL identifier/keyword channel + kill the fail-open
      knobs) and **SINK-03** (rooted file-serve). lev 7–9.

- [ ] **OPP-07 — Agent tool-capability least-privilege by construction (LLM06).** by-construction
      (capability _bounding_) + runtime-DiD (value-moving approval) · lev 7 · XL · non-breaking. Kovo's headline
      audience is AI-agent builders, yet there is **no** by-construction least-privilege layer for agent tools —
      the single biggest unclaimed opportunity. Define `tool()` as a first-class declaration whose body's
      reachable **sinks** are classified by the existing analyzers (write verbs via `domain-writes.ts`, egress
      via the SSRF classification, secret reads via confidentiality); a granted capability set that doesn't cover
      a reachable sink is a KV436-pattern build error. _Trade-off:_ sound capability **bounding**, but it does
      **not** eliminate Excessive Agency (a prompt-injected arg into a _granted_ money-move tool is still a call);
      needs a net-new primitive + governed-sink annotations. Pair with OPP-25's honest blast-radius framing.

- [ ] **OPP-08 — Confused-deputy floor for agent tools (forbid ambient credentials).** audit-only, with a
      narrow by-construction sub-claim only if a framework-owned `tool()` + ambient-credential symbols exist ·
      lev 3 · XL · breaking. Generalize KV418 ("a `csrf:false` handler may not read ambient session") to the
      agent-tool boundary so a tool acts under the **end-user's** authority, not server-wide ambient credentials.
      _Trade-off:_ reusing KV418's _symbol-identity_ pattern is sound, but generalized to arbitrary "ambient
      credentials" it degrades to author-assertion/audit-only. **Defer** behind OPP-07.

- [ ] **OPP-04 — Confidential-AT-REST classification.** by-construction (plaintext-write-inexpressible
      _gate_, destination-column-anchored) + runtime-DiD (the crypto floor) · lev 7 · L · breaking. Kovo proves
      secrets can't reach the wire (KV435) but a `secret`/confidential value can be written to a plaintext DB
      column. Add a `confidentialAtRest` column classification; extend the KV438 write-provenance engine so a
      write of such a column not flowing through the blessed authenticated-encryption sink is a build error.
      _Trade-off:_ anchor the gate on the **destination column declaration**, not on `secret()` _source_
      provenance (provenance dies at `.reveal()` — that framing is an unsound over-claim and must be dropped). The
      cryptographic guarantee itself is runtime-DiD.

- [ ] **OPP-21 — Non-secret over-serialization gate.** by-construction (shape/intentionality, **not**
      confidentiality) · lev 5 · M · breaking. KV435 catches secret columns on the wire, but a whole DB row of
      non-secret PII crosses freely (the universal Prisma/Drizzle full-row leak). Extend `confidentiality.ts` so
      any value with DB/table provenance crossing the wire boundary needs an explicit projection allowlist.
      _Trade-off:_ proves **intentionality**, not confidentiality (PII-ness isn't a declared provenance fact) —
      ship it as a warning-grade over-serialization floor, not a confidentiality proof.

- [ ] **OPP-06 — Mandatory purpose/audience binding on capability & CSRF tokens.** by-construction (at the
      verify sink, cross-context-confusion property) · lev 6 · M · breaking. Mirror ASP.NET purpose strings /
      Phoenix salts: make the signing context a required, branded, type-distinct parameter that participates in
      key derivation, so a token minted for one context cannot verify in another. _Trade-off:_ sound kill of
      cross-context replay, but narrower than a fresh vuln-class and gated on OPP-05's KeyRing.

### Band 2 — AuthN / crypto gap-closers (prior art owns these; Kovo delegates today)

- [ ] **OPP-05 — First-class signing KeyRing (rotation).** by-construction (refuse-to-boot on missing/
      un-versioned key, at the createApp chokepoint) + runtime-DiD (multi-key transparent verify) · lev 6 · L ·
      breaking. CSRF, `signCapability`, and the signed-cookie secret all hang off a single un-versioned secret
      (no rotation/revocation). Introduce a typed KeyRing: `sign()` uses the single Active key; `verify()` tries
      every non-Revoked key; keys carry activation/expiry/revoked state. _Trade-off:_ the boot gate + runtime
      fail-closed verify are sound, but the "rotation by construction / revoked-key inexpressible" headline is a
      **type-only over-claim** (key state is runtime data) — describe verify as a runtime guard. Foundation for
      OPP-06/11/12.

- [ ] **OPP-10 — First-party password primitive (argon2id-only sink).** by-construction (narrow:
      plaintext-at-rest on the app-Drizzle write surface, KV438 extension) + runtime-DiD (params, auto-rehash,
      alg-pinned verify) · lev 5 · L · breaking. Kovo ships no hasher. Expose a `Password` type whose only
      persistence path is the blessed argon2id hasher (no fast-hash mode reachable, Laravel-style); a
      request-derived value written to a password column without passing the hasher is a build error.
      _Trade-off:_ a strong unconditional default + a narrow real plaintext-at-rest gate around a mostly
      runtime-DiD floor; by-construction reach is blunted where `better-auth` owns the credential sink.
      Progress: `packages/server/src/password.ts` adds the public argon2id-only `hashPassword`/`verifyPassword`
      sink with parameter floors and alg-pinned digest parsing. Remaining gap: the KV438 password-column
      persistence gate is not implemented, so this item stays open.

- [ ] **OPP-11 — Opaque, instantly-revocable Session as the DEFAULT (JWT opt-in).** runtime-DiD
      (rotation/revocation) + by-construction-for-the-JWT-class (only if Kovo owns the session sink) · lev 5 ·
      XL · breaking. Default to opaque server-stored sessions, sidestepping the entire JWT vuln family; the
      establish sink rotates on auth (fixation floor). _Trade-off:_ opaque-default genuinely kills the JWT family
      by construction, but only fires if Kovo reverses §6.5 and **owns** the session sink — a large architectural
      commitment. **Revisit** vs. the `better-auth` delegation.

- [ ] **OPP-12 — Token verify pins algorithm to KEY TYPE.** by-construction (at the verify sink) · lev 4 ·
      M · non-breaking. If Kovo ever offers a client-parseable token (OPP-11 opt-in), the verify sink must derive
      the algorithm from the **key type** (HMAC vs public-key are distinct KeyRing types), never the token header
      `alg` — making `alg:none` and RS256→HS256 confusion inexpressible. _Trade-off:_ correct and tier-1 at the
      sink, but defends a format Kovo may not ship — adopt only **inside** OPP-11, not standalone.

- [ ] **OPP-09 — Account-enumeration-safe credential verification.** runtime-DiD (constant-**work** timing
      floor) · lev 5 · M · non-breaking. Provide `verifyCredential()` that always runs a full argon2id compare
      (dummy hash against a fixed decoy on user-miss) so response time/shape don't branch on existence.
      _Trade-off:_ a genuinely novel framework-owned timing floor, but it neither eliminates the class by
      construction nor covers app-authored existence-branched responses elsewhere (that check is audit-only).

### Band 3 — Floor hardening & free browser headers

- [ ] **OPP-29 — API4 fail-closed defaults: pagination ceiling + body-size cap.** runtime-DiD · lev ~6 · M ·
      breaking _(main-thread tier; verdict agent hit the limit)_. Default request-body size cap + default
      result-count ceiling on list loaders at the runtime sink; an unbounded `.list()` with no `.max/.limit`
      gets a conservative cap + a build warning. _Trade-off:_ a real secure-default that closes the forgotten-
      pagination DoS; must pick caps that don't surprise legitimate large reads (opt-up is explicit).

- [x] **OPP-26 — Single-source the inline fragment sanitizer.** runtime-DiD · lev 6 · M · non-breaking.
      `response-fragment-apply.ts` carries local mini-sanitizers while the decision table lives in
      `sink-policy.ts` — a drift-XSS surface. Generate the inline helper from the shared policy at build time (or
      ship a parity corpus). _Trade-off:_ a real drift fix that single-sources an XSS floor — label runtime-DiD,
      not the by-construction the original sketch claimed.
      Evidence: `secure-framework-3.md` verifies shared server/browser sanitizer parity across
      `response-fragment-apply`, inline-loader extraction, `sink-policy`, and static-export CSP hash fixtures.

- [x] **OPP-27 — Blessed safe-rich-HTML sanitizing sink through the `kovo` Trusted Types policy.**
      runtime-DiD (+ by-construction sole-policy transport) · lev 6 · L · non-breaking. TT correctly throws on raw
      user-HTML but leaves no safe path for the legitimate CMS/rich-text case. Provide `sanitizeHtml`: server-side
      allowlist parse (drop script/handlers/`javascript:`/`data:`), browser-side native Sanitizer API `setHTML()`.
      _Trade-off:_ trades an audited per-feature escape for a framework sanitizer floor — a bypassable allowlist,
      not a by-construction XSS kill.
      Evidence: `packages/browser/src/security-output.ts` adds `safeRichHtml()`/`sanitizeRichHtml()` with an
      allowlist floor and routes branded output through the `kovo` Trusted Types policy; server
      `safe-html.ts` re-exports that sink for rendering. `pnpm exec vitest run
packages/browser/src/security-output.test.ts packages/browser/src/trusted-types.test.ts
packages/browser/src/index-exports.test.ts packages/server/src/safe-rich-html.test.ts` passed.

- [x] **OPP-19 — Deserialization / prototype-pollution floor.** runtime-DiD (decode/null-proto) +
      by-construction (static sink ban, statically-visible subset) · lev 6 · M · non-breaking. Route all body
      decode through `s.*` decoders building null-prototype objects, no reviver; static-ban `__proto__`/reflective
      attacker-key deref where visible. Object lesson: the Next RSC Flight pre-auth RCE (CVE-2025-55182).
      _Trade-off:_ real and worth building, but a labeled floor + a KV422-shaped (bounded) static ban — **not**
      the blanket by-construction elimination first proposed.
      Evidence: `packages/server/src/schema.ts` rejects reserved object-shape keys and reads only own input
      fields during schema projection; mutation JSON decode is covered in `app-mutation-request.test.ts`.
      Focused schema and mutation request tests passed.

- [x] **OPP-20 / SINK-03 — General path-traversal-safe file-serving primitive.** see SINK-03. lev
      6–7 · L.
      Evidence: `packages/server/src/file.ts` exposes `rootedFiles(root).serve(relativePath, …)`,
      realpath-checks containment before serving through `respond.stream`, and treats traversal, absolute/NUL
      paths, directory targets, missing files, and symlink escape as not-found. `pnpm exec vitest --run
packages/server/src/file.test.ts packages/server/src/response.test.ts` passed.

- [x] **OPP-13 — SRI integrity on emitted module/style tags.** runtime-DiD (browser-enforced; cross-origin
      subresources only) · lev 2 · M · non-breaking. Kovo already content-hashes immutable modules and inline
      scripts, so the digests are in hand — attach `integrity=sha384-…` to emitted first-party tags. _Trade-off:_
      a narrow real floor for app-allowlisted cross-origin subresources; **inapplicable** to the same-origin
      `import()`/modulepreload execution path it primarily targets — do not sell it as by-construction.
      Evidence: `packages/server/src/static-export-sri.ts` attaches `sha384` integrity where static export has
      first-party module/style bytes. `pnpm exec vitest run packages/server/src` passed.

- [ ] **OPP-14 — Framework-owned Reporting pipeline (`report-to`).** audit-only · lev 6 · M · non-breaking.
      Strict CSP ships with **no** reporting, so a blocked attack/regression emits zero signal — bad for
      AI-operated apps with no human watching. Emit `Reporting-Endpoints` + per-directive `report-to` (CSP/COOP/
      Permissions) to a framework endpoint; aggregate redacted reports; rescue the built-then-dropped KV236 events.
      _Trade-off:_ cheap observability that converts blind floors into auditable ones, but introduces an
      attacker-triggerable report channel that must be rate-limited and redacted.

- [ ] **OPP-15 — Clear-Site-Data on logout + `Origin-Agent-Cluster: ?1`.** runtime-DiD · lev 4 · M ·
      non-breaking. Ship OAC `?1` now (one-line origin-keyed isolation). Emit `Clear-Site-Data:
"cookies","storage","executionContexts"` on session-revocation. _Trade-off:_ OAC is a clean DiD floor now;
      defer Clear-Site-Data until a framework-owned logout/revoke sink exists to emit it by construction rather
      than as an app-ownable header. The "inexpressible" framing is an over-claim.

- [x] **OPP-16 — BREACH-mask the CSRF token (per-response XOR).** runtime-DiD · lev 6 · S · breaking.
      `csrf.ts` emits a stable token into compressible HTML over TLS → inherits the BREACH oracle. XOR-mask the
      session-bound secret with fresh per-request randomness (Spring 6 / Django default); unmask before the
      constant-time compare. _Trade-off:_ real low-cost hardening of a live oracle in Kovo's default-compressed
      stack — DiD-on-DiD, not a class kill.
      Evidence: `packages/server/src/csrf.ts` emits `v1.<mask>.<masked-mac>` tokens and unmasks before
      constant-time verification against current/previous secrets; `packages/server/src/replay.ts` canonicalizes
      replay fingerprints across fresh masks; `packages/conformance-fixtures/src/verification-fixtures.ts`
      submits the rendered masked field token. `pnpm exec vitest run packages/server/src` and `vp exec node
scripts/kovo-check.mjs` passed.

- [x] **OPP-30 — Centralize framework system-response posture.** runtime-DiD · lev ~5 · S · non-breaking
      _(main-thread tier)_. Pre-dispatch 429/413/normalization-redirect responses carry only Content-Type/
      Retry-After, missing the `Cache-Control: private,no-store` / `Vary: Cookie` / build-token posture of
      post-dispatch responses. One helper stamps all framework 3xx/4xx/5xx system responses. _Trade-off:_
      low-risk consistency fix closing a cache-poisoning/posture-leak edge.
      Evidence: `secure-framework-3.md` verifies `packages/server/src/app-system-response.ts` centralizes
      reserved system response posture; `pnpm test packages/server/src/app.test.ts` covered 413/429 paths.

- [x] **OPP-22 — Build-time egress deny floor (harden-runner analog).** runtime-DiD (CI scaffolding) +
      audit-only (release-age cooldown) · lev 4 · M · non-breaking. Secure-default CI: script-blocking install +
      egress allowlist for the build/install step (the Shai-Hulud worm vector). _Trade-off:_ genuinely useful
      supply-chain secure-defaults, but operator/CI-ownable hardening — do not dress as the runtime "egress floor"
      it isn't; slice overlaps shipped tarball gates.
      Evidence: `scripts/egress-floor.mjs` runs build/publish commands with a deny-by-default
      `NODE_OPTIONS=--require` hook over Node net/tls/http/https, and CI runs `check:build` through that wrapper.
      `pnpm exec vitest --run scripts/egress-floor.test.mjs scripts/supply-chain-gates.test.mjs`, `pnpm run
check:build`, and `pnpm run check:publish` passed.

- [x] **OPP-23 — Dependency-confusion + tarball-content static gates.** audit-only · lev 5 · M ·
      non-breaking. The one statically-decidable supply-chain slice Kovo can own: an `.npmrc` org-scope pin + a
      build-time check that fails closed if an `@org` name resolves from the public registry; a content scan of
      the packed tarball for secrets/maps/absolute paths. _Trade-off:_ real CI hardening, but suppressible
      audit-only, not a by-construction vuln-class kill.
      Evidence: `.npmrc` pins `@kovojs` to npmjs and `scripts/check-pack-security.mjs` fails closed on missing,
      env-substituted, or non-npmjs first-party scope registry pins. `pnpm exec vitest run
scripts/check-pack-security.test.mjs` passed; `pnpm run check:pack-security -- --write` reviewed and
      refreshed the packed-file snapshot after inspecting every public package.

### Band 4 — Honesty & positioning (the credibility moat)

- [ ] **OPP-24 — Honesty pass on stale tier framing.** audit-only · lev 5 · S · non-breaking. (a)
      `managed-db.ts`: until OPP-02 lands, stop implying KV433 Stage-2 ships — state current protection is
      runtime-DiD proxy + type-only, by-construction proof DEFERRED. (b) `capability-url.ts`: fix the stale
      comment (one literal false statement). (c) Tier the auth out-of-scope surface explicitly so silence doesn't
      read as coverage. _Trade-off:_ cheap and real — corrects a false source statement and removes
      coverage-by-silence on three OWASP categories; enforces nothing.

- [ ] **OPP-25 — Prompt-injection blast-radius thesis.** audit-only · lev 6 · S · non-breaking. The
      community is unanimous: prompt injection is unsolvable inside current LLMs. Document that Kovo does **not**
      claim injection-proofing (the unsafe state is in the model token stream, not compiled code) and position the
      by-construction/floor controls (KV436 default-deny, egress floor, OPP-07 capability bounding) as the
      **blast-radius bound**. _Trade-off:_ high-honesty, high-audience-value — but **revisit** the exact wording
      until OPP-01/07 land, since the bound it describes partly depends on them (an opt-in egress floor is not a
      bound). The composite bound is only as strong as its weakest (bypassable) link.

- [ ] **OPP-02 — KV433 Stage-2 honesty + optional widening.** by-construction (directly-reachable subset,
      already ships) · lev 3 · S · non-breaking. The directly-reachable read-loader no-write gate already ships
      and is tested; the honest remaining work is correcting the "still deferred" comment (folds into OPP-24) and
      optionally widening the static verb set. _Trade-off:_ mostly a relabel; the interprocedural tail stays a
      runtime-DiD proxy backstop.

### Research / defer

- [ ] **OPP-28 — Authorization-gates-DATA (guard-principal == WHERE-predicate).** by-construction aspiration ·
      XL · high false-positive _(main-thread tier; verdict agent hit the limit)_. The deferred IDOR-completeness
      dream: prove the guard's principal symbol equals the symbol scoping the returned rows' WHERE predicate. The
      now-present `CallExpression` interprocedural branch makes a narrow, fail-closed read-path subset newly
      feasible. _Trade-off:_ the highest-value access-control deepening, but XL and FP-prone — scope to a narrow
      directly-reachable subset first, keep KV414 as the shipped floor. **Research spike before committing.**

---

## 3. Sink-Token Brands (the unified `Blessed<Sink>` substrate)

The general form of Kovo's existing Trusted-Types / SQL-witness / capability-URL controls: a dangerous
sink accepts **only** an unforgeable blessed value whose **only** constructor is the framework's
validated/escaped path (a _constructor monopoly_). One kernel, parameterized by sink — not N bespoke
wrappers. This generalizes the already-shipped SQL `Symbol`-witness (`core/internal/sql-safety.ts`) and
makes Trusted Types its browser-enforced special case.

### 3.1 The substrate

- **Representation = phantom type + module-private runtime witness** (the two halves Kovo already ships
  separately). tsc half: `type Blessed<S, T = string> = T & { readonly [BRAND]?: S }` with a non-exported
  `unique symbol` — a raw `string` is a tsc error at the sink (the `Secret<T>`/`public()` analogue,
  **type-only**). Runtime half: a shared `blessRegistry: Map<SinkKind, WeakSet>` plus, for primitives that
  can't live in a WeakSet, a module-private `Symbol('kovo.bless.<sink>')` stamped non-enumerable on a frozen
  boxed carrier (the `Object.defineProperty(..., {enumerable:false})` trick `stamp()` already uses). Witnesses
  use `Symbol()` **not** `Symbol.for()` so app/attacker code can't reconstruct them.
- **Constructor monopoly:** the only functions that call `bless(sink, value)` live inside the owning module
  and _are_ the validators/escapers (`root.resolve` → SafePath, no-shell `cmd()` → ShellArgv, `sanitizeNext`
  → RedirectTarget). There is deliberately **no** generic public `bless`/`trust` (the egress.ts "no generic
  `withMetadataAccess`" discipline). Audited escapes (`trustedSql`, `unsafeRegex`) mint the same brand **and**
  record a KV426 provenance fact surfaced in `kovo explain`.
- **Sink demands the brand + re-checks:** every framework-owned sink types its dangerous parameter
  `Blessed<sink>` (layer a) **and** calls `assertBlessed(sink, value)` at the boundary, fail-closed (layer b)
  — belt and suspenders, because `any`/cast defeats tsc but not the runtime witness. This is exactly the SQL
  Proxy re-running `validateManagedSqlStatement` on every `db.query`.
- **Static AST constructor-monopoly proof (layer c — what earns "by-construction"):** reuses Kovo's §11.1
  AST symbol-identity provenance + sink classification (**not** runtime taint). Per owned-sink call-site, walk
  the value-path backward by symbol identity; prove provenance terminates only in a blessed-constructor call,
  with **no** `any`, cast, non-null `!`, dynamic property/spread laundering, or flow through an unsummarized
  cross-module boundary. When that holds, a non-blessed value at the sink is inexpressible in the sound subset.

### 3.2 The tier ladder — and the exact rule for the ceiling

Three stacked layers per sink: **(a) type-only** (signature) → **(b) runtime-DiD floor** (witness re-check,
catches `any`/cast/missing-tsc) → **(c) by-construction** (AST proof). A sink reaches **by-construction iff
BOTH**: **(i)** the framework **owns the sink call-site** (framework-authored/emitted IR, or every app path
is forced through a framework chokepoint the AST can pin), **AND (ii)** the value-path stays in the **sound
subset**. If (i) fails (the dangerous call is a third-party API — `pgDriver.query`, `child_process.exec`,
`fs.readFile`, `new RegExp`, `eval`), the honest ceiling is **type-only + lint** (+ a runtime floor _only_ if
Kovo interposes a wrapper). If (i) holds but (ii) fails on a path (a cast launders the brand), that call
degrades to the (b) floor and the laundering site is reported (**KV440**) — never silent.

> **Corollary (matches shipped reality):** SQL-on-managed-handle and in-app redirect are by-construction;
> egress, the read-only-handle proxy, Trusted Types, and the cookie floor are runtime-DiD floors;
> shell/fs/eval/regex-from-input are type-only + lint until Kovo ships an **owned** primitive that becomes
> the only path.

### 3.3 Ranked brand candidates

| ID          | Brand · sink                                                        | Honest tier                                                                                                                 | Lev | Effort  | Recommendation                                                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SINK-01** | `SqlText`/`SqlIdentifier`/`SqlKeyword` · managed DB handle (CWE-89) | **by-construction** at the managed sink (string/template SQL); floor for object-shaped & identifier channels                | 9   | S       | **build** — fold ident/keyword into the kernel; **kill the `KOVO_SQL_GUARD` warn/off knob; flip native-object fall-through from default-allow to default-deny**                                          |
| **SINK-03** | `SafePath` · rooted file serve (CWE-22)                             | **by-construction** for storage-key surface; floor at `root.resolve` (realpath containment); type-only+KV424 at raw `fs.*`  | 7   | M       | build-as-floor — ship `root.resolve` cap-handle + witness; `respond.file` already owns disposition                                                                                                       |
| **SINK-05** | `RedirectTarget` (client) · `Kovo-Reauth` nav                       | runtime-DiD floor (sanitize-on-navigate)                                                                                    | 8   | S       | build — **drop the brand object**, keep a `sanitizeReauth` call chokepoint (= OPP-17; live hole)                                                                                                         |
| **SINK-02** | `Command`/`ShellProgram` · `child_process` (CWE-78)                 | runtime-DiD floor at `cmd()` + type-only sig + KV424 at raw sinks                                                           | 6   | M       | build-as-floor — `cmd(program, argv[])` execFile, no shell; **not** by-construction (`node:child_process` is an unpinnable peer import)                                                                  |
| **SINK-04** | `RedirectTarget` (server) · Location header (CWE-601)               | runtime-DiD floor (`sanitizeNext` re-validate) + type-only route surface                                                    | 5   | S       | build-as-floor — add a runtime witness; `isRedirect()` currently accepts any `{status:303, location:string}` plain object (forgeable)                                                                    |
| **SINK-06** | `LinearSafePattern` · RegExp-from-input (CWE-1333)                  | **split:** blessed formats = by-construction; `pattern(literal)` "floor" is **FALSE**; `new RegExp(input)` = type-only+lint | 4   | M (RE2) | build-as-floor — **honesty-critical: the 4096-char length cap is NOT a CPU bound** (`/^(a\|a)*$/` burns 33s at 31 chars and passes today). Ship RE2-class linear engine or relabel `pattern()` as unsafe |
| **SINK-09** | `MongoFilter` · NoSQL operator injection (CWE-943)                  | scalar-coercion half by-construction (declared fields); filter-build half floor + type-only at unowned driver               | 3   | M       | build-as-floor — needs a managed Mongo handle to own the sink (none today)                                                                                                                               |
| **SINK-11** | (channel, no brand) · log forging (CWE-117)                         | runtime-DiD floor at the framework logger only                                                                              | 3   | S       | build-as-floor — structured logger neutralizes CR/LF/control/ANSI on emit (**KV439**); `console.log` stays unowned                                                                                       |
| **SINK-10** | `EmailHeader` · SMTP header injection (CWE-93)                      | runtime-DiD floor (CRLF reject) — contingent on a mail primitive                                                            | 3   | M       | **defer** — no owned mail sink today; KV424 registry covers it for now                                                                                                                                   |
| **SINK-08** | `ParsedShape` · deserialization (CWE-502)                           | wire already by-construction via the JSON-only parser monopoly; brand buys nothing                                          | 3   | S       | **type-only-lint** — add KV424 for unowned app deserializers; drop the brand (folds into OPP-19)                                                                                                         |
| **SINK-07** | (none) · `eval`/`Function`/`vm` (CWE-95)                            | audit-only — KV424 **hard ban**                                                                                             | 4   | S       | **defer/no-brand** — there is no safe value to bless; "blessed arbitrary code" is a contradiction (CSP/TT refuse it too)                                                                                 |

### 3.4 New diagnostics (KV439–442)

- **KV439** — log-channel control-character neutralization floor (CR/LF/NUL/C0/DEL/ANSI on emit; mirrors KV415
  for headers). Raw `console.log` of a request-interpolated string is flagged as an unowned log sink (lint).
- **KV440** — blessed-brand laundering on an owned-sink value-path (provenance passes through `any`/cast/`!`/
  dynamic read/spread). The witness still fails closed; the by-construction **claim for that call** is voided
  and the laundering site reported.
- **KV441** — `SafePath`/rooted-fs escape: a value at `respond.file`/managed fs is not a `SafePath` from
  `root.resolve`, or containment failed (absolute/`..`/NUL/backslash/symlink-out-of-root at realpath).
  Fail-closed at the syscall boundary; raw `fs.*` path sinks are KV424.
- **KV442** — unowned dynamic sink **with** a brandable safe surface (shell/fs/`new RegExp(input)`/`eval`/vm/
  unsafe deserialize where `cmd`/`root.resolve`/blessed validators/JSON+schema exist). Unlike KV424's
  catch-all, KV442 names the specific `Blessed` primitive to route through **and records whether the achievable
  tier collapses to type-only+lint because the sink is unowned** — the honesty marker.

### 3.5 Integration

Refactor KV422 SQL to consume the shared kernel (it is the reference three-layer implementation). Trusted
Types is the literal browser template: `TrustedHTML` = `Blessed<'html'>`, the single `kovo` policy is the
constructor monopoly, and the browser enforces the witness **below** the JS layer (a runtime-DiD floor,
Chromium-only) — the cross-browser by-construction XSS guarantee stays carried by compiler contextual
escaping (KV236), not by TT. Every audited escape records a `kovo explain` provenance fact.

---

## 4. Relabels, drops, and non-goals (honesty discipline)

- **Drop** the `pattern(literal)` length-cap "ReDoS floor" framing — it does not bound catastrophic
  backtracking (SINK-06). Either ship a linear engine or relabel `pattern()` as an audited-unsafe escape.
- **Drop** the "any `secret()`-provenance value reaching a column" framing for confidential-at-rest — anchor on
  the destination-column declaration instead (OPP-04); source provenance dies at `.reveal()`.
- **Relabel** OPP-05's "rotation by construction / revoked-key inexpressible," OPP-13's SRI, OPP-15's
  Clear-Site-Data, and OPP-26's sanitizer as **not** by-construction (runtime-DiD / type-only), per the verdicts.
- **No-brand** for `eval`/`vm` (SINK-07) and for the JSON wire (SINK-08) — hard ban and existing parser
  monopoly respectively; a brand buys nothing.
- **Non-goal:** by-construction prompt-injection proofing (OPP-25) — out of scope by nature; Kovo claims a
  blast-radius bound, not immunity.

## 5. Open questions

- OPP-07/08: does a first-class `tool()` primitive belong in core, and what is the minimal governed-sink
  annotation that keeps capability-bounding sound without over-claiming Excessive-Agency coverage?
- OPP-11: reverse §6.5 to own the session sink (unlocks opaque-default + JWT-class kill + OPP-12), or stay
  delegated to `better-auth`? This is the largest architectural fork in the plan.
- SINK-01: is flipping native-object SQL fall-through to default-deny acceptable for the Drizzle native path,
  or does it need a one-release blessed-native-statement migration?
- OPP-28: scope a narrow directly-reachable read-path subset that keeps false positives tolerable.

## 6. Provenance

Produced by two background research+synthesis workflows (Jun 2026): a 12-lane prior-art/threat sweep
(Rails, Laravel, Django, Next/React, JS meta-frameworks, Spring/ASP.NET/Phoenix, browser primitives,
supply-chain, authn/crypto, OWASP/API/LLM taxonomies + AI-agent security) → 18-class coverage matrix →
30 opportunities → adversarial per-opportunity soundness/tier/leverage verdicts; and a focused
sink-token-brand design workflow → injection-sink census → unified `Blessed<Sink>` substrate → 11
brand candidates with red-team verdicts. Final ranking and tiering by the main thread; the
`final:ranking` and `synthesize:section` formatter agents and verdicts for OPP-28/29/30 hit the
account session limit (those three tiered by the main thread). Re-running the formatter agents after
the limit resets would only reformat material already captured here.
