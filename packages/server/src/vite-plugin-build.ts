import type { KovoApp } from './app-types.js';
import {
  createKovoAppShellViteBuildFromBundle,
  type KovoAppShellBuild,
  type KovoAppShellVitePluginBuildOptions,
} from './vite-build.js';
import {
  kovoAppShellViteOutputDir,
  writeKovoAppShellViteBuildOutput,
  type KovoAppShellViteBuildOutput,
  type KovoAppShellViteOutputOptions,
} from './vite-build-output.js';
import type { KovoAppShellViteOutputBundle } from './vite-manifest.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Raw writeBundle
 * context passed from the combined Vite plugin to the output writer.
 */
export interface KovoAppShellVitePluginBuildContext {
  app: KovoApp;
  buildOptions: KovoAppShellVitePluginBuildOptions;
  bundle: KovoAppShellViteOutputBundle;
  outputOptions: KovoAppShellViteOutputOptions;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Build and output
 * result returned to plugin hook tests and in-repo tooling.
 */
export interface KovoAppShellVitePluginBuildResult {
  build: KovoAppShellBuild;
  output: KovoAppShellViteBuildOutput;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Writes the plugin
 * build output and optional static export from a Rollup/Vite bundle.
 */
export async function writeKovoAppShellVitePluginBuild(
  context: KovoAppShellVitePluginBuildContext,
): Promise<KovoAppShellVitePluginBuildResult> {
  const outDir = context.buildOptions.outDir ?? kovoAppShellViteOutputDir(context.outputOptions);
  const build = createKovoAppShellViteBuildFromBundle({
    app: context.app,
    bundle: context.bundle,
    ...(context.buildOptions.base === undefined ? {} : { base: context.buildOptions.base }),
    ...(context.buildOptions.clientModules === undefined
      ? {}
      : { clientModules: context.buildOptions.clientModules }),
    ...(context.buildOptions.routeEntryMap === undefined
      ? {}
      : { routeEntryMap: context.buildOptions.routeEntryMap }),
  });
  // SPEC §9.5: the Vite plugin build hook publishes the same app-shell build
  // output and optional static export as manifest-file export tasks.
  const output = await writeKovoAppShellViteBuildOutput(build, {
    outDir,
    ...(context.buildOptions.staticExport === undefined
      ? {}
      : { staticExport: context.buildOptions.staticExport }),
  });

  await context.buildOptions.onBuild?.(build, output);

  return { build, output };
}
