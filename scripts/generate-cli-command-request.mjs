import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

import { assertGeneratedArtifactText } from './generated-artifact-check.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const sourceUrl = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
      if (existsSync(sourceUrl)) return nextResolve(sourceUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { renderSemanticCommandRequestSource } =
  await import('../packages/cli/src/semantic-command-request-source.ts');
const target = fileURLToPath(
  new URL('../packages/cli/src/semantic-command-request.generated.ts', import.meta.url),
);
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const formatted = spawnSync('pnpm', ['exec', 'vp', 'fmt', `--stdin-filepath=${target}`], {
  cwd: repoRoot,
  encoding: 'utf8',
  input: renderSemanticCommandRequestSource(),
  maxBuffer: 4 * 1024 * 1024,
  stdio: ['pipe', 'pipe', 'pipe'],
});
if (
  formatted.error ||
  formatted.signal ||
  formatted.status !== 0 ||
  formatted.stdout.length === 0
) {
  throw new Error(
    `Unable to format generated CLI semantic command request: ${
      formatted.stderr.trim() || formatted.error?.message || formatted.signal || formatted.status
    }`,
  );
}
const expected = formatted.stdout;

if (process.argv.includes('--check')) {
  const actual = existsSync(target) ? readFileSync(target, 'utf8') : '';
  assertGeneratedArtifactText({
    actual,
    expected,
    label: 'Generated CLI semantic command request',
    regenerate: '`pnpm generate:cli-command-request`',
  });
  process.stdout.write('cli-semantic-command-request/v1 OK\n');
} else {
  writeFileSync(target, expected, 'utf8');
  process.stdout.write(`Wrote ${target}\n`);
}
