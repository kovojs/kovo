# Round-18 Bugz 39

Created 2026-07-06. Source of truth remains `SPEC.md`. Security fail-opens from the Round-18 security dogfood, run to
VERIFY the followup-14 fixes (B1/F1/auth) actually closed AND hunt the next axis. Hygiene / refuted-but-notable items
are in `plans/claude-papercuts-37.md`. Dogfooded in an isolated worktree at main HEAD `fdfa74164`; `/Users/mini/kovo`
untouched. Line numbers cite that HEAD.

## The round-18 headline: the C11 FIX re-introduced a C11 bug

Round 18 is a sharp lesson. followup-14 DEC-B fixed F1 (the ReDoS quantifier SET omitted `?`) by rewriting
`containsQuantifier` from a crude char-scan into a structured atom-walk routed through `quantifierAt`. That fix was
correct for `?` AND removed a real over-block (`(?:…)` non-capturing groups). **But the atom-walk itself is a C11
violation:** it treats a `(...)` group as ONE OPAQUE ATOM and never descends into it, so its traversal covers only a
SUBSET of the pattern tree — the body's top level. The old char-scan, crude as it was, caught a quantifier ANYWHERE in
the body string (including inside nested groups). So DEC-B **regressed** `((a+))+`: the pre-fix gate rejected it, the
post-fix gate accepts it. The fix for "the set was a subset" shipped with "the traversal is a subset."

Plus two fresh C11 axes the verification hunt surfaced: the egress IPv6 classifier decides on a hand-picked subset of
textual FORMS (N1), and the DEC-C credential classifier is wired into a subset of TABLES (V3-1).

| Finding    | The set/traversal             | The subset shipped (wrong)                         | The complete surface                                                        |
| ---------- | ----------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| B1 (regr.) | the pattern tree walked       | body TOP LEVEL only (`readAtom` steps over groups) | the full tree — recurse into nested groups                                  |
| B2         | secret-classified auth tables | unknown PLUGIN tables (the KV406 suggestion path)  | every table incl. known core tables' app-added credential `additionalField` |
| B3         | non-public IPv6 forms denied  | a few `::ffff:`/`::`-COMPRESSED regex forms        | the normalized address — every textual serialization of the same 128 bits   |

## Issues

- [ ] **B1 — REGRESSION (from my own followup-14 DEC-B): `assertLinearSafePattern` no longer rejects a quantified group
      whose backtracking quantifier lives one group-layer deep. `((a+))+`, `((a*))*`, `(([a-z]+))+`, `((\d+))*`,
      `(a(b+))+` all PASS the analyzer and compile to exponential-backtracking RegExps — the pre-DEC-B gate
      (`2268ca041~1`) REJECTED every one.** (HIGH, framework/availability+correctness+regression;
      `redos-nested-group` V2-1/N2-R1; both self-verified first-hand)
  - Observed (self-verified): running the actual exported `assertLinearSafePattern` — `(a+)+`, `(a*)*`, `(a?b?)+`
    → rejected (DEC-B works for these); `((a+))+`, `((a*))*`, `(([a-z]+))+` → **ACCEPTED**; `(?:ab)+` → accepted
    (correct, benign); `a?b?c?` → accepted (correct). Before/after on real source: `git show 2268ca041~1:…/redos.ts`
    REJECTED `((a+))+` (its char-scan `containsQuantifier('(a+)')` saw the `+` char); current HEAD PASSES it.
  - Root cause: `readAtom`'s group branch returns `{ end: close+1 }` with no recursion into the interior
    (`redos.ts:359-363`); `containsQuantifier` only calls `quantifierAt` at `atom.end` — a position PAST the inner group
    (`redos.ts:241-252`). The outer `assertLinearSafePattern` loop visits the inner `(` but skips it because it is
    followed by `)` not a quantifier (`redos.ts:201`). So a quantifier inside a nested group, where the inner group is
    not itself directly followed by a quantifier, is invisible. Compiler twin identical (`redos-pattern.ts:170,319-323`)
    → the KV434 compile-time lint is equally blind.
  - Reachability + severity: `schema.ts:628` `pattern()` → `assertLinearSafePattern` → `new RegExp` (`:635`) →
    `check.regex.test` on request input (`:664`) behind only the 4096-char cap (`redos.ts` documents this is NOT a CPU
    bound). Measured: anchored `^((a+))+$` on a 30–34 char input runs 24–63 SECONDS. An author writing a standard
    anchored full-string validator with a `?`-free nested group ships a request-triggerable multi-minute event-loop
    wedge — on a pattern the PRIOR release refused.
  - Why the naive counter fails: the server compiles the pattern VERBATIM (`new RegExp(src)`, no auto-anchor), so a bare
    `((a+))+` short-circuits on first `a`. But anchored validators (`^…$`) — the normal, recommended shape for
    full-string validation — are catastrophic, and the analyzer's whole job is to vet author-written literals.
  - Acceptance: `containsQuantifier` (runtime + compiler twin) RECURSES into group interiors — a quantifier at any depth
    inside the body (found via `quantifierAt` at each atom position, descending through nested groups) rejects — so
    `((a+))+`, `(a(b+))+`, `(([a-z]+))+` are rejected AGAIN, while `(?:ab)+`, `(a?b?)+` (already handled), `a?b?c?`, and
    `((ab))+` (no inner quantifier) still PASS (no over-block). Add a before/after regression test pinning the pre-DEC-B
    coverage so a future traversal rewrite cannot silently drop nested-group detection. This is C11 applied to the
    checker's TRAVERSAL, not just its quantifier set.

