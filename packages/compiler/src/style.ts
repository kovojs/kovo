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

import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerCreateSet,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerMapSize,
  compilerNumberValue,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSetAdd,
  compilerSetHas,
  compilerSetOwnDataProperty,
  compilerSetSize,
  compilerSnapshotJsonValue,
  compilerStringEndsWith,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
} from './compiler-security-intrinsics.js';
import {
  escapeAttribute,
  looseKebabCase,
  outputWriteFact,
  sanitizeIdentifier,
  type SourceReplacement,
} from './shared.js';
import type { StyleRuleUsage } from './css.js';
import { diagnosticFor, type CompilerDiagnostic } from './diagnostics.js';
import type { GeneratedOutputWriteFact } from './output-context-facts.js';
import { propertyNameText } from './scan/ast.js';
import type { ComponentModuleModel, JsxAttributeModel, SourceSpan } from './scan/parse.js';
import { parseSourceFile } from './scan/parse.js';
import { knownQueryNames, queryNameFromPath } from './analyze/query-shapes.js';
import { ensureTypescriptRuntime } from './ts-api.js';
import type {
  CompileComponentOptions,
  QueryUpdateCoverageFact,
  QueryUpdatePlanFact,
  StateDeriveFact,
} from './types.js';

ensureTypescriptRuntime(ts);

const styleModuleSpecifier = '@kovojs/style';
const styleTokensExportName = 'tokens';
const objectIdentifierName = 'Object';
const objectFreezeMemberName = 'freeze';
const styleCreateMemberName = 'create';
const styleDefineVarsMemberName = 'defineVars';
const styleCreateThemeMemberName = 'createTheme';
const styleKeyframesMemberName = 'keyframes';
const themeClassNameMemberName = 'className';
const undefinedIdentifierName = 'undefined';

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
  readonly themeClassBindings: ReadonlyMap<string, string>;
}

interface StyleIdentityOptions {
  readonly namespace?: string;
  readonly source?: string;
}

interface StyleIdentityDefaults {
  readonly keyframes?: string;
  readonly styles?: string;
  readonly theme?: string;
  readonly vars?: string;
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
  return compilerArrayIsArray(value) ? (value as readonly AtomicRule[]) : [];
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

interface StyleConditionFactCursor {
  readonly facts: NonNullable<JsxAttributeModel['expressionConditionalFacts']>;
  index: number;
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
    readonly defaultStyleIdentity?: StyleIdentityDefaults;
    readonly resolveStaticImport?: StyleStaticImportResolver;
  } = {},
): KovoStyleExtraction {
  const styleImports = styleImportsFromSourceFile(model.sourceFile);
  const importedStaticValues = collectImportedStaticValues(fileName, model.sourceFile, options);
  if (
    compilerSetSize(styleImports.namespaces) === 0 &&
    compilerSetSize(styleImports.publicTokenNames) === 0 &&
    compilerMapSize(importedStaticValues) === 0 &&
    !hasInlineStyleExpressions(model)
  ) {
    return emptyStyleExtraction();
  }

  const environment = collectStyleEnvironment(
    fileName,
    source,
    model.sourceFile,
    styleImports,
    importedStaticValues,
    options.defaultStyleIdentity,
  );
  const lowered = styleAttributeReplacements(model, environment.bindings, componentName, {
    ...options,
    fileName,
    source,
    themeClassBindings: environment.themeClassBindings,
  });
  if (
    compilerMapSize(environment.bindings) === 0 &&
    compilerArrayLength(environment.rules, 'Style environment rules') === 0 &&
    compilerArrayLength(environment.keyframes, 'Style environment keyframes') === 0 &&
    compilerArrayLength(environment.diagnostics, 'Style environment diagnostics') === 0 &&
    compilerArrayLength(lowered.replacements, 'Style lowered replacements') === 0 &&
    compilerArrayLength(lowered.dynamic, 'Style dynamic lowerings') === 0
  ) {
    return emptyStyleExtraction();
  }
  // Thread any `style.keyframes` blocks into the extracted CSS alongside the
  // atomic rules. `emitAtomicCss` dedupes them by name (so a keyframe used by
  // several rules emits once) and leads with them, outside `@layer`. SPEC.md §13.1.
  const css =
    compilerArrayLength(environment.rules, 'Style environment rules') > 0 ||
    compilerArrayLength(environment.keyframes, 'Style environment keyframes') > 0
      ? emitAtomicCss(environment.rules, { keyframes: environment.keyframes })
      : null;

  const diagnostics: CompilerDiagnostic[] = [];
  appendStyleValues(diagnostics, environment.diagnostics, 'Style extraction diagnostics');
  appendStyleValues(diagnostics, lowered.diagnostics, 'Style extraction diagnostics');
  const replacements: SourceReplacement[] = [];
  appendStyleValues(
    replacements,
    environment.provenanceReplacements,
    'Style extraction replacements',
  );
  appendStyleValues(replacements, lowered.replacements, 'Style extraction replacements');
  const queryUpdatePlans: QueryUpdatePlanFact[] = [];
  const stateDerives: StateDeriveFact[] = [];
  const updateCoverage: QueryUpdateCoverageFact[] = [];
  const dynamicCount = compilerArrayLength(lowered.dynamic, 'Style dynamic lowerings');
  for (let index = 0; index < dynamicCount; index += 1) {
    const entry = compilerOwnDataValue(
      lowered.dynamic,
      index,
      'Style dynamic lowerings',
    ) as DynamicStyleLowering;
    const queryPlan = compilerOwnDataValue(entry, 'queryPlan', `Style dynamic lowerings[${index}]`);
    const stateDerive = compilerOwnDataValue(
      entry,
      'stateDerive',
      `Style dynamic lowerings[${index}]`,
    );
    const coverage = compilerOwnDataValue(entry, 'coverage', `Style dynamic lowerings[${index}]`);
    if (queryPlan !== undefined) {
      compilerArrayAppend(
        queryUpdatePlans,
        queryPlan as QueryUpdatePlanFact,
        'Style query update plans',
      );
    }
    if (stateDerive !== undefined) {
      compilerArrayAppend(stateDerives, stateDerive as StateDeriveFact, 'Style state derives');
    }
    if (!compilerArrayIsArray(coverage)) {
      throw new TypeError(`Style dynamic lowerings[${index}].coverage must be an array.`);
    }
    appendStyleValues(
      updateCoverage,
      coverage as readonly QueryUpdateCoverageFact[],
      'Style update coverage',
    );
  }
  const extraction = {
    css,
    diagnostics,
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
    queryUpdatePlans,
    replacements,
    ruleUsages: environment.usages,
    stateDerives,
    updateCoverage,
  };
  return compilerSnapshotJsonValue(extraction, 'Style extraction result') as KovoStyleExtraction;
}

function hasInlineStyleExpressions(model: ComponentModuleModel): boolean {
  const elementCount = compilerArrayLength(model.jsxElements, 'Style JSX elements');
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const element = compilerOwnDataValue(
      model.jsxElements,
      elementIndex,
      'Style JSX elements',
    ) as ComponentModuleModel['jsxElements'][number];
    const attributeCount = compilerArrayLength(element.attributes, 'Style JSX attributes');
    for (let attributeIndex = 0; attributeIndex < attributeCount; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Style JSX attributes',
      ) as JsxAttributeModel;
      if (attribute.name === 'style' && attribute.expression) return true;
    }
  }
  return false;
}

