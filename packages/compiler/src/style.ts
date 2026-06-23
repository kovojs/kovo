import { createRequire } from 'node:module';
import * as ts from 'typescript';

import {
  attrs,
  createTheme,
  defineVars,
  tokens as publicThemeTokens,
  type CssValue,
  type StyleObject,
} from '@kovojs/style';
import {
  createAtomicStyles,
  createKeyframes,
  emitAtomicCss,
  type AtomicRule,
  type CompiledStyle,
  type KeyframesResult,
} from '@kovojs/style/internal';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';

import { escapeAttribute, type SourceReplacement } from './shared.js';
import type { StyleRuleUsage } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import type { ComponentModuleModel, JsxAttributeModel, SourceSpan } from './scan/parse.js';
import { parseSourceFile } from './scan/parse.js';
import { knownQueryNames, queryNameFromPath } from './analyze/query-shapes.js';
import type {
  CompileComponentOptions,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
} from './types.js';

const mutableTs = ts as unknown as Record<string, unknown>;
if (!('ScriptTarget' in mutableTs))
  Object.assign(mutableTs, createRequire(import.meta.url)('typescript') as typeof ts);

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

/** Optional resolver for static same-package style token imports. */
export type StyleStaticImportResolver = (fromFileName: string, specifier: string) => string | null;

interface StyleBinding {
  readonly style: CompiledStyle;
  readonly styleRef: string;
}

interface StyleEnvironment {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly provenanceReplacements: readonly SourceReplacement[];
  readonly rules: readonly AtomicRule[];
  readonly keyframes: readonly KeyframesResult[];
  readonly usages: readonly StyleRuleUsage[];
  readonly bindings: ReadonlyMap<string, StyleBinding>;
}

interface StyleIdentityOptions {
  readonly namespace?: string;
  readonly source?: string;
}

function createAtomicStylesWithIdentity(
  styles: Record<string, StyleObject>,
  identity: StyleIdentityOptions,
): ReturnType<typeof createAtomicStyles<Record<string, StyleObject>>> {
  return (
    createAtomicStyles as (
      styles: Record<string, StyleObject>,
      identity: StyleIdentityOptions,
    ) => ReturnType<typeof createAtomicStyles<Record<string, StyleObject>>>
  )(styles, identity);
}

function defineVarsWithIdentity(
  tokens: Record<string, CssValue>,
  identity: StyleIdentityOptions,
): ReturnType<typeof defineVars<Record<string, CssValue>>> {
  return (
    defineVars as (
      tokens: Record<string, CssValue>,
      identity: StyleIdentityOptions,
    ) => ReturnType<typeof defineVars<Record<string, CssValue>>>
  )(tokens, identity);
}

function createKeyframesWithIdentity(
  frames: Record<string, StyleObject>,
  identity: StyleIdentityOptions,
): KeyframesResult {
  return (
    createKeyframes as (
      frames: Record<string, StyleObject>,
      identity: StyleIdentityOptions,
    ) => KeyframesResult
  )(frames, identity);
}

function createThemeWithIdentity<Tokens extends Record<string, CssValue>>(
  baseTokens: Parameters<typeof createTheme<Tokens>>[0],
  overrides: Parameters<typeof createTheme<Tokens>>[1],
  identity: StyleIdentityOptions,
): ReturnType<typeof createTheme<Tokens>> {
  return (
    createTheme as (
      baseTokens: Parameters<typeof createTheme<Tokens>>[0],
      overrides: Parameters<typeof createTheme<Tokens>>[1],
      identity: StyleIdentityOptions,
    ) => ReturnType<typeof createTheme<Tokens>>
  )(baseTokens, overrides, identity);
}

function atomicRulesFromMetadata(value: unknown): readonly AtomicRule[] {
  return Array.isArray(value) ? (value as readonly AtomicRule[]) : [];
}

