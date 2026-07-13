// Integration-suite fixture authoring contract (plans/integration-test-suite.md).
//
// A fixture is a single-file minimal Kovo app: `export default defineFixture(...)`.
// The harness owns everything else — PGlite creation, schema, seeding, the Vite
// SSR server, per-request `db` attachment, and teardown — so a fixture author
// writes only the app and (optionally) its schema/seed. SPEC §11 frames this as a
// framework-owned suite: fixtures exercise framework public APIs end-to-end, not
// app wiring.
import type { KovoApp, Reader } from '@kovojs/server';
import type { TouchGraph } from '@kovojs/core/internal/graph';

import type { PgliteTestDb } from '../pglite.js';
import type { DbVerificationConfig } from '../verifier.js';
import {
  verifierDenseArraySnapshot,
  verifierDefineProperty,
  verifierFreeze,
  verifierGetOwnPropertyDescriptor,
  verifierNullRecord,
  verifierOwnKeys,
} from '../verifier-security-intrinsics.js';
import { snapshotDbVerificationConfig, snapshotTouchGraph } from '../verifier-snapshots.js';

/**
 * The per-request context a fixture's route/query/mutation handlers receive. The
 * harness attaches `db` to every `Request` (mirroring the example app-shells'
 * `request.db` convention), so handlers read `(request as KovoFixtureRequest).db`.
 */
export interface KovoFixtureRequest {
  db: PgliteTestDb;
}

/** Framework-threaded read request used by verification-enabled route pages and query loaders. */
export interface KovoFixtureReaderRequest {
  db: Reader<PgliteTestDb>;
}

/**
 * A fixture's app: either a ready `KovoApp` (handlers read `request.db`) or a
 * factory that receives the freshly-created `db` for the current test. The factory
 * form is re-invoked on every database reset so closures never capture a stale db.
 */
export type FixtureAppFactory = KovoApp | ((context: { db: PgliteTestDb }) => KovoApp);

/** The shape passed to `defineFixture`: the app plus optional schema DDL and seed. */
export interface FixtureDefinition {
  /** The Kovo app under test, or a factory over the per-test `db`. */
  app: FixtureAppFactory;
  /**
   * Exact route pathnames and the domains their page render is allowed to read while integration
   * verification is enabled. Missing paths default to an empty read set (SPEC §11.2).
   */
  routeReads?: Readonly<Record<string, readonly string[]>>;
  /** SQL DDL run once per test before seeding (string or ordered statements). */
  schema?: string | readonly string[];
  /** Populate the database before each test, after `schema` has run. */
  seed?: (db: PgliteTestDb) => void | Promise<unknown>;
  /**
   * Optional static touch graph for integration-time DB verification. When
   * paired with `verification`, the fixture server wraps `request.db` and
   * checks observed writes/reads against SPEC.md §11.2.
   */
  touchGraph?: TouchGraph;
  /** Table/domain metadata used by the integration-time DB verifier. */
  verification?: DbVerificationConfig;
}

const FIXTURE_BRAND = '__kovoIntegrationFixture';

/** The descriptor a fixture module default-exports; consumed by the harness boot path. */
export interface KovoFixtureDescriptor {
  readonly [FIXTURE_BRAND]: true;
  readonly definition: FixtureDefinition;
}

/**
 * Declare a single-file integration fixture. The default export of a fixture
 * module must be a `defineFixture(...)` descriptor.
 *
 * @example
 * export default defineFixture({
 *   schema: 'create table todo (id serial primary key, title text)',
 *   seed: (db) => db.write('todo', { title: 'first' }),
 *   app: createApp({ routes: [...], mutations: [...] }),
 * });
 */
export function defineFixture(definition: FixtureDefinition): KovoFixtureDescriptor {
  return snapshotFixtureDescriptor({ [FIXTURE_BRAND]: true, definition });
}

/** Narrow an SSR-loaded module's default export to a fixture descriptor. */
export function isFixtureDescriptor(value: unknown): value is KovoFixtureDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const brand = verifierGetOwnPropertyDescriptor(value, FIXTURE_BRAND);
  const definition = verifierGetOwnPropertyDescriptor(value, 'definition');
  return (
    brand !== undefined &&
    'value' in brand &&
    brand.value === true &&
    definition !== undefined &&
    'value' in definition &&
    typeof definition.value === 'object' &&
    definition.value !== null
  );
}

