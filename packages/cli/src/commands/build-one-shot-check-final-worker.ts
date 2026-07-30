import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import { finishKovoSourceCheckOneShot } from './build-export.js';
import {
  parseKovoBuildOneShotIdentity,
  readKovoBuildOneShotHandoff,
  readKovoBuildOneShotWireFromFd,
} from './build-one-shot-handoff.js';
import { parseCheckArgs } from '../graph-args.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const identityText = process.argv[2];
const parsed = parseCheckArgs(process.argv.slice(3));
const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();
let exitCode: 0 | 1 | 2 = 1;
if (identityText === undefined || !parsed.ok || !('source' in parsed)) {
  exitCode = writeUsageError(
    parsed.ok ? 'kovo: isolated check final worker requires one source handoff.\n' : parsed.message,
    'check',
  );
} else {
  try {
    const identity = parseKovoBuildOneShotIdentity(identityText);
    const payload = readKovoBuildOneShotHandoff(readKovoBuildOneShotWireFromFd(3), identity);
    exitCode = writeFormattedCommandResult(
      await finishKovoSourceCheckOneShot(
        { appModulePath: parsed.appModulePath, cache: parsed.cache },
        payload.analysis,
        identity,
        security,
      ),
      parsed.format,
      'proof',
      'check',
    );
  } catch (error) {
    exitCode = writeFormattedCommandResult(
      {
        error: `${error instanceof Error ? error.message : String(error)}\n`,
        exitCode: 1,
      },
      parsed.format,
      'proof',
      'check',
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
