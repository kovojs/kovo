import { writeFileSync } from 'node:fs';

import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import {
  abortKovoBuildOutputTransaction,
  parseBuildArgs,
  produceKovoBuildOneShotClientPhase,
  requireKovoBuildOneShotPhasePayload,
} from './build-export.js';
import {
  encodeKovoBuildOneShotHandoff,
  parseKovoBuildOneShotIdentity,
  readKovoBuildOneShotHandoff,
  readKovoBuildOneShotWireFromFd,
} from './build-one-shot-handoff.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const collectGarbage = globalThis.gc;
if (typeof collectGarbage !== 'function') {
  throw new TypeError('Kovo isolated client emission requires an exposed garbage collector.');
}
const identityText = process.argv[2];
const parsed = parseBuildArgs(process.argv.slice(3));
const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();
let exitCode: 0 | 1 | 2 = 1;
if (identityText === undefined || !parsed.ok) {
  exitCode = writeUsageError(
    parsed.ok
      ? 'kovo: isolated build client phase requires one private handoff.\n'
      : parsed.message,
    'build',
  );
} else {
  try {
    const identity = parseKovoBuildOneShotIdentity(identityText);
    const payload = readKovoBuildOneShotHandoff(readKovoBuildOneShotWireFromFd(3), identity);
    const phase = requireKovoBuildOneShotPhasePayload(payload.analysis, 'analysis');
    const outcome = await produceKovoBuildOneShotClientPhase(
      parsed.options,
      phase.analysis,
      identity,
      security,
    );
    if ('exitCode' in outcome) {
      exitCode = writeFormattedCommandResult(outcome, parsed.format, 'build', 'build');
    } else {
      collectGarbage();
      await writePhaseHandoff(identity, phase.analysis, outcome);
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
await flushCommandStreams();
process.exit(exitCode);

async function writePhaseHandoff(
  identity: ReturnType<typeof parseKovoBuildOneShotIdentity>,
  analysis: ReturnType<typeof requireKovoBuildOneShotPhasePayload>['analysis'],
  clientPhase: Awaited<ReturnType<typeof produceKovoBuildOneShotClientPhase>>,
): Promise<never> {
  if ('exitCode' in clientPhase) throw new TypeError('Kovo build client handoff is invalid.');
  try {
    const wire = encodeKovoBuildOneShotHandoff({
      analysis: { analysis, clientPhase },
      identity,
      schema: 'kovo-build-one-shot-analysis/v1',
    });
    await flushCommandStreams();
    writeFileSync(4, wire);
    process.exit(0);
  } catch (error) {
    abortKovoBuildOutputTransaction({ ...clientPhase.transaction });
    throw error;
  }
}

async function flushCommandStreams(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) => new Promise<void>((resolve) => stream.write('', () => resolve())),
    ),
  );
}
