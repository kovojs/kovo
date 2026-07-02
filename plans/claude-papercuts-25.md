# Round-6 Papercuts 25

Created 2026-07-01. Source of truth remains `SPEC.md`. Papercuts from the round-6 dogfood AFTER
`plans/fundamental-hardening-and-refactor.md` was implemented. Confirmed security/soundness defects are in
`plans/claude-bugz-27.md` (SELECT-volatile-write, KV426 callee shapes, DEC7 binding-pattern, schema-qualifier).

**Meta-theme:** the churn HELD (no regressions), and the secret-lifecycle/auth/timing/rate-limit gates HELD (see
Refuted). The two honesty papercuts are (P1) a plan checkbox marked `[x]` whose fix is not effective in the real
build path, and (P2) the completeness proofs (census + brand denominators) still lean on enumerated allowlists.

## Scope

Eight `create-kovo` starters (both dialects) on the hardening-implemented framework, prod-artifact tested and
served. Root causes confirmed first-hand; symptoms reproduced by independent verifiers.

## Issues

- [ ] **P1 — KV310 still green-certifies a provably-dead hand-written optimistic transform for a fragment-target region: round-5 P3 / O.2 was marked `[x]` but is not effective in the real prod build path.** (LOW, framework/honesty; found by `verify-round5-fixes`, reproduced on the DEFAULT scaffold)
  - Observed behavior: the unmodified default `--sqlite` scaffold's `addContact` mutation declares a hand-written optimistic transform over `contactsQuery`; `ContactsRegion` is an inferred server-fragment target ("1 RTT, no optimistic update"). `pnpm run build:prod` is fully GREEN with zero KV310/warn. `dist/.kovo/graph.json` records `optimistic:[{mutation:'mutations/add-contact',query:'queries/contacts-query',status:'hand-written'}]` (certified covered), yet `pages['/'].queries=[]` and the shipped client runtime bundle contains ZERO occurrences of the transform body (`pending-`) / `optimistic` / `contacts-query` — the transform is keyed to a client store that does not exist and can never run, but is certified live.
  - Root cause: `packages/cli/src/commands/build-export.ts` `staticBuildCheckGraph` builds the check graph WITHOUT `updateCoverage` (persisted `graph.json` has `updateCoverage:null`), and `packages/cli/src/graph-explain-format.ts` `optimisticClientQueryConsumers` short-circuits `if (updateCoverage.length === 0) return clientQueries;` and never consults `component.fragments`. The fragment-only dead-transform downgrade is only reachable with hand-fed `updateCoverage` (unit test `packages/cli/src/index.kovo-check.test.ts:1123`), never in a real build. So O.2's acceptance ("KV310 warns when a transform's only consumers are fragment-target regions") passes its unit test but does not fire for the default scaffold.
  - Why it matters: an author sees a green KV310 and believes their optimistic transform is live; it is silently dead for the fragment path (by-design no client optimism — no security/data impact). LOW; the defect is the honesty of the certification and the falsely-completed O.2 checkbox.
  - Repro evidence (isolation flip on the default scaffold): `fsverify` (default scaffold) GREEN + certified; `fsorphan` (identical transform for a query rendered by no component) → `BUILD_FATAL KV310 … Invalidated query lacks optimistic transform` (exit 1). Two byte-identical dead transforms; the only difference is that `contacts-query` is declared by the fragment-target `ContactsRegion.queries`, which flips RED→GREEN — proving the gate exists but is bypassed by the fragment-target `.queries` declaration.
  - Acceptance: KV310 warns (not certifies-clean) in the REAL build path when a hand-written transform's only consumers are fragment-target regions — i.e. `staticBuildCheckGraph` computes `updateCoverage` (or the consumer walk consults `component.fragments`) so the downgrade is reachable outside the unit test. Re-open O.2 (it is not effective as shipped).

