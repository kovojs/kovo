---
title: The kovo & vp CLIs
description: Use kovo for framework-aware dev, build, and graph commands; use vp for the surrounding project toolchain.
order: 6.7
---

# The kovo & vp CLIs

Kovo projects use **two distinct binaries**, and keeping them straight saves confusion:

- **`vp`** is the **project / toolchain runner** — Vite+ (`vite-plus`). Use it for tests,
  typechecking, packaging, and named project tasks.
- **`kovo`** is the **framework CLI**. Use `kovo dev` for the app server, `kovo build` for deploy
  output, and its graph commands for coverage, invalidation, guards, and audits.

The two compose: `vp` orchestrates, and `kovo` is often invoked _through_ a `vp` task. For example,
`vp run kovo-check` is a project task that runs `kovo check` under the hood (the repo wires this as
the `check:kovo` npm script).

## `vp` — the toolchain runner

`vp` is the Vite+ runner. Its everyday commands:

| Command         | What it does                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp dev`        | Start generic Vite directly. Do not use this for a Kovo app; it evaluates authored config before Kovo can establish its compiler trust root. Use `kovo dev <app-module>` instead. |
| `vp build`      | Build the app and component packages for production.                                                                                                                              |
| `vp test`       | Run the project's test suites.                                                                                                                                                    |
| `vp check`      | Typecheck + lint. Regenerates registries first, then runs TypeScript static checking over all wiring (handlers, routes & links, forms, targets, bindings, IDREFs, guards).        |
| `vp run <task>` | Run a named task from the Vite+ config — the general escape hatch for project-defined scripts.                                                                                    |
| `vp pack`       | Package the project / component library for publishing.                                                                                                                           |

`vp check` is where the framework's type-level guarantees land: it regenerates the registry `.d.ts`
files and runs `tsc`, so route renames, missing form fields, and dead links all surface as type
errors (this is the propagation property from [routing](/guides/routing/)).

In practice, a repo wires these into npm scripts that combine `vp` with extra gates:

```jsonc
{
  "scripts": {
    "check": "vp check && vp run typecheck-examples",
    "check:kovo": "vp run kovo-check", // a vp task that runs `kovo check`
    "test:integration": "vp run integration",
    "test:browser": "vp run browser",
  },
}
```

So `npm run check:kovo` → `vp run kovo-check` → `kovo check`. The npm script is the convenience name;
`vp` is the runner; `kovo` does the graph work.

## `kovo` — the framework CLI

`kovo` with no arguments lists its subcommands:

```sh
$ kovo
kovo: add, audit, build, dev, check, db, compile, explain, export, mcp, update-docs
```

Every command emits stable, versioned, diffable output (`kovo-check/v1`, `kovo-explain/v1`,
`kovo-db/v1`, …) — the same artifact a reviewer reads and an agent consumes.
Every command also accepts `--help` or `-h`; use that for the exact flag surface, and use the
[CLI API reference](/api/cli/) when you need the programmatic command wrappers.

## Start the app with `kovo dev`

Point `kovo dev` at the authored app entry. It loads Kovo's compiler and server controls, then starts
the Vite server from a runner-owned config. It does not discover or evaluate `vite.config.ts` by
default.

```sh
kovo dev ./src/app.tsx
kovo dev ./src/app.tsx --host 127.0.0.1 --port 4173 --strict-port
```

Pass `--config ./vite.config.ts` only when dev needs an authored client transform. The secure config
surface accepts `server.host`, `server.port`, `server.strictPort`, and client plugins limited to
`resolveId`, `load`, and `transform`. Build, test, lint, format, and run sections are ignored. Other
Vite fields and lifecycle hooks fail closed because they can replace the SSR compiler graph. The
ordinary Vite+ commands still read the complete config for their own build, test, lint, format, and
task workflows.

## Build the graph artifact first

Every `kovo check` and graph-backed `kovo explain` command reads an extracted graph artifact.
`kovo build` writes it to `dist/.kovo/graph.json`. With no path argument, the CLI looks for
`graph.json`, then `.kovo/graph.json`, then `dist/.kovo/graph.json` in the current working
directory. That means a bare `kovo check` in a fresh clone can pass vacuously because there is no
graph yet. Build first, run the command from the app root, or pass the path explicitly.

### `kovo check` — the graph/coverage check

Runs the framework's consistency and exhaustiveness verifier over the app graph: touch-graph
consistency, optimistic exhaustiveness (KV310), update coverage (KV311), endpoint posture,
source/sink inventory, and the fixpoint / render-equivalence invariants. The focused sub-checks are
positional, not dash-flags:

```sh
kovo check                      # full consistency check
kovo check optimistic           # optimistic exhaustiveness only
kovo check coverage             # update-coverage (every query/state position has a status)
kovo check coverage graph.json  # against a pre-emitted graph artifact
kovo check endpoint-posture .kovo/endpoint-posture.json
kovo check sources-sinks
```

If you want the command to be explicit in CI logs, point it at `dist/.kovo/graph.json` directly
instead of relying on discovery.

### `kovo explain` — print the decision tree

`kovo explain` is the compiler's decision tree on demand. It has two shapes: explain a single subject,
or run a stable security review mode over the graph.

**Explain a subject** — `kovo explain <kind> <target> [graph.json]`, where `<kind>` is one of
`component`, `mutation`, `query`, `page`, `context`:

```sh
kovo explain component cart          # extracted handlers, derives, capture channels, platform substitutions, attribute merges, triggers
kovo explain query cart              # read set, consumers, every mutation that invalidates it
kovo explain mutation cart/add       # writes → domains → invalidated queries → consumers; guard chain
kovo explain page /products/:id      # modulepreloads, prefetch config, param/search schemas, query payloads
kovo explain document                # document shell, head/body slots, CSP, scripts, and stylesheets
```

Two target-specific flags:

```sh
kovo explain mutation cart/add --optimistic   # transform coverage per query; derivation traces + punts
kovo explain page /products/:id --layouts     # the page's resolved layout chain
```

**Run a review mode** — these are mutually-exclusive modes that scan the whole app. The blocking
access modes accept `--fail-on-findings` so CI can fail on results:

```sh
kovo explain --unguarded [--fail-on-findings] [graph.json]   # everything reachable without authentication
kovo explain --unscoped  [--fail-on-findings] [graph.json]   # rows not tied to a principal via the owner: annotation
kovo explain --endpoints [graph.json]                        # the machine-ingress audit (see below)
kovo explain --revealed [graph.json]                         # confidential fields intentionally revealed
kovo explain --access [--fail-on-findings] [graph.json]      # explicit access decisions
kovo explain --sources-sinks                                 # source/sink inventory
kovo explain --cookies [graph.json]                          # cookie downgrade and posture audit
```

- **`--unguarded`** lists every mutation, route, and query reachable without auth — the audit guards
  enroll pages in (see [routing](/guides/routing/)) and mutations enroll in (see
  [mutations](/guides/mutations/)).
- **`--unscoped`** uses the schema's `owner:` annotation to flag data not tied to a principal.
- **`--endpoints`** is the stable security-review surface: a diffable table of every declared
  `endpoint()` and `webhook()`, plus every route returning `respond.file()`/`respond.stream()`, with
  name, method, path, mount mode, auth scheme, and CSRF posture (`checked` or `exempt:<justification>`).
- **`--revealed`** lists confidentiality reveals, including `trustedReveal(...)` rows that need human
  review.
- **`--access`** lists explicit public/authenticated/machine access decisions.
- **`--cookies`** lists cookie posture and downgrade findings.

Capability-style review currently runs through the concrete shipped surfaces: `--revealed`,
`--trust`, `--endpoints`, and `--sources-sinks`. Do not use `--capabilities` as a blocking
capability-URL proof in technical preview.

### `kovo add` — vendor a UI component

Copies a vendored `@kovojs/ui` component into your app source (shadcn-style — it becomes your code,
not a dependency):

```sh
kovo add button card dialog            # copy into the default src/components/ui
kovo add tabs --out src/components/ui  # choose the destination
```

The catalog covers the headless-UI family (accordion, alert-dialog, autocomplete, button, checkbox,
combobox, dialog, dropdown-menu, popover, select, tabs, toast, toggle, tooltip, and more — see
[components](/guides/components/)).

### `kovo build` — verified production build of an app module

Runs the production preflights, then builds a Kovo app module into a preset output. When the app
belongs to a TypeScript project, the command runs `tsc --noEmit` for the nearest `tsconfig.json`;
after loading the app it derives the same graph used by `kovo check` and fails on verifier findings
before writing deploy artifacts.

```sh
kovo build ./src/app.ts                          # → dist/
kovo build ./src/app.ts --out build --preset vercel
```

`--preset` selects the deployment target (`node`, `vercel`, `cloudflare`); `--out` overrides the
output directory (default `dist`). See [deployment](/guides/deployment/).

### `kovo db` — migrate, provision, and check Postgres posture

Applies or verifies the framework-owned Postgres database posture derived from `src/schema.ts`:
reviewed SQL migrations, roles, forced RLS, owner policies, grants, and the closure audit. External
Postgres migration/provisioning uses a privileged admin URL. Check witnesses the ordinary runtime
session, then binds an independent authority audit to that exact live database before it verifies
the closed privilege set. Prefer the dedicated least-privilege system login as the check authority;
use the admin URL only when CI cannot access that login. Provision also receives the ordinary
runtime URL so Kovo can install its exact membership and state-table read grants.

```sh
kovo db generate --migrations migrations
KOVO_ADMIN_DATABASE_URL=postgres://admin@db:5432/app?sslmode=verify-full KOVO_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full \
  kovo db provision --migrations migrations
