# Static Analysis & Verification (SPEC §11 except §11.3)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 11. Static Analysis & Verification

### 11.1 Touch-set extraction (the static pass)

Rests on one property: **Drizzle's table argument is always an imported identifier with a statically known declaration site.**

```
For each write() body (ts-morph over the program):
  1. Find CallExpressions where callee.name ∈ {insert, update, delete}
     AND receiver's TYPE originates in drizzle-orm        ← type identity, not variable names;
                                                            renames/destructuring irrelevant
  2. Resolve argument 0:
     A. imported identifier        → follow symbol → pgTable declaration   (90%+)
     B. namespace/re-export chains → getAliasedSymbol loop
     C. alias(T, …)                → recurse on T
     D. conditional initializer    → union both branches (over-approximation is safe:
                                     missing = bug, excess = warning)
     E. runtime-flowing value      → 'unresolved' → KV406 (error: manual touches REQUIRED;
                                     dev/build/export gate blocks until supplied — §10.3)
  3. Interprocedural: helpers receiving a Drizzle-typed value are summarized bottom-up
     (memoized fixpoint); calls into node_modules with a db arg → KV406 (error, same gate).
     `update…from(R)` / `insert…select` contribute R to the READ set, not touches.
     Opaque/raw query projections (KV410, §10.2) contribute their declared `reads:`
     table set to the READ set; a `reads:` entry naming an `exempt` table is KV411.
  4. Parameterized keys: extract eq(T.keyCol, expr) from .where(); expr traceable to a
     write param ⇒ key derivation recorded; ranges/IN ⇒ table-level (KV409 notice).
  5. Whenever a write site's touch set is not fully statically resolved (any 'unresolved'
     table at step 2.E, any node_modules db call at step 3, or any raw-SQL statement whose
     mutated tables cannot be read off the AST), it is **KV406 (error)** absent a manual
     `touches`/`tables` declaration, and an unexecuted conditional write on such a site is
     **KV405 (error, CI-gating)** — see §11.2. KV405 is no longer advisory: a write site
     whose touch set is not fully statically resolved and whose branches were not all
     observed under instrumentation blocks build and static export, because the runtime
     cross-check (§11.2) cannot have proven the unexecuted arm's touch set sound.
```

Output is **reproducible on demand** through `kovo emit` / `kovo explain` and mechanically proven
by fixpoint plus render-equivalence gates. The emitted graph is also the runtime authority for
derived query reads and mutation touches; manual `reads` / `touches` are checked overrides for
opaque sites, not the default authoring model. Invalidation-graph changes are inspected through
those commands and CI evidence, not by committing app-local generated files:

```ts
// emitted generated/touch-graph.ts — DO NOT EDIT
export const touchGraph = {
  'cart.addItem': {
    touches: [
      { domain: 'cart', via: 'cart_items', site: 'cart.domain.ts:8', keys: null },
      { domain: 'product', via: 'products', site: 'cart.domain.ts:12', keys: 'arg:productId' },
    ],
    unresolved: [],
  },
} as const;
```

### 11.2 Runtime verification (independent cross-check)

Dev server and the test harness wrap `db`; every executed statement is parsed by the configured dialect path (Postgres uses `pgsql-ast-parser`; SQLite normalizes `?` placeholders before the same structural walk) and checked. Static over-approximates (all branches); runtime under-approximates (executed branches). **Invariant: `observed ⊆ static ∪ KV406-annotated`** — violation means analyzer bug or smuggled SQL; either is a CI failure. For raw-SQL writes this invariant is enforced structurally: the executor parses each statement with the configured dialect path and checks its mutated-table set against the write's declared `tables:` allowlist (§10.3). A statement that mutates a table outside `tables:` is a CI failure under instrumentation and, in production where instrumentation is absent, fails closed — the executor conservatively invalidates every domain in the write's `touches` and records the violation, never silently dropping the unexpected table's invalidation.

For managed SQL handles, runtime verification is over a framework-owned statement artifact, not the
caller-owned JavaScript object. The first managed boundary MUST snapshot every accepted carrier
(`sql` template calls, Drizzle SQL, separated `{ text, values }`, prepared statements, trusted SQL)
into an immutable statement value containing the exact SQL text, parameters, dialect, and provenance
that the framework validates. Validation, table/function classification, diagnostics,
instrumentation, and driver execution MUST consume that same immutable artifact. A mutable object,
getter-backed carrier, proxy, or object identity reused across calls cannot present one statement to
the verifier and a different statement to the driver; Kovo must either reject it or make a one-time
snapshot before any check. Passing the original carrier to the driver after validating a snapshot is
a verification bug.

