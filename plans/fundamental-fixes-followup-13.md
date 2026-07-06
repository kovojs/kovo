# Fundamental Fixes Followup 13 — a security set is a closure computed from the boundary, not a hand-picked subset or a denylist

Created 2026-07-06. Self-standing. Source of truth for behavior is `SPEC.md`. Continues the engine-choke /
retain-and-prove / capabilities-not-values / C9 line (`fundamental-fixes-followup-{6..12}.md` + `postgres-v1-devex.md`).
Responds to the Round-16 findings (`plans/claude-bugz-37.md` B1–B4, `plans/claude-papercuts-35.md` P1–P2). Line
numbers cite `origin/main` (`767cd6a67`).

## 1. The one foundational issue (round-16 restatement)

Round 16 is the strongest acceptance result of the arc: followup-12's MOVE 1 (value carriers — "reconstruct/own the
value that reaches a sink") is COMPLETE. The DEC-F sink inventory has no missed sink (XSS, open-redirect, SQL-identifier,
headers, cookies, egress all reproduced SOUND), and the wrapped-client reconstruct (DEC-A) survived 13 attack angles
with ZERO findings. Every remaining fail-open is on MOVE 2 (enumerate the reachable set), and all four are ONE error:
**a security enumeration was a hand-picked SUBSET or a DENYLIST, not the COMPLETE set closed over the relation that
actually matters, computed from the engine.**

| Finding | The set                             | How it was built (wrong)                             | What it should be                                                              |
| ------- | ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| B1      | relations a write reaches           | DIRECTLY-writable (`has_table_privilege`)            | the PROPAGATION CLOSURE over FK cascade + partition routing                    |
| B2      | dangerous identity attributes       | a DENYLIST of two (`SUPERUSER`, `BYPASSRLS`)         | an ALLOWLIST: the identity has ONLY minimal attributes (also `REPLICATION`, …) |
| B4      | identities whose EXECUTE is audited | the 4 framework roles `{reader,writer,admin,system}` | every identity that touches the engine (+ the runtime LOGIN)                   |
| B3      | surfaces that handle a secret       | one named file (`trusted-plaintext.ts`)              | every request-reachable path that reads a secret                               |

**The unifying principle this plan enforces: a set used for a security decision must be the COMPLETE set — the closure
over the relation that matters (propagation, membership, reachability) OR the allowlist of the minimal safe members —
computed from the engine/boundary, never a hand-picked subset and never a denylist of the known-bad members.** This is
C9 ("the entity, not a proxy") applied to SETS: a subset/denylist is a proxy for the true set; the fox is the member you
didn't enumerate.

## 2. The architectural move

Compute each security set from the boundary, as a closure or an allowlist:

- **Closures** (reachability sets): close "what an app write reaches" over its PROPAGATION edges (FK referential
  actions, partition routing, rewrite rules); close "what identities touch the engine" over the assumable-role graph.
- **Allowlists** (property checks): the runtime identity must have ONLY the framework's minimal safe attribute set — a
  positive spec, so a NEW dangerous attribute (a future Postgres role attribute) is caught by default, not a denylist
  of the two attributes we happened to name.
- **Reachability, not a proxy name** (the non-egress proof): enumerate the actual request-reachable secret-handling
  paths and prove each is confined — not a named module the proof happens to scan.

## 3. Meta-invariant (extends followup-12 C9)

