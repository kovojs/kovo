export function findMatchingToken(
  source: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const end = findStringEnd(source, index, char);
      index = end === -1 ? source.length : end;
      continue;
    }

    if (char === '/' && source[index + 1] === '/') {
      const nextLine = source.indexOf('\n', index + 2);
      index = nextLine === -1 ? source.length : nextLine;
      continue;
    }

    if (char === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }

    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

export function findStringEnd(source: string, start: number, quote: string): number {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }

    if (quote === '`' && source[index] === '$' && source[index + 1] === '{') {
      const expressionEnd = findMatchingToken(source, index + 1, '{', '}');
      if (expressionEnd === -1) return -1;
      index = expressionEnd;
      continue;
    }

    if (source[index] === quote) return index;
  }

  return -1;
}
