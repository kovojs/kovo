import type { KovoApp } from './app-types.js';
import { assertServerRequestSafeRuntimeRealmLocked } from './security-bootstrap.js';
import { exportStaticApp as exportStaticAppInternal } from './static-export.js';
import type { StaticExportOptions, StaticExportResult } from './static-export-types.js';

/**
 * Pre-render an app only after a supported runner established the request-safe realm lock.
 * Standalone build scripts use `@kovojs/server/runtime-bootstrap` as their literal first import
 * (SPEC §6.6/§9.5).
 */
export function exportStaticApp(
  app: KovoApp,
  options: StaticExportOptions = {},
): Promise<StaticExportResult> {
  assertServerRequestSafeRuntimeRealmLocked('exportStaticApp()');
  return exportStaticAppInternal(app, options);
}
