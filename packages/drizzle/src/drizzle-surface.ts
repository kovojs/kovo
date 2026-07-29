import {
  runtimeArrayAppend,
  runtimeArrayIsArray,
  runtimeArrayLength,
  runtimeArrayValue,
  runtimeDefineOwnData,
  runtimeFreeze,
  runtimeOwnDataValue,
  runtimeOwnKeys,
  runtimeRegExpTest,
  runtimeSealSet,
  runtimeSet,
  runtimeSetAdd,
} from './runtime-security-intrinsics.js';
import type { AnyColumn, SQL, Table } from 'drizzle-orm';

export const DRIZZLE_TABLE_FACTORY_NAMES = immutablePolicySet(['pgTable', 'sqliteTable']);

export const DRIZZLE_DATABASE_TYPE_NAMES = immutablePolicySet([
  'SQLiteAsyncDatabase',
  'BetterSQLite3Database',
  'BunSQLiteDatabase',
  'LibSQLDatabase',
  'NodePgDatabase',
  'PgAsyncDatabase',
  'PgliteDatabase',
  'PostgresJsDatabase',
  'SQLJsDatabase',
]);

export const KOVO_EXTRA_CONFIG_CALL_NAME = 'kovo';

/** Private server-side provenance kinds used by exact local helper projections. */
export type KovoAnalyzerPrivateScopeKind = 'guard' | 'session' | 'tenant';

/**
 * The return-provenance kinds a `kovoAnalyzerSummary` may mark for structural
 * verification. A declaration never grants provenance by itself: the analyzer must
 * prove the body and path of one direct same-file function declaration or `const`
 * arrow/function binding (SPEC §6.6/§10.3).
 */
export type KovoAnalyzerReturnKind = KovoAnalyzerPrivateScopeKind;

/**
 * A candidate marker for a private-scope helper. Security verdicts use only the
 * analyzer's exact structural proof. Object properties, methods, imports, aliased
 * marker targets, mutable bindings, multi-statement bodies, and mismatched projections
 * remain unknown regardless of this marker (SPEC §6.6).
 */
export type KovoAnalyzerFunctionSummary = {
  returns: { kind: KovoAnalyzerPrivateScopeKind; path: string };
};

declare const kovoAnnotationColumnIdentity: unique symbol;

/**
 * One exact column from the table currently being annotated.
 *
 * The private type witness is an author-time guardrail: only a property read from the `columns`
 * argument of the enclosing {@link kovo} callback inhabits this type. Runtime extraction still
 * verifies the concrete Drizzle table/column object identity and the compiler independently
 * resolves the same source expression (SPEC §10.1).
 */
export type KovoColumnRef<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = {
  readonly [Key in keyof Columns]: Columns[Key] & {
    readonly [kovoAnnotationColumnIdentity]: {
      readonly columns: Columns;
      readonly key: Key;
    };
  };
}[keyof Columns];

/** Column-level confidentiality annotation consumed by the secret wire gate. */
export type KovoSecretColumnAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = true | KovoColumnRef<Columns> | readonly KovoColumnRef<Columns>[];

/** Column-level at-rest confidentiality annotation consumed by the encrypted-write gate. */
export type KovoConfidentialAtRestColumnAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = true | KovoColumnRef<Columns> | readonly KovoColumnRef<Columns>[];

/**
 * A fan-out invalidation edge for a table's `fans`: when a write touches this table,
 * also invalidate the named `domain` reached `via` the given relation, optionally scoped
 * to a write `when` (`insert`/`update`/`delete`). The element type of `KovoTableAnnotation.fans`
 * and `KovoDomainTableAnnotation.fans` (SPEC §10.1 / KV413 declared engine-side-effect edges).
 */
export interface KovoFanAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> {
  domain: string;
  via: KovoColumnRef<Columns>;
  when?: 'delete' | 'insert' | 'update';
}

/** Declares the backing invalidation domain and refresh mode for a Drizzle view relation. */
export interface KovoViewAnnotation {
  of: string;
  refresh?: 'async' | 'sync';
}

/**
 * Names columns that may only be written from a server-derived value, never from
 * raw request input (SPEC §11.1, the §11.1 mass-assignment gate / KV438). The
 * primary `key` and the principal `owner` column are AUTO-governed; this annotation
 * governs the rest (`role`/`balance`/`isAdmin`/…). `true` would govern every column
 * (rarely wanted); the usual form is a column ref or list.
 */
export type KovoGovernedColumnAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = true | KovoColumnRef<Columns> | readonly KovoColumnRef<Columns>[];

