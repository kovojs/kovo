---
name: find-bugz
description: Run a fresh adversarial bug hunt across the Kovo framework and produce the next dated severity-ranked bug ledger at plans/bugz-N.md. Use when asked to "find bugs", "audit the codebase for bugs", "do a security/correctness sweep", "create a bugz report", or otherwise hunt for NEW, distinct, reproduced defects (not to fix them). Each finding is reproduced in a throwaway git worktree via a multi-agent find → adversarial-verify → completeness-critic loop. This skill finds and reports; it does not fix.
---

# Find Bugz

## Overview

Produce the next bug ledger at `./plans/bugz-<N>.md`: a severity-ranked list of NEW, **distinct**,
**reproduced** security and correctness defects in the Kovo framework. Every confirmed finding is
reproduced in a throwaway `git worktree` off `HEAD` (by a runnable test wherever practical, otherwise
a precise source-level proof), then the worktree is removed. The hunt runs as a multi-agent loop:
parallel **dimension finders** → per-finding **adversarial skeptic verification** → a **completeness
critic** that drives a targeted second round → main-thread **synthesis** of the ledger.

The lens is Kovo's own contract: "secure by construction" (`SPEC.md` §1.1, §2 Prime Principle).
Whole vuln classes are supposed to be compile-time errors or fail-closed runtime floors, so the
highest-value findings are **soundness holes** — insecure or incorrect code that compiles clean,
passes `kovo check`, and silently breaks an advertised guarantee.

**This skill finds and reports. Do not fix bugs** unless the user explicitly asks for fixes in a
separate step (use `implement-plan` or a fix worktree for that). No production code changes.

## Sources Of Truth

Read these before hunting:

