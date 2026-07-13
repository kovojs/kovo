import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  buildOwnDataProperty,
  buildSecuritySourceLiteral,
  commitBuildArrayValue,
  freezeBuildSecurityValue,
  snapshotBuildArray,
} from '../build-security-intrinsics.ts';
import { securityArraySort } from '../response-security-intrinsics.ts';
import {
  createWitnessSet,
  witnessCreateNullRecord,
  witnessDefineProperty,
  witnessIsArray,
  witnessObjectKeys,
  witnessSetAdd,
  witnessSetHas,
  witnessSortStrings,
} from '../security-witness-intrinsics.ts';

/** @internal Runtime mutation-touch fact serialized into dev/prod registry modules. */
export interface RuntimeRegistryMutationTouchSite {
  crossTable?: true;
  domain: string;
  keys: null | string;
}

/** @internal Runtime query-read fact serialized into dev/prod registry modules. */
export interface RuntimeRegistryQueryReadFact {
  domains: readonly string[];
  query: string;
}

/** @internal Compiler-derived authorization classifications for a physical table. */
export type RuntimeTableSecurityAuthorizationClassification =
  | 'authzPolicy'
  | 'owned'
  | 'ownedVia'
  | 'public'
  | 'reference';

/** @internal Compiler-derived physical/selection column identity. */
export interface RuntimeTableSecurityWireColumn {
  key: string;
  name: string;
}

/** @internal Compiler-derived direct owner source. */
export interface RuntimeTableSecurityWireOwner {
  columnKey: string;
  columnName: string;
}

/** @internal Compiler-derived transitive owner source. */
export interface RuntimeTableSecurityWireOwnerVia {
  fkColumnKey: string;
  fkColumnName: string;
  parentKeyColumnKey: string;
  parentKeyColumnName: string;
  parentTable: string;
}

/** @internal Compiler-derived security facts for one physical table. */
export interface RuntimeTableSecurityWireTable {
  authorizationClassifications: readonly RuntimeTableSecurityAuthorizationClassification[];
  columns: readonly RuntimeTableSecurityWireColumn[];
  governedColumnKeys: readonly string[];
  name: string;
  owner?: RuntimeTableSecurityWireOwner;
  ownerVia?: RuntimeTableSecurityWireOwnerVia;
  secretColumnKeys: readonly string[];
  secretDeclared: boolean;
}

/** @internal Compiler-owned table-security manifest serialized ahead of app evaluation. */
export interface RuntimeTableSecurityWireManifest {
  tables: readonly RuntimeTableSecurityWireTable[];
}

/** @internal Runtime registry wire schema shared by Vite dev and CLI build/export. */
export interface RuntimeRegistryWireFacts {
  mutationTouches: Readonly<Record<string, readonly RuntimeRegistryMutationTouchSite[]>>;
  queryReads: readonly RuntimeRegistryQueryReadFact[];
  tableSecurity?: RuntimeTableSecurityWireManifest;
}

/** @internal Project static facts with enough shape to project runtime registry reads. */
export interface RuntimeRegistryQueryFactLike {
  domains?: readonly unknown[];
  reads?: readonly unknown[];
  query?: unknown;
}

/** @internal Project static facts with enough shape to project runtime registry touches. */
export interface RuntimeRegistryTouchGraphLike {
  touchGraph?: CoreGraph.TouchGraph;
}

/**
 * @internal Derive runtime query-read facts from producer-owned query facts (SPEC §§6.1, 9.4).
 *
 * Build analysis and evaluated app modules share a realm. Consume the graph only through pinned,
 * own-data controls so app code cannot erase read authority with Array callbacks/iterators or
 * mutate a retained graph carrier while the runtime module is projected (SPEC §6.6/§10.3 C9/C15).
 */
