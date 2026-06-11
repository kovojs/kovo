import type { ComponentExplain, FwExplainInput } from '@jiso/core';

import { kebabCase } from './shared.ts';
import {
  componentOptionObjectEntries,
  componentOptionObjectKeys,
  componentOptionSource,
  firstComponentModel,
  parseComponentModule as parseComponentModuleModel,
  type ComponentModuleModel,
} from './scan/parse.js';

export type ComponentGraphFact = Pick<ComponentExplain, 'fragments' | 'name' | 'queries'>;

export interface FragmentTargetFact {
  propsType: string;
  target: string;
}

export interface RegistryFacts {
  components?: readonly string[];
  domainKeys?: readonly string[];
  invalidations?: Readonly<Record<string, readonly string[]>>;
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
  routes?: readonly string[];
}

export type RegistryTypeFacts = Readonly<Record<string, string>>;

export type RegistryGraphInput = Pick<
  FwExplainInput,
  'components' | 'mutations' | 'pages' | 'queries'
>;

interface CompileGraphComponentInput {
  componentGraphFacts: readonly ComponentGraphFact[];
}

export interface RegistryTypeFactOptions {
  mutations?: RegistryTypeFacts;
  queries?: RegistryTypeFacts;
}

export interface CompileAppGraphOptions {
  components?: readonly CompileGraphComponentInput[];
  graph?: RegistryGraphInput;
  registryTypes?: RegistryTypeFactOptions;
}

export interface CompileAppGraphResult {
  graph: RegistryGraphInput;
  registryFacts: RegistryFacts;
}

export function deriveAppGraph(options: CompileAppGraphOptions): CompileAppGraphResult {
  const graph: RegistryGraphInput = {
    ...options.graph,
    components: [
      ...(options.graph?.components ?? []),
      ...(options.components ?? []).flatMap((component) => component.componentGraphFacts),
    ],
  };

  return {
    graph,
    registryFacts: deriveRegistryFactsFromGraph(graph, options.registryTypes),
  };
}

export function findFragmentTargetFacts(
  source: string,
  componentName: string,
): FragmentTargetFact[] {
  const model = parseComponentModuleModel('component.tsx', source);
  const fragmentTarget = componentOptionSource(model, 'fragmentTarget');
  if (fragmentTarget !== 'true') return [];

  const explicitName = firstComponentModel(model)?.explicitName;
  return [
    {
      propsType: fragmentTargetPropsType(source),
      target: explicitName ?? kebabCase(componentName),
    },
  ];
}

export function componentGraphFact(
  componentName: string,
  model: ComponentModuleModel,
  fragmentTargets: readonly string[],
): ComponentGraphFact {
  const queries = componentQueryNames(model);

  return {
    ...(fragmentTargets.length === 0 ? {} : { fragments: fragmentTargets }),
    name: componentName,
    ...(queries.length === 0 ? {} : { queries }),
  };
}

export function deriveRegistryFactsFromGraph(
  graph: RegistryGraphInput,
  options: RegistryTypeFactOptions = {},
): RegistryFacts {
  const components = deriveComponentFactsFromGraph(graph);

  return {
    ...(components.length > 0 ? { components } : {}),
    domainKeys: deriveDomainKeysFromGraph(graph),
    invalidations: deriveInvalidationFactsFromGraph(graph),
    ...(Object.keys(options.mutations ?? {}).length > 0 ? { mutations: options.mutations } : {}),
    ...(Object.keys(options.queries ?? {}).length > 0 ? { queries: options.queries } : {}),
    routes: [...new Set((graph.pages ?? []).map((page) => page.route))].sort(),
  };
}

function deriveDomainKeysFromGraph(graph: RegistryGraphInput): string[] {
  return [
    ...(graph.queries ?? []).flatMap((query) => query.domains),
    ...(graph.mutations ?? []).flatMap((mutation) => mutation.writes ?? []),
    ...(graph.mutations ?? []).flatMap((mutation) => mutation.invalidates ?? []),
  ]
    .filter((key, index, keys) => keys.indexOf(key) === index)
    .sort((left, right) => left.localeCompare(right));
}

function deriveComponentFactsFromGraph(graph: RegistryGraphInput): string[] {
  return [...new Set((graph.components ?? []).map((component) => kebabCase(component.name)))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function componentQueryNames(model: ComponentModuleModel): string[] {
  return componentOptionObjectKeys(model, 'queries');
}

function fragmentTargetPropsType(source: string): string {
  const model = parseComponentModuleModel('component.tsx', source);

  const props = componentOptionObjectEntries(model, 'props')
    .map((entry) => ({
      key: entry.key,
      type: entry.value ? propConstructorType(entry.value) : undefined,
    }))
    .filter((entry): entry is { key: string; type: string } => entry.type !== undefined);

  if (props.length === 0) return '{}';

  return `{ ${props.map((prop) => `${prop.key}: ${prop.type}`).join('; ')} }`;
}

function propConstructorType(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === 'String') return 'string';
  if (trimmed === 'Number') return 'number';
  if (trimmed === 'Boolean') return 'boolean';
  return undefined;
}

function deriveInvalidationFactsFromGraph(
  graph: RegistryGraphInput,
): Readonly<Record<string, readonly string[]>> {
  const queries = graph.queries ?? [];
  const invalidations: Record<string, string[]> = {};

  for (const mutation of graph.mutations ?? []) {
    const invalidatedDomains = mutation.invalidates ?? mutation.writes ?? [];
    const invalidatedQueries = queries
      .filter((query) => query.domains.some((domain) => invalidatedDomains.includes(domain)))
      .map((query) => query.query);

    if (invalidatedQueries.length > 0) {
      invalidations[mutation.key] = [...new Set(invalidatedQueries)].sort();
    }
  }

  return invalidations;
}
