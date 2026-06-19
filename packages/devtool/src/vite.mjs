// Vite dev plugin to mount the devtool under a path prefix on a host app's dev
// server. Kept dependency-light (no @kovojs/server import) so a host vite.config
// can import it cheaply: `import { devtoolMountPlugin } from '@kovojs/devtool/vite'`.
//
// `handlerModuleId` is an SSR-loadable module exporting `nodeHandler` (a file that
// calls createDevtoolApp). Set KOVO_DEVTOOL_BASE to the same prefix so the app's
// emitted URLs match.
export function devtoolMountPlugin(base, { handlerModuleId, name = 'kovo-devtool-mount' } = {}) {
  if (!base) throw new Error('devtoolMountPlugin: base prefix is required.');
  if (!handlerModuleId) throw new Error('devtoolMountPlugin: handlerModuleId is required.');
  return {
    name,
    async configureServer(server) {
      const mod = await server.ssrLoadModule(handlerModuleId);
      const nodeHandler = mod.nodeHandler;
      if (typeof nodeHandler !== 'function')
        throw new Error(`${handlerModuleId} must export nodeHandler.`);
      // Register in the configureServer body (pre) so we intercept before Vite's
      // HTML fallback would serve index.html for the prefix.
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '/';
        if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) {
          const rest = url.slice(base.length);
          req.url = rest.startsWith('/') ? rest : `/${rest || ''}`;
          Promise.resolve(nodeHandler(req, res)).catch(() => next());
          return;
        }
        next();
      });
    },
  };
}