interface ImportedStaticValue {
  readonly importName: string;
  readonly localName: string;
  readonly moduleSpecifier: string;
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
  options: Pick<CompileComponentOptions, 'queryShapeFacts' | 'queryShapes' | 'registryFacts'> & {
    readonly resolveStaticImport?: StyleStaticImportResolver;
  } = {},
): KovoStyleExtraction {
  const styleImports = styleImportsFromSourceFile(model.sourceFile);
  const importedStaticValues = collectImportedStaticValues(fileName, model.sourceFile, options);
  if (
    styleImports.namespaces.size === 0 &&
    styleImports.publicTokenNames.size === 0 &&
    importedStaticValues.size === 0
  ) {
    return emptyStyleExtraction();
  }

  const environment = collectStyleEnvironment(
    fileName,
    source,
    model.sourceFile,
    styleImports,
    importedStaticValues,
  );
  if (
    environment.bindings.size === 0 &&
    environment.rules.length === 0 &&
    environment.keyframes.length === 0 &&
    environment.diagnostics.length === 0
  ) {
    return emptyStyleExtraction();
  }

  const lowered =
    environment.bindings.size > 0
      ? styleAttributeReplacements(model, environment.bindings, componentName, {
          ...options,
          fileName,
          source,
        })
      : {
          diagnostics: [],
          dynamic: [],
          handledSpans: [],
          replacements: [],
        };
  // Thread any `style.keyframes` blocks into the extracted CSS alongside the
  // atomic rules. `emitAtomicCss` dedupes them by name (so a keyframe used by
  // several rules emits once) and leads with them, outside `@layer`. SPEC.md §13.1.
  const css =
    environment.rules.length > 0 || environment.keyframes.length > 0
      ? emitAtomicCss(environment.rules, { keyframes: environment.keyframes })
      : null;

  return {
    css,
    diagnostics: [...environment.diagnostics, ...lowered.diagnostics],
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
    replacements: [...environment.provenanceReplacements, ...lowered.replacements],
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

interface StyleImports {
  readonly namespaces: ReadonlySet<string>;
  readonly publicTokenNames: ReadonlySet<string>;
}

function styleImportsFromSourceFile(sourceFile: ts.SourceFile): StyleImports {
  const namespaces = new Set<string>();
  const publicTokenNames = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== '@kovojs/style') continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings))
      namespaces.add(namedBindings.name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === 'tokens') {
          publicTokenNames.add(element.name.text);
        }
      }
    }
  }

  return { namespaces, publicTokenNames };
}

function collectStyleEnvironment(
  fileName: string,
  source: string,
  sourceFile: ts.SourceFile,
  styleImports: StyleImports,
  importedStaticValues: ReadonlyMap<string, unknown> = new Map(),
): StyleEnvironment {
  const bindings = new Map<string, StyleBinding>();
  const diagnostics: CompilerDiagnostic[] = [];
  const provenanceReplacements: SourceReplacement[] = [];
  const rules: AtomicRule[] = [];
  const keyframes: KeyframesResult[] = [];
  const usages: StyleRuleUsage[] = [];
  const staticValues = new Map<string, unknown>([
    ...collectLocalStaticValues(sourceFile, styleImports),
    ...importedStaticValues,
  ]);
  // Module-local `const x = { ... }` objects, so static `{ ...x }` spreads inside
  // a style object resolve (e.g. @kovojs/ui field.tsx shares `nativeControlStyle`).
  const localObjects = collectLocalObjectLiterals(sourceFile);

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const node of statement.declarationList.declarations) {
      if (!ts.isIdentifier(node.name)) continue;

      // `const pulse = style.keyframes({ … }, identity?)`: resolve the frames into
      // an `@keyframes` block and bind the const name to the deterministic
      // animation-name so `animationName: pulse` extracts as a literal (lifts
      // KV236 for keyframes consts). SPEC.md §13.1.
      const frames = styleKeyframesCall(node.initializer, styleImports, localObjects, staticValues);
      if (frames) {
        const result = createKeyframesWithIdentity(frames.frames, {
          namespace: frames.options.namespace ?? derivedStyleNamespace(fileName, node.name.text),
          source: frames.options.source ?? fileName,
        });
        staticValues.set(node.name.text, result.name);
        keyframes.push(result);
        continue;
      } else if (isStyleKeyframesCall(node.initializer, styleImports.namespaces)) {
        diagnostics.push(staticStyleDiagnostic(fileName, source, node, 'style.keyframes'));
        continue;
      }

      const vars = styleDefineVarsCall(node.initializer, styleImports.namespaces);
      if (vars) {
        const tokens = tokenValuesFromObject(vars.tokens, staticValues, styleImports);
        if (!tokens) {
          diagnostics.push(staticStyleDiagnostic(fileName, source, node, 'style.defineVars'));
          continue;
        }
        const result = defineVarsWithIdentity(tokens, {
          namespace: vars.options.namespace ?? derivedStyleNamespace(fileName, node.name.text),
          source: vars.options.source ?? fileName,
        });
        const resultRules = atomicRulesFromMetadata(result.__rules);
        staticValues.set(node.name.text, result);
        rules.push(...resultRules);
        pushRuleUsages(usages, fileName, node.name.text, resultRules);
        continue;
      }

      const theme = styleCreateThemeCall(node.initializer, styleImports.namespaces);
      if (theme) {
        const baseTokens = ts.isIdentifier(theme.baseTokens)
          ? staticValues.get(theme.baseTokens.text)
          : undefined;
        const overrides = tokenValuesFromObject(theme.overrides, staticValues, styleImports);
        if (!baseTokens || !overrides) {
          diagnostics.push(staticStyleDiagnostic(fileName, source, node, 'style.createTheme'));
          continue;
        }
        const result = createThemeWithIdentity(
          baseTokens as Parameters<typeof createTheme>[0],
          overrides,
          {
            namespace: theme.options.namespace ?? derivedStyleNamespace(fileName, node.name.text),
            source: theme.options.source ?? fileName,
          },
        );
        const resultRules = atomicRulesFromMetadata(result.__rules);
        staticValues.set(node.name.text, result);
        rules.push(...resultRules);
        pushRuleUsages(usages, fileName, node.name.text, resultRules);
        continue;
      }

      const created = styleCreateCall(node.initializer, styleImports, localObjects, staticValues);
      if (created) {
        const identity = {
          namespace: created.options.namespace ?? derivedStyleNamespace(fileName, node.name.text),
          source: created.options.source ?? fileName,
        };
        const result = createAtomicStylesWithIdentity(created.styles, {
          namespace: identity.namespace,
          source: identity.source,
        });
        const provenanceReplacement = styleCreateProvenanceReplacement(
          created.call,
          created.options,
          identity,
        );
        if (provenanceReplacement) provenanceReplacements.push(provenanceReplacement);
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
      } else if (isStyleCreateCall(node.initializer, styleImports.namespaces)) {
        diagnostics.push(staticStyleDiagnostic(fileName, source, node, 'style.create'));
      }
    }
  }

  return { bindings, diagnostics, keyframes, provenanceReplacements, rules, usages };
}

