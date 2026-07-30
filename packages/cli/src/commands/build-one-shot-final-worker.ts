import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import {
  finishKovoBuildOneShot,
  parseBuildArgs,
  requireKovoBuildOneShotPhasePayload,
} from './build-export.js';
import {
  parseKovoBuildOneShotIdentity,
  readKovoBuildOneShotHandoff,
  readKovoBuildOneShotWireFromFd,
} from './build-one-shot-handoff.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const identityText = process.argv[2];
const parsed = parseBuildArgs(process.argv.slice(3));
const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();
let exitCode: 0 | 1 | 2 = 1;
if (identityText === undefined || !parsed.ok) {
  exitCode = writeUsageError(
    parsed.ok ? 'kovo: isolated build final phase requires one private handoff.\n' : parsed.message,
    'build',
  );
} else {
  try {
    const identity = parseKovoBuildOneShotIdentity(identityText);
    const payload = readKovoBuildOneShotHandoff(readKovoBuildOneShotWireFromFd(3), identity);
    const phase = requireKovoBuildOneShotPhasePayload(payload.analysis, 'server');
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

async function flushCommandStreams(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map(
      (stream) => new Promise<void>((resolve) => stream.write('', () => resolve())),
    ),
  );
}
