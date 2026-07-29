# World-class Kovo developer experience and API

Status: **active roadmap**

Created: 2026-07-27. Merged 2026-07-28 with the independently reviewed alternative
(`plans/worldclass-devex-claude.md`, now retired into this file): same destination and evidence,
restructured into decision-gated tracks with an atomic scorecard. Merge notes are at the end.

Baseline: `8fd820716600`. The headline baseline numbers were independently re-verified at this
commit (532 `toRemove` leaks with 356 in `@kovojs/server`; 524/149/17/38/11 root exports for
server/core/browser-client/better-auth/verify; exactly 1,413 lines across exactly 3 starter
scripts; help exit 1; vacuous check `OK`; `dist/.kovo` graph persistence; dead
`committedSecretWaiver`; 55 placeholder docs reported as success), except the reconciliation items
in Track 0.

Normative anchors: `SPEC.md` §1.1-§1.3, §2, §4-§6, §9-§12, and §14. In
particular, this plan may reduce ceremony around proof, but may not replace AST/provenance
enforcement with types, make a fail-closed check optional, hide the wire, introduce global
knowledge at local authoring sites, or make generated/lowered code app-authored. Track 4
enumerates the specific owning SPEC sections the app-contract change must edit.

## Executive decision

Kovo should make its proof model feel like a productivity feature rather than a framework tax:
the safe path should be the shortest path, TypeScript should infer app context once, one command
should derive one current graph from source, and the proof should reappear on demand as an
actionable explanation, editor diagnostic, or devtool trace.

This requires a deliberate pre-1.0 API cut. Kovo should retain its deep security, data, wire,
testing, and component capabilities, but stop exposing internal assembly shapes, generated
registries, protocol records, and inference helpers as ordinary app vocabulary. Do not add
compatibility barrels or dual behavior. Ship a codemod and a precise migration report, then remove
the old shape in one technical-preview minor (decision gate D2 below fixes the release model).

The two highest-risk bets — the app-contract authoring shape and the breaking release — are
explicit decision gates (D1, D2) with pre-registered pass criteria and written fallbacks, so a
failed bet re-scopes one tier of the scorecard instead of stalling the plan.

The product promise after this plan is:

> Scaffold, run, understand, change, prove, and deploy a secure Kovo application without learning
> framework internals; inspect every derived fact without guessing what the framework did.

## Release scorecard

The scorecard is the acceptance contract, not an aspirational dashboard: atomic gates, one proving
command or artifact each. Tier 1 gates are independent of the new app contract and ship
continuously; tier 2 gates are renegotiated (not silently dropped) only if both D1 spike arms fail
and the double-failure fallback is selected — adopting Arm B keeps tier 2 as written. Numeric
budgets marked _(prov.)_ are provisional until Track 2 records packed-tarball
baselines on the named runner and ratifies each number with a recorded derivation in
`devex-budgets.json`; performance gates run on a named runner and pinned packed-tarball fixtures so
hardware and workspace linking do not make the numbers meaningless.

Current scorecard status (2026-07-29): per-PR DevEx gates use 65/65 budgeted runner-minutes and
nightly gates use 290/300; every pull request publishes bounded public-surface, docs-freshness, and
speed evidence. Runner-bound performance gates remain non-binding until an accepted
`ubuntu-24.04` N≥5 baseline and its reviewed noise-derived thresholds are committed.

| ID  | Tier | Gate                                                                                                                                                                                              | Proof                                                |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| G1  | 1    | Both packed scaffold variants pass create→install→dev→login→CRUD→test→check→build with only creator-emitted instructions                                                                          | golden-journey runner exit 0                         |
| G2  | 1    | Ready line ≤15s cold / 5s warm _(prov.)_; URL, mode, DB posture, devtool link always printed                                                                                                      | journey-runner timing record                         |
| G3  | 1    | Edit-to-diagnostic p95 ≤1s; edit-to-served-result p95 ≤500ms _(prov.)_                                                                                                                            | `scripts/devex-benchmark.mjs`                        |
| G4  | 1    | `kovo check` ≤30s cold / 10s warm / 2s one-file _(prov.)_, with a phase census proving no diagnostic-producing phase was dropped                                                                  | benchmark + phase-census test                        |
| G5  | 1    | All help/version paths exit 0 on stdout; usage/config mistakes exit 2; proof/build findings exit 1                                                                                                | CLI exit-code contract test                          |
| G6  | 1    | One semantic command AST derives argv parsing, help, completion, and command reference                                                                                                            | schema-derivation snapshot tests                     |
| G7  | 1    | Missing, stale, partial, or failed-build graph input is an error, never `OK`; built artifacts require explicit `--artifact`                                                                       | adversarial graph-input suite                        |
| G8  | 1    | Builds are transactional; a failed build leaves the last good `dist` untouched and no artifacts under `dist/.kovo`                                                                                | staging-promotion test                               |
| G9  | 1    | First-run failures (7 classes) and the top-20 authoring diagnostics each render one safe cause, one source/config anchor, one executable next step                                                | diagnostic empathy suite                             |
| G10 | 1    | Packed starter renders a styled, WCAG-checked UI via public component/style API                                                                                                                   | journey-runner screenshot + a11y check               |
| G11 | 1    | create→build→deploy→public-URL-200 journey on one blessed Node host                                                                                                                               | packed deploy journey                                |
| G12 | 1    | An agent completes scaffold→edit→check→fix using only JSON diagnostics and local docs, offline                                                                                                    | agent-journey fixture                                |
| G13 | 1    | Docs/API references carry source digests; every sample compiles from packed dist or has a reviewed skip class; `update-docs` never reports success for placeholders                               | docs gates in CI                                     |
| G14 | 1    | Concept inventory (framework imports + config keys + prompts + env edits before first authenticated CRUD) recorded and ratcheting down                                                            | journey-runner concept census                        |
| G15 | 1    | Devtool auto-mounts at `/__kovo` in dev, linked from the ready line; provably absent from production and static-export artifacts                                                                  | mount test + artifact census                         |
| G16 | 1    | Cold `pnpm create` install time and install size within ratified budgets _(prov.)_                                                                                                                | journey runner + size report                         |
| G17 | 1    | Recursive-publicness ratchet descends monotonically from 532 to zero; no fix accepted by widening the public surface without a ledger `keep` row                                                  | api-surface gate + ledger cross-check                |
| G18 | 1    | Zero unapproved `any` in app-public declarations (AST gate, reviewed exception file with owner + expiry)                                                                                          | packed-declaration gate                              |
| G19 | 1    | Public style values opaque; literal/cast forgery fails runtime acceptance; extracted CSS byte-equivalent                                                                                          | style batch packed tests                             |
| G20 | 1    | One narrow custom-shell installer; manual store/root/transport assembly gone                                                                                                                      | browser/client batch packed tests                    |
| G21 | 1    | `kovo-verify` help/exit/JSON contract stable; tarball has no Kovo runtime dependency                                                                                                              | verifier acceptance suite                            |
| G22 | 2    | Server root ≤120 names, core root ≤60, each retained root name backed by a decision-ledger row with compiling packed example + contract test                                                      | ledger gate — the ledger, not the count, is the gate |
| G23 | 2    | Starter and one advanced example declare app context once: no manual `MutationContext`/`QueryLoadContext`/`Reader`/`ComponentRenderSlots`, registry augmentation, explicit app generics, or casts | grep-clean + typecheck of starter/example            |
| G24 | 2    | Starter tests use the public inferred harness with a digest-verified proof graph; no internal mocks                                                                                               | packed starter test run                              |

Counts are discovery signals, not goals by themselves. UI components and icon glyphs are naturally
wide generated families. The root budgets exist to protect the daily path; a symbol may move to a
focused task subpath only when that subpath has a real user story, example, and owner. A `/types`
junk drawer or moving every name without reducing concepts does not satisfy G22 — which is why the
decision ledger, not the raw count, is its gate.

## Evidence and diagnosis

The baseline combined a manifest-derived public API inventory, consumer and example searches,
generated-reference comparison, `check:api-surface`, source inspection, command help probes, and
fresh scaffold dogfooding. The throwaway apps were tested through local package links, so published
tarball acceptance remains a required Track 2 fixture; link-only TypeScript and dependency-install
failures were excluded from product findings.

The corrected Track 2 inventory analyzes 102 TypeScript public entrypoints and finds 1,849 exported
declarations. Separately, `public-packages.json` declares 1,839 public subpaths because 1,737 are
generated icon glyph paths. Those are different units and are now reported independently. (The
same unit discipline applies to `@kovojs/server`: 524 root export names vs 554 exported declarations
across all public subpaths — both correct, different units.) The consumer scan excludes nested
dependencies and generated/dist/cache/packed/throwaway trees, then reports 90 authored-example,
128 authored-doc, 154 package-internal, 18 generated-emit, 4 conformance, and 456 test files as
separate classes. The earlier 1,212 zero-consumer and 583 example-consumer figures remain excluded
because they came from the contaminated scanner.

### Public-surface findings

