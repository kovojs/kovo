# Fundamental Fixes Followup 15 — classify the NORMALIZED entity, and prove a completeness fix is a SUPERSET

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the C10/C11 line
(`fundamental-fixes-followup-{6..14}.md`). Responds to the Round-18 dogfood (`plans/claude-bugz-39.md` B1–B3,
`plans/claude-papercuts-37.md` P1–P3). Line numbers cite `main` (`fdfa74164` / current after `3e6de3e18`).

## 1. The foundational issue (round-18 restatement)

Round 18 verified followup-14 AND found the arc's sharpest lesson yet: **the C11 fix itself shipped a C11 bug.**
followup-14 DEC-B closed F1 (the ReDoS quantifier SET omitted `?`) by rewriting `containsQuantifier` from a crude
char-scan into a structured atom-walk. Correct for `?` — but the atom-walk treats a `(...)` group as one OPAQUE ATOM
and never descends, so its TRAVERSAL now covers a SUBSET of the pattern tree. The crude scan it replaced was complete
over the body string (it saw a `+` anywhere, including inside nested groups). Net result: `((a+))+` was rejected before
DEC-B and PASSES after. A completeness fix regressed completeness because the new, "smarter" mechanism was not proven a
SUPERSET of the crude one.

All three round-18 fail-opens are one of two closely-related shapes:

| Finding | Shape                                     | The subset shipped                            | The complete surface                                      |
| ------- | ----------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| B1      | traversal covers a subset of the tree     | body TOP LEVEL (`readAtom` steps over groups) | recurse into nested groups — the whole parsed tree        |
| B2      | classifier ranges over a subset of tables | unknown PLUGIN tables (the KV406 path)        | every bridged table, incl. core-table `additionalField`s  |
| B3      | classify a subset of textual ENCODINGS    | a few `::`-compressed IPv6 regex forms        | the NORMALIZED 128-bit address (all serializations alias) |

## 2. Meta-invariants (extend C10/C11)

- **C12 — Classify/traverse the NORMALIZED, fully-parsed entity, never a surface encoding of it.** B3 (classify the
  canonical address bytes, not a textual serialization) and B1 (walk the parsed pattern tree, not a surface scan that
  stops at the top level) are the same error C9 named for the DB boundary, now on the IP and regex surfaces: a decision
  on an encoding is a decision on a proxy, and the fox is the encoding you didn't enumerate.
- **C13 — A completeness fix must be proven a SUPERSET of what it replaces.** When a crude-but-complete check is
  replaced by a precise one, a regression test must pin every input the old check caught, so the "smarter" replacement
  cannot silently drop coverage (B1 shipped precisely because no such proof existed). Corollary: prefer fail-closed
  DEFAULTS so an un-enumerated member is denied, not allowed (B3's IPv6 path defaults OPEN while IPv4 defaults
  closed-by-complete-enumeration — the asymmetry is the bug).

## 3. Decisions / work items

### DEC-A — ReDoS analyzer walks the whole parsed tree; regression-pinned (fixes B1)

- [ ] **A1 — `containsQuantifier` (`redos.ts:241`, compiler twin `redos-pattern.ts:170`) RECURSES into group interiors:
      a quantifier at ANY depth inside a quantified group's body (found via `quantifierAt` at each atom position,
      descending through nested `(...)`) makes `assertLinearSafePattern` reject. `((a+))+`, `(a(b+))+`, `(([a-z]+))+`,
      `((\d+))*` reject again; `(?:ab)+`, `(a?b?)+`, `a?b?c?`, `((ab))+` still pass (no over-block). Add a before/after
      regression test that pins EVERY pattern the pre-DEC-B gate (`2268ca041~1`) rejected, so a future traversal rewrite
      cannot regress nested-group detection (C13).**
  - Acceptance: the round-18 repro set rejects at runtime AND compile-time (KV434); the over-block set passes; a
    committed regression corpus (pre-DEC-B rejects ∪ round-17/18 cases) is asserted green; both twins stay in sync.
  - **O1 resolved:** ship the recursion fix (fork a) as the v1 correctness fix; DEFER the RE2/DFA linear-time engine
    (fork c) — do NOT take on that TCB dependency preemptively. The DEC-D ReDoS fuzzer is the decider: if it finds zero
    accept-but-super-linear patterns over a large generated corpus, the hand-rolled analyzer is empirically complete and
    RE2 is unnecessary; if it keeps finding gaps, that is the signal to adopt (c). Reject the conservative-over-reject
    (fork b) — it degrades the safe `pattern()` path into uselessness and pushes authors to `unsafeRegex`.

