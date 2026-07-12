import type {
  CsrfOptions,
  MutationDefinition,
  MutationResult,
  QueryDefinition,
  QueryLoadContext,
  Schema,
} from '@kovojs/server';
import { runMutation } from '@kovojs/server/internal/execution';
import { createPageAssertion, type PageAssertion } from './page.js';
import { diagnosticMessage } from './verifier-diagnostics.js';
import type { ObservedDbOperation } from './verifier-observation.js';
import {
  verifierApply,
  verifierGetOwnPropertyDescriptor,
  verifierStableMethod,
  verifierString,
} from './verifier-security-intrinsics.js';
import { snapshotDomains, snapshotQueryReadDomains } from './verifier-snapshots.js';
import { createManagedTestFixtureDispatchProxy } from './adapter-security.js';

/** @internal Verifier seam used internally by the test harness (SPEC.md §11). */
export interface HarnessOperationVerifier {
  assertCoveredOperations(observed: readonly ObservedDbOperation[], touchGraphKey?: string): void;
  assertNoWritesOperations(observed: readonly ObservedDbOperation[]): void;
  assertReadsCoveredOperations(
    observed: readonly ObservedDbOperation[],
    domains: readonly string[],
  ): void;
  capture<T>(
    callback: () => T | Promise<T>,
  ): Promise<{ observed: readonly ObservedDbOperation[]; result: T }>;
}

/**
 * A page fixture for the harness `page()` API. A bare string (or a
 * string-returning thunk) is pre-rendered page HTML with no database access. The
 * render form (`{ reads, render }`) supplies a route page's loader: the harness
 * runs `render` with the wrapped `db` so its reads are cross-checked against the
 * declared `reads` set the same way query loaders are, closing the gap where
 * `route.page` reads escaped runtime read verification (SPEC.md §11.2 read-side
 * cross-check; §6.4 `route.page`).
 */
export type HarnessPageFixture<Db = unknown> =
  | string
  | (() => string | Promise<string>)
  | {
      /** Domains the page loader is declared to read; observed reads must fall within this set (SPEC.md §11.2). */
      reads?: readonly string[];
      /** Render the page HTML from the wrapped `db`; its reads are verified against `reads`. */
      render: (context: { db: Db }) => string | Promise<string>;
    };

/** @internal Per-`exec` mutation options surfaced publicly via `KovoTestExecOptions`. */
export interface HarnessMutationOptions<Request> {
  csrf?: CsrfOptions<Request>;
  request?: Partial<Omit<Request, 'db'>>;
  touchGraphKey?: string;
}

/** @internal Lower-level harness mutation execution wrapped by `createKovoTestHarness`. */
export async function executeHarnessMutation<
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request extends { db: unknown },
  Value,
>(
  mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
  input: unknown,
  db: Request['db'],
  requestFixture: Record<string, unknown> | undefined,
  verifier: HarnessOperationVerifier | null,
  options?: HarnessMutationOptions<Request>,
): Promise<MutationResult<Value>> {
  const touchGraphKeyValue =
    options === undefined
      ? undefined
      : optionalOwnDataValue(options, 'touchGraphKey', 'harness mutation options');
  if (touchGraphKeyValue !== undefined && typeof touchGraphKeyValue !== 'string') {
    throw new TypeError(
      'harness mutation options.touchGraphKey must be a string own data property.',
    );
  }
  const executionDb =
    typeof db === 'object' && db !== null ? createManagedTestFixtureDispatchProxy(db) : db;
  const request = {
    ...requestFixture,
    ...options?.request,
    db: executionDb,
  } as unknown as Request;
  const run = () =>
    runMutation(
      mutation,
      input,
      request,
      options?.csrf === undefined ? {} : { csrf: options.csrf },
    );

  if (!verifier) return run();

  const captured = await verifier.capture(run);
  verifier.assertCoveredOperations(captured.observed, touchGraphKeyValue);
  return captured.result;
}

