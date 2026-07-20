import { assertRegisteredDiagnostic, type RegisteredDiagnostic } from '../diagnostics.js';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { importSpecifier, jsIdentifier, jsStringLiteral, tsPropertyKey } from './emission.js';

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    'generated/security-emission.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function stringLeaves(sourceFile: ts.SourceFile, value: string): ts.StringLiteral[] {
  const leaves: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && node.text === value) leaves.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return leaves;
}

function captureDiagnostic(run: () => unknown): RegisteredDiagnostic<'KV451'> {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(TypeError);
    const diagnostic = (error as { diagnostic?: unknown }).diagnostic;
    assertRegisteredDiagnostic(diagnostic, 'Structural emission test diagnostic');
    expect(diagnostic.code).toBe('KV451');
    return diagnostic as RegisteredDiagnostic<'KV451'>;
  }
  throw new Error('Expected structural emission to fail closed.');
}

describe('structural source emission constructors (SPEC §5.2)', () => {
  it('emits valid values for every structural source grammar role', () => {
    expect(jsStringLiteral('line\n"quoted"')).toBe('"line\\n\\"quoted\\""');
    expect(jsIdentifier('Δvalue')).toBe('Δvalue');
    expect(tsPropertyKey('default')).toBe('default');
    expect(tsPropertyKey('cart/add')).toBe('"cart/add"');
    expect(importSpecifier('../../app.js')).toBe("'../../app.js'");

    const source = [
      `import type {} from ${importSpecifier('../../app.js')};`,
      `const ${jsIdentifier('Δvalue')} = ${jsStringLiteral('safe')};`,
      `interface Registry { ${tsPropertyKey('cart/add')}: unknown }`,
    ].join('\n');
    expect(parse(source).parseDiagnostics).toEqual([]);
  });

  it('rejects malformed grammar roles with registered KV451', () => {
    const hostileIdentifier = captureDiagnostic(() => jsIdentifier("safe; import 'owned'"));
    expect(hostileIdentifier.code).toBe('KV451');
    const reservedIdentifier = captureDiagnostic(() => jsIdentifier('import'));
    const emptySpecifier = captureDiagnostic(() => importSpecifier(''));
    const nulSpecifier = captureDiagnostic(() => importSpecifier('./safe\0owned.js'));
    const wrongType = captureDiagnostic(() => jsStringLiteral({ value: 'forged' }));

    for (const diagnostic of [
      hostileIdentifier,
      reservedIdentifier,
      emptySpecifier,
      nulSpecifier,
      wrongType,
    ]) {
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.help).toContain('Would lower to:');
      expect(diagnostic.message).toContain('structural source-emission grammar');
    }
  });

  it('confines hostile data to one parse-tree leaf in every data-bearing role', () => {
    const hostile = "safe'; interface Injected { owned: true } //\n\u2028\ud800";
    const sources = [
      `const value = ${jsStringLiteral(hostile)};`,
      `interface Registry { ${tsPropertyKey(hostile)}: unknown }`,
      `import type {} from ${importSpecifier(hostile)};`,
    ];

    for (const source of sources) {
      const parsed = parse(source);
      const leaves = stringLeaves(parsed, hostile);
      expect(parsed.parseDiagnostics, source).toEqual([]);
      expect(leaves, source).toHaveLength(1);
      expect(leaves[0]?.getChildCount(parsed), source).toBe(0);
    }
  });

  it('emits __proto__ as a computed key instead of object-literal prototype syntax', () => {
    const parsed = parse(`const record = { ${tsPropertyKey('__proto__')}: true };`);
    const statement = parsed.statements[0];
    expect(statement && ts.isVariableStatement(statement)).toBe(true);
    const declaration =
      statement && ts.isVariableStatement(statement)
        ? statement.declarationList.declarations[0]
        : undefined;
    const initializer = declaration?.initializer;
    const property =
      initializer && ts.isObjectLiteralExpression(initializer)
        ? initializer.properties[0]
        : undefined;

    expect(parsed.parseDiagnostics).toEqual([]);
    expect(property && ts.isPropertyAssignment(property)).toBe(true);
    expect(
      property && ts.isPropertyAssignment(property) && ts.isComputedPropertyName(property.name),
    ).toBe(true);
  });
});
