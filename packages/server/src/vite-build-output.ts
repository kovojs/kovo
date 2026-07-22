import { exportStaticApp } from './static-export.js';
import { buildOwnDataProperty, buildSecurityPathDirname } from './build-security-intrinsics.js';
import type { KovoAppShellBuild, KovoAppShellBuiltClientModule } from './vite-build.js';
import { kovoAppShellViteStaticExportAssets, resolvedFileSystemPath } from './vite-build-assets.js';
import type { StaticExportAssetInput, StaticExportResult } from './static-export-types.js';
import {
  kovoAppShellViteBuildOutputStaticExportPlan,
  type KovoAppShellViteBuildOutputStaticExportOptions,
} from './vite-static-export-options.js';
import {
  assertWritableKovoAppShellViteClientModuleOutput,
  kovoAppShellViteClientModuleOutputPlan,
  snapshotKovoAppShellViteBuiltClientModules,
  writeKovoAppShellViteClientModuleOutput,
  type KovoAppShellViteClientModuleOutputPlanItem,
} from './vite-client-module-output.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Vite output.dir/file
 * descriptor passed from the writeBundle hook.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteOutputOptions {
  dir?: string;
  file?: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Options for writing
 * built client modules and optional static export to an output directory.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildOutputOptions {
  outDir: string | URL;
  staticExport?: KovoAppShellViteBuildOutputStaticExportOptions | false;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Result of writing the
 * build output: client module plan, emitted modules, and static export artifacts.
 * Exported only for in-repo build/host config, not app authors.
 */
export interface KovoAppShellViteBuildOutput {
  clientModuleOutputPlan: readonly KovoAppShellViteClientModuleOutputPlanItem[];
  clientModules: readonly KovoAppShellBuiltClientModule[];
  staticExport?: StaticExportResult;
  staticExportAssets: readonly StaticExportAssetInput[];
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Writes built client
 * modules and optional static export to the Vite output directory.
 * Exported only for in-repo build/host config, not app authors.
 */
export async function writeKovoAppShellViteBuildOutput(
  build: Pick<KovoAppShellBuild, 'clientModules'> &
    Partial<Pick<KovoAppShellBuild, 'app' | 'assets'>>,
  options: KovoAppShellViteBuildOutputOptions,
): Promise<KovoAppShellViteBuildOutput> {
  const clientModuleField = buildOwnDataProperty(
    build,
    'clientModules',
    'Vite app-shell build clientModules',
  );
  if (!clientModuleField.present) {
    throw new TypeError('Vite app-shell build clientModules is required.');
  }
  // SPEC §5.2.1: static-export replay executes authored route code between output preflight and
  // final commit. Close the array and each representation before that replay so neither a replaced
  // build field nor a mutated element can swap executable bytes under an approved digest.
  const clientModules = snapshotKovoAppShellViteBuiltClientModules(
    clientModuleField.value as readonly KovoAppShellBuiltClientModule[],
  );
  const root = resolvedFileSystemPath(options.outDir);
  const staticExportOptions = options.staticExport || undefined;
  const staticExportBuild = staticExportOptions
    ? assertStaticExportBuild(build, clientModules)
    : undefined;
  const staticExportPlan =
    staticExportBuild && staticExportOptions
      ? kovoAppShellViteBuildOutputStaticExportPlan(staticExportBuild, staticExportOptions, root)
      : undefined;
  const staticExportAssets =
    staticExportPlan?.assets ??
    kovoAppShellViteStaticExportAssets(build.assets ?? [], { distDir: root });

  const output: KovoAppShellViteBuildOutput = {
    clientModuleOutputPlan: kovoAppShellViteClientModuleOutputPlan(root, clientModules),
    clientModules,
    staticExportAssets,
  };

  await assertWritableKovoAppShellViteClientModuleOutput(root, clientModules);

  if (staticExportBuild && staticExportPlan) {
    output.staticExport = await exportStaticApp(staticExportBuild.app, staticExportPlan.options);
  }

  await writeKovoAppShellViteClientModuleOutput(root, clientModules);

  return output;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Resolves the output
 * directory from a Vite output.dir/file descriptor.
 * Exported only for in-repo build/host config, not app authors.
 */
export function kovoAppShellViteOutputDir(options: KovoAppShellViteOutputOptions): string {
  const dir = buildOwnDataProperty(options, 'dir', 'Vite output.dir');
  if (dir.present && typeof dir.value === 'string' && dir.value !== '') return dir.value;
  const file = buildOwnDataProperty(options, 'file', 'Vite output.file');
  if (file.present && typeof file.value === 'string' && file.value !== '') {
    return buildSecurityPathDirname(file.value);
  }

  throw new Error('App shell Vite build output requires output.dir or output.file.');
}

function assertStaticExportBuild(
  build: Pick<KovoAppShellBuild, 'clientModules'> &
    Partial<Pick<KovoAppShellBuild, 'app' | 'assets'>>,
  clientModules: readonly KovoAppShellBuiltClientModule[],
): KovoAppShellBuild {
  if (!build.app) {
    throw new Error('App shell Vite build output static export requires a Kovo app.');
  }

  return {
    app: build.app,
    assets: build.assets ?? [],
    clientModules,
    routeHints: [],
  };
}