- [ ] **B2 — A credential-shaped `additionalField` an app adds to a KNOWN Better Auth core table (`user`/`session`/
      `account`) — e.g. `user.totpSecret`, `apiSecret`, `recoveryKey`, `encryptionKey` — is emitted with NO `secret:`
      entry, so KV435 never brands a projection that reads it to the client wire. The DEC-C positive credential
      classifier (`isBetterAuthCredentialShapedColumn`) that was supposed to catch exactly this is wired ONLY into the
      unknown-plugin-table KV406 suggestion path, never into known-table emission.** (HIGH, framework/confidentiality;
      `auth-additionalfield-core-table` V3-1; both verifiers REAL; the DEC-C author flagged this exact limit)
  - Observed: `internal.ts:918` (`withBetterAuthSecretFields`) is the classifier's ONLY production caller, reached only
    from `suggestedUnsupportedPluginTableAnnotation` for UNSUPPORTED plugin tables. Known bridge tables emit their
    `secret:` list VERBATIM from the static map (`internal.ts:1846-1857`); `contracts.ts:609` `user: {domain:'user',
key:'id'}` has NO secret list. `grep` for `additionalField` finds zero production handling — the sole occurrence is
    the motivating comment at `internal.ts:979`. So an app-added credential field on `user` lands on a readable domain
    table with no secret classification.
  - Repro: `betterAuth({ user: { additionalFields: { totpSecret: { type: 'string' } } } })` generates a real
    `user.totpSecret` Drizzle column; Kovo emits the `user` bridge with no `secret:`; a component/query projecting
    `user.totpSecret` reaches the client wire with no KV435 brand. `contracts.ts:560` documents `user` rows are
    intentionally app-readable, so the leaking projection is plausible.
  - Root cause: C11 — the classifier ranges over a SUBSET of tables (unknown plugin tables) instead of every table
    whose columns can be app-extended. followup-14 DEC-C added the positive rule but wired it to the wrong (narrower)
    surface; the fix's own comment names "a custom credential additionalField" as the threat.
  - Acceptance: the credential classifier runs over the OBSERVED columns of EVERY bridged table (known core + plugin),
    so a credential-shaped `additionalField` on `user`/`session`/`account` is branded `secret:` and a projection reading
    it is KV435-blocked; a benign readable `additionalField` (e.g. `displayName`) is NOT branded (no over-block). A test
    adds a credential `additionalField` to a core table and asserts the secret brand.

