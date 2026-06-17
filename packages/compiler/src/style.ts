import {
  attrs,
  createAtomicStyles,
  emitAtomicCss,
  type AtomicRule,
  type CompiledStyle,
  type CreateOptions,
  type StyleObject,
} from '@kovojs/style';
import { diagnosticDefinitions } from '@kovojs/core';
import ts from 'typescript';

import { escapeAttribute, type SourceReplacement } from './shared.js';
import type { StyleRuleUsage } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type { ComponentModuleModel, JsxAttributeModel, SourceSpan } from './scan/parse.js';
import { knownQueryNames, queryNameFromPath } from './analyze/query-shapes.js';
import type {
  CompileComponentOptions,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
} from './types.js';

/**
 * @internal Result of the conservative StyleX extraction pass. The pass handles
 * static `style.create(...)` calls, static JSX `style={...}` references, and the
 * state/query style-object toggles that can lower to SPEC.md §4.8 update-plan facts.
 */
export interface KovoStyleExtraction {
  css: string | null;
  diagnostics: readonly CompilerDiagnostic[];
  handledSpans: readonly SourceSpan[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  queryUpdatePlans: readonly QueryUpdatePlanFact[];
  replacements: readonly SourceReplacement[];
  ruleUsages: readonly StyleRuleUsage[];
  stateDerives: readonly StateDeriveFact[];
  updateCoverage: readonly QueryUpdateCoverageFact[];
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

interface DynamicStyleLowering {
  readonly coverage: readonly QueryUpdateCoverageFact[];
  readonly handledSpan: SourceSpan;
  readonly queryPlan?: QueryUpdatePlanFact;
  readonly replacement: SourceReplacement;
  readonly stateDerive?: StateDeriveFact;
}

interface StyleClassVariant {
  readonly conditions: readonly string[];
  readonly styles: readonly CompiledStyle[];
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
  componentName = 'Component',
  options: Pick<CompileComponentOptions, 'queryShapeFacts' | 'queryShapes' | 'registryFacts'> = {},
): KovoStyleExtraction {
  const styleNamespaces = styleNamespaceImports(source, fileName);
  if (styleNamespaces.size === 0) {
    return emptyStyleExtraction();
  }

  const environment = collectStyleEnvironment(fileName, source, styleNamespaces);
  if (environment.bindings.size === 0) {
    return emptyStyleExtraction();
  }

  const lowered = styleAttributeReplacements(model, environment.bindings, componentName, {
    ...options,
    fileName,
    source,
  });
  const css = environment.rules.length > 0 ? emitAtomicCss(environment.rules) : null;

  return {
    css,
    diagnostics: lowered.diagnostics,
    handledSpans: lowered.handledSpans,
    outputContexts: css
      ? [
          outputWriteFact({
            context: 'css-text',
            sink: `${componentName}.css`,
            source: 'style-extraction',
            writer: 'style extraction css text',
          }),
        ]
      : [],
    queryUpdatePlans: lowered.dynamic.flatMap((entry) => entry.queryPlan ?? []),
    replacements: lowered.replacements,
    ruleUsages: environment.usages,
    stateDerives: lowered.dynamic.flatMap((entry) => entry.stateDerive ?? []),
    updateCoverage: lowered.dynamic.flatMap((entry) => entry.coverage),
  };
}

function emptyStyleExtraction(): KovoStyleExtraction {
  return {
    css: null,
    diagnostics: [],
    handledSpans: [],
    outputContexts: [],
    queryUpdatePlans: [],
    replacements: [],
    ruleUsages: [],
    stateDerives: [],
    updateCoverage: [],
  };
}

function styleNamespaceImports(source: string, fileName: string): Set<string> {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const namespaces = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/style') continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings))
      namespaces.add(namedBindings.name.text);
  }

  return namespaces;
}

function collectStyleEnvironment(
  fileName: string,
  source: string,
  styleNamespaces: ReadonlySet<string>,
): StyleEnvironment {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bindings = new Map<string, StyleBinding>();
  const rules: AtomicRule[] = [];
  const usages: StyleRuleUsage[] = [];
  // Module-local `const x = { ... }` objects, so static `{ ...x }` spreads inside
  // a style object resolve (e.g. @kovojs/ui field.tsx shares `nativeControlStyle`).
  const localObjects = collectLocalObjectLiterals(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const created = styleCreateCall(sourceFile, node.initializer, styleNamespaces, localObjects);
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
  localObjects: LocalObjectLiterals,
): { readonly options: CreateOptions; readonly styles: Record<string, StyleObject> } | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return null;
  if (initializer.expression.name.text !== 'create') return null;
  if (!ts.isIdentifier(initializer.expression.expression)) return null;
  if (!styleNamespaces.has(initializer.expression.expression.text)) return null;

  const [stylesArgument, optionsArgument] = initializer.arguments;
  if (!stylesArgument || !ts.isObjectLiteralExpression(stylesArgument)) return null;

  const styles = styleNamespacesFromObject(stylesArgument, localObjects);
  if (!styles) return null;

  return {
    options: createOptionsFromObject(optionsArgument),
    styles,
  };
}

function styleNamespacesFromObject(
  node: ts.ObjectLiteralExpression,
  localObjects: LocalObjectLiterals,
): Record<string, StyleObject> | null {
  const styles: Record<string, StyleObject> = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key || !ts.isObjectLiteralExpression(property.initializer)) return null;
    const value = styleObjectFromObject(property.initializer, localObjects);
    if (!value) return null;
    styles[key] = value;
  }

  return styles;
}

