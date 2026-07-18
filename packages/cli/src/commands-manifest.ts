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
  'usage: kovo explain component|mutation|query|page|context|task <target> [--optimistic] [--layouts] [graph.json]',
  '       kovo explain document [graph.json]',
  '       kovo explain --sources-sinks',
  '       kovo explain --tasks [graph.json]',
  '       kovo explain --endpoints [graph.json]',
  '       kovo explain --revealed [graph.json]',
  '       kovo explain --trust [graph.json]',
  '       kovo explain --capabilities [graph.json]',
  '       kovo explain --cookies [graph.json]',
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
  'kovo explain component|mutation|query|page|context|task <target> [--optimistic] [--layouts] [graph.json] | kovo explain document [graph.json] | kovo explain --sources-sinks | kovo explain --tasks [graph.json] | kovo explain --endpoints [graph.json] | kovo explain --revealed [graph.json] | kovo explain --trust [graph.json] | kovo explain --capabilities [graph.json] | kovo explain --cookies [graph.json] | kovo explain --access [--fail-on-findings] [graph.json] | kovo explain --unguarded [--fail-on-findings] [graph.json] | kovo explain --unscoped [--fail-on-findings] [graph.json]';

/** @internal Usage line emitted for `kovo add` (see `addUsage`). */
export const ADD_USAGE = 'usage: kovo add <component...> [--out <dir>]';

/** @internal Usage line emitted for `kovo build` (see `buildUsage`). */
export const BUILD_USAGE =
  'usage: kovo build <app-module> [--out <dir>] [--preset <name>] [--check] [--no-cache]';

/** @internal Usage line emitted for `kovo dev` (see `parseDevArgs`). */
export const DEV_USAGE =
  'usage: kovo dev <app-module> [--root <dir>] [--config <file>] [--host <host>] [--port <port>] [--strict-port] [--mode <mode>]';

/** @internal Usage line emitted for `kovo db` (see `dbUsage`). */
export const DB_USAGE =
  'usage: kovo db provision|migrate|generate|check [--schema <module>] [--migrations <dir>] [--driver <pglite|pg|node-postgres>] [--database-url <url>] [--admin-database-url <url>] [--system-database-url <url>] [--data-dir <dir>] [--reader-role <role>] [--writer-role <role>]';

/** @internal Usage forms emitted for `kovo compile` (see `compileUsage`). */
export const COMPILE_USAGE = [
  'usage: kovo compile component <source.tsx> --out <artifact.tsx> [--file-name <name>] [--check] [--fixpoint] [--render-equivalence] [--registry-facts <json>] [--query-shape-facts <json>] [--facts-out <json>] [--emit-client-files] [--allow-diagnostic <code>]',
  '       kovo compile route <source.tsx> --out <artifact.tsx> [--file-name <name>] [--artifact-file-name <name>] [--rewrite <Local=specifier>] [--facts-out <json>] [--check]',
  '       kovo compile graph <input.json> --out <graph.json> [--check]',
  '       kovo compile mutation-inputs <source.ts> --out <facts.json> [--file-name <name>] [--check]',
  '       kovo compile drizzle-static <input.json> --out <facts.json> [--check]',
  '       kovo compile drizzle-optimistic <input.json> --out <artifact.ts> [--facts-out <json>] [--check]',
  '       kovo compile package-css <package> --out <file.css> [--entry <source.ts>] [--check]',
] as const;

/** @internal Single-line `kovo compile` usage as emitted by the bin's error path. */
export const COMPILE_USAGE_LINE =
  'kovo compile component <source.tsx> --out <artifact.tsx> [--file-name <name>] [--check] [--fixpoint] [--render-equivalence] [--registry-facts <json>] [--query-shape-facts <json>] [--facts-out <json>] [--emit-client-files] [--allow-diagnostic <code>] | kovo compile route <source.tsx> --out <artifact.tsx> [--file-name <name>] [--artifact-file-name <name>] [--rewrite <Local=specifier>] [--facts-out <json>] [--check] | kovo compile graph <input.json> --out <graph.json> [--check] | kovo compile mutation-inputs <source.ts> --out <facts.json> [--file-name <name>] [--check] | kovo compile drizzle-static <input.json> --out <facts.json> [--check] | kovo compile drizzle-optimistic <input.json> --out <artifact.ts> [--facts-out <json>] [--check] | kovo compile package-css <package> --out <file.css> [--entry <source.ts>] [--check]';

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

