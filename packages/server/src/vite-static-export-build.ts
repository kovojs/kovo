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

export async function exportKovoAppShellViteBuild(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportOptions,
): Promise<StaticExportResult> {
  return exportStaticApp(build.app, kovoAppShellViteBuildWriteStaticExportOptions(build, options));
}

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

export async function staticExportInventoryForKovoAppShellViteBuild(
  build: KovoAppShellBuild,
  options: KovoAppShellViteBuildStaticExportInventoryOptions,
): Promise<StaticExportInventoryItem[]> {
  const result = await staticExportDryRunResultForKovoAppShellViteBuild(build, options);

  return staticExportInventory(result);
}

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
