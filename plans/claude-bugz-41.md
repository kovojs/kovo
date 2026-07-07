# Round-20 Bugz 41

Created 2026-07-06. Source of truth remains `SPEC.md`. Security fail-opens from the Round-20 security dogfood, run to
VERIFY the followup-16 durable ReDoS engine + egress classify-and-pin + C15 sink audit, and hunt the next axis. Hygiene
/ over-block / refuted items are in `plans/claude-papercuts-39.md`. Dogfooded in an isolated worktree at main HEAD
`02fac1fe4`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## The round-20 headline: the durable fix worked — and traded a DoS class for a PARITY class

followup-16's linear-time engine **succeeded at its goal**: V2 confirmed the matcher is genuinely linear — `(a*)*`,
`((a+))+`, big `{n,m}` all run with no timing cliff. The ReDoS DoS class is now closed BY CONSTRUCTION. But followup-16
itself flagged the trade: "the real cost is SEMANTIC PARITY." Round 20 found it — the hand-written engine disagrees with
JS `RegExp` on edge semantics, and every case where the engine is MORE PERMISSIVE than `RegExp` is a **validation
bypass** (an anchored allowlist accepts input `RegExp` would reject). And the parity FUZZER built as the acceptance gate
was itself incomplete — its input alphabet had no line terminators or control chars, so the sub-grammars where the engine
diverges were structurally unreachable (C14, in the guard again). Separately, the egress classifier leaked its Nth
address-encoding (zone-id) — C12, with a C15 twist.

| Finding | Shape                                                   | The gap                                                             |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| B1      | engine MORE permissive than `RegExp` (parity bypass)    | non-multiline `$` allows a trailing line terminator                 |
| B2      | classifier blind to an encoding the sink accepts (C12)  | `%zone` IPv6 literal → classifier null → sink dials it unclassified |
| B3      | engine mis-compiles a construct instead of rejecting it | `\1`–`\9` inside `[...]` → literal digit, defeats an octal denylist |

## Issues