/** @internal Snapshot a foreign-realm fixture declaration before authored setup can run. */
export function snapshotFixtureDescriptor(value: unknown): KovoFixtureDescriptor {
  if (!isFixtureDescriptor(value)) {
    throw new TypeError('Fixture descriptor must carry stable own brand and definition data.');
  }
  if (ownData(value, FIXTURE_BRAND, 'fixture descriptor') !== true) {
    throw new TypeError('Fixture descriptor brand must be stable own data.');
  }
  const definition = ownData(value, 'definition', 'fixture descriptor') as object;
  const app = ownData(definition, 'app', 'fixture definition');
  if (typeof app !== 'function' && (typeof app !== 'object' || app === null)) {
    throw new TypeError('fixture definition.app must be a stable own app object or factory.');
  }
  const schema = snapshotFixtureSchema(ownData(definition, 'schema', 'fixture definition'));
  const seed = ownData(definition, 'seed', 'fixture definition');
  if (seed !== undefined && typeof seed !== 'function') {
    throw new TypeError('fixture definition.seed must be a stable own function.');
  }
  const touchGraph = ownData(definition, 'touchGraph', 'fixture definition');
  const verification = ownData(definition, 'verification', 'fixture definition');
  if ((touchGraph === undefined) !== (verification === undefined)) {
    throw new TypeError(
      'fixture definition touchGraph and verification must be supplied together.',
    );
  }
  const routeReads = ownData(definition, 'routeReads', 'fixture definition');
  const stableDefinition: FixtureDefinition = verifierFreeze({
    app: app as FixtureAppFactory,
    ...(routeReads === undefined ? {} : { routeReads: snapshotRouteReads(routeReads) }),
    ...(schema === undefined ? {} : { schema }),
    ...(seed === undefined ? {} : { seed: seed as NonNullable<FixtureDefinition['seed']> }),
    ...(touchGraph === undefined
      ? {}
      : {
          touchGraph: snapshotTouchGraph(touchGraph as TouchGraph),
          verification: snapshotDbVerificationConfig(verification as DbVerificationConfig),
        }),
  });
  return verifierFreeze({ [FIXTURE_BRAND]: true, definition: stableDefinition });
}

function ownData(value: object, property: PropertyKey, label: string): unknown {
  const first = verifierGetOwnPropertyDescriptor(value, property);
  const second = verifierGetOwnPropertyDescriptor(value, property);
  if (first === undefined && second === undefined) return undefined;
  if (
    first === undefined ||
    second === undefined ||
    !('value' in first) ||
    !('value' in second) ||
    first.value !== second.value
  ) {
    throw new TypeError(
      `${label}.${typeof property === 'string' ? property : 'symbol'} must be a stable own data property.`,
    );
  }
  return first.value;
}

function snapshotFixtureSchema(value: unknown): string | readonly string[] | undefined {
  if (value === undefined || typeof value === 'string') return value;
  return verifierDenseArraySnapshot(value, 'fixture definition.schema', (statement) => {
    if (typeof statement !== 'string') {
      throw new TypeError('fixture definition.schema entries must be strings.');
    }
    return statement;
  });
}

function snapshotRouteReads(value: unknown): Readonly<Record<string, readonly string[]>> {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('fixture definition.routeReads must be an own-data object.');
  }
  const snapshot = verifierNullRecord<readonly string[]>();
  const paths = verifierOwnKeys(value);
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (typeof path !== 'string') {
      throw new TypeError('fixture definition.routeReads must not contain symbol properties.');
    }
    const reads = ownData(value, path, 'fixture definition.routeReads');
    verifierDefineProperty(snapshot, path, {
      configurable: false,
      enumerable: true,
      value: verifierDenseArraySnapshot(
        reads,
        `fixture definition.routeReads.${path}`,
        (domain) => {
          if (typeof domain !== 'string') {
            throw new TypeError(`fixture definition.routeReads.${path} entries must be strings.`);
          }
          return domain;
        },
      ),
      writable: false,
    });
  }
  return verifierFreeze(snapshot);
}
