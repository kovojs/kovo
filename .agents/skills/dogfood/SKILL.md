---
name: dogfood
description: Dogfood Kovo by scaffolding or running real apps from the local framework, exercising ordinary AND advanced user workflows, diagnosing framework and starter-template papercuts, and writing the next plans/papercuts ledger. Use when asked to "dogfood" Kovo, try create-kovo end to end, exercise advanced features, reproduce rough edges from app usage, or document papercuts without immediately fixing them. Scales from a single quick app to an exhaustive multi-app workflow-orchestrated sweep with adversarial verification.
---

# Dogfood

## Overview

Exercise Kovo the way an app author would: scaffold or run real apps from the local framework, use
them through the browser and terminal, separate app mistakes from framework/starter defects, and
record the confirmed rough edges in the next papercuts ledger under `plans/`.

This skill finds and documents papercuts. **Do not fix production code unless the user explicitly
asks for a follow-up fix pass.**

**Pick the mode that matches the request:**

- **Light (one app, inline).** "Try create-kovo", "reproduce this rough edge", "dogfood the todo
  flow" → scaffold one app, exercise it inline, write the ledger. Follow the whole skill but skip the
  workflow fan-out.
- **Exhaustive (multi-app, workflow-orchestrated).** "Create several sophisticated apps", "exercise
  advanced features", "find all the papercuts", or any broad/ambitious sweep → run the
  **Exhaustive Workflow** below: baseline, fan out one app per advanced surface, adversarially verify
  every candidate, then synthesize. This is the default when the user asks for breadth, advanced
  features, or comprehensiveness, and especially under multi-agent/ultracode budgets.

## Sources Of Truth

Read these before judging behavior:

- `SPEC.md` for normative framework behavior. Cite relevant sections when a papercut violates or
  strains the framework contract. The `### N.M` subsection headings are the fastest map of the
  feature surface.
- `AGENTS.md`/`CLAUDE.md` and `rules/*.md` for repo discipline.
- **Every** existing ledger for prior findings and current state — dedup against all of them:
  `plans/papercuts*.md`, `plans/papercut-super-*.md`, `plans/bugz*.md`, and active plans. A new
  papercut must be distinct, or clearly marked as a regression/variant of a named prior item. An
  item marked `[x]` fixed that still reproduces is a **regression** worth noting.
- `packages/create-kovo`, `packages/server`, `packages/browser`, `packages/compiler`,
  `packages/drizzle`, and the app's generated source as needed to identify whether the rough edge
  belongs to the starter, runtime, compiler, browser loader, or app code.
- The existing example apps under `examples/` (commerce, crm, stackoverflow, gallery, …) show the
  *correct* shapes for advanced APIs (optimistic, derivation, live-targets, isomorphic). Read the
  relevant one before authoring an advanced feature so you do not mislabel an app mistake as a
  framework defect.

## Operational Facts (hard-won — follow exactly)

These cost real time to discover; honor them up front.

- **Scaffold + link + install:**
  - `node <kovo>/packages/create-kovo/dist/index.mjs <appDir> --sqlite --disable-git` (rebuild the
    dist first: `pnpm --filter create-kovo run build:dist`).
  - `node <kovo>/scripts/link-local-kovo.mjs <appDir> <kovo>` then `(cd <appDir> && pnpm install)`.
    Installs are fast once the global pnpm store is warm.
- **Apps MUST live under a real path** (e.g. `/Users/<you>/kovo-dogfood-<date>`), **not `/tmp`.** On
  macOS `/tmp` → `/private/tmp`, and the `link:` relative-path math the helper writes resolves to a
  nonexistent path, breaking all `@kovojs/*` resolution.
- **Parallel link-local installs pollute the monorepo.** Because the helper writes a
  `pnpm-workspace.yaml` globbing `<kovo>/packages/*`, a dogfood app's `pnpm install` can repoint a
  monorepo package's nested deps (e.g. `packages/style/node_modules/@material/...`) into the dogfood
  dir; when that dir changes, the monorepo's own `kovo build`/`vp dev` then fail at the dangling dep.
  **After any multi-app run, repair with `pnpm install` at the monorepo root** (fast), and verify a
  key transitive dep resolves.
- **`vp dev` binds IPv6 `::1` and auto-increments the port.** Do not assume `PORT`/`127.0.0.1`.
  Start dev in the background to a log, parse the real port from the `Local: http://localhost:PORT/`
  line, and curl via `localhost`. Always kill every dev server you start.
- **Per-form CSRF.** Each mutation form renders its own `name="csrf"` token; when posting with curl,
  extract the token from the *specific* form you are submitting (and send `Origin`/`Referer`), or you
  get a 422.
