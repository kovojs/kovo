/**
 * @internal
 *
 * Shared command manifest for the `kovo` bin. This is build/docs tooling, not a
 * public API: it is the single source of truth for the CLI's command surface
 * (the same commands `main`/`mainAsync` dispatch in `./index.ts`) and the usage
 * strings those dispatchers emit.
 *
 * The docs generator (`site/scripts/cli-ref.mjs`) imports this manifest to render
 * the command-first `/api/cli/` page, and `./index.ts` imports the exported usage
 * constants so the bin and the docs cannot drift. A vitest drift guard
 * (`./commands-manifest.test.ts`) asserts the manifest covers every dispatched
 * command and that each usage constant matches the literal the CLI emits.
 *
 * Marked `@internal` so it stays out of the public `@kovojs/cli` API surface (the
 * api-surface gate, `scripts/api-surface-gate.mjs`) — it is reachable only through
 * the `@kovojs/cli/internal` subpath and the docs tooling, never the `.` export.
 */

/** @internal Usage line emitted for `kovo check` (see `writeCheckUsageError`). */
export const CHECK_USAGE =
  'usage: kovo check [optimistic|coverage|endpoint-posture|sources-sinks] [graph.json]';

/** @internal Usage line emitted for `kovo audit` (see `parseAuditArgs`). */
export const AUDIT_USAGE = 'usage: kovo audit [--fail-on-findings] [graph.json]';

/** @internal Usage forms emitted for `kovo explain` (see `explainUsage`). */
export const EXPLAIN_USAGE = [
  'usage: kovo explain component|mutation|query|page|context <target> [--optimistic] [--layouts] [graph.json]',
  '       kovo explain document [graph.json]',
  '       kovo explain --sources-sinks',
  '       kovo explain --endpoints [graph.json]',
  '       kovo explain --revealed [graph.json]',
  '       kovo explain --trust [graph.json]',
  '       kovo explain --access [--fail-on-findings] [graph.json]',
  '       kovo explain --unguarded [--fail-on-findings] [graph.json]',
  '       kovo explain --unscoped [--fail-on-findings] [graph.json]',
] as const;

/**
 * @internal Single-line `kovo explain` usage as emitted by the bin's error path.
 * The bin prints all explain forms on one line joined by ` | `; keep that exact
 * literal here so the drift guard can compare against `explainUsage()`.
 */
export const EXPLAIN_USAGE_LINE =
  'kovo explain component|mutation|query|page|context <target> [--optimistic] [--layouts] [graph.json] | kovo explain document [graph.json] | kovo explain --sources-sinks | kovo explain --endpoints [graph.json] | kovo explain --revealed [graph.json] | kovo explain --trust [graph.json] | kovo explain --capabilities [graph.json] | kovo explain --cookies [graph.json] | kovo explain --access [--fail-on-findings] [graph.json] | kovo explain --unguarded [--fail-on-findings] [graph.json] | kovo explain --unscoped [--fail-on-findings] [graph.json]';

/** @internal Usage line emitted for `kovo add` (see `addUsage`). */
export const ADD_USAGE = 'usage: kovo add <component...> [--out <dir>]';

/** @internal Usage line emitted for `kovo build` (see `buildUsage`). */
export const BUILD_USAGE =
  'usage: kovo build <app-module> [--out <dir>] [--preset <name>] [--no-cache]';

/** @internal Usage forms emitted for `kovo compile` (see `compileUsage`). */
export const COMPILE_USAGE = [
  'usage: kovo compile component <source.tsx> --out <artifact.tsx> [--file-name <name>] [--check] [--no-cache] [--fixpoint] [--render-equivalence] [--registry-facts <json>] [--query-shape-facts <json>] [--facts-out <json>] [--emit-client-files] [--allow-diagnostic <code>]',
  '       kovo compile route <source.tsx> --out <artifact.tsx> [--file-name <name>] [--artifact-file-name <name>] [--rewrite <Local=specifier>] [--facts-out <json>] [--check]',
  '       kovo compile graph <input.json> --out <graph.json> [--check]',
  '       kovo compile mutation-inputs <source.ts> --out <facts.json> [--file-name <name>] [--check]',
  '       kovo compile drizzle-static <input.json> --out <facts.json> [--check]',
  '       kovo compile drizzle-optimistic <input.json> --out <artifact.ts> [--facts-out <json>] [--check]',
  '       kovo compile package-css <package> --out <file.css> [--entry <source.ts>] [--check]',
] as const;

/** @internal Single-line `kovo compile` usage as emitted by the bin's error path. */
export const COMPILE_USAGE_LINE =
  'kovo compile component <source.tsx> --out <artifact.tsx> [--file-name <name>] [--check] [--no-cache] [--fixpoint] [--render-equivalence] [--registry-facts <json>] [--query-shape-facts <json>] [--facts-out <json>] [--emit-client-files] [--allow-diagnostic <code>] | kovo compile route <source.tsx> --out <artifact.tsx> [--file-name <name>] [--artifact-file-name <name>] [--rewrite <Local=specifier>] [--facts-out <json>] [--check] | kovo compile graph <input.json> --out <graph.json> [--check] | kovo compile mutation-inputs <source.ts> --out <facts.json> [--file-name <name>] [--check] | kovo compile drizzle-static <input.json> --out <facts.json> [--check] | kovo compile drizzle-optimistic <input.json> --out <artifact.ts> [--facts-out <json>] [--check] | kovo compile package-css <package> --out <file.css> [--entry <source.ts>] [--check]';