function collectImportedStaticValues(
  fileName: string,
  sourceFile: ts.SourceFile,
  options: { readonly resolveStaticImport?: StyleStaticImportResolver },
): ReadonlyMap<string, unknown> {
  if (!options.resolveStaticImport) return new Map();
  const imports = importedStaticValueRequests(sourceFile);
  if (imports.length === 0) return new Map();

  const byModule = new Map<string, ImportedStaticValue[]>();
  for (const entry of imports) {
    const bucket = byModule.get(entry.moduleSpecifier) ?? [];
    bucket.push(entry);
    byModule.set(entry.moduleSpecifier, bucket);
  }

  const result = new Map<string, unknown>();
  for (const [specifier, entries] of byModule) {
    const importedSource = options.resolveStaticImport(fileName, specifier);
    if (importedSource === null) continue;
    const importedValues = evaluateExportedStaticValues(
      `${fileName}#${specifier}`,
      importedSource,
      styleImportsFromSourceFile(parseSourceFile(`${fileName}#${specifier}`, importedSource)),
    );
    for (const entry of entries) {
      if (!importedValues.has(entry.importName)) continue;
      result.set(entry.localName, importedValues.get(entry.importName));
    }
  }
  return result;
}

function derivedStyleNamespace(fileName: string, bindingName: string): string {
  const binding = toKebabCase(bindingName);
  const stripped = binding.replace(/-(styles|vars|theme)$/, '');
  if (stripped !== binding && stripped.length > 0) return stripped;

  const fileBase = fileName
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.[cm]?[tj]sx?$/, '');
  const fileNamespace = fileBase && fileBase.length > 0 ? fileBase : binding;

  if (binding === 'style' || binding === 'styles' || binding === 'base') return fileNamespace;
  if (binding === 'motion' || binding === 'overrides') return `${fileNamespace}-${binding}`;
  if (binding === 'orientations') return `${fileNamespace}-orientation`;
  if (binding === 'sizes') return `${fileNamespace}-size`;
  if (binding === 'variants') return `${fileNamespace}-variant`;

  return binding;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