function appendStyleValues<Value>(target: Value[], values: readonly Value[], label: string): void {
  const count = compilerArrayLength(values, label);
  for (let index = 0; index < count; index += 1) {
    compilerArrayAppend(target, compilerOwnDataValue(values, index, label) as Value, label);
  }
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
  const namespaces = compilerCreateSet<string>();
  const publicTokenNames = compilerCreateSet<string>();

  const statementCount = compilerArrayLength(sourceFile.statements, 'Style source statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Style source statements',
    ) as ts.Statement;
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== styleModuleSpecifier) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (namedBindings && ts.isNamespaceImport(namedBindings))
      compilerSetAdd(namespaces, namedBindings.name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      const elementCount = compilerArrayLength(namedBindings.elements, 'Style named imports');
      for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
        const element = compilerOwnDataValue(
          namedBindings.elements,
          elementIndex,
          'Style named imports',
        ) as ts.ImportSpecifier;
        if ((element.propertyName ?? element.name).text === styleTokensExportName) {
          compilerSetAdd(publicTokenNames, element.name.text);
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
  importedStaticValues: ReadonlyMap<string, unknown> = compilerCreateMap(),
  defaultStyleIdentity: StyleIdentityDefaults = {},
): StyleEnvironment {
  const bindings = compilerCreateMap<string, StyleBinding>();
  const themeClassBindings = compilerCreateMap<string, string>();
  const diagnostics: CompilerDiagnostic[] = [];
  const provenanceReplacements: SourceReplacement[] = [];
  const rules: AtomicRule[] = [];
  const keyframes: KeyframesResult[] = [];
  const usages: StyleRuleUsage[] = [];
  const staticValues = compilerCreateMap<string, unknown>();
  compilerMapForEach(collectLocalStaticValues(sourceFile, styleImports), (value, key) => {
    compilerMapSet(staticValues, key, value);
  });
  compilerMapForEach(importedStaticValues, (value, key) => {
    compilerMapSet(staticValues, key, value);
  });
  // Module-local `const x = { ... }` objects, so static `{ ...x }` spreads inside
  // a style object resolve (e.g. @kovojs/ui field.tsx shares `nativeControlStyle`).
  const localObjects = collectLocalObjectLiterals(sourceFile);

  const statementCount = compilerArrayLength(sourceFile.statements, 'Style source statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Style source statements',
    ) as ts.Statement;
    if (!ts.isVariableStatement(statement)) continue;
    const declarationCount = compilerArrayLength(
      statement.declarationList.declarations,
      'Style variable declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const node = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Style variable declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(node.name)) continue;

      // `const pulse = style.keyframes({ … }, identity?)`: resolve the frames into
      // an `@keyframes` block and bind the const name to the deterministic
      // animation-name so `animationName: pulse` extracts as a literal (lifts
      // KV236 for keyframes consts). SPEC.md §13.1.
      const frames = styleKeyframesCall(node.initializer, styleImports, localObjects, staticValues);
      if (frames) {
        const result = createKeyframesWithIdentity(frames.frames, {
          namespace: frames.options.namespace ?? defaultStyleIdentity.keyframes ?? 'keyframes',
          source: frames.options.source ?? fileName,
        });
        compilerMapSet(staticValues, node.name.text, result.name);
        compilerArrayAppend(keyframes, result, 'Style keyframes');
        continue;
      } else if (isStyleKeyframesCall(node.initializer, styleImports.namespaces)) {
        compilerArrayAppend(
          diagnostics,
          staticStyleDiagnostic(fileName, source, node, 'style.keyframes'),
          'Style diagnostics',
        );
        continue;
      }

      const vars = styleDefineVarsCall(node.initializer, styleImports.namespaces);
      if (vars) {
        const tokens = tokenValuesFromObject(vars.tokens, staticValues, styleImports);
        if (!tokens) {
          compilerArrayAppend(
            diagnostics,
            staticStyleDiagnostic(fileName, source, node, 'style.defineVars'),
            'Style diagnostics',
          );
          continue;
        }
        const result = defineVarsWithIdentity(tokens, {
          namespace:
            vars.options.namespace ??
            defaultStyleIdentity.vars ??
            derivedStyleNamespace(fileName, node.name.text),
          source: vars.options.source ?? fileName,
        });
        const resultRules = atomicRulesFromMetadata(result.__rules);
        compilerMapSet(staticValues, node.name.text, result);
        appendStyleValues(rules, resultRules, 'Style atomic rules');
        pushRuleUsages(usages, fileName, node.name.text, resultRules);
        continue;
      }

      const theme = styleCreateThemeCall(node.initializer, styleImports.namespaces);
      if (theme) {
        const baseTokens = ts.isIdentifier(theme.baseTokens)
          ? compilerMapGet(staticValues, theme.baseTokens.text)
          : undefined;
        const overrides = tokenValuesFromObject(theme.overrides, staticValues, styleImports);
        if (!baseTokens || !overrides) {
          compilerArrayAppend(
            diagnostics,
            staticStyleDiagnostic(fileName, source, node, 'style.createTheme'),
            'Style diagnostics',
          );
          continue;
        }
        const result = createThemeWithIdentity(
          baseTokens as Parameters<typeof createTheme>[0],
          overrides,
          {
            namespace:
              theme.options.namespace ??
              defaultStyleIdentity.theme ??
              derivedStyleNamespace(fileName, node.name.text),
            source: theme.options.source ?? fileName,
          },
        );
        const resultRules = atomicRulesFromMetadata(result.__rules);
        compilerMapSet(staticValues, node.name.text, result);
        compilerMapSet(themeClassBindings, `${node.name.text}.className`, result.className);
        appendStyleValues(rules, resultRules, 'Style atomic rules');
        pushRuleUsages(usages, fileName, node.name.text, resultRules);
        continue;
      }

      const created = styleCreateCall(node.initializer, styleImports, localObjects, staticValues);
      if (created) {
        const identity = {
          namespace:
            created.options.namespace ??
            defaultStyleIdentity.styles ??
            derivedStyleNamespace(fileName, node.name.text),
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
        if (provenanceReplacement) {
          compilerArrayAppend(
            provenanceReplacements,
            provenanceReplacement,
            'Style provenance replacements',
          );
        }
        appendStyleValues(rules, result.rules, 'Style atomic rules');

        const styleKeys = compilerObjectKeys(result.styles);
        const styleCount = compilerArrayLength(styleKeys, 'Style result keys');
        for (let styleIndex = 0; styleIndex < styleCount; styleIndex += 1) {
          const styleKey = compilerOwnDataValue(
            styleKeys,
            styleIndex,
            'Style result keys',
          ) as string;
          const style = compilerOwnDataValue(
            result.styles,
            styleKey,
            'Style result',
          ) as CompiledStyle;
          const styleRef = `${node.name.text}.${styleKey}`;
          compilerMapSet(bindings, styleRef, { style, styleRef });
          const styleRules = style.__rules ?? [];
          const ruleCount = compilerArrayLength(styleRules, 'Style compiled rules');
          for (let ruleIndex = 0; ruleIndex < ruleCount; ruleIndex += 1) {
            const rule = compilerOwnDataValue(
              styleRules,
              ruleIndex,
              'Style compiled rules',
            ) as AtomicRule;
            compilerArrayAppend(
              usages,
              {
                className: rule.className,
                moduleFileName: fileName,
                source: rule.source,
                styleRef,
              },
              'Style rule usages',
            );
          }
        }
      } else if (isStyleCreateCall(node.initializer, styleImports.namespaces)) {
        compilerArrayAppend(
          diagnostics,
          staticStyleDiagnostic(fileName, source, node, 'style.create'),
          'Style diagnostics',
        );
      }
    }
  }

  return {
    bindings,
    diagnostics,
    keyframes,
    provenanceReplacements,
    rules,
    themeClassBindings,
    usages,
  };
}

function collectImportedStaticValues(
  fileName: string,
  sourceFile: ts.SourceFile,
  options: { readonly resolveStaticImport?: StyleStaticImportResolver },
): ReadonlyMap<string, unknown> {
  const resolveStaticImport = compilerOwnDataValue(
    options,
    'resolveStaticImport',
    'Style static import options',
  );
  if (resolveStaticImport === undefined) return compilerCreateMap();
  if (typeof resolveStaticImport !== 'function') {
    throw new TypeError('Style static import resolver must be a function.');
  }
  const imports = importedStaticValueRequests(sourceFile);
  if (compilerArrayLength(imports, 'Style static imports') === 0) return compilerCreateMap();

  const byModule = compilerCreateMap<string, ImportedStaticValue[]>();
  const importCount = compilerArrayLength(imports, 'Style static imports');
  for (let index = 0; index < importCount; index += 1) {
    const entry = compilerOwnDataValue(
      imports,
      index,
      'Style static imports',
    ) as ImportedStaticValue;
    const bucket = compilerMapGet(byModule, entry.moduleSpecifier) ?? [];
    compilerArrayAppend(bucket, entry, 'Style static import module entries');
    compilerMapSet(byModule, entry.moduleSpecifier, bucket);
  }

  const result = compilerCreateMap<string, unknown>();
  compilerMapForEach(byModule, (entries, specifier) => {
    const importedSource = resolveStaticImport(fileName, specifier);
    if (importedSource === null) return;
    if (typeof importedSource !== 'string') {
      throw new TypeError('Style static import resolver must return a string or null.');
    }
    const importedValues = evaluateExportedStaticValues(
      `${fileName}#${specifier}`,
      importedSource,
      styleImportsFromSourceFile(parseSourceFile(`${fileName}#${specifier}`, importedSource)),
    );
    const entryCount = compilerArrayLength(entries, 'Style static import module entries');
    for (let index = 0; index < entryCount; index += 1) {
      const entry = compilerOwnDataValue(
        entries,
        index,
        'Style static import module entries',
      ) as ImportedStaticValue;
      const value = compilerMapGet(importedValues, entry.importName);
      if (value === undefined) continue;
      compilerMapSet(result, entry.localName, value);
    }
  });
  return result;
}

function derivedStyleNamespace(fileName: string, bindingName: string): string {
  const binding = looseKebabCase(bindingName);
  const stripped = compilerRegExpReplace(/-(styles|vars|theme)$/, binding, '');
  if (stripped !== binding && stripped.length > 0) return stripped;

  const normalizedFileName = compilerStringReplaceAll(fileName, '\\', '/');
  const pathSegments = compilerStringSplit(normalizedFileName, '/');
  let fileBase: string | undefined;
  const segmentCount = compilerArrayLength(pathSegments, 'Style file-name segments');
  for (let index = segmentCount - 1; index >= 0; index -= 1) {
    const segment = compilerOwnDataValue(pathSegments, index, 'Style file-name segments');
    if (typeof segment === 'string' && segment !== '') {
      fileBase = compilerRegExpReplace(/\.[cm]?[tj]sx?$/, segment, '');
      break;
    }
  }
  const fileNamespace = fileBase && fileBase.length > 0 ? fileBase : binding;

  if (binding === 'style' || binding === 'styles' || binding === 'base') return fileNamespace;
  if (binding === 'motion' || binding === 'overrides') return `${fileNamespace}-${binding}`;
  if (binding === 'orientations') return `${fileNamespace}-orientation`;
  if (binding === 'sizes') return `${fileNamespace}-size`;
  if (binding === 'variants') return `${fileNamespace}-variant`;

  return binding;
}

function importedStaticValueRequests(sourceFile: ts.SourceFile): ImportedStaticValue[] {
  const imports: ImportedStaticValue[] = [];
  const statementCount = compilerArrayLength(sourceFile.statements, 'Style import statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Style import statements',
    ) as ts.Statement;
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (!compilerStringStartsWith(moduleSpecifier, '.')) continue;
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const elementCount = compilerArrayLength(namedBindings.elements, 'Style imported values');
    for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
      const element = compilerOwnDataValue(
        namedBindings.elements,
        elementIndex,
        'Style imported values',
      ) as ts.ImportSpecifier;
      compilerArrayAppend(
        imports,
        {
          importName: (element.propertyName ?? element.name).text,
          localName: element.name.text,
          moduleSpecifier,
        },
        'Style imported values',
      );
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
  const staticValues = compilerCreateMap<string, unknown>();
  const exportedNames = compilerCreateSet<string>();
  const statementCount = compilerArrayLength(sourceFile.statements, 'Style exported statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Style exported statements',
    ) as ts.Statement;
    if (!ts.isVariableStatement(statement)) continue;
    let exported = false;
    if (statement.modifiers !== undefined) {
      const modifierCount = compilerArrayLength(statement.modifiers, 'Style export modifiers');
      for (let modifierIndex = 0; modifierIndex < modifierCount; modifierIndex += 1) {
        const modifier = compilerOwnDataValue(
          statement.modifiers,
          modifierIndex,
          'Style export modifiers',
        ) as ts.Modifier;
        if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
          exported = true;
          break;
        }
      }
    }
    const declarationCount = compilerArrayLength(
      statement.declarationList.declarations,
      'Style exported declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Style exported declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = staticValueFromExpression(declaration.initializer, staticValues, styleImports);
      if (value === undefined) continue;
      compilerMapSet(staticValues, declaration.name.text, value);
      if (exported) compilerSetAdd(exportedNames, declaration.name.text);
    }
  }
  const exportedValues = compilerCreateMap<string, unknown>();
  compilerMapForEach(staticValues, (value, name) => {
    if (compilerSetHas(exportedNames, name)) compilerMapSet(exportedValues, name, value);
  });
  return exportedValues;
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
    return compilerMapGet(staticValues, expression.text);
  }

  const propertyAccess = staticPropertyAccessValue(expression, staticValues, styleImports);
  if (propertyAccess !== undefined) return propertyAccess;

  if (ts.isObjectLiteralExpression(expression)) {
    const object = compilerCreateNullRecord<unknown>();
    const propertyCount = compilerArrayLength(
      expression.properties,
      'Style static object properties',
    );
    for (let index = 0; index < propertyCount; index += 1) {
      const property = compilerOwnDataValue(
        expression.properties,
        index,
        'Style static object properties',
      ) as ts.ObjectLiteralElementLike;
      if (!ts.isPropertyAssignment(property)) return undefined;
      const key = propertyNameText(property.name);
      if (!key) return undefined;
      const value = staticValueFromExpression(property.initializer, staticValues, styleImports);
      if (value === undefined) return undefined;
      compilerSetOwnDataProperty(object, key, value);
    }
    return object;
  }

  if (isObjectFreezeCall(expression)) {
    const value = compilerOwnDataValue(expression.arguments, 0, 'Style Object.freeze arguments') as
      | ts.Expression
      | undefined;
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
    node.expression.name.text === objectFreezeMemberName &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === objectIdentifierName
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

  const stylesArgument = compilerOwnDataValue(
    initializer.arguments,
    0,
    'Style create arguments',
  ) as ts.Expression | undefined;
  const optionsArgument = compilerOwnDataValue(
    initializer.arguments,
    1,
    'Style create arguments',
  ) as ts.Expression | undefined;
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
  if (initializer.expression.name.text !== styleCreateMemberName) return false;
  if (!ts.isIdentifier(initializer.expression.expression)) return false;
  return compilerSetHas(styleNamespaces, initializer.expression.expression.text);
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
  if (initializer.expression.name.text !== styleDefineVarsMemberName) return null;
  if (!ts.isIdentifier(initializer.expression.expression)) return null;
  if (!compilerSetHas(styleNamespaces, initializer.expression.expression.text)) return null;
  const tokensArgument = compilerOwnDataValue(
    initializer.arguments,
    0,
    'Style defineVars arguments',
  ) as ts.Expression | undefined;
  const optionsArgument = compilerOwnDataValue(
    initializer.arguments,
    1,
    'Style defineVars arguments',
  ) as ts.Expression | undefined;
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
  if (initializer.expression.name.text !== styleCreateThemeMemberName) return null;
  if (!ts.isIdentifier(initializer.expression.expression)) return null;
  if (!compilerSetHas(styleNamespaces, initializer.expression.expression.text)) return null;
  const baseTokens = compilerOwnDataValue(
    initializer.arguments,
    0,
    'Style createTheme arguments',
  ) as ts.Expression | undefined;
  const overridesArgument = compilerOwnDataValue(
    initializer.arguments,
    1,
    'Style createTheme arguments',
  ) as ts.Expression | undefined;
  const optionsArgument = compilerOwnDataValue(
    initializer.arguments,
    2,
    'Style createTheme arguments',
  ) as ts.Expression | undefined;
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

  const framesArgument = compilerOwnDataValue(
    initializer.arguments,
    0,
    'Style keyframes arguments',
  ) as ts.Expression | undefined;
  const optionsArgument = compilerOwnDataValue(
    initializer.arguments,
    1,
    'Style keyframes arguments',
  ) as ts.Expression | undefined;
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
  if (initializer.expression.name.text !== styleKeyframesMemberName) return false;
  if (!ts.isIdentifier(initializer.expression.expression)) return false;
  return compilerSetHas(styleNamespaces, initializer.expression.expression.text);
}