| Surface                  | Finding                                                                                                                                                                                                                                                                                                                           | Decision direction                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kovojs/server`         | 554 exported declarations across public paths; 356 of this package's recursive leaks. `KovoApp` exposes framework assembly, `createApp` has five generics, and app context is repeated throughout the starter.                                                                                                                    | Make the app value opaque, infer one app contract, keep daily declarations at root, and move advanced task families with their supporting types to focused subpaths.  |
| `@kovojs/core`           | 149 root exports mix component/form/navigation authoring with security, storage, webhooks, diagnostics, and inference plumbing. A conservative audit found 39 definite removals and 30 decisions that still need a user story.                                                                                                    | Root becomes component/form/navigation essentials; use `/security`, `/storage`, `/webhooks`, and `/diagnostics`; internalize inferred helper graphs.                  |
| `@kovojs/browser/client` | 17 exports expose manual query-store/root/transport assembly; the audit found no unconditional keep in the current shape.                                                                                                                                                                                                         | Replace with one narrow installer for custom shells and keep generated bootstrap as the owner of browser runtime state.                                               |
| `@kovojs/style`          | Freshly packed public declarations expose `$$css`, `data-style-src`, `__rules`, `__styleKey`, and an undocumented raw tuple; two similarly named theme APIs have different purposes and one lacks an app user story. The archived API-cleanup 9B opaque-brand claim did not survive packed-artifact verification.                 | Return a module-private-symbol-backed opaque handle, retain `defineTheme`, and prove/rename or remove the variable-override API.                                      |
| `@kovojs/better-auth`    | Root exposes 38 names, including backend-specific generated bindings and internal request/credential carriers.                                                                                                                                                                                                                    | Root contains human auth/guard configuration; generated bindings move behind a generated/runtime boundary and converge on a backend-neutral shape.                    |
| `@kovojs/drizzle`        | Runtime metadata is public; column annotations admit typo-prone strings/`unknown`; optional structural brands and `getSQL(): any` weaken author-time safety.                                                                                                                                                                      | Move runtime metadata internal and bind annotations/SQL handles to concrete Drizzle identities with private witnesses while retaining runtime/AST proof.              |
| `@kovojs/test`           | Low-level HTML/header helpers have real use, but the high-level harness accepts copied graph facts and returns `unknown`; `/test-case` casts incomplete options.                                                                                                                                                                  | Make the harness app/artifact-scoped and inferred, move useful server-testing helpers here, and remove `/test-case` unless a clean Vitest fixture emerges.            |
| UI/headless/icons        | The component-per-subpath shape is sound. Card anatomy is contradictory; orphan generated transition ABI needs reclassification (the "44 orphan transition types" count is unreproduced — Track 0 reconciles it against api-audit's completed ~266-type removal); catalogs are missing; `IconRenderResult = object` is too broad. | Keep component/prop and glyph families, retain separate owning generators with one catalog schema, reclassify proven-orphan ABI, and use the canonical render result. |
| CLI/verifier             | The CLI exposes flag-shaped option interfaces and duplicated grammar. `@kovojs/verify` is a coherent independent family but lacks a usable front door.                                                                                                                                                                            | One discriminated command/result grammar; keep the verifier family and give its CLI stable help, flag order, JSON, exit codes, docs, and examples.                    |

The provisional conservative symbol triage below ranks whether a capability deserves human public
API, not whether its current name, signature, or root placement should survive. Track 2's cleaned
consumer evidence must reconfirm borderline decisions before Track 5 acts on them:

| Audited slice                               | Keep capability | Needs a user-story/shape decision | Remove or demote from human public API |
| ------------------------------------------- | --------------: | --------------------------------: | -------------------------------------: |
| Core/style/browser/client (224 names)       |             105 |                                55 |                                     64 |
| Server/Better Auth/Drizzle/test (695 names) |             403 |                               235 |                                     57 |
| CLI import API (21 names)                   |               5 |                                16 |                                      0 |
| Standalone verifier (11 names)              |              11 |                                 0 |                                      0 |

The generated UI and icon families were reviewed as families: retain the 414 component/prop/style
exports and 1,737 glyph functions plus `IconProps`; reclassify proven-orphan headless transition
ABI, audit 38 weak-evidence headless runtime helpers, and replace the broad icon render alias.
Preserve `create-kovo` as bin-only and `@kovojs/compiler` as zero-public-export boundaries.

### Journey findings

- The generated starter carries exactly 1,413 lines of copied framework checking/orchestration
  across three scripts. That logic belongs in the versioned CLI; an app should own declarative
  policy, not a private build system. (One script, `check-parallel.mjs`, was deliberately shipped
  by archived fast-check round 2 item C; this plan supersedes that decision.)
- The starter manually augments `QueryRegistry` and `InvalidationSets`, annotates read-only DB and
  mutation failure context types, and imports an internal classifier module in test setup. These
  are all framework-derivable facts.
- `kovo dev` listened but printed no readiness URL for more than 75s: `printUrls()` runs, but both
  Vite configs set `logLevel: 'error'`, which silences its info-level output. `kovo --help` and
  subcommand help exit 1. A bare `kovo check` can report `OK` with no graph, and a failed build can
  leave a plausible graph under `dist/.kovo`.
- The experimental SQLite scaffold needed a hidden local auth-origin fix before `/login` returned
  200; its first `check` failed KV417 after 64.01s, coupling local source proof to an unconfigured
  deployment-retention proof.
- `kovo update-docs` safely avoids live network fetches, but the installed snapshot contains only
  placeholder text telling the user to upgrade and run the same command again (55 placeholder
  files, reported as success).
- API-reference tests correctly prove deterministic temporary generation, and the site content
  pipeline regenerates the ignored `site/gen` tree before a build. The remaining gaps are that
  generated/JSDoc examples are not compiled, ignored local output can be mistaken for current
  evidence, and the built reference has no explicit source/package digest for provenance.
- Runtime diagnostic redaction protects secrets, but trusted-boundary runtime failures can collapse
  to an opaque 500 — the local Better Auth origin failure gave the user no safe reason or fix.

### External bar

Kovo should match the discoverability of
[create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app) (guided defaults,
examples, non-interactive mode), the immediate runtime feedback and
[dev toolbar](https://docs.astro.build/en/guides/dev-toolbar/) of Astro, and the task/template
orientation of [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/getting-started).
It should not copy their client architectures. Kovo's differentiator is that the same pleasant
surface remains proof-carrying and browser-free auditable.

## Product and API principles

1. **Proof without ceremony.** Preserve every fail-closed invariant; delete repetition and infer
   facts the compiler already owns.
2. **Declare app context once.** Request, session, DB, environment, errors, routes, and query results
   should flow from one app contract and declaration handles.
3. **One concept, one public home.** Root exports cover daily work; advanced tasks have semantic
   subpaths; generated ABI, internal assembly, and runtime protocol records are not human API.
4. **Source is current state.** A command may consume an artifact only when explicitly requested and
   after verifying its source digest, compiler version, and completed-build token.
5. **One fact, many renderers.** Terminal, JSON, GitHub annotations, editor, MCP, and devtool render
   the same diagnostic and graph objects.
6. **Inference must be honest.** Advanced types make unsafe shapes awkward, but AST/provenance gates
   and fail-closed runtime floors remain the security proof (`SPEC.md` §2 and §6.6).
7. **Advanced is visible, not ambient.** Storage, webhooks, tasks, agents, Postgres lifecycle,
   confidential data, and custom shells stay first-class, but do not dominate ordinary autocomplete.
8. **Technical preview means one clean cut.** Prefer a migration tool and one breaking minor over
   aliases, dual semantics, or permanent legacy barrels.

## Target authoring experience

The exact name is subject to the ordinary API naming review. D1 selected receiver methods over a
generated app-scoped module; implementation should target this ergonomic outcome rather than
merely shortening imports:

```ts
// src/kovo.ts
import { defineKovo } from '@kovojs/server';

import { appAuth, appCsrf, appDb, appEnv } from './runtime.js';

export const app = defineKovo({
  // Generated once by create-kovo; production live-target identity remains UUIDv4.
  appId: '5f31d8d7-45e7-4e91-a34b-2b1263de9b5e',
  auth: appAuth,
  csrf: appCsrf,
  db: appDb,
  env: appEnv,
});
```

```ts
// src/queries.ts
import { app } from './kovo.js';
import { contactTable } from './schema.js';

export const contacts = app.query({
  access: [app.authenticated],
  async load(_input, { db }) {
    return { items: await db.select().from(contactTable) };
  },
});
```

```ts
// src/mutations.ts
import { s } from '@kovojs/server';

import { app } from './kovo.js';
import { contacts } from './queries.js';

export const addContact = app.mutation({
  access: [app.authenticated],
  errors: { DUPLICATE_EMAIL: s.object({ email: s.string() }) },
  input: s.object({ email: s.string(), name: s.string() }),
  optimistic: [
    contacts.optimistic((data, input) => ({
      ...data,
      items: [...data.items, { id: `pending-${input.email}`, ...input }],
    })),
  ],
  async handler(input, request, { fail }) {
    // input, request, db posture, error code, and error payload are inferred.
    return { ok: true };
  },
});
```

```ts
// src/app.tsx
import { health } from './endpoints.js';
import { app } from './kovo.js';
import { addContact } from './mutations.js';
import { contacts } from './queries.js';
import { home, login } from './routes.js';

