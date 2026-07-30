import { writeFileSync } from 'node:fs';

import { lockCompilerSecurityRealm } from '@kovojs/compiler/internal/security-bootstrap';

import {
  kovoBuildOneShotIdentity,
  parseBuildArgs,
  produceKovoBuildOneShotAnalysis,
  runBuildCommandFromOneShotAnalysis,
  runSourceCheckCommand,
} from './build-export.js';
import {
  readKovoBuildOneShotHandoff,
  writeKovoBuildOneShotHandoff,
  type KovoBuildOneShotIdentity,
} from './build-one-shot-handoff.js';
import { parseCheckArgs } from '../graph-args.js';
import { captureKovoCommandSecurityDisposition } from './security-disposition.js';
import { writeFormattedCommandResult, writeUsageError } from '../shared.js';

const mode = process.argv[2];
const security = captureKovoCommandSecurityDisposition();
lockCompilerSecurityRealm();

let exitCode: 0 | 1 | 2;
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
  const handoffDirectory = process.argv[3];
  const parsed = parseBuildArgs(process.argv.slice(4));
  if (typeof handoffDirectory !== 'string' || !parsed.ok) {
    exitCode = writeUsageError(
      parsed.ok ? 'kovo: isolated build analysis requires a handoff directory.\n' : parsed.message,
      'build',
    );
  } else {
    const outcome = await produceKovoBuildOneShotAnalysis(parsed.options, security);
    if ('exitCode' in outcome) {
      exitCode = writeFormattedCommandResult(outcome, parsed.format, 'build', 'build');
    } else {
      const identity = kovoBuildOneShotIdentity(parsed.options, outcome, security);
      const reference = writeKovoBuildOneShotHandoff(handoffDirectory, {
        analysis: outcome,
        identity,
        schema: 'kovo-build-one-shot-analysis/v1',
      });
      writeFileSync(
        3,
        JSON.stringify({
          identity,
          reference,
          schema: 'kovo-build-one-shot-producer/v1',
        }),
      );
      exitCode = 0;
    }
  }
} else if (mode === 'emit') {
  const file = process.argv[3];
  const digest = process.argv[4];
  const identityText = process.argv[5];
  const parsed = parseBuildArgs(process.argv.slice(6));
  if (
    typeof file !== 'string' ||
    typeof digest !== 'string' ||
    typeof identityText !== 'string' ||
    !parsed.ok
  ) {
    exitCode = writeUsageError(
      parsed.ok ? 'kovo: isolated build emission requires one handoff.\n' : parsed.message,
      'build',
    );
  } else {
    let identity: KovoBuildOneShotIdentity;
    try {
      identity = JSON.parse(identityText) as KovoBuildOneShotIdentity;
      const payload = readKovoBuildOneShotHandoff({ digest, file }, identity);
      exitCode = writeFormattedCommandResult(
        await runBuildCommandFromOneShotAnalysis(
          parsed.options,
          payload.analysis,
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
} else {
  process.stderr.write('Kovo one-shot worker requires check, analyze, or emit mode.\n');
  exitCode = 2;
}

await Promise.all(
  [process.stdout, process.stderr].map(
    (stream) => new Promise<void>((resolve) => stream.write('', () => resolve())),
  ),
);
process.exit(exitCode);