export function runtimeRegistryQueryReadsFromFacts(
  queryFacts: readonly RuntimeRegistryQueryFactLike[],
): RuntimeRegistryWireFacts['queryReads'] {
  const facts = snapshotBuildArray(queryFacts, 'runtime registry query facts');
  const reads: RuntimeRegistryQueryReadFact[] = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    if (fact === null || typeof fact !== 'object') continue;
    const query = buildOwnDataProperty(fact, 'query', 'runtime registry query fact.query');
    const declaredReads = buildOwnDataProperty(fact, 'reads', 'runtime registry query fact.reads');
    const declaredDomains = buildOwnDataProperty(
      fact,
      'domains',
      'runtime registry query fact.domains',
    );
    const sourceDomains =
      declaredReads.present && declaredReads.value !== undefined
        ? declaredReads.value
        : declaredDomains.present
          ? declaredDomains.value
          : undefined;
    const queryKey = query.present ? query.value : undefined;
    if (typeof queryKey !== 'string' || !witnessIsArray(sourceDomains)) continue;

    const domainValues = snapshotBuildArray(sourceDomains, 'runtime registry query domains');
    if (domainValues.length === 0) continue;
    const domains: string[] = [];
    let valid = true;
    for (let domainIndex = 0; domainIndex < domainValues.length; domainIndex += 1) {
      const domain = domainValues[domainIndex];
      if (typeof domain !== 'string') {
        valid = false;
        break;
      }
      commitBuildArrayValue(domains, domain, 'runtime registry query domain');
    }
    if (!valid) continue;
    witnessSortStrings(domains);
    commitBuildArrayValue(
      reads,
      freezeBuildSecurityValue({
        domains: freezeBuildSecurityValue(domains),
        query: queryKey,
      }),
      'runtime registry query read fact',
    );
  }
  securityArraySort(reads, (left, right) => compareStrings(left.query, right.query));
  return freezeBuildSecurityValue(reads);
}

/** @internal Derive runtime mutation-touch facts from the shared build/check touch graph. */
export function runtimeRegistryMutationTouchesFromGraph(
  graph: RuntimeRegistryTouchGraphLike,
): RuntimeRegistryWireFacts['mutationTouches'] {
  if (graph === null || typeof graph !== 'object') {
    throw new TypeError('Runtime registry touch graph must be an object.');
  }
  const touchGraphProperty = buildOwnDataProperty(
    graph,
    'touchGraph',
    'runtime registry touchGraph',
  );
  const source = touchGraphProperty.present ? touchGraphProperty.value : undefined;
  if (source !== undefined && (source === null || typeof source !== 'object')) {
    throw new TypeError('Runtime registry touchGraph must be an own data record.');
  }

  const touchesByMutation = witnessCreateNullRecord<readonly RuntimeRegistryMutationTouchSite[]>();
  const mutationKeys = source === undefined ? [] : witnessObjectKeys(source);
  witnessSortStrings(mutationKeys);
  for (let index = 0; index < mutationKeys.length; index += 1) {
    const mutation = mutationKeys[index]!;
    const entryProperty = buildOwnDataProperty(
      source as object,
      mutation,
      `runtime registry touchGraph.${mutation}`,
    );
    if (
      !entryProperty.present ||
      entryProperty.value === null ||
      typeof entryProperty.value !== 'object'
    ) {
      throw new TypeError(`Runtime registry touchGraph.${mutation} must be an own data record.`);
    }
    const touchesProperty = buildOwnDataProperty(
      entryProperty.value,
      'touches',
      `runtime registry touchGraph.${mutation}.touches`,
    );
    if (!touchesProperty.present || !witnessIsArray(touchesProperty.value)) {
      throw new TypeError(`Runtime registry touchGraph.${mutation}.touches must be an array.`);
    }
    const sourceTouches = snapshotBuildArray(
      touchesProperty.value,
      `runtime registry touchGraph.${mutation}.touches`,
    );
    const touches: RuntimeRegistryMutationTouchSite[] = [];
    for (let touchIndex = 0; touchIndex < sourceTouches.length; touchIndex += 1) {
      commitBuildArrayValue(
        touches,
        snapshotRuntimeTouch(sourceTouches[touchIndex], mutation),
        `runtime registry touchGraph.${mutation} touch`,
      );
    }
    const unique = dedupeRuntimeTouches(touches);
    if (unique.length > 0) {
      witnessDefineProperty(touchesByMutation, mutation, {
        configurable: false,
        enumerable: true,
        value: freezeBuildSecurityValue(unique),
        writable: false,
      });
    }
  }
  return freezeBuildSecurityValue(touchesByMutation);
}