/** @internal Value shape accepted by the shared argv parser. */
export type CommandArgvOptionKind = 'boolean' | 'value';

/** @internal One flag spec consumed by the shared argv parser. */
export interface CommandArgvOptionSpec {
  /** Canonical flag token, e.g. `--out`. */
  flag: `--${string}`;
  /** Whether the flag is valueless or consumes a value. */
  kind: CommandArgvOptionKind;
  /** Allow the option to appear multiple times and collect every value. */
  repeat?: boolean;
  /** Exact diagnostic emitted when a value flag is present with no value. */
  requiresValueMessage?: string;
}

/** @internal One command or compile-subcommand argv parse spec. */
export interface CommandArgvSpec {
  /** Specs for all supported flags. */
  options: readonly CommandArgvOptionSpec[];
}

/** @internal Parsed argv result before command-specific semantic validation. */
export interface ParsedCommandArgv {
  options: ReadonlyMap<string, true | string | readonly string[]>;
  positionals: readonly string[];
}

/** @internal Shared argv parser result. */
export type ParseCommandArgvResult =
  | { ok: true; value: ParsedCommandArgv }
  | { error: 'help'; ok: false }
  | { error: 'missing-value'; message: string; ok: false }
  | { error: 'unknown-option'; ok: false; option: string };

/** @internal Check command flags consumed by `parseCheckArgs`. */
export const CHECK_ARGV_SPEC = {
  options: [],
} as const satisfies CommandArgvSpec;

/** @internal Audit command flags consumed by `parseAuditArgs`. */
export const AUDIT_ARGV_SPEC = {
  options: [{ flag: '--fail-on-findings', kind: 'boolean' }],
} as const satisfies CommandArgvSpec;

/** @internal Explain command flags consumed by `parseExplainArgs`. */
export const EXPLAIN_ARGV_SPEC = {
  options: [
    { flag: '--access', kind: 'boolean' },
    { flag: '--capabilities', kind: 'boolean' },
    { flag: '--cookies', kind: 'boolean' },
    { flag: '--endpoints', kind: 'boolean' },
    { flag: '--fail-on-findings', kind: 'boolean' },
    { flag: '--layouts', kind: 'boolean' },
    { flag: '--optimistic', kind: 'boolean' },
    { flag: '--revealed', kind: 'boolean' },
    { flag: '--sources-sinks', kind: 'boolean' },
    { flag: '--tasks', kind: 'boolean' },
    { flag: '--trust', kind: 'boolean' },
    { flag: '--unguarded', kind: 'boolean' },
    { flag: '--unscoped', kind: 'boolean' },
  ],
} as const satisfies CommandArgvSpec;

/** @internal Add command flags consumed by `parseAddArgs`. */
export const ADD_ARGV_SPEC = {
  options: [
    {
      flag: '--out',
      kind: 'value',
      requiresValueMessage: 'kovo: add --out requires a directory.\n',
    },
  ],
} as const satisfies CommandArgvSpec;

/** @internal Build command flags consumed by `parseBuildArgs`. */
export const BUILD_ARGV_SPEC = {
  options: [
    {
      flag: '--out',
      kind: 'value',
      requiresValueMessage: 'kovo: build --out requires a directory.\n',
    },
    {
      flag: '--preset',
      kind: 'value',
      requiresValueMessage: 'kovo: build --preset requires a preset name.\n',
    },
    { flag: '--check', kind: 'boolean' },
    { flag: '--no-cache', kind: 'boolean' },
  ],
} as const satisfies CommandArgvSpec;

