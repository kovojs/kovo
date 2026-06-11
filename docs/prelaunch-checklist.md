# Pre-launch Checklist

This file tracks the launch-readiness checks required before v1 freeze by
`IMPLEMENT_v1.md` Phase 10. It tracks work; it does not claim completion.

Name decision, for the record: "Jiso" - short and pronounceable. No external
screening evidence is recorded in this repo yet.

Last checklist audit: 2026-06-11.

## Required Checks

| Check             | Evidence required                                                                                                                                                                                      | Where to record evidence          | Status  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------- |
| Trademark screen  | Dated search notes for "Jiso" in relevant software, developer tooling, cloud, and web-framework classes. Include search source, jurisdiction, query terms, reviewer, conflicts found, and disposition. | Trademark Evidence Ledger below.  | pending |
| Domain            | Confirmation that `jiso.dev` is controlled by the project, or a dated approval for a replacement domain. Include registrar/account owner evidence without secrets.                                     | Domain Evidence Ledger below.     | pending |
| npm scope         | Confirmation that the `@jiso` npm organization/scope is controlled by the project and can publish the planned packages. Include npm account/org evidence without tokens.                               | npm Scope Evidence Ledger below.  | pending |
| Linguistic screen | Placek-style screen across major markets and likely launch languages. Include reviewer initials, languages/markets checked, concern level, and disposition.                                            | Linguistic Evidence Ledger below. | pending |

## Trademark Evidence Ledger

| Date       | Reviewer | Sources | Query terms                               | Findings                     | Disposition                        | Status  |
| ---------- | -------- | ------- | ----------------------------------------- | ---------------------------- | ---------------------------------- | ------- |
| 2026-06-11 | TBD      | TBD     | `Jiso`, `Jiso framework`, `Jiso software` | No search evidence recorded. | Run external screen before freeze. | pending |

## Domain Evidence Ledger

| Date       | Reviewer | Domain     | Evidence                                       | Disposition                                           | Status  |
| ---------- | -------- | ---------- | ---------------------------------------------- | ----------------------------------------------------- | ------- |
| 2026-06-11 | TBD      | `jiso.dev` | No ownership or acquisition evidence recorded. | Confirm control or approve replacement before freeze. | pending |

## npm Scope Evidence Ledger

| Date       | Reviewer | Scope   | Evidence                                             | Disposition                                               | Status  |
| ---------- | -------- | ------- | ---------------------------------------------------- | --------------------------------------------------------- | ------- |
| 2026-06-11 | TBD      | `@jiso` | No npm organization/scope control evidence recorded. | Confirm control and package publish access before freeze. | pending |

## Linguistic Evidence Ledger

| Date       | Reviewer | Markets or languages | Findings                                | Disposition               | Status  |
| ---------- | -------- | -------------------- | --------------------------------------- | ------------------------- | ------- |
| 2026-06-11 | TBD      | TBD                  | No linguistic screen evidence recorded. | Run screen before freeze. | pending |

## Completion Rule

Do not mark v1 pre-launch complete until every required check has dated evidence,
no ledger row remains `pending`, conflicts are resolved or explicitly accepted,
and `docs/v1-acceptance.md` links the completed checklist.
