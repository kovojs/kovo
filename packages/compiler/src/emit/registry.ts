import { jsStringLiteral } from '@kovojs/core/internal/emission';

import type { ComponentCssAsset } from '../css.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapSet,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerSetOwnDataProperty,
  compilerSnapshotDenseArray,
  compilerStringLocaleCompare,
} from '../compiler-security-intrinsics.js';
import { compilerIrHeader } from '../ir.js';
import type { PlatformSubstitution } from '../lower/platform.js';
import type {
  FragmentTargetFact,
  HandlerLowering,
  LiveTargetFact,
  QueryUpdatePlanFact,
  QueryShapeFact,
  RegistryFacts,
  RegistryTypeFacts,
  ViewTransitionStamp,
} from '../types.js';
import { queryShapeRegistryTypeFacts, queryShapesFromFacts } from '../types.js';

export interface EmitRegistryModuleOptions {
  clientFileName: string;
  cssAssets: readonly ComponentCssAsset[];
  componentName: string;
  componentRegistryNames?: readonly string[];
  domComponentName: string;
  fragmentTargetFacts: readonly FragmentTargetFact[];
  handlers: readonly Pick<HandlerLowering, 'exportName'>[];
  liveTargetFacts: readonly LiveTargetFact[];
  platformSubstitutions: readonly PlatformSubstitution[];
  queryShapeFacts?: readonly QueryShapeFact[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  refusedQueryNames?: readonly string[];
  registryFacts?: RegistryFacts;
  registryComponentName: string;
  viewTransitions: readonly ViewTransitionStamp[];
}

export function emitRegistryModule(options: EmitRegistryModuleOptions): string {
  const handlerModuleLine =
    compilerArrayLength(options.handlers, 'Registry handlers') > 0
      ? `  ${jsStringLiteral(`#${options.domComponentName}`)}: typeof import(${jsStringLiteral(`../${options.clientFileName}`)});`
      : '';
  const fragmentTargetLines = registryMappedLines(
    options.fragmentTargetFacts,
    (fact) => `  ${jsStringLiteral(fact.target)}: ${fact.propsType};`,
    'Registry fragment targets',
  );
  const liveTargetFacts: LiveTargetFact[] = [];
  appendRegistryValues(liveTargetFacts, options.liveTargetFacts, 'Registry live targets');
  appendRegistryValues(
    liveTargetFacts,
    options.registryFacts?.liveTargets ?? [],
    'Graph live targets',
  );
  const liveTargetLines = liveTargetFactLines(liveTargetFacts);
  const platformSubstitutionLines = registryMappedLines(
    options.platformSubstitutions,
    (substitution) =>
      `  ${jsStringLiteral(`${options.registryComponentName}:${substitution.tag}:${substitution.event}:${substitution.target}`)}: ${jsStringLiteral(`${substitution.kind}:${substitution.action}`)};`,
    'Registry platform substitutions',
  );
  const viewTransitionLines = registryMappedLines(
    options.viewTransitions,
    (stamp) => `  ${jsStringLiteral(stamp.name)}: unknown;`,
    'Registry view transitions',
  );
  const queryUpdatePlanLines = registryMappedLines(
    options.queryUpdatePlans,
    (plan) =>
      `  ${jsStringLiteral(`${plan.componentName}:${plan.query}`)}: ${registryReadonlyStringTuple(plan.paths, 'Registry query-update paths')};`,
    'Registry query update plans',
  );
  const componentRegistryNames: string[] = [];
  compilerArrayAppend(
    componentRegistryNames,
    options.registryComponentName,
    'Registry component names',
  );
  appendRegistryValues(
    componentRegistryNames,
    options.componentRegistryNames ?? [],
    'Registry component names',
  );
  appendRegistryValues(
    componentRegistryNames,
    options.registryFacts?.components ?? [],
    'Graph component names',
  );
  const componentRegistryLines = componentRegistryFactLines(componentRegistryNames);
  const stylesheetLines = registryMappedLines(
    options.cssAssets,
    componentStylesheetLine,
    'Registry CSS assets',
  );
  const styleRuleLineParts: string[] = [];
  const cssAssets = compilerSnapshotDenseArray(options.cssAssets, 'Registry CSS assets');
  for (let assetIndex = 0; assetIndex < cssAssets.length; assetIndex += 1) {
    appendRegistryValues(
      styleRuleLineParts,
      componentStyleRuleLines(cssAssets[assetIndex]!),
      'Registry style-rule lines',
    );
  }
  const styleRuleLines = compilerArrayJoin(styleRuleLineParts, '\n');
  const queryTypeFacts = compilerCreateNullRecord<string>();
  const refusedQueryNames = compilerCreateSet<string>();
  const refusedQueryNameSnapshot = compilerSnapshotDenseArray(
    options.refusedQueryNames ?? [],
    'Registry refused query names',
  );
  for (let index = 0; index < refusedQueryNameSnapshot.length; index += 1) {
    compilerSetAdd(refusedQueryNames, refusedQueryNameSnapshot[index]!);
  }
  if (options.queryShapeFacts) {
    appendRegistryTypeFacts(
      queryTypeFacts,
      queryShapeRegistryTypeFacts(queryShapesFromFacts(options.queryShapeFacts)),
      refusedQueryNames,
    );
  }
  appendRegistryTypeFacts(queryTypeFacts, options.registryFacts?.queries, refusedQueryNames);
  const queryRegistryLines = registryTypeFactLines(queryTypeFacts);
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

export interface OptimisticDerivationSets {

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

  interface OptimisticDerivationSets {

  }
}

export type DomainKey = ${domainKey};
`;
}

function appendRegistryValues<Value>(
  target: Value[],
  values: readonly Value[],
  label: string,
): void {
  const snapshot = compilerSnapshotDenseArray(values, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, label);
  }
}

function registryMappedLines<Value>(
  values: readonly Value[],
  render: (value: Value) => string,
  label: string,
): string {
  const snapshot = compilerSnapshotDenseArray(values, label);
  const lines: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(lines, render(snapshot[index]!), `${label} lines`);
  }
  return compilerArrayJoin(lines, '\n');
}

function registryReadonlyStringTuple(values: readonly string[], label: string): string {
  const snapshot = compilerSnapshotDenseArray(values, label);
  if (snapshot.length === 0) return 'readonly []';
  const entries: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(entries, jsStringLiteral(snapshot[index]!), `${label} literals`);
  }
  return `readonly [${compilerArrayJoin(entries, ', ')}]`;
}

function registryReadonlyFactTuple<Value>(
  values: readonly Value[],
  render: (value: Value) => string,
  label: string,
): string {
  const snapshot = compilerSnapshotDenseArray(values, label);
  if (snapshot.length === 0) return 'readonly []';
  const entries: string[] = [];
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(entries, render(snapshot[index]!), `${label} literals`);
  }
  return `readonly [${compilerArrayJoin(entries, ', ')}]`;
}

function registryJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) throw new TypeError(`${label} must be JSON-serializable.`);
  return source;
}

function stableSortRegistryValues<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const sorted = compilerSnapshotDenseArray(values, label);
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    let insertion = index;
    while (insertion > 0 && compare(value, sorted[insertion - 1]!) < 0) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}

function uniqueSortedRegistryStrings(
  values: readonly string[],
  label: string,
  compare: (left: string, right: string) => number = compilerStringLocaleCompare,
): string[] {
  const source = compilerSnapshotDenseArray(values, label);
  const seen = compilerCreateSet<string>();
  const unique: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index]!;
    if (compilerSetHas(seen, value)) continue;
    compilerSetAdd(seen, value);
    compilerArrayAppend(unique, value, `${label} unique values`);
  }
  return stableSortRegistryValues(unique, compare, `${label} sorted values`);
}

function compareRegistryCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function appendRegistryTypeFacts(
  target: Record<string, string>,
  facts: RegistryTypeFacts | undefined,
  refusedKeys: ReadonlySet<string> = compilerCreateSet<string>(),
): void {
  if (facts === undefined) return;
  const keys = compilerObjectKeys(facts);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (compilerSetHas(refusedKeys, key)) continue;
    const value = compilerOwnDataValue(facts, key, 'Registry type facts');
    if (typeof value !== 'string')
      throw new TypeError(`Registry type fact ${key} must be a string.`);
    compilerSetOwnDataProperty(target, key, value);
  }
}

function componentStylesheetLine(asset: ComponentCssAsset): string {
  return `  ${jsStringLiteral(asset.componentName)}: { href: ${jsStringLiteral(asset.href)}; sourceFileName: ${jsStringLiteral(asset.sourceFileName)}; fragmentTargets: ${registryReadonlyStringTuple(asset.fragmentTargets, 'Stylesheet fragment targets')}; };`;
}

function componentStyleRuleLines(asset: ComponentCssAsset): string[] {
  const usages = stableSortRegistryValues(
    asset.styleRuleUsages ?? [],
    (left, right) =>
      compilerStringLocaleCompare(left.className, right.className) ||
      compilerStringLocaleCompare(left.styleRef, right.styleRef) ||
      compilerStringLocaleCompare(left.source, right.source),
    'Registry component style-rule usages',
  );
  const lines: string[] = [];
  for (let index = 0; index < usages.length; index += 1) {
    const usage = usages[index]!;
    compilerArrayAppend(
      lines,
      `  ${jsStringLiteral(usage.className)}: { component: ${jsStringLiteral(asset.componentName)}; source: ${jsStringLiteral(usage.source)}; styleRef: ${jsStringLiteral(usage.styleRef)}; moduleFileName: ${jsStringLiteral(usage.moduleFileName)}; };`,
      'Registry component style-rule lines',
    );
  }
  return lines;
}

function registryTypeFactLines(facts: RegistryTypeFacts | undefined): string {
  if (facts === undefined) return '';
  const keys = stableSortRegistryValues(
    compilerObjectKeys(facts),
    compilerStringLocaleCompare,
    'Registry type-fact keys',
  );
  const lines: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const typeExpression = compilerOwnDataValue(facts, key, 'Registry type facts');
    if (typeof typeExpression !== 'string') {
      throw new TypeError(`Registry type fact ${key} must be a string.`);
    }
    compilerArrayAppend(
      lines,
      `  ${jsStringLiteral(key)}: ${typeExpression};`,
      'Registry type-fact lines',
    );
  }
  return compilerArrayJoin(lines, '\n');
}

function liveTargetFactLines(facts: readonly LiveTargetFact[]): string {
  const source = compilerSnapshotDenseArray(facts, 'Registry live-target facts');
  const byTarget = compilerCreateMap<string, LiveTargetFact>();
  for (let index = 0; index < source.length; index += 1) {
    const fact = source[index]!;
    compilerMapSet(byTarget, fact.target, fact);
  }
  const unique: LiveTargetFact[] = [];
  compilerMapForEach(byTarget, (fact) => {
    compilerArrayAppend(unique, fact, 'Registry unique live-target facts');
  });
  const sorted = stableSortRegistryValues(
    unique,
    (left, right) => compilerStringLocaleCompare(left.target, right.target),
    'Registry sorted live-target facts',
  );
  const lines: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const fact = sorted[index]!;
    const queries = registryReadonlyStringTuple(fact.queries, 'Live-target queries');
    const queryBindings = registryReadonlyFactTuple(
      fact.queryBindings,
      liveTargetQueryBindingFact,
      'Live-target query bindings',
    );
    const identityProps = registryReadonlyStringTuple(
      fact.identityProps,
      'Live-target identity props',
    );
    const coverage = registryReadonlyFactTuple(
      fact.coverage,
      liveTargetCoverageFact,
      'Live-target coverage',
    );
    compilerArrayAppend(
      lines,
      `  ${jsStringLiteral(fact.target)}: { component: ${jsStringLiteral(fact.component)}; targetBase: ${jsStringLiteral(fact.targetBase)}; identityProps: ${identityProps}; queries: ${queries}; queryBindings: ${queryBindings}; props: ${fact.propsType}; coverage: ${coverage}; };`,
      'Registry live-target lines',
    );
  }
  return compilerArrayJoin(lines, '\n');
}

function liveTargetCoverageFact(fact: LiveTargetFact['coverage'][number]): string {
  return `{ query: ${jsStringLiteral(fact.query)}; position: ${registryJsonSource(fact.position, 'Live-target coverage position')}; status: ${jsStringLiteral(fact.status)} }`;
}

function liveTargetQueryBindingFact(fact: LiveTargetFact['queryBindings'][number]): string {
  return `{ name: ${jsStringLiteral(fact.name)}; queryExpression: ${registryJsonSource(fact.queryExpression, 'Live-target query expression')}${
    fact.argsExpression === undefined
      ? ''
      : `; argsExpression: ${registryJsonSource(fact.argsExpression, 'Live-target args expression')}`
  }${fact.argsParam === undefined ? '' : `; argsParam: ${jsStringLiteral(fact.argsParam)}`}${
    fact.argsPropertyAccesses === undefined
      ? ''
      : `; argsPropertyAccesses: ${registryReadonlyStringTuple(fact.argsPropertyAccesses, 'Live-target args property accesses')}`
  }${fact.hasRefresh === true ? '; hasRefresh: true' : ''} }`;
}

function componentRegistryFactLines(componentNames: readonly string[]): string {
  const names = uniqueSortedRegistryStrings(componentNames, 'Registry component names');
  return registryMappedLines(
    names,
    (componentName) =>
      `  ${jsStringLiteral(componentName)}: import('@kovojs/core').Component<import('@kovojs/core').ComponentDefinitionInput>;`,
    'Registry component names',
  );
}

function routeRegistryFactLines(routes: readonly string[] | undefined): string {
  const paths = uniqueSortedRegistryStrings(routes ?? [], 'Registry route paths');
  return registryMappedLines(
    paths,
    (routePath) =>
      `  ${jsStringLiteral(routePath)}: import('@kovojs/core').Route<${jsStringLiteral(routePath)}>;`,
    'Registry route paths',
  );
}

function invalidationSetFactLines(
  invalidations: Readonly<Record<string, readonly string[]>> | undefined,
): string {
  if (invalidations === undefined) return '';
  const mutationKeys = stableSortRegistryValues(
    compilerObjectKeys(invalidations),
    compilerStringLocaleCompare,
    'Registry invalidation mutation keys',
  );
  const lines: string[] = [];
  for (let index = 0; index < mutationKeys.length; index += 1) {
    const mutationKey = mutationKeys[index]!;
    const rawQueryKeys = compilerOwnDataValue(
      invalidations,
      mutationKey,
      'Registry invalidation sets',
    );
    if (!compilerArrayIsArray(rawQueryKeys)) {
      throw new TypeError(`Registry invalidation set ${mutationKey} must be an array.`);
    }
    const queryKeys = uniqueSortedRegistryStrings(
      rawQueryKeys as string[],
      `Registry invalidation queries for ${mutationKey}`,
      compareRegistryCodeUnits,
    );
    const queryLiterals: string[] = [];
    for (let queryIndex = 0; queryIndex < queryKeys.length; queryIndex += 1) {
      compilerArrayAppend(
        queryLiterals,
        jsStringLiteral(queryKeys[queryIndex]!),
        'Registry invalidation query literals',
      );
    }
    compilerArrayAppend(
      lines,
      `  ${jsStringLiteral(mutationKey)}: ${queryLiterals.length === 0 ? 'never' : compilerArrayJoin(queryLiterals, ' | ')};`,
      'Registry invalidation lines',
    );
  }
  return compilerArrayJoin(lines, '\n');
}

function registryDomainKey(domainKeys: readonly string[] | undefined): string {
  const keys = uniqueSortedRegistryStrings(
    domainKeys ?? [],
    'Registry domain keys',
    compareRegistryCodeUnits,
  );
  const literals: string[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    compilerArrayAppend(
      literals,
      registryJsonSource(keys[index]!, 'Registry domain key'),
      'Registry domain key literals',
    );
  }
  return literals.length === 0 ? 'never' : compilerArrayJoin(literals, ' | ');
}
