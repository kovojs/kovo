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

- [ ] Define the versioned symbol decision schema: `keep`, `move`, `internalize`, or `remove`.
- [ ] Require canonical home, user story, SPEC link, evidence, compiling packed example, and
      contract test for every retained public symbol or generated-family rule.
- [ ] Generate initial rows from the cleaned Track 2 inventory and fail on unclassified public
      symbols/subpaths.
- [ ] Reject a public-surface increase without a reviewed `keep` row.
- [ ] Reject task subpaths without a documented task and owner.
- [ ] Publish package/root counts as health metrics without allowing counts to replace decisions.

## Ratchets

- [ ] Replace the accepted 532 recursive-publicness baseline with a no-additions descending
      per-package ratchet.
- [ ] Reach zero recursive leaks without promoting leaked implementation types.
- [ ] Add an AST-based packed-declaration `any` gate with owner/reason/expiry exceptions.
- [ ] Reject `any` hidden behind aliases or conditional wrappers.

## Migration protocol

- [ ] Define versioned codemod inputs, result records, check/write modes, and refusal categories.
- [ ] Require each breaking batch to land and exercise its rewrite/refusal rules before removing
      old exports.
- [ ] Refuse ambiguous trust, auth, CSRF, SQL, app-context, and deployment rewrites.

## Latest verification

Migrated family decisions were reconciled from the completed API, docs, testing, capability, and
audit ledgers during Track 0 adoption. Symbol-level classification remains open until the cleaned
inventory lands.
