import type {
  CsrfValidationOptions,
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

/** @internal Verifier seam used internally by the test harness (SPEC.md §11). */
export interface HarnessOperationVerifier {
  assertCoveredOperations(observed: readonly ObservedDbOperation[], touchGraphKey?: string): void;
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
  csrf?: CsrfValidationOptions<Request>;
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
  const request = {
    ...requestFixture,
    ...options?.request,
    db,
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
  verifier.assertCoveredOperations(captured.observed, options?.touchGraphKey);
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
  if (typeof page === 'function') return createPageAssertion(await page());

  // SPEC.md §11.2: a route page's loader accesses the same wrapped DB seam as
  // mutation/query execution, so its reads are cross-checked against the
  // declared read set. Without the verifier the render still runs untracked.
  const render = () => page.render({ db });
  if (!verifier) return createPageAssertion(await render());

  const captured = await verifier.capture(render);
  verifier.assertReadsCoveredOperations(captured.observed, page.reads ?? []);
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
  if (!query.load) throw new Error(`Query fixture has no loader: ${query.key}`);

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
  const load = () => query.load?.(input, loadContext);
  const result = verifier
    ? await verifier.capture(load).then((captured) => {
        verifier.assertReadsCoveredOperations(
          captured.observed,
          (query.reads ?? []).map((domain) => domain.key),
        );
        return captured.result;
      })
    : await load();

  if (!query.output) return result;

  try {
    query.output.parse(result);
  } catch (error) {
    throw new Error(
      diagnosticMessage(
        'KV410',
        `${query.key} ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  return result;
}
