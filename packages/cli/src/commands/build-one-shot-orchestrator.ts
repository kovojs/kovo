import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseKovoCommandInvocation } from '../commands-manifest.js';
import type { KovoCommandSecurityDisposition } from './security-disposition.js';
import {
  createKovoBuildOneShotHandoffDirectory,
  parseKovoBuildOneShotProducerControl,
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

  let directory: string | undefined;
  try {
    directory = createKovoBuildOneShotHandoffDirectory(security.invocationCwd);
    const analysis = runWorker(binPath, ['analyze', directory, ...args.slice(1)], security, [
      'inherit',
      'inherit',
      'inherit',
      'pipe',
    ]);
    if (analysis.status !== 0) return analysis.status;
    const control = parseKovoBuildOneShotProducerControl(
      Buffer.isBuffer(analysis.control)
        ? analysis.control.toString('utf8')
        : String(analysis.control ?? ''),
    );
    return runWorker(
      binPath,
      [
        'emit',
        control.reference.file,
        control.reference.digest,
        JSON.stringify(control.identity),
        ...args.slice(1),
      ],
      security,
      ['inherit', 'inherit', 'inherit'],
    ).status;
  } catch (error) {
    process.stderr.write(
      `kovo build isolation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    if (directory !== undefined) rmSync(directory, { force: true, recursive: true });
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
