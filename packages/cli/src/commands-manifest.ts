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
 * Marked `@internal` so it stays out of the public `kovo` API surface (the
 * api-surface gate, `scripts/api-surface-gate.mjs`) — it is reachable only through
 * the `kovo/internal` subpath and the docs tooling, never the `.` export.
 */

/** @internal Usage line emitted for `kovo check` (see `writeCheckUsageError`). */
export const CHECK_USAGE = 'usage: kovo check [optimistic|coverage] [graph.json]';

/** @internal Usage line emitted for `kovo audit` (see `parseAuditArgs`). */
export const AUDIT_USAGE = 'usage: kovo audit [--fail-on-findings] [graph.json]';

/** @internal Usage forms emitted for `kovo explain` (see `explainUsage`). */
export const EXPLAIN_USAGE = [
  'usage: kovo explain component|mutation|query|page|context <target> [--optimistic] [--layouts] [graph.json]',
  '       kovo explain --endpoints [graph.json]',
  '       kovo explain --unguarded [--fail-on-findings] [graph.json]',
  '       kovo explain --unscoped [--fail-on-findings] [graph.json]',
] as const;

/**
 * @internal Single-line `kovo explain` usage as emitted by the bin's error path.
 * The bin prints all explain forms on one line joined by ` | `; keep that exact
 * literal here so the drift guard can compare against `explainUsage()`.
 */
export const EXPLAIN_USAGE_LINE =
  'kovo explain component|mutation|query|page|context <target> [--optimistic] [--layouts] [graph.json] | kovo explain --endpoints [graph.json] | kovo explain --unguarded [--fail-on-findings] [graph.json] | kovo explain --unscoped [--fail-on-findings] [graph.json]';

/** @internal Usage line emitted for `kovo add` (see `addUsage`). */
export const ADD_USAGE = 'usage: kovo add <component...> [--out <dir>]';

/** @internal Usage line emitted for `kovo export` (see `exportUsage`). */
export const EXPORT_USAGE =
  'usage: kovo export <app-module> [--out <dir>] [--origin <url>] [--skip-non-exportable]';

/** @internal Usage line emitted for `kovo mcp` (see `mcpUsage`). */
export const MCP_USAGE = 'usage: kovo mcp';

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
 * command `main`/`mainAsync` dispatches: check, explain, add, audit, export, mcp.
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
    ],
    examples: ['kovo check', 'kovo check coverage graph.json'],
  },
  {
    name: 'explain',
    summary:
      'Print the stable graph view for a single subject, or run the endpoints/unguarded/unscoped audits.',
    usage: EXPLAIN_USAGE,
    flags: [
      { flag: '--optimistic', description: 'Include optimistic-update detail for the subject.' },
      { flag: '--endpoints', description: 'List the machine-ingress endpoints audit.' },
      { flag: '--unguarded', description: 'Audit handlers reachable without a guard.' },
      { flag: '--unscoped', description: 'Audit storage access that is not tenant-scoped.' },
      {
        flag: '--fail-on-findings',
        description: 'Exit non-zero when the audit reports any findings.',
      },
    ],
    examples: [
      'kovo explain component Cart graph.json',
      'kovo explain --endpoints',
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
        description: 'Destination directory for the copied component (default: project components dir).',
      },
    ],
    examples: ['kovo add button', 'kovo add button card --out src/components/ui'],
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
      { flag: '--out <dir>', description: 'Output directory for the exported site.' },
      { flag: '--origin <url>', description: 'Absolute origin used for canonical URLs.' },
      {
        flag: '--skip-non-exportable',
        description: 'Skip routes that cannot be statically exported instead of failing.',
      },
    ],
    examples: ['kovo export ./src/app.ts --out dist', 'kovo export ./src/app.ts --origin https://example.com'],
  },
  {
    name: 'mcp',
    summary:
      'Run the Model Context Protocol server: read newline-delimited JSON-RPC from stdin, write responses to stdout.',
    usage: MCP_USAGE,
    async: true,
    examples: ['kovo mcp'],
  },
];