- [ ] **B3 — The egress IPv6 classifier fails OPEN on uncompressed / alternately-serialized forms of a non-public
      address: `classifyIpv6` matches a hand-picked set of textual regex forms (`^::ffff:…`, `^::…`, hex-compressed,
      NAT64) and falls through to `return 'public'` for everything else, so the UNCOMPRESSED IPv4-mapped metadata
      literal `0:0:0:0:0:ffff:169.254.169.254` (a valid IPv6, `net.isIP`=6, the SAME 128 bits as the blocked
      `::ffff:169.254.169.254`) is classified `public` → egress ALLOWED = SSRF to cloud instance-metadata. Also
      `fec0::/10` site-local and `::a9fe:a9fe` survive `new URL()` normalization and classify public.** (HIGH+MED,
      framework/SSRF-confidentiality; `egress-ipv6-forms` N1-1/N1-2; both verifiers REAL; N1-1 self-verified first-hand)
  - Observed (self-verified): `classifyIp('0:0:0:0:0:ffff:169.254.169.254')` → **`public`** (vs `::ffff:169.254.169.254`
    → `metadata`); `0:0:0:0:0:ffff:a9fe:a9fe` and `0000:…:ffff:a9fe:a9fe` → `public` too. `net.isIP` returns 6 for all.
  - Evidence: `egress.ts:542-572` `classifyIpv6` — mapped regex (`:545`) requires a `::`-compressed prefix, hexMapped
    (`:548`) requires `::ffff:`, and the fallback is `return 'public'` (`:572`). `evaluateEgress` treats `public` as
    allowed (`:595-596`). `canonicalizeKnownIp` for IPv6 only lowercases and "leaves compression as-is" (`:434-439`), so
    no upstream step re-compresses/normalizes before classification. The module's OWN contract comment (`:404-405`) says
    "anything we cannot confidently classify as public fails CLOSED (special-use → denied)" — `classifyIpv6` does the
    opposite.
  - Contrast: `classifyIpv4` (`:503-539`) is a COMPLETE denylist — every RFC1918/link-local/CGNAT/special range is
    enumerated so its `public` fallback is only reached by genuine public addresses. `classifyIpv6` has NO "else
    non-public" rule (global unicast is only `2000::/3`, never asserted), so its `public` fallback catches many
    non-public members.
  - Reachability: the raw literal reaches `classifyIpv6` unchanged on the `net.Socket.connect` floor's IP-literal branch
    (host passed to `net.connect`/`http.request({host})`/an `http.Agent` — i.e. NOT via `new URL`, which would
    canonicalize). N1-2's `fec0::/10` and `::a9fe:a9fe` reach it even through `new URL()` (URL does not compress those),
    so the common fetch/http-string path is exposed too.
  - Root cause: C11 — the classification decides on a hand-picked subset of textual ENCODINGS instead of the normalized
    entity. The IPv4 path is complete-by-enumeration; the IPv6 path is not, and defaults OPEN.
  - Acceptance: `classifyIpv6` normalizes to a canonical byte-form FIRST (expand `::`, extract any embedded IPv4-mapped/
    -compat/translated v4 and classify it, then match prefixes on the canonical form), and its DEFAULT is fail-closed —
    only genuine global-unicast (`2000::/3`, minus documented special-use) returns `public`; everything else returns a
    non-public class (denied unless allowlisted / credential-framed). Every textual serialization of a metadata/private
    address classifies identically to its compressed form. Add a fuzz/table test over uncompressed, mixed-case, and
    zero-padded serializations of the metadata + private ranges asserting they never classify `public`.

## Refuted / Not Carried Forward (positive signal)

- **V1 identity gate (DEC-A) — verification PASSED, no bypass.** The predefined-role membership allowlist holds; the one
  candidate (IDGATE-1: direct object-privilege / EXECUTE-on-definer escalation without role membership) was REFUTED as a
  fresh fail-open — it is the always-on reachable-routines audit's job, already covered — and is recorded as a scoping
  note in `papercuts-37`.
- **V3 auth classifier — the positive rule itself is sound** for the tables it covers: V3-2 (non-lexical credential
  names) and V3-3 (over-block of `publicKey`/`zipCode`/`*Hash`) were both REFUTED. The real gap is only the TABLE
  wiring (B2), not the rule.
- **N2 regression sweep — the only regression is B1** (the ReDoS nested-group weakening). Owner-scope RLS, the secret
  box, wire sinks, and the wrapped-client reconstruct all held under the followup-14 merges.

## Latest Verification

- B1 self-verified first-hand: ran the real `assertLinearSafePattern` — `((a+))+`/`((a*))*`/`(([a-z]+))+` ACCEPTED,
  `(a+)+`/`(a?b?)+` rejected, `(?:ab)+` accepted; before/after vs `2268ca041~1` confirms the REJECT→PASS regression.
- B3 self-verified first-hand: `classifyIp('0:0:0:0:0:ffff:169.254.169.254')` → `public` while `::ffff:169.254.169.254`
  → `metadata` (`net.isIP`=6 for both).
- B2 grounded in code reading (`internal.ts:918` sole caller; `contracts.ts:609` user has no secret list) + the DEC-C
  author's own flagged limitation + both verifiers REAL.
- Throwaway probes under `/Users/mini/kovo-dogfood-round18-apps/` — safe to delete. Isolated worktree
  `/Users/mini/kovo-dogfood-round18` (branch `agent/dogfood-round18`). `/Users/mini/kovo` untouched.