- [ ] **P2 — The completeness proofs (`check-security-brands` + the census `--require-complete` gate) derive their "MUST be branded / MUST have a row" denominators from enumerated file/name allowlists, so a framework sink authored outside those patterns is invisible to `complete: true`.** (LOW, dev-tooling/honesty; found by `brand-census-completeness-deep`, verifier downgraded the live-exploit claim to architectural)
  - Observed behavior: the round-5 P1 fix (N) made the census derive `write-capable-handle`/`output-wire-sink` denominators "from source", but discovery is syntactic — a fixed set of construction-call names / a file scope. A new managed-handle wrapper or response-emitting channel that does not match the enumerated shape is not discovered, so the gate still cannot see a *missing* sink; the completeness proof enumerates one layer up. (No live app-exploitable leak was reproducible this round — the verifier refuted the "invisible sink is exploitable today" claim — so this is an architectural honesty note, not a bug.)
  - Root cause: `scripts/check-security-brands.mjs` + `scripts/fundamental-fixes-census-gate.mjs` — discovery of the branded-function / handle / channel set is by name/import/file pattern, not by a total structural property (e.g. "every function reachable from an enforcement site" computed over the real call graph).
  - Why it matters: it is the same enumerate-and-allow shape the census was built to eliminate, now in the completeness proof; a future sink (like this round's B1/B2/B3) can be added without a census row failing. LOW because no current sink is demonstrably unenrolled.
  - Acceptance: the brand/census denominators are derived from a structural reachability property (call-graph reachability from enforcement sites / from the driver-method choke / from `emitToWire`), with a planted canary that adds a new unbranded sink and asserts the gate fails — so "complete" proves completeness, not list-membership.

## Refuted / Not Carried Forward

Verified this round — these HELD:

- **Wide regressions — none.** Booted the real prod artifact and exercised over curl: auth login/session/sign-out; enhanced add-contact success renders the new row; multi-value `Set-Cookie` (session + csrf both emitted — S4 header-bag holds); no-JS 422 FormError + PRG redirect; CSRF reject/accept; per-principal `cache-control: private, no-store` + `Vary: Cookie` on guarded `/_q`; retryAfter/reauth statuses; webhook replay dedup (S5). The heavy churn (mutation.ts split S6, header-bag S4, guard/adapter dedup S1/S2/S3, `emitToWire`/`enforceManagedSql` routing P.1/P.2) introduced no behavioral regression.
- **Secret-lifecycle / auth / rate-limit / timing (Q.5–Q.8) HELD.** A task throwing a secret-bearing error is scrubbed in status/logs; `console.error(secretBox)` is scrubbed; an unresolved principal is denied fail-closed at guard/`verifyCapability`; anonymous callers do not share one global rate-limit bucket (keyed on a proven principal); secret/signature compares are constant-time. No leak or fail-open across these four categories.
- **Open-redirect (Q.9) HELD.** `redirect()`/`Location` built from `?next=//evil.com` and Host/X-Forwarded-Host smuggling are neutralized (same-origin/allowlist via `redirectLocationHeader`).
- **Filesystem / subprocess "gates don't cover app code" — NOT a defect (refuted).** An app author calling `readFileSync('/etc/passwd')` or `execSync('id')` in their OWN server endpoint is authoring their own server code; the framework does not (and is not claimed to) sandbox the author from themselves. The Q.2/Q.3 gates constrain *framework* code, which is the correct scope. (Minor asymmetry noted: the build-time egress gate does not scan app code while the runtime egress floor does — cosmetic, not a hole, since the runtime floor is the enforcement.)

## Latest Verification

- `claude-bugz-27` B1 reproduced on real PGlite; P1 reproduced on the default scaffold prod artifact (byte-identical dead transforms, one flips RED→GREEN via the fragment `.queries` declaration).
- Throwaway apps under `/Users/mini/kovo-dogfood-round6/` — safe to delete. No framework source or `SPEC.md` changed; no servers left running.