function importedStaticValueRequests(sourceFile: ts.SourceFile): ImportedStaticValue[] {
  const imports: ImportedStaticValue[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!moduleSpecifier.startsWith('.')) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    for (const element of namedBindings.elements) {
      imports.push({
        importName: (element.propertyName ?? element.name).text,
        localName: element.name.text,
        moduleSpecifier,
      });
    }
  }
  return imports;
}

function evaluateExportedStaticValues(
  fileName: string,
  source: string,
  styleImports: StyleImports,
): ReadonlyMap<string, unknown> {
  const sourceFile = parseSourceFile(fileName, source);
  const staticValues = new Map<string, unknown>();
  const exportedNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = staticValueFromExpression(declaration.initializer, staticValues, styleImports);
      if (value === undefined) continue;
      staticValues.set(declaration.name.text, value);
      if (exported) exportedNames.add(declaration.name.text);
    }
  }
  return new Map([...staticValues].filter(([name]) => exportedNames.has(name)));
}

function staticValueFromExpression(
  node: ts.Expression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): unknown {
  const expression = unwrapStaticExpression(node);
  const primitive = primitiveValue(expression);
  if (primitive !== undefined) return primitive;

  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isIdentifier(expression)) {
    return staticValues.get(expression.text);
  }

  const propertyAccess = staticPropertyAccessValue(expression, staticValues, styleImports);
  if (propertyAccess !== undefined) return propertyAccess;

  if (ts.isObjectLiteralExpression(expression)) {
    const object: Record<string, unknown> = {};
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const key = propertyNameText(property.name);
      if (!key) return undefined;
      const value = staticValueFromExpression(property.initializer, staticValues, styleImports);
      if (value === undefined) return undefined;
      object[key] = value;
    }
    return object;
  }

  if (isObjectFreezeCall(expression)) {
    const [value] = expression.arguments;
    return value ? staticValueFromExpression(value, staticValues, styleImports) : undefined;
  }

  return undefined;
}

function unwrapStaticExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isObjectFreezeCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'freeze' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Object'
  );
}

function styleCreateCall(
  initializer: ts.Expression | undefined,
  styleImports: StyleImports,
  localObjects: LocalObjectLiterals,
  staticValues: ReadonlyMap<string, unknown>,
): {
  readonly call: ts.CallExpression;
  readonly options: StyleIdentityOptions;
  readonly styles: Record<string, StyleObject>;
} | null {
  if (!isStyleCreateCall(initializer, styleImports.namespaces)) return null;

  const [stylesArgument, optionsArgument] = initializer.arguments;
  if (!stylesArgument || !ts.isObjectLiteralExpression(stylesArgument)) return null;

  const styles = styleNamespacesFromObject(
    stylesArgument,
    localObjects,
    staticValues,
    styleImports,
  );
  if (!styles) return null;

  return {
    call: initializer,
    options: styleIdentityOptionsFromObject(optionsArgument),
    styles,
  };
}

function isStyleCreateCall(
  initializer: ts.Expression | undefined,
  styleNamespaces: ReadonlySet<string>,
): initializer is ts.CallExpression {
  if (!initializer || !ts.isCallExpression(initializer)) return false;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return false;
  if (initializer.expression.name.text !== 'create') return false;
  if (!ts.isIdentifier(initializer.expression.expression)) return false;
  return styleNamespaces.has(initializer.expression.expression.text);
}

function styleDefineVarsCall(
  initializer: ts.Expression | undefined,
  styleNamespaces: ReadonlySet<string>,
): {
  readonly options: StyleIdentityOptions;
  readonly tokens: ts.ObjectLiteralExpression;
} | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return null;
  if (initializer.expression.name.text !== 'defineVars') return null;
  if (!ts.isIdentifier(initializer.expression.expression)) return null;
  if (!styleNamespaces.has(initializer.expression.expression.text)) return null;
  const [tokensArgument, optionsArgument] = initializer.arguments;
  if (!tokensArgument || !ts.isObjectLiteralExpression(tokensArgument)) return null;
  return { options: styleIdentityOptionsFromObject(optionsArgument), tokens: tokensArgument };
}

