---
title: The kovo CLI
description: Use one framework command for development, checks, tests, builds, and inspection.
order: 6.7
---

# The kovo CLI

Kovo apps have one command surface:

- `kovo dev` starts the app.
- `kovo check` joins formatting, lint, TypeScript, compiler, security, and current-source proof.
- `kovo test` runs the project tests with Kovo's bootstrap ordering.
- `kovo build` repeats the source proof and adds deployment checks.

Vite Plus remains a pinned implementation dependency. App scripts and CI do not need to know which
runner implements a phase.

## Daily commands

| Command      | What it does                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `kovo dev`   | Establish Kovo's trust roots, then start the development server.                                 |
| `kovo check` | Format-check, lint, typecheck, and derive current compiler/security proof without deploy output. |
| `kovo test`  | Run Vitest through Kovo's bootstrap-first test ordering.                                         |
| `kovo build` | Prove source and emit output after preset, least-privilege, and retention checks.                |
| `kovo fix`   | Apply compiler-proven rewrites, API migrations, or `kovo fix format`.                            |

`kovo check` is where the framework's type-level guarantees land: it regenerates the registry `.d.ts`
files and runs `tsc`, so route renames, missing form fields, and dead links all surface as type
errors (this is the propagation property from [routing](/guides/routing/)).

The generated package scripts are intentionally thin:

```jsonc
{
  "scripts": {
    "dev": "kovo dev ./src/app.tsx",
    "check": "kovo check",
    "test": "kovo test",
    "build:prod": "kovo build ./src/app.tsx",
  },
}
```

`kovo` with no arguments prints categorized root help. Its current capability commands are:

- Daily and build: `add`, `build`, `dev`, `doctor`, `export`, `test`
- Inspect and security: `audit`, `check`, `explain`, `incident`
- Agent and operator: `compile`, `db`, `docs`, `fix`, `mcp`, `update-docs`

One-shot inspection and build commands emit stable, versioned, diffable results where their help
names a result protocol (`kovo-check/v1`, `kovo-explain/v1`, `kovo-db/v1`, …). Long-lived commands
such as `dev`, and commands that do not yet name a result protocol, are not covered by that claim.
Every command accepts `--help` or `-h`; use that for the exact flag surface, and use the
[CLI API reference](/api/cli/) for the public semantic command facade.

## Start the app with `kovo dev`

Point `kovo dev` at the authored app entry. It loads Kovo's compiler and server controls, then starts
the Vite server from a runner-owned config. It does not discover or evaluate `vite.config.ts` by
default.

```sh
kovo dev ./src/app.tsx
kovo dev ./src/app.tsx --host 127.0.0.1 --port 4173 --strict-port
```

The runner prints the exact loopback URL after the socket binds. Generated Better Auth apps use
that same origin when `BETTER_AUTH_URL` is unset, including when the selected port changes.

Pass `--config ./vite.config.ts` only when dev needs an authored client transform. The secure config
surface accepts `server.host`, `server.port`, `server.strictPort`, and client plugins limited to
`resolveId`, `load`, and `transform`. Build, test, lint, format, and run sections are ignored. Other
Vite fields and lifecycle hooks fail closed because they can replace the SSR compiler graph. The
framework-owned test, lint, and format adapters still read the complete project configuration.

## Check current source; inspect artifacts explicitly

Bare `kovo check` reruns TypeScript, loads `./src/app.tsx`, derives a fresh compiler/security graph,
and verifies it without writing `dist`. Use `kovo check source <app-module>` when the authored entry
lives elsewhere. This source proof intentionally stops before deployment preset, artifact,
least-privilege, and retention checks; `kovo build` owns those.

Graph-backed `kovo explain` and focused compatibility checks still consume an extracted graph.
Pass that graph explicitly, or create a conventional graph first. Missing graph input is an error,
never an empty passing proof synthesized from absence.

### `kovo check` — current-source proof and focused artifact checks

The source form runs the framework's consistency and exhaustiveness verifier over freshly derived
app facts: touch-graph consistency, optimistic exhaustiveness (KV310), update coverage (KV311),
source/sink inventory, and the fixpoint / render-equivalence invariants. Focused artifact checks are
positional, not dash-flags:

```sh
kovo check                               # current ./src/app.tsx; no deploy artifacts
kovo check source ./src/admin-app.tsx    # current source from another authored entry
kovo check --no-cache                    # force every current-source derivation
kovo check optimistic graph.json         # optimistic exhaustiveness for an artifact
kovo check coverage graph.json           # update coverage for an artifact
kovo check endpoint-posture                  # framework-owned production probe + artifact check
kovo check sources-sinks
kovo check advisories dist/.kovo/graph.json
```

Keep bare `kovo check` as the fast current-source CI log. Use the explicit graph forms only when the
artifact itself is the subject under review.

### Check published security advisories

Run the advisory check against the graph you plan to deploy:

```sh
kovo check advisories dist/.kovo/graph.json
```

