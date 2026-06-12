# Devtools Legibility Study

`SPEC.md` section 16.2 requires an actual usability study before v1 freeze. This
document is the executable study packet and results ledger; it does not claim the
study has been completed.

Protocol version: 2026-06-12
Status: protocol ready; recruitment, sessions, and results pending
Required participants: five outside developers who have not worked on Jiso
Passing criterion: each participant answers every task from browser devtools
artifacts alone in under 60 seconds

## Fixture Setup

Use the commerce reference app from the exact commit recorded in
`docs/v1-acceptance.md` after a clean acceptance run:

```sh
pnpm run acceptance
```

For each session, record the commit SHA, browser/version, operating system, and
whether the browser cache was cleared. The observer should open the rendered
commerce page, browser Elements panel, and Network panel before the timed tasks
begin.

Allowed materials:

- Elements panel markup, including `on:*`, `fw-c`, `fw-deps`, `fw-query`,
  `fw-pending`, and `data-bind` attributes.
- Network requests and responses, including readable mutation names, response
  headers, HTML fragments, and `fw-query` JSON payloads.
- `fw explain` output generated for the same commit.

Disallowed materials during timed tasks:

- Source files.
- Test files.
- Explanations from the observer beyond restating the task prompt.

## Study Script

Before starting the timer, tell each participant:

> You are evaluating whether the app behavior is legible from browser devtools.
> Use only the page, Elements panel, Network panel, and provided `fw explain`
> output. Say your answer and the artifact that supports it.

Run the tasks in order. Stop each task at 60 seconds and mark it failed if the
participant has not answered both the fact and the supporting artifact.

## Tasks

| Task             | Prompt                                                                                         | Passing answer must identify                                                            | Allowed supporting artifacts                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Button behavior  | "What does the Add button do, and what named handler or mutation is invoked?"                  | The add-to-cart behavior and the invoked handler or mutation name.                      | `on:*` attribute, form action, request URL, response header, or `fw explain mutation`. |
| Island data      | "What query data do the cart badge and product grid hold?"                                     | The query names or keys backing both visible regions.                                   | `fw-deps`, `fw-query` JSON, or `fw explain component/page`.                            |
| Mutation effects | "After an add-to-cart request, which queries and visible regions changed?"                     | The invalidated or patched queries and the visible fragments/regions updated.           | Network fragment response, `fw-query` patches, `FW-Targets`, or `fw explain mutation`. |
| Optimism         | "For each changed query, is the optimistic status hand-written, await-fragment, or unhandled?" | An explicit status for each changed query, with no unhandled status counted as passing. | `fw explain --optimistic` or `fw check` optimistic output.                             |
| Failure path     | "Trigger or inspect a validation failure. What is the 422 error shape?"                        | The validation error fields and where the fragment renders.                             | 422 response, fragment HTML, `fw-query` JSON, or form error markup.                    |

## Evidence To Record

For each participant, record:

- participant identifier that does not expose personal data
- date
- outside-developer eligibility confirmation
- browser and OS
- commit SHA
- per-task time in seconds
- pass/fail for each task
- devtools artifact used for each answer
- observer notes on confusing names, missing attributes, or unreadable wire
  payloads

Store raw notes outside the repo if they contain personal data. Only anonymized
participant IDs and outcome summaries belong in this file.

## Results Ledger

| Participant | Date | Eligibility                   | Commit | Button  | Island data | Mutation effects | Optimism | Failure path | Result  |
| ----------- | ---- | ----------------------------- | ------ | ------- | ----------- | ---------------- | -------- | ------------ | ------- |
| pending-1   | TBD  | outside developer, unverified | TBD    | pending | pending     | pending          | pending  | pending      | pending |
| pending-2   | TBD  | outside developer, unverified | TBD    | pending | pending     | pending          | pending  | pending      | pending |
| pending-3   | TBD  | outside developer, unverified | TBD    | pending | pending     | pending          | pending  | pending      | pending |
| pending-4   | TBD  | outside developer, unverified | TBD    | pending | pending     | pending          | pending  | pending      | pending |
| pending-5   | TBD  | outside developer, unverified | TBD    | pending | pending     | pending          | pending  | pending      | pending |

## Dated Study Readiness Ledger

This ledger tracks whether SPEC §16.2 has runnable local materials and whether
the required outside evidence exists. It is not a substitute for the five
outside-developer result rows above.

| Date       | Reviewer | Evidence checked                                                                 | Result                                                                 | Status  |
| ---------- | -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------- |
| 2026-06-12 | TBD      | Study packet, task table, evidence fields, and completion rule in this document. | Runnable packet exists; no outside participant sessions are recorded.  | pending |
| 2026-06-12 | TBD      | Acceptance fixture command named by Fixture Setup: `pnpm run acceptance`.        | Command identified for clean fixture capture; not run for this ledger. | pending |

## Local Session Checklist

Run this checklist for each outside participant before adding a dated results
row. If any item cannot be completed, keep the participant row pending and add an
issue below.

| Step | Local check                                                                 | Evidence to retain outside repo if private                     |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1    | Confirm participant has not worked on Jiso.                                 | Anonymized eligibility note.                                   |
| 2    | Capture clean checkout commit after `pnpm run acceptance` passes.           | Commit SHA and command log path.                               |
| 3    | Open commerce page plus Elements and Network panels for the same commit.    | Browser, version, OS, and cache-clear note.                    |
| 4    | Time all five tasks with no source or test files visible.                   | Per-task time, pass/fail, and supporting devtools artifact.    |
| 5    | Record only anonymized participant ID and summary outcome in this document. | Raw notes stay outside the repo if they include personal data. |

## Issues Ledger

Record any failed task or recurring confusion here before freeze. Keep items open
until the confusing artifact is fixed or the task wording is corrected and rerun.

| Date       | Participant | Task | Issue                                    | Resolution                     | Status  |
| ---------- | ----------- | ---- | ---------------------------------------- | ------------------------------ | ------- |
| 2026-06-12 | pending     | all  | No outside study sessions have been run. | Recruit and run five sessions. | pending |

## Completion Rule

Do not mark SPEC §16.2 or P10 legibility complete until this ledger contains five
dated outside-developer result rows, every timed task is under 60 seconds for
each participant, every issue row is resolved or explicitly accepted, and
`docs/v1-acceptance.md` links the passing study evidence.
