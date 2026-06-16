import {
  attrs,
  createAtomicStyles,
  emitAtomicCss,
  type AtomicRule,
  type CompiledStyle,
  type CreateOptions,
  type StyleObject,
} from '@kovojs/style';
import ts from 'typescript';

import { escapeAttribute, type SourceReplacement } from './shared.js';
import type { StyleRuleUsage } from './css.js';
import type { ComponentModuleModel, JsxAttributeModel } from './scan/parse.js';

/**
 * @internal Result of the conservative StyleX extraction pass. The pass handles
 * static `style.create(...)` calls and static JSX `style={...}` references only;
 * dynamic state/query toggles are intentionally left for the §4.8 Phase 3 path.
 */
export interface KovoStyleExtraction {
  css: string | null;
  replacements: readonly SourceReplacement[];
  ruleUsages: readonly StyleRuleUsage[];
}

interface StyleBinding {
  readonly style: CompiledStyle;
  readonly styleRef: string;
}

interface StyleEnvironment {
  readonly rules: readonly AtomicRule[];
  readonly usages: readonly StyleRuleUsage[];
  readonly bindings: ReadonlyMap<string, StyleBinding>;
}

interface ParsedExpression {
  readonly expression: ts.Expression;
  readonly sourceFile: ts.SourceFile;
}

/**
 * @internal Extracts Kovo-owned StyleX atoms from a component module and lowers
 * static JSX `style` props to authorable `class`/`data-style-src` IR, satisfying
 * SPEC.md §5.2 for the static subset.
 */
export function extractKovoStyles(
  fileName: string,
  source: string,
  model: ComponentModuleModel,
): KovoStyleExtraction {
  const styleNamespaces = styleNamespaceImports(source, fileName);
  if (styleNamespaces.size === 0) {
    return { css: null, replacements: [], ruleUsages: [] };
  }

  const environment = collectStyleEnvironment(fileName, source, styleNamespaces);
  if (environment.bindings.size === 0) {
    return { css: null, replacements: [], ruleUsages: [] };
  }

  const replacements = styleAttributeReplacements(model, environment.bindings);
  const css = environment.rules.length > 0 ? emitAtomicCss(environment.rules) : null;

  return {
    css,
    replacements,
    ruleUsages: environment.usages,
  };
}

function styleNamespaceImports(source: string, fileName: string): Set<string> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/style') continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) namespaces.add(namedBindings.name.text);
  }

  return namespaces;
}

