import '../dist/server/src/runtime-bootstrap.mjs';

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { kovoExportStaticBehaviorFact } from '../packages/conformance-fixtures/src/kovo-export-fixtures.ts';
import { createApp, exportStaticApp, route as serverRoute } from '../dist/server/src/index.mjs';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const options = JSON.parse(process.argv[2] ?? 'null');

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
    return { exitCode: 0, stderr, stdout };
  } catch (error) {
    if (typeof error !== 'object' || error === null || typeof error.code !== 'number') {
      throw error;
    }
    return {
      exitCode: error.code,
      stderr: String(error.stderr ?? ''),
      stdout: String(error.stdout ?? ''),
    };
  }
};

// SPEC.md §6.6: direct guarded APIs execute only in this bootstrap-first custom runner. The
// official CLI exercises its own supported security bootstrap in a separate process.
const result = await kovoExportStaticBehaviorFact({
  ...options,
  appCoreModuleUrl: '@kovojs/server',
  cliFixtureParent: join(projectRoot, 'packages/cli'),
  createApp,
  exportStaticApp,
  fixturePrefix: 'kovo-d10-kovo-export-',
  runCliCommand,
  serverModuleUrl: '@kovojs/server',
  serverRoute,
});

process.stdout.write(`${JSON.stringify(result)}\n`);
