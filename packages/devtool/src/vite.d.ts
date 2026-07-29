export function devtoolMountPlugin(
  base: string,
  opts: {
    app?: string;
    captureRuntimeFrames?: boolean;
    handlerModuleId: string;
    name?: string;
  },
): { name: string; configureServer(server: unknown): Promise<void> };
