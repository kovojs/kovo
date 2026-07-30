import { runPreEvaluationStaticTrustWorkerRequest } from './build-export.js';

// This entry is also emitted as plain JavaScript. Keep it free of TypeScript-only syntax so the
// source-tree CLI can launch it with Node's type stripping while packed CLIs launch the bundle.
const request = process.argv[2];
if (process.argv.length !== 3 || typeof request !== 'string') {
  process.stderr.write('Kovo static-trust worker requires one request.\n');
  process.exit(2);
}

const output = await runPreEvaluationStaticTrustWorkerRequest(request);
process.stdout.write(output);
