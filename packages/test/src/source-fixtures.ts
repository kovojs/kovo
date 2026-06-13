export interface ProjectSourceSiteFact {
  line: number;
  path: string;
}

export function cssSourceDirectives(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@source '))
    .map((line) => line.slice('@source '.length).replace(/;$/, ''));
}

export function projectSourceSiteFact(site: string): ProjectSourceSiteFact {
  const separator = site.lastIndexOf(':');
  if (separator === -1) {
    throw new Error(`Project source site includes a line number: ${site}`);
  }

  const line = Number(site.slice(separator + 1));
  if (!Number.isInteger(line) || line <= 0) {
    throw new Error(`Project source site line is positive: ${site}`);
  }

  return { line, path: site.slice(0, separator) };
}
