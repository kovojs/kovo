import { isAbsolute, relative } from 'node:path';

import { diagnosticDefinitions } from '@kovojs/core';

import type { CompilerDiagnostic } from './diagnostics.js';
import { clientModuleUrl, clientModuleVersion } from './lower/handlers.js';
import type { PackageComponentPrefixFact } from './types.js';

export interface KovoVitePlugin {
  configureServer?: (server: KovoViteDevServer) => void;
  name: 'kovo';
  transform: (
    source: string,
    id: string,
  ) => null | {
    code: string;
    map: null;
  };
}

export type KovoViteDiagnosticReporter = (diagnostic: CompilerDiagnostic) => void;

export interface KovoViteModuleDiagnosticReport {
  diagnostics: readonly CompilerDiagnostic[];
  fileName: string;
  source: string;
}

export type KovoViteModuleDiagnosticReporter = (report: KovoViteModuleDiagnosticReport) => void;

export interface KovoVitePluginOptions {
  onDiagnostic?: KovoViteDiagnosticReporter;
  onModuleDiagnostics?: KovoViteModuleDiagnosticReporter;
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
}

export interface KovoViteDevServer {
  config?: {
    root?: string;
  };
  middlewares: {
    use(handler: KovoViteMiddleware): void;
  };
}

export type KovoViteMiddleware = (
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
  packageComponentPrefixes?: readonly PackageComponentPrefixFact[];
  packagePrefixDiscoveryRoot?: string;
  source: string;
}

interface ViteCompileResult {
  diagnostics?: readonly CompilerDiagnostic[];
  files: readonly {
    kind: string;
    source: string;
  }[];
}

export function createKovoVitePlugin(
  compileComponentModule: (options: ViteCompileOptions) => ViteCompileResult,
  options: KovoVitePluginOptions = {},
): KovoVitePlugin {
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
    name: 'kovo',
    transform(source: string, id: string) {
      if (!/\.[cm]?tsx?$/.test(id) || !source.includes('component(')) return null;

      const fileName = viteComponentFileName(id, root);
      const result = compileComponentModule({
        fileName,
        ...(options.packageComponentPrefixes === undefined
          ? {}
          : { packageComponentPrefixes: options.packageComponentPrefixes }),
        packagePrefixDiscoveryRoot: root,
        source,
      });
      const diagnostics = result.diagnostics ?? [];
      options.onModuleDiagnostics?.({ diagnostics, fileName, source });
      const errorDiagnostics = diagnostics.filter(
        (diagnostic) => diagnosticSeverity(diagnostic) === 'error',
      );

      for (const diagnostic of diagnostics) {
        if (diagnosticSeverity(diagnostic) !== 'error') options.onDiagnostic?.(diagnostic);
      }

      if (errorDiagnostics.length > 0) {
        throw new Error(viteDiagnosticErrorMessage(errorDiagnostics));
      }

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

function diagnosticSeverity(diagnostic: CompilerDiagnostic): CompilerDiagnostic['severity'] {
  return diagnosticDefinitions[diagnostic.code].severity;
}

function viteDiagnosticErrorMessage(diagnostics: readonly CompilerDiagnostic[]): string {
  const plural = diagnostics.length === 1 ? '' : 's';

  // SPEC §5.2 hard rule 5: diagnostics are teaching errors, so Vite surfaces the
  // source site plus the compiler's lowering/fix help instead of a terse code.
  return [
    `Kovo Vite transform failed with ${diagnostics.length} error diagnostic${plural}.`,
    diagnostics.map(formatCompilerDiagnostic).join('\n\n'),
  ].join('\n\n');
}

function formatCompilerDiagnostic(diagnostic: CompilerDiagnostic): string {
  const help = diagnostic.help?.trim();
  if (!help) return `${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message}`;

  return [
    `${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message}`,
    ...help.split('\n').map((line) => `  help: ${line}`),
  ].join('\n');
}

function diagnosticSite(diagnostic: CompilerDiagnostic): string {
  const line = diagnostic.start?.line;
  const column = diagnostic.start?.column;
  if (line === undefined || column === undefined) return diagnostic.fileName;

  return `${diagnostic.fileName}:${line}:${column}`;
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
