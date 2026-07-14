import {
  knownQueryNames,
  queryNameFromPath,
  queryPathUsesKnownQuery,
} from '../analyze/query-shapes.js';
import {
  reactiveExpressionForJsxExpression,
  reactivePropertyAccessesForJsxExpression,
} from '../analyze/reactive-aliases.js';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { diagnosticFor } from '../diagnostics.js';
import type { CompilerDiagnostic } from '../diagnostics.js';
import {
  outputContextForAttribute,
  trustedHtmlBrandLocalNames,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import {
  createJsxIrTree,
  generatedJsxIrAttribute,
  jsxIrAttributeValue,
  jsxIrReplacements,
  markJsxIrChanged,
  removeJsxIrAttribute,
  setJsxIrAttribute,
  type JsxIrAttribute,
  type JsxIrAttributeValue,
  type JsxIrChild,
  type JsxIrElement,
  type JsxIrExpression,
} from '../jsx-ir.js';
import type {
  ComponentModuleModel,
  JsxAttributeModel,
  JsxElementModel,
  JsxExpressionModel,
  ObjectLiteralEntry,
  SourceSpan,
} from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { runtimeOutputHelpers, stylePropertyExpression } from '../security/output-context.js';
import {
  bindPropStampAttributeName,
  escapeAttribute,
  isPropertyAuthoritativeAttribute,
  outputWriteFact,
  sanitizeIdentifier,
  type SourceReplacement,
} from '../shared.js';
import type { CompileComponentOptions, StateDeriveFact, ViewTransitionStamp } from '../types.js';
import { executableJavaScriptExpression } from '../javascript-expression.js';
import {
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerJsonStringify,
  compilerMapGet,
  compilerMapSet,
  compilerNumberIsFinite,
  compilerNumberValue,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerRegExpExec,
  compilerRegExpReplace,
  compilerRegExpTest,
  compilerSetAdd,
  compilerSetForEach,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringEndsWith,
  compilerStringIncludes,
  compilerStringIndexOf,
  compilerStringLocaleCompare,
  compilerStringSlice,
  compilerStringSplit,
  compilerStringStartsWith,
  compilerStringToLowerCase,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';

const RUNTIME_GENERATED_IMPORT = '@kovojs/browser/generated';
import {
  platformAttributeList,
  platformElementSubstitution,
  type PlatformSubstitution,
} from './platform.js';
import {
  primitiveReactiveAttrs,
  type PrimitiveReactiveAttr,
  type PrimitiveReactiveAttrEntry,
} from '../generated/primitive-reactive-attrs.js';
import {
  isKovoUiModuleSpecifier,
  primitiveReactiveComponents,
} from './primitive-reactive-registry.js';
import { lowerHrefAttributes, lowerNavigationLinks } from './navigation-lowering.js';
import { lowerPrimitiveComposition } from './primitive-composition.js';
import { lowerPrimitiveSpreads } from './primitive-spreads.js';

export type StructuralJsxLoweringOptions = Pick<
  CompileComponentOptions,
  'fileName' | 'queryShapeFacts' | 'queryShapes' | 'registryFacts' | 'source'
> & {
  skipInlineAttributeDeriveSpans?: readonly SourceSpan[];
};

interface InlineAttributeDerive {
  attribute: JsxAttributeModel;
  element: JsxIrElement;
  baseName: string;
  expression: string;
  inputs?: readonly string[];
  params?: readonly string[];
  query: string;
  source: 'query' | 'state';
  targetAttr: string;
}

interface InlineStateTextDerive {
  baseName: string;
  expression: string;
  expressionNode: JsxIrExpression;
  sourcePaths: readonly string[];
  sourceSpan: SourceSpan;
  wrapper?: JsxIrElement;
}

interface InlineQueryTextDerive {
  baseName: string;
  expression: string;
  expressionNode: JsxIrExpression;
  inputs: readonly string[];
  params: readonly string[];
  query: string;
  wrapper?: JsxIrElement;
}

interface MixedTextExpressionChild {
  containingElement: JsxElementModel;
  expression: JsxIrExpression;
}

export interface StructuralJsxLowering {
  diagnostics: readonly CompilerDiagnostic[];
  outputContexts: readonly GeneratedOutputWriteFact[];
  platformSubstitutions: readonly PlatformSubstitution[];
  replacements: readonly SourceReplacement[];
  stateDerives: readonly StateDeriveFact[];
  viewTransitionStamps: readonly ViewTransitionStamp[];
}

export const structuralJsxPhaseOrder = [
  'primitive-spreads',
  'dynamic-spread-control-boundary',
  'primitive-composition',
  'link-navigation',
  'platform-behaviors',
  'href-attributes',
  'view-transition-name',
  'inline-attribute-derives',
  'primitive-reactive-attributes',
  'inline-text-bindings',
  'static-text-escaping',
  'helper-import-insertion',
] as const;

export function lowerStructuralJsx(
  model: ComponentModuleModel,
  componentName: string,
  options: StructuralJsxLoweringOptions,
): StructuralJsxLowering {
  const tree = createJsxIrTree(model, options);
  const diagnostics: CompilerDiagnostic[] = [];
  const outputContexts: GeneratedOutputWriteFact[] = [];
  const platformSubstitutions: PlatformSubstitution[] = [];
  const viewTransitionStamps: ViewTransitionStamp[] = [];
  const deriveExports: string[] = [];
  const stateDerives: StateDeriveFact[] = [];
  const nameCounts = compilerCreateMap<string, number>();
  const knownQueries = knownQueryNames(model, options);
  const boundElementStarts = compilerCreateSet<number>();
  let needsStylePropertyHelper = false;

  lowerPrimitiveSpreads(tree.elements);
  const needsSafeJsxSpreadHelper = lowerDynamicJsxSpreads(tree.elements);
  appendCompilerFacts(
    diagnostics,
    lowerPrimitiveComposition(tree.elements, options),
    'Primitive composition diagnostics',
  );
  lowerNavigationLinks(tree.elements, options);
  lowerPlatformBehaviors(model, tree.elements, options, platformSubstitutions, diagnostics);
  lowerHrefAttributes(model, tree.elements, options);
  needsStylePropertyHelper = lowerViewTransitionNames(
    tree.elements,
    componentName,
    knownQueries,
    options,
    viewTransitionStamps,
    deriveExports,
    stateDerives,
    outputContexts,
    nameCounts,
  );
  needsStylePropertyHelper =
    lowerInlineAttributeDerivesInIr(
      tree.elements,
      componentName,
      knownQueries,
      options,
      deriveExports,
      stateDerives,
      outputContexts,
      nameCounts,
    ) || needsStylePropertyHelper;
  needsStylePropertyHelper =
    lowerPrimitiveReactiveAttributes(
      model,
      tree.elements,
      componentName,
      knownQueries,
      options,
      deriveExports,
      stateDerives,
      outputContexts,
      nameCounts,
    ) || needsStylePropertyHelper;
  const inlineTextEscapeApplied = lowerInlineTextBindings(
    tree.elements,
    model,
    componentName,
    knownQueries,
    options,
    deriveExports,
    stateDerives,
    outputContexts,
    nameCounts,
    boundElementStarts,
  );
  const staticTextEscapeApplied = escapeStaticTextInterpolations(
    tree.elements,
    boundElementStarts,
    model,
    outputContexts,
  );
  const escapeApplied = inlineTextEscapeApplied || staticTextEscapeApplied;

  const compilerEscapeImports: string[] = [];
  if (escapeApplied && !hasCompilerEscapeImport(model, 'escapeText')) {
    appendCompilerFact(compilerEscapeImports, 'escapeText', 'Compiler escape imports');
  }
  if (needsSafeJsxSpreadHelper && !hasCompilerEscapeImport(model, 'kovoSafeJsxSpread')) {
    appendCompilerFact(compilerEscapeImports, 'kovoSafeJsxSpread', 'Compiler escape imports');
  }
  const compilerEscapeImportLength = compilerArrayLength(
    compilerEscapeImports,
    'Compiler escape imports',
  );
  const escapeImport =
    compilerEscapeImportLength > 0
      ? `import { ${compilerArrayJoin(compilerEscapeImports, ', ')} } from '@kovojs/server/internal/escape';\n`
      : '';
  /*
   * The helper import is compiler-owned ABI. App-authored imports from this internal subpath are
   * rejected by the authoring-surface gate; the lowered artifact is reparsed after insertion.
   */
  const runtimeImports: string[] = [];
  const hasDeriveImport = compilerArrayLength(deriveExports, 'Structural derive exports') > 0;
  const stylePropertyImport = needsStylePropertyHelper
    ? runtimeOutputHelpers.styleProperty
    : undefined;
  if (
    hasDeriveImport &&
    stylePropertyImport !== undefined &&
    compilerStringLocaleCompare('derive', stylePropertyImport) > 0
  ) {
    appendCompilerFact(runtimeImports, stylePropertyImport, 'Structural runtime imports');
    appendCompilerFact(runtimeImports, 'derive', 'Structural runtime imports');
  } else {
    if (hasDeriveImport) {
      appendCompilerFact(runtimeImports, 'derive', 'Structural runtime imports');
    }
    if (stylePropertyImport !== undefined) {
      appendCompilerFact(runtimeImports, stylePropertyImport, 'Structural runtime imports');
    }
  }
  const runtimeImportLength = compilerArrayLength(runtimeImports, 'Structural runtime imports');
  const derivePrefix =
    runtimeImportLength > 0
      ? `import { ${compilerArrayJoin(runtimeImports, ', ')} } from '${RUNTIME_GENERATED_IMPORT}';\n\n${compilerArrayJoin(deriveExports, '\n')}\n\n`
      : '';
  const prefix = `${escapeImport}${derivePrefix}`;
  const replacements = compilerSnapshotDenseArray(
    jsxIrReplacements(tree),
    'Structural JSX replacements',
  );
  if (prefix.length > 0) {
    const start = derivePrefixInsertionOffset(options.source);
    appendCompilerFact(
      replacements,
      { end: start, replacement: prefix, start },
      'Structural JSX replacements',
    );
  }

  return {
    diagnostics,
    outputContexts,
    platformSubstitutions,
    replacements,
    stateDerives,
    viewTransitionStamps,
  };
}

function hasCompilerEscapeImport(model: ComponentModuleModel, importedName: string): boolean {
  const importLength = compilerArrayLength(model.namedImports, 'Compiler named imports');
  for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
    const entry = compilerOwnDataValue(
      model.namedImports,
      importIndex,
      'Compiler named imports',
    ) as ComponentModuleModel['namedImports'][number];
    if (
      entry.importedName === importedName &&
      entry.moduleSpecifier === '@kovojs/server/internal/escape'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * SPEC §4.7/§4.8, §5.2 rule 10, §6.6: caller-owned spread records may carry ordinary
 * HTML/ARIA/data attributes, but may not mint Kovo's executable/control metadata. Static object
 * spreads have already been expanded into typed IR by `lowerPrimitiveSpreads`, so only unresolved
 * dynamic spreads on intrinsic elements cross the runtime reconstruction helper. Component props
 * remain untouched, and the framework-owned `mutationFormAttributes()` carrier is a compiler-known
 * declaration rather than a caller-owned record.
 */
function lowerDynamicJsxSpreads(elements: readonly JsxIrElement[]): boolean {
  let changed = false;
  const elementLength = compilerArrayLength(elements, 'Dynamic spread JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Dynamic spread JSX elements',
    ) as JsxIrElement;
    if (isComponentTag(element.tag)) continue;
    const attributeLength = compilerArrayLength(element.attributes, 'Dynamic spread attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Dynamic spread attributes',
      ) as JsxIrAttribute;
      const source = attribute.source;
      // `lowerPrimitiveSpreads()` has already removed every fully modelled static spread. Any
      // spread that remains here is unresolved or only partially modelled and must cross the
      // runtime control-name boundary. Do not use the presence of a partial `objectEntries` bag as
      // provenance: that was the M3 residual for `{ ...callerAttrs, noop() {} }`.
      if (!source || 'name' in source) continue;
      if (
        source.expressionCallImportedName === 'mutationFormAttributes' &&
        source.expressionCallModuleSpecifier === '@kovojs/server'
      ) {
        continue;
      }

      attribute.name = `...kovoSafeJsxSpread(${source.expression})`;
      attribute.value = {
        kind: 'expression',
        source: `...kovoSafeJsxSpread(${source.expression})`,
      };
      attribute.ownership = 'generated';
      attribute.provenance = {
        ...(attribute.anchor ? { anchor: attribute.anchor } : {}),
        description: 'caller-owned JSX spread reconstructed without Kovo control attributes',
        ownership: 'generated',
        writer: 'dynamic JSX spread control boundary',
      };
      markJsxIrChanged(element);
      changed = true;
    }
  }
  return changed;
}

function lowerPlatformBehaviors(
  model: ComponentModuleModel,
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
  substitutions: PlatformSubstitution[],
  diagnostics: CompilerDiagnostic[],
): void {
  const elementLength = compilerArrayLength(elements, 'Platform behavior JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Platform behavior JSX elements',
    ) as JsxIrElement;
    const match = platformElementSubstitution(model, element.element);
    if (!match) continue;

    removeJsxIrAttribute(element, match.attribute.name);
    const attributes = platformJsxIrAttributes(match.substitution, options);
    const attributeLength = compilerArrayLength(attributes, 'Platform generated attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        attributes,
        attributeIndex,
        'Platform generated attributes',
      ) as JsxIrAttribute;
      const existing = attributeByName(element, attribute.name);
      if (
        existing?.ownership === 'author' &&
        jsxIrAttributeValue(existing) !== jsxIrAttributeValue(attribute)
      ) {
        appendCompilerFact(
          diagnostics,
          structuralWriterConflictDiagnostic(
            options,
            existing,
            attribute.name,
            'author JSX',
            attribute.provenance.writer,
          ),
          'Platform behavior diagnostics',
        );
      }
      appendCompilerFact(element.attributes, attribute, 'Platform element attributes');
      markJsxIrChanged(element);
    }
    appendCompilerFact(substitutions, match.substitution, 'Platform substitutions');
  }
}

