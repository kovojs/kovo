import type { ComponentCssAsset } from '../css.js';
import { compilerIrHeader } from '../ir.js';
import type { PlatformSubstitution } from '../lower/platform.js';
import type {
  FragmentTargetFact,
  HandlerLowering,
  LiveTargetFact,
  QueryUpdatePlanFact,
  RegistryFacts,
  RegistryTypeFacts,
  ViewTransitionStamp,
} from '../types.js';

export interface EmitRegistryModuleOptions {
  clientFileName: string;
  cssAssets: readonly ComponentCssAsset[];
  componentName: string;
  domComponentName: string;
  fragmentTargetFacts: readonly FragmentTargetFact[];
  handlers: readonly Pick<HandlerLowering, 'exportName'>[];
  liveTargetFacts: readonly LiveTargetFact[];
  platformSubstitutions: readonly PlatformSubstitution[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  registryFacts?: RegistryFacts;
  registryComponentName: string;
  viewTransitions: readonly ViewTransitionStamp[];
}

export function emitRegistryModule(options: EmitRegistryModuleOptions): string {
  const handlerModuleLine = options.handlers.length
    ? `  '#${options.domComponentName}': typeof import('../${options.clientFileName}');`
    : '';
  const fragmentTargetLines = options.fragmentTargetFacts
    .map((fact) => `  '${fact.target}': ${fact.propsType};`)
    .join('\n');
  const liveTargetLines = liveTargetFactLines([
    ...options.liveTargetFacts,
    ...(options.registryFacts?.liveTargets ?? []),
  ]);
  const platformSubstitutionLines = options.platformSubstitutions
    .map(
      (substitution) =>
        `  '${options.registryComponentName}:${substitution.tag}:${substitution.event}:${substitution.target}': '${substitution.kind}:${substitution.action}';`,
    )
    .join('\n');
  const viewTransitionLines = options.viewTransitions
    .map((stamp) => `  '${stamp.name}': unknown;`)
    .join('\n');
  const queryUpdatePlanLines = options.queryUpdatePlans
    .map(
      (plan) =>
        `  '${plan.componentName}:${plan.query}': readonly [${plan.paths.map((path) => `'${path}'`).join(', ')}];`,
    )
    .join('\n');
  const componentRegistryLines = componentRegistryFactLines([
    options.registryComponentName,
    ...(options.registryFacts?.components ?? []),
  ]);
  const stylesheetLines = options.cssAssets.map(componentStylesheetLine).join('\n');
  const styleRuleLines = options.cssAssets.flatMap(componentStyleRuleLines).join('\n');
  const queryRegistryLines = registryTypeFactLines(options.registryFacts?.queries);
  const mutationRegistryLines = registryTypeFactLines(options.registryFacts?.mutations);
  const routeRegistryLines = routeRegistryFactLines(options.registryFacts?.routes);
  const invalidationSetLines = invalidationSetFactLines(options.registryFacts?.invalidations);
  const domainKey = registryDomainKey(options.registryFacts?.domainKeys);

  return `${compilerIrHeader}
export interface HandlerModules {
${handlerModuleLine}
}

export interface FragmentTargets {
${fragmentTargetLines}
}

export interface LiveTargetRegistry {
${liveTargetLines}
}

export interface PlatformSubstitutions {
${platformSubstitutionLines}
}

export interface ViewTransitions {
${viewTransitionLines}
}

export interface QueryUpdatePlans {
${queryUpdatePlanLines}
}

export interface ComponentStylesheets {
${stylesheetLines}
}

export interface ComponentStyleRules {
${styleRuleLines}
}

export interface ComponentRegistry {
${componentRegistryLines}
}

export interface QueryRegistry {
${queryRegistryLines}
}

export interface MutationRegistry {
${mutationRegistryLines}
}

export interface RouteRegistry {
${routeRegistryLines}
}

export interface InvalidationSets {
${invalidationSetLines}
}

declare module '@kovojs/core/generated' {
  interface ComponentRegistry {
${componentRegistryLines}
  }

  interface FragmentTargets {
${fragmentTargetLines}
  }

  interface LiveTargetRegistry {
${liveTargetLines}
  }
}

declare module '@kovojs/core' {
  interface QueryRegistry {
${queryRegistryLines}
  }

  interface MutationRegistry {
${mutationRegistryLines}
  }

  interface RouteRegistry {
${routeRegistryLines}
  }

  interface InvalidationSets {
${invalidationSetLines}
  }
}

export type DomainKey = ${domainKey};
`;
}

function componentStylesheetLine(asset: ComponentCssAsset): string {
  const fragmentTargets =
    asset.fragmentTargets.length === 0
      ? 'readonly []'
      : `readonly [${asset.fragmentTargets.map((target) => `'${target}'`).join(', ')}]`;
  return `  '${asset.componentName}': { href: '${asset.href}'; sourceFileName: '${asset.sourceFileName}'; fragmentTargets: ${fragmentTargets}; };`;
}

function componentStyleRuleLines(asset: ComponentCssAsset): string[] {
  return (asset.styleRuleUsages ?? [])
    .slice()
    .sort(
      (left, right) =>
        left.className.localeCompare(right.className) ||
        left.styleRef.localeCompare(right.styleRef) ||
        left.source.localeCompare(right.source),
    )
    .map(
      (usage) =>
        `  '${usage.className}': { component: '${asset.componentName}'; source: '${usage.source}'; styleRef: '${usage.styleRef}'; moduleFileName: '${usage.moduleFileName}'; };`,
    );
}

function registryTypeFactLines(facts: RegistryTypeFacts | undefined): string {
  return Object.entries(facts ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, typeExpression]) => `  '${key}': ${typeExpression};`)
    .join('\n');
}