function styleNamespacesFromObject(
  node: ts.ObjectLiteralExpression,
  localObjects: LocalObjectLiterals,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): Record<string, StyleObject> | null {
  const styles = compilerCreateNullRecord<StyleObject>();

  const propertyCount = compilerArrayLength(node.properties, 'Style namespace properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      node.properties,
      index,
      'Style namespace properties',
    ) as ts.ObjectLiteralElementLike;
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
    compilerSetOwnDataProperty(styles, key, value);
  }

  return styles;
}

function styleObjectFromObject(
  node: ts.ObjectLiteralExpression,
  localObjects: LocalObjectLiterals,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): StyleObject | null {
  const style = compilerCreateNullRecord<string | number | StyleObject>();

  const propertyCount = compilerArrayLength(node.properties, 'Style object properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      node.properties,
      index,
      'Style object properties',
    ) as ts.ObjectLiteralElementLike;
    // `{ ...sharedStyle, ... }`: inline a module-local const object literal so a
    // styled component that composes shared fragments still extracts statically.
    if (ts.isSpreadAssignment(property)) {
      if (!ts.isIdentifier(property.expression)) return null;
      const target = compilerMapGet(localObjects, property.expression.text);
      if (!target) return null;
      const spread = styleObjectFromObject(target, localObjects, staticValues, styleImports);
      if (!spread) return null;
      const keys = compilerObjectKeys(spread);
      const keyCount = compilerArrayLength(keys, 'Style spread keys');
      for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
        const key = compilerOwnDataValue(keys, keyIndex, 'Style spread keys') as string;
        compilerSetOwnDataProperty(style, key, compilerOwnDataValue(spread, key, 'Style spread'));
      }
      continue;
    }
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = property.initializer;
    if (ts.isObjectLiteralExpression(value)) {
      const nested = styleObjectFromObject(value, localObjects, staticValues, styleImports);
      if (!nested) return null;
      compilerSetOwnDataProperty(style, key, nested);
      continue;
    }
    const primitive = staticPrimitiveValue(value, staticValues, styleImports);
    if (primitive === undefined) return null;
    compilerSetOwnDataProperty(style, key, primitive);
  }

  return style;
}

