import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

// This entry is also emitted as plain JavaScript. Keep it free of TypeScript-only syntax so the
// source-tree CLI can launch it with Node's type stripping while packed CLIs launch the bundle.
if (import.meta.url.endsWith('.ts')) {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
        const tsUrl = new URL(specifier.replace(/\.js$/, '.ts'), context.parentURL);
        if (existsSync(tsUrl)) return nextResolve(tsUrl.href, context);
      }
      return nextResolve(specifier, context);
    },
  });
}

const request = process.argv[2];
if (process.argv.length !== 3 || typeof request !== 'string') {
  process.stderr.write('Kovo static-trust worker requires one request.\n');
  process.exit(2);
}

const { runPreEvaluationStaticTrustWorkerRequest } = await import('./build-export.js');
const output = runPreEvaluationStaticTrustWorkerRequest(request);
process.stdout.write(output);