On the Postgres/PGlite managed path, the engine also enforces the dangerous write-scope cases below the framework declared-write wrapper. Owner and owner-via tables are granted to the writer role only with row-level security and `WITH CHECK` policies that bind writes to the current principal, so cross-owner writes and ownership reassignment are denied by the database. Unclassified/reference tables are not granted to the writer role at all, so attempts to mutate tables such as `verification` fail with engine permission denial even if an app smuggles a raw statement past the declared-write wrapper. The framework declared-write wrapper remains load-bearing for coverage and invalidation: over-declaring among writable owner/authz-policy tables can still produce stale or excessive invalidation behavior and is a KV406 contract violation, but it is not the confidentiality/integrity boundary for cross-owner or unclassified-table writes on this engine path. Full per-mutation engine roles remain outside v1.

Because instrumentation under-approximates (executed branches only), passing dev/test runs do **not** establish KV406 completeness; an unexercised raw-SQL arm is proven sound only by its statically-declared `tables:`/`touches`, which is why those declarations are KV406-`error` (not advisory) and an unexecuted such branch is KV405-`error` (§11.1). Read-side gets identical treatment (query loaders' SELECT/JOIN tables vs. derived read sets, **and observed result shapes vs. declared/inferred types — the runtime half of KV410**, so an opaque projection's schema claim is tested against what the database actually returns; an opaque projection that reads a table absent from its declared `reads:` set (§10.2) is a CI failure on the same `observed ⊆ static ∪ declared` invariant, but the static `reads:` declaration — not this dev/test-only observation — is what proves an unexercised branch sound). An observed read of an `exempt` table is the runtime half of **KV411** (§10.1) — the same CI failure whether the exempt read was statically visible or smuggled through raw SQL.

**Security-decision event completeness (normative).** The generated production runtime has one
closed, build-checked answerability denominator: the canonical `auth`, `authorization`,
`declassification`, `egress`, `storage`, `task`, and `replay` decision chokes. Every enrolled choke
MUST route both allow and deny outcomes through the single `securityEvent()` journal and emit
exactly these no-payload facts: the door, an outcome, a build-stable decision-site identity, an
honest principal scope including its epoch (or an explicit unresolved reason when the epoch or
principal is unavailable), and an opaque resource scope consisting only of its registered kind and
`global` or a framework-produced SHA-256 identity. Raw credentials, URLs, keys, rows, secret values,
task arguments, replay tokens, and other payload data MUST NOT enter the record.

The reviewed decision-site census and production markers are a closed emission-coverage recorder.
The root gate MUST fail when a door lacks exactly one enrolled site, a marker or site exists without
the other, an enrolled constructor disappears, a constructor bypasses `securityEvent()` (or the
journal-free core-to-server transport that immediately feeds it), a required fact becomes optional,
an allow/deny branch disappears, or an extra field is added. The core transport MUST NOT own a
second journal, buffer, export surface, or verdict; generated registration installs it before
authored app evaluation and the server journal remains the only event authority.

This completeness claim begins when the compiler-generated runtime-posture registry evaluates.
Production artifact emission MUST refuse a runtime entry that can evaluate the authored app before
that registration. Direct low-level library calls and unit calls made before registration are
explicitly outside the claim. Registration arms decision recording only after any configured
deployment journal is installed; after arming, an enrolled decision with no journal MUST fail closed
before proceeding. This is emission completeness for the seven named chokes, not a claim about
arbitrary app or third-party decisions, host compromise, fleet-wide delivery, or infinite retention.
The bounded journal's dropped count and every unresolved principal scope remain explicit
`unanswerable` outcomes for retrospective tooling; absence of a matching retained event is only
`not-observed`, never a no-impact proof.

