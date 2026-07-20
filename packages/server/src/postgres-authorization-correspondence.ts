import type { FrameworkPostgresOwnerColumnBinding, GuardAuditFact } from './guards.js';
import {
  createWitnessWeakMap,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessReflectApply,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

/**
 * The complete Postgres RLS SQL-emission vocabulary shipped by Kovo.
 *
 * SPEC §10.3: this is a closed allowlist, not a descriptive sample. Adding an emission path
 * requires extending the correspondence audit and its C13 corpus in the same change.
 */
export const POSTGRES_RLS_SQL_EMISSION_SITES = Object.freeze([
  'owner',
  'ownerVia',
  'authzPolicy',
  'system',
  'admin',
] as const);

export type PostgresRlsSqlEmissionSite = (typeof POSTGRES_RLS_SQL_EMISSION_SITES)[number];

/**
 * A concrete schema may chain at most four ownerVia edges before reaching one owner column.
 * This makes the shipped policy fragment globally finite: at most 3^(1 + 4) = 243 models.
 */
export const POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH = 4;

export interface PostgresOwnerColumnPolicyTerm {
  readonly columnName: string;
  readonly kind: 'ownerColumn';
  readonly tableName: string;
}

export interface PostgresOwnerViaPolicyTerm {
  readonly fkColumnName: string;
  readonly kind: 'ownerVia';
  readonly parent: PostgresOwnerPolicyTerm;
  readonly parentKeyColumnName: string;
  readonly tableName: string;
}

/** The complete two-constructor algebra for framework-generated owner RLS. */
export type PostgresOwnerPolicyTerm = PostgresOwnerColumnPolicyTerm | PostgresOwnerViaPolicyTerm;

export type PostgresPolicyKleeneValue = 'false' | 'null' | 'true';
export type PostgresOwnerPolicyEdgeValue = 'absent' | 'null' | 'present';

/**
 * One exhaustive abstract model. `equality` is the leaf owner/principal equality. Edges are ordered
 * from the protected row outwards through each ownerVia parent relation.
 */
export interface PostgresOwnerPolicyModel {
  readonly edges: readonly PostgresOwnerPolicyEdgeValue[];
  readonly equality: PostgresPolicyKleeneValue;
}

export interface PostgresOwnerPolicyShape {
  readonly edgeCount: number;
  readonly equalityCount: 1;
  readonly modelCount: number;
}

export interface PostgresOwnerPolicyParentLookup {
  (input: {
    readonly keyColumnName: string;
    readonly keyValue: unknown;
    readonly tableName: string;
  }):
    | Promise<Readonly<Record<string, unknown>> | undefined>
    | Readonly<Record<string, unknown>>
    | undefined;
}

/** A framework-derived row evaluator. Proof-bearing guards accept only the opaque binding below. */
export interface FrameworkPostgresOwnsRow {
  (row: Readonly<Record<string, unknown>>, principal: string | undefined): Promise<boolean>;
}

export interface FrameworkPostgresOwnerPolicyAudit {
  readonly emissionSite: 'owner';
  readonly predicate: string;
  readonly tableName: string;
}

export interface FrameworkPostgresOwnerColumnBindingInput<Request, Key> {
  readonly lookupRow: (
    request: Request,
    key: Key,
  ) =>
    | Promise<Readonly<Record<string, unknown>> | undefined>
    | Readonly<Record<string, unknown>>
    | undefined;
  readonly term: PostgresOwnerColumnPolicyTerm;
}

export interface FrameworkPostgresOwnerColumnBindingRegistration<Request, Key> {
  readonly evaluate: (
    request: Request,
    key: Key,
    principal: string | undefined,
  ) => Promise<boolean>;
  readonly ownerPolicy: FrameworkPostgresOwnerPolicyAudit;
}

export interface PostgresOwnerPolicyCounterexample {
  readonly expected: boolean;
  readonly model: PostgresOwnerPolicyModel;
  readonly observed: boolean;
}

export interface PostgresOwnerPolicyCorrespondenceDecision {
  readonly checkedModels: number;
  readonly counterexample?: PostgresOwnerPolicyCounterexample;
  readonly expectedModels: number;
  readonly status: 'divergent' | 'proved';
}

export interface PostgresAuthorizationPolicyExplainInput {
  readonly emissionSite: PostgresRlsSqlEmissionSite;
  readonly predicate: string;
  readonly tableName: string;
  readonly term?: PostgresOwnerPolicyTerm;
}

export interface PostgresAuthorizationCorrespondenceExplainRecord {
  readonly decision?: PostgresOwnerPolicyCorrespondenceDecision;
  readonly guard: {
    readonly facts: readonly GuardAuditFact[];
    readonly semantics: 'arbitrary-app-callback' | 'framework-derived-owner-column' | 'none';
  };
  readonly reason: string;
  readonly rls: {
    readonly emissionSite: PostgresRlsSqlEmissionSite;
    readonly predicate: string;
    readonly tableName: string;
  };
  readonly roleGuc: {
    readonly readers: 0;
    readonly status: 'dead';
    readonly warning: string;
    readonly writers: 1;
  };
  readonly schema: 'kovo.postgres.authorization-correspondence/v1';
  readonly status: 'divergent' | 'proved' | 'unproven';
}

type PrimaryPolicySqlInput = {
  readonly readerRole: string;
  readonly schemaName: string;
  readonly tableName: string;
  readonly writerRole: string;
};

export type PostgresRlsPolicySqlInput =
  | (PrimaryPolicySqlInput & {
      readonly site: 'owner';
      readonly term: PostgresOwnerColumnPolicyTerm;
    })
  | (PrimaryPolicySqlInput & {
      readonly site: 'ownerVia';
      readonly term: PostgresOwnerViaPolicyTerm;
    })
  | (PrimaryPolicySqlInput & {
      readonly predicate: string;
      readonly site: 'authzPolicy';
    })
  | {
      readonly schemaName: string;
      readonly site: 'system';
      readonly systemRole: string;
      readonly tableName: string;
    }
  | {
      readonly adminRole: string;
      readonly schemaName: string;
      readonly site: 'admin';
      readonly tableName: string;
    };

const KLEENE_VALUES = Object.freeze(['false', 'null', 'true'] as const);
const EDGE_VALUES = Object.freeze(['absent', 'null', 'present'] as const);
const frameworkPostgresOwnerColumnBindings = createWitnessWeakMap<
  object,
  FrameworkPostgresOwnerColumnBindingRegistration<unknown, unknown>
>();

/** Construct one direct-owner term. */
export function postgresOwnerColumnPolicyTerm(input: {
  columnName: string;
  tableName: string;
}): PostgresOwnerColumnPolicyTerm {
  return Object.freeze({
    columnName: requiredPolicyIdentifier(input.columnName, 'owner column'),
    kind: 'ownerColumn' as const,
    tableName: requiredPolicyIdentifier(input.tableName, 'owner table'),
  });
}

/** Construct one ownerVia edge and enforce the globally finite recursion bound. */
export function postgresOwnerViaPolicyTerm(input: {
  fkColumnName: string;
  parent: PostgresOwnerPolicyTerm;
  parentKeyColumnName: string;
  tableName: string;
}): PostgresOwnerViaPolicyTerm {
  assertPostgresOwnerPolicyTerm(input.parent);
  const depth = postgresOwnerPolicyShape(input.parent).edgeCount + 1;
  if (depth > POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH) {
    throw new Error(
      `KV414: ownerVia policy depth ${depth} exceeds the finite Kovo bound ${POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH} (SPEC §10.3).`,
    );
  }
  return Object.freeze({
    fkColumnName: requiredPolicyIdentifier(input.fkColumnName, 'ownerVia foreign-key column'),
    kind: 'ownerVia' as const,
    parent: input.parent,
    parentKeyColumnName: requiredPolicyIdentifier(
      input.parentKeyColumnName,
      'ownerVia parent-key column',
    ),
    tableName: requiredPolicyIdentifier(input.tableName, 'ownerVia table'),
  });
}

/** Return the finite domain shape and its exact closed-form model count. */
export function postgresOwnerPolicyShape(term: PostgresOwnerPolicyTerm): PostgresOwnerPolicyShape {
  assertPostgresOwnerPolicyTerm(term);
  let edgeCount = 0;
  let current = term;
  while (current.kind === 'ownerVia') {
    edgeCount += 1;
    current = current.parent;
  }
  if (edgeCount > POSTGRES_OWNER_POLICY_MAX_OWNER_VIA_DEPTH) {
    throw new Error('Postgres owner policy term exceeds the finite ownerVia depth bound.');
  }
  return Object.freeze({
    edgeCount,
    equalityCount: 1 as const,
    modelCount: 3 ** (1 + edgeCount),
  });
}

/** Render the exact SQL predicate consumed by FORCE RLS. */
export function renderPostgresOwnerPolicyPredicate(term: PostgresOwnerPolicyTerm): string {
  assertPostgresOwnerPolicyTerm(term);
  if (term.kind === 'ownerColumn') {
    return `${quotePostgresIdentifier(term.columnName)} = current_setting('kovo.principal', true)`;
  }
  return renderOwnerViaPredicate(
    term,
    `${quotePostgresIdentifier(term.tableName)}.${quotePostgresIdentifier(term.fkColumnName)}`,
    2,
  );
}

/**
 * The only production RLS SQL emitter. The discriminated union and frozen site inventory make a
 * sixth path a compile/test failure instead of an unreviewed string concatenation.
 */
export function emitPostgresRlsPolicySql(input: PostgresRlsPolicySqlInput): string {
  const table = `${quotePostgresIdentifier(input.schemaName)}.${quotePostgresIdentifier(input.tableName)}`;
  switch (input.site) {
    case 'owner':
      return primaryPolicySql(
        table,
        'kovo_owner_scope',
        renderPostgresOwnerPolicyPredicate(input.term),
        input.readerRole,
        input.writerRole,
      );
    case 'ownerVia':
      return primaryPolicySql(
        table,
        'kovo_owner_scope',
        renderPostgresOwnerPolicyPredicate(input.term),
        input.readerRole,
        input.writerRole,
      );
    case 'authzPolicy':
      return primaryPolicySql(
        table,
        'kovo_authz_policy',
        requiredPolicyPredicate(input.predicate),
        input.readerRole,
        input.writerRole,
      );
    case 'system':
      return `CREATE POLICY kovo_system_scope ON ${table} FOR ALL TO ${quotePostgresIdentifier(input.systemRole)} USING (true) WITH CHECK (true)`;
    case 'admin':
      return `CREATE POLICY kovo_admin_scope ON ${table} FOR SELECT TO ${quotePostgresIdentifier(input.adminRole)} USING (true)`;
    default:
      return assertNever(input);
  }
}

/** Enumerate every model in the closed `3^k * 3^e` domain, never a sample. */
export function enumeratePostgresOwnerPolicyModels(
  term: PostgresOwnerPolicyTerm,
): readonly PostgresOwnerPolicyModel[] {
  const shape = postgresOwnerPolicyShape(term);
  const models: PostgresOwnerPolicyModel[] = [];
  for (let equalityIndex = 0; equalityIndex < KLEENE_VALUES.length; equalityIndex += 1) {
    enumerateEdges(shape.edgeCount, [], (edges) => {
      models.push(
        Object.freeze({
          edges: Object.freeze(edges),
          equality: KLEENE_VALUES[equalityIndex]!,
        }),
      );
    });
  }
  if (models.length !== shape.modelCount) {
    throw new Error(
      `Postgres owner policy enumerator produced ${models.length} models; expected ${shape.modelCount}.`,
    );
  }
  return Object.freeze(models);
}

/** Three-valued SQL denotation. EXISTS admits only TRUE and collapses FALSE/UNKNOWN to FALSE. */
export function evaluatePostgresOwnerPolicyModel(
  term: PostgresOwnerPolicyTerm,
  model: PostgresOwnerPolicyModel,
): PostgresPolicyKleeneValue {
  const shape = postgresOwnerPolicyShape(term);
  assertPostgresOwnerPolicyModel(model, shape.edgeCount);
  return evaluateModelAt(term, model, 0);
}

/** The storage-engine admission verdict: only SQL TRUE is visible under RLS. */
export function postgresOwnerPolicyModelAllows(
  term: PostgresOwnerPolicyTerm,
  model: PostgresOwnerPolicyModel,
): boolean {
  return evaluatePostgresOwnerPolicyModel(term, model) === 'true';
}

/**
 * Derive the framework-owned concrete ownsRow evaluator from the same term that emits SQL.
 * Parent lookup is the eventual managed-DB choke; null/unset principal and missing/null edges deny.
 */
export function deriveFrameworkPostgresOwnsRow(
  term: PostgresOwnerPolicyTerm,
  lookupParent: PostgresOwnerPolicyParentLookup,
): FrameworkPostgresOwnsRow {
  assertPostgresOwnerPolicyTerm(term);
  if (typeof lookupParent !== 'function') {
    throw new TypeError('Framework Postgres ownsRow requires a parent-row lookup function.');
  }
  const ownsRow: FrameworkPostgresOwnsRow = async (row, principal) => {
    if (principal === undefined || principal === '') return false;
    return evaluateConcreteOwnerRow(term, row, principal, lookupParent);
  };
  return ownsRow;
}

/**
 * @internal Mint the only binding accepted by the proof-bearing `guards.owns` path.
 *
 * This constructor is package-private (it is not reachable through an `@kovojs/server` export
 * map). Generated Postgres wiring supplies the exact key-to-row lookup from the managed DB
 * boundary. Keeping that authority behind this constructor is essential: accepting an app callback
 * here would merely move the old unproven predicate behind a structural wrapper. `ownerVia` stays
 * outside this binding until its parent traversal is equally framework-owned end to end.
 */
export function createFrameworkPostgresOwnerColumnBinding<Request, Key>(
  input: FrameworkPostgresOwnerColumnBindingInput<Request, Key>,
): FrameworkPostgresOwnerColumnBinding<Request, Key> {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Framework Postgres ownership binding input must be an object.');
  }
  if (typeof input.lookupRow !== 'function') {
    throw new TypeError('Framework Postgres ownership binding requires a row lookup function.');
  }
  if (input.term?.kind !== 'ownerColumn') {
    throw new TypeError(
      'Framework-proved guards.owns() accepts only a direct Postgres owner-column term; ownerVia requires guards.unprovenOwns() until parent lookup is framework-owned end to end (SPEC §10.3).',
    );
  }
  const term = postgresOwnerColumnPolicyTerm({
    columnName: input.term.columnName,
    tableName: input.term.tableName,
  });
  const ownsRow = deriveFrameworkPostgresOwnsRow(term, () => undefined);
  const lookupRow = input.lookupRow;
  const ownerPolicy = witnessFreeze({
    emissionSite: 'owner' as const,
    predicate: renderPostgresOwnerPolicyPredicate(term),
    tableName: term.tableName,
  });
  const registration: FrameworkPostgresOwnerColumnBindingRegistration<Request, Key> = witnessFreeze(
    {
      async evaluate(request, key, principal) {
        if (principal === undefined || principal === '') return false;
        const row = await witnessReflectApply<
          | Promise<Readonly<Record<string, unknown>> | undefined>
          | Readonly<Record<string, unknown>>
          | undefined
        >(lookupRow, undefined, [request, key]);
        if (row === undefined || typeof row !== 'object' || row === null) return false;
        return ownsRow(row, principal);
      },
      ownerPolicy,
    },
  );
  const binding = witnessFreeze(witnessCreateNullRecord());
  witnessWeakMapSet(
    frameworkPostgresOwnerColumnBindings,
    binding,
    registration as FrameworkPostgresOwnerColumnBindingRegistration<unknown, unknown>,
  );
  return binding as unknown as FrameworkPostgresOwnerColumnBinding<Request, Key>;
}

