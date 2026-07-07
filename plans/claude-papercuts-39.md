# Round-20 Papercuts 39

Created 2026-07-06. Source of truth remains `SPEC.md`. Over-block / proof-completeness / refuted-but-notable items from
the Round-20 security dogfood (verify followup-16 linear-regex engine + egress + C15 audit). Security fail-opens are in
`plans/claude-bugz-41.md`. Isolated worktree at `02fac1fe4`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## Issues

- [ ] **P1 — The linear-regex PARITY GUARD is itself incomplete (C14 on the guard), which is the ROOT of why the round-20
      engine parity bypasses (`bugz-41` B1 `$`, B3 in-class octal) shipped: the differential fuzzer's input alphabet is
      a code-point SUBSET (`redos.test.ts:262` = `['a','b','c','1','_',' ','x']`) with no line terminators, no control
      chars, no surrogates, and the pattern generator does not emit in-class escape forms — so the sub-grammars where the
      engine diverges from `RegExp` are structurally UNREACHABLE by the oracle. Worse, `redos.test.ts:91-105` ENSHRINES
      the wrong `$` behavior under an "ECMAScript ... semantics" label.** (MED, framework/guard-completeness;
      `parity-fuzzer-alphabet` P1; the C14 meta-lesson made concrete)
  - Why it matters: followup-16 made the parity fuzzer the acceptance gate that replaces the retired timing heuristic
    (DEC-A/DEC-E). A parity gate whose alphabet cannot reach the divergence classes is the same "the guard is a subset"
    error the whole arc keeps re-learning — now on the mechanism that was supposed to end it. The engine is only as sound
    as the fuzzer's alphabet is complete.
  - Acceptance: the parity fuzzer's input alphabet spans every code-point class (letters, digits, `_`, space, TAB, the
    line-terminator set `\n \r \r\n LS PS`, control chars `\x00-\x1f`, a surrogate/astral sample, `.`), and the pattern
    generator emits in-class escapes (`[\1]`, `[\d]`, `[\x41]`), anchors mid-pattern, and flag combinations; a mutation
    test (re-introduce B1's `$` and B3's in-class octal) turns the corpus gate RED; `redos.test.ts:91-105` is corrected
    to real ECMAScript `$` semantics. (This is DEC-E/C14 done right — fixes the root, not just B1/B3.)

- [ ] **P2 — Under the `i` flag, a character-class range that STRADDLES the ASCII case gap (`[A-_]`, `[Z-a]`)
      under-matches: `matchesChar` folds each range endpoint independently (upper→lower), inverting the range (from>to)
      so it matches nothing — rejecting inputs `RegExp` accepts.** (LOW, framework/parity-over-block; `linear-regex-ci-range`
      P2; unanimous REAL; SAFE direction — over-block, not a bypass)
  - Observed: `index.ts:528-534` folds each endpoint via `normalizeCode` (`:674-678`); `/[A-_]/i` on `'a'` →
    `eng=false` while `RegExp` → `true`; `/[Z-a]/i` on `'_'` → `eng=false`/`js=true`. The fuzzer found 0 over-ACCEPT
    cases for this mechanism — direction is exclusively over-block.
  - Why it is only a papercut: over-block is fail-closed (rejects a value that was valid); an author hitting it uses
    `unsafeRegex()` or a non-`i` class. But it violates the engine's "AGREES with `RegExp`" contract and pushes authors
    off the safe path, so it should be fixed (case-fold the range as a set, not per-endpoint). Covered by the P1 fuzzer
    alphabet fix once `i`-flag + case-gap ranges are generated.

## Refuted / Not Carried Forward (positive signal)

- **P3 (leading `]` as class member, `[]a]`) — REFUTED.** The engine treats a leading `]` as a member (like PCRE); JS
  `[]a]` is an empty-class-then-literal. Not security-relevant and not an over-accept of untrusted input in the anchored
  idiom; hygiene note only.
- **P4 (`[^]` negated empty class throws instead of match-any) — REFUTED.** Safe direction (throws → author routes to
  `unsafeRegex`); no bypass.
- **D1 (deeply nested groups overflow the recursive-descent parser) — REFUTED.** Within the 4096-char pattern cap the
  parser did not stack-overflow / the compile is bounded; no reachable construction-time DoS. (Note: if the parser is
  recursive-descent, keep an eye on depth vs the char cap — a corpus entry at the cap depth is worth pinning.)
- **N2-2 (lookahead/backref/`u`-flag now hard-reject) — REFUTED.** Intended behavior — those route to `unsafeRegex()`;
  not a regression.

## Latest Verification

- P1 is the C14 root of `bugz-41` B1/B3 (the fuzzer alphabet is line-terminator-/control-free; the test enshrines wrong
  `$`). P2 self-verifiable via `/[A-_]/i` on `'a'` → engine false / `RegExp` true (over-block). The refuted items are
  recorded for provenance / minor hardening. Throwaway probes under `/Users/mini/kovo-dogfood-round20-apps/`;
  `/Users/mini/kovo` untouched.
