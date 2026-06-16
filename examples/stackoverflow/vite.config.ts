import type { IncomingMessage, ServerResponse } from 'node:http';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

export const soViteConfig = defineConfig({
  build: {
    manifest: true,
    rollupOptions: {
      // The in-browser backend's public exports (installBackend/vote) are only
      // referenced by string from `on:*` attributes, so nothing in the module
      // graph imports them; keep entry signatures so they are not treeshaken.
      preserveEntrySignatures: 'strict',
      input: {
        tailwind: 'src/styles.css',
        // The in-browser backend (PGlite + the interactive Kovo app) bundled as a
        // browser entry; the static export references its hashed URL so the export
        // can serve its own mutation POSTs. See browser-backend.ts.
        'browser-backend': 'src/browser-backend.ts',
      },
      output: {
        // PGlite's Emscripten/Node glue reads a few `process.*` fields at module
        // eval time. Define a minimal browser `process` before any chunk runs so
        // the in-browser backend bundle loads in a sandboxed iframe.
        banner:
          'globalThis.process=globalThis.process||{env:{NODE_ENV:"production"},argv:[],platform:"browser",type:"renderer",version:"",versions:{},cwd:function(){return"/"},nextTick:function(f){queueMicrotask(f)},binding:function(){return{}}};',
        assetFileNames: 'assets/[name][extname]',
        // Stable entry name so the static export can reference the in-browser
        // backend at a fixed URL (`/assets/browser-backend.js`) without manifest
        // plumbing. (PGlite's own wasm/data chunks keep their default names.)
        entryFileNames: 'assets/[name].js',
      },
    },
  },
  plugins: [tailwindcss(), soSharedAppShellDevPlugin()],
  // PGlite (WASM) makes the build/dev/export paths slow; give the tests room.
  test: {
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  run: {
    tasks: {
      export: {
        command: 'node scripts/export-static.mjs',
        input: [
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      serve: {
        command: 'node scripts/serve.mjs',
        input: [
          { pattern: 'package.json', base: 'workspace' },
          { pattern: 'scripts/serve.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
      },
    },
  },
});

export default soViteConfig;

type DevMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

type DevPostHook = () => void | Promise<void>;

interface SoDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface SoDevPlugin {
  configureServer(server: SoDevServer): Promise<void | DevPostHook>;
  name: string;
}

export function soSharedAppShellDevPlugin(): SoDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@kovojs/server/app-shell/vite');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server/app-shell/vite must export kovoAppShellViteDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        name: 'kovo-so-app-shell-dev',
        nodeHandlerExportName: 'soNodeHandler',
        order: 'post',
      }) as { configureServer(server: SoDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-so-app-shell-dev-loader',
  };
}
