# Round-6 Soundness Bugz 27

Created 2026-07-01. Source of truth remains `SPEC.md`. Security/soundness defects found dogfooding AFTER
`plans/fundamental-hardening-and-refactor.md` was implemented (DDL classifier + fail-closed program + chokes +
brands + oracle + source-derived census + 9 threat-category gates). Papercuts in `plans/claude-papercuts-25.md`.

**Meta-theme — the round-5 *instances* (bugz-26 B1–B4) are individually fixed, but the *class* is not closed.**
Every round-6 hole below is the SAME enumerate-and-allow pattern one shape deeper, because the hardening fixes
added recognition/classification for the specific reported shape and left the fail-OPEN architecture intact.
Concretely, three plan checkboxes marked `[x]` as "fail closed" were implemented as "recognize one more shape":
- **J.2** ("the read-only floor rejects any statement not positively proven read-only") was NOT implemented. The
  floor is still `if (writeTables.length === 0) return;` (`sql-safe-handle.ts:552,568,606`) — a denylist. J added
  DDL *cases* to `writeTablesForStatement`; the next write-shaped statement the classifier maps to `[]`
  (`SELECT setval(...)`) walks straight through (B1).
- **K.2** ("fail closed on any callee it cannot prove non-trust") was NOT implemented. The recognizer still returns
  `null` (→ call skipped, no KV426) for any callee the resolver can't map; K added only object-literal-member
  resolution. Spread / array-element / function-return / class-field callees all still ship raw XSS (B2).
- **L.1** (DEC7 "everything else → fail-closed") was NOT implemented for binding shapes. The wire-alias tracker
  registers only `Identifier` bindings; an array/object binding pattern launders a secret to the wire (B3).

Also: the DEC3 execute-and-diff **oracle** (which WOULD flag `setval` as a write) is only a CI cross-check against
the syntactic classifier over an *enumerated* corpus — it is NOT wired as the runtime enforcement twin (M10). The
runtime read-only floor still trusts the syntactic parse, so the oracle catches only what its corpus lists.

Baseline: fresh `--sqlite` and `--dialect postgres` (pglite) `create-kovo` starters, linked to the local framework
(`scripts/link-local-kovo.mjs`), prod-artifact tested (`kovo build`, exit 0). Each hole verified by an independent
verifier via isolation flip on a fresh prod artifact.

## Issues

