import { exportStaticApp } from './static-export.js';
import { staticExportInventory, staticExportManifest } from './static-export-result.js';
import type {
  StaticExportInventoryItem,
  StaticExportManifest,
  StaticExportResult,
} from './static-export-types.js';
import {
  kovoAppShellViteStaticExportWithManifest,
  type KovoAppShellViteStaticExportWithManifestResult,
} from './vite-static-export-result.js';
import type { KovoAppShellBuild } from './vite-build.js';
import {
  kovoAppShellViteBuildDryRunStaticExportOptions,
  kovoAppShellViteBuildWriteStaticExportOptions,
  type KovoAppShellViteBuildStaticExportInventoryOptions,
  type KovoAppShellViteBuildStaticExportOptions,
} from './vite-static-export-options.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Writes a static export
 * from an already-built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function exportKovoAppShellViteBuild(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportOptions,
): Promise<StaticExportResult> {
  return exportStaticApp(build.app, kovoAppShellViteBuildWriteStaticExportOptions(build, options));
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Writes a static export
 * from a built app shell and returns the matched manifest + result.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function exportKovoAppShellViteBuildWithManifest(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportOptions,
): Promise<KovoAppShellViteStaticExportWithManifestResult> {
  return await kovoAppShellViteStaticExportWithManifest({
    dryRun() {
      return staticExportDryRunResultForKovoAppShellViteBuild(
        build,
        kovoAppShellViteBuildStaticExportManifestOptions(options),
      );
    },
    write() {
      return exportKovoAppShellViteBuild(build, options);
    },
  });
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run inventory of
 * files a static export from a built app shell would write.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function staticExportInventoryForKovoAppShellViteBuild(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  const result = await staticExportDryRunResultForKovoAppShellViteBuild(build, options);

  return staticExportInventory(result);
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Dry-run static export
 * manifest for a built app shell.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function staticExportManifestForKovoAppShellViteBuild(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportManifest> {
  const result = await staticExportDryRunResultForKovoAppShellViteBuild(build, options);

  return staticExportManifest(result);
}

async function staticExportDryRunResultForKovoAppShellViteBuild(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportResult> {
  return await exportStaticApp(
    build.app,
    kovoAppShellViteBuildDryRunStaticExportOptions(build, options),
  );
}

function kovoAppShellViteBuildStaticExportManifestOptions(
  options: KovoAppShellViteBuildStaticExportOptions,
): KovoAppShellViteBuildStaticExportInventoryOptions {
  const { outDir: _outDir, ...manifestOptions } = options;

  return manifestOptions;
}
