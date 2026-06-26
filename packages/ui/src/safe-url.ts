const allowedSchemes = new Set(['http', 'https', 'mailto', 'tel']);
const schemePattern = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// eslint-disable-next-line no-control-regex
const stripPattern = /[\u0000-\u0020\u007f-\u009f]+/g;

export function safeUrl(value: string | undefined, fallback = '#'): string {
  if (value === undefined || value === null) return fallback;

  const stripped = value.replace(stripPattern, '');
  if (stripped === '') return fallback;

  const pathBoundary = stripped.search(/[/?]/);
  const schemePosition = pathBoundary < 0 ? stripped : stripped.slice(0, pathBoundary);
  if (/&(?:#0*58(?![0-9])|#[xX]0*3[aA](?![0-9a-fA-F])|colon);?/.test(schemePosition)) return fallback;

  const schemeMatch = schemePattern.exec(stripped);
  if (schemeMatch === null) return value;

  const scheme = (schemeMatch[1] ?? '').toLowerCase();
  return allowedSchemes.has(scheme) ? value : fallback;
}