- [ ] **B1 — The linear engine's non-multiline `$` accepts a value carrying a trailing line terminator, so the canonical
      anchored allowlist `^[a-z]+$` / `^\w+$` / `^[0-9]+$` / slug / redirect-target idiom ACCEPTS `admin\n`, `1234\r\n`,
      `value\r` — input the equivalent `RegExp` REJECTS. `schema.parse` returns the value with the terminator intact
      (no trim). A validation bypass on every security-relevant field validated with `pattern()` (identifier, slug,
      filename, path segment, redirect target), enabling trailing-terminator smuggling into headers/logs/downstream
      parsers.** (HIGH, framework/validation-bypass+regression; `linear-regex-dollar-lineterm` P1/N2-1; self-verified
      first-hand; both verifiers REAL on each framing)
  - Observed (self-verified): running the real `compileLinearRegex` + `linearRegexMatch` — `/^[a-z]+$/` on `'admin\n'`
    → `eng=true` while `new RegExp('^[a-z]+$').test('admin\n')` → `false`; same divergence for `\r\n`, `\r`, `1234\n`,
    `my-slug\n`, `/^/[a-zA-Z0-9/_-]*$/` on `'/safe/path\n'`. Controls agree (`'admin\t'`, `'admin '` → `eng=false=js`),
    so exactly the line-terminator set `{\n,\r,\r\n,LS,PS}` triggers.
  - Root cause: `assertionPasses` end-anchor branch (`linear-regex/index.ts:508-513`) returns true on
    `isFinalLineTerminatorPosition(input, position)` (`:511`, helper `:656-666`) **unconditionally** — NOT gated on
    `flags.multiline`, unlike the correctly-gated begin branch (`:503-507`). This is Python/PCRE `$` semantics, not
    ECMAScript (`$` asserts `endIndex===length` when `Multiline` is false). `git blame`: `:511` was added by the
    just-landed commit `d991b01e9` "Close linear regex parity gaps" — the parity fix itself introduced the divergence.
    `schema.ts:661-669` has no trailing-terminator reject and returns `input` untrimmed.
  - Why the parity fuzzer missed it (C14, the guard's alphabet is a subset): the differential fuzzer draws inputs from
    a line-terminator-free alphabet (`redos.test.ts:262` = `['a','b','c','1','_',' ','x']`), so `$`-vs-terminator is
    structurally unreachable by the oracle. Worse, `redos.test.ts:91-105` **enshrines the wrong behavior** — it asserts
    `testLinearPattern(compileLinearPattern('a$'),'a\n') === true` under the label "implements ECMAScript line terminator
    anchor semantics," but `/a$/.test('a\n')` is `false` in real non-multiline JS.
  - Acceptance: gate `index.ts:511` on `flags.multiline` (mirror the begin branch) so `$` asserts `endIndex===length`
    without `m`; `^[a-z]+$` rejects `admin\n` again; fix the mis-labeled `redos.test.ts:91-105`; ADD line terminators +
    all code-point classes to the parity fuzzer alphabet (C14 — the guard alphabet must be complete, §papercuts-39 P1).

- [ ] **B2 — A scoped IPv6 literal (`fd00:ec2::254%eth0`, `::ffff:169.254.169.254%eth0`, `fe80::1%lo0`) escapes the
      SPEC §6.6 net-connect deny floor entirely: `normalizeFastPathIpLiteral`/`parseIpv6Bytes` returns null for any `%`
      (`egress.ts:618`), so the synchronous literal-classification branch is skipped; the code falls to the hostname
      branch and injects a pinning `lookup`, but `net.isIP('fd00:ec2::254%eth0')` returns 6 so `net.connect` treats the
      value as a numeric literal and NEVER calls the injected lookup — dialing the metadata/ULA/link-local address
      unclassified.** (HIGH, framework/SSRF-fail-open; `egress-ipv6-zone-id` V3-egress-01; self-verified the classifier
      blind spot first-hand; both verifiers REAL end-to-end)
  - Observed (self-verified): `classifyHost` returns **`null`** for EVERY scoped literal — `fe80::1%eth0`,
    `::ffff:169.254.169.254%0`, `fc00::1%1`, `::1%lo0` — while the unscoped forms classify correctly (`fe80::1`→
    link-local, `::ffff:169.254.169.254`→metadata, `::1`→loopback). Root: `egress.ts:618`
    `if (!ip.includes(':') || ip.includes('%')) return null;`. The workflow confirmed end-to-end: with the floor
    installed, `fd00:ec2::254` → BLOCKED(sync, metadata) but `fd00:ec2::254%eth0` → floor did NOT block, OS dial
    attempted; `net.isIP('fe80::1%lo0')`=6 and `lookupCalled=false`.
  - Root cause (C12 + a C15 twist): the classifier rejects the `%zone` ENCODING (returns null → "treat as hostname"),
    but the SINK (`net.connect`, `net.isIP`=6) treats it as an IP LITERAL and skips the injected pinning lookup. The
    floor's safety assumption — "null literal ⇒ hostname path ⇒ lookup is called ⇒ resolved IP is classified" — is
    itself violated by a form the sink recognizes as a literal. This is the fourth egress address-encoding leak in three
    rounds (round-18 uncompressed IPv4-mapped, round-19 octal IPv4, round-20 zone-id).
  - Acceptance: `normalizeFastPathIpLiteral` PARSES scoped literals (strip the zone, classify the address bytes) so
    `fd00:ec2::254%eth0` classifies `metadata` and is blocked; OR the floor REJECTS/deny-by-default any host where
    `net.isIP(host) !== 0` but `normalizeFastPathIpLiteral(host)` returned null (a literal the sink accepts but the
    classifier could not parse — the C15 "sink sees a literal the classifier didn't" guard). Add scoped forms of every
    deny class to the egress corpus.

- [ ] **B3 — Inside a `[...]` character class, `\1`–`\9` (and multi-digit `\NN`) are accepted by the parser and compiled
      to the LITERAL DIGIT character, whereas outside a class the same escapes correctly throw KV434 → `unsafeRegex()`.
      `RegExp` treats them as legacy octal code points, so an octal-based control-character denylist is silently
      defeated: `^[^\1-\37]+$` (intended: reject control chars 1–31) compiles in the engine as "not the literal digit
      range 1..(3,7)", so `hel\x01lo` PASSES the engine allowlist while `RegExp` blocks it.** (MEDIUM,
      framework/validation-bypass; `linear-regex-class-octal` D2; self-verified; both verifiers REAL)
  - Observed (self-verified): `/^[\1]$/` compiles OK and matches `'1'` in the engine (`eng=true`) while `RegExp` matches
    char-code-1, not `'1'` (`js=false`). Contrast `[\07]` correctly THROWS ("octal escapes are not supported"). The
    strong repro (workflow): `/^[^\1-\37]+$/.test('hel\x01lo')` → `eng=true` (control char PASSES) but `js=false`
    (blocked); `/^[^\1-\37]+$/.test('h3llo')` → `eng=false` but `js=true`.
  - Root cause: `index.ts:240` rejects backreferences only when `!inClass`; `:255-257` rejects octal only for `\0`+digit,
    not `\1`–`\9`; so an in-class digit-escape falls through to `escapeValue()` (`:610-618`) which returns the digit
    unchanged. An in-class escape that `RegExp` reads as an octal code point must be REJECTED (KV434), matching the
    out-of-class behavior — not silently reinterpreted.
  - Acceptance: `\1`–`\9` / `\NN` inside a class throw KV434 → `unsafeRegex()` (consistent with out-of-class); the parity
    fuzzer generates in-class escape forms; `^[^\1-\37]+$` either rejects (KV434) or matches `RegExp` exactly.