- **C10 — A security enumeration is the COMPLETE set closed over the relation that matters, or the ALLOWLIST of the
  minimal safe members, computed from the engine/boundary — never a hand-picked subset, a denylist of known-bad
  members, or a proxy name for the set.** Corollaries: (a) a reachability set is closed over its propagation edges
  (a write's cascade/routing reach; the assumable-role graph); (b) a dangerous-property check asserts the entity has
  ONLY minimal safe properties (allowlist), never that it lacks the ones you thought of (denylist); (c) a proof over a
  boundary enumerates the actual reachable surface, not a module chosen to stand in for it.

## 4. Decisions / work items

### DEC-A — Write-reachability is the propagation closure (fixes B1)

- [ ] **A1 — No unvetted attached code on any relation in the app roles' FULL REACHABILITY CLOSURE (resolves O1). Unify the existing read-reachability set with the write-propagation closure: {readable ∪ writable ∪ write-propagation} where write-propagation closes the directly-writable relations over FK referential actions (`pg_constraint` `confdeltype`/`confupdtype` ∈ {`c`,`n`,`d`}), partition routing (`pg_inherits` / `relispartition`), rewrite rules, and inheritance. A non-vetted (definer / non-`security_invoker`) trigger/rule/constraint/default/index function on ANY relation in the closure is REFUSED; a relation whose reachability the closure cannot disprove fails closed.** Trigger BODIES are NOT a closure edge — a vetted trigger's body is trusted (that is what "vetted" buys); an unvetted trigger is refused before its body matters — so the closure is over STRUCTURAL edges only and is bounded/catalog-computable. Do NOT use the coarse "refuse all definer triggers anywhere" (it over-blocks legit out-of-reach ops tables).
  - Acceptance: a definer trigger on an FK `ON DELETE CASCADE` target, on a partition child, and on a rule-redirect target each make `kovo db check` REFUSE while the app role has no direct write privilege on them; a legit definer trigger on a relation the app roles provably cannot reach passes; a fully-vetted schema passes. Add FK-cascade + partition-routing + rule-redirect to the DEC-E fuzzer propagation axis.

### DEC-B — Identity is an allowlist over the complete assumable set (fixes B2, B4)

- [ ] **B1 — The runtime identity check is an ALLOWLIST over the bounded role-attribute booleans: the runtime login AND every assumable role (the `pg_has_role` MEMBER closure from followup-12 DEC-C — ONE shared enumeration, per O3) must have NONE of the elevated attributes `rolsuper`, `rolbypassrls`, `rolreplication`, `rolcreaterole`, `rolcreatedb`; benign attributes (`rolconnlimit`, `rolvaliduntil`, group memberships) are don't-care. For framework-CREATED roles, create with the minimal spec and verify equality; for ADOPTED roles, assert attributes ⊆ minimal spec. PLUS a version-guard (resolves O2): a test that FAILS if `pg_authid`/`pg_roles` exposes a role-attribute column the framework has not classified — so a Postgres upgrade that adds an attribute fails CI until it is classified (retain-and-prove on the attribute set).**
  - Acceptance: a runtime login or assumable role with `REPLICATION`/`SUPERUSER`/`BYPASSRLS`/`CREATEROLE`/`CREATEDB` fails provision/check/boot with the attribute named; the version-guard fails on an unclassified role-attribute column; SPEC documents the audited attribute set. A test covers each elevated attribute.
- [ ] **B2 — The SECURITY DEFINER routine + attached-code audits enumerate EVERY identity that touches the engine — {runtime LOGIN} ∪ {the SAME assumable-role closure B1 computes} — not just the four framework roles. A definer function EXECUTE-reachable by the login (or any assumable role) is refused unless vetted; definer-function OWNERS need no enumeration (per O3, the audit refuses any reachable unvetted definer function regardless of owner, because it runs outside the caller's RLS context).**
  - Acceptance: a definer function EXECUTE-granted to the runtime login role makes `kovo db check` REFUSE; the audited identity set == {login} ∪ {assumable roles} and is the SAME enumeration B1 uses (no drift).

### DEC-C — The non-egress proof enumerates the actual secret-handling surface (fixes B3; + papercut P1)

- [ ] **C1 — The auth trusted-zone "prove-non-egress" guarantee enumerates every REQUEST-REACHABLE path that reads an auth secret (the `systemRole`/`systemDb` handle, the adapter hooks, error/log/serialization paths) and asserts each is boxed or provably confined — not a scan of a named module (`trusted-plaintext.ts`). The `systemRole` secret read is BOXED for everything except the specific vetted compare/verify; the proof is computed from the reachability graph, not a proxy file.**
  - Acceptance: a request-reachable path that reads an unboxed cross-user credential turns the proof RED; the `systemRole` read yields a box everywhere except the vetted compare/verify; a test that a secret reaching a NEW adapter path fails the proof. (Fixes `bugz-37` B3 and `papercuts-35` P1.)

### DEC-D — SPEC + make each enumeration a CHECKED invariant

- [ ] **D1 — SPEC §10.3 states C10 and documents, for each security set, that it is computed from the engine as a closure/allowlist that fails closed on additions: the write-propagation closure (DEC-A), the identity attribute allowlist over the assumable closure (DEC-B), the audited-identity set (DEC-B2), and the secret-reachable-surface set (DEC-C). Reclassify the relevant codes in `security-markers.ts`.**
  - Acceptance: SPEC names each set + its closure/allowlist rule; the registry has no authorization/confidentiality code resting on a subset or denylist.

### DEC-E — Make each enumeration a CHECKED invariant, DIFFERENTIALLY (resolves O5)

- [ ] **E1 — Extend the DEC-F grant-shape fuzzer with a PROPAGATION axis and an IDENTITY-ATTRIBUTE axis, and for the write-closure use the DIFFERENTIAL form: generate a random schema (FK/partition/rule/inheritance/trigger shapes), ACTUALLY EXECUTE app-role writes on a real engine, OBSERVE which relations' triggers actually fire, and assert the DEC-A audit refused-or-vetted every one. Generate role-attribute combinations and assert the DEC-B allowlist rejects any elevated one; add a secret-reading adapter path and assert the DEC-C non-egress proof goes RED.**
  - Rationale: the differential form compares the audit's model against the ENGINE'S GROUND-TRUTH propagation — a propagation mechanism the framework's model missed shows up as an audit that passed while a trigger fired. This is what makes C10 a CHECKED invariant (the engine adjudicates completeness), not an asserted one — the Move-2 analog of DEC-F.
  - Acceptance: the differential fuzzer covers FK/partition/rule/inheritance propagation + the role-attribute space; re-introducing B1 (a propagation edge dropped) or B2 (an elevated attribute) turns it RED; no over-block on a vetted schema.

## 5. Resolved design decisions (was "open issues"; decided 2026-07-06)

O1/O2/O3/O5 are decided and folded into the DECs above. O4 is DELEGATED to a separate plan.

- **O1 (write-propagation closure boundedness) → RESOLVED into DEC-A1: unified full-reachability closure (read ∪ write ∪ FK/partition/rule/inheritance propagation) + retain-and-prove backstop.** Tight structural closure, not the coarse "refuse everywhere" (over-blocks out-of-reach ops tables); trigger BODIES are not a closure edge (vetted=trusted, unvetted=refused), so the closure is bounded/catalog-computable.
- **O2 (version-dependent attribute spec) → RESOLVED into DEC-B1: allowlist over the bounded role-attribute booleans + a version-guard test** that fails CI if `pg_authid`/`pg_roles` gains an unclassified attribute column (fail-closed on the unknown).
- **O3 (audited-identity completeness) → RESOLVED into DEC-B2: {login} ∪ the SAME assumable-role closure B1 computes (one shared enumeration); definer-function owners need no enumeration** (the audit refuses any reachable unvetted definer function regardless of owner).
- **O4 (is C10 the last axis? the "when do we stop" threat-model review) → DELEGATED to `plans/threat-matrix-plan.md`.** The threat-model coverage matrix + external audit is the v1 security-signoff artifact and is scoped as its own plan, done separately.
- **O5 (checked enumeration invariant) → RESOLVED into DEC-E1: the DIFFERENTIAL fuzzer** (execute writes on a real engine, observe which triggers fire, assert the audit covered them) — the engine adjudicates completeness. Paired with the identity-attribute axis.

## 6. Probes before committing

- [ ] **DEC-A:** a definer trigger on an FK-cascade target + a partition child + a rule-redirect target make `kovo db check` REFUSE; a definer trigger on a provably-out-of-reach relation passes (no over-block); the differential fuzzer propagation axis turns RED on a re-introduced B1.
- [ ] **DEC-B:** a `REPLICATION` (and `CREATEROLE`/`CREATEDB`) login/assumable role fails provision/check/boot; the version-guard fails on an unclassified attribute column; a login-granted definer function is refused.
- [ ] **DEC-C:** a request-reachable unboxed cross-user secret read turns the non-egress proof RED; the `systemRole` read is boxed outside the vetted compare/verify.
- [ ] **DEC-E:** the differential fuzzer's audit-vs-engine comparison passes on vetted schemas and turns RED on a re-introduced B1/B2.

## 7. Resolved design forks (recorded for provenance)

- **Direct set vs propagation closure (B1)** — chose the CLOSURE (DEC-A): "what a write reaches" is transitive over FK
  cascade + partition routing; the directly-writable set is a hand-picked subset.
- **Denylist vs allowlist for identity attributes (B2)** — chose the ALLOWLIST/minimal-spec (DEC-B): denying the two
  attributes we named misses `REPLICATION` and every future one; assert only-minimal-attributes.
- **Named-file scan vs reachability proof for non-egress (B3)** — chose the REACHABILITY proof (DEC-C): the proof must
  enumerate the actual request-reachable secret paths, not a module chosen to stand in for them (C9 on the proof).
- **Four app roles vs every engine identity (B4)** — chose EVERY IDENTITY (DEC-B2): {login} ∪ assumable closure, reusing
  DEC-C's role graph.
- **Assert vs differential-fuzz the enumerations (O5)** — chose the DIFFERENTIAL fuzzer (DEC-E): execute writes on a real
  engine and observe which triggers fire, so the engine — not the framework's model — adjudicates closure completeness.
- **Fold vs delegate the threat-model review (O4)** — DELEGATED to `plans/threat-matrix-plan.md` as the v1
  security-signoff artifact (coverage matrix + external audit), done as its own plan.
