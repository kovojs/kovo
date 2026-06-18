#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

if (process.env.KOVO_CLI_TRANSFORM_TYPES !== '1') {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor >= 22 && !process.execArgv.includes('--experimental-transform-types')) {
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-transform-types',
        ...process.execArgv,
        fileURLToPath(import.meta.url),
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

void mainAsync().then((exitCode) => {
  process.exitCode = exitCode;
});