**C9 sink-proof inventory (normative).** The verification surface MUST keep a single reviewed
inventory for the required boundary-crossing sinks named in §10.3 C9. Each row names: the sink, its
mechanism (`reconstruct`, `box`, or framework-`own`), the sole door, at least one lint/check/build
proof, at least one hostile-value test file or command, and the stable owner responsible for a gap.
The machine gate MUST compare its covered-family union with the complete source/sink census and
fail on a missing or unknown family, duplicate sink row, missing owner, absent root proof command,
or stale evidence path. The inventory is a proof index, not a runtime policy source: if a sink
exists without an inventory row, or a row has no hostile-value evidence, the verification surface
is incomplete even if the implementation happens to be sound.
It MUST also compare the exact runtime `securityOperationKinds` union with every row's
`operationKinds`, requiring one and only one C9 owner per finite compiler operation and rejecting
missing, unknown, or duplicate kinds. Terminal-effect rows name their real sink owner; the
`server.handler.root` and `server.helper.call` control rows name capability closure and remain
explicitly non-semantic until the latter receives a Phase 2C call summary. Component graph facts and `kovo explain component` render the
compiler-derived operation rows in stable order so a review can connect authored handlers to those
owners without reading generated files.
For engine-door claims the inventory row points at the engine-closure audit; for
wire/file/derived/task/log surfaces it points at the single framework-owned choke or box, never at a
proxy-only wrapper. The `data.derived.persistence` family is discharged by the storage-operation row
only when its proof evidence includes both KV452 provenance closure and runtime reconstruction of the
complete request-principal `ScopedKey` namespace.

Every source/sink census row MUST also declare one closed residency posture:
`none`, `db-owner`, `ledger`, `adapter-enumerable`, or `unerasable:<reason>`. A family that combines
multiple runtime sinks takes the least erasable posture of any covered sink; it cannot hide retained
task, replay, client, adapter, or external-recipient state behind a transient member. The C9 inventory
gate MUST fail on a missing or unknown posture, an empty or malformed `unerasable` reason, or an
`unerasable` count of zero. `kovo explain --sources-sinks`, `kovo check sources-sinks`, and the
versioned inventory artifact MUST publish each row's posture, and the text summaries MUST publish the
current `unerasable` count. This count is an honesty metric and erasure-work denominator, not a claim
that the enumerable postures already implement principal erasure.

**Finite provenance relation (normative proof boundary).** The compiler MUST publish the current
server/browser provenance vocabularies and the complete server member-projection relation as the
versioned, diffable `security-provenance-relation/v1.json` artifact. The current denominator is 43
server states (including explicit `derived-dataset`, derived query/upsert call, `governed-data`, and `scoped-key-call` states),
20 browser states, and the quotient member alphabet recorded in that artifact.
`check:provenance-closure` MUST fail when either operation
vocabulary gains a state without a relation row, when any table cell differs from the scanner, or
when least-fixpoint reachability finds an operation without its C9 door owner. Unknown future states
default to authority-bearing; `unknown-authority` closes under exactly the declared
`SecuritySemanticClosedReason` domain.

This decidability claim is deliberately narrow. Five `serverExpressionProvenance` arms are
compositional over child provenance values; identifier lookup is an environment leaf, the implicit
object-protocol check remains syntax-dependent, and the four fallthrough subtree searches (foreign
executable, governed data, unsafe wire data, and authority) are one named nondeterministic oracle
edge with outcomes `local`, `foreign-executable`, `governed-data`, `unsafe-wire-data`, and
`unknown-authority`. The table does not decide general JavaScript, dynamic properties, Proxy
behavior, imported executable semantics, or the browser classifier's syntax-dependent transfers.
The artifact publishes those exclusions, the four semantic-analysis resource bounds, and the
remaining extraction gaps beside the relation so a finite proof cannot be mistaken for a whole-
JavaScript soundness claim.

**Differential analyzer-soundness oracle (normative evidence boundary).** The server semantic
analyzer MUST consume the versioned `kovo-security-abstract-interpreter-census/v1` lattice,
resource bounds, and transfer vocabulary. `check:analyzer-soundness-oracle` MUST bind every census
transfer to a production marker and one seeded generator production, fail on an uncensused
production transfer, compile a canonical program that actually reaches every transfer marker, and
behavior-check every declared lattice element through the production transfer functions against
independent expected results. Intended closed and resource-edge programs MUST produce their exact
declared closed reason. The generated language is the finite
`kovo-security-analyzer-language/v1` grammar recorded beside the census; its declared JavaScript
exclusions and generation bounds are part of the claim, not implementation notes.

