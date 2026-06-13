import { createRequestHandler, type JisoApp } from './app.js';
import { replayStaticExportClientModuleArtifacts } from './static-export-client-modules.js';
import { replayStaticExportRouteDocumentArtifact } from './static-export-document.js';
import { staticExportRoutePlan } from './static-export-route-plan.js';
import {
  StaticExportError,
  staticExportDiagnostic,
  type StaticExportArtifact,
  type StaticExportClientModuleArtifact,
  type StaticExportDiagnostic,
  type StaticExportHtmlPathStyle,
} from './static-export-types.js';

export type StaticExportNonExportablePolicy = 'error' | 'skip';

export interface StaticExportAppReplayOptions {
  app: JisoApp;
  htmlPathStyle?: StaticExportHtmlPathStyle;
  onNonExportable?: StaticExportNonExportablePolicy;
  origin?: string;
}

export interface StaticExportReplayResult {
  artifacts: readonly StaticExportArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
  diagnostics: readonly StaticExportDiagnostic[];
}

export async function replayStaticExportApp({
  app,
  htmlPathStyle: htmlPathStyleOption,
  onNonExportable,
  origin: originOption,
}: StaticExportAppReplayOptions): Promise<StaticExportReplayResult> {
  const routePlan = staticExportRoutePlan(app);
  const diagnostics = [...routePlan.diagnostics];
  if (diagnostics.length > 0 && onNonExportable !== 'skip') {
    throw new StaticExportError(diagnostics);
  }

  const handler = createRequestHandler(app);
  const origin = originOption ?? 'https://jiso.local';
  const htmlPathStyle = staticExportHtmlPathStyle(htmlPathStyleOption);
  const artifacts: StaticExportArtifact[] = [];

  for (const routeTarget of routePlan.targets) {
    if (diagnostics.some((diagnostic) => diagnostic.routePath === routeTarget.routePath)) {
      continue;
    }

    try {
      artifacts.push(
        await replayStaticExportRouteDocumentArtifact({
          handler,
          htmlPathStyle,
          origin,
          routePath: routeTarget.path,
        }),
      );
    } catch (error) {
      if (!(error instanceof StaticExportError) || onNonExportable !== 'skip') {
        throw error;
      }

      diagnostics.push(...error.diagnostics);
    }
  }

  return {
    artifacts,
    clientModules: await replayStaticExportClientModuleArtifacts({
      handler,
      origin,
      routeArtifacts: artifacts,
    }),
    diagnostics,
  };
}

function staticExportHtmlPathStyle(
  style: StaticExportHtmlPathStyle | undefined,
): StaticExportHtmlPathStyle {
  if (style === undefined) return 'directory';
  if (style === 'flat' || style === 'directory') return style;

  throw new StaticExportError([
    staticExportDiagnostic(
      'htmlPathStyle',
      `FW229 static export refused htmlPathStyle '${String(
        style,
      )}'. Expected 'flat' or 'directory'.`,
    ),
  ]);
}