function platformJsxIrAttributes(
  substitution: PlatformSubstitution,
  options: StructuralJsxLoweringOptions,
): JsxIrAttribute[] {
  const platformAttributes = platformAttributeList(substitution);
  const attributes: JsxIrAttribute[] = [];
  const length = compilerArrayLength(platformAttributes, 'Platform attribute facts');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      platformAttributes,
      index,
      'Platform attribute facts',
    ) as { name: string; value: string };
    appendCompilerFact(
      attributes,
      generatedJsxIrAttribute(
        attribute.name,
        { kind: 'string', value: attribute.value },
        'platform behavior lowering',
        options,
      ),
      'Platform generated attributes',
    );
  }
  return attributes;
}

function lowerViewTransitionNames(
  elements: readonly JsxIrElement[],
  componentName: string,
  knownQueries: ReadonlySet<string>,
  options: StructuralJsxLoweringOptions,
  stamps: ViewTransitionStamp[],
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): boolean {
  let needsStylePropertyHelper = false;
  const elementLength = compilerArrayLength(elements, 'View-transition JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'View-transition JSX elements',
    ) as JsxIrElement;
    const attribute = attributeByName(element, 'viewTransitionName');
    if (!attribute?.source || !('name' in attribute.source)) continue;
    if (attribute.source.value !== undefined) {
      appendCompilerFact(stamps, { name: attribute.source.value }, 'View-transition stamps');
      mergeStyle(
        element,
        `view-transition-name: ${attribute.source.value}`,
        'viewTransitionName lowering',
        options,
      );
      removeJsxIrAttribute(element, 'viewTransitionName');
      continue;
    }

    const derive = inlineViewTransitionNameDerive(
      attribute.source,
      element,
      componentName,
      knownQueries,
    );
    if (!derive) continue;
    lowerAttributeDerive(derive, options, deriveExports, stateDerives, outputContexts, nameCounts);
    needsStylePropertyHelper = true;
  }
  return needsStylePropertyHelper;
}

function lowerInlineAttributeDerivesInIr(
  elements: readonly JsxIrElement[],
  componentName: string,
  knownQueries: ReadonlySet<string>,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): boolean {
  let needsStylePropertyHelper = false;
  const elementLength = compilerArrayLength(elements, 'Inline derive JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Inline derive JSX elements',
    ) as JsxIrElement;
    if (
      hasAuthoredAttribute(element, 'data-derive') ||
      hasAuthoredAttribute(element, 'data-derive-attr')
    ) {
      continue;
    }
    const derives: InlineAttributeDerive[] = [];
    let queryDeriveCount = 0;
    const attributeLength = compilerArrayLength(element.attributes, 'Inline derive attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Inline derive attributes',
      ) as JsxIrAttribute;
      if (!attribute.source || !('name' in attribute.source)) continue;
      if (attribute.source.name === 'viewTransitionName') continue;
      if (inlineAttributeDeriveSkippedBySpan(attribute.source, options)) continue;
      const derive = inlineAttributeDerive(attribute.source, element, componentName, knownQueries);
      if (derive === null) continue;
      appendCompilerFact(derives, derive, 'Inline attribute derives');
      if (derive.source === 'query') queryDeriveCount += 1;
    }
    const forceQueryBindings = queryDeriveCount > 1;
    const deriveLength = compilerArrayLength(derives, 'Inline attribute derives');
    for (let deriveIndex = 0; deriveIndex < deriveLength; deriveIndex += 1) {
      const derive = compilerOwnDataValue(
        derives,
        deriveIndex,
        'Inline attribute derives',
      ) as InlineAttributeDerive;
      if (derive.attribute.name === 'style') needsStylePropertyHelper = true;
      lowerAttributeDerive(
        derive,
        options,
        deriveExports,
        stateDerives,
        outputContexts,
        nameCounts,
        forceQueryBindings,
      );
    }
  }
  return needsStylePropertyHelper;
}

function lowerAttributeDerive(
  candidate: InlineAttributeDerive,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
  forceQueryBinding = false,
): void {
  const expression = executableJavaScriptExpression(
    candidate.source === 'state'
      ? deriveExpression(candidate.attribute, candidate.expression)
      : compilerStringTrim(candidate.expression),
  );
  const deriveInputs = candidate.inputs ?? [candidate.query];
  const deriveParams = candidate.params ?? [deriveParam(candidate)];

  const { stampName } = emitDerive({
    baseName: candidate.baseName,
    nameCounts,
    stampPrefix: candidate.query,
    deriveExports,
    inputs: compilerJsonSource(deriveInputs, 'Inline attribute derive inputs'),
    params: compilerArrayJoin(deriveParams, ', '),
    expression,
    stateDerive:
      candidate.source === 'state'
        ? (exportName) => ({
            attr: candidate.attribute.name,
            expression,
            exportName,
            input: 'state',
            name: exportName,
            outputContext: outputWriteFact({
              context: outputContextForAttribute(candidate.targetAttr),
              expression,
              sink: candidate.targetAttr,
              source: 'client-state',
              writer: 'inline state attribute derive',
            }),
            param: 'state',
            placeholder: `${candidate.query}.${exportName}`,
          })
        : undefined,
    stateDerives,
    outputContext: outputWriteFact({
      context: outputContextForAttribute(candidate.targetAttr),
      expression,
      sink: candidate.targetAttr,
      source: candidate.source === 'state' ? 'client-state' : 'client-query',
      writer:
        candidate.source === 'state'
          ? 'inline state attribute derive'
          : 'inline query attribute derive',
    }),
    outputContexts,
  });

  // SPEC.md §4.8 data-bind-prop: for property-authoritative attributes, also emit
  // the live-property stamp wherever a data-bind:<attr> sibling is produced (state
  // bindings and query binding stamps), so the loader keeps the dirty property
  // (e.g. .checked/.value/.scrollTop after interaction) in sync. The two stamps
  // share the same derive reference.
  const emitBindProp = (writer: string): void => {
    if (!isPropertyAuthoritativeAttribute(candidate.targetAttr)) return;
    setJsxIrAttribute(
      candidate.element,
      generatedJsxIrAttribute(
        bindPropStampAttributeName(candidate.targetAttr),
        { kind: 'string', value: stampName },
        writer,
        options,
      ),
    );
  };

  removeJsxIrAttribute(candidate.element, candidate.attribute.name);
  if (candidate.source === 'state') {
    if (candidate.targetAttr === candidate.attribute.name) {
      setJsxIrAttribute(candidate.element, sourceAttributeToIr(candidate.attribute, options));
    }
    setJsxIrAttribute(
      candidate.element,
      generatedJsxIrAttribute(
        stateBindingAttributeName(candidate.targetAttr),
        { kind: 'string', value: stampName },
        'inline state attribute derive',
        options,
      ),
    );
    emitBindProp('inline state live-property derive');
    return;
  }

  // SPEC.md §4.8: one data-derive slot cannot represent multiple derived
  // attributes. Also use the binding-stamp (not data-derive) form for
  // property-authoritative attrs so the companion data-bind-prop:<prop> has a
  // data-bind:<attr> sibling the loader resolves from.
  if (
    forceQueryBinding ||
    hasAttribute(candidate.element, 'data-derive') ||
    isPropertyAuthoritativeAttribute(candidate.targetAttr)
  ) {
    setJsxIrAttribute(
      candidate.element,
      generatedJsxIrAttribute(
        stateBindingAttributeName(candidate.targetAttr),
        { kind: 'string', value: stampName },
        'inline query attribute derive',
        options,
      ),
    );
    emitBindProp('inline query live-property derive');
    return;
  }

  insertJsxIrAttributeAtSource(
    candidate.element,
    candidate.attribute.start,
    generatedJsxIrAttribute(
      'data-derive',
      { kind: 'string', value: stampName },
      'inline query attribute derive',
      options,
    ),
  );
  insertJsxIrAttributeAtSource(
    candidate.element,
    candidate.attribute.start + 0.1,
    generatedJsxIrAttribute(
      'data-derive-attr',
      { kind: 'string', value: candidate.targetAttr },
      'inline query attribute derive',
      options,
    ),
  );
}

