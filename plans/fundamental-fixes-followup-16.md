# Fundamental Fixes Followup 16 — fix EVERY sibling path of a classifier, and dial exactly what you validated

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the C10–C13 line
(`fundamental-fixes-followup-{6..15}.md`). Responds to the Round-19 dogfood (`plans/claude-bugz-40.md` B1–B3,
`plans/claude-papercuts-38.md` P1–P2). Line numbers cite `main` (`b805b5c88`).

## 1. The foundational issue (round-19 restatement)

followup-15 applied C12/C13 correctly to the ONE decision-path each bug surfaced in — and round 19 found the identical
incompleteness in the SIBLING path of the same classifier:

- **ReDoS.** DEC-A made the nested-quantifier gate (`containsQuantifier`) recurse. But `assertLinearSafePattern` has
  THREE gates, and the overlapping-alternatives gate (`splitTopLevelAlternatives`) still splits `|` only at depth 0. So
  `((a|a))+` — overlap wrapped in one group — escapes. This is the **third** ReDoS escape in three rounds (F1 `?`,
  round-18 nested-quantifier, now round-19 overlapping-alt), and the DEC-D differential fuzzer that was built to catch
  exactly this missed it because its corpus was a subset of the grammar.
- **Egress.** DEC-C normalized the IPv6 path. But the IPv4 loose-literal path still classifies `parseLooseIpv4`'s
  interpretation (octal for a leading zero) while the socket dials the RAW host, which the platform resolver reads as
  decimal — the floor validates `87.0.0.1` (public) and connects to `127.0.0.1` (loopback). The floor already states
  the fix for hostnames ("the answer we validate is the answer we connect to") but violates it for IP literals.

Two shapes, both a refinement of C12:

| Finding | Shape                                            | The subset/gap                               | The complete surface                                                                                |
| ------- | ------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| B1      | a classifier's SIBLING gate left incomplete      | gate-2 non-recursive after gate-1 was fixed  | stop patching gates — match on a linear-time engine (DEC-A; the multi-gate heuristic is unwinnable) |
| B2      | classify one form, hand a DIFFERENT form to sink | validate `parseLooseIpv4`, dial the raw host | classify AND dial the single canonical value (classify-and-pin)                                     |

## 2. Meta-invariants (extend C12/C13)

- **C14 — A completeness fix must be applied to EVERY sibling decision-path of the same classifier, and its
  differential/corpus guard must range over the classifier's WHOLE input grammar — not the one path the last bug
  surfaced in.** A classifier's gates (or a normalizer's forms) are themselves a set; fixing the subset the current
  finding exercised is the C11 error one meta-level up. Corollary: when DEC-D/DEC-E guard a classifier, the generator
  must enumerate the grammar (every gate's trigger shape), and the corpus gate must MUTATION-test (re-introduce a known
  regression and confirm RED), or the guard is itself a subset (round-19 B1 proved the ReDoS fuzzer was).
- **C15 — Classify-and-PIN: the value a security decision validates MUST be the exact value the sink consumes.** A
  classifier that normalizes an input and then hands the RAW input to the sink has decided on a proxy (C9/C12) — the
  sink re-parses it. Every classify→sink handoff must carry the canonical validated value through to the sink (the
  egress hostname pinning-lookup is the correct pattern; extend it to IP literals and audit every other
  validate-then-emit path for the same split).

## 3. Decisions / work items

### DEC-A — Replace the ReDoS heuristic with a linear-time matcher (the DURABLE fix; retires B1's whole class)

