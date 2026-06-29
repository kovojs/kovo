#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const currentBinPath = fileURLToPath(import.meta.url);

if (currentBinPath.endsWith('.ts') && process.env.KOVO_CLI_TRANSFORM_TYPES !== '1') {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor >= 22 && !process.execArgv.includes('--experimental-transform-types')) {
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        ...process.execArgv,
        currentBinPath,
        ...process.argv.slice(2),
      ],
      {
        env: { ...process.env, KOVO_CLI_TRANSFORM_TYPES: '1' },
        stdio: 'inherit',
      },
    );
    process.exit(result.status ?? 1);
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
      if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { mainAsync } = await import('./index.js');

// `kovo mcp` is a long-lived stdio server: its `mainAsync` resolves as soon as the
// transport is wired up, while the process must stay alive to serve requests. Every
// other `kovo` command is one-shot — once `mainAsync` resolves the command result is
// fully written, so exit promptly instead of waiting out a multi-second event-loop
// drain on handles the run can't reach (a loaded app module's top-level resources such
// as a PGlite client, plus vite-plus build servers). See plans/fast-kovo-check2.md #1:
// this collapsed a ~14.3s warm `kovo build` to ~3.6s with byte-identical diagnostics.
// NOTE: this file is also copied verbatim to a `.mjs` and run as plain JavaScript by the
// "does not respawn for a compiled JavaScript bin entrypoint" test, so it must stay free of
// TypeScript-only syntax (no type annotations / type arguments). Lean on contextual typing.
const isLongLivedCommand = process.argv[2] === 'mcp';

void mainAsync().then(async (exitCode) => {
  process.exitCode = exitCode;
  if (isLongLivedCommand) return;
  // Flush stdout/stderr (an empty write's callback fires after the buffer drains to the fd)
  // so the forced exit cannot truncate output, then exit promptly instead of waiting out the
  // post-result event-loop drain on handles the run can't reach.
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) => new Promise((resolve) => stream.write('', () => resolve(undefined))),
    ),
  );
  process.exit(exitCode);
});