function tokenValuesFromObject(
  node: ts.ObjectLiteralExpression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): Record<string, CssValue> | null {
  const result = compilerCreateNullRecord<CssValue>();
  const propertyCount = compilerArrayLength(node.properties, 'Style token properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      node.properties,
      index,
      'Style token properties',
    ) as ts.ObjectLiteralElementLike;
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = staticCssValue(property.initializer, staticValues, styleImports);
    if (value === undefined) return null;
    compilerSetOwnDataProperty(result, key, value);
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
  const objects = compilerCreateMap<string, ts.ObjectLiteralExpression>();
  const statementCount = compilerArrayLength(sourceFile.statements, 'Style local statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Style local statements',
    ) as ts.Statement;
    if (!ts.isVariableStatement(statement)) continue;
    const declarationCount = compilerArrayLength(
      statement.declarationList.declarations,
      'Style local declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Style local declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const literal = unwrapObjectLiteral(declaration.initializer);
      if (literal) compilerMapSet(objects, declaration.name.text, literal);
    }
  }
  return objects;
}

function collectLocalStaticValues(
  sourceFile: ts.SourceFile,
  styleImports: StyleImports,
): ReadonlyMap<string, unknown> {
  const staticValues = compilerCreateMap<string, unknown>();

  const statementCount = compilerArrayLength(sourceFile.statements, 'Style local statements');
  for (let statementIndex = 0; statementIndex < statementCount; statementIndex += 1) {
    const statement = compilerOwnDataValue(
      sourceFile.statements,
      statementIndex,
      'Style local statements',
    ) as ts.Statement;
    if (!ts.isVariableStatement(statement)) continue;
    const declarationCount = compilerArrayLength(
      statement.declarationList.declarations,
      'Style local declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarationCount; declarationIndex += 1) {
      const declaration = compilerOwnDataValue(
        statement.declarationList.declarations,
        declarationIndex,
        'Style local declarations',
      ) as ts.VariableDeclaration;
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = staticValueFromExpression(declaration.initializer, staticValues, styleImports);
      if (value !== undefined) compilerMapSet(staticValues, declaration.name.text, value);
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
  const options = compilerCreateNullRecord<string>() as { namespace?: string; source?: string };

  const propertyCount = compilerArrayLength(node.properties, 'Style identity properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      node.properties,
      index,
      'Style identity properties',
    ) as ts.ObjectLiteralElementLike;
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyNameText(property.name);
    const value = primitiveValue(property.initializer);
    if (key === 'namespace' && typeof value === 'string') {
      compilerSetOwnDataProperty(options, 'namespace', value);
    }
    if (key === 'source' && typeof value === 'string') {
      compilerSetOwnDataProperty(options, 'source', value);
    }
  }

  return options;
}

function styleCreateProvenanceReplacement(
  call: ts.CallExpression,
  existingOptions: StyleIdentityOptions,
  identity: Required<StyleIdentityOptions>,
): SourceReplacement | null {
  if (existingOptions.namespace && existingOptions.source) return null;

  const properties: string[] = [];
  if (!existingOptions.namespace) {
    compilerArrayAppend(
      properties,
      `namespace: ${styleJsonString(identity.namespace)}`,
      'Style provenance properties',
    );
  }
  if (!existingOptions.source) {
    compilerArrayAppend(
      properties,
      `source: ${styleJsonString(identity.source)}`,
      'Style provenance properties',
    );
  }
  const optionsArgument = compilerOwnDataValue(
    call.arguments,
    1,
    'Style create provenance arguments',
  ) as ts.Expression | undefined;

  if (!optionsArgument) {
    const stylesArgument = compilerOwnDataValue(
      call.arguments,
      0,
      'Style create provenance arguments',
    ) as ts.Expression | undefined;
    if (!stylesArgument) return null;
    const position = stylesArgument.getEnd();
    return {
      end: position,
      replacement: `, { ${compilerArrayJoin(properties, ', ')} }`,
      start: position,
    };
  }

  if (!ts.isObjectLiteralExpression(optionsArgument)) return null;
  const position = optionsArgument.getEnd() - 1;
  return {
    end: position,
    replacement: `${compilerArrayLength(optionsArgument.properties, 'Style provenance option properties') > 0 ? ', ' : ''}${compilerArrayJoin(properties, ', ')}`,
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
  > & {
    readonly themeClassBindings: ReadonlyMap<string, string>;
  },
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
  const nameCounts = compilerCreateMap<string, number>();

  const elementCount = compilerArrayLength(model.jsxElements, 'Style JSX elements');
  for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
    const element = compilerOwnDataValue(
      model.jsxElements,
      elementIndex,
      'Style JSX elements',
    ) as ComponentModuleModel['jsxElements'][number];
    const attributeCount = compilerArrayLength(element.attributes, 'Style JSX attributes');
    for (let attributeIndex = 0; attributeIndex < attributeCount; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Style JSX attributes',
      ) as JsxAttributeModel;
      if (attribute.name !== 'style' || !attribute.expression) continue;
      const expression = parseExpression(attribute.expression);
      if (!expression) continue;
      const resolved = resolveStyleBindings(expression.expression, bindings);
      if (!resolved) {
        const inlineStatic = staticInlineStyleAttributeReplacement(element, attribute, expression);
        if (inlineStatic) {
          appendStyleValues(diagnostics, inlineStatic.diagnostics, 'Style diagnostics');
          if (!inlineStatic.styleReplacement) continue;
          appendStyleValues(replacements, inlineStatic.extraReplacements, 'Style replacements');
          compilerArrayAppend(
            replacements,
            {
              end: attribute.end,
              replacement: inlineStatic.styleReplacement,
              start: attribute.start,
            },
            'Style replacements',
          );
          continue;
        }
        const lowered = dynamicStyleAttributeLowering(
          attribute,
          expression.expression,
          bindings,
          componentName,
          knownQueries,
          nameCounts,
        );
        if (!lowered) continue;
        compilerArrayAppend(dynamic, lowered, 'Style dynamic lowerings');
        compilerArrayAppend(handledSpans, lowered.handledSpan, 'Style handled spans');
        compilerArrayAppend(replacements, lowered.replacement, 'Style replacements');
        continue;
      }
      const resolvedStyles: CompiledStyle[] = [];
      const resolvedCount = compilerArrayLength(resolved, 'Resolved style bindings');
      for (let index = 0; index < resolvedCount; index += 1) {
        const binding = compilerOwnDataValue(
          resolved,
          index,
          'Resolved style bindings',
        ) as StyleBinding;
        compilerArrayAppend(resolvedStyles, binding.style, 'Resolved compiled styles');
      }
      const merged = attrs(resolvedStyles);
      const lowered = staticStyleAttributeReplacement(element, attribute, merged, options);
      appendStyleValues(diagnostics, lowered.diagnostics, 'Style diagnostics');
      if (!lowered.styleReplacement) continue;
      compilerArrayAppend(
        handledSpans,
        { end: attribute.end, start: attribute.start },
        'Style handled spans',
      );
      appendStyleValues(replacements, lowered.extraReplacements, 'Style replacements');
      compilerArrayAppend(
        replacements,
        {
          end: attribute.end,
          replacement: lowered.styleReplacement,
          start: attribute.start,
        },
        'Style replacements',
      );
    }
  }

  return { diagnostics, dynamic, handledSpans, replacements };
}

