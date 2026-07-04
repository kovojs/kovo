# Fundamental Fixes Followup 7b — close A2 by relocating the boundary: production forbids in-process PGlite

Created 2026-07-03. Self-standing. Source of truth for behavior is `SPEC.md`. Closes the one open item from
`plans/fundamental-fixes-followup-7.md` (DEC-A2 + §6 probe) — the PGlite-in-process superuser residual behind
`plans/claude-bugz-32.md` B4. Line numbers cite `origin/main`.

## 1. Why A2 stayed open, and the correct resolution

A2 as originally written — "make an independently-opened raw `new PGlite(dataDir)` least-privilege while retaining a
gated superuser path" — is **infeasible by construction**, which followup-7's probe (§6, line 100) already established:
PGlite's bootstrap user is always superuser and PGlite has no connection-auth handshake, only `SET ROLE`. There is no
way to hand out a raw in-process handle that is not superuser. Chasing it is a dead end.

The resolution is to stop trying to secure the in-process dev database and **relocate the least-privilege guarantee to
the deploy target, where it already lives** (followup-7 A1 / `postgres-v1-devex` DEC-I1: the managed runtime is a
least-priv `NOBYPASSRLS` login role). B4 is only dangerous in one configuration that is currently permitted but
shouldn't be.

### The threat model, made precise

B4-on-PGlite is categorically weaker than the other Round-11 findings:

|                    | B1 / B2 / B3                    | B4 on managed PG             | B4 on PGlite (dev)              |
| ------------------ | ------------------------------- | ---------------------------- | ------------------------------- |
| Who triggers it    | remote end-user (framework gap) | app author's raw-import code | app author's raw-import code    |
| Effective identity | —                               | least-priv login role (A1)   | in-process **superuser**        |
| Result             | cross-tenant leak               | RLS applies → **harmless**   | reads local data as superuser   |
| Tenancy            | multi-tenant                    | multi-tenant                 | single developer, own seed data |

So the residual is: **app-author-written code that deliberately opens a raw driver, in a single-developer local dev
environment, reading its own data.** The identical code is already harmless in production because A1 makes the runtime
least-priv. The ONLY genuinely dangerous configuration is the one nothing forbids yet: **in-process superuser PGlite
serving real multi-tenant production traffic** — `resolveDriver` (`postgres-runtime.ts:1114-1123`) falls back to PGlite
whenever `KOVO_DATABASE_URL` is unset, _regardless of environment_. Close that, and B4 is harmless in every environment
that has real tenants.

This is C5 (followup-7) applied honestly: the boundary is a least-privilege-by-construction identity (the managed
runtime role), not an in-process capability that cannot be made least-priv; the build lint (A3) is defense-in-depth.

## 2. Decisions / work items

### DEC-A — Production refuses to serve on in-process PGlite (the real fix)

- [ ] **A1 — When the runtime resolves the `pglite` driver AND is serving production traffic, refuse to boot.** In the boot/config path (`resolveConfig`/`createPostgresAppRuntime`, keyed off the same production signal the rest of the runtime uses — e.g. `NODE_ENV==='production'` / the built prod artifact, not `KOVO_PARANOID`), fail closed with: `KV433: production requires a least-privilege external Postgres via KOVO_DATABASE_URL; PGlite is dev/test-only and runs in-process as superuser (SPEC §10.3).` Dev/test PGlite (default no-env path) is unchanged.
  - Acceptance: the built prod artifact with no `KOVO_DATABASE_URL` (driver → `pglite`) **refuses to boot** with the KV433 message; the same artifact with a least-priv `KOVO_DATABASE_URL` serves; `pnpm run dev` / tests on default PGlite are unaffected. A test asserts prod-artifact-boot refusal for PGlite and success for the least-priv external URL.
- [ ] **A2 — Keep the followup-7 A1 boot invariant (`runtimeConnectionLeastPrivilegeIssue`, `postgres-runtime.ts:1390-1414`, `KV433_RUNTIME_ROLE`) as the belt-and-suspenders on the managed path.** With DEC-A1 in place, the two together make "in-process superuser + real tenants" unreachable: dev is PGlite (single-tenant), prod is a proven least-priv external role.
  - Acceptance: no code path serves production traffic on a connection whose `current_user` is superuser/`BYPASSRLS`/admin-member (existing check) OR on the `pglite` driver (DEC-A1). A raw reconnection in production reuses the least-priv URL credentials → RLS holds (already covered by `postgres-external-probe.test.ts`).

### DEC-B — Demote B4-on-PGlite to a documented, dev-only, defense-in-depth residual

- [ ] **B1 — Record in SPEC §10.3 that PGlite is a dev/test-only single-tenant database that runs in-process as superuser; the owner-scoping/confidentiality guarantee is provided by the least-privilege managed runtime role (A1) and the closure audit (followup-7 DEC-C), NOT by the in-process dev DB; a deliberately raw-opened PGlite handle in dev is superuser by nature and is caught only by the defense-in-depth lint (followup-7 A3).**
  - Acceptance: SPEC states the dev/prod boundary explicitly; `claude-bugz-32.md` B4 is annotated "resolved by relocation — prod forbids PGlite (7b DEC-A1), dev residual is single-tenant/app-author-self-inflicted/lint-warned"; the security-marker registry keeps the superuser-door code `runtime-choke`/`by-construction` (followup-7 A3), never `build-only`.

### DEC-C — Amend followup-7 to reflect the resolution

- [ ] **C1 — In `plans/fundamental-fixes-followup-7.md`: rewrite DEC-A2 from "make raw PGlite least-priv" (infeasible) to "production forbids in-process PGlite; the B4 residual is dev-only, single-tenant, lint-warned, prod-harmless via A1 — see followup-7b." Mark A2 `[x]` resolved-by-relocation, and close the §6 probe (line 100) with the same disposition.**
  - Acceptance: followup-7 A2 + §6 probe reference 7b and are no longer open; §8 "Resolved design forks" gains a "make raw PGlite least-priv vs relocate the boundary → relocate (7b)" entry.

## 3. Explicitly NOT doing (and why)

- **Switch local dev to real/Docker Postgres** — rejected: discards PGlite's zero-dependency value to close a
  self-inflicted, single-tenant, dev-only gap that is already harmless in production. Wrong trade for a technical
  preview.
- **Make raw in-process PGlite least-privilege** — rejected: infeasible (bootstrap user is always superuser, no
  connection auth; followup-7 §6 probe result).
- **In-memory-only PGlite** — rejected: loses dev persistence across restarts; hiding `KOVO_DATA_DIR` is
  security-by-obscurity.

## 4. Optional follow-on (not required for A2 closure)

- [ ] **Embedded real Postgres as an opt-in dev mode** (managed binary subprocess, no Docker) for teams that want true
      dev/prod parity or to exercise real role separation locally. This is the only legitimate "dev off PGlite" path, but it
      is polish, not a soundness requirement, and it trades PGlite's simplicity/reliability. Track as a separate DevEx item,
      not a v1 blocker.

## 5. Verification to run

- [ ] Prod artifact, no `KOVO_DATABASE_URL` → boot refused with KV433 (new test).
- [ ] Prod artifact, least-priv `KOVO_DATABASE_URL` → serves; raw `new Client(url)` reconnect reads 0 owner rows
      (existing `postgres-external-probe.test.ts`).
- [ ] `pnpm run dev` + existing PGlite tests unaffected (default dev path unchanged).
- [ ] `pnpm run check` green; followup-7 A2/§6 updated; `claude-bugz-32.md` B4 annotated resolved-by-relocation.
