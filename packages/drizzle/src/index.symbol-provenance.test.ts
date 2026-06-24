import { describe, expect, it } from 'vitest';
import { Node, Project, SyntaxKind } from 'ts-morph';

import {
  extractSymbolicEffectsFromProject,
  joinSymbolProvenance,
  provenServerProvenanceForExpression,
  symbolProvenanceContextForNodes,
  symbolProvenanceForExpression,
} from '@kovojs/drizzle/internal/static';
import { pgDatabaseTypes } from './test-helpers.js';

describe('@kovojs/drizzle symbol provenance', () => {
  it('tracks input aliases, destructuring, server aliases, and fail-closed joins', () => {
    const sourceFile = source(`
      export function handler(input: { id: string; ownerId: string }, request: { session: { userId: string } }) {
        const id = input.id;
        const { ownerId } = input;
        const sessionUserId = request.session.userId;
        const literal = "public";
        const mixed = true ? ownerId : sessionUserId;
        const computed = decorate(ownerId);
        const payload = { id, literal };
        return { id, ownerId, sessionUserId, literal, mixed, computed, payload };
      }
    `);
    const body = functionBody(sourceFile, 'handler');
    const input = parameter(sourceFile, 'handler', 'input');
    const request = parameter(sourceFile, 'handler', 'request');
    const context = symbolProvenanceContextForNodes([body], {
      inputRoots: [input.getNameNode()],
      serverRoots: [request.getNameNode()],
    });

    expect(provenance(sourceFile, context, 'id')).toEqual({ kind: 'input', path: 'id' });
    expect(provenance(sourceFile, context, 'ownerId')).toEqual({
      kind: 'input',
      path: 'ownerId',
    });
    expect(provenance(sourceFile, context, 'sessionUserId')).toEqual({
      kind: 'server',
      path: 'session.userId',
    });
    expect(provenance(sourceFile, context, 'literal')).toEqual({ kind: 'literal' });
    expect(provenance(sourceFile, context, 'mixed')).toEqual({ kind: 'input' });
    expect(provenance(sourceFile, context, 'computed')).toEqual({ kind: 'unknown' });
    expect(provenance(sourceFile, context, 'payload')).toEqual({ kind: 'input' });
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'sessionUserId'), context),
    ).toEqual({
      kind: 'server',
      path: 'session.userId',
    });
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'id'), context),
    ).toBeUndefined();
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'computed'), context),
    ).toBeUndefined();
    expect(
      provenServerProvenanceForExpression(returned(sourceFile, 'mixed'), context),
    ).toBeUndefined();
  });

  it('joins unknown as fail-closed and otherwise prefers input over server over literal', () => {
    expect(
      joinSymbolProvenance(
        { kind: 'literal' },
        { kind: 'server', path: 'session.userId' },
        { kind: 'input', path: 'ownerId' },
      ),
    ).toEqual({ kind: 'input' });
    expect(joinSymbolProvenance({ kind: 'server' }, { kind: 'literal' })).toEqual({
      kind: 'server',
    });
    expect(joinSymbolProvenance({ kind: 'input', path: 'id' }, { kind: 'unknown' })).toEqual({
      kind: 'unknown',
    });
  });

  it('feeds symbolic write effects through aliased and destructured input provenance', () => {
    const effects = extractSymbolicEffectsFromProject({
      files: [
        pgDatabaseTypes([
          'insert(table: unknown): { values(value: unknown): Promise<void> };',
          'update(table: unknown): { set(value: unknown): { where(value: unknown): Promise<void> } };',
        ]),
        {
          fileName: 'account.domain.ts',
          source: [
            'import { eq } from "drizzle-orm";',
            'import type { PgDatabase } from "drizzle-orm/pg-core";',
            '',
            'export const accounts = pgTable("accounts", {}, kovo({ domain: "account", key: "id" }));',
            'const accountTable = accounts;',
            '',
            'export async function saveAccount(db: PgDatabase, input: { id: string; ownerId: string }) {',
            '  const id = input.id;',
            '  const { ownerId } = input;',
            '  const ambiguous = true ? id : ownerId;',
            '  await db.insert(accountTable).values({ id, ownerId });',
            '  await db.update(accountTable).set({ ownerId }).where(eq(accountTable.id, id));',
            '  await db.insert(accountTable).values({ id: ambiguous });',
            '}',
          ].join('\n'),
        },
      ],
    }).map((fact) => fact.effect);

    expect(effects).toEqual([
      {
        op: 'insert',
        table: 'accounts',
        values: {
          id: { kind: 'param', path: 'id' },
          ownerId: { kind: 'param', path: 'ownerId' },
        },
      },
      {
        match: { eq: [{ column: 'id', value: { kind: 'param', path: 'id' } }], kind: 'keys' },
        op: 'update',
        sets: { ownerId: { kind: 'param', path: 'ownerId' } },
        table: 'accounts',
      },
      {
        op: 'insert',
        table: 'accounts',
        values: { id: { expr: 'ambiguous', kind: 'opaque' } },
      },
    ]);
  });
});

function source(sourceText: string) {
  const project = new Project({
    compilerOptions: { module: 99, moduleResolution: 2, target: 99 },
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile('fixture.ts', sourceText);
}

function functionBody(sourceFile: ReturnType<typeof source>, name: string): Node {
  const declaration = sourceFile.getFunctionOrThrow(name);
  return declaration.getBodyOrThrow();
}

function parameter(sourceFile: ReturnType<typeof source>, fnName: string, paramName: string) {
  return sourceFile
    .getFunctionOrThrow(fnName)
    .getParameters()
    .find((param) => param.getName() === paramName)!;
}

function provenance(
  sourceFile: ReturnType<typeof source>,
  context: Parameters<typeof symbolProvenanceForExpression>[1],
  identifier: string,
) {
  return symbolProvenanceForExpression(returned(sourceFile, identifier), context);
}

function returned(sourceFile: ReturnType<typeof source>, identifier: string) {
  const shorthand = sourceFile
    .getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)
    .find((node) => node.getName() === identifier);
  if (!shorthand) throw new Error(`missing returned shorthand ${identifier}`);
  const expression = shorthand.getNameNode();
  expect(Node.isIdentifier(expression)).toBe(true);
  return expression;
}
