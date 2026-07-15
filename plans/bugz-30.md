# Security Bug Ledger (`bugz-30`)

**Date:** 2026-07-14

**Scope:** Distinct security findings uncovered after the `bugz-29` checkpoint, through the
`bc353d331` integration checkpoint. Rankings prioritize practical impact, then exploitability.
`SPEC.md` §2, §5.2, §6.6, and §10.3 remain normative: authored code shares framework realms,
structural markers are not proof, security facts must be snapshotted before authored evaluation,
and uncertain boundary behavior fails closed. Open `bugz-29` items H25-H27 remain owned by that
ledger and are not renumbered here.

## Severity summary

| Severity | Families |  Items |
| -------- | -------: | -----: |
| Critical |        3 |  C1-C3 |
| High     |        9 |  H1-H9 |
| Medium   |       10 | M1-M10 |

## Critical

- [x] **C1 - Authored build config and structurally copied presets could execute before the build
      security boundary or replace framework emit/inspect authority.**
  - Config imports could poison compiler globals before preflight, mutate deploy-preset selection,
    or execute relative config modules; copied public preset methods could later be replaced by app
    code and still be accepted as framework authority.
  - **Evidence:** `0f3ba4acf`, `473e29333`, and `22a575774` preflight the closed config graph before
    evaluation and replace structural presets with module-private capabilities. The exact
    `build-export-security-order.test.ts` config/relative-config, deploy-environment, and structural
    preset regressions refuse KV424 before app/config side effects. SPEC §2, §5.2, §6.6.

- [x] **C2 - Compiler-generated browser modules could evaluate arbitrary imports, executable
      callables, or captured server values.**
  - Generated handlers admitted Node/package/relative/dynamic imports and cross-module values;
    module evaluation itself could execute authority or inline credentials even when the captured
    value was described as public.
  - **Evidence:** `6d087f96b` and `66293e776` require an exact generated registry identity for
    executable imports and withhold unproved value captures with KV201/KV437. The
    `client-handler-import-policy.test.ts` and `client-secret-capture.test.ts` adversarial matrices,
    generated registry integrity gate, and security-classifier corpus are green. SPEC §5.2, §6.6.

- [x] **C3 - Generated database bootstrap values could retain or reconstruct privileged Postgres
      authority across authored modules.**
  - Structural runtime options, provisioning closures, principal factories, and helper-returned DB
    chains let generated code keep repeatable system/owner authority or evade the intended closed
    provider grammar after bootstrap.
  - **Evidence:** `de6cbf8d7`, `fefbd70af`, `f6cc19876`, and `95f52b343` replace the generated
    options/provisioning surface with opaque environment-owned providers and close direct, helper,
    arbitrary-chain, and erased-TypeScript provenance. The exact Reader/receiver security matrices,
    generated Postgres/SQLite scaffold typechecks, and capability census are green. SPEC §2, §5.2,
    §6.6, §10.3.

## High

- [x] **H1 - Late SQLite authorizer and native-driver prototype poisoning could bypass declared
      reads/writes or substitute the database execution path.**
  - Authored foreign-key/config callbacks could replace `node:sqlite` authorizer controls or
    `better-sqlite3` database/statement/transaction methods before first use, including the path
    that enforces secret-column origin and rejects undeclared cascade writes.
  - **Evidence:** `98c217edd`, `6902f8915`, and `8409f8053` capture finite authorizer/native controls
    at framework-module evaluation and expose only frozen finite client/statement façades. The
    `sqlite.test.ts` authorizer, driver-order, `$client`, statement, transaction, raw-read, and
    foreign-key cascade regressions record zero poison hits. SPEC §2, §6.6, §10.3.

- [x] **H2 - Root-based framework trust accepted attacker-selected or post-snapshot source as
      genuine Kovo code.**
  - Variants included host-supplied peers/optional dependencies, undeclared nested packages,
    symlinked descendants, root retarget/replacement, post-bootstrap files, changed packed chunks
    or text assets, and hardlink mutation. A false framework identity could inherit classifier and
    Vite trust reserved for package-owned source.
  - **Evidence:** `b14085297` and `89044d3b4` replace root trust with bounded, byte-exact,
    declared-dependency file snapshots and verify exact Vite transform input. The 17-case
    `build-export-framework-sources.test.ts` matrix covers every reproduced carrier plus genuine
    workspace, packed chunk, and text-asset controls. SPEC §2, §5.2, §6.6.

