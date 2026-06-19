import type {
  CsrfValidationOptions,
  MutationDefinition,
  MutationResult,
  QueryDefinition,
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
export async function loadHarnessPage(
  pages: Record<string, string | (() => string | Promise<string>)> | undefined,
  path: string,
): Promise<PageAssertion> {
  const page = pages?.[path];
  if (!page) throw new Error(`Page fixture not found: ${path}`);

  const html = typeof page === 'function' ? await page() : page;
  return createPageAssertion(html);
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
  const loadContext = { db, request };
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
