export interface FwCheckDiagnosticFact {
  code: string;
  message: string;
  properties: Record<string, string>;
  raw: string;
  severity: 'ERROR' | 'WARN';
  target: string;
}

export interface FwCheckCoverageFact {
  properties: Record<string, string>;
  raw: string;
}

export interface FwCheckOutput {
  coverage: FwCheckCoverageFact[];
  diagnostics: FwCheckDiagnosticFact[];
  status: 'issues' | 'ok';
  version: 'fw-check/v1';
}

export interface FwCheckResultLike {
  exitCode: number;
  output: string;
}

export interface FwCheckResultFact extends FwCheckOutput {
  exitCode: number;
}

export function parseFwCheckOutput(output: string): FwCheckOutput {
  const lines = output.trimEnd().split('\n');
  const version = lines[0];
  if (version !== 'fw-check/v1') {
    throw new Error(`fw check output starts with fw-check/v1: ${version ?? ''}`);
  }

  const body = lines.slice(1).filter((line) => line.length > 0);
  if (body.length === 1 && body[0] === 'OK') {
    return { coverage: [], diagnostics: [], status: 'ok', version };
  }

  const coverage: FwCheckCoverageFact[] = [];
  const diagnostics: FwCheckDiagnosticFact[] = [];

  for (const line of body) {
    if (line.startsWith('COVERAGE ')) {
      coverage.push({
        properties: parseKeyValueFields(line.slice('COVERAGE '.length)),
        raw: line,
      });
      continue;
    }

    const diagnostic = parseFwCheckDiagnostic(line);
    if (!diagnostic) {
      throw new Error(`fw check output line is a diagnostic or coverage fact: ${line}`);
    }
    diagnostics.push(diagnostic);
  }

  return { coverage, diagnostics, status: 'issues', version };
}

export function fwCheckResultFact(result: FwCheckResultLike): FwCheckResultFact {
  return { ...parseFwCheckOutput(result.output), exitCode: result.exitCode };
}

export function fwCheckDiagnosticFacts(output: string): FwCheckDiagnosticFact[] {
  return parseFwCheckOutput(output).diagnostics;
}

export function fwCheckCoverageFacts(output: string): FwCheckCoverageFact[] {
  return parseFwCheckOutput(output).coverage;
}

function parseFwCheckDiagnostic(line: string): FwCheckDiagnosticFact | undefined {
  const match = /^(ERROR|WARN) (\S+)(?: (.*))?$/.exec(line);
  if (!match) return undefined;

  const severity = match[1] as 'ERROR' | 'WARN';
  const code = match[2] ?? '';
  const detail = match[3] ?? '';
  const properties = leadingKeyValueFields(detail);
  const propertyPrefix = Object.entries(properties)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  const rest = propertyPrefix.length > 0 ? detail.slice(propertyPrefix.length).trimStart() : detail;
  const parsed = parseTargetAndMessage(code, rest);

  return {
    code,
    message: parsed.message,
    properties,
    raw: line,
    severity,
    target: parsed.target,
  };
}

function parseTargetAndMessage(code: string, detail: string): { message: string; target: string } {
  if (detail.length === 0) return { message: '', target: '' };

  if (code === 'FW310') {
    const message = 'Invalidated query lacks optimistic transform.';
    return detail.endsWith(message)
      ? { message, target: detail.slice(0, -message.length).trimEnd() }
      : { message: detail, target: '' };
  }

  if (code === 'FW311') {
    const message = 'Query-dependent DOM position has no update status.';
    return detail === message ? { message, target: '' } : { message: detail, target: '' };
  }

  const [target, ...messageParts] = detail.split(/\s+/);
  return { message: messageParts.join(' '), target: target ?? '' };
}

function leadingKeyValueFields(source: string): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const entry of source.split(/\s+/)) {
    if (entry.length === 0) continue;
    const separator = entry.indexOf('=');
    if (separator === -1) break;
    const key = entry.slice(0, separator);
    const value = entry.slice(separator + 1);
    if (key.length === 0 || value.length === 0) break;
    fields[key] = value;
  }

  return fields;
}

function parseKeyValueFields(source: string): Record<string, string> {
  const fields = leadingKeyValueFields(source);
  const consumed = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  if (consumed !== source.trim()) {
    throw new Error(`fw check coverage fields are key=value entries: ${source}`);
  }
  return fields;
}
