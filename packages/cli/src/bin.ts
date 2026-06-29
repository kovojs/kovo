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
const isLongLivedCommand = process.argv[2] === 'mcp';

/** Flush a writable so a forced `process.exit` cannot truncate buffered output. */
function flushStream(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    // The callback for an empty write fires once the stream's internal buffer has
    // drained to the underlying fd, so prior synchronous writes are guaranteed out.
    stream.write('', () => resolve());
  });
}

void mainAsync().then(async (exitCode) => {
  process.exitCode = exitCode;
  if (isLongLivedCommand) return;
  await Promise.all([flushStream(process.stdout), flushStream(process.stderr)]);
  process.exit(exitCode);
});