/**
 * @internal Snapshot the Drizzle analyzer's compiler-owned table-security manifest.
 *
 * The analyzer can run after authored modules in dev/build processes, so every carrier is read
 * through boot-pinned own-data controls before it becomes generated runtime source (SPEC §6.6).
 */
export function runtimeRegistryTableSecurityFromFacts(
  value: unknown,
): RuntimeTableSecurityWireManifest {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('Runtime table-security manifest must be an own-data record.');
  }
  const tablesValue = requiredRuntimeTableSecurityValue(value, 'tables', 'manifest');
  if (!witnessIsArray(tablesValue)) {
    throw new TypeError('Runtime table-security manifest.tables must be an array.');
  }
  const sourceTables = snapshotBuildArray(tablesValue, 'Runtime table-security tables');
  const tables: RuntimeTableSecurityWireTable[] = [];
  for (let index = 0; index < sourceTables.length; index += 1) {
    commitBuildArrayValue(
      tables,
      snapshotRuntimeTableSecurityTable(sourceTables[index], index),
      'Runtime table-security tables',
    );
  }
  securityArraySort(tables, (left, right) => compareStrings(left.name, right.name));
  return freezeBuildSecurityValue({ tables: freezeBuildSecurityValue(tables) });
}

function snapshotRuntimeTableSecurityTable(
  value: unknown,
  index: number,
): RuntimeTableSecurityWireTable {
  const label = `manifest.tables[${index}]`;
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError(`Runtime table-security ${label} must be an own-data record.`);
  }
  const name = requiredRuntimeTableSecurityValue(value, 'name', label);
  const classificationsValue = requiredRuntimeTableSecurityValue(
    value,
    'authorizationClassifications',
    label,
  );
  const columnsValue = requiredRuntimeTableSecurityValue(value, 'columns', label);
  const governedValue = requiredRuntimeTableSecurityValue(value, 'governedColumnKeys', label);
  const secretValue = requiredRuntimeTableSecurityValue(value, 'secretColumnKeys', label);
  const secretDeclared = requiredRuntimeTableSecurityValue(value, 'secretDeclared', label);
  if (
    typeof name !== 'string' ||
    !witnessIsArray(classificationsValue) ||
    !witnessIsArray(columnsValue) ||
    !witnessIsArray(governedValue) ||
    !witnessIsArray(secretValue) ||
    typeof secretDeclared !== 'boolean'
  ) {
    throw new TypeError(`Runtime table-security ${label} contains invalid required facts.`);
  }

  const classifications = snapshotBuildArray(
    classificationsValue,
    `${label}.authorizationClassifications`,
  );
  const authorizationClassifications: RuntimeTableSecurityAuthorizationClassification[] = [];
  for (
    let classificationIndex = 0;
    classificationIndex < classifications.length;
    classificationIndex += 1
  ) {
    const classification = classifications[classificationIndex];
    if (!isRuntimeTableSecurityClassification(classification)) {
      throw new TypeError(`Runtime table-security ${label} contains an invalid classification.`);
    }
    commitBuildArrayValue(
      authorizationClassifications,
      classification,
      `${label}.authorizationClassifications`,
    );
  }

  const sourceColumns = snapshotBuildArray(columnsValue, `${label}.columns`);
  const columns: RuntimeTableSecurityWireColumn[] = [];
  for (let columnIndex = 0; columnIndex < sourceColumns.length; columnIndex += 1) {
    const column = sourceColumns[columnIndex];
    if (column === null || typeof column !== 'object' || witnessIsArray(column)) {
      throw new TypeError(`Runtime table-security ${label}.columns contains an invalid column.`);
    }
    const key = requiredRuntimeTableSecurityValue(column, 'key', `${label}.columns`);
    const columnName = requiredRuntimeTableSecurityValue(column, 'name', `${label}.columns`);
    if (typeof key !== 'string' || typeof columnName !== 'string') {
      throw new TypeError(`Runtime table-security ${label}.columns contains an invalid column.`);
    }
    commitBuildArrayValue(
      columns,
      freezeBuildSecurityValue({ key, name: columnName }),
      `${label}.columns`,
    );
  }

  const ownerValue = optionalRuntimeTableSecurityValue(value, 'owner', label);
  const ownerViaValue = optionalRuntimeTableSecurityValue(value, 'ownerVia', label);
  return freezeBuildSecurityValue({
    authorizationClassifications: freezeBuildSecurityValue(authorizationClassifications),
    columns: freezeBuildSecurityValue(columns),
    governedColumnKeys: snapshotRuntimeTableSecurityStrings(
      governedValue,
      `${label}.governedColumnKeys`,
    ),
    name,
    ...(ownerValue === undefined
      ? {}
      : { owner: snapshotRuntimeTableSecurityOwner(ownerValue, label) }),
    ...(ownerViaValue === undefined
      ? {}
      : { ownerVia: snapshotRuntimeTableSecurityOwnerVia(ownerViaValue, label) }),
    secretColumnKeys: snapshotRuntimeTableSecurityStrings(secretValue, `${label}.secretColumnKeys`),
    secretDeclared,
  });
}

