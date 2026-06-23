// SPEC.md §4.4: the framework bootstrap runtime is not app-authored client code.
export function isAuthoredClientModuleRequest(url: string): boolean {
  const pathname = new URL(url).pathname;
  return (
    pathname.endsWith('/client.ts') ||
    (pathname.startsWith('/c/') && !pathname.endsWith('/kovo-runtime.client.js'))
  );
}

export function isAuthoredStaticClientModulePath(path: string): boolean {
  return path.startsWith('/c/') && !path.endsWith('/kovo-runtime.client.js');
}
