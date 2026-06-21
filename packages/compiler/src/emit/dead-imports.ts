import * as ts from 'typescript';

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
  const referenced = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) referenced.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const replacements: SourceReplacement[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;

    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    const unused = namedBindings.elements.filter((element) => !referenced.has(element.name.text));
    if (unused.length === 0) continue;

    if (unused.length === namedBindings.elements.length) {
      replacements.push(
        importClause?.name === undefined
          ? removeStatementReplacement(source, statement, sourceFile)
          : removeNamedBindingsReplacement(importClause.name, namedBindings),
      );
      continue;
    }

    for (const run of contiguousImportSpecifierRuns(unused, namedBindings.elements)) {
      replacements.push(removeNamedImportRunReplacement(run, namedBindings.elements, sourceFile));
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
  if (source[end] === '\r') end += 1;
  if (source[end] === '\n') end += 1;

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

  for (const element of elements) {
    const index = allElements.indexOf(element);
    if (current.length > 0 && index !== previousIndex + 1) {
      runs.push(current);
      current = [];
    }
    current.push(element);
    previousIndex = index;
  }

  if (current.length > 0) runs.push(current);

  return runs;
}

function removeNamedImportRunReplacement(
  run: readonly ts.ImportSpecifier[],
  elements: ts.NodeArray<ts.ImportSpecifier>,
  sourceFile: ts.SourceFile,
): SourceReplacement {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  const firstIndex = elements.indexOf(first);
  const lastIndex = elements.indexOf(last);
  const start = first.getStart(sourceFile);

  if (lastIndex < elements.length - 1) {
    return {
      end: elements[lastIndex + 1]!.getStart(sourceFile),
      replacement: '',
      start,
    };
  }

  return {
    end: last.getEnd(),
    replacement: '',
    start: elements[firstIndex - 1]!.getEnd(),
  };
}
