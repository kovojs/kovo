import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vite-plus';

// The docs site is a real Kovo app authored in src/app.tsx. Vite builds the document CSS (with a
// manifest) into dist-css/; the app-shell export bridge replays the declared route documents into
// dist/. The dev plugin serves the same app live through its node handler so `serve` matches export
// byte-for-byte (SPEC §9.5).
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
  plugins: [siteSharedAppShellDevPlugin()],
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
      // The ⌘K search index is part of the agent/static-host surface emitted at
      // export time (src/aux.ts). Serve it live in dev too — from the same
      // content pass the pages render from — so search works in `serve` exactly
      // as it does in the static export (SPEC §9.5 dev/export parity), instead
      // of 404ing until a build runs.
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0];
        if (request.method !== 'GET' || pathname !== '/search-index.json') {
          next();
          return;
        }
        try {
          const contentModule = await server.ssrLoadModule('/src/content.ts');
          const loadSiteContent = contentModule.loadSiteContent as () => Promise<{
            search: unknown;
          }>;
          const content = await loadSiteContent();
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(content.search));
        } catch (error) {
          next(error);
        }
      });

      const serverModule = await server.ssrLoadModule('@kovojs/server');
      const createDevIntegration = serverModule.createKovoAppShellViteDevIntegration;
      if (typeof createDevIntegration !== 'function') {
        throw new Error('@kovojs/server must export createKovoAppShellViteDevIntegration.');
      }

      const integration = createDevIntegration({
        moduleId: '/src/app.tsx',
        name: 'kovo-site-app-shell-dev',
        nodeHandlerExportName: 'siteNodeHandler',
        order: 'post',
      }) as { plugin: { configureServer(server: SiteDevServer): void | DevPostHook } };

      return integration.plugin.configureServer(server);
    },
    name: 'kovo-site-app-shell-dev-loader',
  };
}
