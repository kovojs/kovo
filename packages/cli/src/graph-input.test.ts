import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discoverGraphInputPath,
  inputErrorMessage,
  readGraphInput,
  runSelectedGraphCommand,
} from './graph-input.js';
import { createKovoGraphProof, createKovoRuntimePostureManifest } from './graph-proof.js';

describe('graph input reading', () => {
  it('discovers the nearest built graph artifact from the current directory', () => {
    const previousCwd = process.cwd();
    const root = mkdtemp('kovo-graph-input-');
    const nested = join(root, 'src', 'routes');
    const distKovo = join(nested, 'dist', '.kovo');

    mkdirSync(distKovo, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(distKovo, 'graph.json'), '{"queries":[]}');

    try {
      process.chdir(nested);
      expect(realpathSync(discoverGraphInputPath() ?? '')).toBe(
        realpathSync(join(nested, 'dist', '.kovo', 'graph.json')),
      );
      expect(readGraphInput(undefined)).toEqual({ ok: true, value: { queries: [] } });
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('keeps stable validation messages for invalid graph JSON fields', () => {
    const root = mkdtemp('kovo-graph-input-invalid-');
    const graphPath = join(root, 'graph.json');

    try {
      writeFileSync(graphPath, '{"touchGraph":[]}');
      const result = readGraphInput(graphPath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(inputErrorMessage(result.error)).toBe(
          `kovo: input JSON field touchGraph must be an object: ${graphPath}`,
        );
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('requires explicit artifact mode and rejects stale, partial, failed, and wrong-posture proof', () => {
    const root = mkdtemp('kovo-graph-proof-');
    const graphPath = join(root, 'graph.json');
    const graph = completedGraph();
    const run = () => ({ exitCode: 0 as const, output: 'OK\n' });

    try {
      writeFileSync(graphPath, JSON.stringify(graph));
      expect(runSelectedGraphCommand(graphPath, false, run, root)).toMatchObject({
        error: expect.stringContaining('must be selected with --artifact'),
        exitCode: 1,
      });
      expect(runSelectedGraphCommand(graphPath, true, run, root)).toEqual({
        exitCode: 0,
        output: 'OK\n',
      });

      for (const mutate of [
        (value: Record<string, unknown>) => {
          delete value.proof;
        },
        (value: Record<string, unknown>) => {
          (value.proof as Record<string, unknown>).completion = 'failed';
        },
        (value: Record<string, unknown>) => {
          (value.proof as Record<string, unknown>).sourceSetDigest = `sha256:${'0'.repeat(64)}`;
        },
        (value: Record<string, unknown>) => {
          (value.proof as Record<string, unknown>).configDigest = `sha256:${'0'.repeat(64)}`;
        },
        (value: Record<string, unknown>) => {
          (value.analysisInputs as Record<string, unknown>).runtimeTarget = 'vercel';
        },
        (value: Record<string, unknown>) => {
          (value.proof as Record<string, unknown>).compilerVersion = 'stale';
        },
        (value: Record<string, unknown>) => {
          (
            (value.provenance as Record<string, unknown>).frameworkPackages as Record<
              string,
              unknown
            >[]
          )[0]!.version = 'stale';
        },
        (value: Record<string, unknown>) => {
          (value.proof as Record<string, unknown>).appBuildToken = `sha256:${'6'.repeat(64)}`;
        },
      ]) {
        const stale = JSON.parse(JSON.stringify(graph)) as Record<string, unknown>;
        mutate(stale);
        writeFileSync(graphPath, JSON.stringify(stale));
        expect(runSelectedGraphCommand(graphPath, true, run, root)).toMatchObject({ exitCode: 1 });
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

function completedGraph() {
  const graph = {
    analysisInputs: {
      runtimeTarget: 'node' as const,
      schema: 'kovo.analysis.inputs/v1' as const,
      sources: [
        {
          codeUnitLength: 12,
          contentHash: `sha256:${'1'.repeat(64)}` as const,
          encoding: 'utf16le' as const,
          path: 'src/app.tsx',
          role: 'app' as const,
        },
        {
          codeUnitLength: 8,
          contentHash: `sha256:${'2'.repeat(64)}` as const,
          encoding: 'utf16le' as const,
          path: 'kovo.config.ts',
          role: 'config' as const,
        },
      ],
    },
    provenance: {
      frameworkPackages: [{ name: '@kovojs/compiler', version: '0.2.0' }],
      graphSchemaVersion: 'kovo.graph/v2',
      pnpmLock: { contentHash: `sha256:${'3'.repeat(64)}` },
      schema: 'kovo.artifact.provenance/v1' as const,
      securityGuarantees: {
        canonicalHash: `sha256:${'4'.repeat(64)}`,
        schema: 'kovo.security.guarantees/v1' as const,
      },
    },
  };
  const graphWithProof = {
    ...graph,
    proof: createKovoGraphProof(graph, '5'.repeat(64), '11111111-1111-4111-8111-111111111111'),
  };
  return {
    ...graphWithProof,
    runtimePosture: createKovoRuntimePostureManifest(graphWithProof),
  };
}

function mkdtemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
