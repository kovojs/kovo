export function fastCliVersionOutput(
  args: readonly string[],
  binModuleUrl: string | URL,
  readFile?: (url: URL, encoding: 'utf8') => string,
): string | null;
