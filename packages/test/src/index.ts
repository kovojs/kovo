export type { DiagnosticCode } from '@jiso/core';
import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';
import { PGlite, type PGliteOptions, type Results } from '@electric-sql/pglite';
import { inspect, isDeepStrictEqual } from 'node:util';
import type { TouchGraph, TouchSite } from '@jiso/core';
import {
  type CsrfValidationOptions,
  type InferSchema,
  type MutationDefinition,
  type MutationResult,
  type QueryDefinition,
  type Schema,
  runMutation,
} from '@jiso/server';
import {
  parse,
  type DeleteStatement,
  type Expr,
  type From,
  type InsertStatement,
  type QName,
  type SelectStatement,
  type Statement,
  type UpdateStatement,
  type WithRecursiveStatement,
  type WithStatement,
  type WithStatementBinding,
} from 'pgsql-ast-parser';

export interface JisoTestContext<Db = unknown> {
  db: Db;
  dbHandle(): Db;
  exec: <
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>>,
    Request extends { db: unknown },
    Value,
  >(
    mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
    input: unknown,
    options?: JisoTestExecOptions<Request>,
  ) => Promise<MutationResult<Value>>;
  page: (path: string) => Promise<PageAssertion>;
  query: (query: QueryDefinition, input?: unknown) => Promise<unknown>;
  verificationDiagnostics(): readonly DbVerificationDiagnostic[];
}

export interface JisoTestRequest<Db> {
  db: Db;
}

export interface JisoTestHarnessOptions<Db> {
  db: Db;
  pages?: Record<string, string | (() => string | Promise<string>)>;
  request?: Record<string, unknown>;
  touchGraph?: TouchGraph;
  verification?: DbVerificationConfig;
}

export interface PgliteTestDb {
  close(): Promise<void>;
  exec(statement: string): Promise<Results[]>;
  pglite: PGlite;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  read<Row extends Record<string, unknown> = Record<string, unknown>>(
    table: string,
  ): Promise<Row[]>;
  sql<Row extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
  write(table: string, value: Record<string, unknown>): Promise<void>;
}

export interface JisoTestExecOptions<Request> {
  csrf?: CsrfValidationOptions<Request>;
  request?: Partial<Omit<Request, 'db'>>;
  touchGraphKey?: string;
}

export interface PageAssertion {
  fragment(target: string): string;
  html: string;
}

