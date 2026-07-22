import { parse, type Node, type Program } from 'acorn';

export type JavaScriptAstNode = Node & Record<string, unknown>;

export interface JavaScriptModuleReference {
  importedNames: readonly string[];
  kind: 'dynamic-import' | 'export' | 'import';
  node: JavaScriptAstNode;
  specifier: string | undefined;
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
): JavaScriptModuleReference[] {
  const references: JavaScriptModuleReference[] = [];
  walkJavaScriptAst(program, (node) => {
    if (node.type === 'ImportDeclaration') {
      references.push({
        importedNames: importDeclarationNames(node),
        kind: 'import',
        node,
        specifier: staticStringValue(node.source),
      });
      return;
    }
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.source !== null &&
      node.source !== undefined
    ) {
      references.push({
        importedNames: exportDeclarationNames(node),
        kind: 'export',
        node,
        specifier: staticStringValue(node.source),
      });
      return;
    }
    if (node.type === 'ExportAllDeclaration') {
      references.push({
        importedNames: ['*'],
        kind: 'export',
        node,
        specifier: staticStringValue(node.source),
      });
      return;
    }
    if (node.type === 'ImportExpression') {
      references.push({
        importedNames: ['*'],
        kind: 'dynamic-import',
        node,
        specifier: staticStringValue(node.source),
      });
    }
  });
  return references;
}

function walkJavaScriptAst(
  root: JavaScriptAstNode,
  visitor: (node: JavaScriptAstNode) => void,
): void {
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    visitor(current);
    const children = childNodes(current);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]!);
    }
  }
}

function childNodes(node: JavaScriptAstNode): JavaScriptAstNode[] {
  const children: JavaScriptAstNode[] = [];
  const seen = new Set<JavaScriptAstNode>();
  for (const [key, value] of Object.entries(node)) {
    if (key === 'end' || key === 'loc' || key === 'range' || key === 'start' || key === 'type') {
      continue;
    }
    if (isJavaScriptAstNode(value)) {
      if (!seen.has(value)) {
        seen.add(value);
        children.push(value);
      }
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (isJavaScriptAstNode(item) && !seen.has(item)) {
        seen.add(item);
        children.push(item);
      }
    }
  }
  return children;
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

function importDeclarationNames(node: JavaScriptAstNode): string[] {
  if (!Array.isArray(node.specifiers)) return [];
  const names: string[] = [];
  for (const value of node.specifiers) {
    if (!isJavaScriptAstNode(value)) continue;
    if (value.type === 'ImportDefaultSpecifier') names.push('default');
    else if (value.type === 'ImportNamespaceSpecifier') names.push('*');
    else if (value.type === 'ImportSpecifier') {
      const imported = identifierOrStringName(value.imported);
      if (imported !== undefined) names.push(imported);
    }
  }
  return [...new Set(names)].sort(compareStrings);
}

function exportDeclarationNames(node: JavaScriptAstNode): string[] {
  if (!Array.isArray(node.specifiers) || node.specifiers.length === 0) return ['*'];
  const names: string[] = [];
  for (const value of node.specifiers) {
    if (!isJavaScriptAstNode(value)) continue;
    const local = identifierOrStringName(value.local);
    if (local !== undefined) names.push(local);
  }
  return names.length === 0 ? ['*'] : [...new Set(names)].sort(compareStrings);
}

function identifierOrStringName(value: unknown): string | undefined {
  if (!isJavaScriptAstNode(value)) return undefined;
  if (value.type === 'Identifier' && typeof value.name === 'string') return value.name;
  return staticStringValue(value);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