- [x] **H3 - Generated Postgres/SQLite auth, environment, and database-provider wiring retains raw
      authority across authored modules.**
  - Starter auth modules still read mutable `process.env` for signing material/base URL, the
    Postgres system capability remains publicly consumable, and generated auth/request providers
    have not yet reached one opaque, parity-tested construction path. This is generated-runtime
    construction authority, distinct from `bugz-29` H27's raw environment-to-public-wire leak.
  - **Evidence:** `7da41bc60`, `311e7748d`, `1334cb683`, `1647cd351`, `e481eedcf`,
    `6b947be23`, `f6cc19876`, and `95f52b343` now hide both database dialects behind opaque providers,
    move auth/CSRF inputs to environment-owned constructors, and remove raw environment reads and
    repeatable seed/system-DB exports from generated production source. The exact Postgres contact
    artifact and `index.build.prod-artifact.contacts.test.ts` SQLite add-contact artifact both build,
    boot, authenticate, mutate, and persist through opaque providers; classifier corpus, capability
    census, API surface, and packed auth parity are green. SPEC §2, §6.6, §10.3.

- [x] **H4 - Broad retained-config exceptions treated aliased or replaceable DB/client-module
      carriers as framework-owned facts.**
  - Computed/aliased/poisoned `request.db` chains, laundered `serverValue` inputs, and mutable or
    handler-populated client-module registries could evade KV424 while carrying raw database,
    request, environment, or generated-code authority.
  - **Evidence:** `91e0e854e`, `ce6fb6c6c`, `d3d8c7e30`, and `a07bc6296` accept only exact direct
    request DB/serverValue and static generated-registry grammars. The corresponding
    `trust-escapes-static.test.ts` alias, prototype, helper, computed-call, request/env-carrier, and
    registry mutation matrices fail closed. SPEC §5.2, §6.6, §10.3.

- [x] **H5 - The SQLite security runtime and temporary store could create filesystem-backed
      database material.**
  - The main runtime/authorizer clone used temporary files, and SQLite's compile-time
    `TEMP_STORE=1` permitted sort/temp pages to spill to disk despite an in-memory main database.
  - **Evidence:** `310d1c007` moves both databases to `:memory:` and `7db64f424` pins
    `PRAGMA temp_store=MEMORY`; `sqlite.test.ts` proves an empty main filename and
    `temp_store = 2`, while the server filesystem-boundary gate remains green. SPEC §6.6, §10.3.

- [x] **H6 - Better Auth could initialize after authored same-realm poisoning and retain deferred
      secret-processing authority outside the bootstrap lock.**
  - The package graph did not require bootstrap-first evaluation, and deferred crypto, password,
    URL, RegExp, and environment decisions could first resolve after authored modules had run.
  - **Evidence:** `7a0489570`, `94021384b`, and `525454a5c` lock the Better Auth graph before app
    evaluation, pin its deferred crypto/password controls, and make absent or late bootstrap fail
    closed. The exact shared-realm fixture, packed bootstrap suite, and complete Better Auth package
    are 7/7 and 185/185 green. SPEC §2, §6.6, §10.3.

- [x] **H7 - A late-mutated SQLite table identity could authorize one declared table while DML
      executed against another.**
  - After runtime construction, changing an enrolled table's Drizzle name or column graph kept the
    original identity-based allowlist decision but redirected the reconstructed SQL table to a
    victim relation.
  - **Evidence:** `b525e890c` resolves private provenance only to a construction-time frozen DML
    table/column graph. The late Name/Schema/BaseName/alias/Columns/column mutation matrix keeps every
    victim empty; counterfeit, Proxy, and cross-copy identities fail closed. SPEC §6.6 C9/C15,
    §10.3, §11.2.

- [x] **H8 - SQLite raw reads could fail open during column-origin preparation and fail closed for
      valid execution, while dialect-less policies broadened SQL purity.**
  - The public SQLite runtime reconstructed a plain carrier that Drizzle could not execute, so a
    declared `rawRead` returned HTTP 500. Worse, confidentiality inspection prepared SQL on the
    live connection before the managed read classifier: `PRAGMA foreign_keys = OFF` changed
    connection state even though the later KV433 choke rejected it. Parameterized tagged SQL used
    Postgres `$N` binds, and omitted policy dialects admitted the union of SQLite/Postgres pure
    functions.
  - **Evidence:** the runtime now classifies before live `prepare()`, executes only through pinned
    native controls whose statement is both `reader` and `readonly`, renders SQLite recipe binds as
    `?`, and requires an exact policy dialect. `sqlite.test.ts` proves parameterized reads plus
    `INSERT ... RETURNING`, mutating PRAGMA, and `PRAGMA optimize` rejection with unchanged rows,
    foreign-key posture, and schema stats; the Phase 5.1 served-artifact acceptance and DEC-J
    sole-door gate pass. SPEC §6.6, §10.3, §11.2.

