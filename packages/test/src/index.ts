export type { DiagnosticCode } from '@jiso/core';
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
}

export interface PageAssertion {
  fragment(target: string): string;
  html: string;
}

export function createJisoTestHarness<Db>(
  options: JisoTestHarnessOptions<Db>,
): JisoTestContext<Db> {
  return {
    db: options.db,
    exec(mutation, input) {
      return runMutation(mutation, input, { db: options.db });
    },
    async page(path) {
      const page = options.pages?.[path];
      if (!page) throw new Error(`Page fixture not found: ${path}`);

      const html = typeof page === 'function' ? await page() : page;
      return createPageAssertion(html);
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