For every accepted generated program, an independent concrete interpreter predicts the reviewed
effect-door calls without consuming the analyzer's provenance relation. The compiler-emitted server
module is then executed with explicit framework-door stubs (never general `Proxy` observation), and
the oracle requires both concrete/emitted agreement and `observed ⊆ abstract-predicted`. A
counterexample MUST be minimized and persisted as `kovo.security-fuzz-counterexample/v1`; a scoped
canary that weakens the production `effect.invoke` transfer and a canary that deletes one effect
observation MUST fail. A persisted artifact MUST remain unconfirmed and MUST NOT claim
`replayVerified: true` or an unsafe verdict until a program-specific replay reloads the serialized
seed, minimized program, and canary (empty for an organic finding), recompiles that program, and
reproduces the exact disagreement. The fixed-seed
`analyzer-soundness` family runs in the nightly security campaign. Passing this falsification search
is evidence for only the declared finite language. It does not prove soundness for general
JavaScript, imported executable semantics, dynamic properties, browser provenance, asynchronous
scheduling, implicit protocols beyond the explicit object-literal close production, or behavior
beyond the published resource bounds.

**Async-context non-interference (normative evidence boundary).** Runtime scheduling evidence is
separate from the finite abstract-interpreter claim above. `check:async-context-confinement` MUST
derive every deployable authority cell from `kovo.async-context-confinement/v1`, reject a raw or
uncensused `AsyncLocalStorage` door, and mutation-check the exact lifecycle, close, isolated-root,
and verifier-observer revocation obligations. Its seeded runtime oracle MUST exercise distinct
principals concurrently through microtasks, stream backpressure, and thenable callbacks and observe
no cross-lifecycle cell value. This proves the shared runtime contract over those interleavings; it
does not mean the abstract interpreter models arbitrary event-loop scheduling. Only a separately
declared finite check→await→use production may enter the analyzer oracle's generated language.

### 11.4 The verification surface (the Keppo contract)

For a Kovo app, the following are checkable **without executing a browser**:

1. TypeScript static checking — all wiring (handlers, routes & links, forms, targets, bindings, IDREFs, transforms, guards).
2. `kovo check` — TypeScript plus a compiler/security graph derived from the current app source,
   followed by touch-graph consistency, optimistic exhaustiveness (KV310), update coverage (KV311),
   fixpoint + render-equivalence invariants, capability closure (KV448), and unguarded and unscoped
   audits.
3. Graph queries over `kovo explain` output — intent-level assertions ("every component displaying cart data is refreshed by cart/add") as set operations over printed, stable-format graphs, including each component's finite operation rows and the `--capabilities` root/door/package/closed provenance ledger from §6.6.
4. Property suite — prediction ⊆ eventual-truth generative tests over hand-written transforms and derivation soundness (commuting diagrams).
5. HTTP-level integration tests — mutations as request/response assertions against pglite (real Postgres semantics, in-memory, no container).

**Source-proof and deployment-proof split (normative).** Bare `kovo check` derives the app from
`./src/app.tsx`; `kovo check source [app-module]` selects another authored entry. Both regenerate
TypeScript and compiler/security facts from that current source before emitting the stable
`kovo-check/v1` result. They MUST NOT require, infer, or fabricate a deployment preset, emitted
artifact, least-privilege deployment posture, or §14 retention declaration, and they MUST NOT write
deploy artifacts. A graph-consuming compatibility form such as `kovo check coverage [graph.json]`
MUST fail non-zero when neither its explicit graph nor a conventional graph exists; absence is
never converted into an empty passing verifier input.

`kovo build` reruns the same current-source proof, then additionally verifies the selected preset,
artifact, least-privilege, and deploy-skew/retention obligations before promoting deploy output.
Those deployment obligations remain fail-closed, including KV417 under §14. A passing source check
therefore means “current authored source satisfies the source verifier,” not “this deployment is
ready.”

