# Kovo

A web framework for building multi-page applications that are **interactive at first paint, legible at every layer, and statically verifiable end-to-end.**

> An application's complete behavior — every handler wiring, navigation target, form field, mutation contract, data dependency, and optimistic prediction — should be provable by TypeScript static checking plus static graph queries, and auditable by reading the page source and the Network panel.

One organizing constraint governs everything: every artifact the system produces (compiled output, HTML, wire traffic, dependency graphs) must be readable by a human in devtools and checkable by a machine without executing a browser.

**Status:** pre-v1, under active implementation. Nothing here is published to npm yet.

## Documents

| Document                                                     | Role                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`SPEC.md`](SPEC.md)                                         | The normative source of truth for framework behavior               |
| [`plans/archive.md`](plans/archive.md)                       | Completed and retired implementation plan registry                 |
| [`docs/constitution.md`](docs/constitution.md)               | The five design tests every feature must pass (summary of SPEC §2) |
| [`docs/compiler-hard-rules.md`](docs/compiler-hard-rules.md) | Compiler release gates (summary of SPEC §5.2)                      |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md)          | Instructions for coding agents working in this repo                |

## Prior art

Kovo composes ideas from systems that each solved one piece:

| Kept from                  | What                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwik                       | Resumability, global event delegation, attribute-encoded handler refs, serialized state, execute-nothing-undeclared (SPEC §4.7 — interaction is the default trigger; every other trigger is a legible attribute) |
| htmx / LiveView            | Server-rendered fragments as the mutation response; HTML over the wire                                                                                                                                           |
| RTK Query / Next tags      | Keyed invalidation intersected with declared dependencies                                                                                                                                                        |
| Replicache / Zero          | Snapshot → predict → rebase log → authoritative reconcile                                                                                                                                                        |
| Rails (touch/Russian-doll) | Writes through the data layer drive derived-view freshness                                                                                                                                                       |
| Convex / Noria             | The asymptote: inferred read/write sets — reached statically via Drizzle ASTs instead of at runtime                                                                                                              |

What it deliberately rejects (client routers, hydration, shadow DOM, custom elements, runtime signal graphs, portals, and more — each with its reason) is in SPEC §3.1.

## Repository layout

| Path                   | Contents                                                |
| ---------------------- | ------------------------------------------------------- |
| `packages/core`        | Component model, diagnostics registry                   |
| `packages/compiler`    | Lowering pipeline, registries, `kovo explain`           |
| `packages/runtime`     | Loader, update plan, morph, optimistic protocol         |
| `packages/server`      | Mutations, queries, guards, wire protocol               |
| `packages/drizzle`     | Touch-set extraction and schema-as-registry adapter     |
| `packages/cli`         | The `kovo` command-line surface                         |
| `packages/test`        | `kovoTest` harness                                      |
| `packages/create-kovo` | Starter-template scaffolder                             |
| `examples/commerce`    | The reference commerce app (SPEC §16 acceptance target) |
| `conformance/`         | Pinned Drizzle-surface conformance suite                |
| `docs/`                | Repo-facing summaries, studies, and checklists          |

## Development

Workspace tooling is [Vite+](https://viteplus.dev) (`vp`) on pnpm.

```bash
pnpm install
pnpm run check        # vp check — typecheck + lint
pnpm run test         # vitest unit/integration suites
pnpm run acceptance   # full gate: check, tests, browser suite, build, perf, conformance, kovo-check
```

### Test Topology

The repo has five test mechanisms:

- Package Vitest suites: `pnpm run test` runs `vitest --run` across package, example, and
  conformance-facing unit/integration tests.
- Browser suite: `pnpm run test:browser` runs `vp run browser`, which uses
  `vitest.browser.config.ts` and Playwright for DOM/browser behavior.
- Node harness scripts: `tests/*.node.mjs` cover repo-level gates that are easier to express with
  Node's built-in test runner, including `kovo-check` and the P10 performance gate.
- Conformance workspaces: `pnpm run test:conformance` runs `vp run conformance` against the pinned
  framework conformance packages under `conformance/`.
- Acceptance chain: `pnpm run acceptance` runs the complete local gate in order:
  `check`, `test`, `test:browser`, `check:build`, `test:p10-perf`, `test:conformance`, then
  `check:kovo`. `check:kovo` imports the built CLI, so a fresh checkout must run `check:build` or
  `vp run build` before invoking it directly.

## Name

"Kovo" — short, pronounceable, no known collisions in the framework space. Launch-readiness checks (trademark, domain, npm scope) are tracked in [`docs/prelaunch-checklist.md`](docs/prelaunch-checklist.md).