- **Generated scripts:** `pnpm run test` (vp test), `pnpm run build:prod` (`kovo build ./src/app.tsx`
  — the deploy gate), `pnpm run check` (`vp check` + sound-subset + endpoint-posture), `pnpm run dev`
  (vp dev). `pnpm exec tsc --noEmit` for a pure typecheck. Note that `vp check` and `kovo build` run
  **different** verifiers — a green `check` does not imply a green `build`.

## Choose The Ledger

Honor the filename the user names (e.g. `plans/papercut-super-2.md`). Otherwise create the next
numbered `plans/papercuts-N.md`:

```bash
next=$(
  ls plans 2>/dev/null \
    | grep -E '^papercuts(-[0-9]+)?\.md$' \
    | sed -E 's/papercuts-?([0-9]*)\.md/\1/' \
    | awk '{print ($1==""?1:$1)}' \
    | sort -n \
    | tail -1
)
echo "plans/papercuts-$(( ${next:-0} + 1 )).md"
```

**Security/soundness defects go to a `bugz` ledger, not the papercuts ledger** (next
`plans/bugz-N.md`). If the user asked for everything in one papercuts file, still file the
security finding in `bugz-N.md` and leave a one-line pointer in the papercuts ledger.

## Dogfood Workflow (applies to both modes)

1. **Start from local bits.** Always dogfood against the local Kovo monorepo unless the user
   explicitly asks to test published npm packages. Use the scaffold/link/install commands above. Do
   not use `file:` specs (they copy packages under `node_modules`, where source `.ts` exports and
   transitive `workspace:*` deps fail). Do not add link-local as a public `create-kovo` option; it is
   internal contributor setup. Do not record "version not published yet" — that is release-state
   noise, not app-author friction.
2. **Run the real workflow.** Install, boot the dev server, and use direct HTTP (curl) or browser
   automation to cover the path the feature demands: scaffold, boot, auth, forms/mutations,
   query-backed regions, HMR edits, tests, **and `build:prod`** (the deploy gate frequently diverges
   from dev). For advanced features, author the feature for real until it works or you have proven a
   concrete framework wall.
3. **Capture symptoms with evidence.** For every rough edge, record the exact command, URL, status
   code, response header/body shape, DOM state, terminal error, generated file, or test output that
   proves the symptom.
4. **Find the real root cause.** Read framework source and generated app code. Cite `file:line`.
   Distinguish: framework bug, starter-template bug, app-author mistake, missing/awkward public API,
   missing docs, dev-only tooling issue, or expected behavior with poor diagnostics. If a
   SPEC-described advanced API is missing/unexported/awkward, that itself is a high-value papercut —
   prove it with the grep/import-error/source evidence.
5. **Minimize workaround bias.** Workarounds help prove causality, but the ledger must describe the
   framework/starter failure and acceptance criteria, not just the workaround.
6. **Keep the main tree clean except the ledger(s).** Do not modify the monorepo's `packages/*`,
   templates, `SPEC.md`, or other plans. Do not commit example-app experiments. Keep throwaway apps
   as repro evidence until synthesis is done; tell the user where they live and that they are safe to
   delete (and not to re-run `pnpm install` in them without isolation).

## Exhaustive Workflow (multi-app, orchestrated)

Use this when the user asks for breadth/advanced features/comprehensiveness. It scales coverage with
independent agents and defends against false findings with an adversarial verification pass. The
shape is **baseline → author fan-out → adversarial verify → synthesize**. Steps 0/1/4 run inline on
the main thread; steps 2–3 run as one `Workflow` (a `pipeline` of author→verify).

### Step 0 — Baseline (inline, main worktree)

De-risk the toolchain before fanning out:

- Map the advanced surface from `SPEC.md` `###` headings and the `examples/` apps.
- Read **all** prior ledgers and extract their issue titles, so the fan-out targets *distinct*
  ground (and so you can recognize regressions).
- Rebuild `create-kovo` dist, scaffold ONE base app, link, install (warms the store), and verify the
  toolchain end to end: `check`, `test`, `build:prod`, and a dev HTTP smoke. Capture any first-run
  papercuts yourself. This base also confirms whether previously-filed items are now fixed.

### Step 1 — Design the track slate (inline)

Pick ~5 **distinct** advanced-feature tracks that do not overlap prior ledgers. Good axes: the
interaction ladder (L0 platform → L1 islands/state/derives → L2 mutations → L3 optimistic → L4
Live); registry-bounded dynamic rendering; MPA navigation / typed reads / streaming; auth & access
depth (role/rate-limit/owner-scope/error-shells/capabilities); the file/blob plane; endpoints &
webhooks; theme/UI/icons/accessibility; deploy-skew & version recovery & events. Each track = one
fresh app at `<workspace>/<track-id>` exercising that surface up to its ceiling.

### Step 2 — Author fan-out (workflow)

