import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { emitCommerceGraphArtifactsToTemp } from './commerce-graph.mjs';

export const cliEntry = 'dist/cli/src/index.mjs';

export function missingBuildMessage(entry = cliEntry) {
  return `kovo-check requires ${entry}. Run \`vp run build\` first.`;
}

export function runKovoCheck({ entry = cliEntry } = {}) {
  if (!existsSync(entry)) {
    console.error(missingBuildMessage(entry));
    return 1;
  }

  const graphArtifacts = emitCommerceGraphArtifactsToTemp();
  const commands = [['node', ['--test', 'tests/kovo-check.node.mjs']]];

  try {
    commands.push(['node', [entry, 'check', graphArtifacts.graphPath]]);
    for (const [command, args] of commands) {
      const result = spawnSync(command, args, { stdio: 'inherit' });
      if (result.status !== 0) {
        return result.status ?? 1;
      }
    }
  } finally {
    graphArtifacts.cleanup();
  }

  return 0;
}

const entryPoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';

if (import.meta.url === entryPoint) {
  process.exit(runKovoCheck());
}