function styleCreateThemeCall(
  initializer: ts.Expression | undefined,
  styleNamespaces: ReadonlySet<string>,
): {
  readonly baseTokens: ts.Expression;
  readonly options: StyleIdentityOptions;
  readonly overrides: ts.ObjectLiteralExpression;
} | null {
  if (!initializer || !ts.isCallExpression(initializer)) return null;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return null;
  if (initializer.expression.name.text !== 'createTheme') return null;
  if (!ts.isIdentifier(initializer.expression.expression)) return null;
  if (!styleNamespaces.has(initializer.expression.expression.text)) return null;
  const [baseTokens, overridesArgument, optionsArgument] = initializer.arguments;
  if (!baseTokens || !overridesArgument || !ts.isObjectLiteralExpression(overridesArgument)) {
    return null;
  }
  return {
    baseTokens,
    options: styleIdentityOptionsFromObject(optionsArgument),
    overrides: overridesArgument,
  };
}

function styleKeyframesCall(
  initializer: ts.Expression | undefined,
  styleImports: StyleImports,
  localObjects: LocalObjectLiterals,
  staticValues: ReadonlyMap<string, unknown>,
): {
  readonly frames: Record<string, StyleObject>;
  readonly options: StyleIdentityOptions;
} | null {
  if (!isStyleKeyframesCall(initializer, styleImports.namespaces)) return null;

  const [framesArgument, optionsArgument] = initializer.arguments;
  if (!framesArgument || !ts.isObjectLiteralExpression(framesArgument)) return null;

  // A keyframes object is `{ '<step>': { <declarations> } }` — the same
  // key→style-object shape `style.create` namespaces use, so the per-step
  // declaration resolution (static primitives, theme tokens, spreads) is shared.
  const frames = styleNamespacesFromObject(
    framesArgument,
    localObjects,
    staticValues,
    styleImports,
  );
  if (!frames) return null;

  return { frames, options: styleIdentityOptionsFromObject(optionsArgument) };
}

function isStyleKeyframesCall(
  initializer: ts.Expression | undefined,
  styleNamespaces: ReadonlySet<string>,
): initializer is ts.CallExpression {
  if (!initializer || !ts.isCallExpression(initializer)) return false;
  if (!ts.isPropertyAccessExpression(initializer.expression)) return false;
  if (initializer.expression.name.text !== 'keyframes') return false;
  if (!ts.isIdentifier(initializer.expression.expression)) return false;
  return styleNamespaces.has(initializer.expression.expression.text);
}

function styleNamespacesFromObject(
  node: ts.ObjectLiteralExpression,
  localObjects: LocalObjectLiterals,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): Record<string, StyleObject> | null {
  const styles: Record<string, StyleObject> = {};

  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key || !ts.isObjectLiteralExpression(property.initializer)) return null;
    const value = styleObjectFromObject(
      property.initializer,
      localObjects,
      staticValues,
      styleImports,
    );
    if (!value) return null;
    styles[key] = value;
  }

  return styles;
}

function styleObjectFromObject(
  node: ts.ObjectLiteralExpression,
  localObjects: LocalObjectLiterals,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): StyleObject | null {
  const style: Record<string, string | number | StyleObject> = {};

  for (const property of node.properties) {
    // `{ ...sharedStyle, ... }`: inline a module-local const object literal so a
    // styled component that composes shared fragments still extracts statically.
    if (ts.isSpreadAssignment(property)) {
      if (!ts.isIdentifier(property.expression)) return null;
      const target = localObjects.get(property.expression.text);
      if (!target) return null;
      const spread = styleObjectFromObject(target, localObjects, staticValues, styleImports);
      if (!spread) return null;
      Object.assign(style, spread);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = property.initializer;
    if (ts.isObjectLiteralExpression(value)) {
      const nested = styleObjectFromObject(value, localObjects, staticValues, styleImports);
      if (!nested) return null;
      style[key] = nested;
      continue;
    }
    const primitive = staticPrimitiveValue(value, staticValues, styleImports);
    if (primitive === undefined) return null;
    style[key] = primitive;
  }

  return style;
}

function tokenValuesFromObject(
  node: ts.ObjectLiteralExpression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): Record<string, CssValue> | null {
  const result: Record<string, CssValue> = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = staticCssValue(property.initializer, staticValues, styleImports);
    if (value === undefined) return null;
    result[key] = value;
  }
  return result;
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

function collectLocalStaticValues(
  sourceFile: ts.SourceFile,
  styleImports: StyleImports,
): ReadonlyMap<string, unknown> {
  const staticValues = new Map<string, unknown>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = staticValueFromExpression(declaration.initializer, staticValues, styleImports);
      if (value !== undefined) staticValues.set(declaration.name.text, value);
    }
  }

  return staticValues;
}

