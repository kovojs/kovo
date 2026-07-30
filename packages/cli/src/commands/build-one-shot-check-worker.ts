import { writeFileSync } from 'node:fs';

import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import {
  kovoSourceCheckOneShotIdentity,
  produceKovoSourceCheckOneShotAnalysis,
} from './build-export.js';
import { encodeKovoBuildOneShotHandoff } from './build-one-shot-handoff.js';
import { parseCheckArgs } from '../graph-args.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();
const parsed = parseCheckArgs(process.argv.slice(2));
let exitCode: 0 | 1 | 2 = 1;
if (!parsed.ok || !('source' in parsed)) {
  exitCode = writeUsageError(
    parsed.ok ? 'kovo: isolated check worker requires a source invocation.\n' : parsed.message,
    'check',
  );
} else {
  const options = { appModulePath: parsed.appModulePath, cache: parsed.cache };
  const outcome = await produceKovoSourceCheckOneShotAnalysis(options, security);
  if ('exitCode' in outcome) {
    exitCode = writeFormattedCommandResult(outcome, parsed.format, 'proof', 'check');
  } else {
    const identity = kovoSourceCheckOneShotIdentity(options, outcome, security);
    const wire = encodeKovoBuildOneShotHandoff({
      analysis: outcome,
      identity,
      schema: 'kovo-build-one-shot-analysis/v1',
    });
    await flushCommandStreams();
    writeFileSync(4, wire);
    process.exit(0);
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