/** @internal Dev command flags consumed by the bootstrap-first Vite runner. */
export const DEV_ARGV_SPEC = {
  options: [
    {
      flag: '--root',
      kind: 'value',
      requiresValueMessage: 'kovo: dev --root requires a directory.\n',
    },
    {
      flag: '--config',
      kind: 'value',
      requiresValueMessage: 'kovo: dev --config requires a file.\n',
    },
    {
      flag: '--host',
      kind: 'value',
      requiresValueMessage: 'kovo: dev --host requires a host.\n',
    },
    {
      flag: '--port',
      kind: 'value',
      requiresValueMessage: 'kovo: dev --port requires a port.\n',
    },
    { flag: '--strict-port', kind: 'boolean' },
    {
      flag: '--mode',
      kind: 'value',
      requiresValueMessage: 'kovo: dev --mode requires a mode.\n',
    },
  ],
} as const satisfies CommandArgvSpec;

/** @internal DB command flags consumed by `parseDbArgs`. */
export const DB_ARGV_SPEC = {
  options: [
    {
      flag: '--schema',
      kind: 'value',
      requiresValueMessage: 'kovo: db --schema requires a module path.\n',
    },
    {
      flag: '--driver',
      kind: 'value',
      requiresValueMessage: 'kovo: db --driver requires pglite, pg, or node-postgres.\n',
    },
    {
      flag: '--database-url',
      kind: 'value',
      requiresValueMessage: 'kovo: db --database-url requires a URL.\n',
    },
    {
      flag: '--admin-database-url',
      kind: 'value',
      requiresValueMessage: 'kovo: db --admin-database-url requires a URL.\n',
    },
    {
      flag: '--system-database-url',
      kind: 'value',
      requiresValueMessage: 'kovo: db --system-database-url requires a URL.\n',
    },
    {
      flag: '--data-dir',
      kind: 'value',
      requiresValueMessage: 'kovo: db --data-dir requires a directory.\n',
    },
    {
      flag: '--migrations',
      kind: 'value',
      requiresValueMessage: 'kovo: db --migrations requires a directory.\n',
    },
    {
      flag: '--reader-role',
      kind: 'value',
      requiresValueMessage: 'kovo: db --reader-role requires a role name.\n',
    },
    {
      flag: '--writer-role',
      kind: 'value',
      requiresValueMessage: 'kovo: db --writer-role requires a role name.\n',
    },
  ],
} as const satisfies CommandArgvSpec;

/** @internal Export command flags consumed by `parseExportArgs`. */
export const EXPORT_ARGV_SPEC = {
  options: [
    { flag: '--vite', kind: 'boolean' },
    {
      flag: '--root',
      kind: 'value',
      requiresValueMessage: 'kovo: export --root requires a directory.\n',
    },
    {
      flag: '--out',
      kind: 'value',
      requiresValueMessage: 'kovo: export --out requires a directory.\n',
    },
    {
      flag: '--origin',
      kind: 'value',
      requiresValueMessage: 'kovo: export --origin requires a URL.\n',
    },
    {
      flag: '--manifest',
      kind: 'value',
      requiresValueMessage: 'kovo: export --manifest requires a file.\n',
    },
    {
      flag: '--dist',
      kind: 'value',
      requiresValueMessage: 'kovo: export --dist requires a directory.\n',
    },
    {
      flag: '--asset-base',
      kind: 'value',
      requiresValueMessage: 'kovo: export --asset-base requires a URL path.\n',
    },
    {
      flag: '--stylesheet-env',
      kind: 'value',
      requiresValueMessage: 'kovo: export --stylesheet-env requires a name.\n',
    },
    { flag: '--skip-non-exportable', kind: 'boolean' },
  ],
} as const satisfies CommandArgvSpec;

