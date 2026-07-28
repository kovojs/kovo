import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { KOVO_COMMAND_SCHEMA } from './command-schema.js';
import {
  COMMANDS_MANIFEST,
  commandRequestToArgv,
  formatCommandHelp,
  formatRootHelp,
  KOVO_CLI_VERSION,
  renderShellCompletion,
} from './commands-manifest.js';
import { main, mainAsync } from './index.js';

describe('semantic CLI contract', () => {
  it('keeps all 13 capability commands in one categorized, versioned schema', () => {
    expect(
      KOVO_COMMAND_SCHEMA.map(
        (entry) => `${entry.category}:${entry.name}:${entry.resultProtocol ?? 'none'}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "daily-build:add:kovo-add/v1",
        "inspect-security:audit:kovo-audit/v1",
        "daily-build:build:kovo-build/v1",
        "inspect-security:check:kovo-check/v1",
        "agent-operator:compile:kovo-compile/v1",
        "agent-operator:db:kovo-db/v1",
        "daily-build:dev:none",
        "inspect-security:explain:kovo-explain/v1",
        "daily-build:export:kovo-export/v1",
        "agent-operator:fix:none",
        "inspect-security:incident:kovo-incident-scope/v1",
        "agent-operator:mcp:kovo-mcp/v1",
        "agent-operator:update-docs:kovo-update-docs/v1",
      ]
    `);

    expect(new Set(KOVO_COMMAND_SCHEMA.map((entry) => entry.name)).size).toBe(13);
    for (const entry of KOVO_COMMAND_SCHEMA) {
      expect(entry.aliases).toEqual([...new Set(entry.aliases)]);
      expect(entry.examples.length).toBeGreaterThan(0);
      expect(entry.exits).toMatchObject({ finding: 1, success: 0, usage: 2 });
      expect(entry.usage.length).toBeGreaterThan(0);
      if (entry.resultProtocol !== null) {
        expect(entry.resultProtocol).toMatch(/^[a-z][a-z0-9-]*\/v\d+$/u);
      }

      const optionIds = entry.options.map((option) => option.id);
      const optionFlags = entry.options.flatMap((option) => option.flags);
      expect(new Set(optionIds).size, `${entry.name} option ids`).toBe(optionIds.length);
      expect(new Set(optionFlags).size, `${entry.name} option flags`).toBe(optionFlags.length);
      for (const option of entry.options) {
        expect(option.flags[0]).toMatch(/^--[a-z][a-z0-9-]*$/u);
        if (option.value?.kind === 'enum') {
          expect(option.value.values?.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('projects command reference data from the same schema', () => {
    expect(COMMANDS_MANIFEST.map((entry) => entry.name)).toEqual(
      KOVO_COMMAND_SCHEMA.map((entry) => entry.name),
    );
    for (const [index, reference] of COMMANDS_MANIFEST.entries()) {
      const schema = KOVO_COMMAND_SCHEMA[index]!;
      expect(reference).toMatchObject({
        aliases: schema.aliases,
        category: schema.category,
        examples: schema.examples,
        exits: schema.exits,
        name: schema.name,
        resultProtocol: schema.resultProtocol,
        summary: schema.summary,
      });
      for (const option of schema.options) {
        expect(reference.flags.some((row) => row.flag.includes(option.flags[0]))).toBe(true);
      }
    }
  });

  it('derives multiline root and subcommand help and keeps every help/version path informational', () => {
    const rootHelp = formatRootHelp();
    expect(rootHelp).toContain(`Kovo ${KOVO_CLI_VERSION}\n`);
    expect(rootHelp).toContain('Daily and build:');
    expect(rootHelp).toContain('Inspect and security:');
    expect(rootHelp).toContain('Agent and operator:');

    for (const args of [[], ['--help'], ['-h'], ['help']] as const) {
      const captured = captureWrites(() => main(args));
      expect(captured).toEqual({ result: 0, stderr: '', stdout: rootHelp });
    }

    for (const entry of KOVO_COMMAND_SCHEMA) {
      const help = formatCommandHelp(entry.name);
      expect(help).toContain(`kovo ${entry.name}`);
      expect(help).toContain(
        `Result protocol: ${entry.resultProtocol ?? 'none (human process surface)'}`,
      );
      for (const args of [
        ['help', entry.name],
        [entry.name, '--help'],
        [entry.name, '-h'],
      ] as const) {
        const captured = captureWrites(() => main(args));
        expect(captured).toEqual({ result: 0, stderr: '', stdout: help });
      }

      const version = captureWrites(() => main([entry.name, '--version']));
      expect(version).toEqual({
        result: 0,
        stderr: '',
        stdout: `kovo ${KOVO_CLI_VERSION}\n`,
      });
    }

    for (const args of [['--version'], ['-V'], ['version']] as const) {
      expect(captureWrites(() => main(args))).toEqual({
        result: 0,
        stderr: '',
        stdout: `kovo ${KOVO_CLI_VERSION}\n`,
      });
    }
  });

  it('derives bash, fish, and zsh completion from every command and option', () => {
    const completions = {
      bash: renderShellCompletion('bash'),
      fish: renderShellCompletion('fish'),
      zsh: renderShellCompletion('zsh'),
    };
    expect(
      Object.entries(completions).map(
        ([shell, output]) =>
          `${shell}:${output.split('\n')[0]}:${output.trimEnd().split('\n').at(-1)}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "bash:# generated by kovo completion bash; do not edit:complete -F _kovo_complete kovo",
        "fish:# generated by kovo completion fish; do not edit:complete -c kovo -n '__fish_seen_subcommand_from completion' -a 'bash fish zsh'",
        "zsh:#compdef kovo:_kovo "$@"",
      ]
    `);

    for (const [shell, output] of Object.entries(completions)) {
      for (const entry of KOVO_COMMAND_SCHEMA) {
        expect(output, `${shell} ${entry.name}`).toContain(entry.name);
        for (const option of entry.options) {
          const renderedFlag =
            shell === 'fish' ? `-l '${option.flags[0].slice(2)}'` : option.flags[0];
          expect(output, `${shell} ${entry.name} ${option.flags[0]}`).toContain(renderedFlag);
        }
      }
      const captured = captureWrites(() => main(['completion', shell]));
      expect(captured).toEqual({ result: 0, stderr: '', stdout: output });
    }
  });

  it('serializes semantic programmatic requests without exposing argv-shaped option keys', () => {
    expect(
      commandRequestToArgv({
        command: 'build',
        kind: 'command',
        operands: ['./src/app.tsx'],
        options: { cache: false, check: true, out: 'dist-prod', preset: 'node' },
      }),
    ).toEqual([
      'build',
      './src/app.tsx',
      '--no-cache',
      '--check',
      '--out',
      'dist-prod',
      '--preset',
      'node',
    ]);
    expect(
      commandRequestToArgv({
        command: 'compile',
        kind: 'command',
        operands: ['route', 'src/app.tsx'],
        options: {
          out: 'dist/app.tsx',
          rewrite: ['Cart=./cart.js', 'Shell=./shell.js'],
        },
      }),
    ).toEqual([
      'compile',
      'route',
      'src/app.tsx',
      '--out',
      'dist/app.tsx',
      '--rewrite',
      'Cart=./cart.js',
      '--rewrite',
      'Shell=./shell.js',
    ]);
    expect(
      commandRequestToArgv({
        command: 'dev',
        kind: 'command',
        operands: ['./src/app.tsx'],
        options: { port: 4173, strictPort: true },
      }),
    ).toEqual(['dev', './src/app.tsx', '--port', '4173', '--strict-port']);
    expect(() =>
      commandRequestToArgv({
        command: 'build',
        kind: 'command',
        // @ts-expect-error argv spellings are deliberately absent from the semantic API.
        options: { '--out': 'dist' },
      }),
    ).toThrow(/Unknown kovo build semantic option "--out"/u);
    expect(() =>
      commandRequestToArgv({
        command: 'build',
        kind: 'command',
        options: { preset: 'not-a-preset' },
      }),
    ).toThrow(/requires node, vercel, or cloudflare/u);
  });

  it('uses exit 2 for invocation mistakes and retains exit 1 for proof failures', async () => {
    expect(captureWrites(() => main(['not-a-command']))).toMatchObject({
      result: 2,
      stdout: '',
    });
    expect(captureWrites(() => main(['audit', '--not-an-option']))).toMatchObject({
      result: 2,
      stdout: '',
    });

    const missingBuild = await captureWritesAsync(() => mainAsync(['build']));
    expect(missingBuild).toMatchObject({ result: 2, stdout: '' });
    expect(missingBuild.stderr).toContain('kovo: build requires an app module path.');

    const invalidDevConfig = await captureWritesAsync(() =>
      mainAsync(['dev', './src/app.tsx', '--port', 'not-a-port']),
    );
    expect(invalidDevConfig).toMatchObject({ result: 2, stdout: '' });
    expect(invalidDevConfig.stderr).toContain(
      'kovo: dev --port must be an integer from 0 through 65535.',
    );

    const missingGraph = join(tmpdir(), 'kovo-command-contract-missing-graph.json');
    const proofFailure = captureWrites(() => main(['check', missingGraph]));
    expect(proofFailure.result).toBe(1);
    expect(proofFailure.stdout).toBe('');
    expect(proofFailure.stderr).toContain('kovo: input file not found:');
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

async function captureWritesAsync(run: () => Promise<number>) {
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
    return { result: await run(), stderr, stdout };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
