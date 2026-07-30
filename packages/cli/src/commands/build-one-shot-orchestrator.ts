import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Writable } from 'node:stream';
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
): Promise<number | undefined> {
  return runKovoIsolatedOneShotInvocationAsync(args, binPath, security);
}

async function runKovoIsolatedOneShotInvocationAsync(
  args: readonly string[],
  binPath: string,
  security: KovoCommandSecurityDisposition,
): Promise<number | undefined> {
  const check =
    args[0] === 'check' ? parseKovoCommandInvocation('check', args.slice(1)) : undefined;
  if (check?.ok && (check.value.form === 'source-default' || check.value.form === 'source')) {
    try {
      const analysis = await runWorker(binPath, 'check', args.slice(1), security, undefined, true);
      if (analysis.status !== 0) return analysis.status;
      if (!Buffer.isBuffer(analysis.control)) {
        throw new TypeError('Kovo check analysis worker omitted its private handoff.');
      }
      const inspection = inspectKovoBuildOneShotHandoff(analysis.control);
      return (
        await runWorker(
          binPath,
          'check-final',
          [JSON.stringify(inspection.identity), ...args.slice(1)],
          security,
          analysis.control,
        )
      ).status;
    } catch (error) {
      process.stderr.write(
        `kovo check isolation failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }
  const build =
    args[0] === 'build' ? parseKovoCommandInvocation('build', args.slice(1)) : undefined;
  if (!build?.ok) return undefined;

  try {
    const analysis = await runWorker(binPath, 'analyze', args.slice(1), security, undefined, true);
    if (analysis.status !== 0) return analysis.status;
    if (!Buffer.isBuffer(analysis.control)) {
      throw new TypeError('Kovo build analysis worker omitted its private handoff.');
    }
    const inspection = inspectKovoBuildOneShotHandoff(analysis.control);
    let wire = analysis.control;
    for (const phase of ['client', 'server'] as const) {
      const result = await runWorker(
        binPath,
        phase,
        [JSON.stringify(inspection.identity), ...args.slice(1)],
        security,
        wire,
        true,
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
    return (
      await runWorker(
        binPath,
        'final',
        [JSON.stringify(inspection.identity), ...args.slice(1)],
        security,
        wire,
      )
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
  phase: 'analyze' | 'check' | 'check-final' | 'client' | 'final' | 'server',
  args: readonly string[],
  security: KovoCommandSecurityDisposition,
  input?: Buffer,
  captureControl = false,
): Promise<OneShotWorkerResult> {
  const sourceMode = binPath.endsWith('.ts');
  const worker = sourceMode
    ? resolve(dirname(binPath), `commands/build-one-shot-${phase}-worker.ts`)
    : resolveOneShotWorker(binPath, phase);
  const child = spawn(
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
      stdio: [
        'inherit',
        'inherit',
        'inherit',
        input === undefined ? 'ignore' : 'pipe',
        captureControl ? 'pipe' : 'ignore',
      ],
    },
  );
  return new Promise<OneShotWorkerResult>((resolveResult, reject) => {
    let settled = false;
    let total = 0;
    const chunks: Buffer[] = [];
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    child.on('error', fail);
    child.stdio[4]?.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > KOVO_BUILD_ONE_SHOT_MAX_WIRE_BYTES) {
        fail(new TypeError('Kovo build handoff exceeded its byte limit.'));
        return;
      }
      chunks[chunks.length] = chunk;
    });
    child.stdio[4]?.on('error', fail);
    child.stdio[3]?.on('error', fail);
    child.on('close', (status) => {
      if (settled) return;
      settled = true;
      resolveResult({
        ...(captureControl ? { control: Buffer.concat(chunks, total) } : {}),
        status: status ?? 1,
      });
    });
    if (input !== undefined) (child.stdio[3] as Writable | null)?.end(input);
  });
}

function resolveOneShotWorker(
  binPath: string,
  phase: 'analyze' | 'check' | 'check-final' | 'client' | 'final' | 'server',
): string {
  const packaged = resolve(dirname(binPath), `commands/build-one-shot-${phase}-worker.mjs`);
  if (existsSync(packaged)) return packaged;
  return resolve(dirname(binPath), `cli/src/commands/build-one-shot-${phase}-worker.mjs`);
}
