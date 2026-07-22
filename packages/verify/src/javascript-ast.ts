import type { Node, Program } from 'acorn';

import {
  translationArrayAppend,
  translationArrayIsArray,
  translationArrayLength,
  translationArrayPop,
  translationCreateSet,
  translationNumberIsSafeInteger,
  translationObjectKeys,
  translationOwnDataValue,
  translationParseJavaScriptSource,
  translationSetAdd,
  translationSetHas,
  translationTypeError,
} from './translation-intrinsics.js';

export type JavaScriptAstNode = Node & Record<string, unknown>;

export interface JavaScriptModuleReference {
  importedNames: readonly string[];
  kind: 'dynamic-import' | 'export' | 'import';
  node: JavaScriptAstNode;
  specifier: string | undefined;
}

/** @internal Finite extraction ceiling for one completely parsed emitted module (SPEC §6.6). */
export const MAX_JAVASCRIPT_MODULE_REFERENCES = 32_768;

export interface JavaScriptModuleReferenceCollection {
  limitExceeded: boolean;
  referenceUnits: number;
  references: JavaScriptModuleReference[];
}

interface JavaScriptImportedNames {
  names: string[];
  units: number;
}

/** Parse the complete emitted module with one standards-oriented ESTree parser. */
export function parseJavaScriptModule(source: string): JavaScriptAstNode {
  const program = translationParseJavaScriptSource(source) as Program;
  return program as unknown as JavaScriptAstNode;
}

export function collectJavaScriptModuleReferences(
  program: JavaScriptAstNode,
  maxReferences = MAX_JAVASCRIPT_MODULE_REFERENCES,
): JavaScriptModuleReferenceCollection {
  if (!translationNumberIsSafeInteger(maxReferences) || maxReferences < 0) {
    throw translationTypeError(
      'JavaScript module reference limit must be a non-negative safe integer',
    );
  }
  const references: JavaScriptModuleReference[] = [];
  let referenceUnits = 0;
  let limitExceeded = false;
  walkJavaScriptAst(program, (node) => {
    const remainingNames = maxReferences - referenceUnits - 1;
    let reference: JavaScriptModuleReference | undefined;
    let referenceNameUnits = 0;
    const nodeType = translationOwnDataValue(node, 'type');
    if (nodeType === 'ImportDeclaration') {
      const importedNames = importDeclarationNames(node, remainingNames);
      if (importedNames === undefined) {
        limitExceeded = true;
        return false;
      }
      reference = {
        importedNames: importedNames.names,
        kind: 'import',
        node,
        specifier: staticStringValue(translationOwnDataValue(node, 'source')),
      };
      referenceNameUnits = importedNames.units;
    } else if (
      nodeType === 'ExportNamedDeclaration' &&
      translationOwnDataValue(node, 'source') !== null &&
      translationOwnDataValue(node, 'source') !== undefined
    ) {
      const importedNames = exportDeclarationNames(node, remainingNames);
      if (importedNames === undefined) {
        limitExceeded = true;
        return false;
      }
      reference = {
        importedNames: importedNames.names,
        kind: 'export',
        node,
        specifier: staticStringValue(translationOwnDataValue(node, 'source')),
      };
      referenceNameUnits = importedNames.units;
    } else if (nodeType === 'ExportAllDeclaration') {
      reference = {
        importedNames: ['*'],
        kind: 'export',
        node,
        specifier: staticStringValue(translationOwnDataValue(node, 'source')),
      };
      referenceNameUnits = 1;
    } else if (nodeType === 'ImportExpression') {
      reference = {
        importedNames: ['*'],
        kind: 'dynamic-import',
        node,
        specifier: staticStringValue(translationOwnDataValue(node, 'source')),
      };
      referenceNameUnits = 1;
    }

    if (reference === undefined) return true;
    const units = 1 + referenceNameUnits;
    if (units > maxReferences - referenceUnits) {
      limitExceeded = true;
      return false;
    }
    translationArrayAppend(references, reference);
    referenceUnits += units;
    return true;
  });
  if (limitExceeded) {
    references.length = 0;
    referenceUnits = 0;
  }
  return { limitExceeded, references, referenceUnits };
}

function walkJavaScriptAst(
  root: JavaScriptAstNode,
  visitor: (node: JavaScriptAstNode) => boolean,
): void {
  const stack = [root];
  while (translationArrayLength(stack) > 0) {
    const node = translationArrayPop(stack)!;
    if (!visitor(node)) return;
    const children = childNodes(node);
    for (let index = translationArrayLength(children) - 1; index >= 0; index -= 1) {
      translationArrayAppend(stack, children[index]!);
    }
  }
}

