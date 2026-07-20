# OPP-28 / runtime-receipt exact-tip re-review — 2026-07-19

## Identity and scope

- Reviewed commit: `35db2b38a998f0130f7ae535371deed46b433505`.
- Independent worktree / branch:
  `/Users/mini/kovo-agent-opp28-rereview-20260719` /
  `agent/opp28-rereview-20260719`.
- Reviewed repairs: `7e35e773e` (deep private-scope pin), `3c2ac5516` (request-authority
  ownership), and `30189010d` (async request-authority confinement).
- Normative basis: SPEC §6.6's OPP honesty boundary and classify-and-pin rule, SPEC §10.3's
  arg-aware guard / KV414 / C15 contracts, and `rules/security-classifier-refactors.md`.
- Same-process intrinsic poisoning was explicitly out of scope. No result below requires it.

## Verdict

**REJECT the complete OPP-28/runtime-receipt closure at this exact tip.**

The narrow private-root repair is **ACCEPTED**: `guard`, `session`, and `tenant` are recursively
reconstructed after providers and before either a query loader or mutation handler can observe
them. The prior one-leaf accessor/Proxy/value-drift counterexample is closed on both paths,
including provider-created session values, retained source mutation across `await`, inherited and
accessor fields, and mutation `args` carrier layering.

The complete receipt claim remains false because validated `args` are layered on after that repair
without reconstruction. A stable-descriptor Proxy returned by an otherwise type-valid `Schema`
can return the authorized key to `guards.owns`, then a different key to a query loader or async
mutation handler. The retained reproduction proves both sinks receive `victim` after ownership was
granted only for `owned`.

## Ranked findings

### 1. High — `guards.owns` accepts one args key while the read/write sink consumes another

`pinnedPrivateScopeRequestCarrier` deep-pins exactly `guard`, `session`, and `tenant`
(`packages/server/src/guards.ts:1353-1393`). `withGuardArgs` subsequently attaches the parsed value
unchanged (`:1653-1665`). `guards.owns` reads its key once and awaits the app predicate
(`:842-859`), but:

- `runQuery` retains that same parsed object through guard execution and passes it to `load`
  (`packages/server/src/query.ts:528-552`);
- `runMutation` retains it through the guard, wraps the same source for input provenance, then
  layers the wrapper onto the handler request (`packages/server/src/mutation.ts:441-470`).

The committed review-only reproducer defines a type-valid `Schema<{ id: string }>` which first
delegates validation to genuine `s.object({ id: s.string() })`, then returns a Proxy with stable
own-data descriptors. Its first `id` read returns `owned`; later reads return `victim`. No callback
mutates the carrier and no intrinsic is replaced. On both real runners:

1. `guards.owns` receives `owned` and its ownership predicate returns exact `true`;
2. the query loader or async mutation handler receives `victim`;
3. the runner reports success with `value: "victim"`.

This violates §10.3's statement that the guard and loader/handler see the same coerced values and
§6.6/§10.3 C15's requirement that a sink consume the exact classified value. It can turn an
owner-key check into an IDOR read or write. The later mutation provenance wrapper does not repair
an already-live parsed source.

Required repair: either reconstruct a bounded immutable args graph before the guard and make every
consumer use it, or mint a framework-owned accepted-key receipt and require the corresponding
read/write predicate to consume that receipt. A blanket use of the lifecycle-data reconstructor
needs an explicit compatibility decision because valid schemas can return non-record values such
as dates, files, and framework capabilities. Apply the chosen invariant to query and mutation
paths and review the adjacent `withGuardParams` route path. Enroll accessor, Proxy, retained-source,
and async-handler cases in C13 and add a mutant that deletes the args/accepted-key receipt.

### 2. Medium honesty gap — summarized guard-property OPP is executable only for boolean owners

The static positive grammar still admits a summarized string helper such as
`request.guard.userId` as `scope: session` when that helper is installed as `guard:`. That source is
not a valid executable guard: `Guard<Request>` returns only `boolean | GuardDenial`, and strict
TypeScript rejects `(request) => string`. At runtime `runGuard` accepts only exact `true`.

The positive subset is not empty. A `true`-valued boolean owner helper type-checks, the focused
static test reports `scope: session`, and the real runtime test reaches the loader. This is an
honesty/documentation issue rather than a second fail-open: ordinary string/number owner examples
overstate the usable summarized-guard subset, while invalid string guards deny at runtime. Either
document the summarized `guard:` positive as boolean-only or introduce a separate guard verdict
plus immutable principal receipt so ordinary owner IDs are both executable and correspond to the
predicate. Local dominating checks inside a loader/handler are a separate executable string-owner
case and are not rejected by this conclusion.

### 3. Blocking exact-tip gate state — full C13 is red for integration drift

The OPP-focused suites and six selected forcing mutants are green, but the authoritative C13 gate
is not. It reports 5 failed / 88 passed files and 7 failed / 3,134 passed / 1 skipped tests. The
failures are stale framework implementation digests, a stale internal app API expectation, and a
stale CSRF proof anchor, with the starter failure downstream of the digest mismatch. These failures
do not contradict the focused OPP result, but they preclude a full exact-tip closure claim under
the classifier-refactor rule.

## Requested matrix

| Case                                                          | Exact-tip result                                          |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| Direct / transparent-Proxy `guard` root across async query    | pinned; loader sees accepted value                        |
| Direct / transparent-Proxy `guard` root across async mutation | pinned through args layering; handler sees accepted value |
| Provider-created `session` with retained mutable source       | pinned; later source mutation is invisible                |
| Direct `tenant` root                                          | pinned; later source mutation is invisible                |
| Inherited private root                                        | dropped; guard denies                                     |
| Nested private-root accessor                                  | rejected on query and mutation with zero getter reads     |
| Proxy-backed parsed args, query                               | **guard accepts `owned`; loader consumes `victim`**       |
| Proxy-backed parsed args, async mutation                      | **guard accepts `owned`; handler consumes `victim`**      |
| Same-process intrinsic poisoning                              | out of scope                                              |

## Evidence executed

- `CI=true pnpm install --frozen-lockfile` — passed.
- Independent private-root real-runner matrix — 5/5 passed; throwaway test deleted.
- `pnpm exec vitest --run packages/server/src/opp28-runtime-rereview.test.ts
--reporter=verbose` — 2/2 live args-drift reproductions passed.
- Targeted strict `tsc` over the retained reproducer and its source graph — passed.
- Focused server/OPP/final-consumer suite — 4 files, 269/269 passed.
- Six selected OPP/private-pin mutants — 6/6 killed, including the runtime private-scope pin,
  producer and final-consumer accepted-guard coupling, opaque sibling, and alias-depth mutants.
- Strict TypeScript probe — boolean guard positive passed; string owner helper failed TS2345 because
  `string` is not a `GuardResult`.
- `pnpm run check:c9-sink-inventory` — 2 files, 28/28 passed.
- `pnpm run check:green-corpus` — 18/18 passed.
- `pnpm run check:security-classifier-corpus` — failed with the exact integration drift summarized
  above.

No production code, goal, active-plan checkbox, posture ledger, or baseline was changed. Nothing
was pushed.
