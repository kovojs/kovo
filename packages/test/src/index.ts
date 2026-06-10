export type { DiagnosticCode } from '@jiso/core';
import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';
import type { TouchGraph, TouchSite } from '@jiso/drizzle';
import {
  type InferSchema,
  type MutationDefinition,
  type MutationResult,
  type Schema,
  runMutation,
} from '@jiso/server';

export interface JisoTestContext<Db = unknown> {
  db: Db;
  dbHandle(): Db;
  exec: <
    InputSchema extends Schema<unknown>,
    Errors extends Record<string, Schema<unknown>>,
    Request extends { db: Db },
    Value,
  >(
    mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>,
    input: unknown,
  ) => Promise<MutationResult<Value>>;
  page: (path: string) => Promise<PageAssertion>;
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
      Request extends { db: Db },
      Value,
    >(mutation: MutationDefinition<string, InputSchema, Errors, Request, Value>, input: unknown) {
      const result = await runMutation(mutation, input, {
        ...options.request,
        db,
      } as unknown as Request);
      verifier?.assertCovered();
      return result;
    },
    async page(path) {
      const page = options.pages?.[path];
      if (!page) throw new Error(`Page fixture not found: ${path}`);

      const html = typeof page === 'function' ? await page() : page;
      return createPageAssertion(html);
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
  assertCovered(): void;
  assertReadsCovered(domains: readonly string[]): void;
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
    assertCovered(): void {
      assertRowKeys(observed, config);

      const unmappedWrites = observed.filter(
        (operation) => operation.kind === 'write' && operation.domain === undefined,
      );

      if (unmappedWrites.length > 0) {
        const tables = unmappedWrites.map((operation) => operation.table).join(', ');
        throw new Error(`FW404 Write to unmapped table: ${tables}`);
      }

      const allowedWrites = new Set(
        Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
      );
      const unresolvedWrites = Object.values(touchGraph).flatMap((entry) => entry.unresolved);
      const unresolvedDomains = new Set(
        unresolvedWrites.flatMap((site) => (site.domain ? [site.domain] : [])),
      );
      const hasUnscopedFw406 = unresolvedWrites.some((site) => site.domain === undefined);
      const uncovered = observed.filter(
        (operation) =>
          operation.kind === 'write' &&
          operation.domain !== undefined &&
          !allowedWrites.has(operation.domain) &&
          !hasUnscopedFw406 &&
          !unresolvedDomains.has(operation.domain),
      );

      if (uncovered.length > 0) {
        const domains = uncovered.map((operation) => operation.domain).join(', ');
        throw new Error(`FW402 Write touched an undeclared domain: ${domains}`);
      }
    },
    assertReadsCovered(domains: readonly string[]): void {
      assertRowKeys(observed, config);

      const unmappedReads = observed.filter(
        (operation) => operation.kind === 'read' && operation.domain === undefined,
      );

      if (unmappedReads.length > 0) {
        const tables = unmappedReads.map((operation) => operation.table).join(', ');
        throw new Error(`FW407 Query read from undeclared domain: ${tables}`);
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
        throw new Error(`FW407 Query read from undeclared domain: ${readDomains}`);
      }
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
            return (statement: string, ...args: unknown[]) => {
              observeSql(statement, config, observed);
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

export async function jisoTest<Db>(
  _name: string,
  fn: (ctx: JisoTestContext<Db>) => void | Promise<void>,
  options: JisoTestHarnessOptions<Db>,
): Promise<void> {
  await fn(createJisoTestHarness(options));
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
        `Optimistic property failed for case ${count}: predicted ${JSON.stringify(
          predicted,
        )}, eventual ${JSON.stringify(eventual)}`,
      );
    }

    count += 1;
  }

  return { cases: count };
}

function createPageAssertion(html: string): PageAssertion {
  return {
    fragment(target: string): string {
      const escapedTarget = escapeRegExp(target);
      const explicitFragment = new RegExp(
        `<fw-fragment\\b[^>]*target="${escapedTarget}"[^>]*>(?<html>[\\s\\S]*?)<\\/fw-fragment>`,
      ).exec(html)?.groups?.html;
      if (explicitFragment !== undefined) return explicitFragment;

      const stampedElement = new RegExp(
        `<(?<tag>[a-z][a-z0-9-]*)\\b[^>]*(?:fw-c="${escapedTarget}"|fw-deps="[^"]*")`,
      ).exec(html);
      if (!stampedElement?.groups?.tag) return '';

      const tag = stampedElement.groups.tag;
      const start = stampedElement.index;
      const end = html.indexOf(`</${tag}>`, start);
      if (end < 0) return '';

      return html.slice(start, end + tag.length + 3);
    },
    html,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
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
      rowKey: operation.rowKey,
      sql: statement,
      table: operation.table,
    });
  }
}

function parseSqlStatement(
  statement: string,
): Array<Pick<ObservedDbOperation, 'kind' | 'rowKey' | 'table'>> {
  const normalized = statement.replaceAll(/--.*$/gm, ' ').replaceAll(/\s+/g, ' ').trim();
  const verb = /^[a-z]+/i.exec(normalized)?.[0]?.toLowerCase();
  const rowKey = parseWhereRowKey(normalized);

  if (verb === 'insert') {
    const table = /\binsert\s+into\s+("?[\w.]+"?)/i.exec(normalized)?.[1];
    return table ? [{ kind: 'write', rowKey, table: normalizeSqlIdentifier(table) }] : [];
  }

  if (verb === 'update') {
    const table = /\bupdate\s+("?[\w.]+"?)/i.exec(normalized)?.[1];
    return table ? [{ kind: 'write', rowKey, table: normalizeSqlIdentifier(table) }] : [];
  }

  if (verb === 'delete') {
    const table = /\bdelete\s+from\s+("?[\w.]+"?)/i.exec(normalized)?.[1];
    return table ? [{ kind: 'write', rowKey, table: normalizeSqlIdentifier(table) }] : [];
  }

  if (verb === 'select') {
    const tables = new Set<string>();

    for (const match of normalized.matchAll(/\b(?:from|join)\s+("?[\w.]+"?)/gi)) {
      tables.add(normalizeSqlIdentifier(match[1] ?? ''));
    }

    return [...tables].filter(Boolean).map((table) => ({ kind: 'read', rowKey, table }));
  }

  return [];
}

function parseWhereRowKey(statement: string): string | undefined {
  const where = /\bwhere\s+([\s\S]+)$/i.exec(statement)?.[1];
  if (!where) return undefined;

  const predicate =
    /(?:"?[\w.]+"?\.)?"?([a-z_][\w]*)"?\s*=\s*(?:\$[0-9]+|\?|:[a-z_][\w]*|'[^']*'|[0-9]+)/i.exec(
      where,
    );

  return predicate?.[1];
}

function normalizeSqlIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '').split('.').at(-1) ?? identifier;
}

function assertRowKeys(
  observed: readonly ObservedDbOperation[],
  config: DbVerificationConfig,
): void {
  const mismatches = observed.filter((operation) => {
    const expected = config.keyByTable?.[operation.table];
    return (
      expected !== undefined && operation.rowKey !== undefined && operation.rowKey !== expected
    );
  });

  if (mismatches.length === 0) return;

  const details = mismatches
    .map(
      (operation) =>
        `${operation.table} expected ${config.keyByTable?.[operation.table]} observed ${operation.rowKey}`,
    )
    .join(', ');
  throw new Error(`FW408 Declared row key differs from observed row predicate: ${details}`);
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
