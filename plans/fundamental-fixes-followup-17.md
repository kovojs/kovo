# Fundamental Fixes Followup 17 — the durable fix closed DoS; now PROVE parity, and fail closed when the sink out-parses the classifier

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the C10–C15 line
(`fundamental-fixes-followup-{6..16}.md`). Responds to the Round-20 dogfood (`plans/claude-bugz-41.md` B1–B3,
`plans/claude-papercuts-39.md` P1–P2). Line numbers cite `main` (`02fac1fe4`).

## 1. The foundational issue (round-20 restatement)

followup-16's linear engine WORKED at its stated goal — the matcher is genuinely linear, so the ReDoS DoS class is closed
BY CONSTRUCTION (round-20 V2 found no timing cliff on any adversarial pattern). But it traded the DoS class for a
**parity class**, exactly as followup-16 flagged ("the real cost is semantic parity"): the hand-written engine disagrees
with ECMA-262 `RegExp` on edge semantics, and every case where the engine is MORE PERMISSIVE than `RegExp` is a
**validation bypass** — an anchored allowlist accepts input `RegExp` rejects. And the parity FUZZER built as the
acceptance gate was itself a subset: its input alphabet had no line terminators or control chars (`redos.test.ts:262`),
so the divergence sub-grammars were structurally unreachable, and a test even enshrined the wrong `$` behavior.

| Finding | Shape                                                | The gap                                                              |
| ------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| B1      | engine MORE permissive than `RegExp` (parity bypass) | non-multiline `$` allows a trailing line terminator (`admin\n`)      |
| B3      | engine mis-compiles instead of rejecting             | in-class `\1`–`\9` → literal digit, defeats an octal denylist        |
| B2      | sink OUT-PARSES the classifier (C12 + C15 twist)     | `%zone` IPv6: classifier null, but `net.isIP`=6 so the sink dials it |
| P1      | the parity GUARD's input domain is a subset (C16)    | fuzzer alphabet has no line terminators / control chars              |

## 2. Meta-invariants (extend C12–C15)

- **C16 — A guard's INPUT DOMAIN must be complete, not just its decision logic.** The parity fuzzer had correct logic
  (`engine === RegExp`) but an alphabet that could not REACH the divergence classes, so it certified green over a subset
  of inputs. When a differential/fuzz guard proves a property, its generator must enumerate the whole VALUE space (every
  code-point class — letters, digits, line terminators, control chars, surrogates, the escape forms — and every flag),
  not just the whole structural grammar (C14). A guard blind to a value class is a subset one level up.