**Command result and diagnostic protocol (normative).** `kovo check`, `kovo build`,
`kovo explain`, `kovo doctor`, and `kovo verify` accept exactly
`--format human | json | github` and retain the exit classes declared by the semantic command AST:
success is 0, proof/build findings are 1, and invocation/configuration errors are 2. Every finding
crosses the framework-owned `kovo-diagnostic/v1` record before presentation. Code, severity, help,
and source range are producer-owned facts; renderers may escape or lay them out but may not parse
prose, consult a second severity table, or manufacture a location. JSON carries the diagnostic
envelope plus the command's existing versioned result protocol and exact result text. GitHub output
emits escaped workflow annotations from the same records and preserves the same result facts.
`kovo-check/v1` and `kovo-explain/v1` therefore remain byte-for-byte payloads inside the common
envelope rather than being silently replaced by an empty diagnostic array.

The semantic command AST is the sole source for argv parsing, semantic request types, root and
subcommand help, shell completion, and command-reference data. It includes aliases, argument kind,
enum, default, repeatability, category, examples, exit behavior, and result protocol. Programmatic
callers consume its discriminated request union and never an argv-shaped bag of flags.

**Versioned starter policy (normative).** The starter owns a compact declarative
`kovo.policy.json`; versioned CLI implementations own lifecycle allowlist validation, sound-subset
analysis, endpoint-posture orchestration, and fail-closed parallel scheduling. Generated apps do
not copy those algorithms. The default `kovo check` runs source proof and the applicable declared
policies. Deployment endpoint probes run through `kovo verify --artifact <dist>`, after a successful
build. App package scripts name Kovo, Vitest, and the package manager only; Vite Plus may remain a
framework/CI implementation tool but is not app-facing vocabulary.

**Daily coherence and copy-in commands (normative).** `kovo doctor [root]` reads bounded local
configuration and package facts without evaluating authored modules or contacting the network. It
checks the required Node and pnpm versions, duplicate Kovo installations, Kovo peer ranges,
config/preset selection, origin posture, database-role posture, migrations, deploy-skew retention,
writable framework paths, and cache freshness. Findings are finite producer-owned
`kovo-diagnostic/v1` records. `--fix` is restricted to framework-classified derived state: it may
create the project-owned `.kovo` directory or remove a stale real `.kovo/cache` directory after
containment and non-symlink checks; it does not rewrite security posture, credentials, package
versions, migrations, or authored source.

`kovo add --list` is the exact copy-in registry. A component typo suggestion is derived from that
same registry rather than a second alias table. `kovo add ... --dry-run` performs no filesystem or
process writes. `--install=never` copies source and reports the dependency follow-up without
editing the manifest; `--install=auto` stages component files, atomically updates the captured
manifest, runs the declared package manager, and promotes source only after install succeeds. An
install or promotion failure restores staged manifest/source edits and reports completed, planned,
and rolled-back work distinctly. `kovo test` is the app-facing, schema-owned one-shot Vitest
command; the CLI may delegate to its pinned Vite Plus implementation dependency, but generated
app scripts and help do not expose that implementation command.

**Safe cost-to-green rewrites (normative).** `kovo fix` accepts exactly one regular, non-symlink
app-authored `.tsx`/`.jsx` file inside the invocation root, excluding `.kovo`, `dist`, `generated`,
and `node_modules` trees. It MUST NOT synthesize a trust wrapper, justification, allowlist entry, or
other escape. A rewrite is available only through this closed compiler-owned recipe set:

- KV223 may remove one exact `data-bind` JSX attribute only when the genuine compiler reports that
  the attribute is redundant with its typed child expression. Because hand-authored lowered IR is
  already rejected by KV235 and can suppress compiler-owned escaping, this is a security-hardening
  rewrite, not a claim that the invalid input had accepted behavior to preserve.
- KV232 may remove one exact author-owned `role`, `aria-*`, or `data-state` override only when the
  rewritten compiler output has the exact same semantic behavior fingerprint.

The independent post-rewrite pass MUST prove that the candidate differs only by the approved typed
AST nodes, that every target obligation is absent, and that the complete genuine compiler analysis
is green before a write. Unknown diagnostics, mixed proof classes, overlapping edits, stale source,
an analyzer residue, or a changed behavior fingerprint where equality is required MUST fail closed
without returning candidate source. `--check` is read-only and non-zero when a safe rewrite is
available.