/**
 * SPEC.md §4.6 (KV232): @kovojs/ui primitives own their reactive state attributes
 * (aria-checked / aria-pressed / aria-expanded / data-state / hidden / checked).
 * When an author forwards a reactive control prop to a @kovojs/ui
 * component (e.g. `<Switch checked={state.checked}>`), the component derives all
 * those attributes internally, but a static SSR render freezes them on the
 * client. This pass emits a `data-bind:<attr>` + `derive(...)` for each
 * primitive-owned reactive attribute so the runtime keeps them in sync; the
 * component's `passThroughProps` forwards the `data-bind:*` attribute to the
 * underlying element (same vector the existing `data-bind:checked` uses).
 *
 * Runs AFTER {@link lowerInlineAttributeDerivesInIr} so the author's literal
 * control-prop derive (e.g. `data-bind:checked`) is already emitted, and BEFORE
 * the text-binding pass. Idempotent: never re-binds an attribute that already
 * has a `data-bind:<attr>`, and never re-derives an author-written attribute
 * (avoids the KV233 double-bind).
 */
function lowerPrimitiveReactiveAttributes(
  model: ComponentModuleModel,
  elements: readonly JsxIrElement[],
  componentName: string,
  knownQueries: ReadonlySet<string>,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): boolean {
  let needsStylePropertyHelper = false;
  const elementLength = compilerArrayLength(elements, 'Primitive reactive JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Primitive reactive JSX elements',
    ) as JsxIrElement;
    const entry = primitiveReactiveComponentForTag(model, element.tag);
    if (!entry) continue;
    const manifest = compilerOwnDataValue(
      primitiveReactiveAttrs,
      entry.primitiveKey,
      'Primitive reactive manifest',
    ) as PrimitiveReactiveAttrEntry | undefined;
    if (!manifest) continue;

    // Read the control prop from the original parsed element (typed facts), not
    // the mutated IR: the inline-attribute-derive pass may have already rewritten
    // the authored attribute and dropped its source model (SPEC.md §5.2 / hard
    // rule 9 keeps state-path detection on typed parser facts).
    const control = findSourceAttribute(
      element.element.attributes,
      entry.controlProp,
      'Primitive reactive control attributes',
    );
    // SPEC.md §4.6: accept both state-rooted and single-query-rooted control props
    // so query-driven primitives (e.g. <Switch checked={account.optIn}>) emit
    // reactive aria-* / data-state derives that stay in sync with the query.
    const controlPath = reactiveControlPath(control, knownQueries);
    if (controlPath === null) continue;
    if (manifest.controlField !== entry.controlProp) continue;

    if (manifest.controlKind === 'progress-ratio' || manifest.controlKind === 'meter-range') {
      needsStylePropertyHelper =
        lowerPrimitiveNumericReactiveAttributes(
          element,
          componentName,
          manifest,
          controlPath,
          options,
          deriveExports,
          stateDerives,
          outputContexts,
          nameCounts,
        ) || needsStylePropertyHelper;
      continue;
    }

    const condition = primitiveReactiveCondition(element, manifest, controlPath.path);
    if (condition === null) continue;

    const attrNames = compilerObjectKeys(manifest.attrs);
    const attrNameLength = compilerArrayLength(attrNames, 'Primitive reactive attribute names');
    for (let attrIndex = 0; attrIndex < attrNameLength; attrIndex += 1) {
      const attrName = compilerOwnDataValue(
        attrNames,
        attrIndex,
        'Primitive reactive attribute names',
      ) as string;
      const attr = compilerOwnDataValue(
        manifest.attrs,
        attrName,
        'Primitive reactive attributes',
      ) as PrimitiveReactiveAttr;
      // Idempotency: skip attributes already bound (by this pass on a previous
      // lowering, or by the inline-attribute-derive pass for the control prop
      // itself, e.g. `data-bind:checked`). SPEC.md §4.6 makes primitive-owned
      // state aria-* primitive-wins and live even when an author wrote a static
      // attribute, so those attrs still receive a data-bind stamp.
      if (hasAttribute(element, stateBindingAttributeName(attrName))) continue;
      if (hasAuthoredAttribute(element, attrName) && !isPrimitiveStateAriaAttribute(attrName)) {
        continue;
      }

      lowerPrimitiveReactiveAttribute(
        element,
        componentName,
        attrName,
        attr,
        condition,
        controlPath.root,
        options,
        deriveExports,
        stateDerives,
        outputContexts,
        nameCounts,
      );
    }

    // SPEC.md §4.8 data-bind-prop: `.indeterminate` is property-only (no HTML
    // attribute), so the manifest carries no `indeterminate` entry. For a
    // tri-state checkbox primitive, emit a property-only `data-bind-prop:
    // indeterminate` stamp so the dirty `.indeterminate` property tracks the
    // "indeterminate" control state after interaction (retires the
    // applyCheckboxIndeterminate shim need on re-render).
    if (
      condition.kind === 'tri-state' &&
      condition.statePath !== undefined &&
      !hasAttribute(element, bindPropStampAttributeName('indeterminate'))
    ) {
      lowerPrimitiveIndeterminateProp(
        element,
        componentName,
        condition.statePath,
        controlPath.root,
        options,
        deriveExports,
        stateDerives,
        outputContexts,
        nameCounts,
      );
    }
  }
  return needsStylePropertyHelper;
}

function lowerPrimitiveNumericReactiveAttributes(
  element: JsxIrElement,
  componentName: string,
  manifest: PrimitiveReactiveAttrEntry,
  controlPath: { path: string; root: string },
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): boolean {
  const expressions =
    manifest.controlKind === 'progress-ratio'
      ? progressReactiveExpressions(element, controlPath)
      : meterReactiveExpressions(element, controlPath);
  if (expressions === null) return false;

  let emittedStyle = false;
  const attrNames = compilerObjectKeys(expressions);
  const attrNameLength = compilerArrayLength(attrNames, 'Numeric reactive attribute names');
  for (let attrIndex = 0; attrIndex < attrNameLength; attrIndex += 1) {
    const attrName = compilerOwnDataValue(
      attrNames,
      attrIndex,
      'Numeric reactive attribute names',
    ) as string;
    const expression = compilerOwnDataValue(
      expressions,
      attrName,
      'Numeric reactive expressions',
    ) as string;
    if (hasAttribute(element, stateBindingAttributeName(attrName))) continue;
    if (hasAuthoredAttribute(element, attrName)) continue;

    lowerPrimitiveComputedAttribute(
      element,
      componentName,
      attrName,
      expression,
      controlPath.root,
      options,
      deriveExports,
      stateDerives,
      outputContexts,
      nameCounts,
    );
    emittedStyle = emittedStyle || attrName === 'style';
  }
  return emittedStyle;
}

function lowerPrimitiveComputedAttribute(
  element: JsxIrElement,
  componentName: string,
  attrName: string,
  rawExpression: string,
  root: string,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): void {
  const baseName = `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attrName)}_derive`;
  const expression = executableJavaScriptExpression(rawExpression);
  const isState = root === 'state';
  const source = isState ? 'client-state' : 'client-query';
  const outputContext = outputWriteFact({
    context: outputContextForAttribute(attrName),
    expression,
    sink: attrName,
    source,
    writer: 'primitive reactive computed attribute derive',
  });

  const { stampName } = emitDerive({
    baseName,
    nameCounts,
    stampPrefix: root,
    deriveExports,
    inputs: compilerJsonSource([root], 'Primitive reactive derive inputs'),
    params: root,
    expression,
    stateDerive: isState
      ? (exportName) => ({
          attr: attrName,
          expression,
          exportName,
          input: 'state',
          name: exportName,
          outputContext,
          param: 'state',
          placeholder: `${root}.${exportName}`,
        })
      : undefined,
    stateDerives,
    outputContext,
    outputContexts,
  });

  setJsxIrAttribute(
    element,
    generatedJsxIrAttribute(
      stateBindingAttributeName(attrName),
      { kind: 'string', value: stampName },
      'primitive reactive computed attribute derive',
      options,
    ),
  );
}

function progressReactiveExpressions(
  element: JsxIrElement,
  controlPath: { path: string; root: string },
): Record<string, string> | null {
  const max = numericAttributeExpression(element, 'max', controlPath.root, '1');
  if (max === null) return null;
  const value = controlPath.path;

  return {
    'data-max': progressExpression(value, max, 'max-string'),
    'data-state': progressExpression(value, max, 'state'),
    'data-value': progressExpression(value, max, 'value-string'),
    style: stylePropertyExpression('width', progressExpression(value, max, 'width')),
  };
}

function meterReactiveExpressions(
  element: JsxIrElement,
  controlPath: { path: string; root: string },
): Record<string, string> | null {
  const min = numericAttributeExpression(element, 'min', controlPath.root, '0');
  const max = numericAttributeExpression(element, 'max', controlPath.root, '1');
  const low = numericAttributeExpression(element, 'low', controlPath.root, 'undefined');
  const high = numericAttributeExpression(element, 'high', controlPath.root, 'undefined');
  const optimum = numericAttributeExpression(element, 'optimum', controlPath.root, 'undefined');
  if (min === null || max === null || low === null || high === null || optimum === null)
    return null;
  const value = controlPath.path;

  return {
    'data-high': meterExpression({ high, low, max, min, optimum, value }, 'high-string'),
    'data-low': meterExpression({ high, low, max, min, optimum, value }, 'low-string'),
    'data-max': meterExpression({ high, low, max, min, optimum, value }, 'max-string'),
    'data-min': meterExpression({ high, low, max, min, optimum, value }, 'min-string'),
    'data-optimum': meterExpression({ high, low, max, min, optimum, value }, 'optimum-string'),
    'data-state': meterExpression({ high, low, max, min, optimum, value }, 'state'),
    'data-value': meterExpression({ high, low, max, min, optimum, value }, 'value-string'),
    style: stylePropertyExpression(
      'width',
      meterExpression({ high, low, max, min, optimum, value }, 'width'),
    ),
  };
}

function numericAttributeExpression(
  element: JsxIrElement,
  name: string,
  root: string,
  fallback: string,
): string | null {
  const attribute = findSourceAttribute(
    element.element.attributes,
    name,
    'Numeric reactive source attributes',
  );
  if (!attribute) return fallback;
  const staticValue = numericStaticExpression(attribute);
  if (staticValue !== null) return staticValue;
  if (attribute.expression === undefined) return null;

  const roots = rootsForPropertyAccesses(attribute.expressionPropertyAccesses ?? []);
  if (
    compilerArrayLength(
      compilerSetValues(roots, 'Numeric reactive roots'),
      'Numeric reactive roots',
    ) === 1 &&
    compilerSetHas(roots, root)
  ) {
    return compilerStringTrim(attribute.expression);
  }
  return null;
}

