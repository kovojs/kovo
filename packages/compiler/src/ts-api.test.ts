import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  createTypescriptApi,
  getEffectiveConstraintOfTypeParameter,
  hasModifier,
} from './ts-api.js';

describe('TypeScript compiler API compatibility adapter', () => {
  it('reads modifiers and type-parameter constraints through the installed compiler API', () => {
    const { statement, typeParameter } = exportedFunctionFixture();

    expect(hasModifier(statement, ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(getEffectiveConstraintOfTypeParameter(typeParameter)?.kind).toBe(
      ts.SyntaxKind.StringKeyword,
    );
  });

  it('falls back to legacy node fields when versioned helper APIs are absent', () => {
    const { typeParameter } = exportedFunctionFixture();
    const exportModifier = ts.factory.createModifier(ts.SyntaxKind.ExportKeyword);
    const legacyNode = { modifiers: [exportModifier] } as unknown as ts.Node;
    const legacyTs = {
      ...ts,
      canHaveModifiers: undefined,
      getEffectiveConstraintOfTypeParameter: undefined,
      getModifiers: undefined,
    } as unknown as typeof ts;

    const api = createTypescriptApi(legacyTs);

    expect(api.canHaveModifiers(legacyNode)).toBe(true);
    expect(api.getModifiers(legacyNode)).toEqual([exportModifier]);
    expect(api.hasModifier(legacyNode, ts.SyntaxKind.ExportKeyword)).toBe(true);
    expect(api.getEffectiveConstraintOfTypeParameter(typeParameter)).toBe(typeParameter.constraint);
  });
});

function exportedFunctionFixture(): {
  statement: ts.FunctionDeclaration;
  typeParameter: ts.TypeParameterDeclaration;
} {
  const sourceFile = ts.createSourceFile(
    'fixture.ts',
    'export function example<T extends string>() {}',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isFunctionDeclaration(statement)) {
    throw new Error('expected fixture function declaration');
  }
  const typeParameter = statement.typeParameters?.[0];
  if (!typeParameter) throw new Error('expected fixture type parameter');
  return { statement, typeParameter };
}
