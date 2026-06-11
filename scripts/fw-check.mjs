import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const cliEntry = 'dist/cli/src/index.mjs';

export function missingBuildMessage(entry = cliEntry) {
  return `fw-check requires ${entry}. Run \`vp run build\` first.`;
}

export function runFwCheck({ entry = cliEntry } = {}) {
  if (!existsSync(entry)) {
    console.error(missingBuildMessage(entry));
    return 1;
  }

  const commands = [
    ['node', ['--test', 'tests/fw-check.node.mjs']],
    ['node', [entry, 'check', 'examples/commerce/src/generated/graph.json']],
  ];

  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { stdio: 'inherit' });
    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (import.meta.url === entryPoint) {
  process.exit(runFwCheck());
}