export default app.assemble({
  endpoints: [health],
  mutations: [addContact],
  queries: [contacts],
  routes: [home, login],
});
```

`defineKovo` is a value-level contract: runtime DB/auth/CSRF/environment providers are supplied and
validated once, and their types flow into declarations. `app.assemble` creates the one closed,
explicit app graph; it may not depend on ambient registration, import order, process-global state,
or HMR residue. The ordinary app does not declare `AppRequest`, repeat generics, or call a second
assembly API. The low-level `createApp`/`CreateAppOptions` shape must therefore leave the root: make
it generated/private, or replace it with a narrow custom-adapter API that consumes opaque
capabilities and returns the same `KovoApp`.

This removes app-authored registry augmentation, `Reader<AppDb>`,
`QueryLoadContext<AppRequest, AppDb>`, `MutationContext<...>`, string query keys, and explicit
slot-map aliases from ordinary application code. `defineKovo` must return framework-owned opaque
handles backed by module-private `unique symbol` witnesses or private state, never public
structural brand fields or `Symbol.for()`. The compiler must recognize these declarations by
provenance and lower them to the existing auditable primitives; the factory is author-time
ergonomics, not a substitute security proof.

Independent review found five contract gaps the sketch leaves open; the Track 4 SPEC work must
resolve each before implementation:

- **Assembly completeness.** A compiled `app.*` declaration unreachable from the single `assemble`
  call must be a diagnostic, not a silent 404 (paired with a deterministic `kovo fix` append
  action). At 100 routes the hand-maintained arrays are otherwise a bug factory — the dual of the
  ambient registration the contract correctly bans.
- **Provider inertness.** Importing a declaration module must not construct live DB/auth providers;
  specify lazy provider binding so unit imports stay side-effect-free.
- **Access algebra.** `app.authenticated` alone is demo-ware: decide how parameterized guards
  (`role`, `rateLimit`, ownership with key selectors, `all`-composition with request-type
  refinement) compose under the new `access` shape while preserving KV436's
  one-decision-per-surface audit.
- **Keyed optimism.** `contacts.optimistic(...)` needs an explicit instance-key shape (for example
  `{ keys, apply }`, with the bare callback legal only for unkeyed queries) and a diagnostic for
  top-level handle references participating in import cycles.
- **Named handles and error localization.** Every factory returns a named, documented handle
  interface (declaration-emit-stable, so witness nameability cannot break downstream d.ts emit),
  with fixtures asserting that a single-property mistake anchors on that property with bounded
  message length.
- Note: the example's `appId: 'contacts'` conflicts with `SPEC.md` §9.1's current canonical-UUIDv4
  requirement; the Track 4 SPEC item must either keep UUIDs (creator-generated) or redefine the
  contract.

The target package topology is:

| Public home                                                    | Owns                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kovojs/core`                                                 | Component, form, error-boundary, link/href, redirect, and essential JSON/render types.                                                                                                                            |
| `@kovojs/core/security`                                        | Secret/untrusted/redacted values and reviewed declassification constructors.                                                                                                                                      |
| `@kovojs/core/storage`                                         | Storage capabilities and concrete adapters.                                                                                                                                                                       |
| `@kovojs/core/webhooks`                                        | Verifier construction and webhook verification types.                                                                                                                                                             |
| `@kovojs/core/diagnostics`                                     | Stable diagnostic code/result types used by tool integrators.                                                                                                                                                     |
| `@kovojs/server`                                               | `defineKovo`, schemas, ordinary route/layout/query/mutation/endpoint declarations, explicit access/posture constructors, and common responses.                                                                    |
| Focused `@kovojs/server/*` task paths                          | Build/vite, custom adapters/assembly, security, Postgres lifecycle, tasks, agents, storage HTTP adapters, render-tree, static export, and other advanced capability families. No generic `/advanced` or `/types`. |
| `@kovojs/browser`                                              | App-authored handlers, derives, optimism, and trusted output constructors.                                                                                                                                        |
| `@kovojs/browser/client`                                       | At most one custom-shell installer plus the few callback/result types an installer user must name.                                                                                                                |
| `@kovojs/style`                                                | `create`, `attrs`, vars/keyframes/theme functions, tokens, and opaque input/handle types; at most 15 directly documented root names.                                                                              |
| `@kovojs/test/*`                                               | Inferred harness plus focused HTML/header/database helpers; no parallel server-testing home.                                                                                                                      |
| `@kovojs/ui/<component>` and `@kovojs/headless-ui/<primitive>` | Component/prop and attribute-builder contracts generated from one anatomy manifest.                                                                                                                               |
| `@kovojs/icons/<glyph>`                                        | Generated glyph functions with `IconProps` and the canonical render-result contract.                                                                                                                              |

## Decision gates

- [x] **D1 — app-contract shape (timebox: 2 calendar weeks of spike effort).** Build _two_ spike
      arms and compare on the same fixture matrix:
  - Arm A: receiver provenance for `app.route/layout/query/mutation/endpoint/task` — the compiler
    proves the receiver originates from the app-authored `defineKovo` call across ordinary local
    imports/re-exports, emits the same authorable IR and graph facts as the existing primitives,
    and rejects aliases/dynamic construction it cannot prove.
  - Arm B: `defineKovo` stays a value-level provider contract, but declaration factories are
    emitted into a generated app-scoped module (e.g. `.kovo/app.ts` addressed via a package.json
    `imports` alias such as `#kovo`) exporting bound, fully typed `query/mutation/route/endpoint`
    free functions — recognized by the compiler's existing free-function import-identity engine
    with no new provenance class.
  - Fixture matrix both arms must pass or fail closed with a specific diagnostic: ordinary local
    import, re-export, aliased import, destructured factory (`const { query } = app`), wrapper
    function, dynamic construction, monorepo shared-app package, duplicate `@kovojs/server` copies.
  - Pass criteria (numbers set from a measured baseline at spike start, recorded here before
    judging): provenance coverage of the matrix, cold/warm `tsc` delta, language-service completion
    latency delta, and the error-localization fixtures from the contract-gap list above.
  - Written fallback: if Arm A fails its criteria, adopt Arm B. If both fail, fall back to a single
    app-context generic threaded through the existing free-function primitives plus
    compiler-generated (never hand-authored) registry augmentation, and renegotiate G22-G24 with
    revised targets recorded in this file.
  - Decision: both arms are eligible; select Arm A by the preregistered preference rule. The
    receiver-provenance compiler fails closed on unsupported flows while preserving the same
    canonical IR/graph as the direct and generated-factory controls.
  - Evidence: `conformance/app-contract-spike/results-v6.json` records every gate passing. On the
    named Apple M4/Node 24/TS 6 runner, Arm A's paired cold/warm TypeScript and
    cold/warm-completion deltas were
    -1.75%/-1.53%/+0.66%/+11.11%, with declaration bytes +1.46%; Arm B measured
    +2.54%/-0.01%/-1.23%/+11.11% and +8.66%. Both retained the exact 11-candidate completion
    subject. Two clean `measure:verify` runs, the 41-test v6 evaluator, and the 14-test compiler
    provenance/forgery suite passed against authenticated packed subjects.
- [x] **D2 — release model.** Per-batch removals land continuously on `main`; exactly **one**
      published breaking technical-preview minor ships the cumulative cut together with
      `kovo fix api-v1`. Interim publishes, if any, are documented as unstable snapshots in
      `STABILITY.md`.
  - Decision: implementation batches merge and push after major verified milestones, as requested
    at roadmap activation; package publication remains the single cumulative capstone action.

## Implementation roadmap

Standing rule for every behavior/API batch in every track: SPEC-first sequencing is mechanical —
the batch updates the smallest owning normative section before or with implementation (especially
§4.8 derive/trusted output, §6.6 declassification, §10.1 Drizzle annotations, §10.4/§10.6 optimism,
§13.1 theme extraction), and the same checkpoint carries compiler/runtime conformance, public docs,
and generated examples.

### Track 0 — Adoption hygiene (S; do these when this plan is adopted)

- [x] Repoint perf ownership from archived fast-check round 2 to
      `plans/fast-kovo-check3.md`: port the still-live cosmetic absolute-path cache-value cleanup
      beside the open lighter-loader follow-up, retain the explicit tsgo/teardown/respawn
      rejections as history, and record the check3 measurements (commerce cold ~9.4s →
      ~6.5-7s) as the feasibility evidence for G4.
  - Evidence: `plans/fast-kovo-check3.md` now owns open items 4 and 5, records the
    ~9.4s→~6.5-7s cold result, and makes the tsgo rejection explicit; the round-2 ledger is
    summarized in `plans/archive.md`.
- [x] Resolve the unresolved merge-conflict markers in the Postgres v1 DevEx ledger (lines
      ~131-153) and archive it plus the other completed-but-unarchived ledgers (`api-audit.md`,
      `api-cleanup.md`, `audit-plan.md`, `capability-surface-redesign.md`, `better-docs.md`,
      `better-testing.md`), porting still-live decisions into the Track 5 decision ledger.
      Note the `better-docs.md` name collision: `plans/archive.md` already records a retired ledger
      by that name.
  - Evidence: `plans/archive.md` records the eight reconciled ledgers; the completed side of the
    Postgres DEC-G conflict was retained, and `plans/api-surface-foundations.md` plus the 5a/5b/5c
    ledgers own the live decisions.
- [x] Reconcile three stale or unreproducible claims before they drive decisions: (a) the style
      `$$css`/`__rules` exposure claim vs archived API-cleanup 9B's 2026-06-29 opaque-brand
      evidence — recompute from freshly packed dist, not local `dist/`; (b) the "44 orphan headless
      transition types" figure, which no current artifact reproduces (likely conflated with
      api-audit's completed ~266-type removal and the 44 `*Styles` tables); (c) label the
      "524 names" vs "554 declarations" units wherever cited.
  - Evidence: fresh style/headless tarballs show the style internals/raw tuple and 31 exported
    `*Move*`/`*Typeahead*` option/result types rather than 44; removal remains gated on mechanical
    value/signature/generated-facade reachability. The manifest inventory reports 524 server-root
    names and 554 server declarations across all public subpaths.
- [x] Create the known-failure register: one ID per confirmed baseline defect (auth-origin fix
      required, silent 75s dev start, help exit 1, vacuous check `OK`, `dist/.kovo` stale graph,
      KV417 coupling in fresh-app check, 4.4-4.8 GiB catalog OOM, internal classifier mock in
      starter tests, placeholder `update-docs` success, opaque trusted-boundary 500s) mapped to a
      failing packed test. "Known failures are represented by failing tests" gates against this
      register, not an open-ended set.
  - Evidence: `pnpm run test:devex-known-failures-available` exercises all ten authenticated
    packed/artifact probes: nine retired behaviors pass and nightly KF-DEVEX-007 remains the sole
    explicit expected failure; schema validation reports `pending-repro=0`.

### Track 1 — First ten minutes and a trustworthy loop (starts immediately)

**Benefit:** an evaluator reaches a real authenticated, typed, optimistic round trip before reading
architecture docs; developers and agents can predict every command and trust that an explanation
describes current source rather than yesterday's partial build.

**Primary risks:** local convenience could weaken production posture; auto-detected origin could
trust forwarded headers; command changes can break scripts; cache invalidation can become unsound;
transactional output can hide useful failed-build evidence; moving starter policy into the CLI
could reduce app control. Limit origin derivation to loopback dev, keep deployment facts explicit
and fail-closed, preserve versioned result protocols, content-address every derived fact, keep
debug evidence outside deploy output, keep absorbed policy inputs declarative and visible via
`kovo explain`, and ship script-visible command removals with their migration rule.