function staticInlineStyleAttributeReplacement(
  element: ComponentModuleModel['jsxElements'][number],
  styleAttribute: JsxAttributeModel,
  expression: ParsedExpression,
): {
  diagnostics: readonly CompilerDiagnostic[];
  extraReplacements: readonly SourceReplacement[];
  styleReplacement: string | null;
} | null {
  if (!ts.isObjectLiteralExpression(expression.expression)) return null;
  const style = inlineStyleObjectFromObject(expression.expression);
  if (!style) return null;
  return staticStyleAttributeReplacement(
    element,
    styleAttribute,
    { style: serializeInlineStyleObject(style) },
    {
      fileName: expression.sourceFile.fileName,
      source: expression.sourceFile.text,
      themeClassBindings: compilerCreateMap(),
    },
  );
}

function inlineStyleObjectFromObject(
  node: ts.ObjectLiteralExpression,
): Record<string, string | number> | null {
  const style = compilerCreateNullRecord<string | number>();

  const propertyCount = compilerArrayLength(node.properties, 'Inline style properties');
  for (let index = 0; index < propertyCount; index += 1) {
    const property = compilerOwnDataValue(
      node.properties,
      index,
      'Inline style properties',
    ) as ts.ObjectLiteralElementLike;
    if (!ts.isPropertyAssignment(property)) return null;
    const key = propertyNameText(property.name);
    if (!key) return null;
    const value = primitiveValue(property.initializer);
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    compilerSetOwnDataProperty(style, looseKebabCase(key), value);
  }

  return style;
}

function serializeInlineStyleObject(style: Readonly<Record<string, string | number>>): string {
  const entries: string[] = [];
  const keys = compilerObjectKeys(style);
  const keyCount = compilerArrayLength(keys, 'Inline style keys');
  for (let index = 0; index < keyCount; index += 1) {
    const property = compilerOwnDataValue(keys, index, 'Inline style keys') as string;
    const value = compilerOwnDataValue(style, property, 'Inline style values');
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new TypeError('Inline style value must be a string or number.');
    }
    compilerArrayAppend(entries, `${property}:${value}`, 'Inline style entries');
  }
  return compilerArrayJoin(entries, ';');
}