The command authenticates Kovo's signed feed and compares its version ranges with the exact package
versions stamped into that graph. `AFFECTED` at or above the default `high` floor exits 1.
`UNKNOWN` exits 2, including when the feed is offline, stale, rolled back, or has no valid release
attestation. Do not turn `UNKNOWN` into success in CI. `NOT-AFFECTED` only means no published entry
in the authenticated feed matches this artifact; it is not a claim that the app has no
vulnerabilities.

Use `--severity-floor moderate` to tighten the blocking threshold. `--feed`, `--attestation`, and
`--state` exist for the release fire drill and offline verification; local feed files still require
a valid Sigstore bundle. Give overrides a dedicated `--state` path so a drill epoch cannot advance
the production feed's rollback floor.

### `kovo explain` — print the decision tree

`kovo explain` is the compiler's decision tree on demand. It has one grammar: the first token is
always a view. Targeted views take a subject; stable security-review views take an optional graph.

**Explain a subject** — `kovo explain <kind> <target> [graph.json]`, where `<kind>` is one of
`component`, `mutation`, `query`, `page`, `context`, `task`:

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

<!-- kovo-sample: illustrative reason="Bracketed tokens show optional CLI arguments; this block is a usage synopsis, not literal shell input." -->

```sh
kovo explain unguarded [--fail-on-findings] [graph.json]   # everything reachable without authentication
kovo explain unscoped  [--fail-on-findings] [graph.json]   # rows not tied to a principal via the owner: annotation
kovo explain endpoints [graph.json]                        # the machine-ingress audit (see below)
kovo explain revealed [graph.json]                         # confidential fields intentionally revealed
kovo explain capabilities [graph.json]                     # dangerous capabilities + static Postgres lease contract
kovo explain access [--fail-on-findings] [graph.json]      # explicit access decisions
kovo explain sources-sinks                                 # source/sink inventory
kovo explain cookies [graph.json]                          # cookie downgrade and posture audit
```

- **`kovo explain unguarded`** lists every mutation, route, and query reachable without auth — the audit guards
  enroll pages in (see [routing](/guides/routing/)) and mutations enroll in (see
  [mutations](/guides/mutations/)).
- **`kovo explain unscoped`** uses the schema's `owner:` annotation to flag data not tied to a principal.
- **`kovo explain endpoints`** is the stable security-review surface: a diffable table of every declared
  `endpoint()` and `webhook()`, plus every route returning `respond.file()`/`respond.stream()`, with
  name, method, path, mount mode, auth scheme, and CSRF posture (`checked` or `exempt:<justification>`).
- **`kovo explain revealed`** lists confidentiality reveals, including exact typed declassification-policy
  rows that need human review.
- **`kovo explain capabilities`** lists held dangerous capabilities and the framework-owned external-Postgres
  posture-lease contract. It reads the graph, not a running server, so live status, digest, and expiry
  are printed as `not-observed`.
- **`kovo explain access`** lists explicit public/authenticated/machine access decisions.
- **`kovo explain cookies`** lists cookie posture and downgrade findings.

Capability-style review currently runs through the concrete shipped surfaces:
`kovo explain revealed`,
`kovo explain trust`, `kovo explain endpoints`, `kovo explain sources-sinks`, and the audit-only
`kovo explain capabilities` table. Do not use
`kovo explain capabilities` as a blocking capability-URL proof or as live lease-health telemetry in technical
preview.

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

Reruns the same current-source proof as `kovo check`, then verifies the selected deployment preset,
artifact posture, least-privilege posture, and deploy-skew retention before emitting. A source check
can therefore pass before deployment is configured while build remains fail-closed, including KV417
for an unsupported retention window.