/** @internal Lower-level harness page loading wrapped by `createKovoTestHarness`. */
export async function loadHarnessPage<Db>(
  pages: Record<string, HarnessPageFixture<Db>> | undefined,
  path: string,
  db: Db,
  verifier: HarnessOperationVerifier | null,
): Promise<PageAssertion> {
  const page = pages?.[path];
  if (!page) throw new Error(`Page fixture not found: ${path}`);

  if (typeof page === 'string') return createPageAssertion(page);
  if (typeof page === 'function') {
    const runThunk = () => verifierApply<string | Promise<string>>(page, undefined, []);
    if (!verifier) return createPageAssertion(await runThunk());

    const captured = await verifier.capture(runThunk);
    verifier.assertNoWritesOperations(captured.observed);
    verifier.assertReadsCoveredOperations(captured.observed, snapshotDomains([]));
    return createPageAssertion(captured.result);
  }

  const render = requiredOwnFunction(page, 'render', 'page fixture');
  const declaredReads = snapshotDomains(
    (optionalOwnDataValue(page, 'reads', 'page fixture') as readonly string[] | undefined) ?? [],
  );
  // SPEC.md §11.2: a route page's loader accesses the same wrapped DB seam as
  // mutation/query execution, so its reads are cross-checked against the
  // declared read set. Without the verifier the render still runs untracked.
  const runRender = () => verifierApply<string | Promise<string>>(render, page, [{ db }]);
  if (!verifier) return createPageAssertion(await runRender());

  const captured = await verifier.capture(runRender);
  verifier.assertNoWritesOperations(captured.observed);
  verifier.assertReadsCoveredOperations(captured.observed, declaredReads);
  return createPageAssertion(captured.result);
}

/** @internal Lower-level harness query execution wrapped by `createKovoTestHarness`. */
export async function executeHarnessQuery<Db>(
  query: QueryDefinition,
  input: unknown,
  db: Db,
  requestFixture: Record<string, unknown> | undefined,
  verifier: HarnessOperationVerifier | null,
): Promise<unknown> {
  const queryKey = requiredOwnString(query, 'key', 'query fixture');
  const queryLoad = optionalOwnDataValue(query, 'load', 'query fixture');
  if (typeof queryLoad !== 'function') throw new Error(`Query fixture has no loader: ${queryKey}`);
  const declaredReads = snapshotQueryReadDomains(query);
  const output = optionalOwnDataValue(query, 'output', 'query fixture');
  const outputParse =
    typeof output === 'object' && output !== null
      ? verifierStableMethod(output, 'parse')
      : undefined;

  const request = {
    ...requestFixture,
    db,
  };
  // SPEC.md §11.4: harness query execution uses the same wrapped DB seam
  // as mutation execution, so read verification observes loader data access.
  // SPEC §9.4 (MARQUEE): the harness threads its own db as `context.db` to mirror the framework's
  // managed-handle seam. The fixture db is not the read-only proxy here (the harness owns the
  // verifier seam), so it is passed through the public `QueryLoadContext` shape.
  const loadContext = { db, request } as QueryLoadContext<typeof request, Db>;
  const load = () => verifierApply(queryLoad, query, [input, loadContext]);
  let result: unknown;
  if (verifier) {
    const captured = await verifier.capture(load);
    verifier.assertNoWritesOperations(captured.observed);
    verifier.assertReadsCoveredOperations(captured.observed, declaredReads);
    result = captured.result;
  } else {
    result = await load();
  }

  if (outputParse === undefined || output === undefined) return result;

  try {
    verifierApply(outputParse, output, [result]);
  } catch (error) {
    throw new Error(
      diagnosticMessage(
        'KV410',
        `${queryKey} ${error instanceof Error ? error.message : verifierString(error)}`,
      ),
    );
  }

  return result;
}

function optionalOwnDataValue(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = verifierGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`${label}.${String(property)} must be a stable own data property.`);
  }
  return descriptor.value;
}

function requiredOwnString(value: object, property: PropertyKey, label: string): string {
  const result = optionalOwnDataValue(value, property, label);
  if (typeof result !== 'string') {
    throw new TypeError(`${label}.${String(property)} must be a string own data property.`);
  }
  return result;
}

function requiredOwnFunction(value: object, property: PropertyKey, label: string): Function {
  const result = optionalOwnDataValue(value, property, label);
  if (typeof result !== 'function') {
    throw new TypeError(`${label}.${String(property)} must be a function own data property.`);
  }
  return result;
}
