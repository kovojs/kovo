export interface KovoExplainField {
  key: string;
  raw: string;
  value: string;
}

export interface KovoExplainRecord {
  key: string;
  raw: string;
  value: string;
}

export interface KovoExplainUpdateConsumerFact {
  consumers: string[];
  query: string;
}

export interface KovoExplainEndpointFact {
  auth: string;
  csrf: string;
  endpoint: string;
  method: string;
  mount: string;
  path: string;
  writes: string[];
}

export interface KovoExplainComponentHandlerFact {
  captures: string[];
  event: string;
  exportName: string;
  params: string[];
  ref: string;
  substitution: string;
}

export interface KovoExplainComponentDeriveFact {
  inputs: string[];
  name: string;
  ref: string;
  target: string;
}

export interface KovoExplainComponentTriggerFact {
  deps: string[];
  exportName: string;
  justification: string;
  ref: string;
  trigger: string;
}

export interface KovoExplainComponentMergeFact {
  attr: string;
  decision: string;
  diagnostics: string[];
  element: string;
  rule: string;
}

export interface KovoExplainScopeAuditFact {
  domain: string;
  reason: string;
  scope: string;
  site: string;
  target: string;
  targetKind: string;
}

export interface KovoExplainUnguardedFact {
  fields: Record<string, string | string[]>;
  target: string;
  targetKind: string;
}

export interface KovoExplainEndpointAssertionFact {
  endpoints: KovoExplainEndpointFact[];
  exitCode: number;
  subject: string;
  summary: KovoExplainSummary;
  version: KovoExplainOutput['version'];
}

export interface KovoExplainComponentAssertionFact {
  derives: KovoExplainComponentDeriveFact[];
  disambiguatedDomName?: string;
  domName?: string;
  exitCode: number;
  fragments: string[];
  handlers: KovoExplainComponentHandlerFact[];
  merges: KovoExplainComponentMergeFact[];
  queries: string[];
  subject: string;
  triggers: KovoExplainComponentTriggerFact[];
  version: KovoExplainOutput['version'];
}

export interface KovoExplainScopeAuditAssertionFact {
  exitCode: number;
  records: KovoExplainScopeAuditFact[];
  subject: 'UNGUARDED' | 'UNSCOPED';
  summary: KovoExplainSummary;
  version: KovoExplainOutput['version'];
}

export interface KovoExplainUnguardedAssertionFact {
  exitCode: number;
  records: KovoExplainUnguardedFact[];
  subject: 'UNGUARDED';
  summary: KovoExplainSummary;
  version: KovoExplainOutput['version'];
}

export interface KovoExplainResultLike {
  exitCode: number;
  output: string;
}

export interface KovoExplainMatrixGraphMutationFact {
  key: string;
}

export interface KovoExplainMatrixGraphQueryFact {
  query: string;
}

export interface KovoExplainMutationQueryMatrixGraph {
  mutations?: readonly KovoExplainMatrixGraphMutationFact[];
  queries?: readonly KovoExplainMatrixGraphQueryFact[];
}

export interface KovoExplainMutationQueryMatrixOptions {
  explainMutation: (mutationKey: string) => KovoExplainResultLike;
  graph: KovoExplainMutationQueryMatrixGraph;
  invalidatedBy?: ReadonlyMap<string, readonly string[]>;
}

export type KovoExplainMutationQueryMatrix = Record<string, Record<string, string>>;

export interface KovoExplainMutationQueryMatrixFact {
  matrix: KovoExplainMutationQueryMatrix;
  staticInvalidationMismatches: string[];
  unhandledMutations: string[];
  updateQueriesByMutation: Record<string, string[]>;
}

export interface KovoExplainOutput {
  fields: KovoExplainField[];
  records: KovoExplainRecord[];
  subject: string;
  version: 'kovo-explain/v1';
}

export type KovoExplainSummary = Record<string, string>;

export interface KovoExplainMutationAssertionFact {
  enctype?: string;
  exitCode: number;
  fileFields?: string[];
  guards: string[];
  inputFields: string[];
  invalidates: string[];
  manualInvalidates: string[];
  optimisticStatuses?: Record<string, string>;
  optimisticSummary?: KovoExplainSummary;
  session: string;
  subject: string;
  updateConsumers: KovoExplainUpdateConsumerFact[];
  version: KovoExplainOutput['version'];
  writes: string[];
}

