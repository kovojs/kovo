# Devtools Legibility Study

`SPEC.md` section 16.2 requires an actual usability study before v1 freeze. This document is the executable study packet and results ledger; it does not claim the study has been completed.

## Status

Status: protocol ready, external scheduling and results pending
Required participants: 5 outside developers who have not worked on Jiso
Passing criterion: every participant can answer each task from browser devtools artifacts alone in under 60 seconds

## Fixture

Use the commerce reference app after a clean acceptance run:

```sh
corepack pnpm run acceptance
```

Study observers should open the rendered commerce page, browser Elements panel, and Network panel. Participants may inspect HTML attributes, readable fragment responses, `fw-query` JSON, response headers, and `fw explain` output. They may not read source files during timed tasks.

## Tasks

1. Button behavior: identify what the Add button does and name the handler or mutation it invokes.
2. Island data: identify what query data the cart badge and product grid hold.
3. Mutation effects: after an add-to-cart request, identify which queries and visible regions changed.
4. Optimism: identify whether each changed query is hand-written optimism, await-fragment, or unhandled.
5. Failure path: identify the validation error shape from a 422 fragment response.

## Evidence To Record

For each participant, record:

- participant identifier
- date
- task timings in seconds
- pass/fail for each task
- devtools artifact used for each answer
- notes on confusing names, missing attributes, or unreadable wire payloads

## Results Ledger

| Participant | Date | Button | Island Data | Mutation Effects | Optimism | Failure Path | Result  |
| ----------- | ---- | ------ | ----------- | ---------------- | -------- | ------------ | ------- |
| pending-1   | TBD  | TBD    | TBD         | TBD              | TBD      | TBD          | pending |
| pending-2   | TBD  | TBD    | TBD         | TBD              | TBD      | TBD          | pending |
| pending-3   | TBD  | TBD    | TBD         | TBD              | TBD      | TBD          | pending |
| pending-4   | TBD  | TBD    | TBD         | TBD              | TBD      | TBD          | pending |
| pending-5   | TBD  | TBD    | TBD         | TBD              | TBD      | TBD          | pending |

## Completion Rule

Do not mark v1 legibility complete until this ledger contains five outside developer rows with dated results and each timed task is under 60 seconds.