`kovo fix --cost-report` emits `kovo.cost-to-green/v1` over the versioned agent-authored corpus. Its
per-diagnostic metric is `safe AST-node edit atoms − escape argv atoms`, where deleting one typed
AST node costs one atom and `--allow-diagnostic CODE` costs two. A missing safe recipe has unbounded
safe cost. Every row where escape is cheaper, including an unbounded safe cost, MUST be reported as
a framework defect with a non-empty owner; the report exits non-zero while any such row exists. This
is an ergonomics and routing measurement, not evidence that an escape is safe or should be chosen.

**Deployment assume-guarantee contract (normative).** Every current `SECURITY.md` guarantee MUST
carry a machine-readable `antecedents` list. That list is derived, never independently authored:
the versioned `kovo.deployment-environment-doors/v1` registry binds each environment fact to the
exact framework door that consumes it, the door's source anchors, and the affected published or
normative conditional guarantee IDs. The security-guarantee gate MUST reject an unknown fact or
guarantee, a missing consumer anchor, a current guarantee absent from the registry, or any
`SECURITY.md` antecedent list that differs from the door-derived relation. A prose assumption or an
operator-authored success verdict is not evidence.

`kovo check env [deployment.json]` consumes `kovo.deployment-environment/v1`, probes only facts
observable from its pinned command-entry environment, and prints every remaining fact as a
`RETAINED` obligation with the exact guarantees it suspends. A canonical `KOVO_NODE_ORIGIN`
discharges only the zero-forwarded-hop proxy-chain fact; it does not authenticate the TLS
terminator. `KOVO_NODE_TRUSTED_PROXY=1` retains the edge-identity/hop obligation, a host preload
cannot be disproved from an absent `NODE_OPTIONS`, and database writers, shared-cache behavior,
registrable-domain occupancy, and TLS edge identity remain retained unless a future framework-owned
probe owns corresponding evidence. Contradicted, retained, or posture-withheld antecedents produce
a non-zero result. The command reports conditional status; it is not a deployment-integrity proof.

The composition domain has exactly three input shapes. `single-kovo` retains external occupancy
facts. `shared-registrable-domain` requires at least two unique canonical HTTPS Kovo origins under
one explicitly declared DNS suffix and contradicts `sole-registrable-domain-occupant`; the command
therefore withholds the CSRF principal-binding claim because another app can compete for browser
cookie namespace. This declaration is not a Public Suffix List proof. `foreign-host` is accepted
only with posture `mounted` and one canonical non-root mount path made of non-empty RFC 3986
unreserved segments, excluding `.` and `..`. Mounted posture unconditionally
withholds the host-owned CSRF, request-origin, and browser-state-cache claims; an author cannot turn
them back on with a flag or asserted verdict. All other composition/posture pairings fail input
validation.

**Authenticated advisory contract (normative).** `kovo.security.advisory/v1` is an exact,
closed record containing `id`, one of `low | moderate | high | critical`, one finite
`affectedRange`, `fixedIn`, `retracts[]`, `tcbChokes[]`, and `graphSchemaVersion`. The only range
grammar is `>=VERSION <VERSION` over strict SemVer, with an increasing exclusive upper bound and a
`fixedIn` version at or above it. Applicability predicates, package-name selectors, executable
expressions, host facts, and arbitrary extension fields are forbidden. `retracts[]` names exact
guarantee IDs in the normative `SECURITY.md` register; `tcbChokes[]` names exact current TCB entry
IDs. The canonical `kovo.security.advisory-feed/v1` record contains a positive monotone `epoch`, a
canonical `issuedAt`, `maxFeedAgeSeconds`, and an ID-sorted advisory array. The repository gate MUST
keep the feed schema exact, fresh within a maximum 90-day release window, and equal in advisory IDs
and retraction sets to the public guarantee register; unknown guarantee or TCB IDs fail the gate.
It MUST compare the checked-in feed to the first-parent feed: a lower epoch, or any canonical feed
change without an epoch increase, fails before release signing.