Sequenced so CLI work is written once: the command schema skeleton lands before the surfaces that
render through it. Seeds child ledger `devex-first-loop.md` at adoption (one-proof-one-box
granularity).

- [ ] (M) Land the semantic command AST + argv schema skeleton and the `kovo-diagnostic/v1`
      record first, generating argv parsing, multiline help, shell completion, and command
      reference as adapters (G6); all subsequent Track 1 CLI and diagnostic output renders
      through them. The schema carries aliases, argument kind, enum,
      default, repeatability, category, examples, exit behavior, and result-protocol version;
      programmatic API consumes the semantic discriminated union, not argv-shaped flag interfaces.
  - Group the 14 current capabilities into daily/build, inspect/security, and agent/operator
    sections without removing advanced commands.
  - Partial evidence: the schema, generated argv/request union, help, completion, and command
    reference pass the 67-test CLI semantic suite. `kovo-diagnostic/v1` now authenticates compiler
    facts and parser-owned KV436 ranges through a private source catalog, including MCP; the parent
    remains open until the other diagnostic producers project equally authoritative records.
- [x] (S) Make `kovo`, `kovo --help`, `kovo help`, `kovo <command> --help`, and `kovo --version`
      write to stdout and exit 0; usage/config mistakes exit 2 and proof/build findings exit 1
      (G5).
  - Evidence: the 34-test CLI exit suite covers the stdout/zero matrix and build/export
    configuration-versus-finding split.
- [x] (S) Give `kovo dev` a framework-owned reporter that always prints the local/network URL,
      mode, app entry, DB posture, devtool URL, and readiness duration after the socket is bound
      (G2). Keep framework noise collapsible under `--debug`; do not suppress the readiness line
      with Vite log-level configuration.
  - Evidence: `packages/cli/src/index.kovo-dev.test.ts` and
    `packages/server/src/dev-database-posture.test.ts` prove the post-bind ready report, configured
    host/socket URL, exact framework-minted DB posture, and `--debug` behavior.
- [x] (S) Auto-mount the existing `@kovojs/devtool` graph at `/__kovo` in development (the
      mountable route is already implemented per `plans/devtools.md`), linked from the ready line,
      with no app Vite configuration; add the production/static-export absence census (G15).
  - Evidence: the dev/export/runtime fixtures and `pnpm run check:publish` prove the automatic
    development mount and ready-line link while rejecting the route and implementation from
    production, static-export, and packed runtime artifacts.
- [x] (M) Generate a complete loopback development origin or derive it from the actual bound URL;
      make Better Auth work at the printed local URL without hand-editing `BETTER_AUTH_URL`.
      Non-loopback and production origins remain explicit, fixed, HTTPS-validated configuration.
  - Evidence: the Better Auth environment/runtime-authority suites and KF-DEVEX-001 packed probe
    prove the post-listen origin handoff, while build derivation cannot read deployment authority
    and non-loopback/production origins still fail closed.
- [x] (M) Separate source proof from deployment proof (single owner of the vacuity fix):
  - `kovo check` runs all source/type/compiler/security/freshness checks and cannot pass
    vacuously; missing graph input is an error, never `OK` (G7).
  - `kovo build` additionally enforces preset, artifact, least-privilege, retention, and
    deploy-skew requirements including KV417 (`SPEC.md` §14).
  - The starter's documented quick check must pass before deployment is configured; CI/deploy docs
    must still run the full build with an explicit posture.
  - Evidence: `packages/cli/src/index.source-check.test.ts`, both packed starter source-check
    fixtures, and KF-DEVEX-004/006 prove current-source re-derivation, non-vacuous missing input,
    deployment-only KV417 enforcement, and both generated quick-check paths.
- [x] (M) Adversarial graph-truth and transactional-build suite (G7, G8): checks and explanations
      derive from source or a verified content-addressed cache; stamp every graph with source-set
      digest, compiler version, config digest, app build token, completion state, and posture
      profile; require `--artifact <path>` to inspect a built graph; builds emit into a unique
      staging directory and promote atomically; a failed build leaves the last good `dist`
      untouched and stores opt-in redacted debug facts under `.kovo/debug/<build-id>`, never
      `dist/.kovo`.
  - Evidence: source-set/config/compiler/build-token stamps, explicit artifact grammar, unique
    staging/promotion tests, and retired packed KF-DEVEX-005 prove source-backed truth,
    byte-identical last-good output after failure, and no failed graph promotion.
- [ ] (S) Standardize `--format human|json|github` across check/build/explain/doctor/verify,
      backed by `kovo-diagnostic/v1`; formatters may not re-derive severity, help, or source
      ranges. Preserve `kovo-explain/v1` and `kovo-check/v1` facts byte-for-byte or via an
      explicit versioned protocol migration, and update `rules/v1-acceptance.md` 16.3 in the same
      checkpoint.
  - Partial evidence: check/build/explain accept the shared format enum; the exact KV436 packed
    build and MCP fixtures prove prelude-free JSON plus authored range identity. Doctor/verify and
    the non-KV436 producer census remain open.
- [ ] (S) Normalize `kovo explain` on a subcommand/discriminant grammar such as
      `kovo explain access` and `{ view: 'access', ... }`; replace flag-shaped interface families
      with one exhaustive union.
- [x] (L) Move lifecycle-policy enforcement, sound-subset analysis, endpoint-posture orchestration,
      and safe parallel scheduling out of the three copied starter scripts (1,413 lines) and into
      versioned Kovo commands built on the command AST; the generated app keeps compact
      declarative config and owns no framework orchestration algorithm.
  - Evidence: the focused 13-test CLI/starter suite covers the four framework-owned paths and
    generated-script absence; command-schema tests prove the lifecycle and endpoint-posture
    discriminants, while source/build orchestration owns the ordered concurrent preflights.
- [x] (S) Remove `vp` from the app-facing command model: provide `kovo test` (or a generated
      standard Vitest command if no Kovo wrapper is required), and make scaffold scripts use only
      `kovo`, the test runner, and the package manager. Keep Vite Plus an implementation
      dependency; do not require an app author to understand which proof phases happen under
      `vp check`, copied scripts, or `kovo build`; update the `vp`-naming evidence in
      `rules/v1-acceptance.md` 16.6,
      `rules/prelaunch-checklist.md`, and `rules/docs-style.md` when the scaffold changes.
  - Evidence: focused creator metadata and `kovo test` suites prove the generated script vocabulary
    and internal runner adapter; the template/docs/rule census found no app-facing `vp`, and the
    201-snippet packed-docs gate passed.
- [x] (M) Make Kovo's Vitest/test bootstrap establish the real framework runtime ordering before
      eager app evaluation, then delete the starter's internal classifier mock and `isKovoApp`
      implementation assertion. Until Track 4 lands, the starter uses a packed black-box HTTP
      journey with public Response/HTML assertions; Track 5b upgrades it to the final inferred
      harness.
  - Evidence: focused scaffold/DDL tests and the packed starter runtime journey prove
    bootstrap-before-authored-module ordering, no setup mock/internal import/`isKovoApp`, and
    public HTTP assertions (`SPEC.md` §6.6/§12).
- [x] (S) Make `create-kovo` offer a small interactive choice set derived from one schema: app
      name, supported dialect, install choice, Git choice, and deployment target/retention posture.
  - Maintain one excellent secure-data starter for v1, with Postgres/PGlite-dev and explicitly
    experimental SQLite variants; do not advertise `--template` until a genuinely distinct second
    template has its own packed acceptance journey (the `--example` channel in Track 6 is the
    task-orientation path).
  - Support pnpm as the one policy-tested v1 package manager. Add another manager only with
    equivalent lockfile, lifecycle-script, CI, install, script, and packed-journey coverage.
  - Keep `--yes`, explicit flags, and `--no-install` deterministic for agents and CI.
  - Record the v1 host-OS posture explicitly: name the supported development platforms and either
    add a Windows/WSL smoke journey to the Track 2 runner or document non-support as a deliberate
    v1 decision — an omission is not a decision.
  - Evidence: the 46-test creator contract suite proves one schema owns prompts, flags, choices,
    defaults, help, and interactive projection; it also pins pnpm-only technical-preview policy,
    Linux/macOS support, and explicit native Windows/WSL non-support.
- [ ] (S) Make creator success output conditional and exact: enter directory, install if
      `--no-install` was used, run dev, run check.
  - Include the experimental SQLite single-principal/no-authorization disclaimer and surface KV447
    visibly in dev/check/build for every owner-annotated SQLite table.
  - Refusing SQLite without its explicit experimental flag must create no directory and exit
    non-zero with the limitation and correct invocation.
- [ ] (S) Make the packed starter render a styled, WCAG-checked UI via the public
      component/style API — the implementation owner of G10; Track 2's journey runner owns the
      screenshot + a11y capture.
- [ ] (M) Diagnostic empathy suite (G9): the first-run classes (missing/invalid origin, missing
      secret, missing DB, retention not configured, port collision, install refusal, migration not
      provisioned) plus the top-20 authoring diagnostics (access, CSRF, trusted output, Drizzle
      refs, optimism misuse) each produce one safe cause, one source/config anchor, and an
      executable next step.
- [ ] (M) One blessed deploy-to-URL journey (G11): create→build→deploy→200 on one named Node host
      with artifact retention solved by the preset; the scaffold's deployment-target prompt emits
      the matching config so the prompt pays off.
- [x] (M) Add `kovo doctor` for environment and package coherence: Node/package-manager versions,
      duplicate Kovo copies, peer mismatches, config/preset, local origin, DB roles, migrations,
      retention, writable paths, and stale caches.
  - Evidence: the 6-test doctor suite proves all ten checks, structured adapter parity, bounded
    project-confined cache repair, symlink refusal, and credential non-disclosure.
