import type { TouchGraph, TouchSite } from '@kovojs/core';

export interface InvalidationQueryInput {
  domains: readonly string[];
  instanceKey?: {
    domain: string;
    key: string;
  };
  query: string;
}

export interface MutationTouchInput {
  mutation: string;
  touchGraphKey: string;
}

export interface InvalidationRegistryEntry {
  domains: readonly string[];
  keys: Readonly<Record<string, string>> | null;
  query: string;
}

export type InvalidationRegistry = Readonly<Record<string, readonly InvalidationRegistryEntry[]>>;

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

function tsStringLiteral(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
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