### DEC-B — Credential classifier ranges over every bridged table (fixes B2)

- [ ] **B1 — The positive credential classifier (`isBetterAuthCredentialShapedColumn`, `internal.ts:1034`) runs over the
      OBSERVED columns of EVERY bridged table — known core (`user`/`session`/`account`) and plugin — not only the
      unknown-plugin KV406 suggestion path (`internal.ts:918` is currently the sole caller). A credential-shaped
      `additionalField` on a core table (`user.totpSecret`, `apiSecret`, `recoveryKey`) is branded `secret:` so a
      projection reading it is KV435-blocked; a benign `additionalField` (`displayName`) is not (no over-block).**
  - Acceptance: adding a credential `additionalField` to `user` brands it secret and blocks a wire projection; a benign
    field stays readable; the static bridge secret lists are unioned with the classifier's verdict over observed
    columns, not copied verbatim.
  - **O2 resolved:** default-secret-with-fail-closed (fork a, hardened), NOT require-annotation-for-all (fork b). A
    credential-shaped name with no annotation defaults `secret:` (closes the leak); a benign-shaped name defaults
    readable (no over-block); the author can override EITHER direction. Keep the noun lexicon conservative (segment-final
    match) to bound over-block, and SPEC-document that a non-lexically-named credential (`material`, `vaultRef`) requires
    an explicit `secret:` annotation — that residual is the honest, bounded ceiling of any name rule (papercuts-37 P2).

### DEC-C — Egress classifies the normalized address, fail-closed by default (fixes B3)

- [ ] **C1 — `classifyIpv6` (`egress.ts:542`) normalizes FIRST: expand `::`, extract any embedded IPv4-mapped/-compat/
      translated v4 (all serializations — compressed, uncompressed, zero-padded, mixed-case, and the tunneling prefixes)
      and classify the embedded v4, then match prefixes on the canonical form. Its DEFAULT is FAIL-CLOSED: only genuine
      global unicast (`2000::/3` minus documented special-use) returns `public`; everything else returns a non-public
      class (denied unless allowlisted / credential-framed). Every textual serialization of the same 128 bits classifies
      identically. This aligns IPv6 with the module's own stated contract (`egress.ts:404-405`) and with `classifyIpv4`'s
      complete-enumeration posture.**
  - Acceptance: `0:0:0:0:0:ffff:169.254.169.254` (and hex/zero-padded/mixed-case forms) classify `metadata`, not
    `public`; `fec0::/10` and `::a9fe:a9fe` classify non-public; a legit global-unicast v6 still classifies `public`
    (no over-block of real egress). Add a table/fuzz test over serializations of the metadata + private ranges asserting
    none classify `public`.
  - **O3 resolved:** IPv6 adopts IPv4's complete-enumeration-then-fail-closed posture (fork a). `public` iff the
    canonical address is in `2000::/3` MINUS the documented special-use carve-outs (`2001:db8::/32` docs, 6to4
    `2002::/16`→extract-v4, Teredo `2001::/32`→extract-v4, NAT64 `64:ff9b::/96`→extract-v4, ORCHID `2001:20::/28`); every
    other address is non-public/denied. Over-block risk is near-zero because RFC 4291 allocates ALL current global
    unicast from the single `2000::/3` prefix, so the enumeration is simple and complete — the mirror of `classifyIpv4`.

### DEC-D — Make each classifier a DIFFERENTIALLY-checked invariant (the DEC-E pattern, generalized)

- [ ] **D1 — Apply the followup-13 DEC-E differential-fuzzer pattern to each of the three classifiers so "the next
      form/subset" is caught by an oracle, not the next dogfood.** ReDoS: fuzz random quantified-group nestings, compile
      each, and assert (analyzer-accepts ⇒ measured-linear) — an accepted-but-super-linear pattern turns it RED. Egress:
      fuzz serializations of known metadata/private ranges through `net.isIP`/`new URL` and assert none classify
      `public`; cross-check against a reference normalizer. Auth: fuzz `additionalFields` names and assert credential
      -shaped ⇒ secret across all bridged tables.
  - **O4 resolved:** BUILD DEC-D now (v1), prioritizing the two STRONG-ORACLE arms. ReDoS oracle = actual measured match
    time (analyzer-accepts ⇒ provably sub-quadratic on adversarial strings) — this arm is highest-value because it
    _decides O1_ (whether RE2 is needed). Egress oracle = an independent parse-to-16-bytes normalizer; assert every
    serialization classifies identically. Auth has NO independent ground-truth for "is this a credential" (the name rule
    IS the definition), so its arm is a CONSISTENCY/WIRING test (same column classified identically across tables;
    classifier invoked for every bridged table), not a true differential — lower power, still catches the B2-class
    wiring gap. DEC-D's generated corpora also SEED the DEC-E regression pins (O5).

