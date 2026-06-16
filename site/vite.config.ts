import type { IncomingMessage, ServerResponse } from 'node:http';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

// The docs site is a real Kovo app (src/app.ts). Vite builds the Tailwind CSS
// (with a manifest) into dist-css/; the app-shell export bridge replays the
// declared route documents into dist/. The dev plugin serves the same app live
// through its node handler so `serve` matches export byte-for-byte (SPEC §9.5).
export default defineConfig({
  build: {
    manifest: true,
    outDir: 'dist-css',
    rollupOptions: {
      input: {
        site: 'src/styles.css',
      },
      output: {
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [tailwindcss(), siteSharedAppShellDevPlugin()],
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs',
        input: [
          { pattern: 'content/**/*', base: 'workspace' },
          { pattern: 'gen/**/*', base: 'workspace' },
          { pattern: 'public/**/*', base: 'workspace' },
          { pattern: 'scripts/**/*', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'tutorial/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      serve: {
        command: 'node scripts/serve.mjs',
        input: [
          { pattern: 'content/**/*', base: 'workspace' },
          { pattern: 'scripts/**/*', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'tutorial/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
      },
      'check-links': {
        command: 'node scripts/check-links.mjs',
        input: [{ pattern: 'dist/**', base: 'workspace' }],
      },
      smoke: {
        command: 'node scripts/smoke.mjs',
        input: [
          { pattern: 'dist/**', base: 'workspace' },
          { pattern: 'scripts/smoke.mjs', base: 'workspace' },
        ],
      },
      'tutorial-steps': {
        command: 'node tutorial/run-steps.mjs',
        input: [
          { pattern: 'content/tutorial/**/*', base: 'workspace' },
          { pattern: 'tutorial/**/*', base: 'workspace' },
        ],
      },
    },
  },
});

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

type DevPostHook = () => void | Promise<void>;

interface SiteDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface SiteDevPlugin {
  configureServer(server: SiteDevServer): Promise<void | DevPostHook>;
  name: string;
}

export function siteSharedAppShellDevPlugin(): SiteDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@kovojs/server/app-shell/vite');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server/app-shell/vite must export kovoAppShellViteDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        moduleId: '/src/app.ts',
        name: 'kovo-site-app-shell-dev',
        nodeHandlerExportName: 'siteNodeHandler',
        order: 'post',
      }) as { configureServer(server: SiteDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-site-app-shell-dev-loader',
  };
}