KOVO_DB_SYSTEM_URL=postgres://kovo_system@db:5432/app?sslmode=verify-full KOVO_RUNTIME_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full \
  kovo db check
kovo db check --driver pglite --data-dir .kovo/pglite
```

External `kovo db check` requires the runtime witness URL plus either the system authority URL
(`KOVO_DB_SYSTEM_URL` or `--system-database-url`) or the admin fallback. When both authorities are
present, check uses the system URL. Supplying only one side of the proof fails before connection
instead of checking a different database or falling back to embedded PGlite.
The output includes `TARGET source=...`, the four role lines, and any runtime membership edges:

```text
TARGET source=runtime
ROLE readerRole="kovo_reader" management=create
ROLE writerRole="kovo_writer" management=create
ROLE adminRole="kovo_admin" management=create
ROLE systemRole="kovo_system" management=create
ROLE runtimeLogin="app"
MEMBERSHIP member="app" role="kovo_reader" owner=kovo status=present
MEMBERSHIP member="app" role="kovo_writer" owner=kovo status=present
```

If a reporting view or materialized view is intentionally public, declare it in the app runtime
config with `declarePublicRelation(...)`. Otherwise the closure audit refuses reachable relations
that cannot prove Kovo RLS.

If your provider or DBA owns role creation, pre-create the role topology and set
`KOVO_DB_READER_ROLE`, `KOVO_DB_WRITER_ROLE`, `KOVO_DB_ADMIN_ROLE`, and `KOVO_DB_SYSTEM_ROLE` before
`kovo db provision`. Kovo adopts those roles and skips `CREATE ROLE`. It still verifies that every
adopted role exists, that the runtime login can assume the reader and writer roles, and that ordinary
runtime code cannot assume the admin or system roles. If the runtime membership is missing, grant it
directly in Postgres or run `kovo db provision` with a privileged admin URL so Kovo can grant it.

Kovo's scoped Postgres runtime depends on transaction-local `SET LOCAL ROLE` and
`set_config(..., true)`. Direct Postgres pools and transaction-mode poolers are supported; PgBouncer
statement mode is not, because it cannot preserve the transaction boundary that contains the role
and principal.

`kovo db check` exits non-zero when posture is missing or stale, so production boot and CI can fail
closed instead of serving an unprotected table. `kovo db generate` emits conservative additive
`*.up.sql` / `*.down.sql` files for missing tables and columns. Review them before `kovo db migrate`;
renames, destructive changes, and data backfills stay hand-authored.

### `kovo compile` — emit compiler-backed artifacts

Emits lowered IR and graph facts without importing `@kovojs/compiler` directly — the same lowering the
dev server and build use, exposed as a command (useful for tooling, fixtures, and the fixpoint gate).
It takes a target subcommand:

```sh
kovo compile component src/cart-badge.tsx --out cart-badge.kovo.tsx [--check] [--fixpoint] [--render-equivalence]
kovo compile route src/app.tsx --out app.route.tsx [--check]
kovo compile graph input.json --out graph.json [--check]
kovo compile mutation-inputs src/cart.mutations.ts --out facts.json
kovo compile drizzle-static input.json --out facts.json
kovo compile drizzle-optimistic input.json --out optimistic.ts
kovo compile package-css @acme/primitives --out primitives.css
```

The `component` target's `--fixpoint` and `--render-equivalence` flags exercise the compiler's hard
invariants — that the lowered IR is valid input (`compile(compile(src)) === compile(src)`) and renders
byte-identically to source.

### `kovo audit` — security/access audits

Runs the security and access audits over the app graph as one command:

```sh
kovo audit [--fail-on-findings] [graph.json]
```

This rolls up the same auth/ingress posture the `explain --unguarded`/`--unscoped`/`--endpoints`
modes surface, in a form CI can block on with `--fail-on-findings`.

### `kovo export` — static export

Statically exports an app module to disk — replaying synthetic GET requests through the same handler,
so there is no second render path:

```sh
kovo export ./src/app.ts --out dist [--origin https://example.com] [--skip-non-exportable]
kovo export ./src/app.ts --vite --root . --out dist   # load the module via Vite SSR
```

Export is L0/L1 only: a route with a guard, unproven session dependence, mutation-only interaction,
or a param path without enumerated `staticPaths` fails or skips loudly with **KV229**, according to
the export policy (`--skip-non-exportable` chooses skip). See [deployment](/guides/deployment/).

### `kovo update-docs` — refresh local agent docs

Refreshes the generated Kovo section in `AGENTS.md` and mirrors agent-readable docs into
`./.kovo/docs/`:

```sh
kovo update-docs
```

The command fetches the latest docs from kovo.sh when available. If the fetch fails, it falls back to
the bundled docs snapshot and says so in its output. The embedded `kovo-rules-version` is package
version provenance only; docs may still be refreshed within the same package version, so run
`kovo update-docs` when you want the newest local agent docs.

### `kovo mcp` — Model Context Protocol server

Runs an MCP server over stdio (newline-delimited JSON-RPC), exposing the same structured diagnostics
and `compile`/`check`/`explain` results to agents:

```sh
kovo mcp
```

MCP is a rendering/query surface over the existing diagnostics, not a second diagnostic channel — an
agent gets the identical codes, severities, and help text a human sees.

## How they compose

```
npm script  →  vp  →  kovo
─────────────────────────────────────────────
npm run check        →  vp check                       (typecheck + lint, regenerates registries)
npm run check:kovo   →  vp run kovo-check  →  kovo check   (graph consistency + coverage)
npm run test:*       →  vp run <task>                   (project test suites)
```

Use `vp` to _run things_; use `kovo` to _ask the graph questions_ and emit artifacts. In CI,
`kovo build` reruns the production TypeScript and graph-verifier preflights before emitting deploy
output; keep `kovo check` as an explicit earlier step when you want a stable `kovo-check/v1` log or
to debug touch-graph consistency, optimistic exhaustiveness, and update coverage without building.

## Next

- [Reading kovo check & kovo explain](/guides/kovo-explain/) — interpreting the output in depth.
- [CLI API reference](/api/cli/) — programmatic command wrappers and manifest-backed command data.
- [create-kovo command reference](/api/create-kovo/) — scaffold flags, dialects, and write safety.
- [Deployment](/guides/deployment/) — `kovo build` presets and `kovo export`.
- [Testing](/guides/testing/) — what `vp test` runs and the browser-free verification surface.

<details>
<summary>Spec & diagnostics</summary>

The compiler pipeline, hard rules (1:1 mapping, fixpoint, registry atomicity that `kovo dev`/`vp check`
rely on), and `kovo explain` sub-commands: SPEC §5.1–5.3. The verification surface — TypeScript
checking, `kovo check`, graph queries over `kovo explain`, and the `--endpoints` machine-ingress
audit: SPEC §11.4. Diagnostic severities and blocking policy: SPEC §11.3. Static export (`kovo
export`, KV229) and the request shell: SPEC §9.5. The CLI command surface (subcommands, flags,
positional sub-checks) is verified against `packages/cli/src/commands-manifest.ts` and the
`index.kovo-*.test.ts` suites.

API reference: [@kovojs/ui](/api/ui/), [@kovojs/cli](/api/cli/), [create-kovo](/api/create-kovo/).

</details>