function collectStyleEnvironment(
  fileName: string,
  source: string,
  styleNamespaces: ReadonlySet<string>,
): StyleEnvironment {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bindings = new Map<string, StyleBinding>();
  const rules: AtomicRule[] = [];
  const usages: StyleRuleUsage[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const created = styleCreateCall(sourceFile, node.initializer, styleNamespaces);
      if (created) {
        const result = createAtomicStyles(created.styles, {
          namespace: created.options.namespace ?? node.name.text,
          source: created.options.source ?? fileName,
        });
        rules.push(...result.rules);

        for (const [styleKey, style] of Object.entries(result.styles)) {
          const styleRef = `${node.name.text}.${styleKey}`;
          bindings.set(styleRef, { style, styleRef });
          for (const rule of style.__rules ?? []) {
            usages.push({
              className: rule.className,
              moduleFileName: fileName,
              source: rule.source,
              styleRef,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { bindings, rules, usages };
}

function styleCreateCall(
  sourceFile: ts.SourceFile,
  initializer: ts.Expression | undefined,
  styleNamespaces: ReadonlySet<string>,
): { readonly options: CreateOptions; readonly styles: Record<string, StyleObject> } | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return null;
  if (initializer.expression.name.text !== 'create') return null;
  if (!ts.isIdentifier(initializer.expression.expression)) return null;
  if (!styleNamespaces.has(initializer.expression.expression.text)) return null;

  const [stylesArgument, optionsArgument] = initializer.arguments;
  if (!stylesArgument || !ts.isObjectLiteralExpression(stylesArgument)) return null;

  const styles = styleNamespacesFromObject(stylesArgument);
  if (!styles) return null;

  return {
    options: createOptionsFromObject(optionsArgument),
    styles,
  };
}

function styleNamespacesFromObject(node: ts.ObjectLiteralExpression): Record<string, StyleObject> | null {
  const styles: Record<string, StyleObject> = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key || !ts.isObjectLiteralExpression(property.initializer)) return null;
    const value = styleObjectFromObject(property.initializer);
    if (!value) return null;
    styles[key] = value;
  }

  return styles;
}

function styleObjectFromObject(node: ts.ObjectLiteralExpression): StyleObject | null {
  const style: Record<string, string | number | StyleObject> = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = property.initializer;
    if (ts.isObjectLiteralExpression(value)) {
      const nested = styleObjectFromObject(value);
      if (!nested) return null;
      style[key] = nested;
      continue;
    }
    const primitive = primitiveValue(value);
    if (primitive === undefined) return null;
    style[key] = primitive;
  }

  return style;
}

function createOptionsFromObject(node: ts.Expression | undefined): CreateOptions {
  if (!node || !ts.isObjectLiteralExpression(node)) return {};
  const options: { namespace?: string; source?: string } = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyNameText(property.name);
    const value = primitiveValue(property.initializer);
    if (key === 'namespace' && typeof value === 'string') options.namespace = value;
    if (key === 'source' && typeof value === 'string') options.source = value;
  }

  return options;
}

function styleAttributeReplacements(
  model: ComponentModuleModel,
  bindings: ReadonlyMap<string, StyleBinding>,
): SourceReplacement[] {
  const replacements: SourceReplacement[] = [];

  for (const element of model.jsxElements) {
    for (const attribute of element.attributes) {
      if (attribute.name !== 'style' || !attribute.expression) continue;
      const expression = parseExpression(attribute.expression);
      if (!expression) continue;
      const resolved = resolveStyleBindings(expression.expression, bindings);
      if (!resolved) continue;
      const merged = attrs(resolved.map((binding) => binding.style));
      const replacement = styleAttributeReplacement(merged);
      if (!replacement) continue;
      replacements.push({
        end: attribute.end,
        replacement,
        start: attribute.start,
      });
    }
  }

  return replacements;
}

function styleAttributeReplacement(attributes: ReturnType<typeof attrs>): string | null {
  const parts: string[] = [];
  if (attributes.class) parts.push(`class="${escapeAttribute(attributes.class)}"`);
  if (attributes['data-style-src']) {
    parts.push(`data-style-src="${escapeAttribute(attributes['data-style-src'])}"`);
  }
  if (attributes.style) parts.push(`style="${escapeAttribute(attributes.style)}"`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function resolveStyleBindings(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, StyleBinding>,
): StyleBinding[] | null {
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const binding = bindings.get(`${expression.expression.text}.${expression.name.text}`);
    return binding ? [binding] : null;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    const result: StyleBinding[] = [];
    for (const element of expression.elements) {
      if (element.kind === ts.SyntaxKind.FalseKeyword || element.kind === ts.SyntaxKind.NullKeyword) {
        continue;
      }
      const nested = resolveStyleBindings(element, bindings);
      if (!nested) return null;
      result.push(...nested);
    }
    return result;
  }

  return null;
}

function parseExpression(source: string): ParsedExpression | null {
  const sourceFile = ts.createSourceFile(
    'style-expression.tsx',
    `const __kovoStyleExpression = ${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isVariableStatement(statement)) return null;
  const declaration = statement.declarationList.declarations[0];
  if (!declaration?.initializer) return null;
  return { expression: declaration.initializer, sourceFile };
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function primitiveValue(node: ts.Expression): string | number | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = Number(node.operand.text);
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
    if (node.operator === ts.SyntaxKind.PlusToken) return value;
  }
  return undefined;
}