/** @internal Usage line emitted for `kovo export` (see `exportUsage`). */
export const EXPORT_USAGE =
  'usage: kovo export <app-module> [--vite] [--root <dir>] [--out <dir>] [--origin <url>] [--manifest <file> --dist <dir>] [--asset-base <path>] [--stylesheet-env <name>] [--skip-non-exportable]';

/** @internal Usage line emitted for `kovo mcp` (see `mcpUsage`). */
export const MCP_USAGE = 'usage: kovo mcp';

/** @internal Usage line emitted for `kovo update-docs`. */
export const UPDATE_DOCS_USAGE = 'usage: kovo update-docs';

/** @internal A single command-line flag and its human description. */
export interface CommandFlag {
  /** The flag token as typed on the command line, e.g. `--out <dir>`. */
  flag: string;
  /** Short prose describing what the flag does. */
  description: string;
}

/** @internal One `kovo <command>` entry rendered into the CLI docs page. */
export interface CommandManifestEntry {
  /** The dispatched sub-command name, e.g. `check`. */
  name: string;
  /** One-line summary of what the command does. */
  summary: string;
  /** Usage line(s) for the command, mirroring the bin's `usage:` literals. */
  usage: string | readonly string[];
  /** Recognized flags, if any. */
  flags?: readonly CommandFlag[];
  /** Copy-paste example invocations. */
  examples?: readonly string[];
  /** Whether the command is dispatched through `mainAsync` (async) vs `main`. */
  async?: boolean;
}

/**
 * @internal The full `kovo` command surface, in display order. Covers every
 * command `main`/`mainAsync` dispatches: check, explain, add, build, audit,
 * compile, export, mcp, update-docs.
 */