`kovo check advisories [graph.json]` MUST first read build-owned
`kovo.artifact.provenance/v1` from the graph and obtain every exact `@kovojs/*` package version plus
the graph schema version. When no graph path is explicit, exactly one conventional graph artifact
MUST exist; multiple candidates produce UNKNOWN instead of a precedence-based choice. The command
then fetches the feed over HTTPS (or reads an explicit in-root regular
file for an offline drill), computes its SHA-256 digest, and obtains an attestation by that digest.
The accepted bundle MUST pass Sigstore signature and Fulcio-chain verification, the GitHub Actions
OIDC issuer, the exact `.github/workflows/release.yml@refs/heads/main` certificate identity, and at
least one certificate-transparency and one transparency-log check. Kovo MUST independently parse
the verified DSSE payload and require exactly one matching feed digest plus the exact Kovo main
release-workflow repository, ref, and path. The release job producing this attestation has only
checkout/read and attestation OIDC authority: it performs no dependency installation, repository
script, build, or long-lived private-key operation. The Fulcio certificate identity is workflow-
wide rather than job-ID evidence. Default remote verification therefore also depends on the
digest-indexed Kovo repository attestation API, while the workflow grants `attestations: write` only
to the exact two-action attestation job; the package-publish job's npm OIDC authority cannot attach
repository attestations. An explicit local bundle is caller-supplied offline evidence and retains
only the cryptographically checked workflow-level identity.

After authentication, the command rejects a feed future-dated by more than five minutes, stale
beyond its own bounded `maxFeedAgeSeconds`, below the highest locally accepted epoch, or different
from a previously accepted digest at the same epoch. It persists only
`kovo.security.advisory-state/v1` (`highestEpoch`, `feedDigest`) by an atomic regular-file write
inside the invocation root. Concurrent processes MUST serialize on an exclusive sidecar lock,
re-read and compare state while holding that lock, fsync the state file, atomically rename it, and
fsync the parent directory where the platform exposes durable directory handles. A corrupt state
file, busy lock, symlink target, symlinked parent component, or unwritable state is failure, not
permission to forget rollback history. An advisory matches when
its graph schema equals the artifact schema and at least one exact Kovo package version lies in its
range. There are only three verdict classes:

- `AFFECTED`: print every matching advisory; exit 1 when any match is at or above the configured
  severity floor, otherwise exit 0 while retaining the AFFECTED label.
- `NOT-AFFECTED`: exit 0 only after the complete authentication, freshness, rollback, and matching
  sequence succeeds with no match.
- `UNKNOWN`: exit 2 for every inability to read the artifact, fetch, parse, authenticate, freshness-
  check, rollback-check, or persist state. UNKNOWN is never treated as an empty advisory set.

Every verdict MUST print a non-claim: this command detects authenticated advisories Kovo has
published for the artifact posture; even NOT-AFFECTED is not proof that the artifact has no
vulnerability or no impact outside the feed's version-and-schema scope.

`kovo explain --attest` is the deployment-review composition surface. It first recomputes the
reviewed graph's artifact subject and posture digest. If the graph contains a `trustedAssign`
capability, `--escape-reviews <reviews.json>` is mandatory. The detached file has schema
`kovo.escape-obligation-reviews/v1` and contains one exact signed envelope per graph-derived
`kovo.escape-obligation-review/v1` subject; missing, duplicate, surplus, malformed, stale-artifact,
replacement-key, wrong-anchor, and invalid-signature rows all fail closed. The same out-of-band
fingerprint MUST verify both the escape envelopes and the nonce-bound live deployment response.
The build also emits `.kovo/escape-census-review-subjects.json`, schema
`kovo.escape-census-review-subjects/v1`: one unsigned subject for every exact
`(artifactSubject, door, root)` counted by Metric E, with the complete canonically sorted set of
producer sites collapsed into that root. Each site is the exact record
`{ encoding: "utf16le", file, sourceHash, sourceLength, sliceHash, span: { start, end } }`.
`file` is a canonical invocation-root-relative POSIX path; lengths and spans are JavaScript UTF-16
code units; `sourceHash` hashes the full UTF-16LE source; and `sliceHash` hashes exactly
`source.slice(start, end)` as UTF-16LE. Absolute paths, backslashes, empty/`.`/`..` components,
control characters, and bidirectional controls are invalid. Every source-root door other than
`csrf:false` and `ctx.fetch` has exactly one site and its root is `file:start:end`; the two
relation-root doors retain every canonically sorted unique producer site. Metric E series v3
re-reads each site as a regular blob from the retained `codeSubjectSha` and rejects any source,
length, span, or slice mismatch before accepting review evidence. When this set is non-empty,
`--escape-census-reviews <reviews.json>` is mandatory. Its
`kovo.escape-census-reviews/v1` file MUST contain exactly one valid, domain-separated
`kovo.escape-census-review/v1` envelope per emitted subject under that same trust anchor. A missing,
duplicate, surplus, malformed, stale-artifact, wrong-anchor, or invalid-signature envelope fails the
whole set; partial signature coverage never reduces the unsigned count. Build, app code, and the
app-facing/internal execution graph expose subject construction and verification but no signer.
Success reports both verified review counts and explicitly states the non-claim: a signature records
only that the pinned key holder approved those exact bytes; it does not prove an obligation true,
identify an independent human, or prove executed-code/host integrity. The two build-emitted subject
files are unsigned reviewer inputs, not approval evidence.

