import type { JisoApp } from './app-types.js';
import {
  createJisoAppShellViteBuildFromBundle,
  type JisoAppShellBuild,
  type JisoAppShellVitePluginBuildOptions,
} from './vite-build.js';
import {
  jisoAppShellViteOutputDir,
  writeJisoAppShellViteBuildOutput,
  type JisoAppShellViteBuildOutput,
  type JisoAppShellViteOutputOptions,
} from './vite-build-output.js';
import type { JisoAppShellViteOutputBundle } from './vite-manifest.js';

export interface JisoAppShellVitePluginBuildContext {
  app: JisoApp;
  buildOptions: JisoAppShellVitePluginBuildOptions;
  bundle: JisoAppShellViteOutputBundle;
  outputOptions: JisoAppShellViteOutputOptions;
}

export interface JisoAppShellVitePluginBuildResult {
  build: JisoAppShellBuild;
  output: JisoAppShellViteBuildOutput;
}

export async function writeJisoAppShellVitePluginBuild(
  context: JisoAppShellVitePluginBuildContext,
): Promise<JisoAppShellVitePluginBuildResult> {
  const outDir = context.buildOptions.outDir ?? jisoAppShellViteOutputDir(context.outputOptions);
  const build = createJisoAppShellViteBuildFromBundle({
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
  const output = await writeJisoAppShellViteBuildOutput(build, {
    outDir,
    ...(context.buildOptions.staticExport === undefined
      ? {}
      : { staticExport: context.buildOptions.staticExport }),
  });

  await context.buildOptions.onBuild?.(build, output);

  return { build, output };
}
