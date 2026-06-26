import type { TouchGraph, TouchSite } from '@kovojs/core/internal/graph';

/** @internal */
export interface InvalidationQueryInput {
  domains: readonly string[];
  instanceKey?: {
    domain: string;
    key: string;
  };
  query: string;
}

/** @internal */
export interface MutationTouchInput {
  mutation: string;
  touchGraphKey: string;
}

/** @internal */
export interface InferredMutationTouchSite {
  /**
   * The touched domain spans multiple tables (parent+child / relational), so its
   * row keys live in distinct per-table identity spaces. A key-scoped change to
   * one such table cannot be proven to address the canonical single-row identity a
   * reader is instance-keyed by (the touched key is in the mutated table's space,
   * the reader's instance key in the domain's anchor-table space). The runtime must
   * over-invalidate (rerun) every reader of the domain rather than narrow by raw key
   * equality — SPEC §10.1 (over-invalidate when row identity is uncertain); bugz-3 M9.
   */
  crossTable?: true;
  domain: string;
  keys: null | string;
}

/** @internal */
export interface InvalidationRegistryEntry {
  domains: readonly string[];
  keys: Readonly<Record<string, string>> | null;
  query: string;
}

/** @internal */
export type InvalidationRegistry = Readonly<Record<string, readonly InvalidationRegistryEntry[]>>;

/** @internal */
export type MutationTouchRegistry = Readonly<Record<string, readonly InferredMutationTouchSite[]>>;

/** @internal */
export function deriveInvalidationRegistry(input: {
  mutations: readonly MutationTouchInput[];
  queries: readonly InvalidationQueryInput[];
  touchGraph: TouchGraph;
}): InvalidationRegistry {
  const registry: Record<string, InvalidationRegistryEntry[]> = {};

  for (const mutation of input.mutations) {
    const touchEntry = input.touchGraph[mutation.touchGraphKey];
    if (!touchEntry) continue;

    const touchedDomains = touchDomains(touchEntry.touches);
    const entries = input.queries.flatMap((query) => {
      const domains = query.domains.filter((domain) => touchedDomains.has(domain)).sort();
      if (domains.length === 0) return [];

      const keys = keyedInvalidationDomains(domains, query, touchedDomains);
      return [
        {
          domains,
          keys: Object.keys(keys).length > 0 ? keys : null,
          query: query.query,
        },
      ];
    });

    if (entries.length > 0) {
      registry[mutation.mutation] = entries.sort((left, right) =>
        left.query.localeCompare(right.query),
      );
    }
  }

  return registry;
}

/** @internal */
export function deriveMutationTouchRegistry(input: {
  mutations: readonly MutationTouchInput[];
  /**
   * The schema `table -> domain` registry (SPEC §10.1; see `serializeDomainRegistry`'s
   * `tableDomains`). A domain that more than one table maps to is relational/multi-table:
   * its row keys are split across tables with distinct identity spaces, so a key-scoped
   * narrow against a single-row reader's instance key is unsound and each such touch is
   * marked `crossTable` so the runtime over-invalidates the whole domain (bugz-3 M9).
   * Optional for back-compat; when omitted the same relational signal is still recovered
   * for any domain the touch graph itself shows touched/read via more than one table.
   */
  tableDomains?: Readonly<Record<string, string>>;
  touchGraph: TouchGraph;
}): MutationTouchRegistry {
  const multiTableDomains = relationalDomains(input.touchGraph, input.tableDomains);
  const registry: Record<string, InferredMutationTouchSite[]> = {};

  for (const mutation of input.mutations) {
    const touchEntry = input.touchGraph[mutation.touchGraphKey];
    if (!touchEntry) continue;

    const touches = dedupeMutationTouches(
      touchEntry.touches.map((touch) => ({
        domain: touch.domain,
        keys: touch.keys,
        ...(multiTableDomains.has(touch.domain) ? { crossTable: true as const } : {}),
      })),
    );
    if (touches.length > 0) registry[mutation.mutation] = touches;
  }

  return registry;
}

/**
 * @internal Domains whose row identity is split across more than one table
 * (parent+child / relational). Computed from the authoritative schema `tableDomains`
 * map when supplied, unioned with any domain the touch graph itself shows touched or
 * read via more than one table. A key-scoped change to such a domain is NOT a provable
 * single-row identity (the touched table's key space differs from a reader's
 * instance-key space), so the runtime must over-invalidate it (SPEC §10.1; bugz-3 M9).
 */
function relationalDomains(
  touchGraph: TouchGraph,
  tableDomains: Readonly<Record<string, string>> | undefined,
): ReadonlySet<string> {
  const tablesByDomain = new Map<string, Set<string>>();
  const note = (domain: string, table: string | undefined): void => {
    if (table === undefined || table.length === 0) return;
    const tables = tablesByDomain.get(domain) ?? new Set<string>();
    tables.add(table);
    tablesByDomain.set(domain, tables);
  };

  if (tableDomains) {
    for (const [table, domain] of Object.entries(tableDomains)) note(domain, table);
  }
  for (const entry of Object.values(touchGraph)) {
    for (const touch of entry.touches) note(touch.domain, touch.via);
    for (const read of entry.reads ?? []) note(read.domain, read.via);
  }

  const relational = new Set<string>();
  for (const [domain, tables] of tablesByDomain) {
    if (tables.size > 1) relational.add(domain);
  }
  return relational;
}

