# Round-21 Bugz 42

Created 2026-07-06. Source of truth remains `SPEC.md`. Round-21 security dogfood, run to VERIFY the followup-17 fixes
(regex parity + spec-faithful parser/reject-set, egress sink/classifier disagreement guard, `s.string()` control-char
default) and hunt the deep unicode/structural parity + control-char corners. Hygiene / over-block / refuted items are in
`plans/claude-papercuts-40.md`. Dogfooded in an isolated worktree at main HEAD `dc8cb8aae`; `/Users/mini/kovo` untouched.
Line numbers cite that HEAD. (Note: the V2 structural-parity axis was run by the main agent directly; the other axes by
the workflow fan-out.)

## The round-21 headline: STRONG CONVERGENCE — zero confirmed fail-opens

Round 21 is the first round of the regex/egress arc with **no confirmed fail-open or validation bypass**. The followup-17
fixes held, and — decisively — the O1(b) "shrink the surface" decision closed the class of parity bugs that round 20
opened: the engine now REJECTS the hard-to-match features (`u` flag, `\p{}` unicode property escapes, non-ASCII source
under `i`, legacy octal/backref, lookaround) to `unsafeRegex()`, so the whole unicode/case-fold parity surface — the
richest hunting ground this round — is simply not reachable. Every MEDIUM candidate was adversarially REFUTED; only
LOW parity/hygiene papercuts survive (`papercuts-40`).

## Verified closed (the followup-17 fixes held)

- **B1 (round-20 `$` line-terminator) — CLOSED.** Self-verified: `a$` rejects `a\n` without `m` (`eng=false=js`); `a$/m`
  matches `a\nb`; `^b/m` matches. `assertionPasses` end-branch now gates `isFinalLineTerminatorPosition` on
  `flags.multiline` (`linear-regex/index.ts:512-517`).
- **B3 (round-20 in-class legacy escape) — CLOSED.** Self-verified: in-class `\1`/`\07` THROW to `unsafeRegex()`
  (`index.ts:242-244,260`), consistent with out-of-class.
- **Unicode/case-fold parity (V1) — CLOSED by reject-set.** Self-verified the reject boundary: `/a/u`, `/\p{L}/u`,
  non-ASCII-source-under-`i` (`index.ts:57-58`), lookaround (`:169`), named backref (`:247`) all THROW. The V1 attacker
  reported ZERO findings — the case-fold/surrogate landmines (Turkish ı/İ, ß, Kelvin, µ) are unreachable because the
  features that would expose them are rejected.
- **Structural / assertion parity (V2) — SOUND.** Self-verified 48 targeted cases: `\b`/`\B` match `RegExp` (incl.
  accented boundaries via ASCII `\w`); empty-match repetition `(a*)*`/`(a?)*`/`(a?)+`/`()*`/`(?:)*` matches `RegExp`
  AND terminates (linear, no infinite loop); `{0}`/`{0,0}` match empty; empty alternation `(a|)`/`(|a)` agree; anchors
  in groups `(^a)`/`(a$)` agree; dotAll `.`/`s` agrees; reversed ranges + quantifier-on-anchor + `a{2,1}` throw in both.
  Only divergence: the LOW `[]a]` leading-bracket (`papercuts-40` P1).
- **Egress zone-id class (V4) — CLOSED.** The DEC-B disagreement guard (deny when `net.isIP`≠0 but the classifier
  returned null) + scoped-literal parsing landed; the V4 attacker found no residual. The four-round egress
  address-encoding leak (uncompressed → octal → zone-id) is closed as a class, not just per-form.
- **`s.string()` control-char default (DEC-D) — landed and enforced** for C0 (`\x00-\x1f`) + `\x7f` + line terminators
  (`schema.ts:707`), with `.multiline()`/`.allowControlChars()` opt-ins.

## Refuted / Not Carried Forward (the MEDIUM candidates all fell)

- **N1-1 (MEDIUM, "KV415 control-char rejection bypassed on the raw-endpoint-response channel") — REFUTED** (both
  verifiers). The raw-endpoint channel is a distinct, author-owned trust surface with its own posture; not a bypass of
  the structured-response KV415 contract.
- **V3-01 (bidi-override / zero-width Cf chars admitted by the `s.string()` default) — REFUTED** as a fail-open — these
  are display-spoofing (Trojan-Source) vectors, not a validation bypass into a sink. Recorded as a hardening papercut
  (`papercuts-40` P2): the control-char default covers C0 + terminators but not the broader Cf/bidi class (a C16
  input-domain question for the string hygiene default).
- **N1-2 (DEC-C fuzzer omits non-ASCII case-fold) — REFUTED** — moot, because the engine rejects the features that would
  expose those landmines; the fuzzer need not generate what the parser refuses.
- **N2-01 (`.multiline()` rejects TAB) — REFUTED** as a defect (spec-conformant: TAB is C0, admitted only by
  `.allowControlChars()`); recorded as a minor over-block papercut (`papercuts-40` P3).

## Latest Verification

- Self-verified first-hand (main agent, `scratchpad/v2-probe.mjs`): 48 structural/assertion cases, the round-20 B1/B3
  fixes, and the reject-set boundary — 1 LOW divergence (`[]a]`), everything else sound. The engine's unanchored-prefix
  compile (`index.ts:343-347`) makes `linearRegexMatch` a search directly comparable to `RegExp.test`.
- V1/V4 clean and N1/V3/N2 candidates refuted are from the workflow fan-out (cached results in the run journal).
- Throwaway probes under `/Users/mini/kovo-dogfood-round21-apps/` + `scratchpad/v2-probe.mjs` — safe to delete. Isolated
  worktree `/Users/mini/kovo-dogfood-round21` (branch `agent/dogfood-round21`). `/Users/mini/kovo` untouched.