- [x] (M) Extend `kovo add` with `--list`, typo suggestions, `--dry-run`, and `--install=auto|never`;
      stage file and package edits so an install failure cannot make the reported result ambiguous.
  - `--dry-run` performs zero filesystem/process writes, catalog/list equals the registry, and
    failure output distinguishes completed from planned work.
  - Evidence: the 24-test add suite proves exact registry/list identity, schema-derived typo help,
    zero-write planning, both install postures, staged promotion, and unambiguous rollback output.
- [ ] (M) Close the known 4.4-4.8 GiB OOM beside its cause: fix source-closure scanning so the
      Track 2 all-44-component fixture typechecks/checks/builds within peak RSS ≤2.0 GiB _(prov.)_
      (or a lower ratified value in `devex-budgets.json`) even when copied components are not
      imported. (Track 2 keeps only the reproducer + failing test; the register lists the OOM as
      expected-failing until this lands.)
- [ ] (M) Meet G4 by adopting `plans/fast-kovo-check3.md`'s remaining work, after publishing an
      instrumented phase-by-phase decomposition of the starter's 64.01s cold check as the budget
      justification; add the phase-census test so speed cannot come from silently dropping a
      diagnostic-producing phase.

- [ ] **Track 1 exit:** both packed scaffold variants pass their intended local journey with no
      undocumented environment edit or internal import; the deployment build remains fail-closed;
      all command/help/completion/docs snapshots derive from one schema; missing/stale graphs and
      failed-build artifacts are adversarially rejected; the reference app meets the ratified
      speed budgets (G1-G9, G11, G15; the journey runner, benchmark, and budget ratification are
      Track 2 deliverables, so this exit closes only after those Track 2 items land).

### Track 2 — Measurement that gates release (thin; parallel with Track 1)

**Benefit:** redesign work cannot silently move complexity into docs, types, generated artifacts,
or another command; regressions become release failures rather than another papercut ledger.

**Primary risks:** noisy gates can block unrelated work, inventory can be gamed by moving symbols,
and wall-clock metrics can be unstable. Generate deterministic semantic inputs, ratchet in bounded
batches, review canonical homes, and pin the benchmark environment. Only what the scorecard
consumes lives here; everything else moved next to the work it proves. Seeds child ledger
`devex-gates.md`.

- [x] (L) Packed-consumer golden-journey runner that creates both the default Postgres/PGlite-dev
      app and experimental SQLite app in temporary directories, installs with the supported
      package manager, and records create/install/ready/first-200/login/CRUD/test/check/build
      timings (G1, G2).
  - The published tarballs, not workspace source links, are the test input.
  - Preserve failed app directories as CI artifacts with secrets redacted.
  - Also capture: styled-UI screenshot + a11y check (G10), concept census (G14), cold-install
    time and install size (G16), and the agent-journey fixture (G12, with Track 3).
  - Evidence: the exact combined authenticated report at `b0bf20b05` passes all nine phases for
    Postgres/PGlite and SQLite with enhanced CRUD, zero two-state axe violations, screenshot
    digests, concept census,
    install metrics, redacted failure preservation, and an explicit controlled SPEC §14 build
    posture.
- [ ] (M) Add `scripts/devex-benchmark.mjs` and `devex-budgets.json`: report cold, warm, and
      one-file-incremental timings plus peak RSS and browser bootstrap bytes (G3, G4). Record
      baselines _first_, then ratify each budget with a recorded derivation (baseline, target
      rationale, noise allowance, sample count N, statistic, threshold = budget + k·noise) — a
      failure is a statistically significant budget breach under that recorded procedure, not a
      single noisy sample. Name the runner: provision a pinned reference runner or explicitly
      accept GitHub-hosted with a measured noise floor. Budgets bind only after ratification.
  - Partial evidence: the authenticated packed N=1 smoke records cold/warm/incremental,
    direct-child RSS, ready cold/warm, edit-to-KV235, edit-to-served-result, the v3 check census,
    the v1 dev-transition census, bootstrap bytes, and the v5 fail-closed budget schema. A pinned
    reference runner, N≥5 baseline, noise measurement, and ratification remain open.
- [x] (M) Fix the inventory before using demand evidence.
  - Exclude nested `**/node_modules/**`, every generated/dist/cache tree, packed fixtures, and
    throwaway apps; report authored examples, authored docs, package internals, generated emit,
    conformance, and tests separately.
  - Add hostile nested-dependency/generated-output fixtures that would falsely look like consumers
    if an exclusion regresses.
  - Report public manifest subpaths, analyzed TypeScript entrypoints, exported declarations, and
    generated-family members as separate units.
  - Evidence: `pnpm run test:devex-foundation-schema` passes 51 tests; the current clean census is
    1,839 manifest subpaths, 102 TypeScript entrypoints, 1,849 exported declarations, and 1,737
    generated-family members across 90/128/154/18/4/456 files in the six consumer classes.