function styleObjectFromObject(
  node: ts.ObjectLiteralExpression,
  localObjects: LocalObjectLiterals,
): StyleObject | null {
  const style: Record<string, string | number | StyleObject> = {};

  for (const property of node.properties) {
    // `{ ...sharedStyle, ... }`: inline a module-local const object literal so a
    // styled component that composes shared fragments still extracts statically.
    if (ts.isSpreadAssignment(property)) {
      if (!ts.isIdentifier(property.expression)) return null;
      const target = localObjects.get(property.expression.text);
      if (!target) return null;
      const spread = styleObjectFromObject(target, localObjects);
      if (!spread) return null;
      Object.assign(style, spread);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = property.initializer;
    if (ts.isObjectLiteralExpression(value)) {
      const nested = styleObjectFromObject(value, localObjects);
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

type LocalObjectLiterals = ReadonlyMap<string, ts.ObjectLiteralExpression>;

/**
 * Index module-scope `const name = { ... }` object literals (unwrapping a
 * trailing `as const` / parentheses) so static `{ ...name }` spreads inside a
 * `style.create(...)` argument can be resolved and inlined.
 */
function collectLocalObjectLiterals(sourceFile: ts.SourceFile): LocalObjectLiterals {
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const literal = unwrapObjectLiteral(declaration.initializer);
      if (literal) objects.set(declaration.name.text, literal);
    }
  }
  return objects;
}

function unwrapObjectLiteral(node: ts.Expression): ts.ObjectLiteralExpression | null {
  let current: ts.Expression = node;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return ts.isObjectLiteralExpression(current) ? current : null;
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
  componentName: string,
  options: Pick<
    CompileComponentOptions,
    'fileName' | 'queryShapeFacts' | 'queryShapes' | 'registryFacts' | 'source'
  >,
): {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly dynamic: readonly DynamicStyleLowering[];
  readonly handledSpans: readonly SourceSpan[];
  readonly replacements: readonly SourceReplacement[];
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const handledSpans: SourceSpan[] = [];
  const replacements: SourceReplacement[] = [];
  const dynamic: DynamicStyleLowering[] = [];
  const knownQueries = knownQueryNames(model, options);
  const nameCounts = new Map<string, number>();

  for (const element of model.jsxElements) {
    for (const attribute of element.attributes) {
      if (attribute.name !== 'style' || !attribute.expression) continue;
      const expression = parseExpression(attribute.expression);
      if (!expression) continue;
      const resolved = resolveStyleBindings(expression.expression, bindings);
      if (!resolved) {
        const lowered = dynamicStyleAttributeLowering(
          attribute,
          expression.expression,
          bindings,
          componentName,
          knownQueries,
          nameCounts,
        );
        if (!lowered) continue;
        dynamic.push(lowered);
        handledSpans.push(lowered.handledSpan);
        replacements.push(lowered.replacement);
        continue;
      }
      const merged = attrs(resolved.map((binding) => binding.style));
      const lowered = staticStyleAttributeReplacement(element, attribute, merged, options);
      diagnostics.push(...lowered.diagnostics);
      if (!lowered.styleReplacement) continue;
      handledSpans.push({ end: attribute.end, start: attribute.start });
      replacements.push(...lowered.extraReplacements);
      replacements.push({
        end: attribute.end,
        replacement: lowered.styleReplacement,
        start: attribute.start,
      });
    }
  }

  return { diagnostics, dynamic, handledSpans, replacements };
}

function staticStyleAttributeReplacement(
  element: ComponentModuleModel['jsxElements'][number],
  styleAttribute: JsxAttributeModel,
  attributes: ReturnType<typeof attrs>,
  options: Pick<CompileComponentOptions, 'fileName' | 'source'>,
): {
  diagnostics: readonly CompilerDiagnostic[];
  extraReplacements: readonly SourceReplacement[];
  styleReplacement: string | null;
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const extraReplacements: SourceReplacement[] = [];
  const remaining = { ...attributes };
  const classAttribute = element.attributes.find((attribute) => attribute.name === 'class');
  const styleSrcAttribute = element.attributes.find(
    (attribute) => attribute.name === 'data-style-src',
  );

  if (remaining.class && classAttribute) {
    const existingClass = staticAttributeString(classAttribute);
    if (existingClass === null) {
      diagnostics.push(
        styleWriterConflictDiagnostic(
          options,
          classAttribute,
          'class',
          'author JSX',
          'style lowerer',
        ),
      );
    } else {
      extraReplacements.push({
        end: classAttribute.end,
        replacement: `class="${escapeAttribute(`${existingClass} ${remaining.class}`.trim())}"`,
        start: classAttribute.start,
      });
      delete remaining.class;
    }
  }

  if (remaining['data-style-src'] && styleSrcAttribute) {
    const existingStyleSrc = staticAttributeString(styleSrcAttribute);
    if (existingStyleSrc !== remaining['data-style-src']) {
      diagnostics.push(
        styleWriterConflictDiagnostic(
          options,
          styleSrcAttribute,
          'data-style-src',
          'author JSX',
          'style lowerer',
        ),
      );
    }
    delete remaining['data-style-src'];
  }

  return {
    diagnostics,
    extraReplacements,
    styleReplacement: styleAttributeReplacement(remaining),
  };
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

function staticAttributeString(attribute: JsxAttributeModel): string | null {
  if (attribute.value !== undefined) return attribute.value;
  return typeof attribute.expressionStaticValue === 'string'
    ? attribute.expressionStaticValue
    : null;
}

function styleWriterConflictDiagnostic(
  options: Pick<CompileComponentOptions, 'fileName' | 'source'>,
  attribute: JsxAttributeModel,
  detail: string,
  firstWriter: string,
  secondWriter: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(
      options.fileName,
      'KV231',
      options.source,
      attribute.start,
      attribute.end - attribute.start,
    ),
    message: `${diagnosticDefinitions.KV231.message} ${detail} (writers: ${firstWriter}, ${secondWriter})`,
  };
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
      if (
        element.kind === ts.SyntaxKind.FalseKeyword ||
        element.kind === ts.SyntaxKind.NullKeyword
      ) {
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

function dynamicStyleAttributeLowering(
  attribute: JsxAttributeModel,
  expression: ts.Expression,
  bindings: ReadonlyMap<string, StyleBinding>,
  componentName: string,
  knownQueries: ReadonlySet<string>,
  nameCounts: Map<string, number>,
): DynamicStyleLowering | null {
  if (!attribute.expression) return null;

  const variants = styleClassVariants(expression, bindings);
  if (!variants) return null;
  const classExpression = classExpressionForVariants(variants);
  if (!classExpression) return null;

  const roots = new Set(
    (attribute.expressionPropertyAccesses ?? [])
      .filter((path) => !bindings.has(path.path))
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
  );
  const queryRoots = new Set([...roots].filter((root) => knownQueries.has(root)));
  const stateOnly = roots.size > 0 && [...roots].every((root) => root === 'state');
  const queryOnly =
    queryRoots.size === 1 && [...roots].every((root) => root === [...queryRoots][0]);
  const query = stateOnly ? 'state' : queryOnly ? [...queryRoots][0] : null;
  if (!query) return null;

  const exportName = nextExportName(
    `${sanitizeIdentifier(componentName)}$style_class_derive`,
    nameCounts,
  );
  const replacement = stateOnly
    ? `class={${classExpression}} data-bind:class="state.${exportName}"`
    : `data-derive="${escapeAttribute(`${query}.${exportName}`)}" data-derive-attr="class"`;
  const coverage = styleUpdateCoverage(attribute, componentName, query, stateOnly);

  return {
    coverage,
    handledSpan: { end: attribute.end, start: attribute.start },
    ...(stateOnly
      ? {
          stateDerive: {
            attr: 'class',
            expression: classExpression,
            exportName,
            input: 'state',
            name: exportName,
            outputContext: outputWriteFact({
              context: 'attribute',
              expression: classExpression,
              sink: 'class',
              source: 'client-state',
              writer: 'style-object class toggle',
            }),
            param: 'state',
            placeholder: `state.${exportName}`,
          },
        }
      : {
          queryPlan: {
            componentName,
            paths: [],
            query,
            stamps: [
              {
                attr: 'class',
                derive: {
                  exportName,
                  expression: classExpression,
                  input: query,
                  name: exportName,
                  param: query,
                  selector: `[data-derive="${query}.${exportName}"]`,
                },
                outputContext: outputWriteFact({
                  context: 'attribute',
                  expression: classExpression,
                  sink: 'class',
                  source: 'client-query',
                  writer: 'style-object class toggle',
                }),
                selector: `[data-derive="${query}.${exportName}"]`,
              },
            ],
          },
        }),
    replacement: {
      end: attribute.end,
      replacement,
      start: attribute.start,
    },
  };
}

function styleClassVariants(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, StyleBinding>,
): StyleClassVariant[] | null {
  if (ts.isParenthesizedExpression(expression)) {
    return styleClassVariants(expression.expression, bindings);
  }

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const binding = bindings.get(`${expression.expression.text}.${expression.name.text}`);
    return binding ? [{ conditions: [], styles: [binding.style] }] : null;
  }

  if (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return [{ conditions: [], styles: [] }];
  }

  if (ts.isConditionalExpression(expression)) {
    const condition = expression.condition.getText();
    const whenTrue = styleClassVariants(expression.whenTrue, bindings);
    const whenFalse = styleClassVariants(expression.whenFalse, bindings);
    if (!whenTrue || !whenFalse) return null;
    return [
      ...whenTrue.map((variant) => ({
        conditions: [...variant.conditions, `(${condition})`],
        styles: variant.styles,
      })),
      ...whenFalse.map((variant) => ({
        conditions: [...variant.conditions, `!(${condition})`],
        styles: variant.styles,
      })),
    ];
  }

  if (ts.isArrayLiteralExpression(expression)) {
    let variants: StyleClassVariant[] = [{ conditions: [], styles: [] }];
    for (const element of expression.elements) {
      const itemVariants = styleClassVariants(element, bindings);
      if (!itemVariants) return null;
      variants = variants.flatMap((left) =>
        itemVariants.map((right) => ({
          conditions: [...left.conditions, ...right.conditions],
          styles: [...left.styles, ...right.styles],
        })),
      );
    }
    return variants;
  }

  return null;
}

function classExpressionForVariants(variants: readonly StyleClassVariant[]): string | null {
  const unique = dedupeVariants(variants);
  if (unique.length === 0) return '""';
  const unconditional = unique.find((variant) => variant.conditions.length === 0);
  if (unconditional && unique.length === 1) {
    return JSON.stringify(classNameForStyles(unconditional.styles));
  }

  const fallback = unconditional ? JSON.stringify(classNameForStyles(unconditional.styles)) : '""';
  return unique
    .filter((variant) => variant.conditions.length > 0)
    .reduceRight((next, variant) => {
      const condition = variant.conditions.join(' && ');
      return `(${condition}) ? ${JSON.stringify(classNameForStyles(variant.styles))} : (${next})`;
    }, fallback);
}

function dedupeVariants(variants: readonly StyleClassVariant[]): StyleClassVariant[] {
  const seen = new Set<string>();
  const result: StyleClassVariant[] = [];
  for (const variant of variants) {
    const key = `${variant.conditions.join('\0')}\x01${classNameForStyles(variant.styles)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(variant);
  }
  return result;
}

function classNameForStyles(styles: readonly CompiledStyle[]): string {
  return attrs(styles).class ?? '';
}

function styleUpdateCoverage(
  attribute: JsxAttributeModel,
  componentName: string,
  query: string,
  stateOnly: boolean,
): QueryUpdateCoverageFact[] {
  const paths = (attribute.expressionPropertyAccesses ?? [])
    .map((path) => path.path)
    .filter((path) => (stateOnly ? path.startsWith('state.') : path.startsWith(`${query}.`)));
  return [...new Set(paths)].map((path) => ({
    componentName,
    detail: 'style-object toggle',
    position: 'attribute',
    query: path,
    ...(stateOnly ? { source: 'state' as const } : {}),
    status: 'plan' as const,
  }));
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

function nextExportName(baseName: string, nameCounts: Map<string, number>): string {
  const count = nameCounts.get(baseName) ?? 0;
  nameCounts.set(baseName, count + 1);
  return count === 0 ? baseName : `${baseName}_${count + 1}`;
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function outputWriteFact(fact: GeneratedOutputWriteFact): GeneratedOutputWriteFact {
  return fact;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
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
