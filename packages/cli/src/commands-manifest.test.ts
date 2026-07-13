import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ADD_USAGE,
  AUDIT_USAGE,
  BUILD_USAGE,
  CHECK_USAGE,
  COMPILE_USAGE,
  COMPILE_USAGE_LINE,
  COMMANDS_MANIFEST,
  DB_ARGV_SPEC,
  DB_USAGE,
  DEV_USAGE,
  EXPLAIN_USAGE,
  EXPLAIN_USAGE_LINE,
  EXPORT_USAGE,
  MCP_USAGE,
  UPDATE_DOCS_USAGE,
  BUILD_ARGV_SPEC,
  commandArgvError,
  COMPILE_ARGV_SPECS,
  formatNoArgsMessage,
  formatUnknownCommandMessage,
  parsedBooleanOption,
  parsedStringListOption,
  parsedStringOption,
  parseCommandArgv,
  requireSinglePositional,
  resolveCommand,
} from './commands-manifest.js';
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
  const cliCommandSource = [
    './index.ts',
    './commands/build-export.ts',
    './commands/dev.ts',
    './commands/compile.ts',
    './commands/db.ts',
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
        'explain',
        'export',
        'mcp',
        'update-docs',
      ].sort(),
    );
  });

  it('drives no-args and unknown-command diagnostics from the registry', () => {
    expect(formatNoArgsMessage()).toBe(
      'kovo: add, audit, build, dev, check, db, compile, explain, export, mcp, update-docs\n',
    );
    expect(formatUnknownCommandMessage('nope')).toBe(
      'kovo: unknown command "nope". expected add, build, dev, db, compile, explain, check, audit, export, mcp, or update-docs.\n',
    );

    const noArgs = captureWrites(() => main([]));
    expect(noArgs.result).toBe(0);
    expect(noArgs.stdout).toBe(formatNoArgsMessage());
    expect(noArgs.stderr).toBe('');

    const unknown = captureWrites(() => main(['nope']));
    expect(unknown.result).toBe(1);
    expect(unknown.stdout).toBe('');
    expect(unknown.stderr).toBe(formatUnknownCommandMessage('nope'));
  });

  it('marks the async-dispatched commands (add, build, dev, db, compile, export, mcp, update-docs) as async', () => {
    const asyncNames = COMMANDS_MANIFEST.filter(isAsyncManifestEntry).map((entry) => entry.name);
    expect(asyncNames.sort()).toEqual(
      ['add', 'build', 'compile', 'db', 'dev', 'export', 'mcp', 'update-docs'].sort(),
    );
  });

  it('exposes every usage constant the bin references', () => {
    // The bin imports these usage constants from the manifest; assert the literal
    // text matches what the CLI emits in its usage/error paths.
    expect(CHECK_USAGE).toBe(
      'usage: kovo check [optimistic|coverage|endpoint-posture|sources-sinks] [graph.json]',
    );
    expect(AUDIT_USAGE).toBe('usage: kovo audit [--fail-on-findings] [graph.json]');
    expect(ADD_USAGE).toBe('usage: kovo add <component...> [--out <dir>]');
    expect(BUILD_USAGE).toBe(
      'usage: kovo build <app-module> [--out <dir>] [--preset <name>] [--check] [--no-cache]',
    );
    expect(DEV_USAGE).toBe(
      'usage: kovo dev <app-module> [--root <dir>] [--config <file>] [--host <host>] [--port <port>] [--strict-port] [--mode <mode>]',
    );
    expect(DB_USAGE).toBe(
      'usage: kovo db provision|migrate|generate|check [--schema <module>] [--migrations <dir>] [--driver <pglite|pg|node-postgres>] [--database-url <url>] [--admin-database-url <url>] [--data-dir <dir>] [--reader-role <role>] [--writer-role <role>]',
    );
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
    expect(EXPORT_USAGE).toBe(
      'usage: kovo export <app-module> [--vite] [--root <dir>] [--out <dir>] [--origin <url>] [--manifest <file> --dist <dir>] [--asset-base <path>] [--stylesheet-env <name>] [--skip-non-exportable]',
    );
    expect(MCP_USAGE).toBe('usage: kovo mcp');
    expect(UPDATE_DOCS_USAGE).toBe('usage: kovo update-docs');
    expect(EXPLAIN_USAGE_LINE).toContain(
      'kovo explain component|mutation|query|page|context|task <target>',
    );
    expect(EXPLAIN_USAGE).toContain('       kovo explain --capabilities [graph.json]');
    expect(EXPLAIN_USAGE).toContain('       kovo explain --cookies [graph.json]');
    expect(EXPLAIN_USAGE).toContain('       kovo explain --tasks [graph.json]');
    expect(EXPLAIN_USAGE_LINE).toContain('kovo explain --capabilities [graph.json]');
    expect(EXPLAIN_USAGE_LINE).toContain('kovo explain --cookies [graph.json]');
    expect(EXPLAIN_USAGE_LINE).toContain('kovo explain --tasks [graph.json]');
  });

  it('each manifest usage is consistent with the bin imports', () => {
    const byName = Object.fromEntries(COMMANDS_MANIFEST.map((e) => [e.name, e]));
    expect(byName.check?.usage).toBe(CHECK_USAGE);
    expect(byName.audit?.usage).toBe(AUDIT_USAGE);
    expect(byName.add?.usage).toBe(ADD_USAGE);
    expect(byName.build?.usage).toBe(BUILD_USAGE);
    expect(byName.dev?.usage).toBe(DEV_USAGE);
    expect(byName.db?.usage).toBe(DB_USAGE);
    expect(byName.compile?.usage).toBe(COMPILE_USAGE);
    expect(byName.export?.usage).toBe(EXPORT_USAGE);
    expect(byName.mcp?.usage).toBe(MCP_USAGE);
    expect(byName['update-docs']?.usage).toBe(UPDATE_DOCS_USAGE);
    expect(byName.explain?.usage).toBe(EXPLAIN_USAGE);
  });

  it('the bin references the manifest usage constants (no inline drift)', () => {
    // The bin must import the usage constants from the manifest rather than
    // hard-coding the usage literals, so they cannot diverge.
    expect(cliCommandSource).toMatch(/from '\.\.?\/commands-manifest\.js'/);
    for (const constant of [
      'ADD_USAGE',
      'BUILD_USAGE',
      'COMPILE_USAGE',
      'DB_USAGE',
      'DEV_USAGE',
      'EXPORT_USAGE',
      'MCP_USAGE',
      'UPDATE_DOCS_USAGE',
    ]) {
      expect(cliCommandSource, `CLI command modules should reference ${constant}`).toContain(
        constant,
      );
    }
  });

  it('parses command argv from manifest-owned flag specs', () => {
    const build = parseCommandArgv(
      ['src/app.tsx', '--out=dist-prod', '--check', '--preset', 'node', '--no-cache'],
      BUILD_ARGV_SPEC,
    );
    expect(build).toEqual(expect.objectContaining({ ok: true }));
    if (build.ok) {
      expect(build.value.positionals).toEqual(['src/app.tsx']);
      expect(parsedStringOption(build.value, '--out')).toBe('dist-prod');
      expect(parsedStringOption(build.value, '--preset')).toBe('node');
      expect(parsedBooleanOption(build.value, '--check')).toBe(true);
      expect(parsedBooleanOption(build.value, '--no-cache')).toBe(true);
    }

    const route = parseCommandArgv(
      [
        'src/route.tsx',
        '--rewrite',
        'Cart=./cart.js',
        '--rewrite=Shell=./shell.js',
        '--out',
        'dist/route.tsx',
      ],
      COMPILE_ARGV_SPECS.route,
    );
    expect(route).toEqual(expect.objectContaining({ ok: true }));
    if (route.ok) {
      expect(route.value.positionals).toEqual(['src/route.tsx']);
      expect(parsedStringListOption(route.value, '--rewrite')).toEqual([
        'Cart=./cart.js',
        'Shell=./shell.js',
      ]);
      expect(parsedStringOption(route.value, '--out')).toBe('dist/route.tsx');
    }

    expect(parseCommandArgv(['--out='], BUILD_ARGV_SPEC)).toEqual({
      error: 'missing-value',
      message: 'kovo: build --out requires a directory.\n',
      ok: false,
    });
    expect(parseCommandArgv(['--check=false'], BUILD_ARGV_SPEC)).toEqual({
      error: 'unknown-option',
      ok: false,
      option: '--check=false',
    });

    const db = parseCommandArgv(
      [
        'migrate',
        '--schema',
        'src/schema.ts',
        '--driver=pglite',
        '--data-dir',
        '.kovo/pglite',
        '--migrations',
        'migrations',
      ],
      DB_ARGV_SPEC,
    );
    expect(db).toEqual(expect.objectContaining({ ok: true }));
    if (db.ok) {
      expect(db.value.positionals).toEqual(['migrate']);
      expect(parsedStringOption(db.value, '--schema')).toBe('src/schema.ts');
      expect(parsedStringOption(db.value, '--driver')).toBe('pglite');
      expect(parsedStringOption(db.value, '--data-dir')).toBe('.kovo/pglite');
      expect(parsedStringOption(db.value, '--migrations')).toBe('migrations');
    }
  });

  it('renders shared argv errors and single-positional diagnostics', () => {
    const missing = parseCommandArgv(['--out'], BUILD_ARGV_SPEC);
    expect(missing).toEqual(
      expect.objectContaining({
        error: 'missing-value',
        ok: false,
      }),
    );
    if (!missing.ok) {
      expect(commandArgvError('build', missing, 'usage: kovo build <app-module>')).toEqual({
        message: 'kovo: build --out requires a directory.\n',
        ok: false,
      });
    }

    const unknown = parseCommandArgv(['--wat'], BUILD_ARGV_SPEC);
    if (!unknown.ok) {
      expect(commandArgvError('build', unknown, 'usage: kovo build <app-module>')).toEqual({
        message: 'kovo: unknown build option "--wat".\nusage: kovo build <app-module>',
        ok: false,
      });
    }

    const parsed = parseCommandArgv(['one.tsx', 'two.tsx'], BUILD_ARGV_SPEC);
    expect(parsed).toEqual(expect.objectContaining({ ok: true }));
    if (parsed.ok) {
      expect(
        requireSinglePositional(parsed.value, {
          label: 'app module path',
          name: 'build',
          usage: 'usage: kovo build <app-module>',
        }),
      ).toEqual({
        message: 'kovo: build accepts one app module path.\nusage: kovo build <app-module>',
        ok: false,
      });
    }
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