/** @internal Compile subcommand flags consumed by `parseCompileArgs`. */
export const COMPILE_ARGV_SPECS = {
  component: {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile component --out requires a path.\n',
      },
      {
        flag: '--file-name',
        kind: 'value',
        requiresValueMessage: 'kovo: compile component --file-name requires a name.\n',
      },
      { flag: '--check', kind: 'boolean' },
      { flag: '--fixpoint', kind: 'boolean' },
      { flag: '--render-equivalence', kind: 'boolean' },
      {
        flag: '--registry-facts',
        kind: 'value',
        requiresValueMessage: 'kovo: compile component --registry-facts requires a JSON path.\n',
      },
      {
        flag: '--query-shape-facts',
        kind: 'value',
        requiresValueMessage: 'kovo: compile component --query-shape-facts requires a JSON path.\n',
      },
      {
        flag: '--facts-out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile component --facts-out requires a JSON path.\n',
      },
      { flag: '--emit-client-files', kind: 'boolean' },
      {
        flag: '--allow-diagnostic',
        kind: 'value',
        repeat: true,
        requiresValueMessage: 'kovo: compile component --allow-diagnostic requires a code.\n',
      },
    ],
  },
  route: {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile route --out requires a path.\n',
      },
      {
        flag: '--file-name',
        kind: 'value',
        requiresValueMessage: 'kovo: compile route --file-name requires a name.\n',
      },
      {
        flag: '--artifact-file-name',
        kind: 'value',
        requiresValueMessage: 'kovo: compile route --artifact-file-name requires a name.\n',
      },
      {
        flag: '--rewrite',
        kind: 'value',
        repeat: true,
        requiresValueMessage: 'kovo: compile route --rewrite requires Local=specifier.\n',
      },
      {
        flag: '--facts-out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile route --facts-out requires a JSON path.\n',
      },
      { flag: '--check', kind: 'boolean' },
    ],
  },
  graph: {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile graph --out requires a path.\n',
      },
      { flag: '--check', kind: 'boolean' },
    ],
  },
  'mutation-inputs': {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile mutation-inputs --out requires a path.\n',
      },
      {
        flag: '--file-name',
        kind: 'value',
        requiresValueMessage: 'kovo: compile mutation-inputs --file-name requires a name.\n',
      },
      { flag: '--check', kind: 'boolean' },
    ],
  },
  'drizzle-optimistic': {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile drizzle-optimistic --out requires a path.\n',
      },
      {
        flag: '--facts-out',
        kind: 'value',
        requiresValueMessage:
          'kovo: compile drizzle-optimistic --facts-out requires a JSON path.\n',
      },
      { flag: '--check', kind: 'boolean' },
    ],
  },
  'drizzle-static': {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile drizzle-static --out requires a path.\n',
      },
      { flag: '--check', kind: 'boolean' },
    ],
  },
  'package-css': {
    options: [
      {
        flag: '--out',
        kind: 'value',
        requiresValueMessage: 'kovo: compile package-css --out requires a path.\n',
      },
      {
        flag: '--entry',
        kind: 'value',
        requiresValueMessage: 'kovo: compile package-css --entry requires a source path.\n',
      },
      { flag: '--check', kind: 'boolean' },
    ],
  },
} as const satisfies Record<string, CommandArgvSpec>;

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
  /** Display rank for `kovo` with no args. */
  noArgsOrder: number;
  /** Display rank for unknown-command diagnostics. */
  unknownOrder: number;
}

/**
 * @internal The full `kovo` command surface, in display order. Covers every
 * command `main`/`mainAsync` dispatches: check, explain, add, build, dev, db,
 * audit, compile, export, mcp, update-docs.
 */