/** @internal Authenticate and close one framework ownership binding at guard construction. */
export function resolveFrameworkPostgresOwnerColumnBinding<Request, Key>(
  binding: FrameworkPostgresOwnerColumnBinding<Request, Key>,
): FrameworkPostgresOwnerColumnBindingRegistration<Request, Key> {
  if (typeof binding !== 'object' || binding === null) {
    throw new TypeError(
      'guards.owns() requires a framework-minted Postgres ownership binding (SPEC §10.3).',
    );
  }
  const registration = witnessWeakMapGet(frameworkPostgresOwnerColumnBindings, binding);
  if (registration === undefined) {
    throw new TypeError(
      'guards.owns() requires a framework-minted Postgres ownership binding (SPEC §10.3).',
    );
  }
  return registration as FrameworkPostgresOwnerColumnBindingRegistration<Request, Key>;
}

/** Exhaustively compare any guard model against the SQL term and return the first counterexample. */
export function decidePostgresOwnerPolicyCorrespondence(
  term: PostgresOwnerPolicyTerm,
  guardVerdict: (model: PostgresOwnerPolicyModel) => boolean,
): PostgresOwnerPolicyCorrespondenceDecision {
  if (typeof guardVerdict !== 'function') {
    throw new TypeError('Postgres owner-policy correspondence requires a guard verdict function.');
  }
  const models = enumeratePostgresOwnerPolicyModels(term);
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]!;
    const expected = postgresOwnerPolicyModelAllows(term, model);
    const observed = guardVerdict(model) === true;
    if (observed !== expected) {
      return Object.freeze({
        checkedModels: index + 1,
        counterexample: Object.freeze({ expected, model, observed }),
        expectedModels: models.length,
        status: 'divergent' as const,
      });
    }
  }
  return Object.freeze({
    checkedModels: models.length,
    expectedModels: models.length,
    status: 'proved' as const,
  });
}