- **C15 corollary (sink out-parses the classifier) — when a sink can accept a value in a FORM the classifier could not
  parse, FAIL CLOSED on the disagreement.** B2's floor assumed "classifier returns null ⇒ it's a hostname ⇒ the pinning
  lookup runs ⇒ the resolved IP is classified" — but `net.isIP`=6 made the sink treat the null-classified value as a
  literal and skip the lookup. The safe rule: if the sink recognizes a value as a literal that the classifier could not
  normalize, DENY (don't assume the fallback path applies).

## 3. Decisions / work items

### DEC-A — Fix the confirmed engine parity divergences (fixes B1, B3, P2)

- [ ] **A1 (B1) — Gate the `$` end-anchor on `flags.multiline`.** `assertionPasses` end-branch
      (`linear-regex/index.ts:508-513`) must NOT return true on `isFinalLineTerminatorPosition` (`:511`) unless
      `flags.multiline` — mirror the correctly-gated begin branch (`:503-507`). So non-multiline `$` asserts
      `endIndex===length` only; `^[a-z]+$` rejects `admin\n`/`1234\r\n`/`value\r` again. Fix the mislabeled test
      `redos.test.ts:91-105` (it asserts `/a$/` matches `'a\n'` under an "ECMAScript semantics" label — wrong).
- [ ] **A2 (B3) — Reject in-class legacy escapes.** `\1`–`\9` and multi-digit `\NN` inside `[...]` must throw
      KV434 → `unsafeRegex()` (consistent with out-of-class), not fall through to `escapeValue()` as a literal digit
      (`index.ts:240` gates backref-reject on `!inClass`; `:255-257` misses `\1`–`\9`). So an octal-based control-char
      denylist (`^[^\1-\37]+$`) either rejects at compile or matches `RegExp` exactly — no silent reinterpretation.
- [ ] **A3 (P2) — Case-fold class ranges as a SET, not per-endpoint.** Under `i`, fold the whole range membership test
      (`index.ts:528-534`), not each endpoint independently, so a case-gap-straddling range (`[A-_]`, `[Z-a]`) matches
      what `RegExp` matches (fixes the over-block). Covered once DEC-C generates `i`-flag case-gap ranges.

### DEC-B — Egress: fail closed when the sink out-parses the classifier (fixes B2; C15 corollary)

- [ ] **B1 — The connect/egress floor DENIES any host where `net.isIP(host) !== 0` but `normalizeFastPathIpLiteral(host)`
      returned null — a literal the SINK recognizes but the classifier could not parse.** This closes the WHOLE class
      (zone-id and any future literal encoding), not just `%zone`. ADDITIONALLY parse scoped literals (strip the zone,
      classify the address bytes) so a scoped metadata/ULA/link-local literal classifies correctly and a legitimately
      allowlisted scoped address can still be reached via `allowInternal`. Root: `egress.ts:618`
      (`parseIpv6Bytes` returns null on `%`), `:998-1006` (literal branch skipped), `:1008-1052` (injected lookup that
      `net.connect` skips because `net.isIP`=6). Add scoped forms of every deny class to the egress corpus.
  - Acceptance: `fd00:ec2::254%eth0`, `::ffff:169.254.169.254%eth0`, `fe80::1%lo0` are blocked (classified or
    denied-on-disagreement); a canonical scoped link-local is only reachable if explicitly allowlisted; no legit public
    egress is over-blocked.
  - **O2 resolved — fail-closed on the disagreement (fork b) as the class-closing guard, PLUS parse scoped literals
    (fork a) for allowlisted use.** (b) is the durable fix — deny any host `net.isIP` accepts but the classifier could
    not normalize closes the whole class (zone-id + every future encoding), at near-zero DevEx cost (nobody dials a
    scoped-IPv6 egress target). (a) is added only so an explicitly-allowlisted scoped address classifies correctly rather
    than being denied. This is the fourth egress address-encoding leak converted into a CLOSED class.

### DEC-C — Complete the parity GUARD's input domain (fixes P1; the C16 root of B1/B3/P2)

- [ ] **C1 — The linear-regex parity differential fuzzer generates over the COMPLETE input alphabet and pattern grammar,
      and the corpus gate MUTATION-tests.** Input alphabet: every code-point class — letters, digits, `_`, space, TAB,
      the line-terminator set `\n \r \r\n    `, C0 control chars `\x00-\x1f` + `\x7f`, a surrogate/astral
      sample, and `.`. Pattern generator: emit in-class escapes (`[\1]`, `[\d]`, `[\x41]`), anchors mid-pattern, `i`/`s`/
      `m`/`u` flag combinations, and case-gap ranges. Assert `linearMatch === RegExp` (anchored to `pattern()`'s exact
      documented semantics) over ≥1e6 cases; a mutation test re-introducing B1's `$` and B3's in-class octal turns the
      corpus gate RED. This is DEC-E/C14 done right — it fixes the ROOT (a guard blind to a value class), not just the
      three symptoms.
  - Acceptance: the completed fuzzer independently RE-DISCOVERS B1/B3/P2 before their DEC-A fixes; green after; the
    mutation test proves the gate has teeth on each.
  - **O1 resolved — parity is a CONSTRUCTION property, with fuzz as CONFIRMATION and a shrunk surface for the ambiguous
    tail (fork c + a + b, in that priority):** (c) implement the parser + `^ $ \b \B` + char-class assertion semantics
    SPEC-FAITHFULLY against ECMA-262 — the pike VM already computes match-EXISTENCE correctly (greedy/lazy/submatch don't
    affect a boolean), so the guarantee-bearing surface is only the parser + assertion layer, which is bounded and where
    all three round-20 bugs live; DEC-A's A1/A2 are the first instances of that spec-faithful pass. (a) the
    complete-alphabet differential fuzzer (this DEC-C) is CONFIRMATION, not the guarantee — round 20 proved
    fuzz-as-guarantee gives false confidence. (b) reject the legacy/ambiguous features where ECMA-262 behavior is
    surprising and nobody should rely on it (legacy octal escapes, `[\1]`) to `unsafeRegex()`, shrinking the surface
    where parity is hard. SPEC §6.6 states the supported subset + that parity is spec-derived, fuzz-confirmed.

### DEC-D — `s.string()` rejects control chars by default (fixes O3; defense-in-depth for the whole parity-permissiveness class)

- [ ] **D1 — `s.string()` REJECTS raw C0 control chars (`\x00-\x1f`) + `\x7f` + the line-terminator set by default, with
      an explicit opt-in (`.multiline()` / `.allowControlChars()`) for textareas/descriptions.** This makes a parity
      bug (or a loose author regex) on the control-char axis NON-exploitable regardless of the engine — a trailing `\n`,
      an embedded NUL, or a CR never survives validation into a sink unless the author explicitly opted in. Defense-in-
      depth independent of DEC-A/C. Because `schema.parse` returns the value untrimmed today, this is the layer that
      makes B1-class bugs harmless by default.\*\*
  - Acceptance: `s.string().pattern('^[a-z]+$').parse('admin\n')` REJECTS at the string layer even if a regex-parity bug
    remained; `.multiline()` re-admits line terminators; a survey of the framework's own string fields confirms none
    legitimately need raw control chars without the opt-in; SPEC documents the default + opt-in.
  - **Staging (per the O3 sign-off note):** ship DEC-A/B/C first (they close the confirmed holes); DEC-D can be a
    fast-follow once the opt-in ergonomics are designed, since it is the most opinionated behavior change.

## 4. Resolved design decisions (decided 2026-07-06)

O1–O3 are decided and folded into the DECs above. Recorded here for provenance.

- **O1 (parity confidence) → RESOLVED into DEC-C + DEC-A: parity is a CONSTRUCTION property (spec-faithful parser +
  assertions, fork c), with the complete-alphabet fuzzer as CONFIRMATION (fork a), and the ambiguous legacy tail
  rejected to `unsafeRegex()` (fork b).** The round-20 bugs are all in the parser/assertion layer (the pike VM computes
  existence correctly), so the guarantee-bearing surface is bounded — implement it from ECMA-262, don't approximate it.
  Fuzz-as-guarantee (a alone) is rejected: round 20 proved an incomplete fuzzer gives false confidence.
- **O2 (egress: parse vs fail-closed) → RESOLVED into DEC-B: fail-closed on the sink/classifier disagreement (fork b) as
  the class-closing guard, plus parse scoped literals (fork a) for allowlisted use.** Deny-when-`net.isIP`-accepts-but-
  classifier-null closes the whole encoding-leak class; parsing zone-ids is only a convenience.
- **O3 (schema string hygiene) → RESOLVED into DEC-D: `s.string()` rejects control chars + line terminators by default,
  with an opt-in.** Defense-in-depth that makes the control-char parity class non-exploitable regardless of the engine.
  Staged as a fast-follow (most opinionated behavior change) — flagged for explicit sign-off on the opt-in ergonomics.

## 5. Proving

- [ ] DEC-A: `^[a-z]+$` rejects `admin\n` (A1); in-class `\1`–`\9` reject/parity (A2); `[A-_]/i` matches `RegExp` (A3).
- [ ] DEC-B: scoped metadata/ULA/link-local literals blocked; legit public egress not over-blocked.
- [ ] DEC-C: completed fuzzer re-discovers B1/B3/P2, green after fix, mutation-tested RED on each; parser/assertion layer
      is spec-derived (O1 c) and the ambiguous legacy tail rejects to `unsafeRegex()`.
- [ ] DEC-D (fast-follow): `s.string().parse('admin\n')` rejects at the string layer; `.multiline()` re-admits.
- [ ] Root gates unaffected: `check:tcb-boundary`, `check:capability-surface-census`, `check:wire-output-boundary`,
      `check:single-choke`, `check:sink-policy`, `vp check`, `git diff --check`.

## 6. Meta

Round 20 is a genuine milestone: the durable engine closed the ReDoS DoS class BY CONSTRUCTION — the first time the arc
converted a recurring fail-open into an impossibility, not another patched gate. The residue is the predicted parity
tail (finite, spec-bounded) plus the egress address-encoding leak (now class-closable via the C15 disagreement guard).
The open question O1 is the real one: parity confidence is a proof problem, and fuzzing alone gives false confidence.
`plans/threat-matrix-plan.md` M2 (auth-adapter TCB) remains the last named-open matrix cell before the external audit.
