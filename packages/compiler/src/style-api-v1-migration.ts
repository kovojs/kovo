import type * as TS from 'typescript';
import { typescriptRuntime as ts } from './ts-api.js';

/** @internal One source edit proven mechanical for the style API v1 cut. */
export interface StyleApiV1MigrationEdit {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

/** @internal One fail-closed source refusal. Offsets are UTF-16 until the CLI serializes them. */
export interface StyleApiV1MigrationRefusal {
  readonly category: 'ambiguous-binding' | 'dynamic-import' | 'app-context';
  readonly end: number;
  readonly reason: string;
  readonly start: number;
}

/** @internal Conservative source analysis result used by `kovo fix api-v1`. */
export type StyleApiV1MigrationAnalysis =
  | {
      readonly edits: readonly StyleApiV1MigrationEdit[];
      readonly source: string;
      readonly status: 'rewritten';
    }
  | {
      readonly refusals: readonly StyleApiV1MigrationRefusal[];
      readonly source: string;
      readonly status: 'refused';
    }
  | {
      readonly source: string;
      readonly status: 'unchanged';
    };

const STYLE_MODULE = '@kovojs/style';
const RETIRED_THEME_VALUE = 'createTheme';
const RETIRED_STYLE_TYPE = 'StyleRecord';
const STYLE_HANDLE_TYPE = 'StyleHandle';
const RETIRED_APP_CONTEXT_SYMBOLS = new Set([
  'AttrsResult',
  RETIRED_THEME_VALUE,
  'Keyframes',
  'Style',
  'StyleNamespaces',
  'StylePrimitive',
  'Theme',
  'ThemeCustomColorGroup',
  'ThemeCustomColorInput',
  'ThemeCustomColorsInput',
  'ThemeFromSeedOptions',
  'ThemeReferencePaletteName',
  'ThemeReferencePalettes',
  'ThemeSchemeValues',
  'ThemeSeed',
  'ThemeShapeInput',
  'ThemeShapeTokenName',
  'ThemeShapeValues',
  'ThemeSystemColorName',
  'ThemeSystemColorValues',
  'ThemeVariant',
]);

/**
 * Rewrite only bindings whose meaning is syntactically complete.
 *
 * `StyleRecord` is a representation-era name with an exact opaque successor,
 * so direct imports and namespace-qualified references can move mechanically.
 * `createTheme` has no equivalent after the seed-theme review; choosing a new
 * theme model requires app context and is therefore always refused.
 */
export function analyzeStyleApiV1Migration(options: {
  readonly fileName: string;
  readonly source: string;
}): StyleApiV1MigrationAnalysis {
  const sourceFile = ts.createSourceFile(
    options.fileName,
    options.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(options.fileName),
  );
  const edits: StyleApiV1MigrationEdit[] = [];
  const refusals: StyleApiV1MigrationRefusal[] = [];
  const directStyleRecordLocals = new Set<string>();
  const styleNamespaces = new Set<string>();

  const parseDiagnostics = (
    sourceFile as TS.SourceFile & { readonly parseDiagnostics?: readonly TS.Diagnostic[] }
  ).parseDiagnostics;
  for (const diagnostic of parseDiagnostics ?? []) {
    const start = diagnostic.start ?? 0;
    refusals.push({
      category: 'ambiguous-binding',
      end: start + (diagnostic.length ?? 0),
      reason: 'The source does not parse cleanly, so binding-aware API edits cannot be proven.',
      start,
    });
  }

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === STYLE_MODULE
    ) {
      const clause = statement.importClause;
      if (!clause?.namedBindings) continue;
      if (ts.isNamespaceImport(clause.namedBindings)) {
        styleNamespaces.add(clause.namedBindings.name.text);
        continue;
      }
      for (const specifier of clause.namedBindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        if (RETIRED_APP_CONTEXT_SYMBOLS.has(imported)) {
          refusals.push(appContextRefusal(specifier, sourceFile, imported));
          continue;
        }
        if (imported !== RETIRED_STYLE_TYPE) continue;
        if (specifier.propertyName) {
          edits.push(replaceIdentifier(specifier.propertyName, STYLE_HANDLE_TYPE, sourceFile));
        } else {
          directStyleRecordLocals.add(specifier.name.text);
          edits.push(replaceIdentifier(specifier.name, STYLE_HANDLE_TYPE, sourceFile));
        }
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === STYLE_MODULE
    ) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        refusals.push({
          category: 'ambiguous-binding',
          end: statement.getEnd(),
          reason:
            'A wildcard or namespace re-export may carry retired names to downstream consumers, so the migration refuses to narrow it implicitly.',
          start: statement.getStart(sourceFile),
        });
      } else {
        for (const specifier of statement.exportClause.elements) {
          const imported = specifier.propertyName?.text ?? specifier.name.text;
          if (imported === RETIRED_STYLE_TYPE || RETIRED_APP_CONTEXT_SYMBOLS.has(imported)) {
            refusals.push({
              category: 'app-context',
              end: specifier.getEnd(),
              reason:
                'A public re-export may have downstream consumers; changing its name requires an app-level compatibility decision.',
              start: specifier.getStart(sourceFile),
            });
          }
        }
      }
    }

    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression &&
      ts.isStringLiteral(statement.moduleReference.expression) &&
      statement.moduleReference.expression.text === STYLE_MODULE
    ) {
      refusals.push({
        category: 'dynamic-import',
        end: statement.getEnd(),
        reason:
          'A CommonJS-style import has runtime namespace semantics that a static source rewrite cannot prove.',
        start: statement.getStart(sourceFile),
      });
    }
  }

  const visit = (node: TS.Node): void => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === STYLE_MODULE,
      )
    ) {
      refusals.push({
        category: 'dynamic-import',
        end: node.getEnd(),
        reason:
          'A dynamic style import has runtime binding semantics that a static source rewrite cannot prove.',
        start: node.getStart(sourceFile),
      });
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.some(
        (argument) => ts.isStringLiteral(argument) && argument.text === STYLE_MODULE,
      )
    ) {
      refusals.push({
        category: 'dynamic-import',
        end: node.getEnd(),
        reason:
          'A CommonJS style import has runtime binding semantics that a static source rewrite cannot prove.',
        start: node.getStart(sourceFile),
      });
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      styleNamespaces.has(node.expression.text)
    ) {
      if (node.name.text === RETIRED_STYLE_TYPE) {
        edits.push(replaceIdentifier(node.name, STYLE_HANDLE_TYPE, sourceFile));
      } else if (RETIRED_APP_CONTEXT_SYMBOLS.has(node.name.text)) {
        refusals.push(appContextRefusal(node.name, sourceFile, node.name.text));
      }
    }

    if (
      ts.isQualifiedName(node) &&
      ts.isIdentifier(node.left) &&
      styleNamespaces.has(node.left.text)
    ) {
      if (node.right.text === RETIRED_STYLE_TYPE) {
        edits.push(replaceIdentifier(node.right, STYLE_HANDLE_TYPE, sourceFile));
      } else if (RETIRED_APP_CONTEXT_SYMBOLS.has(node.right.text)) {
        refusals.push(appContextRefusal(node.right, sourceFile, node.right.text));
      }
    }

    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      styleNamespaces.has(node.expression.text)
    ) {
      refusals.push({
        category: 'ambiguous-binding',
        end: node.getEnd(),
        reason:
          'Computed access can be aliased or passed dynamically, so the migration refuses to guess its binding intent.',
        start: node.getStart(sourceFile),
      });
    }

    if (
      ts.isIndexedAccessTypeNode(node) &&
      ts.isTypeQueryNode(node.objectType) &&
      ts.isIdentifier(node.objectType.exprName) &&
      styleNamespaces.has(node.objectType.exprName.text)
    ) {
      refusals.push({
        category: 'ambiguous-binding',
        end: node.getEnd(),
        reason:
          'Computed type access can be aliased or transformed dynamically, so the migration refuses to guess its binding intent.',
        start: node.getStart(sourceFile),
      });
    }

    if (
      ts.isIdentifier(node) &&
      directStyleRecordLocals.has(node.text) &&
      isShadowingDeclaration(node)
    ) {
      refusals.push({
        category: 'ambiguous-binding',
        end: node.getEnd(),
        reason:
          'A local declaration shadows the imported StyleRecord binding, so reference rewrites cannot be proven from syntax alone.',
        start: node.getStart(sourceFile),
      });
    }

    if (
      ts.isIdentifier(node) &&
      directStyleRecordLocals.has(node.text) &&
      isDirectStyleRecordTypeReference(node)
    ) {
      edits.push(replaceIdentifier(node, STYLE_HANDLE_TYPE, sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (refusals.length > 0) {
    return {
      refusals: uniqueRefusals(refusals),
      source: options.source,
      status: 'refused',
    };
  }
  const stableEdits = uniqueEdits(edits);
  if (stableEdits.length === 0) return { source: options.source, status: 'unchanged' };
  return {
    edits: stableEdits,
    source: applyEdits(options.source, stableEdits),
    status: 'rewritten',
  };
}

function isShadowingDeclaration(node: TS.Identifier): boolean {
  const parent = node.parent;
  if (ts.isImportSpecifier(parent) && parent.name === node && !parent.propertyName) return false;
  return (
    ((ts.isBindingElement(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportEqualsDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isModuleDeclaration(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isParameter(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isVariableDeclaration(parent)) &&
      parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node)
  );
}

function isDirectStyleRecordTypeReference(node: TS.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isTypeReferenceNode(parent) && parent.typeName === node) ||
    (ts.isExpressionWithTypeArguments(parent) && parent.expression === node) ||
    (ts.isTypeQueryNode(parent) && parent.exprName === node)
  );
}

function appContextRefusal(
  node: TS.Node,
  sourceFile: TS.SourceFile,
  symbol: string,
): StyleApiV1MigrationRefusal {
  return {
    category: 'app-context',
    end: node.getEnd(),
    reason: `${symbol} has no semantics-preserving replacement; choosing a seed theme or authored CSS requires app intent.`,
    start: node.getStart(sourceFile),
  };
}

function replaceIdentifier(
  node: TS.Node,
  replacement: string,
  sourceFile: TS.SourceFile,
): StyleApiV1MigrationEdit {
  return {
    end: node.getEnd(),
    replacement,
    start: node.getStart(sourceFile),
  };
}

function uniqueEdits(
  edits: readonly StyleApiV1MigrationEdit[],
): readonly StyleApiV1MigrationEdit[] {
  const bySpan = new Map<string, StyleApiV1MigrationEdit>();
  for (const edit of edits) bySpan.set(`${edit.start}:${edit.end}`, edit);
  return [...bySpan.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function uniqueRefusals(
  refusals: readonly StyleApiV1MigrationRefusal[],
): readonly StyleApiV1MigrationRefusal[] {
  const bySpan = new Map<string, StyleApiV1MigrationRefusal>();
  for (const refusal of refusals) {
    bySpan.set(`${refusal.category}:${refusal.start}:${refusal.end}`, refusal);
  }
  return [...bySpan.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
}

function applyEdits(source: string, edits: readonly StyleApiV1MigrationEdit[]): string {
  let result = source;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index]!;
    result = `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`;
  }
  return result;
}

function scriptKind(fileName: string): TS.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