- [x] **H9 - The relational-query-builder KV424 grammar could bind `db.query.<name>` to an
      unrelated same-name table instead of the app's runtime schema.**
  - A decoy imported or local `pgTable` declaration could satisfy the new `findMany`/`findFirst`
    table proof even though the runtime DB's property resolved through a different schema object.
    That let an opaque relational read inherit trusted DB-row provenance from attacker-selected
    columns.
  - **Evidence:** `requestExactPostgresRuntimeSchemaSourceFileForProject` now resolves and memoizes
    the one exact `createPostgresAppRuntimeDb` -> `postgresAppRuntimeOptions` ->
    `postgresSchemaModule(namespace)` chain, and relational reads accept only the pristine export
    from that exact namespace source. The canonical-schema positive plus imported/local decoy
    negatives pass in the 277-case `trust-escapes-static.test.ts` suite; the exact generated
    Postgres artifact passes KV424 and runtime acceptance. SPEC §6.6, §9.4, §10.3.

## Medium

- [x] **M1 - Reader provenance recovery false-positived ordinary reads and introduced an unbounded
      import scan.**
  - Source-resolved `Reader<Db>` types lost exact package provenance, so five ordinary
    `db.select()` reads were classified as retained project receivers; the first repair then scanned
    imports for unrelated types and pushed a registry build beyond 12 minutes.
  - **Evidence:** `9dcf28a62` requires both the exact `@kovojs/server` import/re-export symbol and
    source type identity, while `cef328a41` fast-rejects non-`Reader` symbols before import lookup.
    `index.identity-resolver.test.ts`, the 109 query-shape/receiver tests, the VP
    `typecheck-examples` task, and the 28.12-second StackOverflow registry build are green. SPEC
    §5.2, §6.6.

- [x] **M2 - Reader and generated DB provenance lost exact identity through type-only imports,
      re-exports, helpers, and arbitrary receiver chains.**
  - The classifier could reject genuine `Reader<Db>` values, crash on namespace forms, or accept a
    helper-laundered retained DB receiver without the exact framework import identity.
  - **Evidence:** `f6cc19876` exact-matches named/type-only Reader imports and re-exports while
    closing helper and arbitrary-chain laundering. The receiver suite is 41/41 and the independent
    identity/global matrix is 61/61 green. SPEC §5.2, §6.6.

- [x] **M3 - Locked-global mutation escaped through syntax variants and erased TypeScript
      declarations.**
  - `globalThis`/`Reflect`/prototype mutations, delete/pattern/loop writes, and ambient or type-only
    declarations could hide a write or make the classifier trust an authored replacement.
  - **Evidence:** `f6cc19876` closes the full global-mutation and erased-declaration grammar. The
    trust-classifier suite is 267/267 and its 400/1000-root scale subset remains within the recorded
    low-second bounds. SPEC §2, §5.2, §6.6.

- [x] **M4 - Nested lifecycle arrays retained mutable second-snapshot ownership.**
  - A provider-derived array could be snapshotted once but retain nested app-owned values when a
    later lifecycle layer rewrapped it, allowing post-guard mutation of principal-facing data.
  - **Evidence:** `6ebedbf4e` preserves deep-snapshot ownership across lifecycle layering; the
    request-proxy and packed bootstrap regressions are green. SPEC §6.6 C9, §9.5.

- [x] **M5 - Opaque auth signing and pinned request carriers disagreed at framework-owned sinks.**
  - Better Auth rejected Kovo's genuine lifecycle Proxy; the first bridge could have re-minted raw,
    accessor, or foreign-Proxy values as CSRF authority. Separately, the narrow CSRF signer denied
    the framework's fixed post-login session fingerprint and turned authenticated documents into
    500 responses.
  - **Evidence:** `cdcb10c38`, `6ecd7c82e`, `7da4329e0`, and `a4164f216` preserve exact carrier
    provenance, reject re-minting and second-copy identities, keep generic session-fingerprint
    signing denied, and add one package-private fixed-purpose document sink. The independent packed
    adversarial matrix reports zero blockers; focused server/auth suites are green. SPEC §6.6 C9,
    §9.3, §9.5.

