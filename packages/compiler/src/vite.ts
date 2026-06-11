import { isAbsolute, relative } from 'node:path';

import { clientModuleUrl, clientModuleVersion } from './lower/handlers.js';

export interface JisoVitePlugin {
  configureServer?: (server: JisoViteDevServer) => void;
  name: 'jiso';
  transform: (
    source: string,
    id: string,
  ) => null | {
    code: string;
    map: null;
  };
}

export interface JisoViteDevServer {
  config?: {
    root?: string;
  };
  middlewares: {
    use(handler: JisoViteMiddleware): void;
  };
}

export type JisoViteMiddleware = (
  req: { url?: string },
  res: {
    end(body: string): void;
    setHeader(name: string, value: string): void;
    statusCode?: number;
  },
  next: () => void,
) => void;

interface ViteCompileOptions {
  fileName: string;
  source: string;
}

interface ViteCompileResult {
  files: readonly {
    kind: string;
    source: string;
  }[];
}

export function createJisoVitePlugin(
  compileComponentModule: (options: ViteCompileOptions) => ViteCompileResult,
): JisoVitePlugin {
  const clientModules = new Map<string, string>();
  let root = process.cwd();

  return {
    configureServer(server) {
      root = server.config?.root ?? root;
      server.middlewares.use((req, res, next) => {
        const key = devClientModuleKey(req.url);
        const source = key ? clientModules.get(key) : undefined;
        if (source === undefined) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/javascript');
        res.end(source);
      });
    },
    name: 'jiso',
    transform(source: string, id: string) {
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const fileName = viteComponentFileName(id, root);
      const result = compileComponentModule({ fileName, source });
      for (const file of result.files) {
        if (file.kind === 'client') {
          clientModules.set(
            clientModuleUrl(fileName, clientModuleVersion(file.source)),
            file.source,
          );
        }
      }

      return {
        code: result.files.find((file) => file.kind === 'server')?.source ?? source,
        map: null,
      };
    },
  };
}

function viteComponentFileName(id: string, root: string): string {
  const fileName = id.split(/[?#]/, 1)[0] ?? id;
  if (!isAbsolute(fileName)) return slashPath(fileName);

  const relativeFileName = relative(root, fileName);
  if (!relativeFileName.startsWith('..')) return slashPath(relativeFileName);

  return slashPath(fileName.replace(/^\/+/, ''));
}

function slashPath(fileName: string): string {
  return fileName.replaceAll('\\', '/');
}

function devClientModuleKey(url: string | undefined): string | null {
  if (!url) return null;

  const [path = '', query = ''] = url.split(/[?#]/, 2);
  const version = new URLSearchParams(query).get('v');
  if (!path.startsWith('/c/') || !version) return null;

  return `${path}?v=${version}`;
}