```sh
kovo build ./src/app.tsx                          # → dist/
kovo build ./src/app.tsx --out build --preset vercel
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
statement mode is not. The runtime now proves that assumption on every posture witness: two
statements in one transaction must keep the same backend PID, database, users, and random
transaction-local frame.

The external-Postgres posture check is leased after boot. Kovo renews on a 30-second base cadence
with process-stable jitter and on permission failures. The lease expires after 120 seconds with no
serve-degraded grace. Drift or renewal failure sheds new database requests and drains pooled
sessions. Fix transient drift and Kovo can re-witness the exact boot baseline; after an intentional
posture change, restart the process so it can authorize a new baseline. Run
`kovo explain capabilities graph.json` to review the static contract and its bounds. That command
does not connect to the live process; its `liveStatus`, `liveDigest`, and `liveExpiry` fields say
`not-observed` on purpose.

`kovo db check` exits non-zero when posture is missing or stale, so production boot and CI can fail
closed instead of serving an unprotected table. `kovo db generate` emits conservative additive
`*.up.sql` / `*.down.sql` files for missing tables and columns. Review them before `kovo db migrate`;
renames, destructive changes, and data backfills stay hand-authored.

### `kovo compile` — emit compiler-backed artifacts

Emits lowered IR and graph facts without importing `@kovojs/compiler` directly — the same lowering the
dev server and build use, exposed as a command (useful for tooling, fixtures, and the fixpoint gate).
It takes a target subcommand:

<!-- kovo-sample: illustrative reason="Bracketed tokens show optional CLI arguments; this block is a usage synopsis, not literal shell input." -->

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

<!-- kovo-sample: illustrative reason="Bracketed tokens show optional CLI arguments; this block is a usage synopsis, not literal shell input." -->

```sh
kovo audit [--fail-on-findings] [graph.json]
```

This rolls up the same auth/ingress posture as `kovo explain unguarded`, `kovo explain unscoped`,
and `kovo explain endpoints`
modes surface, in a form CI can block on with `--fail-on-findings`.

### `kovo export` — static export

Statically exports an app module to disk — replaying synthetic GET requests through the same handler,
so there is no second render path:

<!-- kovo-sample: illustrative reason="Bracketed tokens show optional CLI arguments; this block is a usage synopsis, not literal shell input." -->

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

The command copies docs from the exact installed CLI package; it never inserts live website bytes
into `AGENTS.md` or the agent-readable mirror. The embedded `kovo-rules-version` therefore identifies
the software supply-chain version that supplied those instructions. Upgrade Kovo first, then run
`kovo update-docs` to refresh the local snapshot.

### `kovo mcp` — Model Context Protocol server

Runs an MCP server over stdio (newline-delimited JSON-RPC), exposing the same structured diagnostics
and `compile`/`check`/`explain` results to agents:

```sh
kovo mcp
```

MCP is a rendering/query surface over the existing diagnostics, not a second diagnostic channel — an
agent gets the identical codes, severities, and help text a human sees.

The surface is deliberately finite. `kovo_check` and `kovo_explain` accept bounded inline graphs,
not graph paths. `compile_component` accepts only a launch-workspace-relative `fileName` plus inline
app source; protocol callers cannot select package-discovery roots or inject registry/query/package
facts. Requests, compiler source/AST work, graph joins, output size, and calls per session all have
fail-closed limits. Start `kovo mcp` from the workspace whose package manifests compilation may
inspect; that canonical directory is pinned before the first request.

## Run a command from TypeScript

Use `runKovoCommand` when a tool needs the real Kovo command contract without constructing argv.
The discriminated request type derives its form names, arguments, option names, enum values, and
boolean polarity from the same schema as help and completion:

```ts
import { runKovoCommand } from '@kovojs/cli';

const exitCode = await runKovoCommand({
  arguments: { appModule: './src/app.tsx' },
  command: 'build',
  form: 'build',
  options: { check: true, out: 'dist', preset: 'node' },
});
```

For a valid one-shot semantic request, the call writes the command's normal stdout or stderr and
resolves to `0`, `1`, or `2`. Invalid JavaScript objects are rejected before dispatch. Long-lived
`dev` and `mcp` processes stay on the executable surface until Kovo has an explicit abort/disposal
contract. The public module does not expose the argv dispatcher, diagnostic construction internals,
or transport internals.

## How the scripts compose

```text
npm script         →  kovo
────────────────────────────────────────────────────────────
npm run check      →  kovo check  (format + lint + type + compiler/security proof)
npm run test       →  kovo test   (bootstrap-first project tests)
npm run build:prod →  kovo build  (source proof + deployment proof + output)
```

In CI, `kovo build` reruns the source verifier and adds the deployment gates before emitting output.
Keep `kovo check` as an explicit earlier step for a stable `kovo-check/v1` log and a quick loop that
does not pretend deployment retention has been configured.

## Next

- [Reading kovo check & kovo explain](/guides/kovo-explain/) — interpreting the output in depth.
- [CLI API reference](/api/cli/) — the one-shot semantic command facade and verifier helpers.
- [create-kovo command reference](/api/create-kovo/) — scaffold flags, dialects, and write safety.
- [Deployment](/guides/deployment/) — `kovo build` presets and `kovo export`.
- [Testing](/guides/testing/) — what `kovo test` runs and the browser-free verification surface.

<details>
<summary>Spec & diagnostics</summary>

The compiler pipeline, hard rules (1:1 mapping, fixpoint, registry atomicity that `kovo dev`/`kovo check`
rely on), and `kovo explain` sub-commands: SPEC §5.1–5.3. The verification surface — TypeScript
checking, `kovo check`, graph queries over `kovo explain`, and the `kovo explain endpoints` machine-ingress
audit: SPEC §11.4. Diagnostic severities and blocking policy: SPEC §11.3. Static export (`kovo
export`, KV229) and the request shell: SPEC §9.5. The CLI command surface (subcommands, flags,
positional sub-checks) is derived from `packages/cli/src/command-schema.ts` and verified by the
command-contract and `index.kovo-*.test.ts` suites.

API reference: [@kovojs/ui](/api/ui/), [@kovojs/cli](/api/cli/), [create-kovo](/api/create-kovo/).

</details>
