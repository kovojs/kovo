export function tagClose(source: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return index;
  }

  return undefined;
}

export function readAttribute(attrs: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    '(?:^|\\s)' +
      escapedName +
      '(?=\\s|=|$|/)(?:\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>\\x60]+)))?(?=\\s|$|/|>)',
    'i',
  );
  const match = pattern.exec(attrs);
  return unescapeHtml((match && (match[1] ?? match[2] ?? match[3])) || '') || null;
}

export function unescapeHtml(value: string): string {
  return value
    .replaceAll('&#39;', "'")
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}
