# Persistent foreground build/watch decision gate

Status at `c57235748`: **deferred; no production implementation is justified yet**. Keep the
Phase 2 plan item open until the final build cohort applies the predicate below. This is a decision
gate, not evidence that a foreground session is faster.

The gate is now executable in `scripts/perf-build-budget.mjs`. Each derived build budget carries
the authenticated warm-sample upper-bound census, and `assess-persistence` combines the N=24 and
N=216 budgets without weakening either corpus. The seven-family publication includes the resulting
`kovo-build-persistence-assessment/v1` object and renders its four cells. Until the final cohort is
available, that machinery is a fail-closed contract, not a completed decision.

## What the current evidence proves

| Evidence                                                                                                  | What it establishes                                                                                                                                                                                       | Why it does not decide build/watch                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f73738975` one-shot build repair and phase census                                                        | `build` runs current-source analysis, then client, server, and final workers sequentially; duplicated app evaluation was removed without merging source proof into deployment proof.                      | It authenticates attribution shape, not a complete quiet-host Kovo/Next build cohort.                                                                                                               |
| [Authenticated check-watch run `31759466475`](https://github.com/kovojs/kovo/actions/runs/31759466475)    | Session-confined producer facts and a semantic `BuilderProgram` improved closure edits 19.08%, with paired 95% CI `[19.05%, 20.83%]`. App evaluation, graph construction, and diagnostics remained fresh. | The retained state increased median process-tree RSS 15.72%, and the workload contains no client/server/final deployment phases. It cannot be extrapolated to `build`.                              |
| [Authenticated packed-startup run `31753246698`](https://github.com/kovojs/kovo/actions/runs/31753246698) | Installed CLI startup is already 46.57 ms median / 58.40 ms p95.                                                                                                                                          | Merely keeping the root CLI process alive cannot explain or recover 10% of a multi-second build. Worker startup and orchestration still need build-specific attribution.                            |
| `reports/perf-comparison-spike-2026-08-13.md`                                                             | One exploratory as-shipped sample measured 30.87 s / 1,754 MB for Kovo versus 3.22 s / 617 MB for Next.js.                                                                                                | It is neither equal-shape nor the required clean 10-sample, five-run cohort, and it predates the final source. It is prioritization evidence only.                                                  |
| Historical `plans/fast-check.md` profile in git                                                           | The old single-process build attributed 57% self time to twelve redundant ts-morph projects; the corresponding shared-project and per-run memo fixes landed.                                              | The profiled pipeline, app, and process topology no longer match current one-shot build, and no retained raw profile authenticates current head.                                                    |
| Historical round-2/3 ledgers in git                                                                       | A persistent compiler cache once made warm work look cheap; concurrent analyzer work also breached the packed 2 GiB ceiling.                                                                              | `cab4b4b84` removed that cache because same-UID disk state and ambient inputs could not authenticate it. The overlap candidate was retired for RSS. Neither may be revived as performance evidence. |

There is currently no retained `kovo-perf-build-n24` or `kovo-perf-build-n216` Actions artifact, no
admitted N=24/N=216 `clean`/`unchanged`/`edit` build cohort, and no current build CPU profile. The
phase census is the only current build attribution surface. Therefore the repo cannot yet answer
whether cross-invocation warmth is required, whether eligible work is in the top five, or whether
retaining it would fit the production-build RSS target.

## Final-baseline predicate

Apply this predicate only to reports admitted by `docs/performance/baseline-publication.md` and
`docs/performance/build-budget-policy.md`: exactly five distinct Actions run IDs for one exact source,
lock/workload identity, normalized quiet host, and corpus; ten serialized Kovo/Next samples for
each mode at N=24 and N=216; zero misses; complete output, source, worker, and source-phase evidence.

For each `unchanged` and `edit` cell, compute from raw per-sample censuses:

- `wall`: Kovo wall duration;
- `eligible`: `config-trust + typescript + stylesheet`; include `app-source-trust` only for an
  unchanged exact closure and only if a spike revalidates the serialized fact against the current
  closure before consuming it;
- `upper`: `eligible + cliStartupTail`. `cliStartupTail` is only a ceiling until a process/CPU
  profile separates reusable root startup from worker-launch and transport gaps; and
- the Kovo/Next wall and peak-RSS ratios, plus Kovo p95 wall, artifact bytes, and the top five CPU
  stacks for an N=216 unchanged build and one-line edit.

The result is mechanical:

1. **Not required:** close the plan item without implementation if every warm cell reaches the
   first milestone (wall median at most 6x Next and RSS at most 2x), or if `median(upper / wall)` is
   below 10% in both N=216 warm cells. A foreground process cannot repair a clean-build miss, and a
   theoretical ceiling below 10% cannot satisfy the plan's latency acceptance rule.
2. **Spike warranted:** only if an N=216 warm cell misses the first milestone,
   `median(upper / wall) >= 10%`, and a current CPU profile places session-eligible work in the top
   five. Profiled one-shot work outside that set remains a one-shot optimization, not a reason to
   add a session.
3. **Production accepted:** compare clean committed one-shot and foreground candidates in exact
   `baseline, spike, spike, baseline` order for N=24/N=216 `unchanged` and `edit`, with at least ten
   measurements per arm after three warmups per occurrence. Require zero misses/errors/races,
   byte-identical diagnostics and output trees for each exact revision, at least 10% median wall
   improvement with paired bootstrap 95% CI excluding zero, no greater than 5% p95 wall or artifact
   regression, and RSS within the ratified budget without moving a passing <=2x Next cell above the
   milestone. Otherwise reject the candidate and retain one-shot build.

The first clean baseline and its gate remain mandatory regardless of this decision. A foreground
session is an incremental workflow; it is not a way to relabel cold production-build performance.

The implemented evaluator uses an inclusive `>= 10%` warrant boundary and a strict `< 10%`
not-warranted boundary for both N=216 cells. If the milestone/residual evidence reaches the profile
branch but either current profile is absent, it returns `profile-required` with an `unproven`
status. A profile is current only when GitHub artifact custody, clean source/lock identity, the
ratified host/workload, raw profile digest, exact unchanged/edit census, and the fixed classifier
all agree. Even then, `app-source-trust`, worker/deployment phases, launch/transport, and
unattributed stacks remain one-shot or ineligible. This is the source/deploy honesty boundary from
SPEC §5.2 rule 9, expressed as data rather than reviewer convention.

The standalone `assess-persistence` command accepts the exact N=24/N=216 budgets and validates its
derived assessment against those inputs before writing it, but it does not accept `--profile`.
Caller-authored JSON cannot prove custody. Until profile authentication is shared, only the
publication gate may pass an authenticated unchanged/edit profile pair into the assessor.

A mixed result is not silently converted into a third shortcut. For example, an N=24 miss plus
passing N=216 milestones and an N=216 upper bound above 10% satisfies neither declared
not-warranted condition and cannot satisfy the N=216-miss warrant condition. The evaluator reports
that state as `unproven` rather than guessing either decision.

Likewise, a current profile with no session-eligible cause in the qualifying top five does not
create another not-warranted shortcut. It disproves the warrant with that profile but does not
satisfy either declared closure condition, so the mechanical outcome remains `unproven`.

## Implementation-ready spike boundary

If the predicate warrants a spike, prototype an internal foreground adapter before adding a public
CLI flag. A public `kovo build --watch` contract needs the normal CLI/API review only after the
candidate is accepted.

1. Reuse the bounded project snapshot, latest-only serialized revision queue, parent-death
   supervision, and race refusal from `source-check-session.ts`. The trigger schedules work; the
   current compiler-owned closure remains proof authority.
2. Keep the coordinator thin and never evaluate app code in it. It may retain only bounded inert
   producer-fact strings under a module-private process-random HMAC. Keys include exact
   source/config/package/compiler/options digests. Closing the session zeroes the key and drops all
   entries. No producer fact, graph, diagnostic, module, or witness is written to disk.
3. Start a fresh `analyze` worker for every revision. Pass eligible facts over one bounded private
   frame; the worker independently re-derives the current input digests and treats any ambiguity or
   authentication mismatch as a miss. `session-authority`, app evaluation, build-check graph, and
   graph diagnostics always execute. The first spike does **not** retain a semantic
   `BuilderProgram`: doing so would keep the analyzer heap resident beside deployment workers and
   repeat the rejected memory-overlap posture.
4. After `analyze` exits, run the existing client, server, and final workers sequentially with a new
   `KovoBuildOneShotIdentity`. Never carry a prior revision's `LoadedBuildAppModule`, Vite runner,
   handoff, output transaction, or deployment proof forward.
5. Stage each revision transactionally. Before promotion, recheck the bounded trigger and exact
   proof identity; a superseded or racing revision abandons its authenticated stage and runs the
   latest snapshot. Failure preserves the previous complete output byte-for-byte.
6. Emit a `kovo-build-watch/v1` JSONL record containing the revision, exact input identity, complete
   source/worker phase census, reuse statuses, artifact proof digest, and promotion/refusal outcome.

The security tests must cover config/source/package/lock changes, symlink and concurrent-write
races, fact and private-frame tampering, resource bounds, poisoned intrinsics, parent death,
superseded transactions, byte-identical success artifacts, byte-identical failure diagnostics, and
unchanged last-known-good output. These are direct consequences of SPEC §5.2 rule 9 and §5.2.4;
warmth never substitutes for current-source proof or transactional deployment proof.
