# Pre-launch Checklist

This file tracks the launch-readiness checks required before v1 freeze by the active v1 cleanup
ledger. It tracks work; it does not claim completion.

Name decision, for the record: "Kovo" - short and pronounceable. No external
screening evidence is recorded in this repo yet.

Last checklist audit: 2026-06-12.

## Required Checks

| Check             | Evidence required                                                                                                                                                                                      | Where to record evidence          | Status  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------- |
| Trademark screen  | Dated search notes for "Kovo" in relevant software, developer tooling, cloud, and web-framework classes. Include search source, jurisdiction, query terms, reviewer, conflicts found, and disposition. | Trademark Evidence Ledger below.  | pending |
| Domain            | Confirmation that `kovo.sh` is controlled by the project, or a dated approval for a replacement domain. Include registrar/account owner evidence without secrets.                                      | Domain Evidence Ledger below.     | pending |
| npm scope         | Confirmation that the `@kovojs` npm organization/scope is controlled by the project and can publish the planned packages. Include npm account/org evidence without tokens.                             | npm Scope Evidence Ledger below.  | pending |
| Linguistic screen | Placek-style screen across major markets and likely launch languages. Include reviewer initials, languages/markets checked, concern level, and disposition.                                            | Linguistic Evidence Ledger below. | pending |

## Dated Audit Ledger

This ledger records the pre-launch checklist state without treating missing
external evidence as completion.

| Date       | Reviewer | Scope checked                                                                                   | Result                                                                                                | Status                                  |
| ---------- | -------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-06-12 | TBD      | Required P10 checks: trademark screen, `kovo.sh`, `@kovojs` npm scope, and linguistic screen.   | All four required evidence ledgers exist; none contains completion evidence.                          | pending                                 |
| 2026-06-12 | TBD      | Local runnable references in `rules/v1-acceptance.md` and the repository `pnpm run acceptance`. | Local acceptance command is documented separately; it cannot replace external launch-readiness proof. | pending                                 |
| 2026-06-12 | Codex    | Ledger honesty audit of every required pre-launch evidence section.                             | Required sections are present and each section keeps the absence of external evidence explicit.       | packet ready; external evidence pending |

## Runnable Local Checklist

Run these local checks before requesting external sign-off. They only prove the
repo evidence packet is ready to review; they do not satisfy the trademark,
domain, npm-scope, or linguistic requirements.

| Step | Command or action                                                                                     | Evidence to record                                  | Status  |
| ---- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------- |
| 1    | `pnpm exec vp check rules/prelaunch-checklist.md rules/v1-acceptance.md docs/v1-acceptance-ledger.md` | Passing command log and commit SHA.                 | pending |
| 2    | Confirm every required check has a ledger section below.                                              | Reviewer initials and date in Dated Audit Ledger.   | pending |
| 3    | Attach external search/control/review evidence to the relevant ledger row.                            | Source, reviewer, date, findings, and disposition.  | pending |
| 4    | Link completed pre-launch evidence from `docs/v1-acceptance-ledger.md` before v1 freeze.              | Updated acceptance ledger row and clean diff check. | pending |

## Trademark Evidence Ledger

| Date       | Reviewer | Sources | Query terms                               | Findings                     | Disposition                        | Status  |
| ---------- | -------- | ------- | ----------------------------------------- | ---------------------------- | ---------------------------------- | ------- |
| 2026-06-12 | TBD      | TBD     | `Kovo`, `Kovo framework`, `Kovo software` | No search evidence recorded. | Run external screen before freeze. | pending |

## Domain Evidence Ledger

| Date       | Reviewer | Domain    | Evidence                                       | Disposition                                           | Status  |
| ---------- | -------- | --------- | ---------------------------------------------- | ----------------------------------------------------- | ------- |
| 2026-06-12 | TBD      | `kovo.sh` | No ownership or acquisition evidence recorded. | Confirm control or approve replacement before freeze. | pending |

## npm Scope Evidence Ledger

| Date       | Reviewer | Scope     | Evidence                                             | Disposition                                               | Status  |
| ---------- | -------- | --------- | ---------------------------------------------------- | --------------------------------------------------------- | ------- |
| 2026-06-12 | TBD      | `@kovojs` | No npm organization/scope control evidence recorded. | Confirm control and package publish access before freeze. | pending |

## Linguistic Evidence Ledger

| Date       | Reviewer | Markets or languages | Findings                                | Disposition               | Status  |
| ---------- | -------- | -------------------- | --------------------------------------- | ------------------------- | ------- |
| 2026-06-12 | TBD      | TBD                  | No linguistic screen evidence recorded. | Run screen before freeze. | pending |

## Completion Rule

Do not mark v1 pre-launch complete until every required check has dated evidence,
no ledger row remains `pending`, conflicts are resolved or explicitly accepted,
and `docs/v1-acceptance-ledger.md` links the completed checklist.