export interface KovoExplainQueryAssertionFact {
  consumers: string[];
  domainWrites: string[];
  exitCode: number;
  invalidatedBy: string[];
  reads: string[];
  subject: string;
  version: KovoExplainOutput['version'];
}

export interface KovoExplainPageAssertionFact {
  exitCode: number;
  i18n: string[];
  meta: string;
  modulepreloads: string[];
  prefetch: string;
  queries: string[];
  stylesheets: string[];
  subject: string;
  version: KovoExplainOutput['version'];
  viewTransitions: string[];
}

export function parseKovoExplainOutput(output: string): KovoExplainOutput {
  const lines = output.trimEnd().split('\n');
  const version = lines[0];
  if (version !== 'kovo-explain/v1') {
    throw new Error(`kovo explain output starts with kovo-explain/v1: ${version ?? ''}`);
  }

  const subject = lines[1] ?? '';
  if (subject.length === 0) {
    throw new Error('kovo explain output includes a subject line');
  }

  const fields: KovoExplainField[] = [];
  const records: KovoExplainRecord[] = [];

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

export function kovoExplainMutationAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainMutationAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);
  const fact: KovoExplainMutationAssertionFact = {
    exitCode: result.exitCode,
    guards: listField(parsed, 'guards'),
    inputFields: listField(parsed, 'input-fields'),
    invalidates: listField(parsed, 'invalidates'),
    manualInvalidates: listField(parsed, 'manual-invalidates'),
    session: requiredField(parsed, 'session'),
    subject: parsed.subject,
    updateConsumers: kovoExplainUpdateConsumers(result.output),
    version: parsed.version,
    writes: listField(parsed, 'writes'),
  };
  const enctype = optionalField(parsed, 'enctype');
  const fileFields = optionalListField(parsed, 'file-fields');
  const optimisticSummary = optionalSummary(result.output, 'OPTIMISTIC-SUMMARY');
  const optimisticStatuses = kovoExplainOptimisticStatuses(result.output);

  if (enctype !== undefined) fact.enctype = enctype;
  if (fileFields !== undefined) fact.fileFields = fileFields;
  if (Object.keys(optimisticStatuses).length > 0) fact.optimisticStatuses = optimisticStatuses;
  if (optimisticSummary !== undefined) fact.optimisticSummary = optimisticSummary;

  return fact;
}

export function kovoExplainQueryAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainQueryAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);

  return {
    consumers: listField(parsed, 'consumers'),
    domainWrites: listField(parsed, 'domain-writes'),
    exitCode: result.exitCode,
    invalidatedBy: listField(parsed, 'invalidated-by'),
    reads: listField(parsed, 'reads'),
    subject: parsed.subject,
    version: parsed.version,
  };
}

export function kovoExplainPageAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainPageAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);

  return {
    exitCode: result.exitCode,
    i18n: listField(parsed, 'i18n'),
    meta: requiredField(parsed, 'meta'),
    modulepreloads: listField(parsed, 'modulepreloads'),
    prefetch: requiredField(parsed, 'prefetch'),
    queries: listField(parsed, 'queries'),
    stylesheets: listField(parsed, 'stylesheets'),
    subject: parsed.subject,
    version: parsed.version,
    viewTransitions: listField(parsed, 'view-transitions'),
  };
}

export function kovoExplainComponentAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainComponentAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);
  const disambiguatedDomName = optionalField(parsed, 'effective-dom-name');
  const domName = optionalField(parsed, 'dom-name');

  return {
    derives: kovoExplainComponentDeriveFacts(result.output),
    ...(disambiguatedDomName === undefined ? {} : { disambiguatedDomName }),
    ...(domName === undefined ? {} : { domName }),
    exitCode: result.exitCode,
    fragments: listField(parsed, 'fragments'),
    handlers: kovoExplainComponentHandlerFacts(result.output),
    merges: kovoExplainComponentMergeFacts(result.output),
    queries: listField(parsed, 'queries'),
    subject: parsed.subject,
    triggers: kovoExplainComponentTriggerFacts(result.output),
    version: parsed.version,
  };
}

export function kovoExplainEndpointAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainEndpointAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);

  return {
    endpoints: kovoExplainEndpointFacts(result.output),
    exitCode: result.exitCode,
    subject: parsed.subject,
    summary: kovoExplainSummary(result.output, 'SUMMARY'),
    version: parsed.version,
  };
}

export function kovoExplainScopeAuditAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainScopeAuditAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);
  if (parsed.subject !== 'UNGUARDED' && parsed.subject !== 'UNSCOPED') {
    throw new Error(`kovo explain scope audit subject is UNGUARDED or UNSCOPED: ${parsed.subject}`);
  }

  return {
    exitCode: result.exitCode,
    records: kovoExplainScopeAuditFacts(result.output, parsed.subject),
    subject: parsed.subject,
    summary: kovoExplainSummary(result.output, 'SUMMARY'),
    version: parsed.version,
  };
}

export function kovoExplainUnguardedAssertionFact(
  result: KovoExplainResultLike,
): KovoExplainUnguardedAssertionFact {
  const parsed = parseKovoExplainOutput(result.output);
  if (parsed.subject !== 'UNGUARDED') {
    throw new Error(`kovo explain unguarded subject is UNGUARDED: ${parsed.subject}`);
  }

  return {
    exitCode: result.exitCode,
    records: kovoExplainUnguardedFacts(result.output),
    subject: parsed.subject,
    summary: kovoExplainSummary(result.output, 'SUMMARY'),
    version: parsed.version,
  };
}

export function kovoExplainField(output: string, key: string): string {
  return requiredField(parseKovoExplainOutput(output), key);
}

export function kovoExplainRecords(output: string, key: string): string[] {
  return parseKovoExplainOutput(output)
    .records.filter((entry) => entry.key === key)
    .map((entry) => entry.value);
}

export function kovoExplainListField(output: string, key: string): string[] {
  return parseList(kovoExplainField(output, key));
}

export function kovoExplainOptimisticStatuses(output: string): Record<string, string> {
  return Object.fromEntries(
    kovoExplainRecords(output, 'OPTIMISTIC').map((record) => {
      const [query, status, ...extra] = record.split(/\s+/);
      if (!query || !status || extra.length > 0) {
        throw new Error(`kovo explain OPTIMISTIC record is '<query> <status>': ${record}`);
      }

      return [query, status];
    }),
  );
}

// SPEC.md §10.5: derivation punts render as a separate field line
// (`OPTIMISTIC-PUNT <query>: <reason label>`) so the OPTIMISTIC status records stay
// a clean `<query> <status>` and the named reason's own colons survive in the value.
export function kovoExplainOptimisticPunts(output: string): Record<string, string> {
  const prefix = 'OPTIMISTIC-PUNT ';
  return Object.fromEntries(
    parseKovoExplainOutput(output)
      .fields.filter((field) => field.key.startsWith(prefix))
      .map((field) => [field.key.slice(prefix.length), field.value]),
  );
}

export function kovoExplainSummary(output: string, key: string): KovoExplainSummary {
  const [summary] = kovoExplainRecords(output, key);
  if (summary === undefined) {
    throw new Error(`kovo explain output includes ${key}`);
  }
  return parseKeyValueFields(summary);
}

export function kovoExplainUpdateTargets(output: string): string[] {
  const updates = kovoExplainField(output, 'updates');
  if (updates === '-') {
    return [];
  }

  return updates.split(/\s*;\s*/).filter(Boolean);
}

export function kovoExplainUpdateConsumers(output: string): KovoExplainUpdateConsumerFact[] {
  return kovoExplainUpdateTargets(output).map((target) => {
    const [query, consumers] = target.split('->');
    if (!query || consumers === undefined) {
      throw new Error(`kovo explain update target is '<query>-><consumers>': ${target}`);
    }

    return { consumers: parseList(consumers), query };
  });
}

export function kovoExplainUpdateConsumerMap(output: string): Map<string, string[]> {
  return new Map(kovoExplainUpdateConsumers(output).map((entry) => [entry.query, entry.consumers]));
}

