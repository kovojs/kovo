# Round-19 Bugz 40

Created 2026-07-06. Source of truth remains `SPEC.md`. Security fail-opens from the Round-19 security dogfood, run to
VERIFY the followup-15 fixes (ReDoS recursion / auth classifier / egress normalize / corpus gate) closed AND hunt the
next axis. Hygiene / over-block / refuted-but-notable items are in `plans/claude-papercuts-38.md`. Dogfooded in an
isolated worktree at main HEAD `b805b5c88`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## The round-19 headline: followup-15 fixed the gate it was looking at, not its SIBLING

Round 19 verified followup-15's fixes are real for the cases they targeted — and found the SAME C12 incompleteness one
step sideways in both hot-spot classifiers. DEC-A made the ReDoS **nested-quantifier** gate recurse, but the **sibling
overlapping-alternatives** gate still splits only at the top level, so `((a|a))+` (overlap wrapped in one group)
escapes. DEC-C normalized the **IPv6** path, but the **IPv4** loose-literal path still classifies a form the SINK
re-parses differently, and the literal fast-path dials the raw string. Both are C12 (classify the entity the sink
actually uses / walk the whole tree), applied to one gate/path but not its twin.

| Finding | The classifier decision            | The subset/encoding it still trusts                           | The complete surface                                         |
| ------- | ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| B1      | is this regex catastrophic?        | gate-2 sees only TOP-LEVEL `\|` (`splitTopLevelAlternatives`) | recurse gate-2 into nested groups, like DEC-A did for gate-1 |
| B2      | is this egress destination public? | classify `parseLooseIpv4`'s parse; dial the RAW host string   | classify+dial the SAME canonical IP the socket resolves to   |

## Issues

- [ ] **B1 — The ReDoS overlapping-alternatives gate is non-recursive, so wrapping an overlapping alternation in ONE
      redundant group defeats it: `((a|a))+`, `(?:(a|a))+`, `(([ab]|[bc]))+`, `(((a|a)))+`, `((a|a)){1,}` all PASS
      `assertLinearSafePattern` and compile to exponential-backtracking RegExps. DEC-A made the nested-quantifier gate
      (`containsQuantifier`) recurse but left the sibling `hasOverlappingAlternatives`/`splitTopLevelAlternatives`
      splitting `|` only at depth 0.** (HIGH, framework/availability; `redos-overlapping-alt-wrapped`; self-verified
      first-hand; both verifiers REAL)
  - Observed (self-verified): running the real `assertLinearSafePattern` — `(a|a)+`, `(a|ab)+`, `([ab]|[bc])+` →
    rejected (unwrapped forms caught); but `((a|a))+`, `(?:(a|a))+`, `(([ab]|[bc]))+`, `(((a|a)))+`, `((a|a)){1,}` →
    **ACCEPTED**. Anchored `^((a|a))+$` timing: 17 chars 3ms, 25 chars 154ms, 29 chars 2109ms (~16× per +4 = 2^n).
  - Root cause (C12/C13, exactly followup-15's own thesis): `hasOverlappingAlternatives(body)` (`redos.ts:291-303`)
    relies on `splitTopLevelAlternatives` (`:305-333`), which splits `|` only at `depth === 0` and never descends into
    sub-groups — the direct analog of the pre-DEC-B `containsQuantifier` bug, in the sibling gate. For `((a|a))+` the
    quantified body is `(a|a)`: gate-1 `containsQuantifier('(a|a)')` = false (no quantifier), gate-2 sees the `|` at
    depth 1 so `splitTopLevelAlternatives` returns a single alternative → false, gate-3 adjacency doesn't apply. All
    three gates miss it. Compiler twin identical and in-sync (`redos-pattern.ts:251-293`) → the KV434 compile lint is
    equally blind.
  - Why the corpus gate (DEC-E) didn't catch it: the ReDoS corpus only exercises quantifier-nesting cases (`(a?)+`,
    `(?:a+)+`, `((a)*)*`); no corpus entry wraps an overlapping alternation in a redundant group, so it stayed green.
    The gate's own completeness is a subset (see `papercuts-38` P1).
  - Reachability + severity: `schema.ts:633` `pattern()` → `assertLinearSafePattern` (sole structural gate) → `new
RegExp` (`:635`) → `check.regex.test` on request input (`:664`) behind only the 4096-char cap (documented NOT a CPU
    bound). The analyzer REJECTS the natural `([ab]|[bc])+` but ACCEPTS its semantically-equivalent grouped form
    `(([ab]|[bc]))+` — a plausible authoring shape — and the compile lint is silent, so nothing warns the author. A
    ~30–40 char request field pegs a CPU for seconds on a validator advertised as ReDoS-safe.
  - Acceptance: `splitTopLevelAlternatives` / `hasOverlappingAlternatives` (runtime + compiler twin) recurse into group
    interiors so an overlapping alternation at ANY depth under a quantifier is rejected — `((a|a))+`, `(?:(a|a))+`,
    `(([ab]|[bc]))+` reject; benign `((ab))+`, `(?:ab)+`, `(a|b)+` (non-overlapping) still pass (no over-block). Add
    ALL three round-19 wrapped forms to the DEC-E ReDoS corpus (this is exactly the C13 superset gap the corpus was
    meant to close — extend it to gate-2, not just gate-1).

