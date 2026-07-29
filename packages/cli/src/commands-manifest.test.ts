import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADD_USAGE,
  ADVISORY_USAGE,
  AUDIT_USAGE,
  BUILD_USAGE,
  CHECK_USAGE,
  COMPILE_USAGE,
  COMPILE_USAGE_LINE,
  COMMANDS_MANIFEST,
  DB_USAGE,
  DEV_USAGE,
  DOCS_USAGE,
  EXPLAIN_USAGE,
  EXPLAIN_USAGE_LINE,
  EXPORT_USAGE,
  FIX_USAGE,
  INCIDENT_USAGE,
  MCP_USAGE,
  UPDATE_DOCS_USAGE,
  formatNoArgsMessage,
  formatRootHelp,
  formatUnknownCommandMessage,
  parseKovoCommandInvocation,
  resolveCommand,
} from './commands-manifest.js';
import { formatKovoDiagnostics, usageDiagnostic } from './diagnostic.js';
import { CLI_COMMAND_DISPATCHER_NAMES, main } from './index.js';

/**
 * Drift guard for the shared CLI command manifest. The manifest is the single
 * source of truth for the `kovo` bin's command surface and usage strings, and is
 * also consumed by the docs generator (`site/scripts/cli-ref.mjs`). These tests
 * mechanically tie the manifest to the binary so the docs cannot drift:
 *   (a) the manifest covers every command `main`/`mainAsync` dispatches; and
 *   (b) each manifest usage string is the literal the CLI actually emits.
 */
