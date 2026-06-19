const allowedSchemes = new Set(['http', 'https', 'mailto', 'tel']);
const schemePattern = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
// eslint-disable-next-line no-control-regex
const stripPattern = /[\u0000-\u0020\u007f-\u009f]+/g;

export function safeUrl(value: string | undefined, fallback = '#'): string {
  if (value === undefined || value === null) return fallback;

  const stripped = value.replace(stripPattern, '');
  if (stripped === '') return fallback;

  const schemeBoundary = stripped.search(/[:/?#]/);
  const schemePosition = schemeBoundary < 0 ? stripped : stripped.slice(0, schemeBoundary);
  if (schemePosition.includes('&')) return fallback;

  const schemeMatch = schemePattern.exec(stripped);
  if (schemeMatch === null) return value;

  const scheme = (schemeMatch[1] ?? '').toLowerCase();
  return allowedSchemes.has(scheme) ? value : fallback;
}