function numericStaticExpression(attribute: JsxAttributeModel): string | null {
  if (attribute.value !== undefined) return numericLiteralExpression(attribute.value);
  const value = attribute.expressionStaticValue;
  if (typeof value === 'number') return compilerJsonSource(value, 'Numeric static value');
  if (typeof value === 'string') return numericLiteralExpression(value);
  return null;
}

function numericLiteralExpression(value: string): string | null {
  const number = compilerNumberValue(value);
  return compilerNumberIsFinite(number)
    ? compilerJsonSource(number, 'Numeric literal value')
    : null;
}

function rootsForPropertyAccesses(paths: readonly { path: string }[]): ReadonlySet<string> {
  const roots = compilerCreateSet<string>();
  const length = compilerArrayLength(paths, 'Reactive property accesses');
  for (let index = 0; index < length; index += 1) {
    const access = compilerOwnDataValue(paths, index, 'Reactive property accesses') as {
      path: string;
    };
    const root = queryNameFromPath(access.path);
    if (root !== null) compilerSetAdd(roots, root);
  }
  return roots;
}

type ProgressExpressionTarget = 'max-string' | 'state' | 'value-string' | 'width';

function progressExpression(
  valueExpression: string,
  maxExpression: string,
  target: ProgressExpressionTarget,
): string {
  const result =
    target === 'max-string'
      ? 'return String(max);'
      : target === 'state'
        ? 'return value === null ? "indeterminate" : value >= max ? "complete" : "loading";'
        : target === 'value-string'
          ? 'return value === null ? null : String(value);'
          : 'return value === null ? null : `${((value / max) * 100).toFixed(4).replace(/\\.?0+$/, "")}%`;';

  return `(() => { const maxNumber = Number(${maxExpression}); const max = Number.isFinite(maxNumber) && maxNumber > 0 ? maxNumber : 1; const rawValue = (${valueExpression}); const valueNumber = Number(rawValue); const value = rawValue === null || rawValue === undefined || !Number.isFinite(valueNumber) ? null : Math.min(Math.max(valueNumber, 0), max); ${result} })()`;
}

interface MeterExpressionParts {
  readonly high: string;
  readonly low: string;
  readonly max: string;
  readonly min: string;
  readonly optimum: string;
  readonly value: string;
}

type MeterExpressionTarget =
  | 'high-string'
  | 'low-string'
  | 'max-string'
  | 'min-string'
  | 'optimum-string'
  | 'state'
  | 'value-string'
  | 'width';

function meterExpression(parts: MeterExpressionParts, target: MeterExpressionTarget): string {
  const result =
    target === 'high-string'
      ? 'return String(high);'
      : target === 'low-string'
        ? 'return String(low);'
        : target === 'max-string'
          ? 'return String(max);'
          : target === 'min-string'
            ? 'return String(min);'
            : target === 'optimum-string'
              ? 'return String(optimum);'
              : target === 'state'
                ? 'const valueRegion = value < low ? "low" : value > high ? "high" : "middle"; const optimumRegion = optimum < low ? "low" : optimum > high ? "high" : "middle"; return valueRegion === optimumRegion ? "optimum" : valueRegion === "middle" || optimumRegion === "middle" ? "suboptimum" : "even-less-good";'
                : target === 'value-string'
                  ? 'return String(value);'
                  : 'return `${(((value - min) / (max - min)) * 100).toFixed(4).replace(/\\.?0+$/, "")}%`;';

  return `(() => { const minNumber = Number(${parts.min}); const min = Number.isFinite(minNumber) ? minNumber : 0; const maxNumber = Number(${parts.max}); const normalizedMax = Number.isFinite(maxNumber) ? maxNumber : 1; const max = normalizedMax > min ? normalizedMax : min + 1; const normalize = (input: unknown, fallback: number) => { const number = Number(input); return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback; }; const low = normalize(${parts.low}, min); const high = Math.max(normalize(${parts.high}, max), low); const optimum = normalize(${parts.optimum}, (min + max) / 2); const value = normalize(${parts.value}, min); ${result} })()`;
}

// SPEC.md §4.8 data-bind-prop: emit a property-only `data-bind-prop:indeterminate`
// derive for a tri-state checkbox. There is no companion SSR attribute (the DOM
// has no `indeterminate` content attribute), so this is the one prop stamp with
// no `data-bind:<attr>` sibling — the loader applies it directly to the live
// `.indeterminate` property.
function lowerPrimitiveIndeterminateProp(
  element: JsxIrElement,
  componentName: string,
  statePath: string,
  root: string,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): void {
  const baseName = `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_indeterminate_derive`;
  // Boolean-presence form ("" present / null absent) matching the other primitive
  // derives; the loader coerces it to the boolean `.indeterminate` property.
  const expression = `((${statePath}) === "indeterminate" ? "" : null)`;
  const executableExpression = executableJavaScriptExpression(expression);
  const isState = root === 'state';
  const outputContext = outputWriteFact({
    context: outputContextForAttribute('indeterminate'),
    expression: executableExpression,
    sink: 'indeterminate',
    source: isState ? 'client-state' : 'client-query',
    writer: 'primitive reactive live-property derive',
  });

  const { stampName } = emitDerive({
    baseName,
    nameCounts,
    stampPrefix: root,
    deriveExports,
    inputs: compilerJsonSource([root], 'Live-property derive inputs'),
    params: root,
    expression: executableExpression,
    stateDerive: isState
      ? (exportName) => ({
          attr: 'indeterminate',
          expression: executableExpression,
          exportName,
          input: 'state',
          name: exportName,
          outputContext,
          param: 'state',
          placeholder: `${root}.${exportName}`,
        })
      : undefined,
    stateDerives,
    outputContext,
    outputContexts,
  });

  setJsxIrAttribute(
    element,
    generatedJsxIrAttribute(
      bindPropStampAttributeName('indeterminate'),
      { kind: 'string', value: stampName },
      'primitive reactive live-property derive',
      options,
    ),
  );
}

function lowerPrimitiveReactiveAttribute(
  element: JsxIrElement,
  componentName: string,
  attrName: string,
  attr: PrimitiveReactiveAttr,
  condition: PrimitiveReactiveCondition,
  root: string,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): void {
  const baseName = `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attrName)}_derive`;
  const expression = executableJavaScriptExpression(primitiveReactiveExpression(condition, attr));
  const isState = root === 'state';
  const source = isState ? 'client-state' : 'client-query';
  const outputContext = outputWriteFact({
    context: outputContextForAttribute(attrName),
    expression,
    sink: attrName,
    source,
    writer: 'primitive reactive attribute derive',
  });

  // SPEC.md §4.6: emit derive(["state"], ...) for state-rooted control props or
  // derive(["<query>"], ...) for single-query-rooted props (A11Y-PRIMITIVES-2).
  // The parameter name mirrors the root so the expression resolves correctly.
  const { stampName } = emitDerive({
    baseName,
    nameCounts,
    stampPrefix: root,
    deriveExports,
    inputs: compilerJsonSource([root], 'Reactive attribute derive inputs'),
    params: root,
    expression,
    stateDerive: isState
      ? (exportName) => ({
          attr: attrName,
          expression,
          exportName,
          input: 'state',
          name: exportName,
          outputContext,
          param: 'state',
          placeholder: `${root}.${exportName}`,
        })
      : undefined,
    stateDerives,
    outputContext,
    outputContexts,
  });

  setJsxIrAttribute(
    element,
    generatedJsxIrAttribute(
      stateBindingAttributeName(attrName),
      { kind: 'string', value: stampName },
      'primitive reactive attribute derive',
      options,
    ),
  );

  // SPEC.md §4.8 data-bind-prop: forward the live-property stamp for
  // property-authoritative attributes (checked/selected/open) the primitive owns,
  // so the dirty .checked/.selected/.open property tracks state after interaction.
  if (isPropertyAuthoritativeAttribute(attrName)) {
    setJsxIrAttribute(
      element,
      generatedJsxIrAttribute(
        bindPropStampAttributeName(attrName),
        { kind: 'string', value: stampName },
        'primitive reactive live-property derive',
        options,
      ),
    );
  }
}

function primitiveReactiveExpression(
  condition: PrimitiveReactiveCondition,
  attr: PrimitiveReactiveAttr,
): string {
  if (condition.kind === 'tri-state' && attr.whenIndeterminate !== undefined) {
    return `((${condition.statePath}) === "indeterminate" ? ${primitiveReactiveValueExpression(attr, attr.whenIndeterminate)} : (${condition.truthy} ? ${primitiveReactiveValueExpression(attr, attr.whenTrue)} : ${primitiveReactiveValueExpression(attr, attr.whenFalse)}))`;
  }

  return `(${condition.truthy} ? ${primitiveReactiveValueExpression(attr, attr.whenTrue)} : ${primitiveReactiveValueExpression(attr, attr.whenFalse)})`;
}

function primitiveReactiveValueExpression(
  attr: PrimitiveReactiveAttr,
  value: boolean | string,
): string {
  if (attr.booleanPresence) {
    // Boolean-presence attributes (checked/hidden/open ...) signal via presence:
    // emit `""` when the attribute should be present, `null` when it should be
    // absent. Matches how the inline-attribute-derive pass emits `checked`.
    return value === true ? '""' : 'null';
  }

  return compilerJsonSource(`${value}`, 'Primitive reactive value');
}

interface PrimitiveReactiveCondition {
  readonly kind: 'boolean' | 'tri-state';
  readonly statePath?: string;
  readonly truthy: string;
}

function primitiveReactiveCondition(
  element: JsxIrElement,
  manifest: PrimitiveReactiveAttrEntry,
  statePath: string,
): PrimitiveReactiveCondition | null {
  if (manifest.controlKind === 'boolean') {
    return { kind: 'boolean', truthy: `(${statePath})` };
  }

  if (manifest.controlKind === 'tri-state') {
    return { kind: 'tri-state', statePath, truthy: `((${statePath}) === true)` };
  }

  const discriminatorField = manifest.discriminatorField;
  if (discriminatorField === undefined) return null;
  const discriminator = staticAttributeString(element, discriminatorField);
  if (discriminator === null) return null;
  const discriminatorLiteral = compilerJsonSource(discriminator, 'Primitive discriminator');

  if (manifest.controlKind === 'equality') {
    return { kind: 'boolean', truthy: `((${statePath}) === ${discriminatorLiteral})` };
  }

  const multiple = accordionMultipleExpression(element, manifest.modeField);
  if (multiple === null) return null;
  const value = `(${statePath})`;
  if (multiple === 'true') {
    return {
      kind: 'boolean',
      truthy: `(Array.isArray(${value}) && ${value}.includes(${discriminatorLiteral}))`,
    };
  }
  if (multiple === 'false') {
    return { kind: 'boolean', truthy: `(${value} === ${discriminatorLiteral})` };
  }
  return {
    kind: 'boolean',
    truthy: `((${multiple}) ? (Array.isArray(${value}) && ${value}.includes(${discriminatorLiteral})) : ${value} === ${discriminatorLiteral})`,
  };
}

