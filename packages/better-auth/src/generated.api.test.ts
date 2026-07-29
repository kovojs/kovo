import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('./internal/runtime-lock.js', () => ({
  assertBetterAuthRuntimeRealmLocked: vi.fn(),
}));

import * as rootApi from './index.js';
import type {
  BetterAuthBindings,
  BetterAuthBindingsOptions,
  BetterAuthDevelopmentSeed,
  BetterAuthGeneratedRequest,
  BetterAuthPostgresBindings,
  BetterAuthPostgresBindingsOptions,
  BetterAuthPostgresSecret,
  BetterAuthSqliteBindings,
  BetterAuthSqliteBindingsOptions,
  BetterAuthSqliteDevelopmentSeed,
  BetterAuthSqliteSecret,
} from './generated.js';

interface TestRequest extends BetterAuthGeneratedRequest {
  session?: { id: string } | null;
}

interface TestSession {
  id: string;
}

type RemovedRootPostgresBindings =
  // @ts-expect-error Generated backend assembly is not part of the human root.
  import('@kovojs/better-auth').BetterAuthPostgresBindings;
type RemovedRootSqliteFactory =
  // @ts-expect-error Generated backend assembly is not part of the human root.
  typeof import('@kovojs/better-auth').createBetterAuthSqliteBindingsFromEnvironment;
type RemovedRootBindingRequest =
  // @ts-expect-error Internal request carriers are not part of the human root.
  import('@kovojs/better-auth').BetterAuthBindingRequest;

describe('Better Auth task API topology', () => {
  it('keeps the human root limited to guards, env/CSRF, mount, and mature workflows', () => {
    expect(Object.keys(rootApi).sort()).toEqual([
      'authed',
      'betterAuthCsrfFromEnvironment',
      'betterAuthPasswordResetMailDoor',
      'mount',
      'role',
    ]);
    expect(rootApi).not.toHaveProperty('createBetterAuthPostgresBindings');
    expect(rootApi).not.toHaveProperty('createBetterAuthSqliteBindingsFromEnvironment');
  });

  it('publishes backend constructors only through the compiler-generated boundary', () => {
    expect(runtimeExports(new URL('./generated.ts', import.meta.url))).toEqual([]);
    expect(runtimeExports(new URL('./generated-postgres.ts', import.meta.url))).toEqual([
      'betterAuthPostgresSecret',
      'createBetterAuthPostgresBindings',
      'createBetterAuthPostgresBindingsFromEnvironment',
    ]);
    expect(runtimeExports(new URL('./generated-sqlite.ts', import.meta.url))).toEqual([
      'betterAuthSqliteSecret',
      'createBetterAuthSqliteBindings',
      'createBetterAuthSqliteBindingsFromEnvironment',
    ]);
  });

  it('converges Postgres and SQLite on one backend-neutral result and option topology', () => {
    expectTypeOf<BetterAuthPostgresBindings<TestRequest, TestSession>>().toEqualTypeOf<
      BetterAuthBindings<TestRequest, TestSession>
    >();
    expectTypeOf<BetterAuthSqliteBindings<TestRequest, TestSession>>().toEqualTypeOf<
      BetterAuthBindings<TestRequest, TestSession>
    >();
    expectTypeOf<BetterAuthSqliteDevelopmentSeed>().toEqualTypeOf<BetterAuthDevelopmentSeed>();

    expectTypeOf<BetterAuthPostgresBindingsOptions<TestRequest, TestSession>>().toEqualTypeOf<
      BetterAuthBindingsOptions<TestRequest, TestSession, BetterAuthPostgresSecret>
    >();
    expectTypeOf<BetterAuthSqliteBindingsOptions<TestRequest, TestSession>>().toEqualTypeOf<
      BetterAuthBindingsOptions<TestRequest, TestSession, BetterAuthSqliteSecret>
    >();

    // The generated ABI never spells the server's internal nominal system-DB carrier. Runtime
    // witness lookup remains the authority proof; backend-specific validated secrets stay precise.
    expectTypeOf<
      BetterAuthPostgresBindingsOptions<TestRequest, TestSession>['systemDb']
    >().toEqualTypeOf<unknown>();
    expectTypeOf<
      BetterAuthBindingsOptions<TestRequest, TestSession, BetterAuthPostgresSecret>
    >().not.toEqualTypeOf<
      BetterAuthBindingsOptions<TestRequest, TestSession, BetterAuthSqliteSecret>
    >();
  });
});

function runtimeExports(path: URL): string[] {
  const sourceFile = ts.createSourceFile(
    path.pathname,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      if (!element.isTypeOnly) names.push(element.name.text);
    }
  }
  return names.sort();
}
