import { writeFileSync } from 'node:fs';

import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import {
  kovoBuildOneShotIdentity,
  parseBuildArgs,
  produceKovoBuildOneShotAnalysis,
} from './build-export.js';
import { encodeKovoBuildOneShotHandoff } from './build-one-shot-handoff.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();
const parsed = parseBuildArgs(process.argv.slice(2));
let exitCode: 0 | 1 | 2;
if (!parsed.ok) {
  exitCode = writeUsageError(parsed.message, 'build');
} else {
  const outcome = await produceKovoBuildOneShotAnalysis(parsed.options, security);
  if ('exitCode' in outcome) {
    exitCode = writeFormattedCommandResult(outcome, parsed.format, 'build', 'build');
  } else {
    const identity = kovoBuildOneShotIdentity(parsed.options, outcome, security);
    const wire = encodeKovoBuildOneShotHandoff({
      analysis: { analysis: outcome },
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