export const COMMANDS_MANIFEST = [
  {
    name: 'check',
    noArgsOrder: 4,
    summary:
      'Run the consistency and exhaustiveness verifier over an extracted app graph and report findings.',
    unknownOrder: 6,
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
    noArgsOrder: 7,
    summary: 'Print the stable graph view for a single subject, or run the security review modes.',
    unknownOrder: 5,
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
        flag: '--tasks',
        description: 'List durable task registry facts and static composition edges.',
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
        flag: '--capabilities',
        description:
          'List held dangerous capabilities, including agent tools, audit-grade reveals, and signed URL mints.',
      },
      {
        flag: '--cookies',
        description: 'List cookie posture and downgrade findings.',
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
      'kovo explain --tasks',
      'kovo explain --endpoints',
      'kovo explain --revealed',
      'kovo explain --trust',
      'kovo explain --capabilities',
      'kovo explain --cookies',
      'kovo explain --access --fail-on-findings',
      'kovo explain --unguarded --fail-on-findings',
    ],
  },
  {
    name: 'add',
    noArgsOrder: 1,
    summary: 'Copy a vendored @kovojs/ui component into your project (shadcn-style copy-in).',
    unknownOrder: 1,
    usage: ADD_USAGE,
    async: true,
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
    noArgsOrder: 3,
    summary:
      'Run TypeScript and kovo-check preflights, then build a Kovo app module into preset production output.',
    unknownOrder: 2,
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
      {
        flag: '--check',
        description:
          'Validate only: run the TypeScript and kovo-check preflights and the compiler transform (all build diagnostics), then stop before emitting deployable output.',
      },
    ],
    examples: ['kovo build ./src/app-shell.ts --out dist', 'kovo build ./src/app.tsx --check'],
  },
  {
    name: 'dev',
    noArgsOrder: 3.5,
    summary:
      'Start Vite only after the app-resolved compiler, data-plane, and server trust roots are established.',
    unknownOrder: 2.5,
    usage: DEV_USAGE,
    async: true,
    flags: [
      { flag: '--root <dir>', description: 'Project root (default: current directory).' },
      {
        flag: '--config <file>',
        description: 'Explicit restricted client-plugin config loaded after security bootstrap.',
      },
      { flag: '--host <host>', description: 'Vite listen host override.' },
      { flag: '--port <port>', description: 'Vite listen port override.' },
      { flag: '--strict-port', description: 'Fail instead of selecting another occupied port.' },
      { flag: '--mode <mode>', description: 'Vite mode (default: development).' },
    ],
    examples: ['kovo dev ./src/app.tsx', 'kovo dev ./src/app.tsx --port 4173 --strict-port'],
  },
  {
    name: 'db',
    noArgsOrder: 5,
    summary:
      'Provision, migrate, or check a Postgres app database from the Drizzle schema and framework-owned RLS posture.',
    unknownOrder: 3,
    usage: DB_USAGE,
    async: true,
    flags: [
      {
        flag: 'provision',
        description:
          'Apply pending migrations, roles, RLS policies, and grants, then re-check live Postgres posture. External Postgres uses KOVO_ADMIN_DATABASE_URL unless --admin-database-url is supplied.',
      },
      {
        flag: 'migrate',
        description:
          'Apply reviewed SQL migrations transactionally, then reassert derived RLS policies, grants, and live posture.',
      },
      {
        flag: 'generate',
        description:
          'Generate reviewable additive up/down SQL files by diffing the current database against the schema module.',
      },
      {
        flag: 'check',
        description:
          'Bind the ordinary runtime witness to a privileged authority on the same live database, then verify forced RLS, policies, grants, and least-privilege access.',
      },
      { flag: '--schema <module>', description: 'Schema module path (default: src/schema.ts).' },
      {
        flag: '--driver <pglite|pg|node-postgres>',
        description:
          'Database driver. Defaults to external Postgres when a URL is present, otherwise PGlite.',
      },
      {
        flag: '--migrations <dir>',
        description: 'Directory of reviewed .sql migrations (default: migrations).',
      },
      {
        flag: '--database-url <url>',
        description:
          'Least-privilege runtime witness URL. Defaults to KOVO_RUNTIME_DATABASE_URL, then KOVO_DATABASE_URL.',
      },
      {
        flag: '--admin-database-url <url>',
        description:
          'Privileged setup/check fallback authority URL. Defaults to KOVO_ADMIN_DATABASE_URL.',
      },
      {
        flag: '--system-database-url <url>',
        description:
          'Least-privilege system/check authority URL. Preferred over admin; defaults to KOVO_DB_SYSTEM_URL.',
      },
      {
        flag: '--data-dir <dir>',
        description: 'PGlite data directory for embedded development databases.',
      },
      { flag: '--reader-role <role>', description: 'Reader role name (default: kovo_reader).' },
      { flag: '--writer-role <role>', description: 'Writer role name (default: kovo_writer).' },
    ],
    examples: [
      'kovo db provision --schema src/schema.ts',
      'kovo db generate --migrations migrations',
      'kovo db migrate --migrations migrations',
      'KOVO_ADMIN_DATABASE_URL=postgres://admin@db:5432/app?sslmode=verify-full KOVO_RUNTIME_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full kovo db provision',
      'KOVO_DB_SYSTEM_URL=postgres://kovo_system@db:5432/app?sslmode=verify-full KOVO_RUNTIME_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full kovo db check',
      'KOVO_ADMIN_DATABASE_URL=postgres://admin@db:5432/app?sslmode=verify-full KOVO_RUNTIME_DATABASE_URL=postgres://app@db:5432/app?sslmode=verify-full kovo db check',
      'kovo db check --driver pglite --data-dir .kovo/pglite',
    ],
  },
  {
    name: 'compile',
    noArgsOrder: 6,
    summary:
      'Emit compiler-backed app artifacts without importing @kovojs/compiler from app scripts.',
    unknownOrder: 4,
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
    noArgsOrder: 2,
    summary: 'Run the security/access audits over an extracted app graph.',
    unknownOrder: 7,
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
    noArgsOrder: 8,
    summary: 'Statically export a Kovo app module to disk for hosting.',
    unknownOrder: 8,
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
    noArgsOrder: 9,
    summary:
      'Run the Model Context Protocol server: read newline-delimited JSON-RPC from stdin, write responses to stdout.',
    unknownOrder: 9,
    usage: MCP_USAGE,
    async: true,
    examples: ['kovo mcp'],
  },
  {
    name: 'update-docs',
    noArgsOrder: 10,
    summary: 'Refresh AGENTS.md and mirror the latest agent-readable Kovo docs into ./.kovo/docs.',
    unknownOrder: 10,
    usage: UPDATE_DOCS_USAGE,
    async: true,
    examples: ['kovo update-docs'],
  },
] as const satisfies readonly CommandManifestEntry[];