/** @internal */
export function serializeInvalidationRegistry(
  registry: InvalidationRegistry,
  options: { constName?: string; typeName?: string } = {},
): string {
  const constName = options.constName ?? 'invalidationSets';
  const typeName = options.typeName ?? 'InvalidationSets';
  const lines = [`export const ${constName} = {`];

  for (const [mutation, entries] of Object.entries(registry).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${tsStringLiteral(mutation)}: [`);
    for (const entry of entries) {
      const domains = `[${entry.domains.map((domain) => tsStringLiteral(domain)).join(', ')}]`;
      const keys =
        entry.keys === null
          ? 'null'
          : `{ ${Object.entries(entry.keys)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([domain, key]) => `${tsStringLiteral(domain)}: ${tsStringLiteral(key)}`)
              .join(', ')} }`;
      lines.push(
        `    { query: ${tsStringLiteral(entry.query)}, domains: ${domains}, keys: ${keys} },`,
      );
    }
    lines.push('  ],');
  }

  lines.push('} as const;');
  lines.push('');
  lines.push(`export interface ${typeName} {`);
  for (const [mutation, entries] of Object.entries(registry).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const queryUnion =
      entries
        .map((entry) => entry.query)
        .filter((query, index, queries) => queries.indexOf(query) === index)
        .sort()
        .map((query) => tsStringLiteral(query))
        .join(' | ') || 'never';
    lines.push(`  ${tsStringLiteral(mutation)}: ${queryUnion};`);
  }
  lines.push('}');

  return `${lines.join('\n')}\n`;
}

/** @internal */
export function serializeMutationTouchRegistry(
  registry: MutationTouchRegistry,
  options: { constName?: string; typeName?: string } = {},
): string {
  const constName = options.constName ?? 'mutationInferredTouches';
  const typeName = options.typeName ?? 'MutationInferredTouches';
  const lines = [`export const ${constName} = {`];

  for (const [mutation, touches] of Object.entries(registry).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${tsStringLiteral(mutation)}: [`);
    for (const touch of touches) {
      // bugz-3 M9: emit `crossTable` so the runtime over-invalidates relational
      // domains instead of narrowing by raw key equality (SPEC §10.1).
      const crossTable = touch.crossTable ? ', crossTable: true' : '';
      lines.push(
        `    { domain: ${tsStringLiteral(touch.domain)}, keys: ${tsNullableStringLiteral(
          touch.keys,
        )}${crossTable} },`,
      );
    }
    lines.push('  ],');
  }

  lines.push('} as const;');
  lines.push('');
  lines.push(`export interface ${typeName} {`);
  for (const mutation of Object.keys(registry).sort((left, right) => left.localeCompare(right))) {
    lines.push(
      `  ${tsStringLiteral(mutation)}: typeof ${constName}[${tsStringLiteral(mutation)}];`,
    );
  }
  lines.push('}');

  return `${lines.join('\n')}\n`;
}

function tsStringLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function tsNullableStringLiteral(value: null | string): string {
  return value === null ? 'null' : tsStringLiteral(value);
}

function dedupeMutationTouches(
  touches: readonly InferredMutationTouchSite[],
): InferredMutationTouchSite[] {
  const seen = new Set<string>();
  const deduped: InferredMutationTouchSite[] = [];

  for (const touch of touches) {
    const key = `${touch.domain}\0${touch.keys ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(touch);
  }

  return deduped;
}

function touchDomains(touches: readonly TouchSite[]): Map<string, readonly TouchSite[]> {
  const domains = new Map<string, TouchSite[]>();

  for (const touch of touches) {
    const current = domains.get(touch.domain);
    if (current) {
      current.push(touch);
    } else {
      domains.set(touch.domain, [touch]);
    }
  }

  return domains;
}

function keyedInvalidationDomains(
  domains: readonly string[],
  query: InvalidationQueryInput,
  touchedDomains: ReadonlyMap<string, readonly TouchSite[]>,
): Record<string, string> {
  const keys: Record<string, string> = {};

  for (const domain of domains) {
    if (query.instanceKey?.domain !== domain) continue;

    const key = rowKeyForDomain(touchedDomains.get(domain) ?? []);
    if (key) keys[domain] = key;
  }

  return keys;
}

function rowKeyForDomain(touches: readonly TouchSite[]): string | undefined {
  if (touches.length === 0) return undefined;
  if (touches.some((touch) => touch.keys === null)) return undefined;

  const keys = [...new Set(touches.map((touch) => touch.keys).filter((key) => key !== null))];
  return keys.length === 1 ? keys[0] : undefined;
}
