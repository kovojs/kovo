import {
  knownQueryNames,
  queryNameFromPath,
  queryPathUsesKnownQuery,
} from '../analyze/query-shapes.js';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { diagnosticFor } from '../diagnostics.js';
import type { CompilerDiagnostic } from '../diagnostics.js';
import {
  outputContextForAttribute,
  type GeneratedOutputWriteFact,
} from '../output-context-facts.js';
import {
  createJsxIrTree,
  generatedJsxIrAttribute,
  jsxIrAttributeValue,
  jsxIrReplacements,
  markJsxIrChanged,
  primitiveJsxIrAttribute,
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
  JsxExpressionModel,
  ObjectLiteralEntry,
  SourceSpan,
} from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { literalStringValue } from '../scan/object.js';
import { runtimeOutputHelpers, stylePropertyExpression } from '../security/output-context.js';
import {
  bindPropStampAttributeName,
  escapeAttribute,
  isPropertyAuthoritativeAttribute,
  type SourceReplacement,
} from '../shared.js';
import type { CompileComponentOptions, StateDeriveFact, ViewTransitionStamp } from '../types.js';

const RUNTIME_GENERATED_IMPORT = '@kovojs/browser/generated';
import {
  authorJsxAttributes,
  mergePrimitiveAndAuthorAttributes,
  primitiveIdRewrite,
  primitiveObjectEntryAttributes,
  rewritePrimitiveIdrefAttributes,
  type MergeableAttribute,
  type MergeableAttributeValue,
} from './attribute-merge.js';
import {
  platformAttributeList,
  platformElementSubstitution,
  type PlatformSubstitution,
} from './platform.js';
import { staticHrefAttributeValue } from './navigation.js';
import {
  primitiveReactiveAttrs,
  type PrimitiveReactiveAttr,
  type PrimitiveReactiveAttrEntry,
} from '../generated/primitive-reactive-attrs.js';
import {
  isKovoUiModuleSpecifier,
  primitiveReactiveComponents,
} from './primitive-reactive-registry.js';

