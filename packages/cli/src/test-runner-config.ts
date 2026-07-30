import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadConfigFromFile, type UserConfig } from 'vite-plus';

function runtimeBootstrapPath(): string {
  const candidates = [
    fileURLToPath(new URL('./test-runtime-bootstrap.ts', import.meta.url)),
    fileURLToPath(new URL('./test-runtime-bootstrap.mjs', import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const stats = lstatSync(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new TypeError('Kovo test runtime bootstrap is not a regular package file.');
    }
    return realpathSync(candidate);
  }
  throw new TypeError('Kovo test runtime bootstrap is missing from the installed CLI.');
}

export default defineConfig(async (environment) => {
  // An explicit Kovo-owned config is required to install the test bootstrap, but `--config` would
  // otherwise suppress the app's ordinary Vite config and its Kovo compiler plugin. Resolve the
  // default config from the invocation root, then prepend only Kovo's setup entry.
  const loaded = await loadConfigFromFile(environment, undefined, process.cwd());
  return withKovoTestRuntime(loaded?.config ?? {});
});

export function withKovoTestRuntime(appConfig: UserConfig): UserConfig {
  const configuredSetup = appConfig.test?.setupFiles;
  const setupFiles =
    configuredSetup === undefined
      ? []
      : Array.isArray(configuredSetup)
        ? configuredSetup
        : [configuredSetup];
  const configuredServer = appConfig.test?.server;
  const configuredDeps = configuredServer?.deps;
  const configuredInline = configuredDeps?.inline;
  const inline: true | (string | RegExp)[] =
    configuredInline === true ? true : [/@kovojs(?:[/\\+])/u, ...(configuredInline ?? [])];
  return {
    ...appConfig,
    test: {
      ...appConfig.test,
      // The setup mock owns the mutable Vitest-realm exception. Keep every Kovo package inside
      // Vitest's module runner so an import-time runtime-lock assertion cannot escape that one
      // reviewed mock through native dependency externalization (SPEC §6.6 rule 6, §12).
      server: {
        ...configuredServer,
        deps: {
          ...configuredDeps,
          inline,
        },
      },
      setupFiles: [runtimeBootstrapPath(), ...setupFiles],
    },
  };
}