function staticStyleAttributeReplacement(
  element: ComponentModuleModel['jsxElements'][number],
  styleAttribute: JsxAttributeModel,
  attributes: ReturnType<typeof attrs>,
  options: Pick<CompileComponentOptions, 'fileName' | 'source'> & {
    readonly themeClassBindings: ReadonlyMap<string, string>;
  },
): {
  diagnostics: readonly CompilerDiagnostic[];
  extraReplacements: readonly SourceReplacement[];
  styleReplacement: string | null;
} {
  const diagnostics: CompilerDiagnostic[] = [];
  const extraReplacements: SourceReplacement[] = [];
  const remaining = compilerCreateNullRecord<string>() as {
    class?: string;
    'data-style-src'?: string;
    style?: string;
  };
  const className = compilerOwnDataValue(attributes, 'class', 'Style lowered attributes');
  const styleSource = compilerOwnDataValue(
    attributes,
    'data-style-src',
    'Style lowered attributes',
  );
  const inlineStyle = compilerOwnDataValue(attributes, 'style', 'Style lowered attributes');
  if (typeof className === 'string') compilerSetOwnDataProperty(remaining, 'class', className);
  if (typeof styleSource === 'string') {
    compilerSetOwnDataProperty(remaining, 'data-style-src', styleSource);
  }
  if (typeof inlineStyle === 'string') compilerSetOwnDataProperty(remaining, 'style', inlineStyle);
  let classAttribute: JsxAttributeModel | undefined;
  let styleSrcAttribute: JsxAttributeModel | undefined;
  const attributeCount = compilerArrayLength(element.attributes, 'Style JSX attributes');
  for (let index = 0; index < attributeCount; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Style JSX attributes',
    ) as JsxAttributeModel;
    if (attribute.name === 'class' && classAttribute === undefined) classAttribute = attribute;
    if (attribute.name === 'data-style-src' && styleSrcAttribute === undefined) {
      styleSrcAttribute = attribute;
    }
  }

  if (remaining.class && classAttribute) {
    const existingClass = staticAttributeString(classAttribute, options.themeClassBindings);
    if (existingClass === null) {
      compilerArrayAppend(
        diagnostics,
        styleWriterConflictDiagnostic(
          options,
          classAttribute,
          'class',
          'author JSX',
          'style lowerer',
        ),
        'Style diagnostics',
      );
    } else {
      compilerArrayAppend(
        extraReplacements,
        {
          end: classAttribute.end,
          replacement: `class="${escapeAttribute(mergeClassNames(existingClass, remaining.class))}"`,
          start: classAttribute.start,
        },
        'Style replacements',
      );
      delete remaining.class;
    }
  }

  if (remaining['data-style-src'] && styleSrcAttribute) {
    const existingStyleSrc = staticAttributeString(styleSrcAttribute, options.themeClassBindings);
    if (existingStyleSrc !== remaining['data-style-src']) {
      compilerArrayAppend(
        diagnostics,
        styleWriterConflictDiagnostic(
          options,
          styleSrcAttribute,
          'data-style-src',
          'author JSX',
          'style lowerer',
        ),
        'Style diagnostics',
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
  if (attributes.class) {
    compilerArrayAppend(parts, `class="${escapeAttribute(attributes.class)}"`, 'Style attributes');
  }
  if (attributes['data-style-src']) {
    compilerArrayAppend(
      parts,
      `data-style-src="${escapeAttribute(attributes['data-style-src'])}"`,
      'Style attributes',
    );
  }
  if (attributes.style) {
    compilerArrayAppend(parts, `style="${escapeAttribute(attributes.style)}"`, 'Style attributes');
  }
  return compilerArrayLength(parts, 'Style attributes') > 0 ? compilerArrayJoin(parts, ' ') : null;
}

function staticAttributeString(
  attribute: JsxAttributeModel,
  themeClassBindings: ReadonlyMap<string, string>,
): string | null {
  if (attribute.value !== undefined) return attribute.value;
  if (attribute.expression) {
    const expression = parseExpression(attribute.expression);
    if (expression) {
      const themeClass = staticThemeClassName(expression.expression, themeClassBindings);
      if (themeClass !== null) return themeClass;
    }
  }
  return typeof attribute.expressionStaticValue === 'string'
    ? attribute.expressionStaticValue
    : null;
}

function staticThemeClassName(
  expression: ts.Expression,
  themeClassBindings: ReadonlyMap<string, string>,
): string | null {
  if (!ts.isPropertyAccessExpression(expression)) return null;
  if (!ts.isIdentifier(expression.expression)) return null;
  if (expression.name.text !== themeClassNameMemberName) return null;
  return compilerMapGet(themeClassBindings, `${expression.expression.text}.className`) ?? null;
}

function mergeClassNames(first: string, second: string): string {
  const names: string[] = [];
  const seen = compilerCreateSet<string>();
  appendUniqueClassNames(names, seen, compilerStringSplit(first, ' '));
  appendUniqueClassNames(names, seen, compilerStringSplit(second, ' '));
  return compilerArrayJoin(names, ' ');
}

function appendUniqueClassNames(
  target: string[],
  seen: Set<string>,
  candidates: readonly string[],
): void {
  const candidateCount = compilerArrayLength(candidates, 'Style class-name candidates');
  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = compilerOwnDataValue(candidates, index, 'Style class-name candidates');
    if (typeof candidate !== 'string' || candidate === '' || compilerSetHas(seen, candidate)) {
      continue;
    }
    compilerSetAdd(seen, candidate);
    compilerArrayAppend(target, candidate, 'Merged style class names');
  }
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
    const binding = compilerMapGet(
      bindings,
      `${expression.expression.text}.${expression.name.text}`,
    );
    return binding ? [binding] : null;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    const result: StyleBinding[] = [];
    const elementCount = compilerArrayLength(expression.elements, 'Style array expression');
    for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
      const element = compilerOwnDataValue(
        expression.elements,
        elementIndex,
        'Style array expression',
      ) as ts.Expression;
      if (
        element.kind === ts.SyntaxKind.FalseKeyword ||
        element.kind === ts.SyntaxKind.NullKeyword
      ) {
        continue;
      }
      const nested = resolveStyleBindings(element, bindings);
      if (!nested) return null;
      appendStyleValues(result, nested, 'Resolved style bindings');
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

  const variants = styleClassVariants(expression, bindings, {
    facts: attribute.expressionConditionalFacts ?? [],
    index: 0,
  });
  if (!variants) return null;
  const classExpression = classExpressionForVariants(variants);
  if (!classExpression) return null;

  const roots: string[] = [];
  const rootSet = compilerCreateSet<string>();
  const propertyAccesses = attribute.expressionPropertyAccesses ?? [];
  const propertyAccessCount = compilerArrayLength(
    propertyAccesses,
    'Dynamic style property accesses',
  );
  for (let index = 0; index < propertyAccessCount; index += 1) {
    const access = compilerOwnDataValue(
      propertyAccesses,
      index,
      'Dynamic style property accesses',
    ) as { readonly path: string };
    if (compilerMapGet(bindings, access.path) !== undefined) continue;
    const root = queryNameFromPath(access.path);
    if (root === null || compilerSetHas(rootSet, root)) continue;
    compilerSetAdd(rootSet, root);
    compilerArrayAppend(roots, root, 'Dynamic style roots');
  }

  const rootCount = compilerArrayLength(roots, 'Dynamic style roots');
  let stateOnly = rootCount > 0;
  let allRootsAreServerOnly = true;
  let queryRoot: string | null = null;
  let queryOnly = rootCount > 0;
  for (let index = 0; index < rootCount; index += 1) {
    const root = compilerOwnDataValue(roots, index, 'Dynamic style roots');
    if (typeof root !== 'string') return null;
    if (root !== 'state') stateOnly = false;
    if (compilerSetHas(knownQueries, root)) {
      allRootsAreServerOnly = false;
      if (queryRoot === null) queryRoot = root;
      else if (queryRoot !== root) queryOnly = false;
    } else {
      queryOnly = false;
    }
  }
  const serverOnly = !stateOnly && (rootCount === 0 || allRootsAreServerOnly);
  if (queryRoot === null) queryOnly = false;
  const query = stateOnly ? 'state' : queryOnly ? queryRoot : null;
  if (!query && !serverOnly) return null;

  const exportName = nextExportName(
    `${sanitizeIdentifier(componentName)}$style_class_derive`,
    nameCounts,
  );
  if (serverOnly) {
    return {
      coverage: [],
      handledSpan: { end: attribute.end, start: attribute.start },
      replacement: {
        end: attribute.end,
        replacement: `class={${classExpression}}`,
        start: attribute.start,
      },
    };
  }

  if (!query) return null;
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
      replacement: stateOnly
        ? `class={${classExpression}} data-bind:class="state.${exportName}"`
        : `data-derive="${escapeAttribute(`${query}.${exportName}`)}" data-derive-attr="class"`,
      start: attribute.start,
    },
  };
}