/** Put SQL and executable guard evidence in one honest correspondence record. */
export function explainPostgresAuthorizationCorrespondence(input: {
  readonly guardModelVerdict?: (model: PostgresOwnerPolicyModel) => boolean;
  readonly guardFacts: readonly GuardAuditFact[];
  readonly policy: PostgresAuthorizationPolicyExplainInput;
}): PostgresAuthorizationCorrespondenceExplainRecord {
  const policy = input.policy;
  const guardFacts = Object.freeze([...input.guardFacts]);
  const ownerFragment = policy.emissionSite === 'owner' || policy.emissionSite === 'ownerVia';
  const frameworkOwnsFact = guardFacts.find(
    (fact) => fact.kind === 'owns' && fact.staticProof === 'framework-derived-owner-column',
  );
  const arbitraryOwnsFact = guardFacts.find(
    (fact) => fact.kind === 'owns' && fact.staticProof === 'not-claimed',
  );
  const roleFact = guardFacts.find((fact) => fact.kind === 'role');
  const frameworkPolicyMatches =
    ownerFragment &&
    policy.term !== undefined &&
    policy.term.kind === 'ownerColumn' &&
    frameworkOwnsFact !== undefined &&
    frameworkOwnsFact.ownerPolicy.emissionSite === policy.emissionSite &&
    frameworkOwnsFact.ownerPolicy.predicate === policy.predicate &&
    frameworkOwnsFact.ownerPolicy.tableName === policy.tableName;
  const suppliedDecision =
    ownerFragment && policy.term !== undefined && input.guardModelVerdict !== undefined
      ? decidePostgresOwnerPolicyCorrespondence(policy.term, input.guardModelVerdict)
      : undefined;
  const decision = frameworkPolicyMatches
    ? decidePostgresOwnerPolicyCorrespondence(policy.term!, (model) =>
        postgresOwnerPolicyModelAllows(policy.term!, model),
      )
    : suppliedDecision;
  const frameworkPolicyMismatch =
    ownerFragment && frameworkOwnsFact !== undefined && !frameworkPolicyMatches;
  const status =
    decision?.status === 'divergent' || frameworkPolicyMismatch
      ? ('divergent' as const)
      : frameworkPolicyMatches && arbitraryOwnsFact === undefined && roleFact === undefined
        ? ('proved' as const)
        : ('unproven' as const);
  const reason =
    decision?.status === 'divergent'
      ? 'The supplied guard semantics diverge from generated RLS; the decision record contains the first finite counterexample.'
      : !ownerFragment
        ? `${policy.emissionSite} lies outside the two-constructor owner correspondence fragment.`
        : roleFact !== undefined
          ? 'Session-role guard facts have no generated RLS predicate counterpart.'
          : frameworkPolicyMismatch
            ? 'The framework-derived owner guard is bound to a different generated Postgres owner policy.'
            : frameworkPolicyMatches && arbitraryOwnsFact === undefined
              ? 'The executable guard is bound to the framework-derived evaluator for this exact generated Postgres owner policy.'
              : arbitraryOwnsFact !== undefined
                ? 'The public guards.unprovenOwns callback is app-authored and has no claimed SQL correspondence.'
                : decision?.status === 'proved'
                  ? 'The abstract guard model matches generated RLS, but no executable guard is bound to the framework-derived evaluator.'
                  : 'No framework-derived owner-policy binding is attached to this executable guard.';

  return Object.freeze({
    ...(decision === undefined ? {} : { decision }),
    guard: Object.freeze({
      facts: guardFacts,
      semantics:
        arbitraryOwnsFact !== undefined
          ? ('arbitrary-app-callback' as const)
          : frameworkOwnsFact !== undefined
            ? ('framework-derived-owner-column' as const)
            : ('none' as const),
    }),
    reason,
    rls: Object.freeze({
      emissionSite: policy.emissionSite,
      predicate: requiredPolicyPredicate(policy.predicate),
      tableName: requiredPolicyIdentifier(policy.tableName, 'authorization explain table'),
    }),
    roleGuc: Object.freeze({
      readers: 0 as const,
      status: 'dead' as const,
      warning:
        'kovo.role is written by the managed transaction frame but no generated RLS predicate reads it; guards.role() is not SQL authorization.',
      writers: 1 as const,
    }),
    schema: 'kovo.postgres.authorization-correspondence/v1' as const,
    status,
  });
}

