# World-class DevEx — public-surface foundations and decision ledger

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 5 opening items. Gates: G17, G18, G22. This file owns
the canonical decision schema and migrated family-level decisions; generated machine rows may live
in a companion JSON artifact once the cleaned inventory lands.

## Migrated decisions

| Family                                                | Current decision                | Canonical home / condition             |
| ----------------------------------------------------- | ------------------------------- | -------------------------------------- |
| Components, forms, link/href, redirect, render values | Keep ordinary authoring surface | `@kovojs/core`                         |
| Secret/untrusted/redacted/declassification            | Move by security task           | `@kovojs/core/security`                |
| Storage and webhook capability families               | Move by task                    | `@kovojs/core/storage`, `/webhooks`    |
| Registry augmentation and inference plumbing          | Internalize or generate         | No human public home                   |
| Ordinary app declarations and schemas                 | Keep after D1 redesign          | `@kovojs/server`                       |
| Server operational/security capability families       | Move by named task              | Semantic `@kovojs/server/*` paths      |
| `runtime-bootstrap` literal-first boundary            | Keep and document               | Existing generated/custom-adapter path |
| Browser handler/derive/optimism/trust constructors    | Keep after narrowing            | `@kovojs/browser`                      |
| Browser store/root/transport/cache assembly           | Internalize                     | One custom-shell installer remains     |
| Style values                                          | Keep as opaque handles          | `@kovojs/style`                        |
| UI/headless component and prop families               | Keep generated families         | Per-component/per-primitive paths      |
| Headless handler ABI                                  | Generated-only                  | `@kovojs/headless-ui/generated`        |
| Headless reducer helpers                              | Internal-only                   | Primitive internal boundary            |
| Icon glyphs and `IconProps`                           | Keep generated family           | Per-glyph paths                        |
| Verifier certificate family                           | Keep independent                | `@kovojs/verify`                       |
| Better Auth human configuration/guards                | Keep after backend convergence  | `@kovojs/better-auth`                  |
| Drizzle runtime metadata                              | Internalize                     | Typed public annotation bridge only    |
| App harness and focused assertions                    | Keep after D1 inference         | `@kovojs/test/*`                       |

## Mechanical ledger

- [x] Define the versioned symbol decision schema: `keep`, `move`, `internalize`, or `remove`.
  - Evidence: `node scripts/api-decision-ledger.mjs` validates
    `kovo-api-surface-decisions/v1` and the closed decision vocabulary.
- [x] Require canonical home, user story, SPEC link, evidence, compiling packed example, and
      contract test for every retained public symbol or generated-family rule.
  - Evidence: the decision gate validates every current row's story, canonical home, SPEC clause,
    evidence bundle, packed example, and contract tests.
- [x] Generate initial rows from the cleaned Track 2 inventory and fail on unclassified public
      symbols/subpaths.
  - Evidence: the gate reports `declarations=1666 subpaths=1871 decisions=keep:1666` with no
    unclassified current row.
- [x] Reject a public-surface increase without a reviewed `keep` row.
  - Evidence: `scripts/api-decision-ledger.test.mjs` kills undeclared symbol-growth mutants.
- [x] Reject task subpaths without a documented task and owner.
  - Evidence: `scripts/api-decision-ledger.test.mjs` kills undocumented public-subpath mutants.
- [x] Publish package/root counts as health metrics without allowing counts to replace decisions.
  - Evidence: the gate emits per-package root/target counts only after exact row validation.

## Ratchets

- [x] Replace the accepted 532 recursive-publicness baseline with a no-additions descending
      per-package ratchet.
  - Evidence: `node scripts/api-surface-gate.mjs` validates a zero-entry descending baseline and
    rejects recursive additions.
- [x] Reach zero recursive leaks without promoting leaked implementation types.
  - Evidence: the gate reports `recursive-publicness-v2 total=0`; the baseline records zero
    recursive packages and zero documentation exceptions.
- [x] Add an AST-based packed-declaration `any` gate with owner/reason/expiry exceptions.
  - Evidence: `scripts/packed-public-any-gate.test.mjs` passes all five exception-ledger and AST
    cases against `kovo-app-public-any-exceptions/v1`.
- [x] Reject `any` hidden behind aliases or conditional wrappers.
  - Evidence: the same AST suite resolves `Conditional -> Hidden` through a first-party alias and
    rejects the nested `any`; comments and third-party declaration internals remain excluded.

## Migration protocol

- [x] Define versioned codemod inputs, result records, check/write modes, and refusal categories.
  - Evidence: `node scripts/api-migration-protocol.mjs` validates eight versioned batches with
    check/write modes and structured `kovo-api-migration-result/v1` results.
- [x] Require each breaking batch to land and exercise its rewrite/refusal rules before removing
      old exports.
  - Evidence: the protocol gate requires fixtures for every action actually present; the
    `test-harness-v2` batch executes its source-anchored refusal fixture before removal.
- [x] Refuse ambiguous trust, auth, CSRF, SQL, app-context, and deployment rewrites.
  - Evidence: the protocol ledger and unit tests cover all six refusal classes and reject
    unanchored or guessed rewrites.

## Latest verification

`node scripts/api-decision-ledger.mjs` validates 1,640 current declarations across 1,873 subpaths
and `node scripts/api-migration-protocol.mjs` validates ten checked batches. The five-test packed
declaration AST suite proves the exception and alias-unwrapping mechanisms. The final release-wide
G18 measurement still belongs to the canonical authenticated tarball checkpoint.