function styleClassVariants(
  expression: ts.Expression,
  bindings: ReadonlyMap<string, StyleBinding>,
  conditionFacts: StyleConditionFactCursor,
): StyleClassVariant[] | null {
  if (ts.isParenthesizedExpression(expression)) {
    return styleClassVariants(expression.expression, bindings, conditionFacts);
  }

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const binding = compilerMapGet(
      bindings,
      `${expression.expression.text}.${expression.name.text}`,
    );
    return binding ? [{ conditions: [], styles: [binding.style] }] : null;
  }

  if (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return [{ conditions: [], styles: [] }];
  }

  if (ts.isConditionalExpression(expression)) {
    const conditionFact = compilerOwnDataValue(
      conditionFacts.facts,
      conditionFacts.index,
      'Dynamic style condition facts',
    ) as { readonly condition?: string } | undefined;
    const condition =
      conditionFact === undefined
        ? undefined
        : compilerOwnDataValue(conditionFact, 'condition', 'Dynamic style condition fact');
    conditionFacts.index += 1;
    if (typeof condition !== 'string' || condition === '') return null;
    const whenTrue = styleClassVariants(expression.whenTrue, bindings, conditionFacts);
    const whenFalse = styleClassVariants(expression.whenFalse, bindings, conditionFacts);
    if (!whenTrue || !whenFalse) return null;
    const variants: StyleClassVariant[] = [];
    appendConditionalStyleVariants(variants, whenTrue, `(${condition})`);
    appendConditionalStyleVariants(variants, whenFalse, `!(${condition})`);
    return variants;
  }

  if (ts.isArrayLiteralExpression(expression)) {
    let variants: StyleClassVariant[] = [{ conditions: [], styles: [] }];
    const elementCount = compilerArrayLength(expression.elements, 'Dynamic style array elements');
    for (let elementIndex = 0; elementIndex < elementCount; elementIndex += 1) {
      const element = compilerOwnDataValue(
        expression.elements,
        elementIndex,
        'Dynamic style array elements',
      ) as ts.Expression;
      const itemVariants = styleClassVariants(element, bindings, conditionFacts);
      if (!itemVariants) return null;
      const combined: StyleClassVariant[] = [];
      const leftCount = compilerArrayLength(variants, 'Dynamic style left variants');
      const rightCount = compilerArrayLength(itemVariants, 'Dynamic style right variants');
      for (let leftIndex = 0; leftIndex < leftCount; leftIndex += 1) {
        const left = compilerOwnDataValue(
          variants,
          leftIndex,
          'Dynamic style left variants',
        ) as StyleClassVariant;
        for (let rightIndex = 0; rightIndex < rightCount; rightIndex += 1) {
          const right = compilerOwnDataValue(
            itemVariants,
            rightIndex,
            'Dynamic style right variants',
          ) as StyleClassVariant;
          const conditions: string[] = [];
          const styles: CompiledStyle[] = [];
          appendStyleValues(conditions, left.conditions, 'Dynamic style variant conditions');
          appendStyleValues(conditions, right.conditions, 'Dynamic style variant conditions');
          appendStyleValues(styles, left.styles, 'Dynamic style variant styles');
          appendStyleValues(styles, right.styles, 'Dynamic style variant styles');
          compilerArrayAppend(combined, { conditions, styles }, 'Combined dynamic style variants');
        }
      }
      variants = combined;
    }
    return variants;
  }

  return null;
}

function appendConditionalStyleVariants(
  target: StyleClassVariant[],
  variants: readonly StyleClassVariant[],
  condition: string,
): void {
  const variantCount = compilerArrayLength(variants, 'Conditional style variants');
  for (let index = 0; index < variantCount; index += 1) {
    const variant = compilerOwnDataValue(
      variants,
      index,
      'Conditional style variants',
    ) as StyleClassVariant;
    const conditions: string[] = [];
    appendStyleValues(conditions, variant.conditions, 'Conditional style conditions');
    compilerArrayAppend(conditions, condition, 'Conditional style conditions');
    compilerArrayAppend(
      target,
      { conditions, styles: variant.styles },
      'Conditional style variants output',
    );
  }
}

function classExpressionForVariants(variants: readonly StyleClassVariant[]): string | null {
  const unique = dedupeVariants(variants);
  const uniqueCount = compilerArrayLength(unique, 'Unique style class variants');
  if (uniqueCount === 0) return '""';
  let unconditional: StyleClassVariant | undefined;
  for (let index = 0; index < uniqueCount; index += 1) {
    const variant = compilerOwnDataValue(
      unique,
      index,
      'Unique style class variants',
    ) as StyleClassVariant;
    if (compilerArrayLength(variant.conditions, 'Style class variant conditions') === 0) {
      unconditional = variant;
      break;
    }
  }
  if (unconditional && uniqueCount === 1) {
    return styleJsonString(classNameForStyles(unconditional.styles));
  }

  let expression = unconditional ? styleJsonString(classNameForStyles(unconditional.styles)) : '""';
  for (let index = uniqueCount - 1; index >= 0; index -= 1) {
    const variant = compilerOwnDataValue(
      unique,
      index,
      'Unique style class variants',
    ) as StyleClassVariant;
    if (compilerArrayLength(variant.conditions, 'Style class variant conditions') === 0) continue;
    const condition = compilerArrayJoin(variant.conditions, ' && ');
    expression = `(${condition}) ? ${styleJsonString(classNameForStyles(variant.styles))} : (${expression})`;
  }
  return expression;
}

function dedupeVariants(variants: readonly StyleClassVariant[]): StyleClassVariant[] {
  const seen = compilerCreateSet<string>();
  const result: StyleClassVariant[] = [];
  const variantCount = compilerArrayLength(variants, 'Style class variants');
  for (let index = 0; index < variantCount; index += 1) {
    const variant = compilerOwnDataValue(
      variants,
      index,
      'Style class variants',
    ) as StyleClassVariant;
    const key = `${compilerArrayJoin(variant.conditions, '\0')}\x01${classNameForStyles(variant.styles)}`;
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(result, variant, 'Unique style class variants');
  }
  return result;
}

function styleJsonString(value: string): string {
  const serialized = compilerJsonStringify(value);
  if (serialized === undefined) throw new TypeError('Style class name must serialize as JSON.');
  return serialized;
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
  const seen = compilerCreateSet<string>();
  const coverage: QueryUpdateCoverageFact[] = [];
  const propertyAccesses = attribute.expressionPropertyAccesses ?? [];
  const propertyAccessCount = compilerArrayLength(
    propertyAccesses,
    'Style update property accesses',
  );
  const prefix = stateOnly ? 'state.' : `${query}.`;
  for (let index = 0; index < propertyAccessCount; index += 1) {
    const access = compilerOwnDataValue(
      propertyAccesses,
      index,
      'Style update property accesses',
    ) as { readonly path: string };
    if (!compilerStringStartsWith(access.path, prefix) || compilerSetHas(seen, access.path)) {
      continue;
    }
    compilerSetAdd(seen, access.path);
    compilerArrayAppend(
      coverage,
      {
        componentName,
        detail: 'style-object toggle',
        position: 'attribute',
        query: access.path,
        ...(stateOnly ? { source: 'state' as const } : {}),
        status: 'plan' as const,
      },
      'Style update coverage',
    );
  }
  return coverage;
}

function parseExpression(source: string): ParsedExpression | null {
  const sourceFile = parseSourceFile(
    'style-expression.tsx',
    `const __kovoStyleExpression = ${source};`,
  );
  const statement = compilerOwnDataValue(
    sourceFile.statements,
    0,
    'Style expression statements',
  ) as ts.Statement | undefined;
  if (!statement || !ts.isVariableStatement(statement)) return null;
  const declaration = compilerOwnDataValue(
    statement.declarationList.declarations,
    0,
    'Style expression declarations',
  ) as ts.VariableDeclaration | undefined;
  if (!declaration?.initializer) return null;
  return { expression: declaration.initializer, sourceFile };
}