describe('commands manifest', () => {
  const binSource = readFileSync(fileURLToPath(new URL('./bin.ts', import.meta.url)), 'utf8');
  const commandManifestSource = readFileSync(
    fileURLToPath(new URL('./commands-manifest.ts', import.meta.url)),
    'utf8',
  );
  const cliCommandSource = [
    './bin.ts',
    './index.ts',
    './commands/build-export.ts',
    './commands/dev.ts',
    './commands/docs.ts',
    './commands/compile.ts',
    './commands/db.ts',
    './commands/fix.ts',
    './commands/incident-scope.ts',
    './commands/advisories.ts',
    './commands/mcp.ts',
    './graph-output.ts',
  ]
    .map((file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8'))
    .join('\n');

  it('is the command registry used by the bin dispatch tables', () => {
    const manifestNames = COMMANDS_MANIFEST.map((entry) => entry.name);
    const syncNames = COMMANDS_MANIFEST.filter((entry) => !isAsyncManifestEntry(entry)).map(
      (entry) => entry.name,
    );
    const asyncNames = COMMANDS_MANIFEST.filter(isAsyncManifestEntry).map((entry) => entry.name);

    expect(CLI_COMMAND_DISPATCHER_NAMES.sync).toEqual([...syncNames].sort());
    expect(CLI_COMMAND_DISPATCHER_NAMES.async).toEqual([...asyncNames].sort());
    for (const name of manifestNames) {
      expect(resolveCommand(name)?.name).toBe(name);
    }
    expect(resolveCommand('missing')).toBeUndefined();
    expect([...manifestNames].sort()).toEqual(
      [
        'add',
        'audit',
        'build',
        'check',
        'compile',
        'db',
        'dev',
        'docs',
        'explain',
        'export',
        'fix',
        'incident',
        'mcp',
        'update-docs',
      ].sort(),
    );
  });

  it('drives no-args and unknown-command diagnostics from the registry', () => {
    expect(formatNoArgsMessage()).toBe(
      'kovo: add, audit, build, check, compile, db, dev, docs, explain, export, fix, incident, mcp, update-docs\n',
    );
    expect(formatUnknownCommandMessage('nope')).toBe(
      'kovo: unknown command "nope". expected add, audit, build, check, compile, db, dev, docs, explain, export, fix, incident, mcp, or update-docs.\n',
    );

    const noArgs = captureWrites(() => main([]));
    expect(noArgs.result).toBe(0);
    expect(noArgs.stdout).toBe(formatRootHelp());
    expect(noArgs.stderr).toBe('');

    const unknown = captureWrites(() => main(['nope']));
    expect(unknown.result).toBe(2);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toBe(
      formatKovoDiagnostics([usageDiagnostic(formatUnknownCommandMessage('nope'))], 'human'),
    );

    const advisorySync = captureWrites(() => main(['check', 'advisories']));
    expect(advisorySync.result).toBe(2);
    expect(advisorySync.stdout).toBe('');
    expect(advisorySync.stderr).toBe(
      formatKovoDiagnostics(
        [usageDiagnostic('kovo: check advisories is asynchronous; call mainAsync() instead.\n')],
        'human',
      ),
    );
  });

  it('marks the async-dispatched commands (including docs) as async', () => {
    const asyncNames = COMMANDS_MANIFEST.filter(isAsyncManifestEntry).map((entry) => entry.name);
    expect(asyncNames.sort()).toEqual(
      [
        'add',
        'build',
        'compile',
        'db',
        'dev',
        'docs',
        'export',
        'fix',
        'mcp',
        'update-docs',
      ].sort(),
    );
  });

  it('exposes every usage constant the bin references', () => {
    // The bin imports these usage constants from the manifest; assert the literal
    // text matches what the CLI emits in its usage/error paths.
    expect(CHECK_USAGE).toBe(
      'usage: kovo check [optimistic|coverage|endpoint-posture|sources-sinks] [graph.json] [--format <human|json|github>] | kovo check env [deployment.json] [--format <human|json|github>] | kovo check advisories [graph.json] [--feed <url|file>] [--attestation <url|file>] [--state <file>] [--severity-floor <low|moderate|high|critical>] [--format <human|json|github>]',
    );
    expect(ADVISORY_USAGE).toBe(
      'usage: kovo check advisories [graph.json] [--feed <url|file>] [--attestation <url|file>] [--state <file>] [--severity-floor <low|moderate|high|critical>] [--format <human|json|github>]',
    );
    expect(AUDIT_USAGE).toBe('usage: kovo audit [--fail-on-findings] [graph.json]');
    expect(ADD_USAGE).toBe('usage: kovo add <component...> [--out <dir>]');
    expect(BUILD_USAGE).toBe(
      'usage: kovo build <app-module> [--out <dir>] [--preset <name>] [--check] [--no-cache] [--format <human|json|github>]',
    );
    expect(DEV_USAGE).toBe(
      'usage: kovo dev <app-module> [--root <dir>] [--config <file>] [--host <host>] [--port <port>] [--strict-port] [--mode <mode>] [--debug]',
    );
    expect(DB_USAGE).toBe(
      'usage: kovo db provision|migrate|generate|check [--schema <module>] [--migrations <dir>] [--driver <pglite|pg|node-postgres>] [--database-url <url>] [--admin-database-url <url>] [--system-database-url <url>] [--data-dir <dir>] [--reader-role <role>] [--writer-role <role>]',
    );
    expect(DOCS_USAGE).toBe('usage: kovo docs <task> [--limit <count>] [--format <human|json>]');
    expect(COMPILE_USAGE[0]).toBe(
      'usage: kovo compile component <source.tsx> --out <artifact.tsx> [--file-name <name>] [--check] [--fixpoint] [--render-equivalence] [--registry-facts <json>] [--query-shape-facts <json>] [--facts-out <json>] [--emit-client-files] [--allow-diagnostic <code>]',
    );
    expect(COMPILE_USAGE).toContain(
      '       kovo compile mutation-inputs <source.ts> --out <facts.json> [--file-name <name>] [--check]',
    );
    expect(COMPILE_USAGE).toContain(
      '       kovo compile drizzle-static <input.json> --out <facts.json> [--check]',
    );
    expect(COMPILE_USAGE).toContain(
      '       kovo compile drizzle-optimistic <input.json> --out <artifact.ts> [--facts-out <json>] [--check]',
    );
    expect(COMPILE_USAGE_LINE).toContain('kovo compile component <source.tsx>');
    expect(FIX_USAGE).toBe(
      'usage: kovo fix <source.tsx|source.jsx> [--check] | kovo fix --cost-report',
    );
    expect(EXPORT_USAGE).toBe(
      'usage: kovo export <app-module> [--vite] [--root <dir>] [--out <dir>] [--origin <url>] [--manifest <file> --dist <dir>] [--asset-base <path>] [--skip-non-exportable]',
    );
    expect(MCP_USAGE).toBe('usage: kovo mcp');
    expect(INCIDENT_USAGE).toBe(
      'usage: kovo incident scope <advisory.json> --events <security-events.json>',
    );
    expect(UPDATE_DOCS_USAGE).toBe('usage: kovo update-docs');
    expect(EXPLAIN_USAGE_LINE).toContain(
      'kovo explain component|mutation|query|page|context|task <target>',
    );
    expect(EXPLAIN_USAGE).toContain(
      '       kovo explain --capabilities [graph.json] [--format <human|json|github>]',
    );
    expect(EXPLAIN_USAGE).toContain(
      '       kovo explain --cookies [graph.json] [--format <human|json|github>]',
    );
    expect(EXPLAIN_USAGE).toContain(
      '       kovo explain --tasks [graph.json] [--format <human|json|github>]',
    );
    expect(EXPLAIN_USAGE_LINE).toContain(
      'kovo explain --capabilities [graph.json] [--format <human|json|github>]',
    );
    expect(EXPLAIN_USAGE_LINE).toContain(
      'kovo explain --cookies [graph.json] [--format <human|json|github>]',
    );
    expect(EXPLAIN_USAGE_LINE).toContain(
      'kovo explain --tasks [graph.json] [--format <human|json|github>]',
    );
    expect(EXPLAIN_USAGE_LINE).toContain('[--format <human|json|github>]');
  });

  it('each manifest usage is consistent with the bin imports', () => {
    const byName = Object.fromEntries(COMMANDS_MANIFEST.map((e) => [e.name, e]));
    expect(byName.check?.usage).toBe(CHECK_USAGE);
    expect(byName.audit?.usage).toBe(AUDIT_USAGE);
    expect(byName.add?.usage).toBe(ADD_USAGE);
    expect(byName.build?.usage).toBe(BUILD_USAGE);
    expect(byName.dev?.usage).toBe(DEV_USAGE);
    expect(byName.db?.usage).toBe(DB_USAGE);
    expect(byName.docs?.usage).toBe(DOCS_USAGE);
    expect(byName.compile?.usage).toEqual(COMPILE_USAGE);
    expect(byName.fix?.usage).toBe(FIX_USAGE);
    expect(byName.export?.usage).toBe(EXPORT_USAGE);
    expect(byName.incident?.usage).toBe(INCIDENT_USAGE);
    expect(byName.mcp?.usage).toBe(MCP_USAGE);
    expect(byName['update-docs']?.usage).toBe(UPDATE_DOCS_USAGE);
    expect(byName.explain?.usage).toEqual(EXPLAIN_USAGE);
  });

  it('routes command modules through the semantic parser without local argv specs', () => {
    expect(cliCommandSource).toMatch(/from '\.\.?\/commands-manifest\.js'/);
    expect(cliCommandSource).toContain('parseKovoCommandInvocation');
    expect(cliCommandSource).not.toContain('parseCommandArgv');
    expect(cliCommandSource).not.toMatch(/\b[A-Z][A-Z_]+_ARGV_SPEC\b/u);
    expect(cliCommandSource).not.toContain('validatePositionals');
  });

  it('derives executable posture and parser help aliases without bin-local command facts', () => {
    expect(binSource).toContain('resolveKovoBinInvocationPosture(commandArgs)');
    expect(binSource).not.toMatch(/process\.argv\[2\]\s*===/u);
    expect(binSource).not.toMatch(/const isLongLivedCommand = .*['"](?:dev|mcp)['"]/u);

    const tokenizerStart = commandManifestSource.indexOf('function tokenizeCommandArgv(');
    const tokenizerEnd = commandManifestSource.indexOf(
      '\nfunction parseEntryForm(',
      tokenizerStart,
    );
    expect(tokenizerStart).toBeGreaterThanOrEqual(0);
    expect(tokenizerEnd).toBeGreaterThan(tokenizerStart);
    const tokenizerSource = commandManifestSource.slice(tokenizerStart, tokenizerEnd);
    expect(tokenizerSource).toContain("globalOptionForFlag(argument)?.id === 'help'");
    expect(tokenizerSource).not.toContain("argument === '--help'");
    expect(tokenizerSource).not.toContain("argument === '-h'");
  });

  it('parses every concrete form into semantic arguments and options', () => {
    expect(
      parseKovoCommandInvocation('build', [
        'src/app.tsx',
        '--out=dist-prod',
        '--check',
        '--preset',
        'node',
        '--no-cache',
        '--format=json',
      ]),
    ).toEqual({
      ok: true,
      value: {
        arguments: { appModule: 'src/app.tsx' },
        command: 'build',
        form: 'build',
        options: {
          cache: false,
          check: true,
          format: 'json',
          out: 'dist-prod',
          preset: 'node',
        },
      },
    });

    expect(
      parseKovoCommandInvocation('compile', [
        'route',
        'src/route.tsx',
        '--rewrite',
        'Cart=./cart.js',
        '--rewrite=Shell=./shell.js',
        '--out',
        'dist/route.tsx',
      ]),
    ).toMatchObject({
      ok: true,
      value: {
        arguments: { source: 'src/route.tsx' },
        command: 'compile',
        form: 'route',
        options: {
          out: 'dist/route.tsx',
          rewrite: ['Cart=./cart.js', 'Shell=./shell.js'],
        },
      },
    });

    expect(
      parseKovoCommandInvocation('check', [
        'advisories',
        '.kovo/graph.json',
        '--feed=https://example.test/feed.json',
        '--attestation',
        'bundle.json',
        '--state',
        '.kovo/advisory-state.json',
        '--severity-floor=critical',
        '--format=github',
      ]),
    ).toEqual({
      ok: true,
      value: {
        arguments: { graph: '.kovo/graph.json' },
        command: 'check',
        form: 'advisories',
        options: {
          attestation: 'bundle.json',
          feed: 'https://example.test/feed.json',
          format: 'github',
          severityFloor: 'critical',
          state: '.kovo/advisory-state.json',
        },
      },
    });

    expect(
      parseKovoCommandInvocation('db', [
        'migrate',
        '--schema',
        'src/schema.ts',
        '--driver=pglite',
        '--data-dir',
        '.kovo/pglite',
        '--migrations',
        'migrations',
      ]),
    ).toMatchObject({
      ok: true,
      value: {
        arguments: { action: 'migrate' },
        command: 'db',
        form: 'db',
        options: {
          dataDir: '.kovo/pglite',
          driver: 'pglite',
          migrations: 'migrations',
          schema: 'src/schema.ts',
        },
      },
    });
  });

  it('rejects missing values, boolean equals, surplus positionals, and form collisions', () => {
    expect(parseKovoCommandInvocation('build', ['--out='])).toMatchObject({
      error: 'usage',
      message: expect.stringContaining('kovo: build --out requires a directory.'),
      ok: false,
    });
    expect(parseKovoCommandInvocation('build', ['src/app.tsx', '--check=false'])).toMatchObject({
      error: 'usage',
      message: expect.stringContaining('kovo: unknown build option "--check=false".'),
      ok: false,
    });
    expect(parseKovoCommandInvocation('build', ['one.tsx', 'two.tsx'])).toMatchObject({
      error: 'usage',
      message: expect.stringContaining('kovo: build accepts one app module path.'),
      ok: false,
    });
    expect(parseKovoCommandInvocation('explain', ['--tasks', '--agent'])).toMatchObject({
      error: 'usage',
      ok: false,
    });
    expect(parseKovoCommandInvocation('explain', [])).toMatchObject({
      error: 'usage',
      ok: false,
    });
    expect(parseKovoCommandInvocation('fix', [])).toMatchObject({
      error: 'usage',
      ok: false,
    });
    expect(parseKovoCommandInvocation('mcp', ['surplus'])).toMatchObject({
      error: 'usage',
      ok: false,
    });
    expect(parseKovoCommandInvocation('docs', [])).toMatchObject({
      error: 'usage',
      ok: false,
    });
    expect(parseKovoCommandInvocation('docs', ['quickstart', '--limit', '9'])).toMatchObject({
      error: 'usage',
      message: expect.stringContaining('integer from 1 through 8'),
      ok: false,
    });
    expect(parseKovoCommandInvocation('update-docs', ['surplus'])).toMatchObject({
      error: 'usage',
      ok: false,
    });
    expect(
      parseKovoCommandInvocation('explain', [
        '--attest=https://app.example',
        '--artifact=graph.json',
        `--trust-anchor=sha256:${'a'.repeat(64)}`,
      ]),
    ).toMatchObject({
      ok: true,
      value: {
        command: 'explain',
        form: 'attest',
        options: { attest: 'https://app.example' },
      },
    });
  });
});

function captureWrites(run: () => number) {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    return { result: run(), stderr, stdout };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

function isAsyncManifestEntry(entry: (typeof COMMANDS_MANIFEST)[number]): boolean {
  return 'async' in entry && entry.async === true;
}