function renderOwnerViaPredicate(
  term: PostgresOwnerViaPolicyTerm,
  parentMatchExpression: string,
  aliasDepth: number,
): string {
  const parent = term.parent;
  const alias = quotePostgresIdentifier(`kovo_parent_${parent.tableName}_${aliasDepth}`);
  const equality = `${alias}.${quotePostgresIdentifier(term.parentKeyColumnName)} = ${parentMatchExpression}`;
  const nested =
    parent.kind === 'ownerColumn'
      ? `${alias}.${quotePostgresIdentifier(parent.columnName)} = current_setting('kovo.principal', true)`
      : renderOwnerViaPredicate(
          parent,
          `${alias}.${quotePostgresIdentifier(parent.fkColumnName)}`,
          aliasDepth + 1,
        );
  return `EXISTS (SELECT 1 FROM ${quotePostgresIdentifier(parent.tableName)} ${alias} WHERE ${equality} AND ${nested})`;
}

function primaryPolicySql(
  table: string,
  name: 'kovo_authz_policy' | 'kovo_owner_scope',
  predicate: string,
  readerRole: string,
  writerRole: string,
): string {
  return `CREATE POLICY ${name} ON ${table} FOR ALL TO ${quotePostgresIdentifier(readerRole)}, ${quotePostgresIdentifier(writerRole)} USING (${predicate}) WITH CHECK (${predicate})`;
}

