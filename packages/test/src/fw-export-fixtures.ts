export interface FwExportHtmlArtifact {
  bytes: number;
  path: string;
  status: number;
}

export interface FwExportError {
  code: string;
  message: string;
  route: string;
}

export type FwExportSummary = Record<string, string>;

export interface FwExportOutput {
  errors: FwExportError[];
  html: FwExportHtmlArtifact[];
  summary?: FwExportSummary;
  version: 'fw-export/v1';
}

export function parseFwExportOutput(output: string): FwExportOutput {
  const lines = output.trimEnd().split('\n');
  const version = lines[0];
  if (version !== 'fw-export/v1') {
    throw new Error(`fw export output starts with fw-export/v1: ${version ?? ''}`);
  }

  const errors: FwExportError[] = [];
  const html: FwExportHtmlArtifact[] = [];
  let summary: FwExportSummary | undefined;

  for (const line of lines.slice(1)) {
    if (line.startsWith('HTML ')) {
      html.push(parseFwExportHtmlLine(line));
      continue;
    }

    if (line.startsWith('ERROR ')) {
      errors.push(parseFwExportErrorLine(line));
      continue;
    }

    if (line.startsWith('SUMMARY ')) {
      summary = parseKeyValueFields(line.slice('SUMMARY '.length));
      continue;
    }

    if (line.length === 0) continue;

    const lastError = errors[errors.length - 1];
    if (!lastError) {
      throw new Error(`Unrecognized fw export output line: ${line}`);
    }
    lastError.message += `\n${line}`;
  }

  return summary === undefined ? { errors, html, version } : { errors, html, summary, version };
}

function parseFwExportHtmlLine(line: string): FwExportHtmlArtifact {
  const match = /^HTML (?<path>\S+) status=(?<status>\d+) bytes=(?<bytes>\d+)$/.exec(line);
  if (!match?.groups) {
    throw new Error(`Malformed fw export HTML line: ${line}`);
  }

  return {
    bytes: Number(match.groups.bytes),
    path: match.groups.path ?? '',
    status: Number(match.groups.status),
  };
}

function parseFwExportErrorLine(line: string): FwExportError {
  const match = /^ERROR (?<code>\S+) route=(?<route>\S+)(?: (?<message>.*))?$/.exec(line);
  if (!match?.groups) {
    throw new Error(`Malformed fw export ERROR line: ${line}`);
  }

  return {
    code: match.groups.code ?? '',
    message: match.groups.message ?? '',
    route: match.groups.route ?? '',
  };
}

function parseKeyValueFields(source: string): FwExportSummary {
  const fields: FwExportSummary = {};
  let cursor = 0;

  while (cursor < source.length) {
    while (source[cursor] === ' ') cursor += 1;
    if (cursor >= source.length) break;

    const keyStart = cursor;
    while (cursor < source.length && source[cursor] !== '=' && source[cursor] !== ' ') {
      cursor += 1;
    }
    const key = source.slice(keyStart, cursor);
    if (!key || source[cursor] !== '=') {
      throw new Error(`Malformed fw export summary field near: ${source.slice(keyStart)}`);
    }
    cursor += 1;

    const valueStart = cursor;
    if (source[cursor] === '"') {
      cursor += 1;
      while (cursor < source.length) {
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === '"') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      fields[key] = source.slice(valueStart, cursor);
      continue;
    }

    while (cursor < source.length && source[cursor] !== ' ') cursor += 1;
    fields[key] = source.slice(valueStart, cursor);
  }

  return fields;
}