- [x] **M6 - The classifier-corpus gate could parse an earlier set reference as the reviewed
      declaration.**
  - A use of `REQUEST_SAFE_GLOBAL_*` before its `const` declaration redirected the source extractor
    into an unrelated later array. That produced false failures here and could also hide an
    over-broad classifier set when the unrelated array happened to remain within the lock inventory.
  - **Evidence:** `ce78a467b` binds extraction to the exact exported/local `const` declaration and
    adds a deceptive earlier-use regression. The gate unit suite is 7/7 and all eight security
    corpora pass. SPEC §5.2, §6.6.

- [x] **M7 - Sealing the SQLite driver disconnected async mutation transactions and reconstructed
      table identity.**
  - The finite `$client` facade withheld the native controls required by Kovo's private async
    transaction bridge, so every async app mutation fell into the synchronous adapter and failed
    before its handler started. After restoring that private association, the nested SQL membrane
    also lost the reconstructed table's exact provenance and falsely rejected its declared write.
  - **Evidence:** `6c51444ce` registers native transaction controls in a private WeakMap without
    exposing `exec`/`inTransaction`, preserves canonical table-source edges, and adds an actual
    `createSqliteAppRuntime` async mutation/commit regression. The integrated
    SQLite/mutation/continuation/managed-DB matrix is 265/265 green, and the exact generated SQLite
    add-contact artifact passes build integrity, boot, sign-in, mutation, and persisted rerender.
    SPEC §6.6 C9, §10.3, §11.2.

- [x] **M8 - A nested SQLite transaction opener self-queued behind its own mutation frame and
      transaction-scoped authority remained callable after settlement.**
  - Cast-based access to the handler's type-hidden `.transaction()` hung indefinitely, and retained
    DB methods/builders could outlive the callback that owned their transaction.
  - **Evidence:** `bc353d331` attaches a private scope token to handler DB descendants, rejects
    nested openers synchronously with KV433, revokes captured DB/method/builder authority, and queues
    unrelated roots by native-client identity. The 265-test matrix and independent five-case scope
    audit are zero-blocker. SPEC §10.3, §11.2.

- [x] **M9 - Managed DML on foreign-key-bearing SQLite tables failed before SQL execution.**
  - The SQL membrane reconstructed schema-only FK/extra-config entities as DML authority, then
    rejected the native Drizzle ForeignKey carrier for insert, update, and delete alike.
  - **Evidence:** `69f5dd297` omits index/FK/check/extra-config carriers from the finite DML graph;
    one real runtime regression executes insert, update, and delete on an FK-bearing child table.
    The integrated 265-test matrix and server dist/DTS build are green. SPEC §6.6 C9, §10.3.

- [x] **M10 - Composed webhooks rejected Kovo's own opaque managed DB provider before the handler
      ran.**
  - App dispatch correctly forwarded the framework-minted Postgres provider token, but
    `runWebhook()` accepted only callback providers and collapsed the token validation failure into
    an HTTP 500. Database-backed webhook mutations therefore could not use the framework's stronger
    opaque provider posture.
  - **Evidence:** webhook option snapshotting now accepts only a callback or the private-WeakMap
    authenticated framework provider and still rejects structural object forgeries. The focused
    app-dispatch regression proves a composed system mutation receives the managed DB; the exact
    generated Postgres artifact proves an `actAs` task write, webhook write, and duplicate replay
    produce exactly two rows. SPEC §6.6, §9.1, §10.3.

## Closure gates

- [x] Close H3 with the final generated Postgres/SQLite auth/env/provider commits, then prove exact
      generated production builds, a production-template raw-environment grep, KV424/classifier
      corpus results, capability census, API surface, and packed-runtime parity.
- [x] Resolve `bugz-29` H25-H27 in `plans/bugz-29.md`; the exact-head real-build process-sink
      matrix is 28/28 green.
- [ ] Run the final exact-head static, paranoid, package, root-test, browser, integration, starter,
      `kovo check`, VP, API, publish, pack-security snapshot, performance, and diff gates.
- [ ] Obtain explicit zero-new-finding conclusions on the final integrated head for runtime,
      browser/core, compiler/build, starter/package, and supply-chain scopes.
- [ ] Push the verified exact head to `origin/main`, then monitor CI, GitHub Pages, and the race gate
      to terminal green; fix and repush any exact-head failure.