type StructuralJsxLoweringOptions = Pick<
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
  const nameCounts = new Map<string, number>();
  const knownQueries = knownQueryNames(model, options);
  const boundElementStarts = new Set<number>();
  let needsStylePropertyHelper = false;

  lowerPrimitiveSpreads(tree.elements);
  diagnostics.push(...lowerPrimitiveComposition(tree.elements, options));
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
  );
  lowerInlineTextBindings(
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
  const escapeApplied = escapeStaticTextInterpolations(
    tree.elements,
    boundElementStarts,
    outputContexts,
  );

  const alreadyImportsEscapeText = model.namedImports.some(
    (entry) =>
      entry.importedName === 'escapeText' &&
      entry.moduleSpecifier === '@kovojs/server/internal/html',
  );
  const escapeImport =
    escapeApplied && !alreadyImportsEscapeText
      ? `import { escapeText } from '@kovojs/server/internal/html';\n`
      : '';
  const runtimeImports = [
    ...(deriveExports.length > 0 ? ['derive'] : []),
    ...(needsStylePropertyHelper ? [runtimeOutputHelpers.styleProperty] : []),
  ].sort();
  const derivePrefix =
    runtimeImports.length > 0
      ? `import { ${runtimeImports.join(', ')} } from '${RUNTIME_GENERATED_IMPORT}';\n\n${deriveExports.join('\n')}\n\n`
      : '';
  const prefix = `${escapeImport}${derivePrefix}`;
  const replacements = [...jsxIrReplacements(tree)];
  if (prefix.length > 0) {
    const start = derivePrefixInsertionOffset(options.source);
    replacements.push({ end: start, replacement: prefix, start });
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

function lowerPrimitiveSpreads(elements: readonly JsxIrElement[]): void {
  for (const element of elements) {
    for (const spread of element.attributes) {
      const source = spread.source;
      if (!source || !('objectEntries' in source) || !source.objectEntries) continue;
      const attrs = spreadObjectAttributes(source.objectEntries);
      if (attrs === null) continue;
      element.attributes = element.attributes.filter((attribute) => attribute !== spread);
      element.attributes.push(...attrs.map(({ source: _source, ...attribute }) => attribute));
      markJsxIrChanged(element);
    }
  }
}

function lowerPrimitiveComposition(
  elements: readonly JsxIrElement[],
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const candidates = primitiveCompositionCandidates(elements);
  const rewrites = primitiveIdRewrites(candidates);

  for (const candidate of candidates) {
    const merge = mergePrimitiveAndAuthorAttributes(
      rewritePrimitiveIdrefAttributes(candidate.primitiveAttributes, rewrites),
      candidate.authorAttributes,
      options,
    );
    diagnostics.push(...withMergeWriterNames(merge.diagnostics));
    unwrapPrimitiveWrapper(candidate.wrapper, candidate.child, merge.attributes, options);
  }

  return diagnostics;
}

interface PrimitiveCompositionCandidate {
  authorAttributes: readonly MergeableAttribute[];
  child: JsxIrElement;
  primitiveAttributes: readonly MergeableAttribute[];
  wrapper: JsxIrElement;
}

function primitiveCompositionCandidates(
  elements: readonly JsxIrElement[],
): PrimitiveCompositionCandidate[] {
  const candidates: PrimitiveCompositionCandidate[] = [];

  for (const wrapper of elements) {
    if (!isComponentTag(wrapper.tag)) continue;
    const attrsAttribute = wrapper.element.attributes.find(
      (attribute) => attribute.name === 'attrs',
    );
    const attrs = attrsAttribute?.expressionObjectEntries;
    if (!attrs) continue;

    const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
    if (primitiveAttributes === null) continue;

    const child = wrapper.element.attributes.some((attribute) => attribute.name === 'asChild')
      ? singleImmediateElementChild(wrapper)
      : singleAttrsFunctionElementChild(wrapper);
    if (!child || childHasUnsupportedSpreads(child)) continue;

    candidates.push({
      authorAttributes: authorJsxAttributes(child.element.attributes),
      child,
      primitiveAttributes,
      wrapper,
    });
  }

  return candidates;
}

function primitiveIdRewrites(
  candidates: readonly PrimitiveCompositionCandidate[],
): ReadonlyMap<string, string> {
  return new Map(
    candidates.flatMap((candidate) => {
      const rewrite = primitiveIdRewrite(candidate.primitiveAttributes, candidate.authorAttributes);
      return rewrite ? [rewrite] : [];
    }),
  );
}

function unwrapPrimitiveWrapper(
  wrapper: JsxIrElement,
  child: JsxIrElement,
  attributes: readonly MergeableAttribute[],
  options: { fileName: string; source: string },
): void {
  wrapper.tag = child.tag;
  wrapper.closingName = child.tag;
  wrapper.selfClosing = child.selfClosing;
  wrapper.attributes = attributes.map((attribute) => mergeableToIrAttribute(attribute, options));
  wrapper.children = child.children;
  wrapper.generatedAttributes = [];
  wrapper.ownership = 'generated';
  wrapper.provenance = {
    ...(wrapper.provenance.anchor ? { anchor: wrapper.provenance.anchor } : {}),
    description: 'primitive wrapper lowered to child element',
    ownership: 'generated',
    writer: 'primitive composition',
  };
  markJsxIrChanged(wrapper);
}

function lowerNavigationLinks(
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): void {
  for (const link of elements) {
    if (link.tag !== 'Link') continue;
    const toAttribute = attributeByName(link, 'to');
    if (!toAttribute?.source || !('name' in toAttribute.source)) continue;
    const target =
      jsxIrAttributeValue(toAttribute) ??
      staticStringValue(toAttribute.source.expressionStaticValue);
    if (!target && toAttribute.source.expression === undefined) continue;
    const params = navigationObjectValue(link, 'params') ?? {};
    const search = navigationObjectValue(link, 'search') ?? {};

    link.tag = 'a';
    link.closingName = 'a';
    removeJsxIrAttribute(link, 'params');
    removeJsxIrAttribute(link, 'search');
    replaceJsxIrAttribute(
      link,
      'to',
      generatedJsxIrAttribute(
        'href',
        target
          ? { kind: 'string', value: buildStaticHref(target, params, search) }
          : { kind: 'expression', source: toAttribute.source.expression ?? '' },
        'Link navigation lowering',
        options,
      ),
    );
    sortHrefFirstForStaticLink(link, Boolean(target));
    markJsxIrChanged(link);
  }
}

function lowerPlatformBehaviors(
  model: ComponentModuleModel,
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
  substitutions: PlatformSubstitution[],
  diagnostics: CompilerDiagnostic[],
): void {
  for (const element of elements) {
    const match = platformElementSubstitution(model, element.element);
    if (!match) continue;

    removeJsxIrAttribute(element, match.attribute.name);
    for (const attribute of platformJsxIrAttributes(match.substitution, options)) {
      const existing = attributeByName(element, attribute.name);
      if (
        existing?.ownership === 'author' &&
        jsxIrAttributeValue(existing) !== jsxIrAttributeValue(attribute)
      ) {
        diagnostics.push(
          structuralWriterConflictDiagnostic(
            options,
            existing,
            attribute.name,
            'author JSX',
            attribute.provenance.writer,
          ),
        );
      }
      element.attributes.push(attribute);
      markJsxIrChanged(element);
    }
    substitutions.push(match.substitution);
  }
}

function lowerHrefAttributes(
  model: ComponentModuleModel,
  elements: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): void {
  for (const element of elements) {
    const attribute = attributeByName(element, 'href');
    if (!attribute?.source || !('name' in attribute.source)) continue;
    const target = staticHrefAttributeValue(model, attribute.source);
    if (target === null) continue;

    setJsxIrAttribute(
      element,
      generatedJsxIrAttribute(
        'href',
        { kind: 'string', value: target },
        'href navigation lowering',
        options,
      ),
    );
  }
}

function platformJsxIrAttributes(
  substitution: PlatformSubstitution,
  options: StructuralJsxLoweringOptions,
): JsxIrAttribute[] {
  return platformAttributeList(substitution).map(({ name, value }) =>
    generatedJsxIrAttribute(name, { kind: 'string', value }, 'platform behavior lowering', options),
  );
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
  for (const element of elements) {
    const attribute = attributeByName(element, 'viewTransitionName');
    if (!attribute?.source || !('name' in attribute.source)) continue;
    if (attribute.source.value !== undefined) {
      stamps.push({ name: attribute.source.value });
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
  for (const element of elements) {
    if (
      hasAuthoredAttribute(element, 'data-derive') ||
      hasAuthoredAttribute(element, 'data-derive-attr')
    ) {
      continue;
    }
    const derives = [...element.attributes]
      .map((attribute) => {
        if (!attribute.source || !('name' in attribute.source)) return null;
        if (attribute.source.name === 'viewTransitionName') return null;
        if (inlineAttributeDeriveSkippedBySpan(attribute.source, options)) return null;
        return inlineAttributeDerive(attribute.source, element, componentName, knownQueries);
      })
      .filter((derive): derive is InlineAttributeDerive => derive !== null);
    const forceQueryBindings = derives.filter((derive) => derive.source === 'query').length > 1;
    for (const derive of derives) {
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
  const exportName = nextExportName(candidate.baseName, nameCounts);
  const stampName = `${candidate.query}.${exportName}`;
  const expression =
    candidate.source === 'state'
      ? deriveExpression(candidate.attribute, candidate.expression)
      : candidate.expression.trim();
  const deriveInputs = candidate.inputs ?? [candidate.query];
  const deriveParams = candidate.params ?? [deriveParam(candidate)];

  deriveExports.push(
    `export const ${exportName} = derive(${JSON.stringify(deriveInputs)}, (${deriveParams.join(', ')}) => ${expression});`,
  );
  if (candidate.source === 'state') {
    stateDerives.push({
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
      placeholder: stampName,
    });
  }
  outputContexts.push(
    outputWriteFact({
      context: outputContextForAttribute(candidate.targetAttr),
      expression,
      sink: candidate.targetAttr,
      source: candidate.source === 'state' ? 'client-state' : 'client-query',
      writer:
        candidate.source === 'state'
          ? 'inline state attribute derive'
          : 'inline query attribute derive',
    }),
  );

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
): void {
  for (const element of elements) {
    const entry = primitiveReactiveComponentForTag(model, element.tag);
    if (!entry) continue;
    const manifest = primitiveReactiveAttrs[entry.primitiveKey];
    if (!manifest) continue;

    // Read the control prop from the original parsed element (typed facts), not
    // the mutated IR: the inline-attribute-derive pass may have already rewritten
    // the authored attribute and dropped its source model (SPEC.md §5.2 / hard
    // rule 9 keeps state-path detection on typed parser facts).
    const control = element.element.attributes.find(
      (attribute) => attribute.name === entry.controlProp,
    );
    // SPEC.md §4.6: accept both state-rooted and single-query-rooted control props
    // so query-driven primitives (e.g. <Switch checked={account.optIn}>) emit
    // reactive aria-* / data-state derives that stay in sync with the query.
    const controlPath = reactiveControlPath(control, knownQueries);
    if (controlPath === null) continue;
    if (manifest.controlField !== entry.controlProp) continue;

    const condition = primitiveReactiveCondition(element, manifest, controlPath.path);
    if (condition === null) continue;

    for (const [attrName, attr] of Object.entries(manifest.attrs)) {
      // Idempotency: skip attributes already bound (by this pass on a previous
      // lowering, or by the inline-attribute-derive pass for the control prop
      // itself, e.g. `data-bind:checked`). Skip author-written attributes to
      // avoid the KV233 double-bind.
      if (hasAttribute(element, stateBindingAttributeName(attrName))) continue;
      if (hasAuthoredAttribute(element, attrName)) continue;

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
  const exportName = nextExportName(baseName, nameCounts);
  const stampName = `${root}.${exportName}`;
  // Boolean-presence form ("" present / null absent) matching the other primitive
  // derives; the loader coerces it to the boolean `.indeterminate` property.
  const expression = `((${statePath}) === "indeterminate" ? "" : null)`;
  const isState = root === 'state';

  deriveExports.push(
    `export const ${exportName} = derive(${JSON.stringify([root])}, (${root}: any) => ${expression});`,
  );
  const outputContext = outputWriteFact({
    context: outputContextForAttribute('indeterminate'),
    expression,
    sink: 'indeterminate',
    source: isState ? 'client-state' : 'client-query',
    writer: 'primitive reactive live-property derive',
  });
  if (isState) {
    stateDerives.push({
      attr: 'indeterminate',
      expression,
      exportName,
      input: 'state',
      name: exportName,
      outputContext,
      param: 'state',
      placeholder: stampName,
    });
  }
  outputContexts.push(outputContext);

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
  const exportName = nextExportName(baseName, nameCounts);
  const stampName = `${root}.${exportName}`;
  const expression = primitiveReactiveExpression(condition, attr);
  const isState = root === 'state';

  // SPEC.md §4.6: emit derive(["state"], ...) for state-rooted control props or
  // derive(["<query>"], ...) for single-query-rooted props (A11Y-PRIMITIVES-2).
  // The parameter name mirrors the root so the expression resolves correctly.
  deriveExports.push(
    `export const ${exportName} = derive(${JSON.stringify([root])}, (${root}: any) => ${expression});`,
  );
  const source = isState ? 'client-state' : 'client-query';
  const outputContext = outputWriteFact({
    context: outputContextForAttribute(attrName),
    expression,
    sink: attrName,
    source,
    writer: 'primitive reactive attribute derive',
  });
  if (isState) {
    stateDerives.push({
      attr: attrName,
      expression,
      exportName,
      input: 'state',
      name: exportName,
      outputContext,
      param: 'state',
      placeholder: stampName,
    });
  }
  outputContexts.push(outputContext);

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

  return JSON.stringify(String(value));
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
  const discriminatorLiteral = JSON.stringify(discriminator);

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
  const localName = tag.includes('.') ? tag.slice(0, tag.indexOf('.')) : tag;
  const namedImport = model.namedImports.find(
    (entry) => entry.localName === localName && isKovoUiModuleSpecifier(entry.moduleSpecifier),
  );
  if (!namedImport) return null;
  return primitiveReactiveComponents[namedImport.importedName] ?? null;
}

function staticAttributeString(element: JsxIrElement, name: string): string | null {
  const attribute = element.element.attributes.find((candidate) => candidate.name === name);
  if (!attribute) return null;
  if (attribute.value !== undefined) return attribute.value;
  return staticStringValue(attribute.expressionStaticValue);
}

function accordionMultipleExpression(
  element: JsxIrElement,
  modeField: string | undefined,
): string | null {
  if (modeField === undefined) return 'false';
  const mode = element.element.attributes.find((attribute) => attribute.name === modeField);
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
  const path = reactiveControlPath(control, new Set());
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
  const roots = new Set(
    (control.expressionPropertyAccesses ?? [])
      .map((access) => queryNameFromPath(access.path))
      .filter((root): root is string => root !== null),
  );
  if (roots.size === 0) return null;
  // State-only: every root is "state"
  if ([...roots].every((root) => root === 'state')) {
    return { path: control.expression.trim(), root: 'state' };
  }
  // Single-query: exactly one root and it is a known query, no mixed roots
  if (roots.size === 1 && !roots.has('state')) {
    const [root] = roots;
    if (root !== undefined && knownQueries.has(root)) {
      return { path: control.expression.trim(), root };
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
): void {
  for (const element of elements) {
    const expression = soleExpressionChild(element);
    const binding = inlineTextBinding(element, expression, knownQueries);
    if (binding) {
      boundElementStarts.add(element.element.start);
      setJsxIrAttribute(
        element,
        generatedJsxIrAttribute(
          'data-bind',
          { kind: 'string', value: binding },
          'inline text binding',
          options,
        ),
      );
      outputContexts.push(
        outputWriteFact({
          context: 'text',
          expression: binding,
          sink: 'textContent',
          source: binding.startsWith('state.') ? 'client-state' : 'client-query',
          writer: 'inline text binding',
        }),
      );
      continue;
    }
    const derive = inlineTextDerive(element, expression, componentName);
    if (derive) {
      boundElementStarts.add(element.element.start);
      const exportName = nextExportName(derive.baseName, nameCounts);
      const stampName = `state.${exportName}`;
      recordStateDerive(derive, exportName, stampName, deriveExports, stateDerives, outputContexts);
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
    boundElementStarts.add(element.element.start);
    const exportName = nextExportName(queryDerive.baseName, nameCounts);
    const stampName = `${queryDerive.query}.${exportName}`;
    recordQueryTextDerive(queryDerive, exportName, deriveExports, outputContexts);
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

  for (const expression of expressionChildren(elements)) {
    const binding = inlineMixedTextBinding(expression, model, knownQueries);
    if (binding) {
      expression.replacement = `<span data-bind="${escapeAttribute(binding)}">{${binding}}</span>`;
      outputContexts.push(
        outputWriteFact({
          context: 'text',
          expression: binding,
          sink: 'textContent',
          source: binding.startsWith('state.') ? 'client-state' : 'client-query',
          writer: 'inline mixed text binding',
        }),
      );
      continue;
    }
    const derive = inlineMixedTextDerive(expression, model, componentName);
    if (derive) {
      const exportName = nextExportName(derive.baseName, nameCounts);
      const stampName = `state.${exportName}`;
      recordStateDerive(derive, exportName, stampName, deriveExports, stateDerives, outputContexts);
      expression.replacement = `<span data-bind="${escapeAttribute(stampName)}">{${derive.expression}}</span>`;
      continue;
    }
    const queryDerive = inlineMixedQueryTextDerive(expression, model, componentName, knownQueries);
    if (!queryDerive) continue;
    const exportName = nextExportName(queryDerive.baseName, nameCounts);
    const stampName = `${queryDerive.query}.${exportName}`;
    recordQueryTextDerive(queryDerive, exportName, deriveExports, outputContexts);
    expression.replacement = `<span data-derive="${escapeAttribute(stampName)}">{${queryDerive.expression}}</span>`;
  }
}

function escapeStaticTextInterpolations(
  elements: readonly JsxIrElement[],
  boundElementStarts: ReadonlySet<number>,
  outputContexts: GeneratedOutputWriteFact[],
): boolean {
  let applied = false;
  for (const element of elements) {
    if (boundElementStarts.has(element.element.start)) continue;
    if (
      element.attributes.some(
        (attribute) =>
          attribute.name === 'data-bind' ||
          attribute.name.startsWith('data-bind:') ||
          attribute.name === 'data-derive' ||
          attribute.name === 'data-derive-attr',
      )
    ) {
      continue;
    }
    for (const child of directExpressionChildren(element)) {
      if (child.expression.solePropertyAccessPath === undefined || child.replacement) continue;
      child.replacement = `{escapeText(${child.expression.expression})}`;
      outputContexts.push(
        outputWriteFact({
          context: 'text',
          expression: child.expression.expression,
          sink: 'text child',
          source: 'server-render',
          writer: 'static text interpolation escape',
        }),
      );
      applied = true;
    }
  }
  return applied;
}

function singleImmediateElementChild(wrapper: JsxIrElement): JsxIrElement | null {
  const children = wrapper.children.filter(
    (child): child is JsxIrElement => child.kind === 'element',
  );
  if (wrapper.element.childNonWhitespaceCount !== 1 || children.length !== 1) return null;
  return children[0] ?? null;
}

function singleAttrsFunctionElementChild(wrapper: JsxIrElement): JsxIrElement | null {
  const child = wrapper.children
    .filter((item): item is JsxIrElement => item.kind === 'element')
    .find((item) =>
      item.element.spreadAttributes.some(
        (spread) => spread.expressionBareIdentifierName === 'attrs',
      ),
    );
  if (child) return child;

  const nested =
    wrapper.element.childExpressionContainers.length === 1
      ? wrapper.children.flatMap((item) => (item.kind === 'element' ? [item] : []))
      : [];
  return nested[0] ?? null;
}

function childHasUnsupportedSpreads(element: JsxIrElement): boolean {
  return element.element.spreadAttributes.some(
    (spread) => spread.expressionBareIdentifierName !== 'attrs',
  );
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
    attributeByName(element, 'viewTransitionName')?.source?.start ?? Number.MAX_SAFE_INTEGER,
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

  const queryRoots = new Set(
    (attribute.expressionPropertyAccesses ?? [])
      .map((path) => queryNameFromPath(path.path))
      .filter((query): query is string => query !== null && knownQueries.has(query)),
  );
  const roots = new Set(
    (attribute.expressionPropertyAccesses ?? [])
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
  );
  const stateOnly = roots.size > 0 && [...roots].every((root) => root === 'state');
  const clockInputs = clockQueryInputsFromRoots(roots, knownQueries);
  if (queryRoots.size !== 1 && !stateOnly && !clockInputs) return null;
  if (queryRoots.size > 0 && roots.has('state')) return null;

  const query = stateOnly ? 'state' : clockInputs ? 'now' : [...queryRoots][0];
  if (!query) return null;

  return {
    attribute,
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_${sanitizeIdentifier(attribute.name)}_derive`,
    element,
    expression: styleObjectExpression ?? attribute.expression.trim(),
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
  const propertyAccesses = [
    ...(attribute.expressionPropertyAccesses ?? []),
    ...(styleSource?.expressionPropertyAccesses ?? []),
  ];
  const roots = new Set(
    propertyAccesses
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
  );
  const queryRoots = new Set([...roots].filter((query) => knownQueries.has(query)));
  const stateOnly = roots.size > 0 && [...roots].every((root) => root === 'state');
  const queryOnly =
    queryRoots.size === 1 && [...roots].every((root) => root === [...queryRoots][0]);
  const query = stateOnly ? 'state' : queryOnly ? [...queryRoots][0] : null;
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
  if (element.selfClosing || hasBindingAttribute(element) || !expression) return null;
  const path = expression.expression.solePropertyAccessPath ?? null;
  if (!path) return null;
  return queryPathUsesKnownQuery(path, knownQueries) || isStatePath(path) ? path : null;
}

function inlineTextDerive(
  element: JsxIrElement,
  expression: JsxIrExpression | null,
  componentName: string,
): InlineStateTextDerive | null {
  if (element.selfClosing || hasBindingAttribute(element) || !expression) return null;
  if (expression.expression.solePropertyAccessPath) return null;
  if (!isStateOnlyExpression(expression.expression.propertyAccesses)) return null;
  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: expression.expression.expression,
    expressionNode: expression,
    wrapper: element,
  };
}

function inlineQueryTextDerive(
  element: JsxIrElement,
  expression: JsxIrExpression | null,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineQueryTextDerive | null {
  if (element.selfClosing || hasBindingAttribute(element) || !expression) return null;
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
  model: ComponentModuleModel,
  knownQueries: ReadonlySet<string>,
): string | null {
  const path = soleKnownQueryPath(expression.expression, knownQueries);
  if (!path) return null;
  if (isJsxAttributeExpression(expression.expression, model)) return null;
  const element = innermostContainingElement(expression.expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
  if (element.childNonWhitespaceCount === 1) return null;
  return path;
}

function inlineMixedTextDerive(
  expression: JsxIrExpression,
  model: ComponentModuleModel,
  componentName: string,
): InlineStateTextDerive | null {
  if (!isStateOnlyExpression(expression.expression.propertyAccesses)) return null;
  if (isJsxAttributeExpression(expression.expression, model)) return null;
  const element = innermostContainingElement(expression.expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
  if (element.childNonWhitespaceCount === 1) return null;
  return {
    baseName: `${sanitizeIdentifier(componentName)}$${sanitizeIdentifier(element.tag)}_text_derive`,
    expression: expression.expression.expression,
    expressionNode: expression,
  };
}

function inlineMixedQueryTextDerive(
  expression: JsxIrExpression,
  model: ComponentModuleModel,
  componentName: string,
  knownQueries: ReadonlySet<string>,
): InlineQueryTextDerive | null {
  const inputs = clockQueryInputsFromAccesses(expression.expression.propertyAccesses, knownQueries);
  if (!inputs) return null;
  if (isJsxAttributeExpression(expression.expression, model)) return null;
  const element = innermostContainingElement(expression.expression, model);
  if (!element) return null;
  if (element.attributes.some((attribute) => isBindingAttributeName(attribute.name))) return null;
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
  const roots = new Set(
    accesses
      .map((access) => queryNameFromPath(access.path))
      .filter((root): root is string => root !== null),
  );
  return clockQueryInputsFromRoots(roots, knownQueries);
}

function clockQueryInputsFromRoots(
  roots: ReadonlySet<string>,
  knownQueries: ReadonlySet<string>,
): readonly string[] | null {
  if (!roots.has('now')) return null;
  if (![...roots].every((root) => root === 'now' || knownQueries.has(root))) return null;
  return ['now', ...[...roots].filter((root) => root !== 'now').sort()];
}

function recordStateDerive(
  derive: InlineStateTextDerive,
  exportName: string,
  stampName: string,
  deriveExports: string[],
  stateDerives: StateDeriveFact[],
  outputContexts: GeneratedOutputWriteFact[],
): void {
  const expression = derive.expression.trim();
  deriveExports.push(
    `export const ${exportName} = derive(["state"], (state: any) => ${expression});`,
  );
  stateDerives.push({
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
    placeholder: stampName,
  });
  outputContexts.push(
    outputWriteFact({
      context: 'text',
      expression,
      sink: 'textContent',
      source: 'client-state',
      writer: 'inline state text derive',
    }),
  );
}

function recordQueryTextDerive(
  derive: InlineQueryTextDerive,
  exportName: string,
  deriveExports: string[],
  outputContexts: GeneratedOutputWriteFact[],
): void {
  const expression = derive.expression.trim();
  deriveExports.push(
    `export const ${exportName} = derive(${JSON.stringify(derive.inputs)}, (${derive.params.join(', ')}) => ${expression});`,
  );
  outputContexts.push(
    outputWriteFact({
      context: 'text',
      expression,
      sink: 'textContent',
      source: 'client-query',
      writer: 'inline query text derive',
    }),
  );
}

function outputWriteFact(fact: GeneratedOutputWriteFact): GeneratedOutputWriteFact {
  return fact;
}

function expressionChildren(elements: readonly JsxIrElement[]): JsxIrExpression[] {
  const result: JsxIrExpression[] = [];
  const visit = (child: JsxIrChild): void => {
    if (child.kind === 'expression') result.push(child);
    if (child.kind === 'element') child.children.forEach(visit);
  };
  elements.forEach((element) => element.children.forEach(visit));
  return result;
}

function directExpressionChildren(element: JsxIrElement): JsxIrExpression[] {
  return element.children.filter((child): child is JsxIrExpression => child.kind === 'expression');
}

function soleExpressionChild(element: JsxIrElement): JsxIrExpression | null {
  const nonWhitespace = element.children.filter(
    (child) => child.kind !== 'text' || child.source.trim() !== '',
  );
  return nonWhitespace.length === 1 && nonWhitespace[0]?.kind === 'expression'
    ? nonWhitespace[0]
    : null;
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

function mergeableToIrAttribute(
  attribute: MergeableAttribute,
  options: { fileName: string; source: string },
): JsxIrAttribute {
  const value = mergeableValueToIr(attribute.value);
  const base =
    attribute.origin === 'primitive'
      ? primitiveJsxIrAttribute(attribute.name, value, 'primitive attrs', options)
      : generatedJsxIrAttribute(attribute.name, value, 'author merged attrs', options);
  if (attribute.attribute) {
    base.anchor = {
      end: attribute.attribute.end,
      fileName: options.fileName,
      start: attribute.attribute.start,
    };
    base.source = attribute.attribute;
  }
  return base;
}

function mergeableValueToIr(value: MergeableAttributeValue): JsxIrAttributeValue {
  if (value.kind === 'boolean') return value;
  if (value.kind === 'expression') return value;
  if (value.kind === 'number') return value;
  return value;
}

function spreadObjectAttributes(
  entries: readonly { key: string; value?: string }[],
): JsxIrAttribute[] | null {
  const attributes: JsxIrAttribute[] = [];
  for (const entry of entries) {
    const value = spreadObjectAttributeValue(entry.value);
    if (value === null) return null;
    if (!value) continue;
    attributes.push({
      name: entry.key,
      ownership: 'generated',
      provenance: {
        description: 'static spread attribute',
        ownership: 'generated',
        writer: 'static spread lowering',
      },
      value,
    });
  }
  return attributes;
}

function spreadObjectAttributeValue(
  value: string | undefined,
): JsxIrAttributeValue | null | undefined {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === 'false' || trimmed === 'null' || trimmed === 'undefined') return undefined;
  const stringValue = literalStringValue(trimmed);
  if (stringValue !== null) return { kind: 'string', value: stringValue };
  if (trimmed === 'true') return { kind: 'boolean', value: true };
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return { kind: 'number', value: Number(trimmed) };
  return { kind: 'expression', source: trimmed };
}

function withMergeWriterNames(diagnostics: readonly CompilerDiagnostic[]): CompilerDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: `${diagnostic.message} (writers: primitive attrs, author JSX)`,
  }));
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
  return element.attributes.find((attribute) => attribute.name === name);
}

function hasAttribute(element: JsxIrElement, name: string): boolean {
  return attributeByName(element, name) !== undefined;
}

function hasAuthoredAttribute(element: JsxIrElement, name: string): boolean {
  return element.attributes.some(
    (attribute) => attribute.name === name && attribute.ownership === 'author',
  );
}

function replaceJsxIrAttribute(
  element: JsxIrElement,
  oldName: string,
  attribute: JsxIrAttribute,
): void {
  const index = element.attributes.findIndex((item) => item.name === oldName);
  if (index === -1) {
    setJsxIrAttribute(element, attribute);
    return;
  }
  element.attributes.splice(index, 1, attribute);
  markJsxIrChanged(element);
}

function insertJsxIrAttributeAtSource(
  element: JsxIrElement,
  sourceStart: number,
  attribute: JsxIrAttribute,
): void {
  const index = element.attributes.findIndex(
    (item) => item.source !== undefined && item.source.start > sourceStart,
  );
  if (index === -1) {
    element.attributes.push(attribute);
  } else {
    element.attributes.splice(index, 0, attribute);
  }
  markJsxIrChanged(element);
}

function hasBindingAttribute(element: JsxIrElement): boolean {
  return element.attributes.some((attribute) => isBindingAttributeName(attribute.name));
}

function isBindingAttributeName(name: string): boolean {
  return name === 'data-bind' || name.startsWith('data-bind:') || name === 'data-bind-list';
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
    name.startsWith('data-bind:') ||
    name.startsWith('data-bind-prop:') ||
    name.startsWith('data-p-') ||
    name.startsWith('kovo-')
  );
}

function inlineAttributeDeriveSkippedBySpan(
  attribute: JsxAttributeModel,
  options: StructuralJsxLoweringOptions,
): boolean {
  if (attribute.expressionStart === undefined || attribute.expressionEnd === undefined) {
    return false;
  }

  return (options.skipInlineAttributeDeriveSpans ?? []).some(
    (span) =>
      attribute.expressionStart !== undefined &&
      attribute.expressionEnd !== undefined &&
      attribute.expressionStart >= span.start &&
      attribute.expressionEnd <= span.end,
  );
}

function navigationObjectValue(
  element: JsxIrElement,
  name: string,
): Record<string, string | number | boolean | null> | null | undefined {
  const attribute = attributeByName(element, name)?.source;
  if (!attribute || !('expressionStaticValue' in attribute)) return undefined;
  return staticNavigationObjectValue(attribute.expressionStaticValue);
}

function staticNavigationObjectValue(
  value: StaticLiteralValue | undefined,
): Record<string, string | number | boolean | null> | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return null;
  return Object.values(value).every((entry) => typeof entry !== 'object' || entry === null)
    ? (value as Record<string, string | number | boolean | null>)
    : null;
}

function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  const pathname = substituteStaticRouteParams(path, params);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(searchValues)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function substituteStaticRouteParams(
  path: string,
  params: Record<string, string | number | boolean | null>,
): string {
  let output = '';
  let index = 0;
  while (index < path.length) {
    const char = path[index];
    const next = path[index + 1];
    if (char !== ':' || next === undefined || !isRouteParamNameStart(next)) {
      output += char;
      index += 1;
      continue;
    }
    let end = index + 2;
    while (end < path.length && isRouteParamNamePart(path[end] ?? '')) end += 1;
    const key = path.slice(index + 1, end);
    output += encodeURIComponent(String(params[key] ?? ''));
    index = end;
  }
  return output;
}

function sortHrefFirstForStaticLink(element: JsxIrElement, staticHref: boolean): void {
  if (!staticHref) return;
  const href = attributeByName(element, 'href');
  if (!href) return;
  element.attributes = [href, ...element.attributes.filter((attribute) => attribute !== href)];
  markJsxIrChanged(element);
}

function isJsxAttributeExpression(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
): boolean {
  return model.jsxElements.some((element) =>
    element.attributes.some(
      (attribute) =>
        attribute.expressionStart !== undefined &&
        attribute.expressionEnd !== undefined &&
        expression.start >= attribute.expressionStart &&
        expression.end <= attribute.expressionEnd,
    ),
  );
}

function innermostContainingElement(
  expression: { end: number; start: number },
  model: ComponentModuleModel,
) {
  return (
    model.jsxElements
      .filter(
        (element) =>
          !element.selfClosing &&
          expression.start >= element.openingEnd &&
          expression.end <= element.closingStart,
      )
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0] ?? null
  );
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
  const roots = new Set(
    paths
      .map((path) => queryNameFromPath(path.path))
      .filter((root): root is string => root !== null),
  );
  return roots.size > 0 && [...roots].every((root) => root === 'state');
}

function viewTransitionNameStyleExpression(
  transitionExpression: string,
  styleAttribute: JsxAttributeModel | undefined,
): string {
  const transition = stylePropertyExpression('view-transition-name', transitionExpression);
  if (styleAttribute?.expression !== undefined) {
    return `[${styleAttribute.expression}, ${transition}].filter(Boolean).join('; ')`;
  }
  const existing = (styleAttribute?.value ?? '').trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  const prefix = existing === '' ? '' : `${existing}${separator} `;
  return prefix === '' ? transition : `[${JSON.stringify(prefix)}, ${transition}].join('')`;
}

function styleObjectDeriveExpression(entries: readonly ObjectLiteralEntry[]): string | null {
  const parts = entries.flatMap((entry) => {
    if (entry.value === undefined) return [];
    return [stylePropertyExpression(cssPropertyName(entry.key), entry.value)];
  });
  if (parts.length === 0) return null;

  return `[${parts.join(', ')}].filter(Boolean).join('; ')`;
}

function cssPropertyName(name: string): string {
  if (name.startsWith('--')) return name;
  return name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`).toLowerCase();
}

function deriveParam(candidate: InlineAttributeDerive): string {
  return candidate.source === 'state' ? 'state: any' : candidate.query;
}

function deriveExpression(attribute: JsxAttributeModel, expression: string): string {
  const trimmed = expression.trim();
  return booleanPresenceAttributes.has(attribute.name) ? `((${trimmed}) ? "" : null)` : trimmed;
}

function nextExportName(baseName: string, nameCounts: Map<string, number>): string {
  const count = nameCounts.get(baseName) ?? 0;
  nameCounts.set(baseName, count + 1);
  return count === 0 ? baseName : `${baseName}_${count + 1}`;
}

function stateBindingAttributeName(name: string): string {
  return `data-bind:${name}`;
}

function derivePrefixInsertionOffset(source: string): number {
  const jsxImportSource = /^\/\*\* @jsxImportSource [\s\S]*?\*\/\s*/.exec(source);
  return jsxImportSource?.[0].length ?? 0;
}

function trimTrailingSemicolon(value: string): string {
  return value.trim().replace(/;$/, '').trim();
}

function isStatePath(path: string): boolean {
  return path.startsWith('state.');
}

function isComponentTag(tag: string): boolean {
  return tag.includes('.') || /^[A-Z]/.test(tag);
}

function staticStringValue(value: StaticLiteralValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function isRouteParamNameStart(char: string): boolean {
  return (
    char === '_' || char === '$' || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')
  );
}

function isRouteParamNamePart(char: string): boolean {
  return isRouteParamNameStart(char) || (char >= '0' && char <= '9');
}

function sanitizeIdentifier(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[A-Za-z_$]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

const booleanPresenceAttributes = new Set([
  'checked',
  'disabled',
  'hidden',
  'multiple',
  'open',
  'readonly',
  'required',
  'selected',
]);
