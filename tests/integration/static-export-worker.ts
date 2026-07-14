import { createApp, exportStaticApp, guards, route } from '@kovojs/server';

import { createStaticExportL0L1App } from './fixtures/static-export-l0-l1/app-definition.ts';
import type {
  StaticExportCase,
  StaticExportCaseResult,
  StaticExportRejection,
} from './static-export-runner.ts';

/** @internal Loaded only after static-export-runner establishes the child realm bootstrap. */
export async function runStaticExportCaseInLockedChild(
  testCase: StaticExportCase,
  outDir: string,
): Promise<StaticExportCaseResult> {
  if (testCase === 'l0-l1') {
    const counter = { renders: 0 };
    const result = await exportStaticApp(createStaticExportL0L1App(counter), { outDir });
    return {
      artifacts: result.artifacts.map((artifact) => artifact.path).sort(),
      clientModules: result.clientModules.map((artifact) => artifact.path).sort(),
      diagnostics: result.diagnostics,
      renders: counter.renders,
      status: 'ok',
    };
  }

  const app = createApp({
    routes: [
      route('/account', {
        guard: guards.authed<{ session?: { user?: { id: string } | null } | null }>(),
        page: () => '<main>Account</main>',
      }),
      route('/products/:id', {
        page: () => '<main>Product</main>',
      }),
    ],
  });

  try {
    await exportStaticApp(app, { outDir });
  } catch (error) {
    return staticExportRejection(error);
  }
  throw new Error('Dynamic static-export fixture unexpectedly exported successfully.');
}

function staticExportRejection(error: unknown): StaticExportRejection {
  if (!(error instanceof Error)) throw error;
  const value = error as Error & {
    code?: unknown;
    diagnostics?: unknown;
  };
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    diagnostics: Array.isArray(value.diagnostics)
      ? value.diagnostics.map((diagnostic: unknown) => staticExportDiagnostic(diagnostic))
      : [],
    status: 'rejected',
  };
}

function staticExportDiagnostic(diagnostic: unknown): StaticExportRejection['diagnostics'][number] {
  if (typeof diagnostic !== 'object' || diagnostic === null) return {};
  const value = diagnostic as Record<string, unknown>;
  return {
    code: typeof value.code === 'string' ? value.code : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
    routePath: typeof value.routePath === 'string' ? value.routePath : undefined,
  };
}
