export interface FwExplainField {
  key: string;
  raw: string;
  value: string;
}

export interface FwExplainRecord {
  key: string;
  raw: string;
  value: string;
}

export interface FwExplainOutput {
  fields: FwExplainField[];
  records: FwExplainRecord[];
  subject: string;
  version: 'fw-explain/v1';
}

export type FwExplainSummary = Record<string, string>;

export function parseFwExplainOutput(output: string): FwExplainOutput {
  const lines = output.trimEnd().split('\n');
  const version = lines[0];
  if (version !== 'fw-explain/v1') {
    throw new Error(`fw explain output starts with fw-explain/v1: ${version ?? ''}`);
  }

  const subject = lines[1] ?? '';
  if (subject.length === 0) {
    throw new Error('fw explain output includes a subject line');
  }

  const fields: FwExplainField[] = [];
  const records: FwExplainRecord[] = [];

  for (const raw of lines.slice(2)) {
    if (raw.length === 0) continue;

    const fieldSeparator = raw.indexOf(': ');
    if (fieldSeparator !== -1) {
      fields.push({
        key: raw.slice(0, fieldSeparator),
        raw,
        value: raw.slice(fieldSeparator + 2),
      });
      continue;
    }

    const recordSeparator = raw.indexOf(' ');
    if (recordSeparator !== -1) {
      records.push({
        key: raw.slice(0, recordSeparator),
        raw,
        value: raw.slice(recordSeparator + 1),
      });
      continue;
    }

    records.push({ key: raw, raw, value: '' });
  }

  return { fields, records, subject, version };
}

export function fwExplainField(output: string, key: string): string {
  const field = parseFwExplainOutput(output).fields.find((entry) => entry.key === key);
  if (!field) {
    throw new Error(`fw explain output includes ${key}:`);
  }
  return field.value;
}

export function fwExplainRecords(output: string, key: string): string[] {
  return parseFwExplainOutput(output)
    .records.filter((entry) => entry.key === key)
    .map((entry) => entry.value);
}

export function fwExplainSummary(output: string, key: string): FwExplainSummary {
  const [summary] = fwExplainRecords(output, key);
  if (summary === undefined) {
    throw new Error(`fw explain output includes ${key}`);
  }
  return parseKeyValueFields(summary);
}

export function fwExplainUpdateTargets(output: string): string[] {
  return fwExplainField(output, 'updates')
    .split(/\s*;\s*/)
    .filter(Boolean);
}

function parseKeyValueFields(source: string): FwExplainSummary {
  return Object.fromEntries(
    source.split(/\s+/).map((entry) => {
      const [key, value] = entry.split('=');
      if (!key || value === undefined) {
        throw new Error(`fw explain summary entry is key=value: ${entry}`);
      }
      return [key, value];
    }),
  );
}
