import '../dist/server/src/runtime-bootstrap.mjs';

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { kovoExportStaticBehaviorFact } from '../packages/conformance-fixtures/src/kovo-export-fixtures.ts';
import { createRegisteredDiagnostic } from '../dist/core/src/internal/diagnostics.mjs';
import { createApp, exportStaticApp, route as serverRoute } from '../dist/server/src/index.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const options = JSON.parse(process.argv[2] ?? 'null');

const nodeV8AsmWarning =
  /^\(node:\d+\) V8: file:\/\/\/.*\/dist\/lexer\.asm-[A-Za-z0-9_-]+\.mjs:\d+ Invalid asm\.js: Unexpected token\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n$/u;

const frameworkCliStderr = (stderr) => (nodeV8AsmWarning.test(stderr) ? '' : stderr);

if (options === null || typeof options !== 'object' || Array.isArray(options)) {
  throw new TypeError('kovo-check export-static worker requires a serialized options object');
}

const runCliCommand = async (args) => {
  try {
    const { stderr, stdout } = await execFileAsync(
      process.execPath,
      [join(projectRoot, 'dist/cli/src/index.mjs'), ...args],
      { cwd: projectRoot, maxBuffer: 20 * 1024 * 1024 },
    );
    return { exitCode: 0, stderr: frameworkCliStderr(stderr), stdout };
  } catch (error) {
    if (typeof error !== 'object' || error === null || typeof error.code !== 'number') {
      throw error;
    }
    return {
      exitCode: error.code,
      stderr: frameworkCliStderr(String(error.stderr ?? '')),
      stdout: String(error.stdout ?? ''),
    };
  }
};

const registeredDiagnostic = (diagnostic) =>
  createRegisteredDiagnostic(
    diagnostic.code,
    {
      fileName: diagnostic.fileName,
      ...(diagnostic.start === undefined ? {} : { start: diagnostic.start }),
    },
    {
      ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
      message: diagnostic.message,
    },
  );

// SPEC.md §6.6: direct guarded APIs execute only in this bootstrap-first custom runner. The
// official CLI exercises its own supported security bootstrap in a separate process.
const result = await kovoExportStaticBehaviorFact({
  ...options,
  appCoreModuleUrl: '@kovojs/server',
  cliFixtureParent: join(projectRoot, 'packages/cli'),
  createApp,
  errorDiagnostic: registeredDiagnostic(options.errorDiagnostic),
  expectCliDiagnosticLookalikeIgnored: true,
  exportStaticApp,
  fixturePrefix: 'kovo-d10-kovo-export-',
  runCliCommand,
  serverModuleUrl: '@kovojs/server',
  serverRoute,
  lintDiagnostic: registeredDiagnostic(options.lintDiagnostic),
});

process.stdout.write(`${JSON.stringify(result)}\n`);