export function createJisoTestHarness<Db>(
  options: JisoTestHarnessOptions<Db>,
): JisoTestContext<Db> {
  const verifier =
    options.touchGraph && options.verification
      ? createDbVerifier(options.touchGraph, options.verification)
      : null;
  const db = verifier ? (verifier.wrap(options.db) as Db) : options.db;

  return {
    db,
    dbHandle(): Db {
      return db;
    },
    async exec<
      InputSchema extends Schema<unknown>,
      Errors extends Record<string, Schema<unknown>>,
      Request extends { db: unknown },
      Value,
    >(
      mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
      input: unknown,
      execOptions?: JisoTestExecOptions<Request>,
    ) {
      const start = verifier?.observed.length ?? 0;
      const request = {
        ...options.request,
        ...execOptions?.request,
        db,
      } as unknown as Request;
      const result = await runMutation(
        mutation,
        input,
        request,
        execOptions?.csrf === undefined ? {} : { csrf: execOptions.csrf },
      );
      verifier?.assertCoveredSince(start, execOptions?.touchGraphKey);
      return result;
    },
    async page(path) {
      const page = options.pages?.[path];
      if (!page) throw new Error(`Page fixture not found: ${path}`);

      const html = typeof page === 'function' ? await page() : page;
      return createPageAssertion(html);
    },
    async query(query, input) {
      if (!query.load) throw new Error(`Query fixture has no loader: ${query.key}`);

      const start = verifier?.observed.length ?? 0;
      const result = await query.load(input, {
        request: {
          ...options.request,
          db,
        },
      });
      verifier?.assertReadsCoveredSince(
        start,
        query.reads.map((domain) => domain.key),
      );
      if (query.output) {
        try {
          query.output.parse(result);
        } catch (error) {
          throw new Error(
            diagnosticMessage(
              'FW410',
              `${query.key} ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
        }
      }
      return result;
    },
    verificationDiagnostics(): readonly DbVerificationDiagnostic[] {
      return verifier?.diagnostics() ?? [];
    },
  };
}

export interface DbVerificationConfig {
  domainByTable: Record<string, string>;
  keyByTable?: Record<string, string>;
}

export interface ObservedDbOperation {
  branch: string | undefined;
  domain: string | undefined;
  kind: 'read' | 'write';
  mutationRead: boolean | undefined;
  rowKey: string | undefined;
  sql: string | undefined;
  table: string;
}

export interface DbObservationOptions {
  branch?: string;
  rowKey?: string;
}

export interface DbVerificationDiagnostic {
  branch?: string;
  code: DiagnosticCode;
  domain: string;
  message: string;
  severity: DiagnosticSeverity;
  site?: string;
}

export interface DbVerifier {
  assertCovered(touchGraphKey?: string): void;
  assertCoveredSince(start: number, touchGraphKey?: string): void;
  assertReadsCovered(domains: readonly string[]): void;
  assertReadsCoveredSince(start: number, domains: readonly string[]): void;
  diagnostics(): DbVerificationDiagnostic[];
  observed: readonly ObservedDbOperation[];
  wrap<Db>(db: Db): Db;
}

export type MutationErrorExpectation<
  Errors extends Record<string, Schema<unknown>>,
  Code extends Extract<keyof Errors, string>,
> =
  | Code
  | {
      code: Code;
      payload?: InferSchema<Errors[Code]>;
    };

export interface PropertyCase<State, Input> {
  input: Input;
  state: State;
}

export interface PropertyTestOptions<State, Input, ClientShape = unknown> {
  apply: (state: State, input: Input) => State;
  cases: Iterable<PropertyCase<State, Input>>;
  predict: (state: State, input: Input) => ClientShape;
  shape?: (state: State) => ClientShape;
}

export interface PropertyTestResult {
  cases: number;
}

export function createDbVerifier(touchGraph: TouchGraph, config: DbVerificationConfig): DbVerifier {
  const observed: ObservedDbOperation[] = [];

  return {
    assertCovered(touchGraphKey?: string): void {
      assertObservedWritesCovered(observed, touchGraph, config, touchGraphKey);
    },
    assertCoveredSince(start: number, touchGraphKey?: string): void {
      assertObservedWritesCovered(observed.slice(start), touchGraph, config, touchGraphKey);
    },
    assertReadsCovered(domains: readonly string[]): void {
      assertObservedReadsCovered(observed, domains, config);
    },
    assertReadsCoveredSince(start: number, domains: readonly string[]): void {
      assertObservedReadsCovered(observed.slice(start), domains, config);
    },
    diagnostics(): DbVerificationDiagnostic[] {
      const observedWrites = new Set(
        observed
          .filter(
            (operation): operation is ObservedDbOperation & { domain: string } =>
              operation.kind === 'write' && operation.domain !== undefined,
          )
          .map((operation) => operation.domain),
      );
      const observedBranches = new Set(
        observed
          .filter(
            (operation): operation is ObservedDbOperation & { branch: string } =>
              operation.kind === 'write' && operation.branch !== undefined,
          )
          .map((operation) => operation.branch),
      );
      const declaredWrites = new Set(
        Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
      );
      const unobservedBranches: DbVerificationDiagnostic[] = Object.values(touchGraph)
        .flatMap((entry) => entry.touches)
        .filter((touch) => hasUnobservedBranch(touch, observedBranches))
        .sort((left, right) => left.branch.localeCompare(right.branch))
        .map((touch) => ({
          branch: touch.branch,
          code: 'FW405' as const,
          domain: touch.domain,
          message: diagnosticDefinitions.FW405.message,
          severity: diagnosticDefinitions.FW405.severity,
          site: touch.site,
        }));

      const unobservedDomains: DbVerificationDiagnostic[] = [...declaredWrites]
        .filter((domain) => !observedWrites.has(domain))
        .sort()
        .map((domain) => ({
          code: 'FW403' as const,
          domain,
          message: diagnosticDefinitions.FW403.message,
          severity: diagnosticDefinitions.FW403.severity,
        }));

      return [...unobservedBranches, ...unobservedDomains];
    },
    observed,
    wrap<Db>(db: Db): Db {
      if (typeof db !== 'object' || db === null) return db;

      const proxy = new Proxy(db as Record<string, unknown>, {
        get(target, prop, receiver) {
          if (prop === '__jisoObserved') return observed;
          const value = Reflect.get(target, prop, receiver);

          if (prop === 'pglite' && typeof value === 'object' && value !== null) {
            return wrapSqlHandle(value, config, observed);
          }

          if (prop === 'read' && typeof value === 'function') {
            return (table: string, ...args: unknown[]) => {
              observe('read', table, args, config, observed);
              return value.call(target, table, ...args);
            };
          }

          if (prop === 'write' && typeof value === 'function') {
            return (table: string, ...args: unknown[]) => {
              observe('write', table, args, config, observed);
              return value.call(target, table, ...args);
            };
          }

          if (prop === 'sql' && typeof value === 'function') {
            return (statement: unknown, ...args: unknown[]) => {
              observeSqlIfString(statement, config, observed);
              return value.call(target, statement, ...args);
            };
          }

          if ((prop === 'query' || prop === 'exec') && typeof value === 'function') {
            return (statement: unknown, ...args: unknown[]) => {
              observeSqlIfString(statement, config, observed);
              return value.call(target, statement, ...args);
            };
          }

          return value;
        },
      });

      return proxy as Db;
    },
  };
}

function wrapSqlHandle<Handle extends object>(
  handle: Handle,
  config: DbVerificationConfig,
  observed: ObservedDbOperation[],
): Handle {
  return new Proxy(handle as Record<PropertyKey, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (prop === 'transaction' && typeof value === 'function') {
        return (callback: (tx: object) => Promise<unknown>, ...args: unknown[]) =>
          value.call(
            target,
            (tx: object) => callback(wrapSqlHandle(tx, config, observed)),
            ...args,
          );
      }

      if ((prop === 'query' || prop === 'exec') && typeof value === 'function') {
        return (statement: unknown, ...args: unknown[]) => {
          observeSqlIfString(statement, config, observed);
          return value.call(target, statement, ...args);
        };
      }

      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Handle;
}

function observeSqlIfString(
  statement: unknown,
  config: DbVerificationConfig,
  observed: ObservedDbOperation[],
): void {
  if (typeof statement !== 'string') return;
  try {
    observeSql(statement, config, observed);
  } catch {
    // SPEC 11.2: instrumentation verifies observed SQL, but must not prevent
    // the user's database method from receiving adapter-specific statements.
  }
}

export async function createPgliteTestDb(options: PGliteOptions = {}): Promise<PgliteTestDb> {
  const pglite = new PGlite(options);
  await pglite.waitReady;

  return {
    async close() {
      await pglite.close();
    },
    async exec(statement) {
      return pglite.exec(statement);
    },
    pglite,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ) {
      const result = await pglite.query<Row>(statement, [...params]);
      return result.rows;
    },
    async read<Row extends Record<string, unknown> = Record<string, unknown>>(table: string) {
      const result = await pglite.query<Row>(`select * from ${quoteSqlIdentifier(table)}`);
      return result.rows;
    },
    async sql<Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params: readonly unknown[] = [],
    ) {
      const result = await pglite.query<Row>(statement, [...params]);
      return result.rows;
    },
    async write(table, value) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        await pglite.exec(`insert into ${quoteSqlIdentifier(table)} default values`);
        return;
      }

      const columns = entries.map(([column]) => quoteSqlIdentifier(column)).join(', ');
      const placeholders = entries.map((_, index) => `$${index + 1}`).join(', ');
      await pglite.query(
        `insert into ${quoteSqlIdentifier(table)} (${columns}) values (${placeholders})`,
        entries.map(([, columnValue]) => columnValue),
      );
    },
  };
}

export function assertMutationError<
  const Key extends string,
  InputSchema extends Schema<unknown>,
  Errors extends Record<string, Schema<unknown>>,
  Request,
  Value,
  const Code extends Extract<keyof Errors, string>,
>(
  mutation: MutationDefinition<Key, InputSchema, Errors, Request, Value>,
  result: MutationResult<Value>,
  expected: MutationErrorExpectation<Errors, Code>,
): InferSchema<Errors[Code]> {
  const expectation = typeof expected === 'string' ? { code: expected } : expected;

  if (result.ok) {
    throw new Error(`Expected ${mutation.key} to fail with ${expectation.code}, but it succeeded.`);
  }

  if (result.error.code !== expectation.code) {
    throw new Error(
      `Expected ${mutation.key} to fail with ${expectation.code}, got ${result.error.code}.`,
    );
  }

  if ('payload' in expectation && !deepEqual(result.error.payload, expectation.payload)) {
    throw new Error(
      `Expected ${mutation.key} error ${expectation.code} payload ${formatValue(
        expectation.payload,
      )}, got ${formatValue(result.error.payload)}.`,
    );
  }

  return result.error.payload as InferSchema<Errors[Code]>;
}

export function jisoTest<Db>(
  name: string,
  fn: (ctx: JisoTestContext<Db>) => void | Promise<void>,
  options: JisoTestHarnessOptions<Db>,
  runner?: JisoTestRunner,
): JisoTestCase {
  const run = async () => {
    await fn(createJisoTestHarness(options));
  };

  runner?.(name, run);

  return {
    name,
    run,
  };
}

export type JisoTestRunner = (name: string, run: () => Promise<void>) => unknown;

export interface JisoTestCase {
  name: string;
  run(): Promise<void>;
}

function assertObservedWritesCovered(
  observed: readonly ObservedDbOperation[],
  touchGraph: TouchGraph,
  config: DbVerificationConfig,
  touchGraphKey?: string,
): void {
  const scopedTouchGraph = selectTouchGraph(touchGraph, touchGraphKey);

  assertRowKeys(observed, config);
  assertKeyedWritesObserved(observed, scopedTouchGraph, config);
  assertMutationReadsCovered(observed, scopedTouchGraph);

  const unmappedWrites = observed.filter(
    (operation) => operation.kind === 'write' && operation.domain === undefined,
  );

  if (unmappedWrites.length > 0) {
    const tables = unmappedWrites.map((operation) => operation.table).join(', ');
    throw new Error(diagnosticMessage('FW404', tables));
  }

  const entries = Object.values(scopedTouchGraph).filter((entry) => entry !== undefined);
  const allowedWrites = new Set(
    entries.flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );
  const unresolvedWrites = entries.flatMap((entry) => entry.unresolved);
  const unresolvedDomains = new Set(
    unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
  );
  const uncovered = observed.filter(
    (operation) =>
      operation.kind === 'write' &&
      operation.domain !== undefined &&
      !allowedWrites.has(operation.domain) &&
      !unresolvedDomains.has(operation.domain),
  );

  if (uncovered.length > 0) {
    const domains = uncovered.map((operation) => operation.domain).join(', ');
    throw new Error(diagnosticMessage('FW402', domains));
  }
}

function assertKeyedWritesObserved(
  observed: readonly ObservedDbOperation[],
  touchGraph: TouchGraph,
  config: DbVerificationConfig,
): void {
  const entries = Object.values(touchGraph).filter((entry) => entry !== undefined);
  const unresolvedWrites = entries.flatMap((entry) => entry.unresolved);
  const unresolvedDomains = new Set(
    unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
  );

  const keyedTouchByTable = new Map(
    entries
      .flatMap((entry) => entry.touches)
      .filter((touch) => touch.keys !== null)
      .map((touch) => [touch.via, touch] as const),
  );
  const missing = observed.filter((operation) => {
    if (operation.kind !== 'write' || operation.rowKey !== undefined) return false;

    const touch = keyedTouchByTable.get(operation.table);
    if (!touch || unresolvedDomains.has(touch.domain)) return false;

    return config.keyByTable?.[operation.table] !== undefined;
  });

  if (missing.length === 0) return;

  const details = missing
    .map(
      (operation) =>
        `${operation.table} expected ${config.keyByTable?.[operation.table]} observed <missing>`,
    )
    .join(', ');
  throw new Error(diagnosticMessage('FW408', details));
}

function selectTouchGraph(touchGraph: TouchGraph, touchGraphKey: string | undefined): TouchGraph {
  if (touchGraphKey === undefined) return touchGraph;

  const entry = touchGraph[touchGraphKey];
  return entry === undefined ? {} : { [touchGraphKey]: entry };
}

export function propertyTest<State, Input, ClientShape = State>(
  options: PropertyTestOptions<State, Input, ClientShape>,
): PropertyTestResult {
  let count = 0;
  const shape = options.shape ?? ((state: State) => state as unknown as ClientShape);

  for (const testCase of options.cases) {
    const predicted = options.predict(structuredClone(testCase.state), testCase.input);
    const eventual = shape(options.apply(structuredClone(testCase.state), testCase.input));

    if (!deepEqual(predicted, eventual)) {
      throw new Error(
        `Optimistic property failed for case ${count}: predicted ${formatValue(
          predicted,
        )}, eventual ${formatValue(eventual)}`,
      );
    }

    count += 1;
  }

  return { cases: count };
}

function createPageAssertion(html: string): PageAssertion {
  return {
    fragment(target: string): string {
      const explicitFragment = explicitFragmentHtml(html, target);
      if (explicitFragment !== undefined) return explicitFragment;

      const stampedElement = findFragmentTargetElement(html, target);
      if (!stampedElement) return '';

      const { index, tag } = stampedElement;
      const end = matchingElementEnd(html, tag, index);
      if (end === undefined) return '';

      return html.slice(index, end);
    },
    html,
  };
}

function explicitFragmentHtml(html: string, target: string): string | undefined {
  const fragmentStart = findOpeningElement(
    html,
    (element) =>
      element.tag === 'fw-fragment' && readHtmlAttribute(element.attrs, 'target') === target,
  );
  if (!fragmentStart) return undefined;

  const start = fragmentStart.index;
  const end = matchingElementEnd(html, 'fw-fragment', start);
  if (end === undefined) return undefined;

  return html.slice(fragmentStart.end, end - '</fw-fragment>'.length);
}

interface OpeningElement {
  attrs: string;
  end: number;
  index: number;
  tag: string;
}

function findFragmentTargetElement(html: string, target: string): OpeningElement | undefined {
  return findOpeningElement(html, (element) => {
    const fragmentTarget = readHtmlAttribute(element.attrs, 'fw-fragment-target');
    const id = readHtmlAttribute(element.attrs, 'id');

    // SPEC.md §9.1: fragment chunks address the runtime target by name; the
    // browser runtime resolves that name with id / fw-fragment-target only.
    return fragmentTarget === target || id === target;
  });
}

function findOpeningElement(
  html: string,
  predicate: (element: OpeningElement) => boolean,
): OpeningElement | undefined {
  let offset = 0;

  while (offset < html.length) {
    const start = html.indexOf('<', offset);
    if (start === -1) return undefined;

    const element = readOpeningElement(html, start);
    if (element) {
      if (predicate(element)) return element;
      offset = element.end;
    } else {
      offset = start + 1;
    }
  }

  return undefined;
}

function readOpeningElement(html: string, start: number): OpeningElement | undefined {
  const head = /^<(?<tag>[a-z][a-z0-9-]*)\b/i.exec(html.slice(start));
  if (!head?.groups?.tag) return undefined;

  const close = openingTagClose(html, start + head[0].length);
  if (close === undefined) return undefined;

  return {
    attrs: html.slice(start + head[0].length, close),
    end: close + 1,
    index: start,
    tag: head.groups.tag.toLowerCase(),
  };
}

function openingTagClose(html: string, start: number): number | undefined {
  let quote: '"' | "'" | undefined;

  for (let index = start; index < html.length; index += 1) {
    const char = html[index];

    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '>') return index;
  }

  return undefined;
}

function matchingElementEnd(html: string, tag: string, start: number): number | undefined {
  const tagPattern = new RegExp(`<\\/?${escapeRegExp(tag)}\\b`, 'gi');
  tagPattern.lastIndex = start;
  let depth = 0;

  for (const match of html.matchAll(tagPattern)) {
    const close = openingTagClose(html, match.index + match[0].length);
    if (close === undefined) return undefined;

    const token = html.slice(match.index, close + 1);
    if (token.startsWith('</')) {
      depth -= 1;
      if (depth === 0) return match.index + token.length;
      continue;
    }

    if (/\/\s*>$/.test(token)) {
      if (depth === 0) return match.index + token.length;
      continue;
    }

    depth += 1;
  }

  return undefined;
}

function readHtmlAttribute(attrs: string, name: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\s)${escapeRegExp(name)}(?:\\s*=\\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\\s"'=<>\`]+)))?(?=\\s|$|/)`,
    'i',
  );
  const match = pattern.exec(attrs);
  if (!match) return null;

  return match.groups?.double ?? match.groups?.single ?? match.groups?.bare ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deepEqual(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function formatValue(value: unknown): string {
  return inspect(value, {
    breakLength: Infinity,
    compact: true,
    depth: Infinity,
    sorted: true,
  });
}

function observe(
  kind: ObservedDbOperation['kind'],
  table: string,
  args: readonly unknown[],
  config: DbVerificationConfig,
  observed: ObservedDbOperation[],
): void {
  observed.push({
    branch: observationOptions(args)?.branch,
    domain: config.domainByTable[table],
    kind,
    mutationRead: undefined,
    rowKey: observationOptions(args)?.rowKey,
    sql: undefined,
    table,
  });
}

function observeSql(
  statement: string,
  config: DbVerificationConfig,
  observed: ObservedDbOperation[],
): void {
  for (const operation of parseSqlStatement(statement)) {
    observed.push({
      branch: undefined,
      domain: config.domainByTable[operation.table],
      kind: operation.kind,
      mutationRead: operation.mutationRead,
      rowKey: operation.rowKey,
      sql: statement,
      table: operation.table,
    });
  }
}

function parseSqlStatement(statement: string): ParsedOperation[] {
  return parse(statement).flatMap((parsed) => operationsForStatement(parsed, new Set()));
}

type ParsedOperation = Pick<ObservedDbOperation, 'kind' | 'mutationRead' | 'rowKey' | 'table'>;

function operationsForStatement(
  statement: Statement | WithStatementBinding,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  switch (statement.type) {
    case 'select':
    case 'union':
    case 'union all':
    case 'values':
    case 'with':
    case 'with recursive':
      return operationsForSelect(statement, cteAliases);
    case 'insert':
      return operationsForInsert(statement, cteAliases);
    case 'update':
      return operationsForUpdate(statement, cteAliases);
    case 'delete':
      return operationsForDelete(statement, cteAliases);
    default:
      return [];
  }
}

function operationsForSelect(
  statement: SelectStatement,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  switch (statement.type) {
    case 'select': {
      const rowKey = rowKeyFromWhere(statement.where);
      return [
        ...operationsForFrom(statement.from ?? [], rowKey, cteAliases),
        ...operationsForNestedStatements([statement.columns, statement.where], cteAliases),
      ];
    }
    case 'union':
    case 'union all':
      return [
        ...operationsForSelect(statement.left, cteAliases),
        ...operationsForSelect(statement.right, cteAliases),
      ];
    case 'with':
      return operationsForWith(statement, cteAliases);
    case 'with recursive':
      return operationsForWithRecursive(statement, cteAliases);
    case 'values':
      return [];
  }
}

function operationsForInsert(
  statement: InsertStatement,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  return [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: undefined,
      table: tableName(statement.into),
    },
    ...operationsForSelect(statement.insert, cteAliases).map((operation) => ({
      ...operation,
      mutationRead: operation.kind === 'read' ? true : operation.mutationRead,
    })),
  ];
}

function operationsForUpdate(
  statement: UpdateStatement,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  const rowKey = rowKeyFromWhere(statement.where);
  return [
    { kind: 'write', mutationRead: undefined, rowKey, table: tableName(statement.table) },
    ...operationsForFrom(statement.from ? [statement.from] : [], rowKey, cteAliases).map(
      (operation) => ({
        ...operation,
        mutationRead: operation.kind === 'read' ? true : operation.mutationRead,
      }),
    ),
    ...markMutationReads(
      operationsForNestedStatements([statement.sets, statement.where], cteAliases),
    ),
  ];
}

function operationsForDelete(
  statement: DeleteStatement,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  return [
    {
      kind: 'write',
      mutationRead: undefined,
      rowKey: rowKeyFromWhere(statement.where),
      table: tableName(statement.from),
    },
    ...markMutationReads(operationsForNestedStatements([statement.where], cteAliases)),
  ];
}

function operationsForWith(
  statement: WithStatement,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  const aliases = withAliases(
    cteAliases,
    statement.bind.map((binding) => binding.alias.name),
  );
  return [
    ...statement.bind.flatMap((binding) => operationsForStatement(binding.statement, aliases)),
    ...operationsForStatement(statement.in, aliases),
  ];
}

function operationsForWithRecursive(
  statement: WithRecursiveStatement,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  const aliases = withAliases(cteAliases, [statement.alias.name]);
  return [
    ...operationsForSelect(statement.bind, aliases),
    ...operationsForStatement(statement.in, aliases),
  ];
}

function withAliases(
  currentAliases: ReadonlySet<string>,
  addedAliases: readonly string[],
): ReadonlySet<string> {
  return new Set([...currentAliases, ...addedAliases]);
}

function operationsForFrom(
  from: readonly From[],
  rowKey: string | undefined,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  return from.flatMap((item) => {
    if (item.type === 'table') {
      const table = tableName(item.name);
      return cteAliases.has(table)
        ? []
        : [{ kind: 'read', mutationRead: undefined, rowKey, table }];
    }

    if (item.type === 'statement') {
      return operationsForSelect(item.statement, cteAliases);
    }

    return [];
  });
}

function operationsForNestedStatements(
  values: readonly unknown[],
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  return values.flatMap((value) => operationsForNestedStatement(value, cteAliases));
}

function operationsForNestedStatement(
  value: unknown,
  cteAliases: ReadonlySet<string>,
): ParsedOperation[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => operationsForNestedStatement(item, cteAliases));
  }
  if (!value || typeof value !== 'object') return [];

  if (isSelectStatement(value)) {
    return operationsForSelect(value, cteAliases);
  }

  return Object.values(value).flatMap((item) => operationsForNestedStatement(item, cteAliases));
}

function isSelectStatement(value: object): value is SelectStatement {
  return (
    'type' in value &&
    (value.type === 'select' ||
      value.type === 'union' ||
      value.type === 'union all' ||
      value.type === 'values' ||
      value.type === 'with' ||
      value.type === 'with recursive')
  );
}

function markMutationReads(operations: ParsedOperation[]): ParsedOperation[] {
  return operations.map((operation) => ({
    ...operation,
    mutationRead: operation.kind === 'read' ? true : operation.mutationRead,
  }));
}

function rowKeyFromWhere(where: Expr | null | undefined): string | undefined {
  const keys = where ? [...new Set(rowKeysFromExpr(where))] : [];
  return keys.length > 0 ? keys.join(', ') : undefined;
}

function rowKeysFromExpr(expression: Expr): string[] {
  if (expression.type !== 'binary') return [];

  if (expression.op === '=') {
    const left = refName(expression.left);
    const right = refName(expression.right);
    if (left && !right) return [left];
    if (right && !left) return [right];
    if (left) return [left];
    if (right) return [right];
  }

  return [...rowKeysFromExpr(expression.left), ...rowKeysFromExpr(expression.right)];
}

function refName(expression: Expr): string | undefined {
  return expression.type === 'ref' && expression.name !== '*' ? expression.name : undefined;
}

function tableName(identifier: QName): string {
  return identifier.name;
}

function quoteSqlIdentifier(identifier: string): string {
  return identifier
    .split('.')
    .map((part) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
        throw new Error(`Invalid SQL identifier: ${identifier}`);
      }

      return `"${part.replaceAll('"', '""')}"`;
    })
    .join('.');
}

function assertRowKeys(
  observed: readonly ObservedDbOperation[],
  config: DbVerificationConfig,
): void {
  const mismatches = observed.filter((operation) => {
    const expected = config.keyByTable?.[operation.table];
    return (
      expected !== undefined &&
      operation.rowKey !== undefined &&
      !observedRowKeys(operation).has(expected)
    );
  });

  if (mismatches.length === 0) return;

  const details = mismatches
    .map(
      (operation) =>
        `${operation.table} expected ${config.keyByTable?.[operation.table]} observed ${operation.rowKey}`,
    )
    .join(', ');
  throw new Error(diagnosticMessage('FW408', details));
}

function observedRowKeys(operation: ObservedDbOperation): ReadonlySet<string> {
  return new Set(operation.rowKey?.split(',').map((key) => key.trim()) ?? []);
}

function assertObservedReadsCovered(
  observed: readonly ObservedDbOperation[],
  domains: readonly string[],
  config: DbVerificationConfig,
): void {
  assertRowKeys(observed, config);

  const unmappedReads = observed.filter(
    (operation) => operation.kind === 'read' && operation.domain === undefined,
  );

  if (unmappedReads.length > 0) {
    const tables = unmappedReads.map((operation) => operation.table).join(', ');
    throw new Error(diagnosticMessage('FW407', tables));
  }

  const allowedReads = new Set(domains);
  const uncovered = observed.filter(
    (operation) =>
      operation.kind === 'read' &&
      operation.domain !== undefined &&
      !allowedReads.has(operation.domain),
  );

  if (uncovered.length > 0) {
    const readDomains = uncovered.map((operation) => operation.domain).join(', ');
    throw new Error(diagnosticMessage('FW407', readDomains));
  }
}

function assertMutationReadsCovered(
  observed: readonly ObservedDbOperation[],
  touchGraph: TouchGraph,
): void {
  const unmappedReads = observed.filter(
    (operation) =>
      operation.kind === 'read' &&
      operation.mutationRead === true &&
      operation.domain === undefined,
  );

  if (unmappedReads.length > 0) {
    const tables = unmappedReads.map((operation) => operation.table).join(', ');
    throw new Error(diagnosticMessage('FW407', tables));
  }

  const allowedReads = new Set(
    Object.values(touchGraph).flatMap((entry) => (entry.reads ?? []).map((read) => read.domain)),
  );
  const unresolvedWrites = Object.values(touchGraph).flatMap((entry) => entry.unresolved);
  const unresolvedDomains = new Set(
    unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
  );
  const uncovered = observed.filter(
    (operation) =>
      operation.kind === 'read' &&
      operation.mutationRead === true &&
      operation.domain !== undefined &&
      !allowedReads.has(operation.domain) &&
      !unresolvedDomains.has(operation.domain),
  );

  if (uncovered.length > 0) {
    const readDomains = uncovered.map((operation) => operation.domain).join(', ');
    throw new Error(diagnosticMessage('FW407', readDomains));
  }
}

function diagnosticMessage(code: DiagnosticCode, detail: string): string {
  return `${code} ${trimDiagnosticSentence(diagnosticDefinitions[code].message)}: ${detail}`;
}

function trimDiagnosticSentence(message: string): string {
  return message.endsWith('.') ? message.slice(0, -1) : message;
}

function observationOptions(args: readonly unknown[]): DbObservationOptions | undefined {
  const last = args.at(-1);

  if (typeof last !== 'object' || last === null || (!('branch' in last) && !('rowKey' in last))) {
    return undefined;
  }

  const rowKey = (last as { rowKey?: unknown }).rowKey;
  const branch = (last as { branch?: unknown }).branch;

  return {
    ...(typeof branch === 'string' ? { branch } : {}),
    ...(typeof rowKey === 'string' ? { rowKey } : {}),
  };
}

function hasUnobservedBranch(
  touch: TouchSite,
  observedBranches: ReadonlySet<string>,
): touch is TouchSite & { branch: string } {
  return touch.branch !== undefined && !observedBranches.has(touch.branch);
}