- [x] (S) Add the packed full-catalog reproducer: copy all 44 UI components into a fresh app, then
      typecheck, check, and build while unimported copied files are present; register the current
      4.4-4.8 GiB OOM as an expected-failing entry with its budget in `devex-budgets.json` (the
      fix itself is Track 1's `kovo add` item).
  - Evidence: `pnpm run test:devex-known-failures-available` executes KF-DEVEX-007 from attested
    tarballs and keeps the reproduced full-catalog memory failure explicitly expected until its
    Track 1 fix lands.
- [x] (S) CI meta-budget: total added per-PR minutes for all DevEx gates, with an explicit per-PR
      vs nightly split.
  - Evidence: `pnpm run test:devex-track2` reports 65/65 per-PR and 290/300 nightly
    runner-minutes and rejects unbudgeted or workflow-drifted gates.
- [x] (S) Wire the PR-visible reports: public-surface counts, docs freshness, and speed deltas
      posted on every pull request. Record Track 2 results in one compact scorecard-status block
      at the top of this plan and replace, rather than append to, that evidence as later tracks
      supersede it.
  - Evidence: `pnpm run test:devex-track2` passes the always-run PR workflow/report contract and
    its fail-closed, bounded public-surface/docs/speed renderer (11 files, 83 tests).

- [ ] **Track 2 exit:** packed journeys are deterministic; every known-failure-register entry is
      represented by a failing test; budgets are baseline-derived and ratified; public-surface,
      docs-freshness, and speed reports are visible on every pull request.

### Track 3 — Agent loop (lands with Track 1's CLI work, before any breaking batch)

**Benefit:** humans and agents get version-matched, executable context when they need it most —
before and during the API churn. Agents tolerate churn only with version-matched local docs; this
track therefore precedes Track 5.

**Primary risks:** generated docs can become a second source of truth; full local docs increase
package size. Generate from public manifests, SPEC links, and tested examples; set a compressed
size budget and byte-compare outputs. Seeds child ledger `devex-agent-loop.md`.

- [ ] (M) Package the complete versioned authored-doc/API snapshot with the CLI at pack time,
      including a file manifest, Kovo version, source commit, and SHA-256 digests; set a
      compressed tarball/install-size budget, ratified per Track 2's derivation procedure in
      `devex-budgets.json`, so version-matched context does not turn the CLI into an unbounded
      docs payload.
  - Partial evidence: clean-root determinism and every authenticated manifest/content field pass;
    the packed snapshot contains 77 files. The parent remains open until size budgets are
    baseline-derived and ratified.
- [x] (M) Make `kovo update-docs` atomically install that exact snapshot under `.kovo/docs`; never
      fetch mutable live docs during the command and never report success for placeholder-only
      content (G13).
  - Evidence: the 29-test agent-docs suite proves atomic replacement, no live fetch, and rejection
    of placeholder, partial, digest-mismatched, and wrong-version snapshots.
- [x] (M) Add bounded `kovo docs <task>` and MCP retrieval over the same installed snapshot, with
      version/digest shown in results.
  - Evidence: CLI and MCP retrieval tests share the authenticated docs-store implementation and
    return bounded results with snapshot identity.
- [x] (S) Generate `llms.txt`/`llms-full.txt` from the same snapshot — `site/scripts/llms.mjs`
      already exists; cite and reuse it.
  - Evidence: `site/scripts/llms.test.mjs` and snapshot-generator tests prove one canonical corpus.
- [ ] (S) Add the agent-journey fixture (G12) to the golden-journey runner: scaffold→edit→check→fix
      using only JSON diagnostics and local docs, offline.
  - Partial evidence: the packed runner reaches the diagnostic step after authenticated scaffold,
    offline install, and installed-doc selection; its 20-test adversarial suite rejects prose
    diagnostics, live/stale docs, digest mismatches, and all network including loopback. G12 remains
    open until packed JSON build/check supplies the registry-owned KV436 source anchor and the fixed
    empty envelope.
  - Standing rule for Track 5 (not a one-shot checkbox — each batch's own checklist carries the
    proof): every breaking batch regenerates the snapshot in the same checkpoint.

- [ ] **Track 3 exit:** G12 green; G13's snapshot and `update-docs` clauses green from packed
      artifacts (no placeholder snapshot can report success). G13's digest-emission and
      sample-compilation clauses close under Track 6.

### Track 4 — Declare app context once (D1 first)

**Benefit:** ordinary Kovo code becomes shorter, more refactor-safe, and easier to teach without
weakening explicit access, CSRF, confidential-data, ownership, or write declarations.

**Primary risks:** factory methods can obscure the exact symbols the compiler recognizes, duplicate
package copies can split private witnesses, and complex conditional types can slow or destabilize
TypeScript inference. Prove the lowering first, keep runtime/provenance enforcement authoritative,
and budget both type correctness and compiler performance. Seeds child ledger `app-contract.md`.

- [ ] (M) Write and approve the authoring contract in the owning SPEC modules before
      implementation — enumerated: §9.1 (appId contract), §9.5 (closed `createApp` aggregate),
      §6.6 (config-secret door, egress floor install point, capability-closure census,
      factory-root rule), §5.2 rules 6 and 12 (registry regenerators, `server.handler.root`
      vocabulary), §10.2 (query load signature), §10.3, §6.1/§6.3, plus §10.4/§10.5/§12 if the
      optimistic transform contract changes.
  - Specify request/session/DB/env inference, declaration identity, opaque handles, error
    inference, query-result inference, optimistic binding, component slots, generated registries,
    custom adapters, explicit assembly, `defineKovo` versus low-level `createApp`, and
    duplicate-package failure behavior — plus the five contract gaps listed under the target
    authoring experience (assembly completeness, provider inertness, access algebra, keyed
    optimism, named handles/error localization).
  - Define deterministic membership and HMR teardown: no ambient registry, import-order
    dependence, process-global accumulation, or second app assembly call.
- [x] (L) Run the D1 spike (both arms, shared fixture matrix) and record the decision with its
      measured criteria in the D1 checkbox.
  - Evidence: the D1 checkbox records the Arm A decision, measured thresholds, authenticated
    artifacts, adversarial mutation coverage, and clean-rerun commands.
- [ ] (M) Make public `KovoApp` an opaque minimal token and move normalized options, providers,
      registries, runtime authorities, route arrays, and framework DB carriers into private state
      accessed by framework-owned functions.
  - Redesign or remove raw `CreateAppOptions`; moving its recursively named support types to
    another subpath does not make the root signature public-safe.
- [ ] (L) Implement the app-scoped declaration factories per the D1 decision, with module-private
      `unique symbol` witnesses or WeakMap ownership, runtime validation, and explicit diagnostics
      for mixed Kovo package instances.
  - `app.authenticated` is a real executable, self-naming guard bound to the configured
    auth/session provider, not a type marker; the full access algebra follows the SPEC decision.
- [ ] (L) Infer read-only DB, request/session/env, mutation error codes and payloads, query
      input/result, route params/search, task input, and endpoint request/result types from the
      app contract.
  - Endpoint method, access, auth, CSRF, body, cache, and response posture remain explicitly
    authored/default-deny. Negative fixtures prove no type inference can omit them.
  - Define context-typed advanced bridges for webhooks and agents without moving their full
    capability families back to the root.
- [ ] (L) Replace string-key/module-augmentation optimism with query-handle binding such as
      `contacts.optimistic(...)`; compiler-derived read/write edges remain the invalidation proof.
  - Preserve `SPEC.md` §10.4's pure transform contract unless a prior normative change proves
    framework-owned draft isolation, determinism, bounded copy-on-write, and emitted equivalence.
  - Cover exactly one status per invalidated query (`derived`, hand-written, or `await-fragment`),
    keyed query instances (per the keyed-optimism contract decision), and hard errors for
    missing/duplicate/unrelated handles.
  - Prove compiler/runtime loader consumption and a real CRM browser optimistic round trip with no
    standalone adapter before removing the old plan.
- [ ] (M) Infer component mutation slots and form error bindings from declaration handles so
      ordinary components do not name `ComponentRenderSlots` or hand-maintain a parallel registry.
- [ ] (M) Replace public component inference plumbing with a small opaque `Component<Props>`
      contract; remove app-public `AnyFunction`, `IsAny`, `Checked*`, `ComponentCall*`, and
      internal prop/query metadata families.
- [ ] (S) Make `Link` JSX-only and keep `href` as the imperative URL constructor; infer GET-form
      helper records rather than exporting six support types.
- [ ] (M) Add positive and `@ts-expect-error` fixtures for prop, query-result, route-param,
      form-error, DB-readonly, auth, access, CSRF, endpoint posture, optimistic-result/status, and
      mutation-error renames, plus the error-localization fixtures (single-property mistakes
      anchor on that property with bounded message length).
- [ ] (M) Migrate the packed starter and one advanced example to the app contract; grep-clean
      plus typecheck of both is G23's proof.
- [ ] (S) Set TypeScript cold/warm check and language-service completion budgets **with numbers**
      derived from the D1 baseline (including an extended-diagnostics instantiation ceiling);
      reject a cleaner surface if it breaches them or produces unreadable error expansions.

- [ ] **Track 4 exit:** the starter and one advanced example use the app contract without manual
      `AppRequest`, explicit app generics, duplicated auth generics, registry augmentation, or
      casts; emitted artifacts and `kovo explain` remain equivalent to the pre-facade proof model
      (G23).

### Track 5 — Cut the public surface by task

**Benefit:** autocomplete and API reference show concepts an app author can act on; capability
imports reveal security/operational intent; implementation shapes can evolve without breaking apps.

**Primary risks:** import churn, circular package edges, duplicated private witnesses, bundlers
pulling Node modules into the browser, and compiler matchers depending on old public homes. Perform
the cut in the batch DAG below with packed consumer, symbol-provenance, side-effect, and
browser-bundle gates. Seeds one child ledger per batch group.

Opening items (before the first breaking batch):

- [ ] (M) Turn the API inventory into the checked decision ledger and make it the mechanical gate:
      symbol-level `keep`, `move`, `internalize`, or `remove` decisions (generated family rules
      for UI/icon exports) with canonical home, user story, SPEC link, and evidence; CI fails on a
      public symbol without a ledger row whose packed example compiles and whose contract test
      exists, on a subpath without a documented task, and on any leak fix that increases public
      declarations without a `keep` row. Reject new public values without a non-test example and
      contract test. Root-count budgets (G22) are tracked as health metrics; the ledger is the
      gate.
- [ ] (S) Change recursive-publicness from a 532-entry accepted baseline to a descending ratchet
      with no additions; publish per-package counts in CI and reach zero by the end of this track
      (G17). Review fixes for anti-gaming: exporting the leaked internal type is not a fix.
- [ ] (S) Add the AST-based packed-declaration gate for app-public `any` (G18): a small reviewed
      exception file with owner, reason, and expiry; no text grep; no hiding `any` behind an
      alias.
- [ ] (S) Define the migration-tool protocol and ledger format before the first breaking batch;
      every batch must ship and exercise its rewrite/refusal rules before removing the old export.

Batch DAG — every batch follows Track 2's inventory/scanner fix; 5a needs no app contract; 5b
waits for D1; 5c waits only on its own SPEC decision:

- [ ] (L) **5a — style batch.** Replace public style representation records/raw tuples with an
      opaque handle (G19).
  - Retain the proven seed-based `defineTheme`; either prove and rename the weak-evidence
    variable-override `createTheme` to a vars-specific name or remove it after SPEC/user-story
    review.
  - Packed declarations contain none of `$$css`, `data-style-src`, `__rules`, `__styleKey`, or the
    raw tuple; literal/cast forgery fails runtime acceptance; extracted CSS, source maps, and
    artifacts remain equivalent; starter and copied UI builds pass.
- [ ] (L) **5a — UI/headless/icons batch.** Keep UI/headless and icons under their separate owning
      generators, with a shared catalog output schema rather than one false anatomy source.
  - Extend the existing UI/headless primitive-component manifest with parts, slots, IDs, state
    inputs, enhancement tier, roles, and keyboard behavior.
  - Resolve Card on `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter`;
    source, registry, README, API generation, and copy-in output must agree.
  - Migrate CLI package discovery away from the empty `@kovojs/ui` root, then remove or explicitly
    reclassify that root.
  - Reclassify orphan headless transition ABI only after Track 0's count reconciliation and proof
    of zero reachability from public runtime values/signatures and generated facade output; audit
    the 38 weak-evidence runtime helpers.
  - Replace `IconRenderResult = object` with `ComponentRenderResult` or another canonical
    non-leaking contract; run the all-glyph generator/typecheck and existing icon timing
    benchmark.
- [ ] (M) **5a — verifier batch.** Keep all 11 `@kovojs/verify` certificate/verifier exports as one
      independent family; add a packed, runtime-independent API/CLI acceptance suite and a public
      README/reference/examples (G21).
  - `kovo-verify -h`, `--help`, and `--version` write to stdout and exit 0; documented flags work
    in any order; verified is 0, certificate findings is 1, and usage/I/O/parse indeterminate
    is 2.
  - Versioned JSON and human output carry identical findings, and the tarball has no Kovo runtime
    dependency.
- [ ] (L) **5a — browser batch.** Replace `@kovojs/browser/client` assembly with one experimental
      custom-shell installer (G20), shaped like
      `installKovoClient({ root, importModule?, fetch?, onError?, onUploadProgress?, onLifecycle? })`
      returning `{ ready: Promise<void>, dispose(): Promise<void> }` — a readiness signal, defined
      drain/abort dispose semantics, and a sanctioned session-transition reset path; dispose-only
      is insufficient for real shells.
  - Keep store, root, query plans, default transport, module allowlist, snapshots, and mutable
    cache internal; prove generated bootstrap parity and custom-shell interception.
  - Kovo constructs and validates the security-bearing Request/init; a custom fetch hook is a
    bounded wrapper/observer and may not weaken redirect, referrer, credential, build-token, or
    session-transition posture.
  - Default/custom dynamic import must enforce the compiler/document module allowlist. Adversarial
    tests cover arbitrary URLs, redirects, credentials, stream/upload/error hooks, a custom root,
    recovery, repeated install/dispose, and the ratified loader gzip budget.
  - Make browser `derive` query/state/clock inputs registry/handle-backed and tuple/object-map
    inferred; renames fail in TypeScript and callbacks contain no implicit `any`; preserve
    authorable manual derive IR and parity with compiler-generated derive ABI.
  - Require structured non-empty review metadata for browser `trustedHtml`/`trustedUrl`
    constructors, with adversarial sink tests and `kovo explain` evidence.
- [ ] (L) **5a — core batch.** Land the `@kovojs/core` topology in the target table.
  - Remove the 39 definite-removal helpers from app-public API by deleting, redesigning,
    inlining/inferring, or moving them internal/generated only when no retained public signature
    references them. Resolve all 30 borderline names with a real user story or remove them from
    human public API.
  - Redesign the retained S3 client and HMAC verifier so they do not recursively expose the
    current S3 request/response/metadata and resolved-inspection plumbing.
  - Move registry augmentations out of human API; retain `queryRef`/`routeRef` only if a real
    library/client-only example needs them and proves rename-safe inference.
  - Add door-specific validated declassification constructors and make destructive audit drains
    framework-internal.
  - Reject blank/string-shorthand reasons, copied/cast/subclassed policies, and wrong-door
    policies in type, runtime, compiler matcher, and `kovo explain`/audit parity tests.
  - The component-inference-plumbing removals land with Track 4's `Component<Props>` contract.
- [ ] (XL) **5b — server batch** (after D1). Land the `@kovojs/server` topology.
  - Keep the daily declaration path at root (adjudicated by the decision ledger: every retained
    root name appears in the starter or a golden recipe) and move agent, Postgres lifecycle,
    storage adapters, tasks/observability, render-tree, signing, confidential-at-rest, delegation,
    derived-dataset, static-export, replay, principal epoch/erasure, commands, password, egress,
    capability URL/download, rooted files, Node adapters, client-module registries, and
    secret-read boundaries to semantic task paths.
  - Internalize resolved option types, generated fragment/protocol types, framework/system DB
    carriers, live-target authority, and `isKovoApp`.
  - Delete the dead `committedSecretWaiver` heuristic, or first implement a real AST lint with
    explain-visible retained evidence; merely hiding its process-global/discarded audit shape is
    not sufficient.
  - Remove duplicate server-root homes for core storage, verifier, scoped-key, and browser
    trusted-output constructors unless a deliberate environment-specific API has a distinct name
    and user story.
  - Keep `runtime-bootstrap` public and documented because custom adapters require its
    literal-first import under the `SPEC.md` §6.6 boundary.
- [ ] (M) **5b — Better Auth batch** (after D1). Reduce the human root to guards,
      CSRF/environment configuration, mounting, and mature auth workflows; move generated
      Postgres/SQLite binding machinery and carriers behind a manifest-declared
      `apiBoundary.generated` path (or private generated assembly) and converge the two backends.
  - Add a real mount/OAuth example and end-to-end password-reset workflow before calling those
    stable; otherwise mark them experimental.
- [ ] (M) **5b — optimism cut** (after D1). Make inline `mutation({ optimistic })` the only taught
      optimism path; remove tutorial duplication and cast adapters, retaining a standalone plan
      only if an advanced example proves its need.
- [ ] (L) **5b — test-harness batch** (after D1). Replace the high-level test harness with an
      app-scoped harness (G24): types flow from the imported app contract at compile time
      (mutation input/error/result, query input/result, route keys, request, DB); the artifact
      contributes digest-verified runtime graph facts — two mechanisms, stated explicitly.
  - Reject stale, partial, failed-build, or wrong-app artifacts using Track 1 digests and
    completion tokens rather than trusting a nearby graph.
  - Move useful RLS/CSRF server-testing helpers into `@kovojs/test`; remove the parallel
    `@kovojs/server/testing` home and remove `/test-case` unless a sound fixture API replaces it.
  - Split the ordinary harness dependency closure from Playwright and native/all-backend database
    engines; enforce ratified packed install-size/dependency-count budgets before adding it to
    every starter.
  - Add `@kovojs/test` to the starter devDependencies and source a real inferred
    harness/assertion example from an existing file, not a nonexistent `// Source:` path.
- [ ] (L) **5c — Drizzle batch** (after its `SPEC.md` §10.1 decision; independent of D1).
      Redesign annotation types around concrete table/column identities so a typo cannot
      typecheck; replace optional structural brands and `any` SQL returns with private witnesses
      and a typed bridge.
  - Move the eight runtime-metadata exports internal; retain AST/runtime enforcement as the proof.
  - Update `SPEC.md` §10.1 first if the callback shape changes. Packed Postgres, SQLite, and
    supported-Drizzle-peer fixtures must reject typo/wrong-table owner, owner-via, and fan-out
    refs; accept valid refs; reject structural SQL fakes; and expose no `any` or recursive leak.

Per-batch standing checklist (not a one-shot checkbox — each batch's child ledger carries these
as its own boxes): update `public-packages.json`, exports, generated publishConfig/build entries,
API-reference manifest/sidebar, JSDoc, examples, docs, templates, and compiler symbol identities
in the same checkpoint; update the smallest owning SPEC section per the standing rule; regenerate
the Track 3 docs snapshot; record the batch's per-package ratchet segment (G17); add a
release-note entry. Run the batch's ledger-derived codemod first, migrate the repository, remove
the old home/call shape, and run `check:publish`, canonical-import, duplicate-home, and packed
consumer tests.

- [ ] **Track 5 exit:** each public concept has one canonical home; all superseded imports and
      call shapes are removed from source, templates, docs, examples, and generated emitters;
      packed Node/browser/custom-adapter/test consumers pass; G17-G21 green; G22 and G24 green in
      their D1-negotiated form; root budgets reached
      without public `/types` barrels, duplicate re-exports, undocumented deep imports, or browser
      bundles containing Node-only modules.

### Track 6 — Feedback surfaces and teaching

**Benefit:** a developer moves directly from symptom to source fact; humans and agents find the
smallest correct pattern first, then expand into Kovo's proof model only when they need to.

**Primary risks:** an editor or devtool can become a second analyzer; runtime detail can leak
secrets; a dev-only endpoint can accidentally ship; catalog metadata can drift. Reuse compiler
facts, apply the same redaction registry, prove production absence at the emitted-artifact level,
and generate teaching artifacts from owning manifests. Seeds child ledger
`devex-feel-and-teach.md`.

- [ ] (M) Finish compiler-emitted `SourceAnchor { file, start, end }` coverage for declarations,
      graph nodes/edges, diagnostics, suppressions, and generated-to-authored mappings (can start
      immediately, parallel to Tracks 4-5).
- [ ] (M) Give trusted-boundary runtime failures a stable safe-cause taxonomy, correlation ID,
      remediation, and source/config anchor; keep raw causes server-side and secret-redacted (can
      start immediately).
- [ ] (M) Complete the committed unit/browser tests and CLI-text parity still open in
      `plans/devtools.md`, and add the dev-only live wire overlay already designed there: stream
      redacted mutation/query/target facts, light the same static edges, and expose the same
      bounded recent frames to MCP.
- [ ] (M) Editor surface, decision-gated: either `kovo lsp` as a thin transport over the
      compiler's incremental analyzer and diagnostic registry **with a distribution checkbox**
      (extension packaging/marketplace), or the cheaper arm — a VS Code extension consuming
      `kovo-diagnostic/v1` JSON via watch. Editor clients are presentation-only adapters; no
      second analyzer either way. Editor code actions wait for the Track 4 authoring contract.
  - Safe code actions perform deterministic source edits only; never auto-insert a security
    waiver, `trusted*` escape, `csrf: false`, raw SQL declaration, or suppression — offer a
    documented decision menu instead.
- [ ] (S) Assert terminal human output, JSON, GitHub annotations, editor diagnostics, MCP cards,
      and devtool inspectors agree on the projected `kovo-diagnostic/v1` fields (code, severity,
      help, source span) — field-level equality on a named fixture corpus, one fixture per
      diagnostic family.
- [ ] (S) Extend API-reference generation to emit a source/package/public-manifest digest and file
      manifest; generate twice in clean temporary directories, compare determinism, and prove the
      site content build consumes the matching digest. Keep `site/gen` ignored unless a separate
      repository policy decision chooses to commit it; stale ignored local files are not release
      evidence.
- [x] (M) Compile every JSDoc, generated API, package README, and authored guide code sample
      against packed `dist` exports; parse every documented CLI invocation against the command
      schema. Mark samples as `executable`, `type-error`, `output`, or `illustrative`; every skip
      has a reviewed reason so pseudocode/transcripts do not weaken the gate (G13).
  - Evidence: `pnpm run check:publish` classifies all 3,096 samples, compiles 1,139 executable
    samples and 920 JSDoc examples against packed exports, validates 93 CLI invocations through
    the command schema, and admits only reviewed output/illustrative exclusions.
- [ ] (M) Regenerate API references by task: values and copyable examples first, named supporting
      types second, implementation/protocol types absent from human pages.
- [ ] (M) Publish one canonical, compiled recipe for each golden task: component, route, query,
      mutation, form error, auth, inline optimism, trusted output, storage, upload, webhook, task,
      custom shell, theme, test harness, and deploy posture. Compile and execute the recipes
      against packed packages; run rename drills for component props, query results, route
      params, form fields, and mutation errors, asserting the intended diagnostic and fix;
      validate every source-attribution marker against a real tracked path and exported symbol.
- [ ] (S) Generate searchable component and icon catalogs from their owning manifests into one
      catalog schema; show package import, copy command, anatomy where applicable, enhancement
      tier, and accessibility contract.
- [ ] (S) Add package-front-door checks so every public package has an accurate README/reference
      or an explicit generated-family landing page; remove current nonexistent imports and
      internal compiler guidance.
- [ ] (S) Add `create-kovo --example <name>` cloning packed-passing examples (crm/commerce) — the
      task-orientation channel matching the external bar, cheaper than templates because the
      examples are already CI'd. Example presentation/coverage detail stays owned by
      `plans/example-readability.md` and `plans/awesome-examples.md`.
- [ ] (S) Keep task docs progressively disclosed and proof-backed per `rules/docs-style.md`; link
      to the owning SPEC section where it resolves ambiguity rather than front-loading internals.

- [ ] **Track 6 exit:** the same fixture produces equivalent facts on every surface; runtime
      errors are actionable without leaking secrets; production contains no devtool
      implementation; generated website, local snapshot, API, package README, catalog, and MCP
      examples resolve to the same public shape/digest and pass from packed artifacts.

### Release capstone — make the clean break and hold the line

**Benefit:** the preview exits with one coherent contract instead of carrying both the design Kovo
wants and the design it replaced.

**Primary risks:** migration churn can obscure security changes, codemods can rewrite ambiguous
code, and a broad release can make regressions hard to localize. Emit an explicit report, refuse
ambiguous rewrites, land coherent package checkpoints, and run the full scorecard after each batch.

- [ ] Finalize the batch-proven `kovo fix api-v1 --check|--write` from the public decision ledger.
  - Verify every canonical import and mechanical call-shape rewrite shipped before its breaking
    Track 5 cut.
  - Refuse ambiguous app-context, trust, raw-SQL, CSRF, auth, or deployment decisions and print
    the exact manual action needed.
- [ ] Publish a concise breaking-change guide organized by user task, including security posture
      changes, before/after source, and `kovo explain` output.
- [ ] Ship the one published breaking technical-preview minor per D2: remove old roots, aliases,
      deprecated overloads, compatibility barrels, and legacy generated emit; update
      `STABILITY.md` and release notes to describe the deliberate cut.
- [ ] Update the standing rules the cut invalidates: any remaining `vp`/protocol-name evidence in
      `rules/v1-acceptance.md` 16.3/16.6, `rules/prelaunch-checklist.md`, and
      `rules/docs-style.md` not already updated by Track 1.
- [ ] Run packed consumers for scaffold, advanced example, UI copy-in catalog, custom shell,
      custom adapter, verifier-only package, Node build, supported deployment presets, and test
      harness.
- [ ] Run the full security/adversarial gates, compiler fixpoint and render equivalence, wire
      compatibility, API/publicness, publish, docs, type inference, browser, accessibility, and
      performance suites.
- [ ] Inspect emitted server/client modules, graph, diagnostics, HTML, CSS, and wire frames;
      verify app components remain authored TSX/JSX and no hand-authored lowered IR was
      introduced (`SPEC.md` §5.2).
- [ ] Pre-release evidence beyond self-dogfooding: N external (non-author) evaluator or agent-run
      journey transcripts against the packed scaffold, findings triaged into the known-failure
      register.
- [ ] Compact or archive superseded API/DevEx ledgers after their remaining work is either
      completed or explicitly linked here; do not maintain contradictory active checklists.
- [ ] **Capstone exit:** every scorecard gate green with its named proof (tier 2 in its
      D1-negotiated form), with cited command/artifact evidence, before claiming the DevEx/API
      work complete.

## Cross-cutting risk register

| Risk                                               | Failure mode                                                                                                  | Required mitigation / proving evidence                                                                                                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security simplification becomes security weakening | A convenient facade bypasses provenance, CSRF, access, SQL, confidential-data, or fail-closed runtime checks. | Compiler symbol-identity fixtures, adversarial sink tests, byte-equivalent diagnostics, runtime-floor tests, and emitted-artifact inspection for every facade batch.               |
| Type system is sold as proof                       | Branded values are forged or a cast bypasses a claimed security boundary.                                     | Private witnesses plus runtime validation; docs explicitly label types defense-in-depth; AST/provenance remains authoritative under `SPEC.md` §2/§6.6.                             |
| The D1 bet fails late or ambiguously               | Tracks 4-5b stall on an unproven compiler capability.                                                         | Timebox + pre-registered pass criteria + Arm B built in the same spike, so failure selects a fallback instead of stalling; tier-2 gates renegotiate, tier-1 gates ship regardless. |
| Type inference cost                                | Editors stall or error messages expand into internal conditional types.                                       | Named opaque public results, positive/negative fixture corpus, numeric language-service latency and diagnostic-size budgets from the D1 baseline.                                  |
| Subpath fragmentation                              | Root looks smaller but users must guess among many homes.                                                     | Semantic task paths only, one canonical home, generated task index, no `/types` or `/advanced`, real example required per path; the decision ledger is the gate.                   |
| Duplicate module identity                          | Private symbols/WeakMaps differ across duplicate package copies.                                              | Peer/lock coherence, `kovo doctor` duplicate detection, packed duplicate-copy adversarial test, actionable hard failure.                                                           |
| Browser/server boundary regression                 | A re-export pulls `node:crypto`, storage, DB, or filesystem code into browser bundles.                        | Per-entry browser bundle and side-effect tests; Node-builtin scan; size budget.                                                                                                    |
| Unsound caching                                    | Fast check uses stale source/config/compiler/security facts.                                                  | Content-address every input, explicit completed-build token, mutation/adversarial cache suite, source-first default.                                                               |
| Local defaults leak into production                | Loopback origin, embedded DB, weak secrets, or relaxed retention reaches deploy.                              | Loopback-only derivation, production refusal tests, explicit preset/posture build gate, no compatibility fallback.                                                                 |
| Diagnostic disclosure                              | Runtime error detail leaks credentials, SQL, secret values, or private paths.                                 | Central safe-cause registry, redaction/hostile-value tests, correlation to server-only detail.                                                                                     |
| Devtool ships to production                        | Source and runtime graph become an exposed endpoint or asset.                                                 | Production bundle/route census and HTTP probes across Node/static/preset outputs.                                                                                                  |
| Documentation drift                                | Generated pages, READMEs, local docs, and code teach different APIs.                                          | Deterministic generation plus source digest, packed compilation, owning manifests, version display, no successful placeholder snapshot.                                            |
| Migration damages intent                           | Codemod guesses at a security or deployment decision.                                                         | Mechanical rewrites only; structured refusal for ambiguous semantics; clean-worktree/diff preview and rollback instructions.                                                       |
| The gate suite makes CI unaffordable               | Per-PR wall-clock grows until gates get skipped.                                                              | Track 2's CI meta-budget with an explicit per-PR vs nightly split.                                                                                                                 |
| Charter/child-ledger drift                         | Child ledgers diverge from the scorecard.                                                                     | Each child ledger names its charter gates (G-IDs); the capstone exit requires per-gate proof, so drift surfaces as a red gate.                                                     |

## Sequencing and existing-plan ownership

Track 0 at adoption. Tracks 1 and 2 start immediately in parallel (Track 1's CLI items serialize
through the command-AST skeleton; file-level ownership between concurrent workers is recorded in
the child ledgers). Track 3 lands with Track 1's CLI work, before any breaking batch. Track 4's D1
spike starts immediately and is timeboxed; Track 5's opening items and 5a batches proceed after
Track 2's scanner fix without waiting for D1; 5b waits for D1; 5c waits only on its §10.1
decision. Every breaking batch needs its migration rule before removal. Track 6's
anchors/taxonomy/overlay run parallel to Tracks 4-5; editor code actions wait for the Track 4
contract; recipes/catalogs wait for Track 5's public shape. The capstone is the integration and
release gate. Critical path: **D1 spike → 5b server/harness batches → capstone**; everything else
is slack to schedule around it.

This file is the charter. Each track owns a child ledger with
one-proof-one-box granularity (suggested: `devex-first-loop.md`, `devex-gates.md`,
`devex-agent-loop.md`, `app-contract.md`, one ledger per Track 5 batch group,
`devex-feel-and-teach.md`), and this file keeps the scorecard, decision gates, track exits, and
sequencing. These ledgers retain implementation detail until compacted:

- `plans/fast-kovo-check3.md`: analyzer/cache/process performance mechanisms (successor to
  `fast-kovo-check2.md`; see Track 0).
- `plans/devtools.md`: shared graph model, source anchors, UI/MCP parity, and live overlay.
- `plans/better-components-ux.md`: component anatomy and interaction-quality work.
- `plans/open-design-areas.md`: unresolved normative feature design; this plan must not silently
  decide those contracts.
- `plans/example-readability.md` and `plans/awesome-examples.md`: example presentation and
  coverage.
- `plans/api-surface-foundations.md` and the 5a/5b/5c child ledgers: current public-surface
  ownership. Historical audit/cleanup evidence is summarized in `plans/archive.md`.

Checkpoint commits should be closure-oriented: measurement gates, first-run journey, CLI/source
truth, app contract, one coherent package-surface batch, test harness, feedback surfaces, docs,
and release cut. Run the narrow contract tests before each checkpoint, then the packed
cross-package gates whenever public homes, compiler identity, generated emit, or runtime
boundaries change.

## Merge notes (2026-07-28)

This file merges the 2026-07-27 draft with an independently reviewed alternative
(`plans/worldclass-devex-claude.md`, retired). The evidence, principles, target topology, authoring
sketch, batch detail, and risk register are the draft's; the structure changed as follows:

- Phases 0-7 became decision-gated tracks: the draft's Phase 0 was split (journey/benchmark →
  Track 2; decision ledger/ratchet/any-gate/migration protocol → Track 5 openers; docs gates →
  Tracks 3/6; the OOM close-out moved beside its Phase-2-scheduled fix), and Phases 1+2 merged
  into Track 1, serialized through the command-AST skeleton they both edited.