function enumerateEdges(
  count: number,
  prefix: PostgresOwnerPolicyEdgeValue[],
  emit: (edges: PostgresOwnerPolicyEdgeValue[]) => void,
): void {
  if (prefix.length === count) {
    emit([...prefix]);
    return;
  }
  for (let index = 0; index < EDGE_VALUES.length; index += 1) {
    prefix.push(EDGE_VALUES[index]!);
    enumerateEdges(count, prefix, emit);
    prefix.pop();
  }
}

function evaluateModelAt(
  term: PostgresOwnerPolicyTerm,
  model: PostgresOwnerPolicyModel,
  edgeIndex: number,
): PostgresPolicyKleeneValue {
  if (term.kind === 'ownerColumn') return model.equality;
  const edge = model.edges[edgeIndex];
  if (edge !== 'present') return 'false';
  return evaluateModelAt(term.parent, model, edgeIndex + 1) === 'true' ? 'true' : 'false';
}

async function evaluateConcreteOwnerRow(
  term: PostgresOwnerPolicyTerm,
  row: Readonly<Record<string, unknown>>,
  principal: string,
  lookupParent: PostgresOwnerPolicyParentLookup,
): Promise<boolean> {
  if (term.kind === 'ownerColumn') {
    const owner = concretePostgresRowValue(row, term.columnName);
    return owner !== null && owner !== undefined && owner === principal;
  }
  const fkValue = concretePostgresRowValue(row, term.fkColumnName);
  if (fkValue === null || fkValue === undefined) return false;
  const parent = await lookupParent({
    keyColumnName: term.parentKeyColumnName,
    keyValue: fkValue,
    tableName: term.parent.tableName,
  });
  if (parent === undefined) return false;
  return evaluateConcreteOwnerRow(term.parent, parent, principal, lookupParent);
}