/**
 * Resolve the @kovojs/ui reactive primitive entry for an element tag, requiring
 * the tag to be imported from the public @kovojs/ui surface. Uses typed import
 * facts (SPEC.md §5.2 / compiler hard rule 9): the tag's local name resolves to
 * a named import whose module specifier is `@kovojs/ui` or `@kovojs/ui/<entry>`,
 * and whose imported (export) name is in the registry.
 */
function primitiveReactiveComponentForTag(
  model: ComponentModuleModel,
  tag: string,
): { controlProp: string; primitiveKey: string } | null {
  if (!isComponentTag(tag)) return null;
  const dotIndex = compilerStringIndexOf(tag, '.');
  const localName = dotIndex >= 0 ? compilerStringSlice(tag, 0, dotIndex) : tag;
  let namedImport: ComponentModuleModel['namedImports'][number] | undefined;
  const importLength = compilerArrayLength(model.namedImports, 'Primitive reactive imports');
  for (let importIndex = 0; importIndex < importLength; importIndex += 1) {
    const entry = compilerOwnDataValue(
      model.namedImports,
      importIndex,
      'Primitive reactive imports',
    ) as ComponentModuleModel['namedImports'][number];
    if (entry.localName === localName && isKovoUiModuleSpecifier(entry.moduleSpecifier)) {
      namedImport = entry;
      break;
    }
  }
  if (!namedImport) return null;
  return (
    (compilerOwnDataValue(
      primitiveReactiveComponents,
      namedImport.importedName,
      'Primitive reactive component registry',
    ) as { controlProp: string; primitiveKey: string } | undefined) ?? null
  );
}

function staticAttributeString(element: JsxIrElement, name: string): string | null {
  const attribute = findSourceAttribute(
    element.element.attributes,
    name,
    'Static source attributes',
  );
  if (!attribute) return null;
  if (attribute.value !== undefined) return attribute.value;
  return staticStringValue(attribute.expressionStaticValue);
}

function accordionMultipleExpression(
  element: JsxIrElement,
  modeField: string | undefined,
): string | null {
  if (modeField === undefined) return 'false';
  const mode = findSourceAttribute(
    element.element.attributes,
    modeField,
    'Accordion mode attributes',
  );
  if (!mode) return 'false';

  const staticMode = mode.value ?? staticStringValue(mode.expressionStaticValue);
  if (staticMode !== null) return staticMode === 'multiple' ? 'true' : 'false';

  const modeStatePath = reactiveStatePath(mode);
  if (modeStatePath !== null) return `(${modeStatePath} === "multiple")`;

  return null;
}

/**
 * The state path an author forwarded as a reactive control prop, or null
 * when the prop is absent, not an expression, or references anything other than
 * `state`. Mirrors the state-only detection used by inline attribute derives.
 */
function reactiveStatePath(control: JsxAttributeModel | undefined): string | null {
  const path = reactiveControlPath(control, compilerCreateSet());
  return path?.root === 'state' ? path.path : null;
}

/**
 * The reactive path and its single root for an author control prop, or null
 * when the prop is absent, not an expression, or references multiple roots
 * or a root that is neither `state` nor a known query. SPEC.md §4.6.
 */
function reactiveControlPath(
  control: JsxAttributeModel | undefined,
  knownQueries: ReadonlySet<string>,
): { path: string; root: string } | null {
  if (!control || control.expression === undefined) return null;
  const roots = rootsForPropertyAccesses(control.expressionPropertyAccesses ?? []);
  const rootValues = compilerSetValues(roots, 'Reactive control roots');
  const rootLength = compilerArrayLength(rootValues, 'Reactive control roots');
  if (rootLength === 0) return null;
  // State-only: every root is "state"
  let stateOnly = true;
  for (let rootIndex = 0; rootIndex < rootLength; rootIndex += 1) {
    if (compilerOwnDataValue(rootValues, rootIndex, 'Reactive control roots') !== 'state') {
      stateOnly = false;
      break;
    }
  }
  if (stateOnly) {
    return { path: compilerStringTrim(control.expression), root: 'state' };
  }
  // Single-query: exactly one root and it is a known query, no mixed roots
  if (rootLength === 1 && !compilerSetHas(roots, 'state')) {
    const root = compilerOwnDataValue(rootValues, 0, 'Reactive control roots') as
      | string
      | undefined;
    if (root !== undefined && compilerSetHas(knownQueries, root)) {
      return { path: compilerStringTrim(control.expression), root };
    }
  }
  return null;
}

function lowerInlineTextBindings(
  elements: readonly JsxIrElement[],
  model: ComponentModuleModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
  options: StructuralJsxLoweringOptions,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
  boundElementStarts: Set<number>,
): boolean {
  let escapeApplied = false;
  const elementLength = compilerArrayLength(elements, 'Inline text JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Inline text JSX elements',
    ) as JsxIrElement;
    const expression = soleExpressionChild(element);
    const binding = inlineTextBinding(element, expression, knownQueries);
    if (binding && expression) {
      compilerSetAdd(boundElementStarts, element.element.start);
      expression.replacement = `{escapeText(${binding})}`;
      escapeApplied = true;
      setJsxIrAttribute(
        element,
        generatedJsxIrAttribute(
          'data-bind',
          { kind: 'string', value: binding },
          'inline text binding',
          options,
        ),
      );
      appendCompilerFact(
        outputContexts,
        outputWriteFact({
          context: 'text',
          expression: binding,
          sink: 'textContent',
          source: compilerStringStartsWith(binding, 'state.') ? 'client-state' : 'client-query',
          writer: 'inline text binding',
        }),
        'Inline text output contexts',
      );
      continue;
    }
    const derive = inlineTextDerive(element, expression, model, componentName);
    if (derive) {
      compilerSetAdd(boundElementStarts, element.element.start);
      derive.expressionNode.replacement = `{escapeText(${derive.expression})}`;
      escapeApplied = true;
      const { stampName } = recordStateDerive(
        derive,
        deriveExports,
        stateDerives,
        outputContexts,
        nameCounts,
      );
      setJsxIrAttribute(
        element,
        generatedJsxIrAttribute(
          'data-bind',
          { kind: 'string', value: stampName },
          'inline state text derive',
          options,
        ),
      );
      continue;
    }
    const queryDerive = inlineQueryTextDerive(element, expression, componentName, knownQueries);
    if (!queryDerive) continue;
    compilerSetAdd(boundElementStarts, element.element.start);
    queryDerive.expressionNode.replacement = `{escapeText(${queryDerive.expression})}`;
    escapeApplied = true;
    const { stampName } = recordQueryTextDerive(
      queryDerive,
      deriveExports,
      outputContexts,
      nameCounts,
    );
    setJsxIrAttribute(
      element,
      generatedJsxIrAttribute(
        'data-derive',
        { kind: 'string', value: stampName },
        'inline query text derive',
        options,
      ),
    );
  }

  const expressionChildrenWithOwners = expressionChildren(elements);
  const expressionLength = compilerArrayLength(
    expressionChildrenWithOwners,
    'Inline mixed text expressions',
  );
  for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
    const { containingElement, expression } = compilerOwnDataValue(
      expressionChildrenWithOwners,
      expressionIndex,
      'Inline mixed text expressions',
    ) as MixedTextExpressionChild;
    const binding = inlineMixedTextBinding(expression, containingElement, knownQueries);
    if (binding) {
      expression.replacement = `<span data-bind="${escapeAttribute(binding)}">{escapeText(${binding})}</span>`;
      escapeApplied = true;
      appendCompilerFact(
        outputContexts,
        outputWriteFact({
          context: 'text',
          expression: binding,
          sink: 'textContent',
          source: compilerStringStartsWith(binding, 'state.') ? 'client-state' : 'client-query',
          writer: 'inline mixed text binding',
        }),
        'Inline mixed text output contexts',
      );
      continue;
    }
    const derive = inlineMixedTextDerive(expression, containingElement, model, componentName);
    if (derive) {
      const { stampName } = recordStateDerive(
        derive,
        deriveExports,
        stateDerives,
        outputContexts,
        nameCounts,
      );
      expression.replacement = `<span data-bind="${escapeAttribute(stampName)}">{escapeText(${derive.expression})}</span>`;
      escapeApplied = true;
      continue;
    }
    const queryDerive = inlineMixedQueryTextDerive(
      expression,
      containingElement,
      componentName,
      knownQueries,
    );
    if (!queryDerive) continue;
    const { stampName } = recordQueryTextDerive(
      queryDerive,
      deriveExports,
      outputContexts,
      nameCounts,
    );
    expression.replacement = `<span data-derive="${escapeAttribute(stampName)}">{escapeText(${queryDerive.expression})}</span>`;
    escapeApplied = true;
  }
  return escapeApplied;
}

function escapeStaticTextInterpolations(
  elements: readonly JsxIrElement[],
  boundElementStarts: ReadonlySet<number>,
  model: ComponentModuleModel,
  outputContexts: GeneratedOutputWriteFact[],
): boolean {
  let applied = false;
  const elementLength = compilerArrayLength(elements, 'Static text JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Static text JSX elements',
    ) as JsxIrElement;
    if (compilerSetHas(boundElementStarts, element.element.start)) continue;

    let generatedBinding = false;
    const attributeLength = compilerArrayLength(element.attributes, 'Static text JSX attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Static text JSX attributes',
      ) as JsxIrAttribute;
      if (
        attribute.name === 'data-bind' ||
        compilerStringStartsWith(attribute.name, 'data-bind:') ||
        attribute.name === 'data-derive' ||
        attribute.name === 'data-derive-attr'
      ) {
        generatedBinding = true;
        break;
      }
    }
    if (generatedBinding) continue;

    const childLength = compilerArrayLength(element.children, 'Static text JSX children');
    for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
      const child = compilerOwnDataValue(
        element.children,
        childIndex,
        'Static text JSX children',
      ) as JsxIrChild;
      if (child.kind !== 'expression') continue;
      if (child.replacement) continue;
      if (!shouldEscapeStaticTextExpression(child.expression, model)) continue;
      child.replacement = `{escapeText(${child.expression.expression})}`;
      appendCompilerFact(
        outputContexts,
        outputWriteFact({
          context: 'text',
          expression: child.expression.expression,
          sink: 'text child',
          source: 'server-render',
          writer: 'static text interpolation escape',
        }),
        'Static text output contexts',
      );
      applied = true;
    }
  }
  return applied;
}

function shouldEscapeStaticTextExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): boolean {
  if (expression.solePropertyAccessPath !== undefined) return true;
  if (isExplicitHtmlCompositionExpression(expression, model)) return false;
  if (compilerArrayLength(expression.propertyAccesses, 'Static text property accesses') > 0) {
    return true;
  }

  const referenceLength = compilerArrayLength(expression.references, 'Static text references');
  const componentLength = compilerArrayLength(model.components, 'Static text components');
  for (let referenceIndex = 0; referenceIndex < referenceLength; referenceIndex += 1) {
    const reference = compilerOwnDataValue(
      expression.references,
      referenceIndex,
      'Static text references',
    ) as string;
    for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
      const component = compilerOwnDataValue(
        model.components,
        componentIndex,
        'Static text components',
      ) as ComponentModuleModel['components'][number];
      const inputLength = compilerArrayLength(component.renderInputs, 'Static text render inputs');
      for (let inputIndex = 0; inputIndex < inputLength; inputIndex += 1) {
        const input = compilerOwnDataValue(
          component.renderInputs,
          inputIndex,
          'Static text render inputs',
        ) as { name: string };
        if (input.name === reference) return true;
      }
    }
  }
  return false;
}

function isExplicitHtmlCompositionExpression(
  expression: JsxExpressionModel,
  model: ComponentModuleModel,
): boolean {
  const accessLength = compilerArrayLength(
    expression.propertyAccesses,
    'HTML composition property accesses',
  );
  for (let accessIndex = 0; accessIndex < accessLength; accessIndex += 1) {
    const access = compilerOwnDataValue(
      expression.propertyAccesses,
      accessIndex,
      'HTML composition property accesses',
    ) as { path: string };
    const parts = compilerStringSplit(access.path, '.');
    const partLength = compilerArrayLength(parts, 'HTML composition access parts');
    if (
      partLength >= 2 &&
      compilerOwnDataValue(parts, partLength - 2, 'HTML composition access parts') ===
        'definition' &&
      compilerOwnDataValue(parts, partLength - 1, 'HTML composition access parts') === 'render'
    ) {
      return true;
    }
  }
  let call: ComponentModuleModel['calls'][number] | undefined;
  const callLength = compilerArrayLength(model.calls, 'HTML composition calls');
  for (let callIndex = 0; callIndex < callLength; callIndex += 1) {
    const candidate = compilerOwnDataValue(
      model.calls,
      callIndex,
      'HTML composition calls',
    ) as ComponentModuleModel['calls'][number];
    if (candidate.start >= expression.start && candidate.end <= expression.end) {
      call = candidate;
      break;
    }
  }
  if (!call) return false;
  // SPEC §6.6(1) / §5.2 rule 9: recognize the `trustedHtml`/`safeRichHtml` brand by AST
  // symbol-identity (the local name bound to the real `@kovojs/browser` export), never by the raw
  // call name — so a shadowing local or a same-named foreign import is not treated as trusted
  // HTML composition.
  if (compilerSetHas(trustedHtmlBrandLocalNames(model), call.name)) return true;
  const parts = compilerStringSplit(call.name, '.');
  const partLength = compilerArrayLength(parts, 'HTML composition call parts');
  return (
    partLength >= 2 &&
    compilerOwnDataValue(parts, partLength - 2, 'HTML composition call parts') === 'definition' &&
    compilerOwnDataValue(parts, partLength - 1, 'HTML composition call parts') === 'render'
  );
}

function appendCompilerFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}

function appendCompilerFacts<Value>(
  target: Value[],
  values: readonly Value[],
  label: string,
): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    appendCompilerFact(target, compilerOwnDataValue(values, index, label) as Value, label);
  }
}

function compilerSetValues<Value>(set: ReadonlySet<Value>, label: string): Value[] {
  const values: Value[] = [];
  compilerSetForEach(set, (value) => appendCompilerFact(values, value, label));
  return values;
}

function compilerSetEvery<Value>(
  set: ReadonlySet<Value>,
  label: string,
  predicate: (value: Value) => boolean,
): boolean {
  const values = compilerSetValues(set, label);
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    if (!predicate(compilerOwnDataValue(values, index, label) as Value)) return false;
  }
  return true;
}

function compilerSortedStrings(values: readonly string[], label: string): string[] {
  const length = compilerArrayLength(values, label);
  const selected = compilerCreateSet<number>();
  const result: string[] = [];
  for (let outputIndex = 0; outputIndex < length; outputIndex += 1) {
    let bestIndex = -1;
    let best = '';
    for (let inputIndex = 0; inputIndex < length; inputIndex += 1) {
      if (compilerSetHas(selected, inputIndex)) continue;
      const candidate = compilerOwnDataValue(values, inputIndex, label) as string;
      if (bestIndex === -1 || compilerStringLocaleCompare(candidate, best) < 0) {
        bestIndex = inputIndex;
        best = candidate;
      }
    }
    if (bestIndex < 0) compilerFailClosed(`${label} must be dense.`);
    compilerSetAdd(selected, bestIndex);
    appendCompilerFact(result, best, label);
  }
  return result;
}

function compilerJsonSource(value: unknown, label: string): string {
  const source = compilerJsonStringify(value);
  if (source === undefined) compilerFailClosed(`${label} must be JSON-serializable.`);
  return source;
}

function mergeStyle(
  element: JsxIrElement,
  style: string,
  writer: string,
  options: StructuralJsxLoweringOptions,
): void {
  const styleAttribute = attributeByName(element, 'style');
  const current = styleAttribute ? jsxIrAttributeValue(styleAttribute) : undefined;
  const merged =
    current === undefined || current === '' ? style : `${trimTrailingSemicolon(current)}; ${style}`;
  if (styleAttribute) {
    styleAttribute.value = { kind: 'string', value: merged };
    styleAttribute.ownership = 'generated';
    styleAttribute.provenance = {
      description: 'view-transition style merge',
      ownership: 'generated',
      writer,
    };
    markJsxIrChanged(element);
    return;
  }
  insertJsxIrAttributeAtSource(
    element,
    attributeByName(element, 'viewTransitionName')?.source?.start ?? 9_007_199_254_740_991,
    generatedJsxIrAttribute('style', { kind: 'string', value: merged }, writer, options),
  );
}

function inlineAttributeDerive(
  attribute: JsxAttributeModel,
  element: JsxIrElement,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;
  if (shouldSkipInlineAttributeDerive(attribute)) return null;
  const styleObjectExpression =
    attribute.name === 'style' && attribute.expressionObjectEntries
      ? styleObjectDeriveExpression(attribute.expressionObjectEntries)
      : null;
  if (attribute.name === 'style' && attribute.expressionObjectEntries && !styleObjectExpression) {
    return null;
  }

  const roots = rootsForPropertyAccesses(attribute.expressionPropertyAccesses ?? []);
  const rootValues = compilerSetValues(roots, 'Inline attribute roots');
  const rootLength = compilerArrayLength(rootValues, 'Inline attribute roots');
  const queryRoots = compilerCreateSet<string>();
  for (let rootIndex = 0; rootIndex < rootLength; rootIndex += 1) {
    const root = compilerOwnDataValue(rootValues, rootIndex, 'Inline attribute roots') as string;
    if (compilerSetHas(knownQueries, root)) compilerSetAdd(queryRoots, root);
  }
  const queryRootValues = compilerSetValues(queryRoots, 'Inline attribute query roots');
  const queryRootLength = compilerArrayLength(queryRootValues, 'Inline attribute query roots');
  const stateOnly =
    rootLength > 0 && compilerSetEvery(roots, 'Inline attribute roots', (root) => root === 'state');
  const clockInputs = clockQueryInputsFromRoots(roots, knownQueries);
  if (queryRootLength !== 1 && !stateOnly && !clockInputs) return null;
  if (queryRootLength > 0 && compilerSetHas(roots, 'state')) return null;

  const query = stateOnly
    ? 'state'
    : clockInputs
      ? 'now'
      : (compilerOwnDataValue(queryRootValues, 0, 'Inline attribute query roots') as
          | string
          | undefined);
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attribute.name)}_derive`,
    element,
    expression: styleObjectExpression ?? compilerStringTrim(attribute.expression),
    ...(clockInputs ? { inputs: clockInputs, params: clockInputs } : {}),
    query,
    source: stateOnly ? 'state' : 'query',
    targetAttr: attribute.name,
  };
}

function inlineViewTransitionNameDerive(
  attribute: JsxAttributeModel,
  element: JsxIrElement,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineAttributeDerive | null {
  if (attribute.expression === undefined) return null;
  const styleAttribute = attributeByName(element, 'style')?.source;
  const styleSource = styleAttribute && 'name' in styleAttribute ? styleAttribute : undefined;
  const propertyAccesses: { path: string }[] = [];
  appendCompilerFacts(
    propertyAccesses,
    attribute.expressionPropertyAccesses ?? [],
    'View-transition property accesses',
  );
  appendCompilerFacts(
    propertyAccesses,
    styleSource?.expressionPropertyAccesses ?? [],
    'View-transition property accesses',
  );
  const roots = rootsForPropertyAccesses(propertyAccesses);
  const rootValues = compilerSetValues(roots, 'View-transition roots');
  const rootLength = compilerArrayLength(rootValues, 'View-transition roots');
  const queryRoots = compilerCreateSet<string>();
  for (let rootIndex = 0; rootIndex < rootLength; rootIndex += 1) {
    const root = compilerOwnDataValue(rootValues, rootIndex, 'View-transition roots') as string;
    if (compilerSetHas(knownQueries, root)) compilerSetAdd(queryRoots, root);
  }
  const queryRootValues = compilerSetValues(queryRoots, 'View-transition query roots');
  const queryRootLength = compilerArrayLength(queryRootValues, 'View-transition query roots');
  const stateOnly =
    rootLength > 0 && compilerSetEvery(roots, 'View-transition roots', (root) => root === 'state');
  const soleQuery =
    queryRootLength === 1
      ? (compilerOwnDataValue(queryRootValues, 0, 'View-transition query roots') as string)
      : undefined;
  const queryOnly =
    soleQuery !== undefined &&
    compilerSetEvery(roots, 'View-transition roots', (root) => root === soleQuery);
  const query = stateOnly ? 'state' : queryOnly ? soleQuery : null;
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_style_derive`,
    element,
    expression: viewTransitionNameStyleExpression(attribute.expression, styleSource),
    query,
    source: stateOnly ? 'state' : 'query',
    targetAttr: 'style',
  };
}

function inlineTextBinding(
  element: JsxIrElement,
  expression: JsxIrExpression | null,
  knownQueries: ReadonlySet<string>,
): string | null {
  if (element.selfClosing || hasTextBindingAttribute(element) || !expression) return null;
  const path = expression.expression.solePropertyAccessPath ?? null;
  if (!path) return null;
  return queryPathUsesKnownQuery(path, knownQueries) || isStatePath(path) ? path : null;
}