function liveTargetFactLines(facts: readonly LiveTargetFact[]): string {
  const byTarget = new Map<string, LiveTargetFact>();
  for (const fact of facts) {
    byTarget.set(fact.target, fact);
  }

  return [...byTarget.values()]
    .sort((left, right) => left.target.localeCompare(right.target))
    .map((fact) => {
      const queries =
        fact.queries.length === 0
          ? 'readonly []'
          : `readonly [${fact.queries.map((query) => `'${query}'`).join(', ')}]`;
      const queryBindings =
        fact.queryBindings.length === 0
          ? 'readonly []'
          : `readonly [${fact.queryBindings.map(liveTargetQueryBindingFact).join(', ')}]`;
      const identityProps =
        fact.identityProps.length === 0
          ? 'readonly []'
          : `readonly [${fact.identityProps.map((prop) => `'${prop}'`).join(', ')}]`;
      const coverage =
        fact.coverage.length === 0
          ? 'readonly []'
          : `readonly [${fact.coverage.map(liveTargetCoverageFact).join(', ')}]`;
      return `  '${fact.target}': { component: '${fact.component}'; targetBase: '${fact.targetBase}'; identityProps: ${identityProps}; queries: ${queries}; queryBindings: ${queryBindings}; props: ${fact.propsType}; coverage: ${coverage}; };`;
    })
    .join('\n');
}

function liveTargetCoverageFact(fact: LiveTargetFact['coverage'][number]): string {
  return `{ query: '${fact.query}'; position: ${JSON.stringify(fact.position)}; status: '${fact.status}' }`;
}

function liveTargetQueryBindingFact(fact: LiveTargetFact['queryBindings'][number]): string {
  return `{ name: '${fact.name}'; queryExpression: ${JSON.stringify(fact.queryExpression)}${
    fact.argsExpression === undefined
      ? ''
      : `; argsExpression: ${JSON.stringify(fact.argsExpression)}`
  }${fact.argsParam === undefined ? '' : `; argsParam: '${fact.argsParam}'`}${
    fact.argsPropertyAccesses === undefined
      ? ''
      : `; argsPropertyAccesses: readonly [${fact.argsPropertyAccesses
          .map((path) => `'${path}'`)
          .join(', ')}]`
  } }`;
}

function componentRegistryFactLines(componentNames: readonly string[]): string {
  return [...new Set(componentNames)]
    .sort((left, right) => left.localeCompare(right))
    .map(
      (componentName) =>
        `  '${componentName}': import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;`,
    )
    .join('\n');
}

function routeRegistryFactLines(routes: readonly string[] | undefined): string {
  return [...new Set(routes ?? [])]
    .sort((left, right) => left.localeCompare(right))
    .map((routePath) => `  '${routePath}': import('@kovojs/core').Route<'${routePath}'>;`)
    .join('\n');
}

function invalidationSetFactLines(
  invalidations: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  return Object.entries(invalidations ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([mutationKey, queryKeys]) => {
      const queryUnion =
        [...new Set(queryKeys)]
          .sort()
          .map((queryKey) => `'${queryKey}'`)
          .join(' | ') || 'never';
      return `  '${mutationKey}': ${queryUnion};`;
    })
    .join('\n');
}

function registryDomainKey(domainKeys: readonly string[] | undefined): string {
  const keys = [...new Set(domainKeys ?? [])].sort();
  return keys.map((key) => JSON.stringify(key)).join(' | ') || 'never';
}
