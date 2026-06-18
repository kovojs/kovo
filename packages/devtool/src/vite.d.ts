export function devtoolMountPlugin(
  base: string,
  opts: { handlerModuleId: string; name?: string },
): { name: string; configureServer(server: unknown): Promise<void> };