export function kovoExplainMutationQueryMatrixFact(
  options: KovoExplainMutationQueryMatrixOptions,
): KovoExplainMutationQueryMatrixFact {
  const matrix: KovoExplainMutationQueryMatrix = {};
  const staticInvalidationMismatches: string[] = [];
  const unhandledMutations: string[] = [];
  const updateQueriesByMutation: Record<string, string[]> = {};

  for (const mutation of options.graph.mutations ?? []) {
    const explanation = options.explainMutation(mutation.key);
    const statuses = kovoExplainOptimisticStatuses(explanation.output);
    const affectedQueries = [...kovoExplainUpdateConsumerMap(explanation.output).keys()];
    const affectedQuerySet = new Set(affectedQueries);
    const summary = optionalSummary(explanation.output, 'OPTIMISTIC-SUMMARY');
    const mutationMatrix: Record<string, string> = {};

    matrix[mutation.key] = mutationMatrix;
    updateQueriesByMutation[mutation.key] = affectedQueries;

    if (summary?.UNHANDLED !== undefined && summary.UNHANDLED !== '0') {
      unhandledMutations.push(mutation.key);
    }

    for (const query of options.graph.queries ?? []) {
      const invalidated = affectedQuerySet.has(query.query);
      const staticInvalidators = options.invalidatedBy?.get(query.query);
      const staticallyInvalidated = staticInvalidators?.includes(mutation.key);

      if (staticallyInvalidated !== undefined && staticallyInvalidated !== invalidated) {
        staticInvalidationMismatches.push(`${mutation.key}->${query.query}`);
      }

      mutationMatrix[query.query] = invalidated
        ? (statuses[query.query] ?? 'UNHANDLED')
        : 'no-invalidation';
    }
  }

  return {
    matrix,
    staticInvalidationMismatches,
    unhandledMutations,
    updateQueriesByMutation,
  };
}

export function kovoExplainComponentHandlerFacts(
  output: string,
): KovoExplainComponentHandlerFact[] {
  return kovoExplainRecords(output, 'HANDLER').map((record) => {
    const match =
      /^(?<event>\S+) export=(?<exportName>\S+) ref=(?<ref>\S+) captures=(?<captures>\S+) params=(?<params>\S+) substitution=(?<substitution>\S+)$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `kovo explain HANDLER record is '<event> export=... ref=... captures=... params=... substitution=...': ${record}`,
      );
    }

    return {
      captures: parseList(requiredMatchGroup(match.groups, 'captures')),
      event: requiredMatchGroup(match.groups, 'event'),
      exportName: requiredMatchGroup(match.groups, 'exportName'),
      params: parseList(requiredMatchGroup(match.groups, 'params')),
      ref: requiredMatchGroup(match.groups, 'ref'),
      substitution: requiredMatchGroup(match.groups, 'substitution'),
    };
  });
}

export function kovoExplainComponentDeriveFacts(output: string): KovoExplainComponentDeriveFact[] {
  return kovoExplainRecords(output, 'DERIVE').map((record) => {
    const match = /^(?<name>\S+) inputs=(?<inputs>\S+) ref=(?<ref>\S+) target=(?<target>\S+)$/.exec(
      record,
    );
    if (!match?.groups) {
      throw new Error(
        `kovo explain DERIVE record is '<name> inputs=... ref=... target=...': ${record}`,
      );
    }

    return {
      inputs: parseList(requiredMatchGroup(match.groups, 'inputs')),
      name: requiredMatchGroup(match.groups, 'name'),
      ref: requiredMatchGroup(match.groups, 'ref'),
      target: requiredMatchGroup(match.groups, 'target'),
    };
  });
}

export function kovoExplainComponentTriggerFacts(
  output: string,
): KovoExplainComponentTriggerFact[] {
  return kovoExplainRecords(output, 'TRIGGER').map((record) => {
    const match =
      /^(?<trigger>\S+) export=(?<exportName>\S+) ref=(?<ref>\S+) deps=(?<deps>\S+) justification=(?<justification>.*)$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `kovo explain TRIGGER record is '<trigger> export=... ref=... deps=... justification=...': ${record}`,
      );
    }

    return {
      deps: parseList(requiredMatchGroup(match.groups, 'deps')),
      exportName: requiredMatchGroup(match.groups, 'exportName'),
      justification: requiredMatchGroup(match.groups, 'justification'),
      ref: requiredMatchGroup(match.groups, 'ref'),
      trigger: requiredMatchGroup(match.groups, 'trigger'),
    };
  });
}

