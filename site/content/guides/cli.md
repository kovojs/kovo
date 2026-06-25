---
title: The kovo & vp CLIs
description: Two distinct tools — vp runs the project toolchain, kovo answers questions about your app's graph — and how they compose through npm scripts.
order: 6.7
---

# The kovo & vp CLIs

Kovo projects use **two distinct binaries**, and keeping them straight saves confusion:

- **`vp`** is the **project / toolchain runner** — Vite+ (`vite-plus`). It is how you run the dev
  server, build, test, typecheck, and run named project tasks. Day-to-day, `vp` is the command you
  type most.
- **`kovo`** is the **framework CLI**. It answers questions about your app's _graph_ — coverage,
  invalidation, guards, audits — and emits compiler-backed artifacts. It is the legibility surface:
  `kovo explain` prints the same stable, diffable text humans and agents both read.

The two compose: `vp` orchestrates, and `kovo` is often invoked _through_ a `vp` task. For example,
`vp run kovo-check` is a project task that runs `kovo check` under the hood (the repo wires this as
the `check:kovo` npm script).

## `vp` — the toolchain runner

`vp` is the Vite+ runner. Its everyday commands:

| Command         | What it does                                                                                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp dev`        | Start the dev server. Regenerates Kovo registries before typechecking (so a stale registry is unrepresentable), serves pages, and reports compiler diagnostics through Vite's overlay and terminal. |
| `vp build`      | Build the app and component packages for production.                                                                                                                                                |
| `vp test`       | Run the project's test suites.                                                                                                                                                                      |
| `vp check`      | Typecheck + lint. Regenerates registries first, then runs TypeScript static checking over all wiring (handlers, routes & links, forms, targets, bindings, IDREFs, guards).                          |
| `vp run <task>` | Run a named task from the Vite+ config — the general escape hatch for project-defined scripts.                                                                                                      |
| `vp pack`       | Package the project / component library for publishing.                                                                                                                                             |

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
kovo: add, audit, build, check, compile, explain, export, mcp, update-docs
```

Every command emits stable, versioned, diffable output (`kovo-check/v1`, `kovo-explain/v1`, …) — the
same artifact a reviewer reads and an agent consumes.

### `kovo check` — the graph/coverage check

Runs the framework's consistency and exhaustiveness verifier over the app graph: touch-graph
consistency, optimistic exhaustiveness (KV310), update coverage (KV311), and the fixpoint /
render-equivalence invariants. The two sub-checks are positional, not dash-flags:

```sh
kovo check                      # full consistency check
kovo check optimistic           # optimistic exhaustiveness only
kovo check coverage             # update-coverage (every query/state position has a status)
kovo check coverage graph.json  # against a pre-emitted graph artifact
```

### `kovo explain` — print the decision tree

`kovo explain` is the compiler's decision tree on demand. It has two shapes: explain a single subject,
or run a stable machine-ingress/auth audit.

**Explain a subject** — `kovo explain <kind> <target> [graph.json]`, where `<kind>` is one of
`component`, `mutation`, `query`, `page`, `context`:

```sh
kovo explain component cart          # extracted handlers, derives, capture channels, platform substitutions, attribute merges, triggers
kovo explain query cart              # read set, consumers, every mutation that invalidates it
kovo explain mutation cart/add       # writes → domains → invalidated queries → consumers; guard chain
kovo explain page /products/:id      # modulepreloads, prefetch config, param/search schemas, query payloads
```

Two target-specific flags:

```sh
kovo explain mutation cart/add --optimistic   # transform coverage per query; derivation traces + punts
kovo explain page /products/:id --layouts     # the page's resolved layout chain
```

**Run an audit** — these are mutually-exclusive modes that scan the whole app, each accepting an
optional `--fail-on-findings` to make CI block on results:

```sh
kovo explain --unguarded [--fail-on-findings] [graph.json]   # everything reachable without authentication
kovo explain --unscoped  [--fail-on-findings] [graph.json]   # rows not tied to a principal via the owner: annotation
kovo explain --endpoints [graph.json]                        # the machine-ingress audit (see below)
```

- **`--unguarded`** lists every mutation, route, and query reachable without auth — the audit guards
  enroll pages in (see [routing](/guides/routing/)) and mutations enroll in (see
  [mutations](/guides/mutations/)).
- **`--unscoped`** uses the schema's `owner:` annotation to flag data not tied to a principal.
- **`--endpoints`** is the stable security-review surface: a diffable table of every declared
  `endpoint()` and `webhook()`, plus every route returning `respond.file()`/`respond.stream()`, with
  name, method, path, mount mode, auth scheme, and CSRF posture (`checked` or `exempt:<justification>`).

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

### `kovo build` — production build of an app module

Builds a Kovo app module into a preset production output:

```sh
kovo build ./src/app.ts                          # → dist/
kovo build ./src/app.ts --out build --preset vercel
```

`--preset` selects the deployment target (`node`, `vercel`, `cloudflare`); `--out` overrides the
output directory (default `dist`). See [deployment](/guides/deployment/).

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

Use `vp` to _run things_; use `kovo` to _ask the graph questions_ and emit artifacts. In CI a typical
gate is `vp check` (TypeScript proves all wiring) followed by `kovo check` (the framework proves
touch-graph consistency, optimistic exhaustiveness, and update coverage) — together they make an app's
wiring proof-carrying without executing a browser.

## Next

- [Reading kovo check & kovo explain](/guides/kovo-explain/) — interpreting the output in depth.
- [create-kovo command reference](/api/create-kovo/) — scaffold flags, dialects, and write safety.
- [Deployment](/guides/deployment/) — `kovo build` presets and `kovo export`.
- [Testing](/guides/testing/) — what `vp test` runs and the browser-free verification surface.

<details>
<summary>Spec & diagnostics</summary>

The compiler pipeline, hard rules (1:1 mapping, fixpoint, registry atomicity that `vp dev`/`vp check`
rely on), and `kovo explain` sub-commands: SPEC §5.1–5.3. The verification surface — TypeScript
checking, `kovo check`, graph queries over `kovo explain`, and the `--endpoints` machine-ingress
audit: SPEC §11.4. Diagnostic severities and blocking policy: SPEC §11.3. Static export (`kovo
export`, KV229) and the request shell: SPEC §9.5. The CLI command surface (subcommands, flags,
positional sub-checks) is verified against `packages/cli/src/commands-manifest.ts` and the
`index.kovo-*.test.ts` suites.

</details>
