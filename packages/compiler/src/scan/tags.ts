export interface OpeningTag {
  attrs: string;
  name: string;
  selfClosing: boolean;
  start: number;
}

export function scanOpeningTags(source: string): OpeningTag[] {
  return [...source.matchAll(/<(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)>/g)].map((match) => {
    const attrs = match.groups?.attrs ?? '';
    return {
      attrs,
      name: match.groups?.tag ?? '',
      selfClosing: isSelfClosing(attrs),
      start: match.index ?? 0,
    };
  });
}

export function readStaticAttribute(attrs: string, name: string): string | undefined {
  const match = new RegExp(`\\b${escapeRegExp(name)}=(["'])(?<value>[^"']+)\\1`).exec(attrs);
  return match?.groups?.value;
}

export function findMatchingClosingTag(source: string, tag: string, start: number): number {
  if (!tag) return -1;

  const openPattern = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*>`, 'g');
  const closePattern = new RegExp(`</${escapeRegExp(tag)}>`, 'g');
  openPattern.lastIndex = start;
  closePattern.lastIndex = start;
  let depth = 0;

  while (true) {
    const open = openPattern.exec(source);
    const close = closePattern.exec(source);
    if (!close) return -1;
    if (open && open.index < close.index) {
      if (isSelfClosingOpeningTag(open[0])) {
        closePattern.lastIndex = openPattern.lastIndex;
        continue;
      }
      depth += 1;
      closePattern.lastIndex = openPattern.lastIndex;
      continue;
    }

    depth -= 1;
    if (depth <= 0) return close.index + close[0].length;
    openPattern.lastIndex = closePattern.lastIndex;
  }
}

export function isSelfClosing(attrs: string): boolean {
  return /\/\s*$/.test(attrs);
}

function isSelfClosingOpeningTag(tagSource: string): boolean {
  const attrs = tagSource.replace(/^<[A-Za-z][\w:-]*/, '').replace(/>$/, '');
  return isSelfClosing(attrs);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
