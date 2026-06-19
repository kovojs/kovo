import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = ['commerce', 'crm', 'stackoverflow'] as const;

export default function setupExampleGeneratedGraphs() {
  for (const example of examples) {
    const root = resolve(repoRoot, 'examples', example);
    execFileSync(process.execPath, [resolve(root, 'scripts/emit-graph.mjs')], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return cleanupExampleGeneratedGraphs;
}

function cleanupExampleGeneratedGraphs() {
  for (const example of examples) {
    rmSync(resolve(repoRoot, 'examples', example, 'src/generated'), {
      force: true,
      recursive: true,
    });
  }
}