**Decision (O1, decided):** stop patching the hand-rolled backtracking-structure analyzer. `s.string().pattern()` will
match on a Kovo-owned **linear-time regex engine** (Thompson NFA + pike VM), so catastrophic backtracking is IMPOSSIBLE
BY CONSTRUCTION — no gate-2/gate-3/gate-N to miss next round. The analyzer's completeness stops being load-bearing and
the fragile heuristic machinery is RETIRED. Pure-TS (no `re2` native dep, no `rregex` WASM blob) keeps the engine in the
in-repo auditable TCB. Rationale: the bug is pure DoS (availability) — `pattern()` runs `regex.test` synchronously on the
event loop (`schema.ts:664`), so one ~40-char request field exponentially backtracks and wedges the whole process; it is
an author-triggered footgun on an API SOLD as ReDoS-safe, and three rounds prove the heuristic cannot be durably
completed by patching. Make the unsafe state unrepresentable (the framework's own philosophy).

- [ ] **A0 — INTERIM stopgap (do first, small): make `splitTopLevelAlternatives`/`hasOverlappingAlternatives` (runtime
      `redos.ts:291-333`, compiler twin `redos-pattern.ts:251-293`) recurse into groups so the live round-19 HIGH
      (`((a|a))+`, `(([ab]|[bc]))+`, `(((a|a)))+`, `((a|a)){1,}`) is closed on `main` while A1 is built — the engine work
      is multi-day and `((a|a))+` is a shipped fail-open. Benign `((ab))+`, `(a|b)+`, `(?:ab)+` still pass. A1 then
      deletes this machinery.**
  - Acceptance: round-19 repro set rejects (runtime + compile); over-block set passes; added to the DEC-E corpus.

- [ ] **A1 — Build `packages/core/src/internal/linear-regex/` (new module, ~600–1,200 LOC pure TS), a boolean
      linear-time matcher for the supported subset, and route `pattern()` through it.** Prescriptive build order:
  1. **Parser → AST** (`parse.ts`). Reuse the existing `readAtom`/`quantifierAt` scaffolding as a starting point. AST
     nodes: `Literal(char)`, `CharClass(ranges, negated)` (incl. `\d\w\s\D\W\S`, `.`), `Concat(nodes)`,
     `Alt(branches)`, `Star/Plus/Quest(node, greedy)`, `Repeat(node, min, max)`, `Group(node)` (capturing OR
     non-capturing — capture is irrelevant to a boolean match, so treat both as plain grouping), `Anchor(kind)` for
     `^ $ \b \B`. **Reject at parse time (throw KV434 → "use `unsafeRegex(...)`"):** backreferences (`\1`),
     lookahead/lookbehind (`(?= (?! (?<= (?<!`), named-group backrefs, and any construct outside the subset. This
     rejection set — not a backtracking heuristic — is the ONLY thing the compile-time twin checks now.
  2. **Compile AST → NFA program** (`compile.ts`), Thompson construction: instructions `Char(class)`, `Split(a,b)`
     (ε-branch), `Jmp(x)`, `Match`, plus `Assert(anchor)`. `Repeat(min,max)` expands to `min` mandatory copies + `max-min`
     optional copies (or a `Split` loop for `*`/`+`). **Cap the compiled program size** (e.g. ≤ a few thousand
     instructions) and reject oversize `{n,m}` expansions (`(a{1000}){1000}`) with KV434 — bounds compile cost and
     memory; the input is already ≤ 4096.
  3. **Pike-VM matcher** (`pike.ts`, the ~150–250-LOC core). Maintain a `clist`/`nlist` of NFA program-counters
     (a Set/bitset — DEDUP is what guarantees linearity: at most `program.length` states per input position, so total
     work is `O(program.length × input.length)`, no thread explosion). For each input char: ε-close (follow
     `Split`/`Jmp`/satisfied `Assert`), then advance `Char` threads that match. Return true iff a `Match` pc is live at
     an accepting position. Boolean only — NO submatch/capture bookkeeping (that is where pike VMs get big; we skip it).
  4. **Wire into `pattern()`** (`schema.ts:628-635`): at construction, `const program = compileLinearRegex(src, flags)`
     (throws KV434 on unsupported/oversize); store `program` on the schema. At validate time (`schema.ts:659-664`),
     replace `check.regex.test(input)` with `linearMatch(program, input)`. Keep the 4096-char input cap as a secondary
     bound. `new RegExp(src)` is no longer used for `pattern()` matching.
  5. **RETIRE the heuristic analyzer**: delete `assertLinearSafePattern` + `containsQuantifier` +
     `hasOverlappingAlternatives` + `splitTopLevelAlternatives` + adjacency (`redos.ts`) and the compile-time twin's
     backtracking checks (`redos-pattern.ts`) once `pattern()` no longer compiles to a backtracking engine. The
     compile-time KV434 lint becomes: "does `pattern()`'s literal parse into the supported linear subset?" (the reject
     set from step 1) — nothing about backtracking structure.
  6. **Keep `unsafeRegex(...)`** as the audited escape for patterns needing backreferences/lookaround/features outside
     the subset; those run on JS `RegExp` with the author's explicit, `kovo explain`-surfaced acknowledgment.
  - **Semantic parity is the real cost — build it as the acceptance gate (feeds DEC-E):** a differential harness that
    generates random patterns from the supported grammar + random inputs and asserts `linearMatch(program, input)` ===
    the equivalent JS `RegExp` result (anchored to match `pattern()`'s documented semantics — CONFIRM whether `pattern()`
    is implicitly `^…$`-anchored and replicate exactly). Run millions of cases in CI-corpus form. Edge cases to pin for
    parity: greedy vs lazy (irrelevant to boolean — assert so), empty alternatives/groups (`(a|)+`, `()`), anchors
    mid-pattern, char-class edges (`]` first, ranges, negation, escaped metachars), `.` dotall/`s`-flag, `\b`/`\B`
    semantics, case-insensitive `i`-flag, and the Unicode decision (support BMP; DECIDE whether to support the `u` flag /
    `\p{}` or reject `u`-requiring patterns → `unsafeRegex`). Because the engine is linear BY CONSTRUCTION, the DEC-E
    ReDoS guard flips from "accept ⇒ measured-linear" (which round-19 showed is fuzzable-incomplete) to "matcher AGREES
    with `RegExp`" + "reject-set is correct" — a decidable equality, not a timing heuristic.
  - Acceptance: `pattern()` matches via the linear engine; `((a|a))+`, `((a+))+`, `(a?b?)+`, and any adversarial input
    run in provably linear time (no timing cliff at any input length); the parity fuzzer is green over ≥1e6 generated
    pattern×input cases; unsupported features throw KV434 pointing to `unsafeRegex`; the heuristic analyzer files are
    deleted; `kovo explain` still surfaces `unsafeRegex` sites.

### DEC-B — Egress classify-and-PIN for IP literals (fixes B2)

- [ ] **B1 — Only a CANONICAL IPv4 literal takes the synchronous IP-literal fast-path; any NON-canonical form
      (leading-zero/octal/hex/decimal-dword) is rejected from the fast-path so it falls through to the hostname
      resolve-then-pin path, which classifies the RESOLVED IP the socket actually dials. This eliminates the
      parse-differential at the source (no ambiguous form is ever classified-then-raw-dialed). Keep the pin invariant for
      canonical literals too (dial `literalIp`, `egress.ts:923-932`). Add a differential test asserting
      `parseLooseIpv4(x)` equals `dns.lookup(x)` for every accepted literal, or it is rejected.**
  - Acceptance: `0127.0.0.1`/`010.0.0.1` are rejected from the fast-path and routed through resolve-then-pin (classify
    the actually-dialed IP → blocked); the floor never validates one IP and dials another; a corpus/differential test
    covers the loose-IPv4 forms.
  - **O2 resolved:** REJECT non-canonical literals from the fast-path (fork a), NOT normalize-and-pin the loose form
    (fork b). The two converge on safety — a rejected loose literal routes to resolve-then-pin, which classifies what
    `dns.lookup` actually returns — but reject is simpler and avoids picking `parseLooseIpv4`'s interpretation as
    canonical when the author may have meant a different one. Loose `inet_aton` forms have near-zero legitimate egress
    use. (This is the first instance handled by the DEC-F C15 audit.)

### DEC-C — Egress embedded-v4 completeness, fail-closed (fixes B3)

- [ ] **C1 — The IPv6 embedded-v4 handling covers ISATAP and every interface-identifier embedding, OR (cleaner, per
      DEC-C's own fail-closed thesis) any `2000::/3` address whose low 32 bits encode a non-public v4 under a recognized
      interface-identifier form is treated NON-public.** Add ISATAP (`...:0:5efe:w.x.y.z`) + the other embedding forms to
      the egress corpus.
  - Acceptance: `2600::5efe:a9fe:a9fe` (and the private-embedded ISATAP forms) classify non-public; a legit global-unicast
    v6 with an incidental low-32 pattern is not over-blocked (or the over-block is accepted per O3).
  - **O3 resolved:** extend embedded-v4 extraction to ISATAP and classify the embedded v4 (public-embedded allowed,
    private denied) + keep the fail-closed top-level default (the convergence of forks a+b). Over-block risk is negligible
    (a legit global-unicast host with a private-looking interface-id is nonsensical). **LOW urgency** — host-dependent
    (needs an ISATAP tunnel to route); a do-it-while-in-the-file item, not a priority.

### DEC-D — Fix the hostname allowlist over-block (fixes P1)

- [ ] **D1 — `frameworkEgressFetch` must permit an allowlisted PUBLIC hostname: resolve-then-pin (classify the RESOLVED
      IP, not the raw hostname string) so `allowDestinations: ['https://api.stripe.com']` works end-to-end
      (`egress.ts:779/687`). A hostname whose resolved IP passes the private-address floor and matches the allowlist is
      permitted.**
  - Acceptance: an allowlisted public-hostname fetch succeeds through the floor; a hostname resolving to a private IP is
    still blocked; the `allowDestinations` hostname contract is tested end-to-end. (Fail-closed today, so this is a
    functional-regression fix, not a security hole — but it breaks agent-tool/webhook outbound by hostname.)

### DEC-E — Corpus gate teeth + whole-grammar differential (fixes P2; C14)

- [ ] **E1 — `check:security-classifier-corpus` re-executes each in-scope classifier over its FULL corpus and asserts
      every verdict (not a marker/existence check), and a mutation test re-introduces a known regression (round-18
      nested-quantifier, round-19 overlapping-alt, round-19 octal literal) and confirms the gate goes RED. Each DEC-D
      differential fuzzer generates the classifier's WHOLE input grammar, not the shapes the last round happened to
      find.**
  - Acceptance: the gate is proven to fail on each historical regression; the corpus is append-only with every
    confirmed round's fail-open added. For ReDoS specifically, once DEC-A lands the guard is the linear engine's PARITY
    fuzzer (`linearMatch` === JS `RegExp` over the supported subset) + the reject-set correctness — a decidable equality,
    replacing the retired "accept ⇒ measured-linear" timing heuristic; the egress fuzzer generates loose-IPv4 + ISATAP
    forms.

### DEC-F — One-time C15 audit of every validate-then-emit sink (O4)

- [ ] **F1 — Audit EVERY sink where the framework validates a value then emits/uses a possibly-different form, and
      assert classify-and-pin (the emitted/dialed value is exactly the validated one). Known sinks to audit: the egress
      connect floor (DEC-B, first instance), the redirect `Location` header (validate the URL, emit a possibly-different
      URL), the wrapped-client statement reconstruct (validate the statement, execute a possibly-different one),
      `sql.identifier` (validate, quote a possibly-different form), header/cookie serialization (validate, emit an
      encoded form). For each, either prove the emitted value is the validated one or fix it to pin. This is the
      get-ahead-of-the-dogfood item — the class most likely to surface the next fail-open.**
  - Acceptance: a short audit note per sink (pinned / fixed / N-A) recorded in the plan or `security/`; any split found
    is fixed and added to the DEC-E corpus; SPEC §6.6/§10.3 states the classify-and-pin (C15) invariant for
    validate-then-emit sinks.

## 4. Resolved design decisions (decided 2026-07-06)

O1–O4 are decided and folded into the DECs above. Recorded here for provenance.

- **O1 (ReDoS) → RESOLVED: do the DURABLE fix — replace the heuristic analyzer with a pure-TS linear-time engine
  (DEC-A).** Not "patch gate-2 and let the fuzzer decide later" — the user's call is to end the class now. Three rounds
  prove the hand-rolled backtracking-structure analyzer cannot be durably completed by patching (each fix leaves a
  sibling gate; the fuzzer built to catch them was itself a subset). A Thompson-NFA + pike-VM matcher makes catastrophic
  backtracking impossible BY CONSTRUCTION, so the analyzer's completeness stops being load-bearing and the heuristic is
  retired. Pure-TS (~600–1,200 LOC), NOT a ~5k-LOC full Go `regexp` port and NOT a native/WASM dep — keeps the engine in
  the auditable in-repo TCB. Consequence of the bug is pure DoS (event-loop wedge on the "safe" `pattern()`). An INTERIM
  gate-2/3 recursion (DEC-A A0) closes the live round-19 HIGH while the engine is built. The real cost is semantic parity
  with JS `RegExp`, built as the acceptance gate (DEC-E). Rejected: keep-patching (fork a — three-strikes disproves it),
  native `re2`/WASM `rregex` (TCB expansion right after M6).
- **O2 (egress: reject vs pin non-canonical literals) → RESOLVED into DEC-B: REJECT from the fast-path → resolve-then-pin.**
  A rejected loose literal routes to the hostname path, which classifies the actually-dialed IP; simpler than pinning a
  chosen interpretation, and loose `inet_aton` forms have near-zero legit egress use. First instance of the DEC-F audit.
  (Superseded fork (b) classify-and-pin the loose form: rejected because pinning still picks `parseLooseIpv4`'s
  interpretation as canonical when the author may have meant another — reject removes the ambiguity at the source.)
- **O3 (egress embedded-v4: enumerate vs fail-closed) → RESOLVED into DEC-C: extend extraction to ISATAP + fail-closed
  default (they converge); LOW urgency (host-dependent).**
- **O4 (make C14/C15 standing) → RESOLVED into DEC-E (C14: whole-grammar/parity guard + mutation-tested corpus) + DEC-F
  (C15: one-time audit of every validate-then-emit sink).** The C15 sink audit is the highest-leverage structural item —
  it gets ahead of the dogfood on the validate-then-emit class.

## 5. Proving

- [ ] DEC-A: A0 interim — round-19 repro set rejects. A1 — `pattern()` matches on the linear engine (no timing cliff at
      any input length on `((a|a))+`/`((a+))+`/etc.); parity fuzzer green over ≥1e6 pattern×input cases; unsupported
      features throw KV434 → `unsafeRegex`; heuristic analyzer files deleted.
- [ ] DEC-B: `0127.0.0.1`/`010.0.0.1` never let the floor validate one IP and dial another; loose-IPv4 differential test.
- [ ] DEC-C: ISATAP private-embedded forms classify non-public.
- [ ] DEC-D: allowlisted public-hostname fetch succeeds; private-resolving hostname still blocked.
- [ ] DEC-E: corpus gate mutation-tested RED on each historical regression.
- [ ] Root gates unaffected: `check:tcb-boundary`, `check:capability-surface-census`, `check:wire-output-boundary`,
      `check:single-choke`, `check:sink-policy`, `vp check`, `git diff --check`.

## 6. Meta

Round 19 confirms the data-plane closures and the DEC-B auth classifier are sound; the residue is entirely on the two
hand-rolled hot-spot classifiers (ReDoS, egress) where a fix to one gate/path left a sibling — C14 — and where a
classifier validated a different value than its sink consumed — C15. Both classifiers resisted point-fixing (ReDoS: three
rounds), so followup-16 takes the DURABLE route on ReDoS — retire the heuristic and match on a linear-time engine so the
class cannot recur — and the C15 sink audit (DEC-F) to get ahead of the next validate-then-emit split before a dogfood
finds it. `plans/threat-matrix-plan.md` M2 (auth-adapter TCB) remains the last named-open matrix cell before the external
audit.
