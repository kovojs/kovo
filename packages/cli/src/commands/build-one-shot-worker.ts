import { writeFileSync } from 'node:fs';

import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import {
  abortKovoBuildOutputTransaction,
  finishKovoBuildOneShot,
  kovoBuildOneShotIdentity,
  parseBuildArgs,
  produceKovoBuildOneShotClientPhase,
  produceKovoBuildOneShotAnalysis,
  produceKovoBuildOneShotServerPhase,
  runSourceCheckCommand,
  type KovoBuildOneShotAnalysis,
  type KovoBuildOneShotClientPhase,
  type KovoBuildOneShotServerPhase,
} from './build-export.js';
import {
  encodeKovoBuildOneShotHandoff,
  readKovoBuildOneShotHandoff,
  readKovoBuildOneShotWireFromFd,
  type KovoBuildOneShotIdentity,
} from './build-one-shot-handoff.js';
import { parseCheckArgs } from '../graph-args.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const mode = process.argv[2];
const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();

let exitCode: 0 | 1 | 2 = 2;
if (mode === 'check') {
  const parsed = parseCheckArgs(process.argv.slice(3));
  if (!parsed.ok || !('source' in parsed)) {
    exitCode = writeUsageError(
      parsed.ok ? 'kovo: isolated check worker requires a source invocation.\n' : parsed.message,
      'check',
    );
  } else {
    exitCode = writeFormattedCommandResult(
      await runSourceCheckCommand(
        { appModulePath: parsed.appModulePath, cache: parsed.cache },
        security,
      ),
      parsed.format,
      'proof',
      'check',
    );
  }
} else if (mode === 'analyze') {
  const parsed = parseBuildArgs(process.argv.slice(3));
  if (!parsed.ok) {
    exitCode = writeUsageError(parsed.message, 'build');
  } else {
    const outcome = await produceKovoBuildOneShotAnalysis(parsed.options, security);
    if ('exitCode' in outcome) {
      exitCode = writeFormattedCommandResult(outcome, parsed.format, 'build', 'build');
    } else {
      const identity = kovoBuildOneShotIdentity(parsed.options, outcome, security);
      const wire = encodeKovoBuildOneShotHandoff({
        analysis: outcome,
        identity,
        schema: 'kovo-build-one-shot-analysis/v1',
      });
      await flushCommandStreams();
      writeFileSync(3, wire);
      process.exit(0);
    }
  }
} else if (mode === 'client' || mode === 'server' || mode === 'final') {
  const identityText = process.argv[3];
  const parsed = parseBuildArgs(process.argv.slice(4));
  if (typeof identityText !== 'string' || !parsed.ok) {
    exitCode = writeUsageError(
      parsed.ok
        ? `kovo: isolated build ${mode} phase requires one private handoff.\n`
        : parsed.message,
      'build',
    );
  } else {
    let identity: KovoBuildOneShotIdentity;
    try {
      identity = JSON.parse(identityText) as KovoBuildOneShotIdentity;
      const payload = readKovoBuildOneShotHandoff(readKovoBuildOneShotWireFromFd(0), identity);
      const phase = oneShotPhasePayload(payload.analysis);
      if (mode === 'client') {
        const outcome = await produceKovoBuildOneShotClientPhase(
          parsed.options,
          phase.analysis,
          identity,
          security,
        );
        if ('exitCode' in outcome) {
          exitCode = writeFormattedCommandResult(outcome, parsed.format, 'build', 'build');
        } else {
          await writePhaseHandoff(identity, {
            analysis: phase.analysis,
            clientPhase: outcome,
          });
        }
      } else if (mode === 'server') {
        if (phase.clientPhase === undefined) {
          throw new TypeError('Kovo build server phase omitted the client phase.');
        }
        const outcome = await produceKovoBuildOneShotServerPhase(
          parsed.options,
          phase.analysis,
          phase.clientPhase,
          identity,
          security,
        );
        if ('exitCode' in outcome) {
          exitCode = writeFormattedCommandResult(outcome, parsed.format, 'build', 'build');
        } else {
          await writePhaseHandoff(identity, {
            analysis: phase.analysis,
            clientPhase: phase.clientPhase,
            serverPhase: outcome,
          });
        }
      } else {
        if (phase.clientPhase === undefined || phase.serverPhase === undefined) {
          throw new TypeError('Kovo build final phase omitted a prior phase.');
        }
        exitCode = writeFormattedCommandResult(
          await finishKovoBuildOneShot(
            parsed.options,
            phase.analysis,
            phase.clientPhase,
            phase.serverPhase,
            identity,
            security,
          ),
          parsed.format,
          'build',
          'build',
        );
      }
    } catch (error) {
      exitCode = writeFormattedCommandResult(
        {
          error: `${error instanceof Error ? error.message : String(error)}\n`,
          exitCode: 1,
        },
        parsed.format,
        'build',
        'build',
      );
    }
  }
} else {
  process.stderr.write(
    'Kovo one-shot worker requires check, analyze, client, server, or final mode.\n',
  );
  exitCode = 2;
}

await flushCommandStreams();
process.exit(exitCode);

async function flushCommandStreams(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) => new Promise<void>((resolve) => stream.write('', () => resolve())),
    ),
  );
}

interface OneShotPhasePayload {
  readonly analysis: KovoBuildOneShotAnalysis;
  readonly clientPhase?: KovoBuildOneShotClientPhase;
  readonly serverPhase?: KovoBuildOneShotServerPhase;
}

function oneShotPhasePayload(value: unknown): OneShotPhasePayload {
  if (value === null || typeof value !== 'object' || !('analysis' in value)) {
    throw new TypeError('Kovo build phase handoff is incomplete.');
  }
  return value as OneShotPhasePayload;
}

async function writePhaseHandoff(
  identity: KovoBuildOneShotIdentity,
  analysis: OneShotPhasePayload,
): Promise<never> {
  let wire: Buffer;
  try {
    wire = encodeKovoBuildOneShotHandoff({
      analysis,
      identity,
      schema: 'kovo-build-one-shot-analysis/v1',
    });
  } catch (error) {
    if (analysis.clientPhase !== undefined) {
      abortKovoBuildOutputTransaction({ ...analysis.clientPhase.transaction });
    }
    throw error;
  }
  await flushCommandStreams();
  writeFileSync(3, wire);
  process.exit(0);
}