export function kovoExplainComponentMergeFacts(output: string): KovoExplainComponentMergeFact[] {
  return kovoExplainRecords(output, 'MERGE').map((record) => {
    const match =
      /^(?<element>\S+) attr=(?<attr>\S+) rule=(?<rule>\S+) decision=(?<decision>\S+) diagnostics=(?<diagnostics>\S+)$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `kovo explain MERGE record is '<element> attr=... rule=... decision=... diagnostics=...': ${record}`,
      );
    }

    return {
      attr: requiredMatchGroup(match.groups, 'attr'),
      decision: requiredMatchGroup(match.groups, 'decision'),
      diagnostics: parseList(requiredMatchGroup(match.groups, 'diagnostics')),
      element: requiredMatchGroup(match.groups, 'element'),
      rule: requiredMatchGroup(match.groups, 'rule'),
    };
  });
}

export function kovoExplainEndpointFacts(output: string): KovoExplainEndpointFact[] {
  return kovoExplainRecords(output, 'ENDPOINT').map((record) => {
    const match =
      /^(?<endpoint>\S+) method=(?<method>\S+) path=(?<path>\S+) mount=(?<mount>\S+) auth=(?<auth>\S+) csrf=(?<csrf>.*?) writes=(?<writes>\S+)$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `kovo explain ENDPOINT record is '<endpoint> method=... path=... mount=... auth=... csrf=... writes=...': ${record}`,
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

export function kovoExplainScopeAuditFacts(
  output: string,
  key: 'UNGUARDED' | 'UNSCOPED',
): KovoExplainScopeAuditFact[] {
  return kovoExplainRecords(output, key).map((record) => {
    const match =
      /^(?<targetKind>\S+) (?<target>\S+) domain=(?<domain>\S+) scope=(?<scope>\S+) site=(?<site>\S+)(?: (?<reason>.*))?$/.exec(
        record,
      );
    if (!match?.groups) {
      throw new Error(
        `kovo explain ${key} record is '<kind> <target> domain=... scope=... site=... [reason]': ${record}`,
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

export function kovoExplainUnguardedFacts(output: string): KovoExplainUnguardedFact[] {
  return parseKovoExplainOutput(output)
    .records.filter((record) => record.key !== 'SUMMARY')
    .map((record) => {
      const tokens = record.value.split(/\s+/).filter(Boolean);
      const target = tokens.shift();
      if (!target) {
        throw new Error(`kovo explain UNGUARDED record includes a target: ${record.raw}`);
      }

      return {
        fields: parseRecordFields(tokens, record.raw),
        target,
        targetKind: record.key,
      };
    });
}

function parseRecordFields(tokens: string[], raw: string): Record<string, string | string[]> {
  return Object.fromEntries(
    tokens.map((token) => {
      const [key, value] = token.split('=');
      if (!key || value === undefined) {
        throw new Error(`kovo explain record field is key=value: ${raw}`);
      }
      return [key, shouldParseRecordList(key) ? parseList(value) : value];
    }),
  );
}

function shouldParseRecordList(key: string): boolean {
  return ['guards', 'invalidates', 'manual-invalidates', 'queries', 'reads', 'writes'].includes(
    key,
  );
}

function requiredMatchGroup(groups: Record<string, string | undefined>, key: string): string {
  const value = groups[key];
  if (value === undefined) {
    throw new Error(`kovo explain regex match includes ${key}`);
  }
  return value;
}

function requiredField(output: KovoExplainOutput, key: string): string {
  const field = optionalField(output, key);
  if (field === undefined) {
    throw new Error(`kovo explain output includes ${key}:`);
  }
  return field;
}

function optionalField(output: KovoExplainOutput, key: string): string | undefined {
  return output.fields.find((entry) => entry.key === key)?.value;
}

function listField(output: KovoExplainOutput, key: string): string[] {
  return parseList(requiredField(output, key));
}

function optionalListField(output: KovoExplainOutput, key: string): string[] | undefined {
  const value = optionalField(output, key);
  return value === undefined ? undefined : parseList(value);
}

function optionalSummary(output: string, key: string): KovoExplainSummary | undefined {
  const [summary] = kovoExplainRecords(output, key);
  return summary === undefined ? undefined : parseKeyValueFields(summary);
}

function parseList(value: string): string[] {
  return value === '-' ? [] : value.split(',').filter(Boolean);
}

function parseKeyValueFields(source: string): KovoExplainSummary {
  return Object.fromEntries(
    source.split(/\s+/).map((entry) => {
      const [key, value] = entry.split('=');
      if (!key || value === undefined) {
        throw new Error(`kovo explain summary entry is key=value: ${entry}`);
      }
      return [key, value];
    }),
  );
}