function childNodes(node: JavaScriptAstNode): JavaScriptAstNode[] {
  const children: JavaScriptAstNode[] = [];
  const keys = translationObjectKeys(node);
  for (let keyIndex = 0; keyIndex < translationArrayLength(keys); keyIndex += 1) {
    const key = keys[keyIndex]!;
    if (key === 'end' || key === 'loc' || key === 'range' || key === 'start' || key === 'type') {
      continue;
    }
    const value = translationOwnDataValue(node, key);
    if (isJavaScriptAstNode(value)) {
      translationArrayAppend(children, value);
      continue;
    }
    if (!translationArrayIsArray(value)) continue;
    for (let itemIndex = 0; itemIndex < translationArrayLength(value); itemIndex += 1) {
      const item = translationOwnDataValue(value, itemIndex);
      if (isJavaScriptAstNode(item)) translationArrayAppend(children, item);
    }
  }
  return children;
}

export function isJavaScriptAstNode(value: unknown): value is JavaScriptAstNode {
  if (typeof value !== 'object' || value === null) return false;
  return (
    typeof translationOwnDataValue(value, 'type') === 'string' &&
    typeof translationOwnDataValue(value, 'start') === 'number' &&
    typeof translationOwnDataValue(value, 'end') === 'number'
  );
}

export function staticStringValue(value: unknown): string | undefined {
  if (!isJavaScriptAstNode(value)) return undefined;
  const literalValue = translationOwnDataValue(value, 'value');
  if (translationOwnDataValue(value, 'type') === 'Literal' && typeof literalValue === 'string') {
    return literalValue;
  }
  return undefined;
}

function importDeclarationNames(
  node: JavaScriptAstNode,
  maxNames: number,
): JavaScriptImportedNames | undefined {
  const specifiers = translationOwnDataValue(node, 'specifiers');
  if (!translationArrayIsArray(specifiers)) return { names: [], units: 0 };
  const names: string[] = [];
  for (let index = 0; index < translationArrayLength(specifiers); index += 1) {
    const value = translationOwnDataValue(specifiers, index);
    if (!isJavaScriptAstNode(value)) continue;
    let name: string | undefined;
    const valueType = translationOwnDataValue(value, 'type');
    if (valueType === 'ImportDefaultSpecifier') name = 'default';
    else if (valueType === 'ImportNamespaceSpecifier') name = '*';
    else if (valueType === 'ImportSpecifier') {
      name = identifierOrStringName(translationOwnDataValue(value, 'imported'));
    }
    if (name === undefined) continue;
    if (names.length >= maxNames) return undefined;
    translationArrayAppend(names, name);
  }
  return { names: uniqueStrings(names), units: names.length };
}

function exportDeclarationNames(
  node: JavaScriptAstNode,
  maxNames: number,
): JavaScriptImportedNames | undefined {
  const specifiers = translationOwnDataValue(node, 'specifiers');
  if (!translationArrayIsArray(specifiers) || translationArrayLength(specifiers) === 0) {
    return maxNames >= 1 ? { names: ['*'], units: 1 } : undefined;
  }
  const names: string[] = [];
  for (let index = 0; index < translationArrayLength(specifiers); index += 1) {
    const value = translationOwnDataValue(specifiers, index);
    if (!isJavaScriptAstNode(value)) continue;
    const local = identifierOrStringName(translationOwnDataValue(value, 'local'));
    if (local === undefined) continue;
    if (names.length >= maxNames) return undefined;
    translationArrayAppend(names, local);
  }
  if (names.length > 0) {
    return { names: uniqueStrings(names), units: names.length };
  }
  return maxNames >= 1 ? { names: ['*'], units: 1 } : undefined;
}

function identifierOrStringName(value: unknown): string | undefined {
  if (!isJavaScriptAstNode(value)) return undefined;
  const name = translationOwnDataValue(value, 'name');
  if (translationOwnDataValue(value, 'type') === 'Identifier' && typeof name === 'string') {
    return name;
  }
  return staticStringValue(value);
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = translationCreateSet<string>();
  const result: string[] = [];
  for (let index = 0; index < translationArrayLength(values); index += 1) {
    const value = values[index]!;
    if (translationSetHas(seen, value)) continue;
    translationSetAdd(seen, value);
    translationArrayAppend(result, value);
  }
  return result;
}