/**
 * Names columns whose single-row read-modify-write MUST fold the check and the act into
 * one statement — a compare-and-set / version guard in the `where()` (SPEC §10.3/§11.1,
 * the KV429 TOCTOU gate). A self-referential `set({ col: col ± x })` on such a column
 * whose `where()` carries no eq-predicate on that column (nor a declared version column)
 * is a lost-update race. `atomic` names the contended value column; `version` names an
 * optimistic-concurrency counter that, when guarded in the `where()`, discharges the gate.
 */
export type KovoConcurrencyColumnAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = KovoColumnRef<Columns> | readonly KovoColumnRef<Columns>[];

/** A domain annotation can use explicit external vocabulary or a source-derived Kovo domain value. */
export type KovoDomainRef = string | { key: string };

/** Declares ownership through one concrete parent-table relation (SPEC §10.1). */
export interface KovoOwnerViaAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
  Parent extends Table = Table,
> {
  fk: KovoColumnRef<Columns>;
  parent: Parent;
  parentKey: Parent['_']['columns'][keyof Parent['_']['columns']];
}

/** A Kovo annotation on a Drizzle table: a `domain` (with optional row `key` and principal `owner`), or an `exempt` marker. */
export type KovoTableAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
  Parent extends Table = Table,
> =
  | {
      atomic?: KovoConcurrencyColumnAnnotation<Columns>;
      authzPolicy?: SQL<boolean> | string;
      confidentialAtRest?: KovoConfidentialAtRestColumnAnnotation<Columns>;
      domain: KovoDomainRef;
      fans?: readonly KovoFanAnnotation<Columns>[];
      governed?: KovoGovernedColumnAnnotation<Columns>;
      key?: KovoColumnRef<Columns> | readonly [KovoColumnRef<Columns>, ...KovoColumnRef<Columns>[]];
      owner?: KovoColumnRef<Columns>;
      ownerVia?: KovoOwnerViaAnnotation<Columns, Parent>;
      public?: true;
      readOnly?: true;
      reference?: true;
      secret?: KovoSecretColumnAnnotation<Columns>;
      version?: KovoConcurrencyColumnAnnotation<Columns>;
    }
  | {
      exempt: true;
    };

/** A Kovo annotation for a Drizzle view or materialized view declaration. */
export interface KovoViewExtraConfigAnnotation {
  view: KovoViewAnnotation;
}

/** The domain-bearing form of a table annotation: its `domain`, optional `key` column, and optional principal `owner` column (SPEC §10.1). */
export interface KovoDomainTableAnnotation<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
  Parent extends Table = Table,
> {
  atomic?: KovoConcurrencyColumnAnnotation<Columns>;
  authzPolicy?: SQL<boolean> | string;
  confidentialAtRest?: KovoConfidentialAtRestColumnAnnotation<Columns>;
  domain: KovoDomainRef;
  fans?: readonly KovoFanAnnotation<Columns>[];
  governed?: KovoGovernedColumnAnnotation<Columns>;
  key?: KovoColumnRef<Columns> | readonly [KovoColumnRef<Columns>, ...KovoColumnRef<Columns>[]];
  owner?: KovoColumnRef<Columns>;
  ownerVia?: KovoOwnerViaAnnotation<Columns, Parent>;
  public?: true;
  readOnly?: true;
  reference?: true;
  secret?: KovoSecretColumnAnnotation<Columns>;
  version?: KovoConcurrencyColumnAnnotation<Columns>;
}

/** The opaque Drizzle extra-config callback returned by {@link kovo}. */
export type KovoTableExtraConfig<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = (self: Columns) => [];

/** The opaque extra-config callback returned for a view/materialized-view annotation. */
export type KovoViewExtraConfig<
  Columns extends Readonly<Record<string, AnyColumn>> = Readonly<Record<string, AnyColumn>>,
> = (self: Columns) => [];

/**
 * Annotate a Drizzle table with the invalidation domain it belongs to, mark it
 * `exempt`, or declare a view/materialized-view backing domain. Used in a
 * relation's extra-config callback so the compiler can extract touch/read graph
 * facts from queries and writes — the Drizzle-blessed path to
 * schema-as-domain-registry (SPEC §10.1).
 *
 * @param annotation - A callback receiving concrete Drizzle column identities for the table being
 *   annotated. The private identity witness makes typo and wrong-table references fail to typecheck;
 *   runtime and AST verification remain the security proof.
 *   It returns a `{ domain, key?, owner?, readOnly?, secret?, confidentialAtRest? }` binding
 *   (`owner` names the principal-owning column for the §10.3 IDOR audit and
 *   `readOnly` marks externally-owned/CMS-style content read by the app but not invalidated by
 *   Kovo mutations (SPEC §4.10),
 *   `secret` names confidential columns for the Phase 1 wire gate; `confidentialAtRest`
 *   names columns that require the authenticated-encryption write sink), `{ exempt: true }`,
 *   or `{ view: { of, refresh? } }` binding.
 * @returns A Drizzle extra-config callback carrying the Kovo annotation.
 * @example
 * import { kovo } from '@kovojs/drizzle';
 *
 * export const cartConfig = () => kovo((columns) => ({
 *   domain: 'cart',
 *   key: columns.id,
 * }));
 */