function inlineTextDerive(
  element: JsxIrElement,
  expression: JsxIrExpression | null,
  model: ComponentModuleModel,
  componentName: string,
): InlineStateTextDerive | null {
  if (element.selfClosing || hasTextBindingAttribute(element) || !expression) return null;
  const accesses = reactivePropertyAccessesForJsxExpression(expression.expression, model);
  if (!isStateOnlyExpression(accesses)) {
    return null;
  }
  const deriveExpression = reactiveExpressionForJsxExpression(expression.expression, model);
  if (!deriveExpression) return null;
  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: deriveExpression,
    expressionNode: expression,
    sourcePaths: stateDeriveSourcePaths(accesses),
    sourceSpan: { end: expression.expression.end, start: expression.expression.start },
    wrapper: element,
  };
}

function inlineQueryTextDerive(
  element: JsxIrElement,
  expression: JsxIrExpression | null,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineQueryTextDerive | null {
  if (element.selfClosing || hasTextBindingAttribute(element) || !expression) return null;
  if (expression.expression.solePropertyAccessPath) return null;
  const inputs = clockQueryInputsFromAccesses(expression.expression.propertyAccesses, knownQueries);
  if (!inputs) return null;
  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: expression.expression.expression,
    expressionNode: expression,
    inputs,
    params: inputs,
    query: 'now',
    wrapper: element,
  };
}

function inlineMixedTextBinding(
  expression: JsxIrExpression,
  element: JsxElementModel,
  knownQueries: ReadonlySet<string>,
): string | null {
  const path = soleKnownQueryPath(expression.expression, knownQueries);
  if (!path) return null;
  if (hasAnyBindingAttribute(element.attributes)) return null;
  if (element.childNonWhitespaceCount === 1) return null;
  return path;
}

function inlineMixedTextDerive(
  expression: JsxIrExpression,
  element: JsxElementModel,
  model: ComponentModuleModel,
  componentName: string,
): InlineStateTextDerive | null {
  const accesses = reactivePropertyAccessesForJsxExpression(expression.expression, model);
  if (!isStateOnlyExpression(accesses)) {
    return null;
  }
  if (hasAnyBindingAttribute(element.attributes)) return null;
  if (element.childNonWhitespaceCount === 1) return null;
  const deriveExpression = reactiveExpressionForJsxExpression(expression.expression, model);
  if (!deriveExpression) return null;
  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: deriveExpression,
    expressionNode: expression,
    sourcePaths: stateDeriveSourcePaths(accesses),
    sourceSpan: { end: expression.expression.end, start: expression.expression.start },
  };
}

function inlineMixedQueryTextDerive(
  expression: JsxIrExpression,
  element: JsxElementModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineQueryTextDerive | null {
  const inputs = clockQueryInputsFromAccesses(expression.expression.propertyAccesses, knownQueries);
  if (!inputs) return null;
  if (hasAnyBindingAttribute(element.attributes)) return null;
  if (element.childNonWhitespaceCount === 1) return null;
  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: expression.expression.expression,
    expressionNode: expression,
    inputs,
    params: inputs,
    query: 'now',
  };
}

function clockQueryInputsFromAccesses(
  accesses: readonly { path: string }[],
  knownQueries: ReadonlySet<string>,
): readonly string[] | null {
  const roots = rootsForPropertyAccesses(accesses);
  return clockQueryInputsFromRoots(roots, knownQueries);
}

function clockQueryInputsFromRoots(
  roots: ReadonlySet<string>,
  knownQueries: ReadonlySet<string>,
): readonly string[] | null {
  if (!compilerSetHas(roots, 'now')) return null;
  if (
    !compilerSetEvery(
      roots,
      'Clock query roots',
      (root) => root === 'now' || compilerSetHas(knownQueries, root),
    )
  ) {
    return null;
  }
  const queryRoots: string[] = [];
  const rootValues = compilerSetValues(roots, 'Clock query roots');
  const rootLength = compilerArrayLength(rootValues, 'Clock query roots');
  for (let rootIndex = 0; rootIndex < rootLength; rootIndex += 1) {
    const root = compilerOwnDataValue(rootValues, rootIndex, 'Clock query roots') as string;
    if (root !== 'now') appendCompilerFact(queryRoots, root, 'Clock query inputs');
  }
  const sortedQueries = compilerSortedStrings(queryRoots, 'Clock query inputs');
  const inputs: string[] = [];
  appendCompilerFact(inputs, 'now', 'Clock query inputs');
  appendCompilerFacts(inputs, sortedQueries, 'Clock query inputs');
  return inputs;
}

function recordStateDerive(
  derive: InlineStateTextDerive,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): { exportName: string; stampName: string } {
  const expression = executableJavaScriptExpression(derive.expression);
  return emitDerive({
    baseName: derive.baseName,
    nameCounts,
    stampPrefix: 'state',
    deriveExports,
    inputs: '["state"]',
    params: 'state',
    expression,
    stateDerive: (exportName) => ({
      expression,
      exportName,
      input: 'state',
      name: exportName,
      outputContext: outputWriteFact({
        context: 'text',
        expression,
        sink: 'textContent',
        source: 'client-state',
        writer: 'inline state text derive',
      }),
      param: 'state',
      placeholder: `state.${exportName}`,
      sourcePaths: derive.sourcePaths,
      sourceSpan: derive.sourceSpan,
    }),
    stateDerives,
    outputContext: outputWriteFact({
      context: 'text',
      expression,
      sink: 'textContent',
      source: 'client-state',
      writer: 'inline state text derive',
    }),
    outputContexts,
  });
}

function recordQueryTextDerive(
  derive: InlineQueryTextDerive,
  deriveExports: string[],
  outputContexts: GeneratedOutputWriteFact[],
  nameCounts: Map<string, number>,
): { exportName: string; stampName: string } {
  const expression = executableJavaScriptExpression(derive.expression);
  return emitDerive({
    baseName: derive.baseName,
    nameCounts,
    stampPrefix: derive.query,
    deriveExports,
    inputs: compilerJsonSource(derive.inputs, 'Inline query text derive inputs'),
    params: compilerArrayJoin(derive.params, ', '),
    expression,
    outputContext: outputWriteFact({
      context: 'text',
      expression,
      sink: 'textContent',
      source: 'client-query',
      writer: 'inline query text derive',
    }),
    outputContexts,
  });
}

/**
 * SPEC.md §5.2 derive ABI chokepoint (FN11, plans/compiler-refactoring.md): the single
 * owner of the `export const X = derive(<inputs>, (<params>) => <expression>);` template,
 * the export-name allocation, and the matching `StateDeriveFact` /
 * `GeneratedOutputWriteFact` records. The production derive sites have load-bearing,
 * byte-significant shape differences (`JSON.stringify`'d vs literal `inputs`, `: any` vs
 * un-annotated `params`, per-site fact fields, and whether the state-derive fact shares
 * the same output-context object pushed into `outputContexts`). To stay byte- and
 * identity-neutral, callers pass the already-formatted `inputs`/`params` strings and the
 * fully-built fact objects through unchanged; this helper only centralizes the template,
 * name allocation, and which arrays receive a push.
 */
interface EmitDeriveOptions {
  baseName: string;
  nameCounts: Map<string, number>;
  /** Stamp prefix joined to the allocated export name as `${stampPrefix}.${exportName}`. */
  stampPrefix: string;
  deriveExports: string[];
  /** Already-formatted `inputs` string, e.g. `JSON.stringify([root])` or `["state"]`. */
  inputs: string;
  /** Already-formatted executable JS `params` string, e.g. `state` or `deriveParams.join(', ')`. */
  params: string;
  expression: string;
  /**
   * Builds the per-site `StateDeriveFact` from the allocated name. Returning `undefined`
   * skips the `stateDerives` push (sites that only emit an output-context fact). The
   * caller owns object identity (e.g. sharing the `outputContext` ref with the push below).
   */
  stateDerive?: ((exportName: string) => StateDeriveFact | undefined) | undefined;
  stateDerives?: StateDeriveFact[] | undefined;
  /**
   * Output-context fact to push into `outputContexts`. The caller passes the exact object
   * (shared with the state-derive fact or distinct, per site) so identity is preserved.
   */
  outputContext?: GeneratedOutputWriteFact;
  outputContexts?: GeneratedOutputWriteFact[];
}

function emitDerive(options: EmitDeriveOptions): { exportName: string; stampName: string } {
  const exportName = nextExportName(options.baseName, options.nameCounts);
  const stampName = `${options.stampPrefix}.${exportName}`;
  appendCompilerFact(
    options.deriveExports,
    `export const ${exportName} = derive(${options.inputs}, (${options.params}) => ${options.expression});`,
    'Structural derive exports',
  );
  if (options.stateDerive && options.stateDerives) {
    const fact = options.stateDerive(exportName);
    if (fact) appendCompilerFact(options.stateDerives, fact, 'Structural state derives');
  }
  if (options.outputContext && options.outputContexts) {
    appendCompilerFact(options.outputContexts, options.outputContext, 'Structural output contexts');
  }
  return { exportName, stampName };
}

/**
 * SPEC §5.2 keeps the typed scanner model authoritative: the JSX IR admits expressions here
 * only from an element's `childExpressionContainers`, never from author attribute expressions.
 * Preserve the flat-root recursive traversal, including duplicate nested occurrences and order.
 */
function expressionChildren(elements: readonly JsxIrElement[]): MixedTextExpressionChild[] {
  const result: MixedTextExpressionChild[] = [];
  const visit = (child: JsxIrChild, owner: JsxIrElement): void => {
    if (child.kind === 'expression') {
      appendCompilerFact(
        result,
        { containingElement: owner.element, expression: child },
        'Structural expressions',
      );
    }
    if (child.kind === 'element') {
      const nestedLength = compilerArrayLength(child.children, 'Structural nested children');
      for (let nestedIndex = 0; nestedIndex < nestedLength; nestedIndex += 1) {
        visit(
          compilerOwnDataValue(
            child.children,
            nestedIndex,
            'Structural nested children',
          ) as JsxIrChild,
          child,
        );
      }
    }
  };
  const elementLength = compilerArrayLength(elements, 'Structural expression elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Structural expression elements',
    ) as JsxIrElement;
    const childLength = compilerArrayLength(element.children, 'Structural element children');
    for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
      visit(
        compilerOwnDataValue(
          element.children,
          childIndex,
          'Structural element children',
        ) as JsxIrChild,
        element,
      );
    }
  }
  return result;
}

function soleExpressionChild(element: JsxIrElement): JsxIrExpression | null {
  let sole: JsxIrChild | undefined;
  let count = 0;
  const length = compilerArrayLength(element.children, 'Sole expression children');
  for (let index = 0; index < length; index += 1) {
    const child = compilerOwnDataValue(
      element.children,
      index,
      'Sole expression children',
    ) as JsxIrChild;
    if (child.kind === 'text' && compilerStringTrim(child.source) === '') continue;
    count += 1;
    if (count > 1) return null;
    sole = child;
  }
  return count === 1 && sole?.kind === 'expression' ? sole : null;
}

