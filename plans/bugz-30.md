# Security Bug Ledger (`bugz-30`)

**Date:** 2026-07-14

**Scope:** Distinct security findings uncovered after the `bugz-29` checkpoint, through
`8409f8053`. Rankings prioritize practical impact, then exploitability. `SPEC.md` §2, §5.2,
§6.6, and §10.3 remain normative: authored code shares framework realms, structural markers are
not proof, security facts must be snapshotted before authored evaluation, and uncertain boundary
behavior fails closed. Open `bugz-29` items H25-H27 remain owned by that ledger and are not
renumbered here.

## Severity summary

| Severity | Families | Items |
| -------- | -------: | ----: |
| Critical |        2 | C1-C2 |
| High     |        5 | H1-H5 |
| Medium   |        1 |    M1 |

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

- [ ] **H3 - Generated Postgres/SQLite auth, environment, and database-provider wiring retains raw
      authority across authored modules.**
  - Starter auth modules still read mutable `process.env` for signing material/base URL, the
    Postgres system capability remains publicly consumable, and generated auth/request providers
    have not yet reached one opaque, parity-tested construction path. This is generated-runtime
    construction authority, distinct from `bugz-29` H27's raw environment-to-public-wire leak.
  - **Partial evidence:** `7da41bc60` hides the generated Postgres request DB provider and
    `311e7748d` establishes the SQLite opaque provider/system capability. Closure still requires
    environment-owned auth constructors, an internal-only Postgres system capability, exact KV424
    grammar, Postgres/SQLite production builds, and capability-census/API parity. SPEC §2, §6.6,
    §10.3.

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

## Medium

- [x] **M1 - Reader provenance recovery false-positived ordinary reads and introduced an unbounded
      import scan.**
  - Source-resolved `Reader<Db>` types lost exact package provenance, so five ordinary
    `db.select()` reads were classified as retained project receivers; the first repair then scanned
    imports for unrelated types and pushed a registry build beyond 12 minutes.
  - **Evidence:** `9dcf28a62` requires both the exact `@kovojs/server` import/re-export symbol and
    source type identity, while `cef328a41` fast-rejects non-`Reader` symbols before import lookup.
    `index.identity-resolver.test.ts`, the 109 query-shape/receiver tests, `vp run
    typecheck-examples`, and the 28.12-second StackOverflow registry build are green. SPEC §5.2,
    §6.6.

## Closure gates

- [ ] Close H3 with the final generated Postgres/SQLite auth/env/provider commits, then prove exact
      generated production builds, a production-template raw-environment grep, KV424/classifier
      corpus results, capability census, API surface, and packed-runtime parity.
- [ ] Resolve `bugz-29` H25-H27 in `plans/bugz-29.md`; do not claim their closure through this
      ledger.
- [ ] Run the final exact-head static, paranoid, package, root-test, browser, integration, starter,
      `kovo check`, VP, API, publish, pack-security snapshot, performance, and diff gates.
- [ ] Obtain explicit zero-new-finding conclusions on the final integrated head for runtime,
      browser/core, compiler/build, starter/package, and supply-chain scopes.
- [ ] Push the verified exact head to `origin/main`, then monitor CI, GitHub Pages, and the race gate
      to terminal green; fix and repush any exact-head failure.