export function kovo<
  Columns extends Readonly<Record<string, AnyColumn>>,
  Parent extends Table = Table,
>(
  annotation: (columns: {
    readonly [Key in keyof Columns]: Columns[Key] & {
      readonly [kovoAnnotationColumnIdentity]: {
        readonly columns: Columns;
        readonly key: Key;
      };
    };
  }) => KovoTableAnnotation<Columns, Parent>,
): KovoTableExtraConfig<Columns>;
export function kovo<Columns extends Readonly<Record<string, AnyColumn>>>(
  annotation: (columns: {
    readonly [Key in keyof Columns]: Columns[Key] & {
      readonly [kovoAnnotationColumnIdentity]: {
        readonly columns: Columns;
        readonly key: Key;
      };
    };
  }) => KovoViewExtraConfigAnnotation,
): KovoViewExtraConfig<Columns>;
export function kovo<
  Columns extends Readonly<Record<string, AnyColumn>>,
  Parent extends Table = Table,
>(
  annotation: (columns: {
    readonly [Key in keyof Columns]: Columns[Key] & {
      readonly [kovoAnnotationColumnIdentity]: {
        readonly columns: Columns;
        readonly key: Key;
      };
    };
  }) => KovoTableAnnotation<Columns, Parent> | KovoViewExtraConfigAnnotation,
): KovoTableExtraConfig<Columns> | KovoViewExtraConfig<Columns> {
  if (typeof annotation !== 'function') {
    throw new TypeError('kovo() requires a direct annotation callback.');
  }
  let initialized = false;
  const extraConfig = ((self: Columns) => {
    if (initialized) return [];
    const snapshot = snapshotKovoAnnotation(
      annotation(
        self as {
          readonly [Key in keyof Columns]: Columns[Key] & {
            readonly [kovoAnnotationColumnIdentity]: {
              readonly columns: Columns;
              readonly key: Key;
            };
          };
        },
      ),
    );
    for (let index = 0; index < kovoAnnotationKeys.length; index += 1) {
      const key = kovoAnnotationKeys[index]!;
      const value = runtimeOwnDataValue(snapshot, key);
      if (value.found) {
        runtimeDefineOwnData(extraConfig, key, value.value, 'Kovo Drizzle annotation');
      }
    }
    initialized = true;
    return [];
  }) as KovoTableExtraConfig<Columns>;
  return extraConfig;
}

const kovoAnnotationKeys = [
  'atomic',
  'authzPolicy',
  'confidentialAtRest',
  'domain',
  'exempt',
  'fans',
  'governed',
  'key',
  'owner',
  'ownerVia',
  'public',
  'readOnly',
  'reference',
  'secret',
  'version',
  'view',
] as const;

function snapshotKovoAnnotation(annotation: object): Readonly<Record<string, unknown>> {
  if (typeof annotation !== 'object' || annotation === null) {
    throw new TypeError('kovo() annotation callback must return an annotation object.');
  }
  assertKnownKovoAnnotationFields(annotation, kovoAnnotationKeys, 'Kovo Drizzle annotation');
  const snapshot: Record<string, unknown> = {};
  for (let index = 0; index < kovoAnnotationKeys.length; index += 1) {
    const key = kovoAnnotationKeys[index]!;
    const value = runtimeOwnDataValue(annotation, key);
    if (!value.found) continue;
    runtimeDefineOwnData(
      snapshot,
      key,
      snapshotKovoAnnotationValue(key, value.value),
      'Kovo Drizzle annotation snapshot',
    );
  }
  return runtimeFreeze(snapshot);
}

