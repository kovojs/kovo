import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { emitQueryPlanBootstrapModule } from '@kovojs/compiler';

import { runVerifiedBuild } from './workload.mjs';

const evidence = runVerifiedBuild();
const bootstrap = emitQueryPlanBootstrapModule([
  {
    exportName: 'CounterIsland$queryUpdatePlans',
    importPath: `../${evidence.clientFile}`,
  },
]);
if (bootstrap.fileName !== 'generated/app.client.js') {
  throw new Error('compiler returned a non-canonical Kovo app bootstrap path');
}
if (
  !bootstrap.source.includes('CounterIsland$queryUpdatePlans') ||
  !bootstrap.source.includes(evidence.clientFile)
) {
  throw new Error('compiler-generated Kovo app bootstrap is not bound to the reference app');
}

const output = path.join('dist/.kovo/client', bootstrap.fileName);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, bootstrap.source);
if (readFileSync(output, 'utf8') !== bootstrap.source) {
  throw new Error('compiler-generated Kovo app bootstrap was not written byte-for-byte');
}