function unwrapObjectLiteral(node: ts.Expression): ts.ObjectLiteralExpression | null {
  let current: ts.Expression = node;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return ts.isObjectLiteralExpression(current) ? current : null;
}

function styleIdentityOptionsFromObject(node: ts.Expression | undefined): StyleIdentityOptions {
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

function styleCreateProvenanceReplacement(
  call: ts.CallExpression,
  existingOptions: StyleIdentityOptions,
  identity: Required<StyleIdentityOptions>,
): SourceReplacement | null {
  if (existingOptions.namespace && existingOptions.source) return null;

  const properties = [
    ...(existingOptions.namespace ? [] : [`namespace: ${JSON.stringify(identity.namespace)}`]),
    ...(existingOptions.source ? [] : [`source: ${JSON.stringify(identity.source)}`]),
  ];
  const [, optionsArgument] = call.arguments;

  if (!optionsArgument) {
    const stylesArgument = call.arguments[0];
    if (!stylesArgument) return null;
    const position = stylesArgument.getEnd();
    return {
      end: position,
      replacement: `, { ${properties.join(', ')} }`,
      start: position,
    };
  }

  if (!ts.isObjectLiteralExpression(optionsArgument)) return null;
  const position = optionsArgument.getEnd() - 1;
  return {
    end: position,
    replacement: `${optionsArgument.properties.length > 0 ? ', ' : ''}${properties.join(', ')}`,
    start: position,
  };
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
  const sourceFile = parseSourceFile(
    'style-expression.tsx',
    `const __kovoStyleExpression = ${source};`,
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

function pushRuleUsages(
  usages: StyleRuleUsage[],
  fileName: string,
  styleRefRoot: string,
  rules: readonly AtomicRule[],
): void {
  for (const rule of rules) {
    usages.push({
      className: rule.className,
      moduleFileName: fileName,
      source: rule.source,
      styleRef: `${styleRefRoot}.${rule.property}`,
    });
  }
}

function staticStyleDiagnostic(
  fileName: string,
  source: string,
  node: ts.Node,
  api: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(fileName, 'KV236', source, node.getStart(), node.getWidth()),
    help: [
      `Would lower to: static CSS rules extracted from ${api}.`,
      'Blocked reason: the style extractor only accepts literals, same-file defineVars/createTheme values, and public @kovojs/style theme token references.',
      'Fixes: move the value into a static object literal, import the public tokens object from @kovojs/style, or keep dynamic styling behind an explicit raw style escape.',
      'SPEC §5.2 requires post-parse compiler decisions to use typed facts; SPEC §13.1 requires StyleX-authored component styles to extract into CSS assets.',
    ].join('\n'),
    message: `Static style extraction could not prove ${api} values.`,
  };
}

function staticCssValue(
  node: ts.Expression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): CssValue | undefined {
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && node.text === 'undefined') return undefined;
  return staticPrimitiveValue(node, staticValues, styleImports);
}

function staticPrimitiveValue(
  node: ts.Expression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): string | number | undefined {
  const primitive = primitiveValue(node);
  if (primitive !== undefined) return primitive;

  if (ts.isIdentifier(node)) {
    const value = staticValues.get(node.text);
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
  }

  const referenced = staticPropertyAccessValue(node, staticValues, styleImports);
  return typeof referenced === 'string' || typeof referenced === 'number' ? referenced : undefined;
}

function staticPropertyAccessValue(
  node: ts.Expression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): unknown {
  const path = propertyAccessPath(node);
  if (!path || path.length === 0) return undefined;
  const [root, ...segments] = path;
  if (!root) return undefined;

  if (styleImports.publicTokenNames.has(root)) {
    return valueAtPath(publicThemeTokens, segments);
  }

  if (styleImports.namespaces.has(root) && segments[0] === 'tokens') {
    return valueAtPath(publicThemeTokens, segments.slice(1));
  }

  if (!staticValues.has(root)) return undefined;
  return valueAtPath(staticValues.get(root), segments);
}

function propertyAccessPath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const prefix = propertyAccessPath(node.expression);
    return prefix ? [...prefix, node.name.text] : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const prefix = propertyAccessPath(node.expression);
    const argument = node.argumentExpression;
    if (!prefix || !argument) return null;
    if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
      return [...prefix, argument.text];
    }
  }
  return null;
}

function valueAtPath(value: unknown, segments: readonly string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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