- [ ] **B2 — The egress floor validates a DIFFERENT IPv4 address than the socket dials, because `parseLooseIpv4`
      interprets a leading-zero octet as OCTAL while the platform resolver reads the raw literal as DECIMAL, and the
      literal fast-path passes the RAW host (not the validated IP) to `net.connect`. `0127.0.0.1` classifies `public`
      (octal → 87.0.0.1, ALLOWED) but the socket dials `127.0.0.1` (loopback); `010.0.0.1` → floor sees 8.0.0.1
      (public) but dials 10.0.0.1 (RFC1918). SSRF fail-open on the raw-`net.connect`/`http.get` path the floor exists
      to cover.** (HIGH, framework/SSRF-confidentiality; `egress-octal-parse-differential` EGRESS-1; self-verified
      first-hand; both verifiers REAL)
  - Observed (self-verified): `normalizeIpLiteral('0127.0.0.1')` = `87.0.0.1`, `classifyIp` = **`public`**; this
    platform's `dns.lookup('0127.0.0.1')` = **`127.0.0.1`** (and `010.0.0.1`→`10.0.0.1`, `0177.0.0.1`→`177.0.0.1`). The
    connect floor's IP-literal branch (`egress.ts:923-932`): `literalIp = normalizeIpLiteral(host)`; if `evaluateEgress`
    doesn't block, it calls `original.apply(this, args)` — with the RAW `args` (raw host `0127.0.0.1`), NOT `literalIp`.
    So the socket re-parses the raw host and reaches a different address than the floor validated.
  - Root cause (C12/C9): the classifier normalizes the literal one way (`parseLooseIpv4` octal, `egress.ts:442`
    `/^0[0-7]+$/`→base-8) and then trusts the SINK to agree, but `net.connect`→getaddrinfo parses the same string
    differently. The floor already states the correct invariant for HOSTNAMES — "the answer we validate is the answer
    we connect to" (the pinning lookup, `egress.ts:933+`) — but VIOLATES it for IP literals by dialing the raw string.
    parseLooseIpv4 being _more lenient than the sink_ (accepting octal the OS reads as decimal) is the exact
    classify-a-proxy-not-the-entity error.
  - Severity note (honest): the concrete loopback/RFC1918 reach is platform-dependent (this macOS resolver reads the
    leading-zero form as decimal; a glibc `inet_aton` host might read it as octal and agree with the floor). But the
    ARCHITECTURAL fail-open — classify a normalized form, dial the raw string — is platform-independent and reproduces
    here end-to-end. On any host where the resolver's loose-IPv4 parse differs from `parseLooseIpv4`, it is a reachable
    SSRF.
  - Acceptance: for an IP-literal host, the floor DIALS the canonical validated IP (`literalIp`), not the raw host —
    rewrite `options.host` to `literalIp` before `original.apply` so "the address we validate is the address we
    connect to" (mirroring the hostname pinning-lookup invariant). Equivalently/additionally, REJECT non-canonical IPv4
    literals (leading-zero/octal/hex/decimal-dword) rather than normalize-and-trust. Add a differential test:
    `parseLooseIpv4(x)` must equal `dns.lookup(x)` for every accepted literal, or the literal is rejected.