function snapshotRuntimeTableSecurityOwner(
  value: unknown,
  label: string,
): RuntimeTableSecurityWireOwner {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError(`Runtime table-security ${label}.owner must be an own-data record.`);
  }
  const columnKey = requiredRuntimeTableSecurityValue(value, 'columnKey', `${label}.owner`);
  const columnName = requiredRuntimeTableSecurityValue(value, 'columnName', `${label}.owner`);
  if (typeof columnKey !== 'string' || typeof columnName !== 'string') {
    throw new TypeError(`Runtime table-security ${label}.owner contains invalid facts.`);
  }
  return freezeBuildSecurityValue({ columnKey, columnName });
}

function snapshotRuntimeTableSecurityOwnerVia(
  value: unknown,
  label: string,
): RuntimeTableSecurityWireOwnerVia {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError(`Runtime table-security ${label}.ownerVia must be an own-data record.`);
  }
  const fields = [
    'fkColumnKey',
    'fkColumnName',
    'parentKeyColumnKey',
    'parentKeyColumnName',
    'parentTable',
  ] as const;
  const snapshot: Record<(typeof fields)[number], string> = {
    fkColumnKey: '',
    fkColumnName: '',
    parentKeyColumnKey: '',
    parentKeyColumnName: '',
    parentTable: '',
  };
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    const fieldValue = requiredRuntimeTableSecurityValue(value, field, `${label}.ownerVia`);
    if (typeof fieldValue !== 'string') {
      throw new TypeError(`Runtime table-security ${label}.ownerVia contains invalid facts.`);
    }
    snapshot[field] = fieldValue;
  }
  return freezeBuildSecurityValue(snapshot);
}

function snapshotRuntimeTableSecurityStrings(
  value: readonly unknown[],
  label: string,
): readonly string[] {
  const source = snapshotBuildArray(value, label);
  const strings: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (typeof source[index] !== 'string') {
      throw new TypeError(`Runtime table-security ${label} must contain only strings.`);
    }
    commitBuildArrayValue(strings, source[index], label);
  }
  witnessSortStrings(strings);
  return freezeBuildSecurityValue(strings);
}

function requiredRuntimeTableSecurityValue(
  value: object,
  property: string,
  label: string,
): unknown {
  const result = buildOwnDataProperty(
    value,
    property,
    `Runtime table-security ${label}.${property}`,
  );
  if (!result.present) {
    throw new TypeError(
      `Runtime table-security ${label}.${property} must be an own data property.`,
    );
  }
  return result.value;
}

function optionalRuntimeTableSecurityValue(
  value: object,
  property: string,
  label: string,
): unknown {
  const result = buildOwnDataProperty(
    value,
    property,
    `Runtime table-security ${label}.${property}`,
  );
  return result.present ? result.value : undefined;
}

function isRuntimeTableSecurityClassification(
  value: unknown,
): value is RuntimeTableSecurityAuthorizationClassification {
  return (
    value === 'authzPolicy' ||
    value === 'owned' ||
    value === 'ownedVia' ||
    value === 'public' ||
    value === 'reference'
  );
}

