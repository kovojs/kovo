import { readFileSync, writeFileSync } from 'node:fs';

import { runBoundedTestProcess } from './index.test-process-supervisor.mjs';

const [invocationPath, resultPath] = process.argv.slice(2);
if (invocationPath === undefined || resultPath === undefined) {
  throw new Error('bounded test process CLI requires invocation and result paths');
}

try {
  const invocation = JSON.parse(readFileSync(invocationPath, 'utf8'));
  const outcome = await runBoundedTestProcess(invocation);
  writeFileSync(resultPath, JSON.stringify({ outcome }), { encoding: 'utf8', flag: 'wx' });
} catch (error) {
  writeFileSync(
    resultPath,
    JSON.stringify({ supervisorError: error instanceof Error ? error.message : String(error) }),
    { encoding: 'utf8', flag: 'wx' },
  );
  process.exitCode = 1;
}
