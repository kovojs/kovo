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

export interface FwExplainUpdateConsumerFact {
  consumers: string[];
  query: string;
}

export interface FwExplainEndpointFact {
  auth: string;
  csrf: string;
  endpoint: string;
  method: string;
  mount: string;
  path: string;
  writes: string[];
}

export interface FwExplainScopeAuditFact {
  domain: string;
  reason: string;
  scope: string;
  site: string;
  target: string;
  targetKind: string;
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

export function fwExplainListField(output: string, key: string): string[] {
  return parseList(fwExplainField(output, key));
}

export function fwExplainOptimisticStatuses(output: string): Record<string, string> {
  return Object.fromEntries(
    fwExplainRecords(output, 'OPTIMISTIC').map((record) => {
      const [query, status, ...extra] = record.split(/\s+/);
      if (!query || !status || extra.length > 0) {
        throw new Error(`fw explain OPTIMISTIC record is '<query> <status>': ${record}`);
      }

      return [query, status];
    }),
  );
}

export function fwExplainSummary(output: string, key: string): FwExplainSummary {
  const [summary] = fwExplainRecords(output, key);
  if (summary === undefined) {
    throw new Error(`fw explain output includes ${key}`);
  }
  return parseKeyValueFields(summary);
}

export function fwExplainUpdateTargets(output: string): string[] {
  const updates = fwExplainField(output, 'updates');
  if (updates === '-') {
    return [];
  }

  return updates.split(/\s*;\s*/).filter(Boolean);
}

export function fwExplainUpdateConsumers(output: string): FwExplainUpdateConsumerFact[] {
  return fwExplainUpdateTargets(output).map((target) => {
    const [query, consumers] = target.split('->');
    if (!query || consumers === undefined) {
      throw new Error(`fw explain update target is '<query>-><consumers>': ${target}`);
    }

    return { consumers: parseList(consumers), query };
  });
}

export function fwExplainUpdateConsumerMap(output: string): Map<string, string[]> {
  return new Map(fwExplainUpdateConsumers(output).map((entry) => [entry.query, entry.consumers]));
}

export function fwExplainEndpointFacts(output: string): FwExplainEndpointFact[] {
  return fwExplainRecords(output, 'ENDPOINT').map((record) => {
    const match =
      /^(?<endpoint>\S+) method=(?<method>\S+) path=(?<path>\S+) mount=(?<mount>\S+) auth=(?<auth>\S+) csrf=(?<csrf>.*?) writes=(?<writes>\S+)$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `fw explain ENDPOINT record is '<endpoint> method=... path=... mount=... auth=... csrf=... writes=...': ${record}`,
      );
    }

    return {
      auth: requiredMatchGroup(match.groups, 'auth'),
      csrf: requiredMatchGroup(match.groups, 'csrf'),
      endpoint: requiredMatchGroup(match.groups, 'endpoint'),
      method: requiredMatchGroup(match.groups, 'method'),
      mount: requiredMatchGroup(match.groups, 'mount'),
      path: requiredMatchGroup(match.groups, 'path'),
      writes: parseList(requiredMatchGroup(match.groups, 'writes')),
    };
  });
}

export function fwExplainScopeAuditFacts(
  output: string,
  key: 'UNGUARDED' | 'UNSCOPED',
): FwExplainScopeAuditFact[] {
  return fwExplainRecords(output, key).map((record) => {
    const match =
      /^(?<targetKind>\S+) (?<target>\S+) domain=(?<domain>\S+) scope=(?<scope>\S+) site=(?<site>\S+)(?: (?<reason>.*))?$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `fw explain ${key} record is '<kind> <target> domain=... scope=... site=... [reason]': ${record}`,
      );
    }

    return {
      domain: requiredMatchGroup(match.groups, 'domain'),
      reason: match.groups.reason ?? '',
      scope: requiredMatchGroup(match.groups, 'scope'),
      site: requiredMatchGroup(match.groups, 'site'),
      target: requiredMatchGroup(match.groups, 'target'),
      targetKind: requiredMatchGroup(match.groups, 'targetKind'),
    };
  });
}

function requiredMatchGroup(groups: Record<string, string | undefined>, key: string): string {
  const value = groups[key];
  if (value === undefined) {
    throw new Error(`fw explain regex match includes ${key}`);
  }
  return value;
}

function parseList(value: string): string[] {
  return value === '-' ? [] : value.split(',').filter(Boolean);
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
