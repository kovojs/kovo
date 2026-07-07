# Round-21 Papercuts 40

Created 2026-07-06. Source of truth remains `SPEC.md`. LOW parity / hygiene / over-block items from the Round-21 security
dogfood (verify followup-17). No confirmed fail-opens this round — see `plans/claude-bugz-42.md` (strong convergence).
Isolated worktree at `dc8cb8aae`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## Issues

- [ ] **P1 — The linear engine treats a LEADING `]` inside a character class as a class MEMBER (`[]a]` = a class of `]`
      and `a`), so `/[]a]/` matches `']'` — which JS `RegExp` REJECTS (JS reads `[]` as an empty class matching nothing,
      then literal `a`, then literal `]`, so `/[]a]/` matches only the string `"a]"`). Engine accepts what `RegExp`
      rejects.** (LOW, framework/parity; `linear-regex-leading-bracket` P1/V2; self-verified; round-20 P3 recurrence)
  - Observed (self-verified): `linearRegexMatch(compileLinearRegex('[]a]',''),']')` → `true` while
    `/[]a]/.test(']')` → `false`; the 47 other targeted structural cases agree with `RegExp`.
  - Why LOW: `[]a]` is a pathological construct — a JS empty class is almost always an author error, and as an allowlist
    (`^[]a]+$`) it is nonsensical, so the realistic security impact is negligible. Round-20 P3 (the same divergence) was
    adversarially REFUTED as not-security-relevant; recorded here for parity-completeness, not as a bug.
  - Acceptance (per the O1(b) shrink-the-surface thesis): REJECT a leading `]` / an empty class `[]` to `unsafeRegex()`
    (force the unambiguous `[\]...]`), OR implement JS empty-class semantics exactly. The engine's contract is
    "agree with `RegExp` or reject" — the PCRE-style leading-`]`-as-member violates it. Add `[]a]`/`[]` to the parity
    corpus.

- [ ] **P2 — The `s.string()` control-char default (DEC-D) rejects C0 (`\x00-\x1f`) + `\x7f` + line terminators, but NOT
      the broader Cf/bidi class: bidi-override `U+202A-202E` / `U+2066-2069`, zero-width `U+200B-200D` / `U+FEFF` /
      `U+2060` — the Trojan-Source display-spoofing vectors — pass the default with no owning strip-sink.** (LOW,
      framework/string-hygiene; `string-default-cf-bidi` P2/V3-01; REFUTED as a fail-open)
  - Why REFUTED as a fail-open: these are DISPLAY-spoofing / homoglyph vectors (how a string RENDERS in a terminal or
    review UI), not a validation bypass into a security sink — a bidi override does not smuggle a control byte into a
    header/log/filename the way a raw `\n`/NUL does. So it is out of the control-char default's core threat model.
  - Why record it (C16 on the string default): the control-char default is itself a completeness question — it covered
    the C0 + line-terminator value class but not the wider Cf/bidi class. If the framework wants defense-in-depth against
    Trojan-Source in stored identifiers/labels, the honest fix is to reject (or normalize/flag) Cf-category + bidi-control
    code points by default too, with the same opt-in. Decide per SPEC whether display-spoofing is in scope for
    `s.string()`.
  - Acceptance (if in scope): the default also rejects the bidi-control + zero-width Cf set; `.allowControlChars()` (or a
    dedicated opt-in) re-admits; SPEC documents the code-point set and the display-spoofing rationale.

- [ ] **P3 — `.multiline()` admits line terminators but still rejects TAB (`\x09`, a C0 control), so a
      textarea/markdown/code field that legitimately contains tabs must use `.allowControlChars()` instead of the more
      intuitive `.multiline()`.** (LOW, framework/over-block; `multiline-tab-overblock` P3/N2-01; REFUTED as a defect —
      spec-conformant, minor DevEx)
  - Why it is only a papercut: TAB is a C0 control; DEC-D admits it only via `.allowControlChars()` by design, and
    `.multiline()` is scoped to line terminators. Fail-closed (over-block), not a bypass. But tabs in multiline text are
    common, so authors will hit the surprise.
  - Acceptance (optional DevEx): `.multiline()` also admits TAB (the one C0 that is routinely legitimate in multiline
    text), or the docs make the `.multiline()` vs `.allowControlChars()` distinction prominent with a tab example.

## Note

Round 21 is a convergence round: no fail-opens, and the two axes most likely to hide a bypass (unicode/case-fold parity,
egress address-encoding) came back CLEAN because followup-17's shrink-the-surface reject-set and the egress disagreement
guard closed those classes by construction rather than per-form. The residue above is LOW parity/hygiene, all either
refuted or self-classified low-impact. See `claude-bugz-42.md`. Throwaway probes under
`/Users/mini/kovo-dogfood-round21-apps/`; `/Users/mini/kovo` untouched.