The canonical v3 series MAY contain zero rounds. In that state both `series.comparability` and
`series.reviewAnchor` MUST be `null`: `PENDING 0/3` carries neither a source-comparability claim nor
review evidence, so initialization does not stamp the repository's source hashes. The first
authenticated append MUST create one validated document that adds the round and locks both the full
computed comparability record and the externally pinned review anchor. A partial or pre-seeded empty
state, or a nonempty state with either lock null or mismatched, fails closed. Later rounds MUST retain
both locks unchanged. Every nonempty series MUST be verified against an exact external policy
artifact that pins the already-existing `kovo-runtime-posture-attestation/v1` fingerprint.
`node scripts/metric-e-rounds-gate.mjs --init` is the sole initializer and MUST refuse to overwrite
a nonempty or non-v3 ledger.
The verifier MUST derive authority from that supplied policy, never from `series.reviewAnchor`, a
round, or a caller-provided fingerprint; coherently replacing repository evidence and its embedded
anchor therefore still fails against the external pin. In addition to the exact root set, each
round retains one detached aggregate `kovo.metric-e-independent-review/v3` envelope under the same
Ed25519 key. Its canonical payload binds the exact code subject, round number and calendar date,
report and ceiling digests, signed root-set path/digest/anchor, reviewer identity and UTC review
time, explicit `accept` verdict, and closed assertions that build, review, and signing-key custody
were outside the build/coding-agent environment. Missing, duplicate/reused, malformed, surplus,
stale-subject, replacement-key, wrong-anchor, and invalid-signature aggregate evidence fails closed.
Reusing an identical aggregate or signed root-set digest under another path or round is not a new
independent review and MUST fail closed.
Only then are verified root signatures counted as reviewed and subtracted from unsigned escapes.
The signature authenticates the pinned key holder and those exact bytes; it does not prove the
asserted custody or human independence true, identify the reviewer, or establish review correctness.

`kovo explain --endpoints` is the stable machine-ingress audit. Its diffable table lists every declared endpoint and webhook, every `mutation()`, plus every route that returns `respond.file()`/`respond.stream()`: source-derived registry identity where applicable, method, path, mount mode, auth scheme (`session+guard`, `verifier:<resolved scheme>`, `custom:<name>`, or `none:<justification>`), CSRF/effect posture, and for webhooks the write→domain chain. Endpoint posture is `safe:read-only` for the closed `GET`/`HEAD`/`OPTIONS` set from §9.1, `checked` when an unsafe method receives the default synchronizer-token check, or `exempt:<justification>` when an unsafe endpoint explicitly opts out. Mutation posture remains `checked` or `exempt:<justification>`; a `csrf: false` mutation appears here with the latter posture, and KV418 (§6.6) guarantees it references no ambient session. The pre-dispatch coarse limiter posture (§9.5) is enrolled and printed here too. The command is snapshot-locked with the rest of P8 output so security review can answer "what can reach this app, and what can it touch?" without executing a browser.

Browser tests are a first-class part of the **framework's** own suite: morph runs on every mutation response, and its survival contract (focus, caret, scroll, transitions) plus L0 platform behaviors are irreducibly browser-bound. The reconciliation suite splits accordingly: a browser-free structural property suite (`morph(a, b) ≡ b` with keyed-node identity preserved — runs in jsdom-class DOM), and a named browser suite for the survival contract. The claim is bounded: **application wiring is proof-carrying**, so apps need few or no browser tests of their own — most SPA testing exists to compensate for unverifiable wiring, and Kovo removes that category, not testing itself.

---
