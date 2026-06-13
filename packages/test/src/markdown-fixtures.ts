export type MarkdownFields = Map<string, string>;
export type MarkdownTableRow = Record<string, string>;

export interface MarkdownBoldSectionHeading {
  number: string;
  title: string;
}

export function normalizeMarkdownCell(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function markdownSection(source: string, heading: string): string {
  const lines = source.split('\n');
  const headingLineIndex = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match && normalizeMarkdownCell(match[2] ?? '') === heading;
  });
  if (headingLineIndex === -1) {
    throw new Error(`Markdown contains heading ${heading}`);
  }

  const headingLine = lines[headingLineIndex] ?? '';
  const headingMatch = /^(#{1,6})/.exec(headingLine);
  const headingMarker = headingMatch?.[1];
  if (!headingMarker) {
    throw new Error(`Markdown heading is structured: ${headingLine}`);
  }
  const level = headingMarker.length;
  const endIndex = lines.findIndex((line, index) => {
    if (index <= headingLineIndex) return false;
    const match = /^(#{1,6})\s+/.exec(line);
    return match && match[1]!.length <= level;
  });

  return lines.slice(headingLineIndex + 1, endIndex === -1 ? undefined : endIndex).join('\n');
}

export function markdownNumberedListItems(source: string): string[] {
  return source
    .split('\n')
    .map((line) => /^\s*\d+\.\s+(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => normalizeMarkdownCell(match[1] ?? ''));
}

export function markdownNumberedListTitles(source: string): string[] {
  return markdownNumberedListItems(source).map((item) =>
    normalizeMarkdownCell(item.split('.')[0]!),
  );
}

export function markdownBoldSectionHeadings(source: string): MarkdownBoldSectionHeading[] {
  return source
    .split('\n')
    .map((line) => /^\s*\*\*(\d+(?:\.\d+)*)\s+(.+?)[.:]\*\*(?:\s+.*)?$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      number: match[1] ?? '',
      title: normalizeMarkdownCell(match[2] ?? ''),
    }));
}

export function markdownLeadingTitle(value: string): string {
  return normalizeMarkdownCell(value.replaceAll('**', '').split('.')[0] ?? '');
}

export function markdownFields(source: string): MarkdownFields {
  const fields: MarkdownFields = new Map();
  let currentField: string | undefined;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    const match = /^([A-Z][A-Za-z ]+):\s+(.+)$/.exec(trimmed);
    if (match) {
      const fieldName = match[1] ?? '';
      currentField = fieldName;
      fields.set(currentField, normalizeMarkdownCell(match[2] ?? ''));
      continue;
    }

    if (
      currentField &&
      trimmed &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('```')
    ) {
      fields.set(currentField, normalizeMarkdownCell(`${fields.get(currentField)} ${trimmed}`));
      continue;
    }

    currentField = undefined;
  }

  return fields;
}

export function markdownTableRows(source: string): MarkdownTableRow[] {
  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'));
  if (lines.length < 2) {
    throw new Error('Markdown section contains a table');
  }

  const header = lines[0]!
    .slice(1, -1)
    .split('|')
    .map((cell) => normalizeMarkdownCell(cell));

  return lines.slice(2).map((line) => {
    const values = line
      .slice(1, -1)
      .split('|')
      .map((cell) => normalizeMarkdownCell(cell));
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
  });
}