One agent per track. Each agent: scaffolds + links + installs its own app under a **real path**;
studies the cited SPEC sections + the closest example; authors the feature for real; runs the gates
(`check`/`test`/`build:prod`/dev-smoke); root-causes each rough edge in framework source; and
returns **structured output** (use a JSON schema so results are machine-mergeable), capped at its
~8 strongest candidates plus a `refuted[]` list. Give every agent the Operational Facts, the
diagnose-don't-fix rule, the dedup-against-all-ledgers rule, and the papercut-vs-bugz triage.

Per-candidate fields: `id, title, severity(low|med|high), classification(framework|template|docs|
dev-tooling|app-error|expected), escalateToBugz(bool), observed, rootCause(file:line), whyMatters,
repro(command+output), specRefs, confidence, whyFrameworkNotApp`.

### Step 3 — Adversarial verify (same workflow, pipeline stage 2, no barrier)

For each candidate, spawn an **independent, skeptical** verifier that defaults to doubt. It must:
(1) read the cited framework source to confirm/deny the mechanism; (2) independently reproduce
(re-run the repro in the track's app dir, or a minimal tsc/build/curl/grep check — avoid long-lived
servers); (3) **dedup** by grepping all ledgers (`papercuts*`, `papercut-super-*`, `bugz*`);
(4) **triage** papercut vs genuine security/soundness hole (`escalateToBugz`). Return a verdict:
`confirmed | refuted | needs-info`, plus corrected `classification`/`severity`, `duplicateOf`,
`independentRepro`, `rootCauseConfirmed(file:line)`, `confidence`. Run verify as a `pipeline` stage
so each track's candidates verify as soon as that track finishes (no cross-track barrier). Verifiers
routinely temper authors — expect some "confirmed but severity lowered" and some "refuted as
app-error/expected/dup"; that is the point.

### Step 4 — Synthesize (inline)

- Consolidate cross-track duplicates (the same root bug often surfaces in several tracks — collapse
  to one issue citing the deepest root cause).
- **Self-verify the top 1–3 findings first-hand** before writing them up, especially anything
  surprising or escalated to bugz. Reproduce the exact symptom yourself.
- Write the papercuts ledger; route any `escalateToBugz` confirmed findings into a `bugz-N.md` with a
  pointer from the papercuts ledger.
- Repair the monorepo (`pnpm install` at root) and confirm a transitive dep resolves; kill stray dev
  servers; verify `git status` shows only the new ledger(s).

## Ledger Format

Write a compact task-list ledger. Group many issues under thematic `###` sections, and lead with a
one-line **meta-theme** when one root area dominates (e.g. "the build gate is the hot spot").

```markdown
# <Title> N

Created YYYY-MM-DD. Source of truth remains `SPEC.md`; this ledger captures
framework/template/docs/dev-tooling papercuts found while dogfooding <what>.

## Scope

<which apps/surfaces were exercised, from which local packages, gates run, and what is out of scope>

## Issues

### A. <theme>

- [ ] **<short title>.** (severity, classification; found by <track>)
  - Observed behavior: <precise symptom>
  - Root cause: <exact failing mechanism, with file:line references>
  - Why it matters: <user-facing effect + SPEC/starter contract connection>
  - Repro evidence: <short command/URL/headers/source proof>
  - Acceptance: <what a fix must prove, ideally naming a focused test or workflow>

## Refuted / Not Carried Forward

- <candidate and why it was app error, expected behavior, duplicate, already fixed, or unreproduced.
  Record the encouraging refutations too — what was checked and proven sound.>

## Latest Verification

- `<command>`: <result and what it proves — include any first-hand reproductions of the top findings>
```

All issue checkboxes start open. Mark `[x]` only if this same session also implements and verifies
the fix, with the exact evidence (test/command) nested under the checkbox.

## Quality Bar

- Every issue has a reproduced symptom and a concrete acceptance condition.
- Root-cause language names the failing component and mechanism with `file:line`. Avoid vague labels
  like "HMR issue" or "Drizzle extraction failed" without explaining why.
- Separate app-author mistakes from framework defects; every issue carries an explicit
  "why this is framework not app-error" argument and an honest confidence.
- Severity is practical, not dramatic: papercuts are app-author friction, misleading starter
  behavior, poor/missing diagnostics, dev-loop failures, missing/awkward APIs, or small contract
  gaps. **Escalate security/soundness defects** (auth bypass, IDOR/cross-tenant, XSS, SQLi, CSRF
  bypass, secret leak, fail-open) **into a `bugz` ledger** with the exploit path — do not bury them
  as papercuts.
- Prefer framework fixes over starter workarounds when the framework can reasonably infer, preserve,
  validate, or diagnose the behavior.
- Keep the ledger current-state focused. Do not paste long logs, transcripts, or historical debates.