## Refuted / Not Carried Forward (strong positive signal)

- **The engine is genuinely LINEAR (V2) — the ReDoS DoS class is closed by construction.** No timing cliff on `(a*)*`,
  `((a+))+`, deeply nested groups, or a `{n,m}` near the program-size cap; the parser/compiler did not crash or stack-
  overflow on pathological ≤4096-char patterns (D1 recursive-descent-depth candidate REFUTED — the cap + iterative
  handling hold). This is the durable fix delivering its guarantee.
- **The reject-set holds for the retired-heuristic features (N2-2 REFUTED):** lookahead/lookbehind/backreferences/
  named-groups/`u`-flag patterns hard-reject to `unsafeRegex()` as intended (that is the correct behavior, not a
  regression). The empty-class edge cases (P3 leading `]`, P4 `[^]`) were REFUTED as non-security / safe-direction.
- **Egress DEC-B/C/D verified for the round-19 vectors:** the octal parse-differential is closed and the hostname
  allowlist over-block is fixed; only the NEW zone-id encoding (B2) escapes.

## Latest Verification

- B1 self-verified first-hand: `linearRegexMatch(compileLinearRegex('^[a-z]+$',''),'admin\n') === true` vs
  `/^[a-z]+$/.test('admin\n') === false`; 5/5 line-terminator cases diverge, controls agree.
- B2 self-verified first-hand: `classifyHost` returns `null` for all `%zone` literals (metadata/ULA/link-local/loopback);
  workflow confirmed the floor dials them unclassified because `net.isIP`=6 skips the injected lookup.
- B3 self-verified first-hand: `/^[\1]$/` compiles + matches `'1'` (engine) vs char-code-1 (`RegExp`); `[\07]` correctly
  throws — the inconsistency is the bug.
- Throwaway probes under `/Users/mini/kovo-dogfood-round20-apps/` — safe to delete. Isolated worktree
  `/Users/mini/kovo-dogfood-round20` (branch `agent/dogfood-round20`). `/Users/mini/kovo` untouched.