function snapshotKovoAnnotationValue(
  key: (typeof kovoAnnotationKeys)[number],
  value: unknown,
): unknown {
  if (runtimeArrayIsArray(value)) {
    const length = runtimeArrayLength(value, `Kovo Drizzle ${key} annotation`);
    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const entry = runtimeArrayValue(value, index, `Kovo Drizzle ${key} annotation`);
      runtimeArrayAppend(
        snapshot,
        key === 'fans' ? snapshotKovoRecord(entry, ['domain', 'via', 'when']) : entry,
        `Kovo Drizzle ${key} annotation`,
      );
    }
    return runtimeFreeze(snapshot);
  }
  if (key === 'domain' && typeof value === 'object' && value !== null) {
    return snapshotKovoRecord(value, ['key']);
  }
  if (key === 'ownerVia') return snapshotKovoRecord(value, ['fk', 'parent', 'parentKey']);
  if (key === 'view') return snapshotKovoRecord(value, ['of', 'refresh']);
  return value;
}

function snapshotKovoRecord(value: unknown, keys: readonly string[]): Readonly<object> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Kovo Drizzle nested annotation must be an object.');
  }
  assertKnownKovoAnnotationFields(value, keys, 'Kovo Drizzle nested annotation');
  const snapshot: Record<string, unknown> = {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    const entry = runtimeOwnDataValue(value, key);
    if (entry.found) {
      runtimeDefineOwnData(snapshot, key, entry.value, 'Kovo Drizzle nested annotation');
    }
  }
  return runtimeFreeze(snapshot);
}

function assertKnownKovoAnnotationFields(
  value: object,
  allowedKeys: readonly string[],
  label: string,
): void {
  // SPEC §6.6: TypeScript's excess-property checks are not a security boundary.
  // Runtime annotation snapshots reject unknown posture instead of silently
  // erasing a misspelled secret/owner/governed field after a cast.
  const ownKeys = runtimeOwnKeys(value);
  for (let keyIndex = 0; keyIndex < ownKeys.length; keyIndex += 1) {
    const key = ownKeys[keyIndex];
    if (typeof key !== 'string') {
      throw new TypeError(`${label} must not contain symbol fields.`);
    }
    let allowed = false;
    for (let allowedIndex = 0; allowedIndex < allowedKeys.length; allowedIndex += 1) {
      if (allowedKeys[allowedIndex] === key) {
        allowed = true;
        break;
      }
    }
    if (!allowed) throw new TypeError(`Unknown ${label} field "${key}".`);
  }
}

/**
 * Mark one direct same-file private-scope helper as a candidate for exact structural
 * verification. The helper argument must be the bare identifier of a function
 * declaration or a `const` initialized directly by an arrow or function expression.
 * Object properties, methods, imports, aliased marker targets, and mutable bindings
 * remain unknown.
 *
 * The marker is not an author assertion and cannot grant a security verdict. The
 * analyzer independently inspects the helper body and accepts only a one-parameter,
 * one-return literal projection that exactly matches `kind` and `path` (SPEC §6.6).
 * The one-parameter TypeScript shape is an author-time guardrail, not the proof. The
 * runtime value is the original helper.
 *
 * After the marker is proven, one direct immutable same-file
 * `const alias = provenHelper` may preserve its identity at an invocation. Property,
 * element, destructured/container, chained, imported, opaque, and mutable aliases do
 * not preserve provenance.
 *
 * @param helper - The direct one-parameter helper candidate.
 * @param summary - The private-scope projection the analyzer must independently verify.
 * @returns The original helper, unchanged at runtime.
 * @example
 * import { kovoAnalyzerSummary } from '@kovojs/drizzle';
 *
 * function requireSessionId(context: { request: { session: { id: string } } }) {
 *   return context.request.session.id;
 * }
 *
 * kovoAnalyzerSummary(requireSessionId, { returns: { kind: 'session', path: 'id' } });
 */
export function kovoAnalyzerSummary<T extends (...args: never[]) => unknown>(
  helper: Parameters<T> extends [unknown] ? T : never,
  summary: KovoAnalyzerFunctionSummary,
): T {
  void summary;
  return helper;
}

export function isDrizzleDatabaseTypeName(name: string): boolean {
  return DRIZZLE_DATABASE_TYPE_NAMES.has(name) || runtimeRegExpTest(/^Neon.*Database$/u, name);
}

export function isDrizzleTableFactoryName(name: string): boolean {
  return DRIZZLE_TABLE_FACTORY_NAMES.has(name);
}

export function isKovoExtraConfigCallName(name: string): boolean {
  return name === KOVO_EXTRA_CONFIG_CALL_NAME;
}

function immutablePolicySet(values: readonly string[]): ReadonlySet<string> {
  // SPEC §6.6 rule 6: app/plugin code shares the process but must not rewrite the
  // static classifier vocabulary after the trusted Drizzle module initializes.
  const policy = runtimeSet<string>();
  for (let index = 0; index < values.length; index += 1) {
    runtimeSetAdd(policy, values[index]!);
  }
  return runtimeSealSet(policy);
}
