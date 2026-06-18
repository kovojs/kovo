import type { IncomingMessage, ServerResponse } from 'node:http';

import { defineConfig } from 'vite-plus';

const MOUNT_BASE = process.env.KOVO_DEVTOOL_BASE;

export default defineConfig({
  plugins: [MOUNT_BASE ? devtoolMountPlugin(MOUNT_BASE) : starterSharedAppShellDevPlugin()],
  build: {
    manifest: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: true,
    singleQuote: true,
    sortPackageJson: true,
  },
  run: {
    tasks: {
      build: {
        command: 'vp build',
        input: [
          { pattern: 'index.html', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      export: {
        command: 'node scripts/export-static.mjs',
        input: [
          { pattern: 'index.html', base: 'workspace' },
          { pattern: 'scripts/export-static.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
          { pattern: 'vite.config.ts', base: 'workspace' },
        ],
        output: ['dist/**'],
      },
      'preview-static': {
        command: 'node scripts/preview-static.mjs',
        input: [
          { pattern: 'dist/**', base: 'workspace' },
          { pattern: 'scripts/preview-static.mjs', base: 'workspace' },
        ],
      },
      'kovo-check': {
        command: 'node scripts/emit-graph.mjs && kovo check graph.json',
        input: [
          { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
        ],
        output: ['graph.json'],
      },
      'graph-assertions': {
        command: 'node scripts/emit-graph.mjs && node scripts/graph-assertions.mjs',
        input: [
          { pattern: 'graph.json', base: 'workspace' },
          { pattern: 'scripts/emit-graph.mjs', base: 'workspace' },
          { pattern: 'scripts/graph-assertions.mjs', base: 'workspace' },
          { pattern: 'src/**/*', base: 'workspace' },
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

interface StarterDevServer {
  middlewares: {
    use(handler: DevMiddleware): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}

interface StarterDevPlugin {
  configureServer(server: StarterDevServer): Promise<void | DevPostHook>;
  name: string;
}

function starterSharedAppShellDevPlugin(): StarterDevPlugin {
  return {
    async configureServer(server) {
      const serverModule = await server.ssrLoadModule('@kovojs/server');
      const sharedPluginFactory = serverModule.kovoAppShellViteDevPlugin;
      if (typeof sharedPluginFactory !== 'function') {
        throw new Error('@kovojs/server must export kovoAppShellViteDevPlugin.');
      }

      const sharedPlugin = sharedPluginFactory({
        earlyHints: false,
        name: 'kovo-starter-app-shell-dev',
      }) as { configureServer(server: StarterDevServer): void | DevPostHook };

      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-starter-app-shell-dev-loader',
  };
}

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

// Mounts the devtool under a path prefix (e.g. /__kovo). Copy this plugin into a
// host app's vite.config and set KOVO_DEVTOOL_BASE to embed the devtool in that
// app's dev server: requests under the prefix are stripped and dispatched to the
// devtool's own request handler; everything else falls through to the host.
function devtoolMountPlugin(base: string): StarterDevPlugin {
  return {
    name: 'kovo-devtool-mount',
    async configureServer(server) {
      const mod = await server.ssrLoadModule('/src/app-shell.ts');
      const nodeHandler = mod.nodeHandler as NodeHandler;
      if (typeof nodeHandler !== 'function') throw new Error('app-shell must export nodeHandler.');
      // Register in the configureServer body (pre) so we intercept before Vite's
      // HTML fallback would serve index.html for the prefix.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/';
        if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) {
          const rest = url.slice(base.length);
          req.url = rest.startsWith('/') ? rest : `/${rest}` || '/';
          Promise.resolve(nodeHandler(req, res)).catch(() => next());
          return;
        }
        next();
      });
    },
  };
}