function nextExportName(baseName: string, nameCounts: Map<string, number>): string {
  const count = compilerMapGet(nameCounts, baseName) ?? 0;
  compilerMapSet(nameCounts, baseName, count + 1);
  return count === 0 ? baseName : `${baseName}_${count + 1}`;
}

function pushRuleUsages(
  usages: StyleRuleUsage[],
  fileName: string,
  styleRefRoot: string,
  rules: readonly AtomicRule[],
): void {
  const ruleCount = compilerArrayLength(rules, 'Style rule usages');
  for (let index = 0; index < ruleCount; index += 1) {
    const rule = compilerOwnDataValue(rules, index, 'Style rule usages') as AtomicRule;
    compilerArrayAppend(
      usages,
      {
        className: rule.className,
        moduleFileName: fileName,
        source: rule.source,
        styleRef: `${styleRefRoot}.${rule.property}`,
      },
      'Style rule usages',
    );
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
    help: compilerArrayJoin(
      [
        `Would lower to: static CSS rules extracted from ${api}.`,
        'Blocked reason: the style extractor only accepts literals, same-file defineVars/createTheme values, and public @kovojs/style theme token references.',
        'Fixes: move the value into a static object literal, import the public tokens object from @kovojs/style, or keep dynamic styling behind an explicit raw style escape.',
        'SPEC §5.2 requires post-parse compiler decisions to use typed facts; SPEC §13.1 requires StyleX-authored component styles to extract into CSS assets.',
      ],
      '\n',
    ),
    message: `Static style extraction could not prove ${api} values.`,
  };
}

function staticCssValue(
  node: ts.Expression,
  staticValues: ReadonlyMap<string, unknown>,
  styleImports: StyleImports,
): CssValue | undefined {
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node) && node.text === undefinedIdentifierName) return undefined;
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
    const value = compilerMapGet(staticValues, node.text);
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
  const publicTokenSegments = publicThemeTokenAccessSegments(node, styleImports);
  if (publicTokenSegments) return publicThemeTokenValue(publicTokenSegments);

  const path = propertyAccessPath(node);
  if (!path || compilerArrayLength(path, 'Style property access path') === 0) return undefined;
  const root = compilerOwnDataValue(path, 0, 'Style property access path');
  if (typeof root !== 'string' || root === '') return undefined;
  const segments = styleArrayTail(path, 'Style property access path');

  if (compilerSetHas(styleImports.publicTokenNames, root)) {
    return publicThemeTokenValue(segments);
  }

  if (
    compilerSetHas(styleImports.namespaces, root) &&
    compilerOwnDataValue(segments, 0, 'Style property access segments') === 'tokens'
  ) {
    return publicThemeTokenValue(styleArrayTail(segments, 'Style property access segments'));
  }

  const staticValue = compilerMapGet(staticValues, root);
  if (staticValue === undefined) return undefined;
  return valueAtPath(staticValue, segments);
}

function publicThemeTokenAccessSegments(
  node: ts.Expression,
  styleImports: StyleImports,
): string[] | null {
  const path = publicThemeTokenAccessPath(node);
  if (!path || compilerArrayLength(path, 'Public theme token access path') === 0) return null;
  const root = compilerOwnDataValue(path, 0, 'Public theme token access path');
  if (typeof root !== 'string' || root === '') return null;
  const segments = styleArrayTail(path, 'Public theme token access path');
  if (compilerSetHas(styleImports.publicTokenNames, root)) return segments;
  if (
    compilerSetHas(styleImports.namespaces, root) &&
    compilerOwnDataValue(segments, 0, 'Public theme token access segments') === 'tokens'
  ) {
    return styleArrayTail(segments, 'Public theme token access segments');
  }
  return null;
}

function publicThemeTokenAccessPath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const prefix = publicThemeTokenAccessPath(node.expression);
    return prefix
      ? stylePathAppend(prefix, node.name.text, 'Public theme token access path')
      : null;
  }
  if (ts.isCallExpression(node)) {
    const prefix = publicThemeTokenAccessPath(node.expression);
    const argumentCount = compilerArrayLength(node.arguments, 'Public theme token call arguments');
    const argument = compilerOwnDataValue(
      node.arguments,
      0,
      'Public theme token call arguments',
    ) as ts.Expression | undefined;
    if (!prefix || argumentCount !== 1 || !argument) return null;
    const prefixCount = compilerArrayLength(prefix, 'Public theme token call path');
    if (
      compilerOwnDataValue(prefix, prefixCount - 1, 'Public theme token call path') !==
      'customColor'
    ) {
      return null;
    }
    return ts.isStringLiteral(argument)
      ? stylePathAppend(prefix, argument.text, 'Public theme token call path')
      : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const prefix = publicThemeTokenAccessPath(node.expression);
    const argument = node.argumentExpression;
    if (!prefix || !argument) return null;
    if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
      return stylePathAppend(prefix, argument.text, 'Public theme token element path');
    }
  }
  return null;
}

function publicThemeTokenValue(segments: readonly string[]): unknown {
  if (compilerOwnDataValue(segments, 0, 'Public theme token segments') === 'customColor') {
    const name = compilerOwnDataValue(segments, 1, 'Public theme token segments');
    if (typeof name !== 'string' || name === '') return undefined;
    const rest = styleArrayTail(
      styleArrayTail(segments, 'Public theme token segments'),
      'Public theme token segments',
    );
    return valueAtPath(publicThemeTokens.customColor(name), rest);
  }

  return valueAtPath(publicThemeTokens, segments);
}

function propertyAccessPath(node: ts.Expression): string[] | null {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const prefix = propertyAccessPath(node.expression);
    return prefix ? stylePathAppend(prefix, node.name.text, 'Style property access path') : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const prefix = propertyAccessPath(node.expression);
    const argument = node.argumentExpression;
    if (!prefix || !argument) return null;
    if (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument)) {
      return stylePathAppend(prefix, argument.text, 'Style element access path');
    }
  }
  return null;
}

function valueAtPath(value: unknown, segments: readonly string[]): unknown {
  let current = value;
  const segmentCount = compilerArrayLength(segments, 'Style value path');
  for (let index = 0; index < segmentCount; index += 1) {
    const segment = compilerOwnDataValue(segments, index, 'Style value path');
    if (typeof segment !== 'string') return undefined;
    if (current === null || (typeof current !== 'object' && typeof current !== 'function')) {
      return undefined;
    }
    current = compilerOwnDataValue(current, segment, 'Style static value');
  }
  return current;
}

function primitiveValue(node: ts.Expression): string | number | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return compilerNumberValue(node.text);
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) {
    const value = compilerNumberValue(node.operand.text);
    if (node.operator === ts.SyntaxKind.MinusToken) return -value;
    if (node.operator === ts.SyntaxKind.PlusToken) return value;
  }
  return undefined;
}

function styleArrayTail(values: readonly string[], label: string): string[] {
  const tail: string[] = [];
  const count = compilerArrayLength(values, label);
  for (let index = 1; index < count; index += 1) {
    const value = compilerOwnDataValue(values, index, label);
    if (typeof value !== 'string') throw new TypeError(`${label}[${index}] must be a string.`);
    compilerArrayAppend(tail, value, `${label} tail`);
  }
  return tail;
}

function stylePathAppend(values: readonly string[], value: string, label: string): string[] {
  const result: string[] = [];
  appendStyleValues(result, values, label);
  compilerArrayAppend(result, value, label);
  return result;
}
