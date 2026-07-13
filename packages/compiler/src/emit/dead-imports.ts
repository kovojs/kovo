import * as ts from 'typescript';

import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerStringCharCodeAt,
} from '../compiler-security-intrinsics.js';
import { applySourceReplacements, type SourceReplacement } from '../shared.js';

/**
 * @internal FN4 (plans/compiler-refactoring.md): a terminal emit transform that strips
 * named imports left unreferenced after lowering rewrote the module body. Relocated out
 * of `compile.ts` because it is an emit concern, not pipeline sequencing. Pure
 * string -> string; the single `ts.createSourceFile` reparse here is a known rule-9 site
 * tracked by FN7.
 */
export function removeUnreferencedNamedImports(source: string): string {
  const sourceFile = ts.createSourceFile(
    'lowered.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const referenced = compilerCreateSet<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) compilerSetAdd(referenced, node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const replacements: SourceReplacement[] = [];
  const statementLength = compilerArrayLength(
    sourceFile.statements,
    'Dead-import source statements',
  );
  for (let statementIndex = 0; statementIndex < statementLength; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Dead-import source statements',
    ) as ts.Statement;
    if (!ts.isImportDeclaration(statement)) continue;

    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    const unused: ts.ImportSpecifier[] = [];
    const elementLength = compilerArrayLength(namedBindings.elements, 'Dead-import named bindings');
    for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
      const element = compilerOwnDataValue(
        namedBindings.elements,
        elementIndex,
        'Dead-import named bindings',
      ) as ts.ImportSpecifier;
      if (!compilerSetHas(referenced, element.name.text)) {
        compilerArrayAppend(unused, element, 'Dead-import unused bindings');
      }
    }
    if (unused.length === 0) continue;

    if (unused.length === elementLength) {
      compilerArrayAppend(
        replacements,
        importClause?.name === undefined
          ? removeStatementReplacement(source, statement, sourceFile)
          : removeNamedBindingsReplacement(importClause.name, namedBindings),
        'Dead-import replacements',
      );
      continue;
    }

    const runs = contiguousImportSpecifierRuns(unused, namedBindings.elements);
    const runLength = compilerArrayLength(runs, 'Dead-import binding runs');
    for (let runIndex = 0; runIndex < runLength; runIndex += 1) {
      compilerArrayAppend(
        replacements,
        removeNamedImportRunReplacement(
          compilerOwnDataValue(runs, runIndex, 'Dead-import binding runs') as ts.ImportSpecifier[],
          namedBindings.elements,
          sourceFile,
        ),
        'Dead-import replacements',
      );
    }
  }

  return replacements.length === 0 ? source : applySourceReplacements(source, replacements);
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return true;

  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodSignature(parent) && parent.name === node) return false;
  if (ts.isGetAccessor(parent) && parent.name === node) return false;
  if (ts.isSetAccessor(parent) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  if (ts.isClassDeclaration(parent) && parent.name === node) return false;
  if (ts.isInterfaceDeclaration(parent) && parent.name === node) return false;
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;

  return true;
}

function removeStatementReplacement(
  source: string,
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
): SourceReplacement {
  let end = statement.getEnd();
  if (compilerStringCharCodeAt(source, end) === 13) end += 1;
  if (compilerStringCharCodeAt(source, end) === 10) end += 1;

  return {
    end,
    replacement: '',
    start: statement.getStart(sourceFile),
  };
}

function removeNamedBindingsReplacement(
  defaultImport: ts.Identifier,
  namedBindings: ts.NamedImports,
): SourceReplacement {
  return {
    end: namedBindings.getEnd(),
    replacement: '',
    start: defaultImport.getEnd(),
  };
}

function contiguousImportSpecifierRuns(
  elements: readonly ts.ImportSpecifier[],
  allElements: ts.NodeArray<ts.ImportSpecifier>,
): ts.ImportSpecifier[][] {
  const runs: ts.ImportSpecifier[][] = [];
  let current: ts.ImportSpecifier[] = [];
  let previousIndex = -2;

  const elementLength = compilerArrayLength(elements, 'Dead-import unused bindings');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Dead-import unused bindings',
    ) as ts.ImportSpecifier;
    const index = indexOfImportSpecifier(allElements, element);
    if (current.length > 0 && index !== previousIndex + 1) {
      compilerArrayAppend(runs, current, 'Dead-import binding runs');
      current = [];
    }
    compilerArrayAppend(current, element, 'Dead-import binding run');
    previousIndex = index;
  }

  if (current.length > 0) compilerArrayAppend(runs, current, 'Dead-import binding runs');

  return runs;
}

function indexOfImportSpecifier(
  elements: readonly ts.ImportSpecifier[],
  expected: ts.ImportSpecifier,
): number {
  const length = compilerArrayLength(elements, 'Dead-import named bindings');
  for (let index = 0; index < length; index += 1) {
    if (compilerOwnDataValue(elements, index, 'Dead-import named bindings') === expected) {
      return index;
    }
  }
  return -1;
}

function removeNamedImportRunReplacement(
  run: readonly ts.ImportSpecifier[],
  elements: ts.NodeArray<ts.ImportSpecifier>,
  sourceFile: ts.SourceFile,
): SourceReplacement {
  const runLength = compilerArrayLength(run, 'Dead-import binding run');
  const first = compilerOwnDataValue(run, 0, 'Dead-import binding run') as ts.ImportSpecifier;
  const last = compilerOwnDataValue(
    run,
    runLength - 1,
    'Dead-import binding run',
  ) as ts.ImportSpecifier;
  const firstIndex = indexOfImportSpecifier(elements, first);
  const lastIndex = indexOfImportSpecifier(elements, last);
  const start = first.getStart(sourceFile);

  const elementLength = compilerArrayLength(elements, 'Dead-import named bindings');
  if (lastIndex < elementLength - 1) {
    return {
      end: (
        compilerOwnDataValue(
          elements,
          lastIndex + 1,
          'Dead-import named bindings',
        ) as ts.ImportSpecifier
      ).getStart(sourceFile),
      replacement: '',
      start,
    };
  }

  return {
    end: last.getEnd(),
    replacement: '',
    start: (
      compilerOwnDataValue(
        elements,
        firstIndex - 1,
        'Dead-import named bindings',
      ) as ts.ImportSpecifier
    ).getEnd(),
  };
}
