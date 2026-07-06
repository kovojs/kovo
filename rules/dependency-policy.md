# Dependency Policy Rules

How Kovo keeps its supply chain honest. Kovo's security guarantees do not depend
on auditing its dependencies' internals; they depend on a small set of dependency
_behaviors_ staying fixed. This rule keeps those behaviors pinned, keeps installs
reproducible, and makes any change to a guarantee-bearing dependency a deliberate
review trigger rather than a silent transitive drift. Tracked by
`plans/threat-matrix-plan.md` M6.

## Exact-pin the TCB-surface dependencies

Every dependency named in the `trustedDependencySurfaces` section of
[`security/TCB.md`](../security/TCB.md) MUST be declared with an **exact** version
specifier (no `^`, `~`, or range) in its `package.json`. These are the surfaces the
security guarantees rest on today: `pg` (node-postgres query parameterization and
SET ROLE / RLS statement delivery), `drizzle-orm` (SQL-generation parameterization),
`@electric-sql/pglite` (SET LOCAL ROLE / RLS in the embedded engine), `better-auth`
(password hashing and session/cookie integrity), and `@node-rs/argon2` (argon2id
password hashing).

- Pin to the version already resolved in `pnpm-lock.yaml`; do not invent versions.
- After changing a specifier, run `pnpm install --lockfile-only` (or `pnpm install`)
  so the lockfile stays consistent, and confirm `pnpm install --frozen-lockfile`
  still succeeds.
- `better-sqlite3` (experimental SQLite runtime, dev/test only) is also exact-pinned
  for reproducibility, but it is **not** a `trustedDependencySurfaces` entry because
  no shipped security guarantee rests on it.

## Frozen lockfile in CI

Every CI install path MUST use `--frozen-lockfile` so a run fails rather than
silently resolving a new dependency graph. In this repository installs go through
`vp install`; the shared `.github/actions/kovo-setup` composite action and the
`release.yml` install both run `vp install --frozen-lockfile`. See
[`rules/github-workflows.md`](github-workflows.md) for the `vp`/`pnpm` command
resolution rules.

## A TCB-surface review is required on any bump

Bumping a dependency that appears in `trustedDependencySurfaces` is a security
change, not a routine dependency update. Such a bump MUST:

- Update the matching `pinnedVersion` in `security/TCB.md` in the same change (the
  `check:tcb-boundary` gate fails otherwise — see below).
- Re-confirm the specific `reviewTrigger` recorded for each affected surface (for
  example: node-pg still binds values out-of-band; drizzle-orm still parameterizes
  interpolated values; PGlite/Postgres still enforce SET (LOCAL) ROLE and FORCE RLS;
  Better Auth password hashing / cookie signing defaults are unchanged; argon2id
  defaults and constant-time verify are unchanged).
- Record the review conclusion in the PR / handoff note.

## What is machine-enforced vs manual

`check:tcb-boundary` (`scripts/check-tcb-boundary.mjs`) is the gate. For every
`trustedDependencySurfaces` entry it fails the build if:

- the named `dependency` is not declared in the entry's `packageJson`, or
- its declared specifier is not exactly `pinnedVersion` (a caret/range or a drifted
  pin fails), or
- `pnpm-lock.yaml` has no resolved package at `dependency@pinnedVersion`.

The gate does **not** — and cannot — verify the dependency's actual runtime behavior
(that the parameterization, RLS enforcement, or hashing parameters are sound). That
review is the human obligation the `reviewTrigger` describes; the gate only forces
the pin and the manifest to move together so the review cannot be skipped silently.