function sourceAttributeToIr(
  attribute: JsxAttributeModel,
  options: StructuralJsxLoweringOptions,
): JsxIrAttribute {
  const value: JsxIrAttributeValue =
    attribute.value !== undefined
      ? { kind: 'string', value: attribute.value }
      : attribute.expression !== undefined
        ? { kind: 'expression', source: attribute.expression }
        : { kind: 'boolean', value: true };
  return generatedJsxIrAttribute(
    attribute.name,
    value,
    'preserve state attribute expression',
    options,
  );
}

function structuralWriterConflictDiagnostic(
  options: { fileName: string; source: string },
  attribute: JsxIrAttribute,
  detail: string,
  firstWriter: string,
  secondWriter: string,
): CompilerDiagnostic {
  const anchor = attribute.anchor;
  return {
    ...diagnosticFor(
      options.fileName,
      'KV231',
      options.source,
      anchor?.start,
      anchor ? anchor.end - anchor.start : undefined,
    ),
    message: `${diagnosticDefinitions.KV231.message} ${detail} (writers: ${firstWriter}, ${secondWriter})`,
  };
}

function attributeByName(element: JsxIrElement, name: string): JsxIrAttribute | undefined {
  const length = compilerArrayLength(element.attributes, 'Structural JSX attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Structural JSX attributes',
    ) as JsxIrAttribute;
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function findSourceAttribute(
  attributes: readonly JsxAttributeModel[],
  name: string,
  label: string,
): JsxAttributeModel | undefined {
  const length = compilerArrayLength(attributes, label);
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(attributes, index, label) as JsxAttributeModel;
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function hasAttribute(element: JsxIrElement, name: string): boolean {
  return attributeByName(element, name) !== undefined;
}

function hasAuthoredAttribute(element: JsxIrElement, name: string): boolean {
  const length = compilerArrayLength(element.attributes, 'Structural JSX attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Structural JSX attributes',
    ) as JsxIrAttribute;
    if (attribute.name === name && attribute.ownership === 'author') return true;
  }
  return false;
}

function isPrimitiveStateAriaAttribute(name: string): boolean {
  return (
    name === 'aria-expanded' ||
    name === 'aria-selected' ||
    name === 'aria-checked' ||
    name === 'aria-pressed' ||
    name === 'aria-current' ||
    name === 'aria-disabled'
  );
}

function insertJsxIrAttributeAtSource(
  element: JsxIrElement,
  sourceStart: number,
  attribute: JsxIrAttribute,
): void {
  const next: JsxIrAttribute[] = [];
  let inserted = false;
  const length = compilerArrayLength(element.attributes, 'Structural JSX attributes');
  for (let index = 0; index < length; index += 1) {
    const item = compilerOwnDataValue(
      element.attributes,
      index,
      'Structural JSX attributes',
    ) as JsxIrAttribute;
    if (!inserted && item.source !== undefined && item.source.start > sourceStart) {
      appendCompilerFact(next, attribute, 'Structural JSX attributes');
      inserted = true;
    }
    appendCompilerFact(next, item, 'Structural JSX attributes');
  }
  if (!inserted) appendCompilerFact(next, attribute, 'Structural JSX attributes');
  element.attributes = next;
  markJsxIrChanged(element);
}

function hasTextBindingAttribute(element: JsxIrElement): boolean {
  const length = compilerArrayLength(element.attributes, 'Text binding attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'Text binding attributes',
    ) as JsxIrAttribute;
    if (isTextBindingAttributeName(attribute.name)) return true;
  }
  return false;
}

function hasAnyBindingAttribute(attributes: readonly JsxAttributeModel[]): boolean {
  const length = compilerArrayLength(attributes, 'Binding source attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      index,
      'Binding source attributes',
    ) as JsxAttributeModel;
    if (isBindingAttributeName(attribute.name)) return true;
  }
  return false;
}

function isBindingAttributeName(name: string): boolean {
  return (
    name === 'data-bind' ||
    compilerStringStartsWith(name, 'data-bind:') ||
    name === 'data-bind-list'
  );
}

function isTextBindingAttributeName(name: string): boolean {
  return name === 'data-bind' || name === 'data-derive' || name === 'data-bind-list';
}

function shouldSkipInlineAttributeDerive(attribute: JsxAttributeModel): boolean {
  const { name } = attribute;
  return (
    attribute.domEventName !== undefined ||
    attribute.executionTriggerName !== undefined ||
    name === 'className' ||
    name === 'data-derive' ||
    name === 'data-derive-attr' ||
    name === 'data-bind' ||
    compilerStringStartsWith(name, 'data-bind:') ||
    compilerStringStartsWith(name, 'data-bind-prop:') ||
    compilerStringStartsWith(name, 'data-p-') ||
    compilerStringStartsWith(name, 'kovo-')
  );
}

function inlineAttributeDeriveSkippedBySpan(
  attribute: JsxAttributeModel,
  options: StructuralJsxLoweringOptions,
): boolean {
  if (attribute.expressionStart === undefined || attribute.expressionEnd === undefined) {
    return false;
  }

  const spans = options.skipInlineAttributeDeriveSpans ?? [];
  const length = compilerArrayLength(spans, 'Skipped inline derive spans');
  for (let index = 0; index < length; index += 1) {
    const span = compilerOwnDataValue(spans, index, 'Skipped inline derive spans') as SourceSpan;
    if (attribute.expressionStart >= span.start && attribute.expressionEnd <= span.end) {
      return true;
    }
  }
  return false;
}

function soleKnownQueryPath(
  expression: JsxExpressionModel,
  knownQueries: ReadonlySet<string>,
): string | null {
  const path = expression.solePropertyAccessPath ?? null;
  if (!path) return null;
  return queryPathUsesKnownQuery(path, knownQueries) || isStatePath(path) ? path : null;
}

function isStateOnlyExpression(paths: readonly { path: string }[]): boolean {
  const roots = rootsForPropertyAccesses(paths);
  const values = compilerSetValues(roots, 'State expression roots');
  return (
    compilerArrayLength(values, 'State expression roots') > 0 &&
    compilerSetEvery(roots, 'State expression roots', (root) => root === 'state')
  );
}

function stateDeriveSourcePaths(paths: readonly { path: string }[]): readonly string[] {
  const unique = compilerCreateSet<string>();
  const length = compilerArrayLength(paths, 'State derive source paths');
  for (let index = 0; index < length; index += 1) {
    const path = compilerOwnDataValue(paths, index, 'State derive source paths') as {
      path: string;
    };
    compilerSetAdd(unique, path.path);
  }
  return compilerSortedStrings(
    compilerSetValues(unique, 'State derive source paths'),
    'State derive source paths',
  );
}

function viewTransitionNameStyleExpression(
  transitionExpression: string,
  styleAttribute: JsxAttributeModel | undefined,
): string {
  const transition = stylePropertyExpression('view-transition-name', transitionExpression);
  if (styleAttribute?.expression !== undefined) {
    return `[${styleAttribute.expression}, ${transition}].filter(Boolean).join('; ')`;
  }
  const existing = compilerStringTrim(styleAttribute?.value ?? '');
  const separator = existing === '' || compilerStringEndsWith(existing, ';') ? '' : ';';
  const prefix = existing === '' ? '' : `${existing}${separator} `;
  return prefix === ''
    ? transition
    : `[${compilerJsonSource(prefix, 'View-transition style prefix')}, ${transition}].join('')`;
}

function styleObjectDeriveExpression(entries: readonly ObjectLiteralEntry[]): string | null {
  const parts: string[] = [];
  const length = compilerArrayLength(entries, 'Style object entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      entries,
      index,
      'Style object entries',
    ) as ObjectLiteralEntry;
    if (entry.value === undefined) continue;
    appendCompilerFact(
      parts,
      stylePropertyExpression(cssPropertyName(entry.key), entry.value),
      'Style object derive parts',
    );
  }
  if (compilerArrayLength(parts, 'Style object derive parts') === 0) return null;

  return `[${compilerArrayJoin(parts, ', ')}].filter(Boolean).join('; ')`;
}

function cssPropertyName(name: string): string {
  if (compilerStringStartsWith(name, '--')) return name;
  return compilerStringToLowerCase(
    compilerRegExpReplace(/[A-Z]/g, name, (match) => `-${compilerStringToLowerCase(match)}`),
  );
}

function deriveParam(candidate: InlineAttributeDerive): string {
  return candidate.source === 'state' ? 'state' : candidate.query;
}

function deriveExpression(attribute: JsxAttributeModel, expression: string): string {
  const trimmed = compilerStringTrim(expression);
  return compilerSetHas(booleanPresenceAttributes, attribute.name)
    ? `((${trimmed}) ? "" : null)`
    : trimmed;
}

function nextExportName(baseName: string, nameCounts: Map<string, number>): string {
  const count = compilerMapGet(nameCounts, baseName) ?? 0;
  compilerMapSet(nameCounts, baseName, count + 1);
  return count === 0 ? baseName : `${baseName}_${count + 1}`;
}

function stateBindingAttributeName(name: string): string {
  return `data-bind:${name}`;
}

function derivePrefixInsertionOffset(source: string): number {
  const leadingWhitespace = compilerRegExpExec(/^\s*/, source)?.[0].length ?? 0;
  let offset = leadingWhitespace;
  let matchedJsxPragma = false;

  while (offset < source.length) {
    const comment = compilerRegExpExec(
      /^\/\*\*?[\s\S]*?\*\/[ \t]*(?:\r?\n)?/,
      compilerStringSlice(source, offset),
    );
    if (!comment || !compilerRegExpTest(/@jsx(?:ImportSource|Runtime|Frag)?(?:\s|$)/, comment[0])) {
      break;
    }

    offset += comment[0].length;
    matchedJsxPragma = true;
  }

  return matchedJsxPragma ? offset : 0;
}

function trimTrailingSemicolon(value: string): string {
  return compilerStringTrim(compilerRegExpReplace(/;$/, compilerStringTrim(value), ''));
}

function isStatePath(path: string): boolean {
  return compilerStringStartsWith(path, 'state.');
}

function isComponentTag(tag: string): boolean {
  return compilerStringIncludes(tag, '.') || compilerRegExpTest(/^[A-Z]/, tag);
}

function staticStringValue(value: StaticLiteralValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

const booleanPresenceAttributes = compilerCreateSet<string>();
compilerSetAdd(booleanPresenceAttributes, 'checked');
compilerSetAdd(booleanPresenceAttributes, 'disabled');
compilerSetAdd(booleanPresenceAttributes, 'hidden');
compilerSetAdd(booleanPresenceAttributes, 'multiple');
compilerSetAdd(booleanPresenceAttributes, 'open');
compilerSetAdd(booleanPresenceAttributes, 'readonly');
compilerSetAdd(booleanPresenceAttributes, 'required');
compilerSetAdd(booleanPresenceAttributes, 'selected');