/** @internal Command names accepted by the `kovo` dispatcher. */
export type KovoCommandName = (typeof COMMANDS_MANIFEST)[number]['name'];

/** @internal One concrete command registry entry. */
export type KovoCommandEntry = (typeof COMMANDS_MANIFEST)[number];

/** @internal One concrete async command registry entry. */
export type KovoAsyncCommandEntry = Extract<KovoCommandEntry, { async: true }>;

/** @internal One concrete sync command registry entry. */
export type KovoSyncCommandEntry = Exclude<KovoCommandEntry, KovoAsyncCommandEntry>;

/** @internal Commands that must route through `mainAsync()`. */
export type KovoAsyncCommandName = KovoAsyncCommandEntry['name'];

/** @internal Commands that can route through `main()`. */
export type KovoSyncCommandName = KovoSyncCommandEntry['name'];

/** @internal Registry keyed by sub-command name for dispatch and diagnostics. */
export const COMMAND_REGISTRY: ReadonlyMap<KovoCommandName, (typeof COMMANDS_MANIFEST)[number]> =
  new Map(COMMANDS_MANIFEST.map((entry) => [entry.name, entry]));

/** @internal Resolve an argv command token to its registry entry. */
export function resolveCommand(name: string | undefined) {
  if (name === undefined) return undefined;
  return COMMAND_REGISTRY.get(name as KovoCommandName);
}

/** @internal True when a registry entry must route through `mainAsync()`. */
export function isAsyncCommand(entry: KovoCommandEntry): entry is KovoAsyncCommandEntry {
  return 'async' in entry && entry.async === true;
}

function commandNamesByOrder(orderKey: 'noArgsOrder' | 'unknownOrder'): KovoCommandName[] {
  return [...COMMANDS_MANIFEST]
    .sort((left, right) => left[orderKey] - right[orderKey] || left.name.localeCompare(right.name))
    .map((entry) => entry.name);
}

function sentenceList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0] ?? '';
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

/** @internal The command list emitted by `kovo` with no args. */
export function formatNoArgsCommandList(): string {
  return commandNamesByOrder('noArgsOrder').join(', ');
}

/** @internal The complete no-args message emitted by the bin. */
export function formatNoArgsMessage(): string {
  return `kovo: ${formatNoArgsCommandList()}\n`;
}