export const COMMANDS_MANIFEST: readonly CommandManifestEntry[] = [
  {
    name: 'check',
    summary:
      'Run the consistency and exhaustiveness verifier over an extracted app graph and report findings.',
    usage: CHECK_USAGE,
    flags: [
      {
        flag: 'optimistic',
        description:
          'Restrict to the optimistic-exhaustiveness slice (KV310) instead of the full check.',
      },
      {
        flag: 'coverage',
        description: 'Restrict to the update-coverage slice (KV311) instead of the full check.',
      },
      {
        flag: 'endpoint-posture',
        description: 'Restrict to endpoint response posture fixture verification.',
      },
      {
        flag: 'sources-sinks',
        description: 'Emit the Phase 1 source/sink inventory and write .kovo/sources-sinks.json.',
      },
    ],
    examples: [
      'kovo check',
      'kovo check coverage graph.json',
      'kovo check endpoint-posture .kovo/endpoint-posture.json',
      'kovo check sources-sinks',
    ],
  },
  {
    name: 'explain',
    summary:
      'Print the stable graph view for a single subject, or run the access/endpoints/trust audits.',
    usage: EXPLAIN_USAGE,
    flags: [
      { flag: '--optimistic', description: 'Include optimistic-update detail for the subject.' },
      {
        flag: '--sources-sinks',
        description: 'Print the Phase 1 source/sink inventory and write its JSON artifact.',
      },
      {
        flag: '--endpoints',
        description:
          'List the machine-ingress audit for endpoints, webhooks, file/stream routes, and dynamic surfaces.',
      },
      {
        flag: '--revealed',
        description:
          'List confidentiality reveals, distinguishing proof-grade projections from audit-grade arbitrary functions.',
      },
      {
        flag: '--trust',
        description: 'List explicit trust escape hatches and their provenance.',
      },
      {
        flag: '--access',
        description: 'Review explicit access decisions and missing-access facts.',
      },
      { flag: '--unguarded', description: 'Audit handlers reachable without a guard.' },
      { flag: '--unscoped', description: 'Audit storage access that is not tenant-scoped.' },
      {
        flag: '--fail-on-findings',
        description: 'Exit non-zero when the audit reports any findings.',
      },
    ],
    examples: [
      'kovo explain component Cart graph.json',
      'kovo explain document',
      'kovo explain --sources-sinks',
      'kovo explain --endpoints',
      'kovo explain --revealed',
      'kovo explain --trust',
      'kovo explain --access --fail-on-findings',
      'kovo explain --unguarded --fail-on-findings',
    ],
  },
  {
    name: 'add',
    summary: 'Copy a vendored @kovojs/ui component into your project (shadcn-style copy-in).',
    usage: ADD_USAGE,
    flags: [
      {
        flag: '--out <dir>',
        description:
          'Destination directory for the copied component (default: project components dir).',
      },
    ],
    examples: ['kovo add button', 'kovo add button card --out src/components/ui'],
  },
  {
    name: 'build',
    summary: 'Build a Kovo app module into node preset production output.',
    usage: BUILD_USAGE,
    async: true,
    flags: [
      {
        flag: '--out <dir>',
        description: 'Output directory for the neutral and preset artifacts.',
      },
      {
        flag: '--preset <name>',
        description:
          'Preset override. Current emitter: node; vercel/cloudflare fail loudly until their emitters land.',
      },
    ],
    examples: ['kovo build ./src/app-shell.ts --out dist'],
  },
  {
    name: 'compile',
    summary:
      'Emit compiler-backed app artifacts without importing @kovojs/compiler from app scripts.',
    usage: COMPILE_USAGE,
    async: true,
    flags: [
      { flag: '--out <path>', description: 'Artifact path to write or verify.' },
      {
        flag: '--check',
        description: 'Verify the existing artifact is current instead of writing it.',
      },
      {
        flag: '--file-name <name>',
        description: 'Logical source file name embedded in diagnostics and emitted IR.',
      },
      {
        flag: '--artifact-file-name <name>',
        description: 'Logical generated route artifact name embedded in route IR.',
      },
      {
        flag: '--rewrite <Local=specifier>',
        description: 'Route component import rewrite for generated component artifacts.',
      },
      {
        flag: '--registry-facts <json>',
        description: 'JSON registry facts passed to component lowering.',
      },
      {
        flag: '--facts-out <json>',
        description: 'Write compiler-derived component or route facts as JSON.',
      },
      {
        flag: '--emit-client-files',
        description: 'Write or check emitted component client artifacts alongside the lowered IR.',
      },
      {
        flag: '--allow-diagnostic <code>',
        description: 'Treat the named component diagnostic as a warning for this command.',
      },
      {
        flag: '--entry <source.ts>',
        description: 'Source entry used for package component-prefix discovery.',
      },
      { flag: '--fixpoint', description: 'Assert lowered component IR is already a fixpoint.' },
      {
        flag: '--render-equivalence',
        description: 'Assert authored and lowered component render output stays equivalent.',
      },
    ],
    examples: [
      'kovo compile component src/components/cart.tsx --out dist/kovo/cart.tsx --check',
      'kovo compile route src/app-shell.tsx --out dist/kovo/app-shell.kovo-route.tsx --rewrite Cart=./cart.js',
      'kovo compile mutation-inputs src/app.ts --out dist/kovo/mutation-inputs.json',
      'kovo compile drizzle-static dist/kovo/drizzle-static-input.json --out dist/kovo/drizzle-static-facts.json',
      'kovo compile drizzle-optimistic dist/kovo/cart-add.optimistic.json --out dist/kovo/optimistic/cart-add.ts',
      'kovo compile package-css @kovojs/ui --entry src/app.ts --out dist/assets/kovo-ui.css',
    ],
  },
  {
    name: 'audit',
    summary: 'Run the security/access audits over an extracted app graph.',
    usage: AUDIT_USAGE,
    flags: [
      {
        flag: '--fail-on-findings',
        description: 'Exit non-zero when the audit reports any findings.',
      },
    ],
    examples: ['kovo audit', 'kovo audit --fail-on-findings graph.json'],
  },
  {
    name: 'export',
    summary: 'Statically export a Kovo app module to disk for hosting.',
    usage: EXPORT_USAGE,
    async: true,
    flags: [
      { flag: '--vite', description: 'Load the app module through Vite SSR for TS/TSX app files.' },
      {
        flag: '--root <dir>',
        description: 'Project root for --vite module loading; defaults to the current directory.',
      },
      { flag: '--out <dir>', description: 'Output directory for the exported site.' },
      { flag: '--origin <url>', description: 'Absolute origin used for canonical URLs.' },
      {
        flag: '--manifest <file>',
        description: 'Copy static assets referenced by a Vite manifest into the export output.',
      },
      {
        flag: '--dist <dir>',
        description: 'Vite output directory used as the source root for manifest assets.',
      },
      {
        flag: '--asset-base <path>',
        description: 'URL path prefix for manifest asset hrefs; defaults to /.',
      },
      {
        flag: '--stylesheet-env <name>',
        description:
          'Set an environment variable to the manifest stylesheet href before loading the app.',
      },
      {
        flag: '--skip-non-exportable',
        description: 'Skip routes that cannot be statically exported instead of failing.',
      },
    ],
    examples: [
      'kovo export ./src/app.ts --out dist',
      'kovo export ./src/app.ts --origin https://example.com',
      'kovo export /src/app-shell.ts --vite --root . --out dist',
      'kovo export ./src/app.ts --manifest dist/.vite/manifest.json --dist dist',
    ],
  },
  {
    name: 'mcp',
    summary:
      'Run the Model Context Protocol server: read newline-delimited JSON-RPC from stdin, write responses to stdout.',
    usage: MCP_USAGE,
    async: true,
    examples: ['kovo mcp'],
  },
  {
    name: 'update-docs',
    summary: 'Refresh AGENTS.md and mirror the latest agent-readable Kovo docs into ./.kovo/docs.',
    usage: UPDATE_DOCS_USAGE,
    async: true,
    examples: ['kovo update-docs'],
  },
];
