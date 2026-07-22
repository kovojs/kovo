import { parse, type Node, type Program } from 'acorn';

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
  const program = parse(source, {
    allowHashBang: true,
    ecmaVersion: 'latest',
    sourceType: 'module',
  }) as Program;
  return program as unknown as JavaScriptAstNode;
}

export function collectJavaScriptModuleReferences(
  program: JavaScriptAstNode,
  maxReferences = MAX_JAVASCRIPT_MODULE_REFERENCES,
): JavaScriptModuleReferenceCollection {
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 0) {
    throw new TypeError('JavaScript module reference limit must be a non-negative safe integer');
  }
  const references: JavaScriptModuleReference[] = [];
  let referenceUnits = 0;
  let limitExceeded = false;
  walkJavaScriptAst(program, (node) => {
    const remainingNames = maxReferences - referenceUnits - 1;
    let reference: JavaScriptModuleReference | undefined;
    let referenceNameUnits = 0;
    if (node.type === 'ImportDeclaration') {
      const importedNames = importDeclarationNames(node, remainingNames);
      if (importedNames === undefined) {
        limitExceeded = true;
        return false;
      }
      reference = {
        importedNames: importedNames.names,
        kind: 'import',
        node,
        specifier: staticStringValue(node.source),
      };
      referenceNameUnits = importedNames.units;
    } else if (
      node.type === 'ExportNamedDeclaration' &&
      node.source !== null &&
      node.source !== undefined
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
        specifier: staticStringValue(node.source),
      };
      referenceNameUnits = importedNames.units;
    } else if (node.type === 'ExportAllDeclaration') {
      reference = {
        importedNames: ['*'],
        kind: 'export',
        node,
        specifier: staticStringValue(node.source),
      };
      referenceNameUnits = 1;
    } else if (node.type === 'ImportExpression') {
      reference = {
        importedNames: ['*'],
        kind: 'dynamic-import',
        node,
        specifier: staticStringValue(node.source),
      };
      referenceNameUnits = 1;
    }

    if (reference === undefined) return true;
    const units = 1 + referenceNameUnits;
    if (units > maxReferences - referenceUnits) {
      limitExceeded = true;
      return false;
    }
    references.push(reference);
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
  if (!visitor(root)) return;
  const stack = [childNodes(root)];
  while (stack.length > 0) {
    const next = stack.at(-1)!.next();
    if (next.done) {
      stack.pop();
      continue;
    }
    if (!visitor(next.value)) return;
    stack.push(childNodes(next.value));
  }
}

function* childNodes(node: JavaScriptAstNode): Generator<JavaScriptAstNode, void, void> {
  for (const [key, value] of Object.entries(node)) {
    if (key === 'end' || key === 'loc' || key === 'range' || key === 'start' || key === 'type') {
      continue;
    }
    if (isJavaScriptAstNode(value)) {
      yield value;
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isJavaScriptAstNode(item)) yield item;
    }
  }
}

export function isJavaScriptAstNode(value: unknown): value is JavaScriptAstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { start?: unknown }).start === 'number' &&
    typeof (value as { end?: unknown }).end === 'number'
  );
}

export function staticStringValue(value: unknown): string | undefined {
  if (!isJavaScriptAstNode(value)) return undefined;
  if (value.type === 'Literal' && typeof value.value === 'string') return value.value;
  return undefined;
}

function importDeclarationNames(
  node: JavaScriptAstNode,
  maxNames: number,
): JavaScriptImportedNames | undefined {
  if (!Array.isArray(node.specifiers)) return { names: [], units: 0 };
  const names: string[] = [];
  for (const value of node.specifiers) {
    if (!isJavaScriptAstNode(value)) continue;
    let name: string | undefined;
    if (value.type === 'ImportDefaultSpecifier') name = 'default';
    else if (value.type === 'ImportNamespaceSpecifier') name = '*';
    else if (value.type === 'ImportSpecifier') {
      name = identifierOrStringName(value.imported);
    }
    if (name === undefined) continue;
    if (names.length >= maxNames) return undefined;
    names.push(name);
  }
  return { names: [...new Set(names)], units: names.length };
}

function exportDeclarationNames(
  node: JavaScriptAstNode,
  maxNames: number,
): JavaScriptImportedNames | undefined {
  if (!Array.isArray(node.specifiers) || node.specifiers.length === 0) {
    return maxNames >= 1 ? { names: ['*'], units: 1 } : undefined;
  }
  const names: string[] = [];
  for (const value of node.specifiers) {
    if (!isJavaScriptAstNode(value)) continue;
    const local = identifierOrStringName(value.local);
    if (local === undefined) continue;
    if (names.length >= maxNames) return undefined;
    names.push(local);
  }
  if (names.length > 0) {
    return { names: [...new Set(names)], units: names.length };
  }
  return maxNames >= 1 ? { names: ['*'], units: 1 } : undefined;
}

function identifierOrStringName(value: unknown): string | undefined {
  if (!isJavaScriptAstNode(value)) return undefined;
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name;
  return staticStringValue(value);
}