/** @internal The expected-command phrase emitted by unknown-command diagnostics. */
export function formatExpectedCommandList(): string {
  return sentenceList(commandNamesByOrder('unknownOrder'));
}

/** @internal Unknown-command diagnostic emitted by the bin. */
export function formatUnknownCommandMessage(command: string): string {
  return `kovo: unknown command ${JSON.stringify(command)}. expected ${formatExpectedCommandList()}.\n`;
}

/** @internal Parse command argv from a manifest-owned flag spec. */
export function parseCommandArgv(
  args: readonly string[],
  spec: CommandArgvSpec,
): ParseCommandArgvResult {
  const optionSpecs = new Map(spec.options.map((option) => [option.flag, option]));
  const options = new Map<string, true | string | string[]>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--help' || arg === '-h') return { error: 'help', ok: false };

    const equalsIndex = arg.indexOf('=');
    const flag = equalsIndex > 0 ? arg.slice(0, equalsIndex) : arg;
    const optionSpec = flag.startsWith('--') ? optionSpecs.get(flag as `--${string}`) : undefined;
    if (optionSpec) {
      if (optionSpec.kind === 'boolean') {
        if (equalsIndex > 0) return { error: 'unknown-option', ok: false, option: arg };
        options.set(flag, true);
        continue;
      }

      const value = equalsIndex > 0 ? arg.slice(equalsIndex + 1) : args[index + 1];
      if (!value) {
        return {
          error: 'missing-value',
          message:
            optionSpec.requiresValueMessage ?? `kovo: ${optionSpec.flag} requires a value.\n`,
          ok: false,
        };
      }
      if (equalsIndex <= 0) index += 1;
      if (optionSpec.repeat) {
        const previous = options.get(flag);
        const values =
          previous === undefined
            ? []
            : Array.isArray(previous)
              ? [...previous]
              : [String(previous)];
        values.push(value);
        options.set(flag, values);
      } else {
        options.set(flag, value);
      }
      continue;
    }

    if (arg.startsWith('-')) return { error: 'unknown-option', ok: false, option: arg };
    positionals.push(arg);
  }

  return { ok: true, value: { options, positionals } };
}

/** @internal Render the common command-argv parser error shape. */
export function commandArgvError(
  name: string,
  error: Exclude<ParseCommandArgvResult, { ok: true }>,
  usage: string,
): { message: string; ok: false } {
  if (error.error === 'help') return { message: usage, ok: false };
  if (error.error === 'missing-value') return { message: error.message, ok: false };
  return {
    message: `kovo: unknown ${name} option ${stableValue(error.option)}.\n${usage}`,
    ok: false,
  };
}

/** @internal Require a command to have exactly one positional argument. */
export function requireSinglePositional(
  parsed: ParsedCommandArgv,
  options: {
    label: string;
    name: string;
    usage: string;
  },
): { ok: true; value: string } | { message: string; ok: false } {
  const [value, extra] = parsed.positionals;
  if (extra) {
    return {
      message: `kovo: ${options.name} accepts one ${options.label}.\n${options.usage}`,
      ok: false,
    };
  }
  if (!value) {
    return {
      message: `kovo: ${options.name} requires ${articleFor(options.label)} ${options.label}.\n${options.usage}`,
      ok: false,
    };
  }
  return { ok: true, value };
}

function articleFor(label: string): 'a' | 'an' {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

function stableValue(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}

/** @internal True when a parsed boolean flag appeared. */
export function parsedBooleanOption(parsed: ParsedCommandArgv, flag: string): boolean {
  return parsed.options.get(flag) === true;
}

/** @internal Return a parsed value option, if present. */
export function parsedStringOption(parsed: ParsedCommandArgv, flag: string): string | undefined {
  const value = parsed.options.get(flag);
  return typeof value === 'string' ? value : undefined;
}

/** @internal Return a repeatable value option. */
export function parsedStringListOption(parsed: ParsedCommandArgv, flag: string): string[] {
  const value = parsed.options.get(flag);
  if (Array.isArray(value)) return [...value];
  return typeof value === 'string' ? [value] : [];
}
