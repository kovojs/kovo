import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const typescriptUrl = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
      if (existsSync(typescriptUrl)) return nextResolve(typescriptUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const input = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8'));
const { startKovoDevServer } = await import('../packages/cli/src/commands/dev.ts');

let result;
try {
  const security =
    input.security === undefined
      ? undefined
      : {
          invocationCwd: input.security.invocationCwd,
          invocationEnv: Object.freeze(
            Object.assign(Object.create(null), input.security.invocationEnv),
          ),
          paranoidStaticAdvisory: input.security.paranoidStaticAdvisory,
        };
  const handle = await startKovoDevServer(input.options, security);
  try {
    const response = input.probeUrl === undefined ? undefined : await fetch(input.probeUrl);
    result = {
      ok: true,
      response:
        response === undefined
          ? undefined
          : { body: await response.text(), status: response.status },
      server: {
        host: handle.server.config.server.host,
        port: handle.server.config.server.port,
        strictPort: handle.server.config.server.strictPort,
      },
    };
  } finally {
    await handle.close();
  }
} catch (error) {
  result = { ok: false, error: error instanceof Error ? error.message : String(error) };
}

process.stdout.write(`kovo-dev-worker/v1\n${JSON.stringify(result)}\n`, () => process.exit(0));