- The compound scorecard rows became 24 atomic, command-mapped, two-tier gates; numeric budgets
  are provisional until baseline-derived and ratified with a recorded statistical procedure.
- The defineKovo bet gained decision gate D1 (two spike arms, pre-registered criteria, written
  fallback); the release model gained D2; five verified contract gaps (assembly completeness,
  provider inertness, access algebra, keyed optimism, named handles/error localization) and the
  §9.1 appId conflict were added to the target-authoring contract; Track 4 now enumerates its
  owning SPEC sections.
- Added: Track 0 hygiene (stale `fast-kovo-check2` pointer, completed-ledger archiving,
  merge-conflict repair, claim reconciliation, known-failure register), the early agent loop
  (Track 3), felt-experience gates (G10, G11, G14), the installer lifecycle contract, the
  editor-surface decision gate, `create-kovo --example`, rule-update items
  (`rules/v1-acceptance.md` 16.3/16.6 et al.), external-evaluator evidence, and the capstone exit
  checkbox the draft's Phase 7 lacked.
- A three-lens post-merge verification (coverage against both sources; internal consistency) ran
  the same day; its fixes are incorporated — notably restoring the 2.0 GiB catalog RSS budget,
  two dropped Track 1 risk mitigations, the per-batch ratchet-segment record, a Windows/WSL
  posture decision, D1-consistent tier-2 wording, scoped Track 3/5 exits, and implementation
  owners for G10 and G23.