### DEC-E — Standing rule: a security-classifier refactor must prove it is a SUPERSET (C13; fixes the root of B1)

- [ ] **E1 — Adopt C13 as a mechanized standing rule.** Each listed security classifier keeps a COMMITTED regression
      corpus of every input it rejects/classifies-non-public; a `check:*` gate asserts the corpus stays green and only
      grows, so a refactor that drops prior coverage fails CI. In-scope classifiers: the ReDoS analyzer
      (`redos.ts`/`redos-pattern.ts`), the IP/egress classifier (`egress.ts`), the secret/credential classifier
      (`better-auth/internal.ts`), the DEC-F sink registry, and the Postgres identity posture. Add
      `rules/security-classifier-refactors.md` (or a section in `rules/compiler-hard-rules.md`) documenting the rule; the
      DEC-D fuzzer corpora seed the pins.
  - Acceptance: the corpus gate exists and is wired into `pnpm run check`; re-introducing the B1 regression (or an F1 /
    round-17 case) turns it RED; the rule file is referenced from the progress-discipline list.

## 4. Resolved design decisions (decided 2026-07-06)

O1–O5 are decided and folded into the DECs above. Recorded here for provenance.

- **O1 (ReDoS: patch vs replace the engine) → RESOLVED into DEC-A: ship the recursion fix, DEFER RE2/DFA.** ReDoS in
  `pattern()` is footgun-avoidance, not a core guarantee (threat-matrix M5: the 4096-char cap + rate limits are the DoS
  posture), and exponential-ReDoS detection is decidable — so don't pay the RE2 TCB cost preemptively. The DEC-D ReDoS
  fuzzer decides whether the hand-rolled analyzer is durably complete or RE2 is warranted. Rejected the
  conservative-over-reject fork (degrades the safe path).
- **O2 (auth: default-secret vs require-annotation) → RESOLVED into DEC-B: default-secret-with-fail-closed + author
  override + documented non-lexical ceiling.** Protects the common credential names with zero author action; a
  benign-shaped name stays readable; the honest residual (non-lexically-named credentials) needs an explicit annotation.
  Rejected require-annotation-for-all (ceremony for benign fields; depends on unproven static enumerability).
- **O3 (egress: IPv6 fail-closed vs public-default) → RESOLVED into DEC-C: fail-closed on `2000::/3` minus special-use.**
  Global unicast is a single clean prefix, so the complete-enumeration-then-default-closed posture (mirroring
  `classifyIpv4`) has near-zero over-block risk and matches the module's own "fails CLOSED" contract.
- **O4 (build the differential fuzzer now vs defer) → RESOLVED into DEC-D: build now, strong-oracle arms first.** It is
  the honest "when do we stop" mechanism for the hot-spot classifiers and the decider for O1; targeted tests alone did
  not prevent the B1 regression.
- **O5 (superset-regression standing rule) → RESOLVED into DEC-E: mechanized corpus gate + `rules/` file.** Cheapest,
  highest-leverage item; directly closes the process gap that let B1 ship green.

## 5. Proving

- [ ] DEC-A: round-18 repro set rejects (runtime + compile); over-block set passes; committed regression corpus green.
- [ ] DEC-B: credential `additionalField` on `user` → secret + KV435-blocked; benign field readable.
- [ ] DEC-C: all serializations of metadata/private ranges → non-public; legit global-unicast v6 → public.
- [ ] Root gates unaffected: `check:tcb-boundary`, `check:capability-surface-census`, `check:wire-output-boundary`,
      `check:single-choke`, `check:sink-policy`, `vp check`, `git diff --check`.

## 6. Meta

Round 18 keeps the arc converging in SHAPE while widening the surface: the data-plane closures (DEC-A write-propagation,
identity, sinks, reconstruct) held; the new fail-opens are all C11/C12 "decided on a subset/encoding" on the ReDoS, auth,
and egress classifiers — plus the first REGRESSION (C13). After DEC-A/B/C land and DEC-D/O-decisions are resolved,
`plans/threat-matrix-plan.md` M2 (auth-adapter TCB) remains the last named-open matrix cell before the external audit.