function concretePostgresRowValue(
  row: Readonly<Record<string, unknown>>,
  columnName: string,
): unknown {
  if (typeof row !== 'object' || row === null) return undefined;
  const descriptor = witnessGetOwnPropertyDescriptor(row, columnName);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function assertPostgresOwnerPolicyTerm(term: PostgresOwnerPolicyTerm): void {
  if (typeof term !== 'object' || term === null) {
    throw new TypeError('Postgres owner policy term must be an object.');
  }
  if (term.kind === 'ownerColumn') {
    requiredPolicyIdentifier(term.tableName, 'owner term table');
    requiredPolicyIdentifier(term.columnName, 'owner term column');
    return;
  }
  if (term.kind !== 'ownerVia') throw new TypeError('Unknown Postgres owner policy constructor.');
  requiredPolicyIdentifier(term.tableName, 'ownerVia term table');
  requiredPolicyIdentifier(term.fkColumnName, 'ownerVia term foreign-key column');
  requiredPolicyIdentifier(term.parentKeyColumnName, 'ownerVia term parent-key column');
  assertPostgresOwnerPolicyTerm(term.parent);
}

function assertPostgresOwnerPolicyModel(
  model: PostgresOwnerPolicyModel,
  expectedEdges: number,
): void {
  if (typeof model !== 'object' || model === null || !KLEENE_VALUES.includes(model.equality)) {
    throw new TypeError('Postgres owner policy model has an invalid equality value.');
  }
  if (!Array.isArray(model.edges) || model.edges.length !== expectedEdges) {
    throw new TypeError(
      `Postgres owner policy model requires exactly ${expectedEdges} edge values.`,
    );
  }
  for (const edge of model.edges) {
    if (!EDGE_VALUES.includes(edge)) {
      throw new TypeError('Postgres owner policy model has an invalid edge value.');
    }
  }
}

function requiredPolicyIdentifier(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`Postgres ${label} must be a non-empty control-free string.`);
  }
  return value;
}

function requiredPolicyPredicate(value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Postgres authorization predicate must be a non-empty string.');
  }
  return value;
}

function quotePostgresIdentifier(value: string): string {
  return `"${requiredPolicyIdentifier(value, 'identifier').replaceAll('"', '""')}"`;
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown Postgres RLS SQL emission site: ${String(value)}`);
}
