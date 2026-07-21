import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite-plus';

import {
  exampleKovoCompilerPlugin,
  tutorialAppRegistryFacts,
  tutorialMutationRegistryFacts,
} from '../examples/vite-kovo-compiler.js';

const siteRoot = fileURLToPath(new URL('.', import.meta.url));

// A compiler-emitted `*.client.js` module has no file on disk. Keep it out of the authored-source
// transform pass while still sending any physical file with that reserved suffix through the
// SPEC §5.2 authoring gate.
function isCompilerEmittedTutorialClientModule(fileName: string): boolean {
  const cleanFileName = fileName.replace(/[?#].*$/u, '');
  if (!cleanFileName.endsWith('.client.js')) return false;
  const diskPath = isAbsolute(cleanFileName) ? cleanFileName : resolve(siteRoot, cleanFileName);
  return !existsSync(diskPath);
}

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
  plugins: [
    exampleKovoCompilerPlugin({
      exclude: [isCompilerEmittedTutorialClientModule],
      include: ['tutorial/steps/02-islands', 'tutorial/steps/03-queries'],
    }),
    exampleKovoCompilerPlugin({
      exclude: [isCompilerEmittedTutorialClientModule],
      include: ['tutorial/steps/04-mutations'],
      registryFacts: tutorialMutationRegistryFacts,
    }),
    exampleKovoCompilerPlugin({
      exclude: [isCompilerEmittedTutorialClientModule],
      include: [
        'tutorial/steps/05-optimistic',
        'tutorial/steps/06-streaming',
        'tutorial/steps/07-verification',
      ],
      registryFacts: tutorialAppRegistryFacts,
    }),
    siteSharedAppShellDevPlugin(),
  ],
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
  // Workspace packages expose TypeScript source during framework development. Keep the shared
  // request shell inside Vite's transform graph; Node's strip-only loader cannot execute namespace
  // syntax and, more importantly, would bypass this locked runner's configured module pipeline.
  ssr: { noExternal: ['@kovojs/browser', '@kovojs/core', '@kovojs/server'] },
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

      const serverModule = await server.ssrLoadModule('@kovojs/server/internal/app-shell-vite');
      const createDevIntegration = serverModule.createKovoAppShellViteDevIntegration;
      if (typeof createDevIntegration !== 'function') {
        throw new Error(
          '@kovojs/server/internal/app-shell-vite must export createKovoAppShellViteDevIntegration.',
        );
      }

      const integration = createDevIntegration({
        moduleId: '/src/app.tsx',
        name: 'kovo-site-app-shell-dev',
        order: 'post',
      }) as { plugin: { configureServer(server: SiteDevServer): void | DevPostHook } };

      return integration.plugin.configureServer(server);
    },
    name: 'kovo-site-app-shell-dev-loader',
  };
}