- `SPEC.md`: normative framework behavior; cite the relevant section / KV code on every finding.
- All prior ledgers — `plans/bugz.md`, `plans/bugz-2.md`, `plans/bugz-3.md`, … and any
  `plans/{bug,bugs,framework-bugs,secure-*,sources-sinks,compiler-soundness}*.md`. These define the
  **exclusion set**: a finding is only in scope if it is distinct from every item in every prior
  ledger (including each ledger's "Refuted / not carried forward" notes).
- `rules/*.md` for the area under test (`compiler-hard-rules.md`, `api-surface.md`,
  `accessibility-conformance.md`, …).
- `CLAUDE.md` Technical-Preview bias (stronger default over compatibility) — it shapes severity.

Treat `SPEC.md` as authoritative. If a finding contradicts a documented non-goal or DiD floor,
down-rank or refute it accordingly.

## Prepare The Repro Harness

The throwaway-worktree recipe is the backbone of the audit. Prove it works **before** fanning out.

```bash
# From the repo root:
skill_dir=".agents/skills/find-bugz"
wt="/private/tmp/bugz-proof-$$"
bash "$skill_dir/scripts/setup-bugz-worktree.sh" "$wt"          # detached worktree off HEAD, node_modules wired
cat > "$wt/packages/server/src/__bugz_proof.test.ts" <<'EOF'
import { test, expect } from 'vitest';
import { escapeHtml } from '@kovojs/server/internal/escape';
test('worktree can import + exercise real source', () => { expect(escapeHtml('<a&b>')).toBe('&lt;a&amp;b&gt;'); });
EOF
( cd "$wt" && node_modules/.bin/vitest run --config vitest.bugz.config.ts packages/server/src/__bugz_proof.test.ts )
git worktree remove --force "$wt"
```

Harness facts (current repo):

- node_modules is hoisted at root with small per-package `node_modules`; the script symlinks both.
- Existing package `*.test.ts` run against the **real** `vite.config.ts`
  (`node_modules/.bin/vitest run <file>`); use the bundled minimal `vitest.bugz.config.ts` only for
  ad-hoc `__bugz_*.test.ts` function drives that should skip the example-compiler plugins.
- **No jsdom/happy-dom is installed.** For DOM/browser behavior, drive the pure runtime function
  directly, or `node --experimental-strip-types` against the real source string.
- Every agent must keep the main working tree clean, never touch other worktrees, and
  `git worktree remove --force` its own worktree when done.

## Choose The Next Ledger Path

```bash
n=$(ls plans/ | grep -E '^bugz(-[0-9]+)?\.md$' | sed -E 's/bugz-?([0-9]*)\.md/\1/' | awk '{print ($1==""?1:$1)}' | sort -n | tail -1)
echo "next ledger: plans/bugz-$((n+1)).md"
date=$(date +%Y-%m-%d); head=$(git rev-parse --short HEAD)
```

## Fan Out — Dimension Finders

Use the Workflow tool when multi-agent orchestration is opted in (ultracode, an explicit request, or
this skill running under a workflow); otherwise spawn sub-agents directly, capped at ~5 concurrent.
Pipeline each **dimension** through find → verify so each verifies as soon as its finder returns.

Give every finder: the full **exclusion set** (compact summary of every prior-ledger item, by id +
one-line root cause), the **severity rubric** below, the **repro harness** recipe, and a strict "find
& prove, do NOT fix; keep the main tree clean; remove your worktree" instruction. Ask for 2–4 solid,
well-proven findings — quality over a padded list; an honest empty result is fine.

Split by subsystem so coverage is disjoint and broad. A proven starting menu (adapt per run):

- **core-crypto** — CSRF/signing/HMAC/capability tokens, constant-time compare, opaque-session parse,
  cookies, `blessSink` / brand witnesses (forgery, timing, truncation, algorithm confusion).
- **server-response** — caching/`Cache-Control`/`Vary`, headers/CSP, content negotiation, redirects,
  CRLF/header injection, error/diagnostic leaks, CORS.
- **server-mutation-stream** — replay/idempotency keys, fragment-target validation, deferred/SSE
  framing, optimistic-concurrency, multipart/upload handling.
- **compiler-lowering** — IR lowering & codegen soundness, escaping placement, derive/ARIA emission,
  event/attribute lowering, stamp generation, the §5.2 render-equivalence gate.
- **compiler-analyzer-gates** — analyzer false-negatives (a real sink compiling clean): the recurring
  **literal-callee pattern** (a primitive recognized only by a literal identifier name, defeated by
  import alias / namespace member) on any not-yet-covered gate, plus control-flow holes.
- **browser-runtime** — DOM-XSS sinks, wire deserialization / prototype pollution, hydration, event
  delegation, optimistic-update desync, dynamic import.
- **drizzle-static** — secret-to-wire (`extras`, projections), governed/owner READ side, `query()`
  registration, soft-delete/default-scope, relation/join scope, mass-assignment.
- **better-auth-session** — token rotation/fixation, cookie forwarding, plugin materialization,
  account-linking trust, rate-limit, CSRF on auth flows, session provenance.
- **build-cli-export** — SRI/asset integrity, manifest/modulepreload trust surface, secret/source-map
  leakage, build/publish egress floor, pack security, CLI/path handling, static export.
- **style-ui-css** — CSS injection / unescaped values, theme-token interpolation, scope-hash
  collision, UI-primitive dangerous-sink forwarding, icon/SVG injection.

Each finder reads its scope, brainstorms candidates, and for the strongest sets up a throwaway
worktree and writes an adversarial test that drives the REAL function and demonstrates the defect vs a
control. It returns structured findings: id, title, severity, `file:line`, root cause, exploit +
default-config reachability, SPEC/KV ref, repro status (test-confirmed | source-proof), repro detail
(inputs → observed output, or quoted lines, naming the worktree), and why it is distinct.

## Adversarial Verification

For each candidate, spawn a **skeptic** whose default stance is to refute. It re-reads the cited
source, independently reproduces in its own throwaway worktree (re-deriving, not trusting the finder's
test), and tries to break the claim: is the input actually attacker-reachable? is there an upstream
guard, control-flow path, or runtime floor that neutralizes it? does a realistic default-config app
hit it? Is it genuinely distinct? It returns a verdict (confirmed | refuted | uncertain), a corrected
severity, an honest reachability/threat-model judgement, and its own repro. Refute fail-safe,
out-of-threat-model, unreachable, or dead-code claims. Only `confirmed`/`uncertain` survive.

## Completeness Critic And Second Round

After the first pass, run a critic over the audited dimensions + confirmed findings + exclusion set.
It names concrete coverage GAPS (subsystems/files/angles not yet hunted that plausibly hide a distinct
bug) with a specific hunting lens. If the gaps are material, run a **targeted second round** of
finders (one per gap), seeded with the round-1 confirmed list added to the exclusion set, then verify
those the same way. The runtime layers (agent-tool invocation gate, cache invalidation, report
ingestion endpoints, CRDT/CAS, raw `endpoint()`/`command()` CSRF parity, client persistent storage,
interaction primitives) are common gaps a static-leaning first round misses.

## Severity Rubric

- **HIGH** — a real breach or soundness hole: insecure/incorrect code that compiles clean / passes
  `kovo check` and silently breaks an advertised guarantee (XSS, SSRF, SQLi, IDOR/cross-tenant,
  auth/session bypass, RCE, remote DoS), reachable on **default config** and in threat model.
- **MEDIUM** — a real defect with meaningful security or correctness impact but gated (non-default
  config, narrow precondition, or fails in the safe direction), or a correctness bug that corrupts
  shipped output/state.
- **LOW** — latent footgun, defense-in-depth gap, over-strict/fail-safe wart, or internal-contract
  inconsistency with no demonstrated live exploit.

Be adversarial and honest about reachability. If a realistic app cannot reach it, it is LOW or
refuted. Merge findings that share a root cause; record contestable severity calls explicitly.

## Report Format

Write `plans/bugz-<N>.md`:

```markdown
# Bug Ledger (`bugz-<N>`)

**Date:** YYYY-MM-DD
**Scope:** Adversarial sweep beyond prior ledgers, at `main` HEAD `<short-sha>`.
**Method:** <rounds, # agents, dimensions; find → adversarial-verify → critic; every confirmed item
reproduced in a throwaway git worktree (recipe at the end); no production code changed.>

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| High     |     N | H1…   |
| Medium   |     N | M1…   |
| Low      |     N | L1…   |

<one line on shared root causes / recurring themes>

## HIGH / MEDIUM / LOW

- [ ] **H1 — <one-line title with the primitive/file>.** `pkg/path:line(s)`
  - <root cause: the precise defective dataflow/logic>
  - **Exploit:** <attacker scenario + default-config reachability>
  - **Verified:** <what the worktree test showed (inputs → observed output), or quoted source proof>
  - **Distinct:** <why this is NOT any prior-ledger item>
  - **Fix:** <one-line suggested direction — documentation only; do not apply>

## Refuted / not carried forward

<each refuted/dropped candidate + the reason, so it is not re-chased next time>

## Verification methodology

<the throwaway-worktree recipe + how each item was reproduced>
```

All items are open (`- [ ]`); this skill does not fix. Use checkboxes so a later fix pass can track them.

## Quality Bar

- Every confirmed finding is **distinct** from every prior ledger (state which, and why).
- Prefer a runnable test-confirmed repro; fall back to a precise quoted source proof only when a
  harness is genuinely impractical, and say which.
- Be honest about reachability and threat model — do not inflate fail-safe or out-of-threat-model
  findings; the prior ledgers downgraded/refuted several, and so should you.
- Cite `SPEC.md` section / KV code on each finding.
- Record refuted candidates with reasons (the "Refuted" section is load-bearing for future runs).
- Keep the main working tree clean throughout; remove every throwaway worktree afterward and verify
  none leak (`git worktree list`).
- Do not edit production code or other plans; the output is a new ledger, not fixes or checkbox churn.