- [ ] **B1 — `SELECT` with a volatile writing function (`setval`/`nextval`/volatile UDF) bypasses BOTH the KV433 read-only floor and the KV406 declared-table allowlist: a read-only handle executes a real persistent write.** (HIGH, framework/security; postgres/pglite dialect; found by `ddl-choke-deep`, reproduced independently on real PGlite)
  - Observed: `readonlyDb(db).execute(trustedSql(sql`select setval('probe_seq',4242)`))` returns with no throw, and `SELECT last_value FROM probe_seq` is then `4242` — a persistent write executed through a handle sold as read-only. `nextval` likewise advances the sequence (corrupts every `SERIAL`/identity allocation). Any volatile writing UDF turns `select udf(input)` into an arbitrary table write. In a mutation handle scoped `tables:['contacts']`, the same `select`-wrapped write is admitted (the declared-table allowlist short-circuits on the empty write-set too).
  - Root cause: `packages/server/src/sql-write-allowlist.ts:141-146` — `writeTablesForStatement` returns `[]` for `case 'select'/'show'/'union'/'union all'/'values'` with no side-effect-function analysis. Consumed fail-open at `packages/server/src/sql-safe-handle.ts:606` (`assertReadSqlStatement`, the KV433 floor: `if (writeTables.length === 0) return;`) and `:568` (`assertSqlWriteTablesAllowed`, the KV406 allowlist: same short-circuit). This is J.2 un-inverted: an empty syntactic write-set is treated as "proven read-only" instead of "unproven → fail closed".
  - Why it matters: `readonlyAppDb` (a query loader's `context.db`, the blessed endpoint-read handle) can mutate sequences/rows on a green build; the §11.2 `observed ⊆ declared` contract is void for any write expressed inside a `SELECT`. The DEC3 oracle would catch this (it executes-and-diffs) but is not the runtime twin and its corpus omits volatile-function SELECTs.
  - Repro evidence (isolation flip, real @kovojs/server + real PGlite): SAFE spellings RED — `delete/update/insert/CREATE TABLE` each throw KV433. ATTACK GREEN — `select setval('probe_seq',4242)` returns and `last_value` becomes 4242. Prod artifact: a plain `sql`select nextval('probe_seq')`` inside a `query()` read-only loader builds GREEN.
  - Acceptance: the read-only floor fails closed on any statement not *positively proven* side-effect-free (invert J.2 for real), OR the runtime twin executes-and-diffs (wire the DEC3 oracle into the enforcement path, not just CI). A syntactic `SELECT` that contains a call to a non-allowlisted (volatile/unknown) function is unproven → KV433/KV406. Add volatile-function SELECTs to the oracle corpus.

- [ ] **B2 — KV426 (and `trustedUrl`) fail OPEN on every trust-brand callee shape other than the one object-literal-member case that K patched: spread-copy, array-element, function-return, and class-field callees all ship raw reflected XSS on a green build.** (HIGH, framework/security; found by `kv426-resolver-deep`, five shapes each reproduced independently with prod-artifact reflection)
  - Observed (each an isolation flip: direct `trustedHtml(taint)` RED / attack GREEN + served `<script>` reflected from a request header): (a) spread — `const t2={...trustObj}; t2.html(taint)`; (b) array — `const arr=[trustedHtml]; arr[0]!(taint)`; (c) function-return — `const get=()=>trustedHtml; get()(taint)`; (d) class-field — `class R{ h=trustedHtml } new R().h(taint)`; (e) the `trustedUrl` URL sink — `const u2={...urlObj}; u2.url(taint)` emits `href="javascript:…"` verbatim.
  - Root cause: `packages/core/src/internal/framework-identity.ts` `namespaceMemberIdentity`/`objectLiteralMemberIdentity` (:426-517, :534-535) resolve only `PropertyAssignment` members of an object-literal receiver — a `SpreadAssignment` is skipped (:534-535), and there is no arm for an array-literal, `CallExpression`, or `NewExpression` receiver (they hit the default `undefined` at :517/:918-919). So the resolver returns `undefined`, `rawTrustSinkForExpression` (`packages/compiler/src/validate/trusted-html-provenance.ts:130-144`) returns `null`, and the call is **skipped** at :60-61 — no KV426. The file header comment (:36-37) claims these forms "fail closed", but the recognizer only fails closed when it *recognizes* the callee as a trust sink; an unresolved callee is silently treated as a non-sink. K.2 (fail-closed-on-unrecognized) is unimplemented; K added only the object-literal-member resolver arm.
  - Why it matters: the stored/reflected-XSS gate is bypassable by five one-line natural refactors of "assign `trustedHtml`/`trustedUrl` to a place"; the same class as bugz-26 B2, unclosed.
  - Repro evidence: five fresh prod artifacts (`kv426spread`, `kv426flip`, `vfretc`, `cf426`, `urlspread`), each build exit 0 with the attack spelling and exit 1 (KV426) with the direct spelling; served HTML/anchor reflects `<script>FINAL_XSS</script>` / `href="javascript:FINAL"`.
  - Acceptance: the KV426/`trustedUrl` recognizer fails closed on ANY callee it cannot positively prove is a non-trust value over request/query-derived args (implement K.2 for real: unresolved callee that could carry a brand ⇒ KV426), rather than resolving one extra shape at a time. Metamorphic seed: arbitrary unrecognized callee × {HTML, URL} sink.

- [ ] **B3 — DEC7 proven-off-wire allowlist bypassed by an array/object binding pattern: `const [firstItem] = items;` then writing a secret column into `firstItem` launders the secret onto the query wire on a green build.** (HIGH, framework/security; found by `value-flow-dec7-deep`, reproduced independently)
  - Observed: schema `contacts.ssn` declared `kovo({…, secret:['ssn']})`. ATTACK `const [firstItem] = items; const firstSecret = secretRows[0]; if (firstItem && firstSecret) firstItem.ssn = firstSecret.ssn; return { items };` builds GREEN; the secret is serialized into the returned wire shape. SAFE spelling `const firstItem = items[0];` (only change) → KV435 RED.
  - Root cause: `packages/drizzle/src/static/query-shapes.ts:799` — `wireElementAliasRoots()` registers a variable as a wire-element alias only when `Node.isIdentifier(name)`; an array/object binding pattern (`const [firstItem] = …`) is skipped, so `taintedValueReachesWire()` (:487) does not treat a write into `firstItem` as reaching the wire root. DEC7's "everything else → fail-closed" is not implemented for non-Identifier binding shapes; the tracker still enumerates recognized alias forms.
  - Why it matters: the KV435 secret-to-wire gate — the one L.1 rewrote to a fail-closed allowlist — is defeated by destructuring the accumulator, a trivial refactor; the same class as bugz-26 B3.
  - Repro evidence: `vfdeep` / `advfd7` prod artifacts — attack spelling `pnpm run build:prod` exit 0 with the laundering logic present verbatim in `dist/server/server/handler.mjs`; the one-token-different safe spelling → KV435.
  - Acceptance: the wire-alias/off-wire tracker fails closed (KV435/KV406) on any binding/assignment shape it cannot positively prove is off-wire, including array/object binding patterns; a write of a secret column into any binding rooted at a wire accumulator is a leak.

- [ ] **B4 — The declared-table write allowlist compares BARE table names, ignoring the schema qualifier: a mutation scoped `tables:['contacts']` may write `otherschema.contacts`.** (MED, framework/security; postgres; found by `ddl-choke-deep`, source + parser confirmed)
  - Observed: `DELETE FROM otherschema.contacts` is admitted into a `tables:['contacts']` allowlist; the AST carries `{schema:'otherschema',name:'contacts'}` but the allowlist sees only `contacts`.
  - Root cause: `packages/server/src/sql-write-allowlist.ts:333` — `tableName(identifier)` returns `identifier.name`, dropping `identifier.schema`; compared against `declaredTables` as bare names at `packages/server/src/sql-safe-handle.ts:575-577` (KV406).
  - Why it matters: on a multi-schema Postgres database the `observed ⊆ declared` allowlist does not isolate schemas — a mutation declared for the app schema can write a same-named table in another schema (e.g. an auth or billing schema).
  - Repro evidence: parser probe `parse("DELETE FROM otherschema.contacts")` → `{type:'delete',from:{schema:'otherschema',name:'contacts'}}`; `tableName()` returns `'contacts'`; name-only compare admits it. Confirmed on a green `schemaqual` pglite artifact.
  - Acceptance: the declared-table comparison is schema-qualified (compare `schema.name`, defaulting the unqualified side to the connection's search-path/`public`), so a write to `otherschema.contacts` is not admitted by `tables:['contacts']`.

## Latest Verification

- Baseline `--sqlite` + `--dialect postgres` starters linked to local framework, `build:prod` green.
- B1 reproduced on real @kovojs/server `readonlyDb()` over real PGlite (setval persisted through the read-only handle); source `sql-write-allowlist.ts:141-146`, `sql-safe-handle.ts:568,606` confirmed first-hand (floor still `writeTables.length === 0 → return`).
- B2 five shapes each reproduced on a fresh prod artifact with served `<script>`/`javascript:` reflection; resolver gaps confirmed at `framework-identity.ts:517,534-535,918-919`.
- B3 reproduced on `advfd7`; `query-shapes.ts:799` Identifier-only alias registration confirmed.
- B4 source + parser confirmed; `sql-write-allowlist.ts:333` drops `identifier.schema`.
- Throwaway apps under `/Users/mini/kovo-dogfood-round6/` — safe to delete. No framework source or `SPEC.md` changed. No servers left running.
