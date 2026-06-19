import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function emitCommerceGraphArtifactsToTemp() {
  const outDir = mkdtempSync(resolve(tmpdir(), 'kovo-commerce-graph-artifacts-'));
  try {
    execFileSync(
      'pnpm',
      ['--filter', '@kovojs/example-commerce', 'run', 'emit-graph', '--', '--out-dir', outDir],
      { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return {
      cleanup: () => rmSync(outDir, { force: true, recursive: true }),
      graphPath: resolve(outDir, 'graph.json'),
      outDir,
    };
  } catch (error) {
    rmSync(outDir, { force: true, recursive: true });
    throw error;
  }
}

export function readTempCommerceGraph() {
  const artifacts = emitCommerceGraphArtifactsToTemp();
  try {
    return JSON.parse(readFileSync(artifacts.graphPath, 'utf8'));
  } finally {
    artifacts.cleanup();
  }
}
