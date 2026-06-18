import { defineConfig } from 'vite-plus';
import { devtoolMountPlugin } from '@kovojs/devtool/vite';

const MOUNT_BASE = process.env.KOVO_DEVTOOL_BASE;

export default defineConfig({
  plugins: [
    MOUNT_BASE
      ? devtoolMountPlugin(MOUNT_BASE, { handlerModuleId: '/src/app-shell.ts' })
      : starterSharedAppShellDevPlugin(),
  ],
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
});

interface StarterDevServer {
  middlewares: {
    use(handler: (req: unknown, res: unknown, next: (e?: unknown) => void) => void): void;
  };
  ssrLoadModule(id: string): Promise<Record<string, unknown>>;
}
interface StarterDevPlugin {
  configureServer(server: StarterDevServer): Promise<void | (() => void | Promise<void>)>;
  name: string;
}

// Standalone serving at '/'. (For mounting under a prefix, see devtoolMountPlugin.)
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
        name: 'kovo-devtool-app-shell-dev',
      }) as { configureServer(server: StarterDevServer): void | (() => void | Promise<void>) };
      return sharedPlugin.configureServer(server);
    },
    name: 'kovo-devtool-app-shell-dev-loader',
  };
}
