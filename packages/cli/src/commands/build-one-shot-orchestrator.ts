import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import type { KovoCommandSecurityDisposition } from './security-disposition.js';
import {
  inspectKovoBuildOneShotHandoff,
  KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
} from './build-one-shot-handoff.js';

/** Run packed/source one-shot source checking or build phases without retaining phase heaps. */
export function runKovoIsolatedOneShotInvocation(
  args: readonly string[],
  binPath: string,
  security: KovoCommandSecurityDisposition,
): number | undefined {
  const check =
    args[0] === 'check' ? parseKovoCommandInvocation('check', args.slice(1)) : undefined;
  if (check?.ok && (check.value.form === 'source-default' || check.value.form === 'source')) {
    return runWorker(binPath, ['check', ...args.slice(1)], security, [
      'inherit',
      'inherit',
      'inherit',
    ]).status;
  }
  const build =
    args[0] === 'build' ? parseKovoCommandInvocation('build', args.slice(1)) : undefined;
  if (!build?.ok) return undefined;

  try {
    const analysis = runWorker(binPath, ['analyze', ...args.slice(1)], security, [
      'inherit',
      'inherit',
      'inherit',
      'pipe',
    ]);
    if (analysis.status !== 0) return analysis.status;
    if (!Buffer.isBuffer(analysis.control)) {
      throw new TypeError('Kovo build analysis worker omitted its private handoff.');
    }
    const inspection = inspectKovoBuildOneShotHandoff(analysis.control);
    let wire = analysis.control;
    for (const phase of ['client', 'server'] as const) {
      const result = runWorker(
        binPath,
        [phase, JSON.stringify(inspection.identity), ...args.slice(1)],
        security,
        ['pipe', 'inherit', 'inherit', 'pipe'],
        wire,
      );
      if (result.status !== 0) return result.status;
      if (!Buffer.isBuffer(result.control)) {
        throw new TypeError(`Kovo build ${phase} worker omitted its private handoff.`);
      }
      const nextInspection = inspectKovoBuildOneShotHandoff(result.control);
      if (JSON.stringify(nextInspection.identity) !== JSON.stringify(inspection.identity)) {
        throw new TypeError(`Kovo build ${phase} worker changed the invocation identity.`);
      }
      wire = result.control;
    }
    return runWorker(
      binPath,
      ['final', JSON.stringify(inspection.identity), ...args.slice(1)],
      security,
      ['pipe', 'inherit', 'inherit'],
      wire,
    ).status;
  } catch (error) {
    process.stderr.write(
      `kovo build isolation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}

interface OneShotWorkerResult {
  readonly control?: Buffer | string | null;
  readonly status: number;
}

function runWorker(
  binPath: string,
  args: readonly string[],
  security: KovoCommandSecurityDisposition,
  stdio: ('inherit' | 'pipe')[],
  input?: Buffer,
): OneShotWorkerResult {
  const sourceMode = binPath.endsWith('.ts');
  const worker = sourceMode
    ? resolve(dirname(binPath), 'commands/build-one-shot-worker.ts')
    : resolveOneShotWorker(binPath);
  const result = spawnSync(
    process.execPath,
    [
      ...(sourceMode
        ? [
            '--disable-warning=ExperimentalWarning',
            '--experimental-transform-types',
            '--import',
            pathToFileURL(resolve(dirname(binPath), 'commands/build-static-trust-source-hook.mjs'))
              .href,
          ]
        : []),
      worker,
      ...args,
    ],
    {
      cwd: security.invocationCwd,
      env: security.invocationEnv,
      ...(input === undefined ? {} : { input }),
      maxBuffer: KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES,
      stdio,
    },
  );
  if (result.error !== undefined) throw result.error;
  return {
    ...(result.output?.[3] === undefined ? {} : { control: result.output[3] }),
    status: result.status ?? 1,
  };
}

function resolveOneShotWorker(binPath: string): string {
  const packaged = resolve(dirname(binPath), 'commands/build-one-shot-worker.mjs');
  if (existsSync(packaged)) return packaged;
  return resolve(dirname(binPath), 'cli/src/commands/build-one-shot-worker.mjs');
}
