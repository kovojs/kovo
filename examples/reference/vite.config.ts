import { defineConfig } from 'vite-plus';
import { exampleKovoCompilerPlugin } from '../vite-kovo-compiler.js';

export default defineConfig({
  plugins: [exampleKovoCompilerPlugin({ include: ['src'] }), referenceAppShellDevPlugin()],
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs --public',
        input: [
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*.ts', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
    },
  },
});

interface ReferenceDevServer {
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface ReferenceDevPlugin {
  configureServer(server: ReferenceDevServer): Promise<unknown>;
  name: string;
}

function referenceAppShellDevPlugin(): ReferenceDevPlugin {
  return {
    async configureServer(server) {
      const module = await server.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
      const createDevIntegration = module.createKovoAppShellViteDevIntegration;
      if (typeof createDevIntegration !== 'function') {
        throw new Error(
          '@kovojs/server/internal/app-shell-vite must export createKovoAppShellViteDevIntegration.',
        );
      }
      const integration = createDevIntegration({
        moduleId: '/src/app-shell.ts',
        name: 'kovo-reference-app-shell-dev',
        order: 'post',
      }) as { plugin: { configureServer(server: ReferenceDevServer): unknown } };
      return integration.plugin.configureServer(server);
    },
    name: 'kovo-reference-app-shell-dev',
  };
}