- [ ] **B3 — `extractedIpv4FromIpv6` peels an embedded IPv4 only for the three fixed /96 prefixes (IPv4-compatible
      `::/96`, IPv4-mapped `::ffff:/96`, NAT64 `64:ff9b::/96`), so an ISATAP interface-identifier address
      (`<global-prefix>::5efe:w.x.y.z`, RFC 5214) embedding a private/metadata v4 under a `2000::/3` prefix classifies
      `public`.** (MEDIUM, framework/SSRF-defense-in-depth; `egress-isatap-embedded` EGRESS-2; split verify REAL/REFUTED;
      host-dependent exploitability)
  - Observed: `2600::5efe:a9fe:a9fe` (embeds 169.254.169.254) → `public`; `2607:f8b0::5efe:c0a8:1` (embeds 192.168.0.1)
    → `public`; `3fff::5efe:a9fe:a9fe` → `public`. Contrast (same run, correctly fail-closed): 6to4 `2002:a9fe:a9fe::`
    → `special-use`, Teredo → `special-use`, and NAT64/compat/mapped forms of 169.254.169.254 → `metadata`.
  - Root cause: C12 again — the embedded-v4 extraction ranges over a SUBSET of the embedding forms; ISATAP's
    `...:0:5efe:v4` low-32-bit embedding is not in the extracted set, so `classifyIpv6Bytes` falls through to the
    `2000::/3` global-unicast rule and returns `public`.
  - Why MEDIUM (not HIGH): reaching the embedded v4 requires an ISATAP tunnel interface to actually route the low-32
    bits (host-dependent), so this is a defense-in-depth incompleteness, not a universal metadata-theft primitive. One
    verifier REFUTED on that exploitability ground; the other confirmed the classification gap is real.
  - Acceptance: extraction peels ISATAP (`...:0:5efe:w.x.y.z` / `...:200:5efe:...`) and classifies the embedded v4, OR
    (cleaner, per DEC-C's fail-closed thesis) any `2000::/3` address whose low 32 bits encode a non-public v4 under a
    recognized interface-identifier form is treated as non-public. Add ISATAP forms to the egress corpus (DEC-E).

## Refuted / Not Carried Forward (strong positive signal)

- **V3 auth classifier (DEC-B) — verification PASSED.** The credential classifier is now genuinely wired over observed
  columns of every bridged table; `user.totpSecret` is branded secret. The two candidates — last-segment-only lexicon
  missing a non-final credential noun (V3-1) and over-block of `code`/`key`-suffixed benign columns (V3-2) — were both
  REFUTED (the lexicon is a documented best-effort net with an author override; over-block is fail-closed). Recorded in
  `papercuts-38`.
- **DEC-C IPv6 core fix HELD.** All uncompressed/hex/zero-padded/mixed-case serializations of metadata + private ranges
  classify non-public; 6to4/Teredo blanket-denied; NAT64/mapped/compat peeled. Only the IPv4-loose path (B2) and ISATAP
  (B3) escape — both distinct from the round-18 IPv6 hole DEC-C closed.
- **Next-axis hunt (N1) found no new fail-open.** Redirect normalization, `sql.identifier` vs reconstruct, and
  cookie `SameSite`/`Secure` pairing were probed; the two candidates (C12-B1 SameSite=None-without-Secure, C12-C1
  sql.identifier `.`) were REFUTED as fail-opens and recorded as hygiene in `papercuts-38`.

## Latest Verification

- B1 self-verified first-hand: real `assertLinearSafePattern` ACCEPTS `((a|a))+`/`(?:(a|a))+`/`(([ab]|[bc]))+`/
  `(((a|a)))+`/`((a|a)){1,}`, rejects the unwrapped forms; `^((a|a))+$` measured exponential (29 chars → 2.1s).
- B2 self-verified first-hand: `classifyIp('0127.0.0.1')` = `public` (via octal 87.0.0.1) while `dns.lookup('0127.0.0.1')`
  = `127.0.0.1`; the literal fast-path (`egress.ts:923-932`) dials the raw host.
- B3 grounded in the classifier run (`extractedIpv4FromIpv6` covers only 3 prefixes; ISATAP `::5efe:` → public); split
  vote on exploitability (host-dependent).
- Throwaway probes under `/Users/mini/kovo-dogfood-round19-apps/` — safe to delete. Isolated worktree
  `/Users/mini/kovo-dogfood-round19` (branch `agent/dogfood-round19`). `/Users/mini/kovo` untouched.
