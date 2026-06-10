export type { DiagnosticCode } from '@jiso/core';
import type { TouchGraph } from '@jiso/drizzle';
import {
  type MutationDefinition,
  type MutationResult,
  type Schema,
  runMutation,
} from '@jiso/server';

export interface JisoTestContext<Db = unknown> {
  db: Db;
  exec: <Value>(
    mutation: MutationDefinition<
      string,
      Schema<unknown>,
      Record<string, Schema<unknown>>,
      JisoTestRequest<Db>,
      Value
    >,
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

  return {
    db: verifier ? (verifier.wrap(options.db) as Db) : options.db,
    async exec(mutation, input) {
      const db = verifier ? (verifier.wrap(options.db) as Db) : options.db;
      const result = await runMutation(mutation, input, { db });
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
}

export interface ObservedDbOperation {
  domain: string;
  kind: 'read' | 'write';
  table: string;
}

export interface DbVerifier {
  assertCovered(): void;
  observed: readonly ObservedDbOperation[];
  wrap<Db>(db: Db): Db;
}

export function createDbVerifier(touchGraph: TouchGraph, config: DbVerificationConfig): DbVerifier {
  const observed: ObservedDbOperation[] = [];

  return {
    assertCovered(): void {
      const allowedWrites = new Set(
        Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
      );
      const hasFw406 = Object.values(touchGraph).some((entry) => entry.unresolved.length > 0);
      const uncovered = observed.filter(
        (operation) =>
          operation.kind === 'write' && !allowedWrites.has(operation.domain) && !hasFw406,
      );

      if (uncovered.length > 0) {
        const domains = uncovered.map((operation) => operation.domain).join(', ');
        throw new Error(`Observed write outside static touch graph: ${domains}`);
      }
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
              observe('read', table, config, observed);
              return value.call(target, table, ...args);
            };
          }

          if (prop === 'write' && typeof value === 'function') {
            return (table: string, ...args: unknown[]) => {
              observe('write', table, config, observed);
              return value.call(target, table, ...args);
            };
          }

          return value;
        },
      });

      return proxy as Db;
    },
  };
}

export async function jisoTest<Db>(
  _name: string,
  fn: (ctx: JisoTestContext<Db>) => void | Promise<void>,
  options: JisoTestHarnessOptions<Db>,
): Promise<void> {
  await fn(createJisoTestHarness(options));
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

function observe(
  kind: ObservedDbOperation['kind'],
  table: string,
  config: DbVerificationConfig,
  observed: ObservedDbOperation[],
): void {
  observed.push({
    domain: config.domainByTable[table] ?? table,
    kind,
    table,
  });
}