/** @internal Project runtime registry facts from the CLI/server graph shape. */
export function runtimeRegistryWireFactsFromGraph(
  graph: CoreGraph.KovoCheckInput,
): RuntimeRegistryWireFacts {
  if (graph === null || typeof graph !== 'object') {
    throw new TypeError('Runtime registry graph must be an object.');
  }
  const queriesProperty = buildOwnDataProperty(graph, 'queries', 'runtime registry graph.queries');
  const queries = queriesProperty.present ? queriesProperty.value : undefined;
  if (queries !== undefined && !witnessIsArray(queries)) {
    throw new TypeError('Runtime registry graph.queries must be an own data array.');
  }
  return freezeBuildSecurityValue({
    mutationTouches: runtimeRegistryMutationTouchesFromGraph(graph),
    queryReads: runtimeRegistryQueryReadsFromFacts(
      (queries ?? []) as readonly RuntimeRegistryQueryFactLike[],
    ),
  });
}

/** @internal Serialize the runtime registry virtual module consumed by dev and production. */
export function serializeRuntimeRegistryWireModule(registry: RuntimeRegistryWireFacts): string {
  const queryReads = buildSecuritySourceLiteral(registry.queryReads);
  const mutationTouches = buildSecuritySourceLiteral(registry.mutationTouches);
  const tableSecurity =
    registry.tableSecurity === undefined
      ? ''
      : `registerGeneratedTableSecurityManifest(${buildSecuritySourceLiteral(registry.tableSecurity)});\n`;
  return `import { registerGeneratedMutationTouchRegistry, registerGeneratedQueryReadRegistry, registerGeneratedTableSecurityManifest } from '@kovojs/server/internal/execution';\n${tableSecurity}registerGeneratedQueryReadRegistry(${queryReads});\nregisterGeneratedMutationTouchRegistry(${mutationTouches});\n`;
}

function snapshotRuntimeTouch(
  value: unknown,
  mutation: string,
): Readonly<RuntimeRegistryMutationTouchSite> {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`Runtime registry touchGraph.${mutation} contains an invalid touch.`);
  }
  const domain = buildOwnDataProperty(value, 'domain', `touchGraph.${mutation}.touch.domain`);
  const keys = buildOwnDataProperty(value, 'keys', `touchGraph.${mutation}.touch.keys`);
  const crossTable = buildOwnDataProperty(
    value,
    'crossTable',
    `touchGraph.${mutation}.touch.crossTable`,
  );
  const domainValue = domain.present ? domain.value : undefined;
  const keysValue = keys.present ? keys.value : undefined;
  const crossTableValue = crossTable.present ? crossTable.value : undefined;
  if (
    typeof domainValue !== 'string' ||
    !keys.present ||
    (keysValue !== null && typeof keysValue !== 'string') ||
    (crossTableValue !== undefined && crossTableValue !== true)
  ) {
    throw new TypeError(`Runtime registry touchGraph.${mutation} contains an invalid touch.`);
  }
  return freezeBuildSecurityValue({
    ...(crossTableValue === true ? { crossTable: true as const } : {}),
    domain: domainValue,
    keys: keysValue,
  });
}

function dedupeRuntimeTouches(
  touches: readonly RuntimeRegistryMutationTouchSite[],
): RuntimeRegistryMutationTouchSite[] {
  const seen = createWitnessSet<string>();
  const unique: RuntimeRegistryMutationTouchSite[] = [];
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches[index]!;
    const key = touchIdentity(touch);
    if (witnessSetHas(seen, key)) continue;
    witnessSetAdd(seen, key);
    commitBuildArrayValue(unique, touch, 'runtime registry unique touch');
  }
  securityArraySort(unique, compareTouches);
  return unique;
}

function touchIdentity(touch: RuntimeRegistryMutationTouchSite): string {
  const keys = touch.keys;
  return `${touch.domain.length}:${touch.domain}|${keys === null ? 'n' : `s${keys.length}:${keys}`}|${touch.crossTable === true ? '1' : '0'}`;
}

function compareTouches(
  left: RuntimeRegistryMutationTouchSite,
  right: RuntimeRegistryMutationTouchSite,
): number {
  return (
    compareStrings(left.domain, right.domain) ||
    compareStrings(left.keys ?? '', right.keys ?? '') ||
    (left.crossTable === true ? 1 : 0) - (right.crossTable === true ? 1 : 0)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
