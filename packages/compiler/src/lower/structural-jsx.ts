import ts from 'typescript';

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
import {
  expressionResolvesToFrameworkExport,
  frameworkExport,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { isHtmlWireValueStable } from '@kovojs/core/internal/semantic-attributes';
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
import {
  parseComponentModule,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
  type JsxExpressionModel,
  type ObjectLiteralEntry,
  type SourceSpan,
} from '../scan/parse.js';
/* Parser-owned intrinsic identity is mandatory for the component traversal below. */
import type { CompileComponentOptions, StateDeriveFact, ViewTransitionStamp } from '../types.js';
import type { StaticLiteralValue } from '../scan/object.js';
import {
  enhancedMutationFormBinding,
  isImportedMutationFormAttributesCall,
  isIntrinsicHtmlElement,
  isMutationFormAttributesSpread,
  mutationFormControlAttributeName,
  mutationFormProvenanceAttributeName,
  mutationFormTransportAttributeName,
  mutationSubmitterTransportAttributeName,
} from '../mutation-form-provenance.js';
import { localMutationKey } from '../mutation-form-binding.js';
import { runtimeOutputHelpers, stylePropertyExpression } from '../security/output-context.js';
import {
  bindPropStampAttributeName,
  escapeAttribute,
  isPropertyAuthoritativeAttribute,
  normalizeComponentFileName,
  outputWriteFact,
  sanitizeIdentifier,
  type SourceReplacement,
} from '../shared.js';
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
  compilerSetDelete,
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

const RUNTIME_OUTPUT_IMPORT = '@kovojs/browser/internal/output';
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
  /** @internal Project files pinned by the compiler/Vite caller for source component proof. */
  extraFiles?: readonly { readonly fileName: string; readonly source: string }[];
  skipInlineAttributeDeriveSpans?: readonly SourceSpan[];
};

const KOVO_COMPONENT_IDENTITY = frameworkExport('@kovojs/core', 'component');
const KOVO_ROUTE_IDENTITY = frameworkExport('@kovojs/server', 'route');

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
  'mutation-form-provenance',
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

  appendCompilerFacts(
    diagnostics,
    mutationFormProvenanceDiagnostics(tree.elements, model, options),
    'Mutation form provenance diagnostics',
  );
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
      ? `import { ${compilerArrayJoin(runtimeImports, ', ')} } from '${RUNTIME_OUTPUT_IMPORT}';\n\n${compilerArrayJoin(deriveExports, '\n')}\n\n`
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

/**
 * SPEC §5.2 rule 10 / §6.3: enhancement and mutation identity are compiler-owned consequences of
 * a typed mutation binding. Diagnose authored wire stamps before static spread expansion and the
 * structural reparse can erase their caller-owned provenance.
 */
function mutationFormProvenanceDiagnostics(
  elements: readonly JsxIrElement[],
  model: ComponentModuleModel,
  options: StructuralJsxLoweringOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const mutationForms: JsxIrElement[] = [];
  const elementLength = compilerArrayLength(elements, 'Mutation form provenance elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Mutation form provenance elements',
    ) as JsxIrElement;
    const source = element.element;
    if (!isIntrinsicHtmlElement(source, 'form')) continue;

    const syntacticBinding = enhancedMutationFormBinding(source);
    const binding =
      syntacticBinding !== null &&
      localMutationKey(
        model,
        syntacticBinding.localName,
        options.registryFacts,
        options.fileName,
      ) !== null
        ? syntacticBinding
        : null;
    if (binding !== null) {
      appendCompilerFact(mutationForms, element, 'Proven mutation form elements');
    }
    const attributeLength = compilerArrayLength(
      source.attributes,
      'Mutation form provenance attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        source.attributes,
        attributeIndex,
        'Mutation form provenance attributes',
      ) as JsxAttributeModel;
      const provenanceName = mutationFormProvenanceAttributeName(attribute.name);
      if (provenanceName === null || mutationFormControlIsStaticallyAbsent(attribute)) continue;
      const control = mutationFormControlAttributeName(provenanceName);
      const transport = mutationFormTransportAttributeName(provenanceName);
      if (control === null && (transport === null || binding === null)) continue;
      // A literal enctype remains supported by the direct mutation lowering, which validates the
      // multipart case. Only spread-derived enctype is unprovable and reconstructed below.
      if (transport === 'enctype') continue;
      if (control === 'mutation' && binding?.start === attribute.start) continue;
      if (control === 'enhance' && binding !== null) continue;
      appendCompilerFact(
        diagnostics,
        mutationFormProvenanceDiagnostic(
          options,
          attribute,
          control === null
            ? `authored ${provenanceName} cannot override compiler-owned typed mutation transport; use a separate native form for a different action or method`
            : control === 'mutation' || control === 'enhance'
              ? `authored ${control} requires a direct mutation={mutationValue} binding or an exact @kovojs/server mutationFormAttributes(...) spread`
              : `raw ${control} is framework-owned mutation transport metadata; remove it and let mutation={...} or mutationFormAttributes(...) derive the transport`,
        ),
        'Mutation form provenance diagnostics',
      );
      removeJsxIrSourceAttribute(element, attribute);
    }

    const spreadLength = compilerArrayLength(
      source.spreadAttributes,
      'Mutation form provenance spreads',
    );
    for (let spreadIndex = 0; spreadIndex < spreadLength; spreadIndex += 1) {
      const spread = compilerOwnDataValue(
        source.spreadAttributes,
        spreadIndex,
        'Mutation form provenance spreads',
      ) as (typeof source.spreadAttributes)[number];
      if (
        isMutationFormAttributesSpread(spread) &&
        spread.expressionCallArgumentBareIdentifierName !== undefined &&
        localMutationKey(
          model,
          spread.expressionCallArgumentBareIdentifierName,
          options.registryFacts,
          options.fileName,
        ) !== null
      ) {
        continue;
      }
      if (isImportedMutationFormAttributesCall(spread)) {
        appendCompilerFact(
          diagnostics,
          mutationFormProvenanceDiagnostic(
            options,
            spread,
            'mutationFormAttributes(...) requires a compiler-proven mutation() declaration or generated registry binding',
          ),
          'Mutation form provenance diagnostics',
        );
        removeJsxIrSourceAttribute(element, spread);
        continue;
      }
      const controls = compilerSnapshotDenseArray(
        spread.mutationFormControlNames ?? [],
        'Spread mutation form control names',
      );
      const forbidden: string[] = [];
      for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
        const name = controls[controlIndex]!;
        if (
          mutationFormControlAttributeName(name) !== null ||
          (binding !== null && mutationFormTransportAttributeName(name) !== null)
        ) {
          appendCompilerFact(forbidden, name, 'Forbidden spread mutation form controls');
        }
      }
      if (forbidden.length === 0) continue;
      appendCompilerFact(
        diagnostics,
        mutationFormProvenanceDiagnostic(
          options,
          spread,
          `caller-owned JSX spread carries Kovo mutation controls (${compilerArrayJoin(forbidden, ', ')}); use direct mutation={mutationValue} or the exact @kovojs/server mutationFormAttributes(...) helper`,
        ),
        'Mutation form provenance diagnostics',
      );
      removeJsxIrSourceAttribute(element, spread);
    }
  }

  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Mutation submitter provenance elements',
    ) as JsxIrElement;
    if (
      !isIntrinsicHtmlElement(element.element, 'button') &&
      !isIntrinsicHtmlElement(element.element, 'input')
    ) {
      continue;
    }
    const associatedMutationForm = mutationFormForSubmitter(element, mutationForms);
    const directTransport = mutationSubmitterDirectTransport(element.element);
    if (
      associatedMutationForm === null &&
      mutationForms.length > 0 &&
      directTransport.hasFormAssociation &&
      directTransport.overrides.length > 0 &&
      !submitterTargetsProvenSeparateNativeForm(element, elements, mutationForms) &&
      !mutationDocumentControlTargetsProvenSeparateNativeForm(model, element.element, options)
    ) {
      for (
        let overrideIndex = 0;
        overrideIndex < directTransport.overrides.length;
        overrideIndex += 1
      ) {
        const attribute = directTransport.overrides[overrideIndex]!;
        appendCompilerFact(
          diagnostics,
          mutationFormProvenanceDiagnostic(
            options,
            attribute,
            `${attribute.name} on an externally associated submitter cannot be proven separate from a typed mutation form; use a separate native form`,
          ),
          'External mutation submitter diagnostics',
        );
      }
    }
    const spreads = compilerSnapshotDenseArray(
      element.element.spreadAttributes,
      'Mutation submitter provenance spreads',
    );
    for (let spreadIndex = 0; spreadIndex < spreads.length; spreadIndex += 1) {
      const spread = spreads[spreadIndex]!;
      const controls = compilerSnapshotDenseArray(
        spread.mutationFormControlNames ?? [],
        'Mutation submitter spread control names',
      );
      let carriesFormAssociation = false;
      for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
        if (mutationSubmitterTransportAttributeName(controls[controlIndex]!) === 'form') {
          carriesFormAssociation = true;
          break;
        }
      }
      // A spread can make an otherwise external submitter target a typed form by supplying its
      // `form` attribute together with transport overrides. The value may be dynamic, so the
      // compiler cannot safely decide that it names some other form.
      if (
        associatedMutationForm === null &&
        (mutationForms.length === 0 || !carriesFormAssociation)
      ) {
        continue;
      }
      const forbidden: string[] = [];
      for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
        const name = controls[controlIndex]!;
        if (mutationSubmitterTransportAttributeName(name) !== null) {
          appendCompilerFact(forbidden, name, 'Forbidden submitter spread transport names');
        }
      }
      if (forbidden.length === 0) continue;
      appendCompilerFact(
        diagnostics,
        mutationFormProvenanceDiagnostic(
          options,
          spread,
          `caller-owned submitter spread overrides typed mutation transport (${compilerArrayJoin(forbidden, ', ')}); remove form transport attributes or use a separate native form`,
        ),
        'Mutation form provenance diagnostics',
      );
      removeJsxIrSourceAttribute(element, spread);
    }
  }
  appendCompilerFacts(
    diagnostics,
    componentMutationSubmitterOverrideDiagnostics(elements, model, mutationForms, options),
    'Component mutation submitter diagnostics',
  );
  appendCompilerFacts(
    diagnostics,
    documentMutationFormOwnershipDiagnostics(model, options),
    'Document mutation form ownership diagnostics',
  );
  return diagnostics;
}

function submitterTargetsProvenSeparateNativeForm(
  submitter: JsxIrElement,
  elements: readonly JsxIrElement[],
  mutationForms: readonly JsxIrElement[],
): boolean {
  const formId = staticFormAssociationString(submitter, 'form');
  if (formId === null || formId.length === 0) return false;
  const allElements = compilerSnapshotDenseArray(elements, 'Native form association elements');
  const typedForms = compilerSnapshotDenseArray(mutationForms, 'Typed mutation forms');
  let matches = 0;
  for (let index = 0; index < allElements.length; index += 1) {
    const candidate = allElements[index]!;
    if (!isIntrinsicHtmlElement(candidate.element, 'form')) continue;
    if (formAssociationIdIsDynamic(candidate)) return false;
    if (staticFormAssociationString(candidate, 'id') !== formId) continue;
    let typed = false;
    for (let typedIndex = 0; typedIndex < typedForms.length; typedIndex += 1) {
      if (typedForms[typedIndex] === candidate) {
        typed = true;
        break;
      }
    }
    if (typed || formIsNestedInTypedMutationForm(candidate, typedForms)) return false;
    matches += 1;
    if (matches > 1) return false;
  }
  return matches === 1;
}

function formAssociationIdIsDynamic(form: JsxIrElement): boolean {
  if (form.element.spreadAttributes.length > 0) return true;
  const attributes = compilerSnapshotDenseArray(
    form.element.attributes,
    'Native form association attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (compilerStringToLowerCase(attribute.name) !== 'id') continue;
    if (mutationFormControlIsStaticallyAbsent(attribute)) return false;
    return attribute.value === undefined && typeof attribute.expressionStaticValue !== 'string';
  }
  return false;
}

function formIsNestedInTypedMutationForm(
  form: JsxIrElement,
  mutationForms: readonly JsxIrElement[],
): boolean {
  const typedForms = compilerSnapshotDenseArray(
    mutationForms,
    'Native form association typed forms',
  );
  for (let index = 0; index < typedForms.length; index += 1) {
    const typed = typedForms[index]!.element;
    if (form.element.start >= typed.openingEnd && form.element.end <= typed.closingStart) {
      return true;
    }
  }
  return false;
}

function mutationFormForSubmitter(
  element: JsxIrElement,
  mutationForms: readonly JsxIrElement[],
): JsxIrElement | null {
  if (
    !isIntrinsicHtmlElement(element.element, 'button') &&
    !isIntrinsicHtmlElement(element.element, 'input')
  ) {
    return null;
  }
  const controlFormId = staticFormAssociationString(element, 'form');
  const forms = compilerSnapshotDenseArray(mutationForms, 'Proven mutation submitter forms');
  for (let index = 0; index < forms.length; index += 1) {
    const form = forms[index]!;
    const source = form.element;
    const descendant =
      element.element.start >= source.openingEnd && element.element.end <= source.closingStart;
    const formId = staticFormAssociationString(form, 'id');
    if (descendant || (controlFormId !== null && formId === controlFormId)) return form;
  }
  return null;
}

function mutationSubmitterDirectTransport(element: JsxElementModel): {
  hasFormAssociation: boolean;
  overrides: JsxAttributeModel[];
} {
  let hasFormAssociation = false;
  const overrides: JsxAttributeModel[] = [];
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Direct mutation submitter attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (mutationFormControlIsStaticallyAbsent(attribute)) continue;
    const transport = mutationSubmitterTransportAttributeName(attribute.name);
    if (transport === 'form') {
      hasFormAssociation = true;
    } else if (transport !== null) {
      appendCompilerFact(overrides, attribute, 'Direct mutation submitter overrides');
    }
  }
  return { hasFormAssociation, overrides };
}

function componentMutationSubmitterOverrideDiagnostics(
  elements: readonly JsxIrElement[],
  model: ComponentModuleModel,
  mutationForms: readonly JsxIrElement[],
  options: StructuralJsxLoweringOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const elementSnapshot = compilerSnapshotDenseArray(
    elements,
    'Component mutation submitter elements',
  );
  const formSnapshot = compilerSnapshotDenseArray(
    mutationForms,
    'Component mutation submitter forms',
  );
  const project = mutationComponentProject(model, options);

  for (let formIndex = 0; formIndex < formSnapshot.length; formIndex += 1) {
    const form = formSnapshot[formIndex]!.element;
    for (let elementIndex = 0; elementIndex < elementSnapshot.length; elementIndex += 1) {
      const candidate = elementSnapshot[elementIndex]!;
      if (
        candidate.element.start < form.openingEnd ||
        candidate.element.end > form.closingStart ||
        candidate.element.intrinsicTagName !== undefined
      ) {
        continue;
      }
      inspectMutationComponent(
        project.root,
        candidate.tag,
        candidate.element,
        compilerCreateSet<string>(),
        project,
        options,
        diagnostics,
      );
    }
  }

  return diagnostics;
}

interface MutationComponentSource {
  readonly fileName: string;
  readonly model: ComponentModuleModel;
  readonly source: string;
}

interface MutationComponentProject {
  readonly files: readonly MutationComponentSource[];
  readonly root: MutationComponentSource;
}

interface MutationComponentImplementation {
  readonly body: ts.ConciseBody;
  readonly source: MutationComponentSource;
}

interface MutationDocumentElementInstance {
  readonly componentDepth: number;
  readonly diagnosticSpan: SourceSpan;
  readonly element: JsxElementModel;
  readonly nearestForm: MutationDocumentFormInstance | undefined;
  readonly source: MutationComponentSource;
}

interface MutationDocumentFormInstance extends MutationDocumentElementInstance {
  readonly id: string | null;
  readonly idIsDynamic: boolean;
  readonly idIsWireStable: boolean;
  readonly idSpan: SourceSpan | undefined;
  readonly typed: boolean;
}

interface MutationDocumentControlInstance extends MutationDocumentElementInstance {
  readonly formAttribute?: JsxAttributeModel;
  readonly formSpreadAssociation: 'known' | 'possible' | null;
}

interface MutationDocumentOpaqueInstance {
  readonly descendantClassified: boolean;
  readonly diagnosticSpan: SourceSpan;
  readonly inheritedForm: MutationDocumentFormInstance | undefined;
  readonly tag: string;
}

interface MutationDocumentProjection {
  readonly context: MutationDocumentProjectionContext;
  readonly localName?: string;
  readonly nodes: readonly MutationDocumentOutputNode[];
  readonly objectName?: string;
  readonly propertyName?: string;
}

interface MutationDocumentProjectionContext {
  readonly entries: readonly MutationDocumentProjection[];
  unknownValues: boolean;
}

interface MutationDocumentCensus {
  readonly controls: readonly MutationDocumentControlInstance[];
  readonly forms: readonly MutationDocumentFormInstance[];
  readonly opaque: readonly MutationDocumentOpaqueInstance[];
}

/** @internal One statically reachable successful control owned by a local typed form instance. */
export interface MutationDocumentReachableControl {
  readonly componentRendered: boolean;
  readonly diagnosticSpan: SourceSpan;
  readonly element: JsxElementModel;
  readonly explicitFormAssociation: boolean;
  readonly fileName: string;
}

function mutationComponentProject(
  model: ComponentModuleModel,
  options: StructuralJsxLoweringOptions,
): MutationComponentProject {
  const root: MutationComponentSource = {
    fileName: normalizeComponentFileName(options.fileName),
    model,
    source: options.source,
  };
  const files: MutationComponentSource[] = [root];
  const extraFiles = compilerSnapshotDenseArray(
    options.extraFiles ?? [],
    'Mutation component project files',
  );
  for (let index = 0; index < extraFiles.length; index += 1) {
    const file = extraFiles[index]!;
    const fileName = normalizeComponentFileName(file.fileName);
    if (fileName === root.fileName) continue;
    appendCompilerFact(
      files,
      {
        fileName,
        model: parseComponentModule(fileName, file.source, {
          frameworkIdentityFiles: extraFiles,
        }),
        source: file.source,
      },
      'Mutation component project models',
    );
  }
  return { files, root };
}

function documentMutationFormOwnershipDiagnostics(
  model: ComponentModuleModel,
  options: StructuralJsxLoweringOptions,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const seen = compilerCreateSet<string>();
  const censuses = mutationDocumentCensuses(model, options);
  for (let censusIndex = 0; censusIndex < censuses.length; censusIndex += 1) {
    const census = censuses[censusIndex]!;
    const forms = compilerSnapshotDenseArray(census.forms, 'Document mutation ownership forms');
    const controls = compilerSnapshotDenseArray(
      census.controls,
      'Document mutation ownership controls',
    );
    const typedForms: MutationDocumentFormInstance[] = [];
    for (let formIndex = 0; formIndex < forms.length; formIndex += 1) {
      const form = forms[formIndex]!;
      if (form.typed) {
        appendCompilerFact(typedForms, form, 'Document typed mutation forms');
      }
    }
    let hasDefiniteFormAssociation = false;
    for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
      if (mutationDocumentControlHasDefiniteFormAssociation(controls[controlIndex]!)) {
        hasDefiniteFormAssociation = true;
        break;
      }
    }
    if (typedForms.length === 0 && !hasDefiniteFormAssociation) continue;

    for (let formIndex = 0; formIndex < forms.length; formIndex += 1) {
      const form = forms[formIndex]!;
      if (form.idIsWireStable) continue;
      appendMutationDocumentDiagnostic(
        diagnostics,
        seen,
        options,
        form.source.model === model ? (form.idSpan ?? form.diagnosticSpan) : form.diagnosticSpan,
        'form id is not stable across SSR UTF-8 serialization and HTML input preprocessing; remove NUL, carriage returns, and lone UTF-16 surrogates from security-relevant form ids',
      );
    }

    const opaque = compilerSnapshotDenseArray(census.opaque, 'Document mutation opaque output');
    for (let opaqueIndex = 0; opaqueIndex < opaque.length; opaqueIndex += 1) {
      const candidate = opaque[opaqueIndex]!;
      // The descendant-only classifier already owns this exact closed verdict. This census adds
      // the sibling/document-wide relation that the descendant walk cannot observe.
      if (candidate.inheritedForm?.typed === true && candidate.descendantClassified) continue;
      appendMutationDocumentDiagnostic(
        diagnostics,
        seen,
        options,
        candidate.diagnosticSpan,
        `component-rendered <${candidate.tag}> has opaque, cyclic, or unresolved output while the document carries typed-form ownership; pin the component source and make every form/control association static`,
      );
    }

    let hasDynamicFormId = false;
    for (let formIndex = 0; formIndex < forms.length; formIndex += 1) {
      if (forms[formIndex]!.idIsDynamic) {
        hasDynamicFormId = true;
        break;
      }
    }

    for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
      const control = controls[controlIndex]!;
      const provenOwner = mutationDocumentControlOwner(census, control);
      if (
        provenOwner?.typed === true &&
        !mutationDocumentControlIsLexicalDescendant(control, provenOwner)
      ) {
        const directTransport = mutationSubmitterDirectTransport(control.element);
        for (
          let overrideIndex = 0;
          overrideIndex < directTransport.overrides.length;
          overrideIndex += 1
        ) {
          const override = directTransport.overrides[overrideIndex]!;
          appendMutationDocumentDiagnostic(
            diagnostics,
            seen,
            options,
            control.diagnosticSpan,
            `component-rendered ${override.name} cannot override a typed mutation form transport; use a separate native form`,
          );
        }
        const spreads = compilerSnapshotDenseArray(
          control.element.spreadAttributes,
          'Document mutation submitter spreads',
        );
        for (let spreadIndex = 0; spreadIndex < spreads.length; spreadIndex += 1) {
          const spread = spreads[spreadIndex]!;
          const names = compilerSnapshotDenseArray(
            spread.mutationFormControlNames ?? [],
            'Document mutation submitter spread controls',
          );
          const overrides: string[] = [];
          for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
            const transport = mutationSubmitterTransportAttributeName(names[nameIndex]!);
            if (transport !== null && transport !== 'form') {
              appendCompilerFact(
                overrides,
                names[nameIndex]!,
                'Document mutation submitter spread overrides',
              );
            }
          }
          if (overrides.length === 0) continue;
          appendMutationDocumentDiagnostic(
            diagnostics,
            seen,
            options,
            control.diagnosticSpan,
            `component-rendered submitter spread cannot override typed mutation transport (${compilerArrayJoin(overrides, ', ')})`,
          );
        }
      }
      const formAttribute = documentControlFormAttribute(control);
      if (formAttribute === undefined && control.formSpreadAssociation === null) continue;
      const rawFormId =
        control.formSpreadAssociation === null
          ? documentStaticAttributeString(formAttribute)
          : null;
      if (rawFormId !== null && !formAssociationValueIsHtmlWireStable(rawFormId)) {
        appendMutationDocumentDiagnostic(
          diagnostics,
          seen,
          options,
          control.diagnosticSpan,
          'form association is not stable across SSR UTF-8 serialization and HTML input preprocessing; remove NUL, carriage returns, and lone UTF-16 surrogates from security-relevant form references',
        );
      }
      const formId =
        control.formSpreadAssociation !== null
          ? null
          : documentStaticFormAssociationString(formAttribute);
      const matches: MutationDocumentFormInstance[] = [];
      if (formId !== null && formId.length > 0) {
        for (let formIndex = 0; formIndex < forms.length; formIndex += 1) {
          const form = forms[formIndex]!;
          if (form.id === formId) {
            appendCompilerFact(matches, form, 'Document form association matches');
          }
        }
      }
      const unique = matches.length === 1 && !hasDynamicFormId ? matches[0] : undefined;
      const preservesTypedOwner =
        control.formSpreadAssociation === null &&
        control.nearestForm?.typed === true &&
        unique === control.nearestForm;
      if (preservesTypedOwner) continue;
      const reassignsTypedDescendant =
        control.nearestForm?.typed === true && unique !== control.nearestForm;
      const targetsTypedForm = unique?.typed === true;
      const targetsFormNestedInTypedForm = unique?.nearestForm?.typed === true;
      const provenSeparateNative =
        unique !== undefined &&
        !unique.typed &&
        !targetsFormNestedInTypedForm &&
        control.nearestForm?.typed !== true;
      if (provenSeparateNative) continue;
      if (
        typedForms.length === 0 &&
        !reassignsTypedDescendant &&
        !targetsTypedForm &&
        !targetsFormNestedInTypedForm
      ) {
        continue;
      }

      const associationName =
        control.formSpreadAssociation !== null
          ? 'form from a dynamic or caller-owned JSX spread'
          : (formAttribute?.name ?? 'form');
      const reason = reassignsTypedDescendant
        ? `${associationName} changes a control rendered inside a typed mutation form to a different owner`
        : targetsTypedForm
          ? `${associationName} attaches a component-rendered control to a typed mutation form from outside its proven descendants`
          : `${associationName} cannot be resolved to one statically separate native form across component output`;
      appendMutationDocumentDiagnostic(
        diagnostics,
        seen,
        options,
        control.diagnosticSpan,
        `${reason}; keep successful controls inside the typed form or use one uniquely identified native form`,
      );
    }
  }
  return diagnostics;
}

function mutationDocumentControlIsLexicalDescendant(
  control: MutationDocumentControlInstance,
  form: MutationDocumentFormInstance,
): boolean {
  return (
    control.source === form.source &&
    control.element.start >= form.element.openingEnd &&
    control.element.end <= form.element.closingStart
  );
}

function appendMutationDocumentDiagnostic(
  diagnostics: CompilerDiagnostic[],
  seen: Set<string>,
  options: StructuralJsxLoweringOptions,
  span: SourceSpan,
  detail: string,
): void {
  const identity = `${span.start}:${span.end}:${detail}`;
  if (compilerSetHas(seen, identity)) return;
  compilerSetAdd(seen, identity);
  appendCompilerFact(
    diagnostics,
    mutationFormProvenanceDiagnostic(options, span, detail),
    'Document mutation form diagnostics',
  );
}

/**
 * Return the controls that the statically reachable component graph assigns to one local form.
 * Emit uses this alongside the lexical control scan so imported fields participate in the same
 * required/unknown/repeated-field proof (SPEC §§5.2, 6.3, and 9.1).
 *
 * @internal
 */
export function mutationDocumentReachableControlsForForm(
  model: ComponentModuleModel,
  form: JsxElementModel,
  options: StructuralJsxLoweringOptions,
): readonly MutationDocumentReachableControl[] {
  const result: MutationDocumentReachableControl[] = [];
  const censuses = mutationDocumentCensuses(model, options);
  for (let censusIndex = 0; censusIndex < censuses.length; censusIndex += 1) {
    const census = censuses[censusIndex]!;
    let targetForm: MutationDocumentFormInstance | undefined;
    const forms = compilerSnapshotDenseArray(census.forms, 'Reachable mutation form owners');
    for (let formIndex = 0; formIndex < forms.length; formIndex += 1) {
      const candidate = forms[formIndex]!;
      if (candidate.source.model === model && candidate.element === form) {
        targetForm = candidate;
        break;
      }
    }
    if (targetForm === undefined) continue;
    const controls = compilerSnapshotDenseArray(
      census.controls,
      'Reachable mutation form controls',
    );
    for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
      const control = controls[controlIndex]!;
      const owner = mutationDocumentControlOwner(census, control);
      if (owner !== targetForm) continue;
      appendCompilerFact(
        result,
        {
          componentRendered: control.componentDepth > targetForm.componentDepth,
          diagnosticSpan: control.diagnosticSpan,
          element: control.element,
          explicitFormAssociation: mutationDocumentControlHasFormAssociation(control),
          fileName: control.source.fileName,
        },
        'Reachable mutation form controls',
      );
    }
    // Every occurrence of one statically authored form has the same closed component output.
    // Selecting one occurrence avoids multiplying field counts when another exported root also
    // renders the component, while retaining repeated child-component instances within the form.
    return result;
  }
  return result;
}

function mutationDocumentControlTargetsProvenSeparateNativeForm(
  model: ComponentModuleModel,
  element: JsxElementModel,
  options: StructuralJsxLoweringOptions,
): boolean {
  const censuses = mutationDocumentCensuses(model, options);
  let observed = false;
  for (let censusIndex = 0; censusIndex < censuses.length; censusIndex += 1) {
    const census = censuses[censusIndex]!;
    if (census.opaque.length > 0) return false;
    const controls = compilerSnapshotDenseArray(
      census.controls,
      'Separate native form document controls',
    );
    for (let controlIndex = 0; controlIndex < controls.length; controlIndex += 1) {
      const control = controls[controlIndex]!;
      if (control.source.model !== model || control.element !== element) continue;
      observed = true;
      const owner = mutationDocumentControlOwner(census, control);
      if (
        owner === undefined ||
        owner.typed ||
        owner.nearestForm?.typed === true ||
        control.nearestForm?.typed === true
      ) {
        return false;
      }
    }
  }
  return observed;
}

function mutationDocumentCensuses(
  model: ComponentModuleModel,
  options: StructuralJsxLoweringOptions,
): MutationDocumentCensus[] {
  const project = mutationComponentProject(model, options);
  const roots: MutationComponentImplementation[] = [];
  const rootIdentities = compilerCreateSet<string>();
  const components = compilerSnapshotDenseArray(
    project.root.model.components,
    'Mutation document root components',
  );
  for (let index = 0; index < components.length; index += 1) {
    const localName = components[index]!.localName;
    if (localName === undefined) continue;
    const implementation = localMutationComponentImplementation(project.root, localName);
    if (implementation === null) continue;
    const identity = mutationComponentImplementationIdentity(implementation);
    if (compilerSetHas(rootIdentities, identity)) continue;
    compilerSetAdd(rootIdentities, identity);
    appendCompilerFact(roots, implementation, 'Mutation document root implementations');
  }
  appendMutationDocumentRouteRoots(project.root, roots, rootIdentities);

  const censuses: MutationDocumentCensus[] = [];
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const mutable = {
      controls: [] as MutationDocumentControlInstance[],
      forms: [] as MutationDocumentFormInstance[],
      opaque: [] as MutationDocumentOpaqueInstance[],
    };
    appendMutationDocumentImplementation(
      roots[rootIndex]!,
      undefined,
      0,
      {
        end: roots[rootIndex]!.body.getEnd(),
        start: roots[rootIndex]!.body.getStart(project.root.model.sourceFile),
      },
      compilerCreateSet<string>(),
      project,
      options,
      mutable,
      { entries: [], unknownValues: true },
    );
    appendCompilerFact(censuses, mutable, 'Mutation document censuses');
  }
  return censuses;
}

function appendMutationDocumentRouteRoots(
  source: MutationComponentSource,
  roots: MutationComponentImplementation[],
  identities: Set<string>,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      expressionResolvesToFrameworkExport(
        ts as FrameworkIdentityTypeScript,
        source.model.sourceFile,
        node.expression,
        KOVO_ROUTE_IDENTITY,
        { legacyGlobals: [KOVO_ROUTE_IDENTITY] },
      )
    ) {
      const argumentsSnapshot = compilerSnapshotDenseArray(
        node.arguments,
        'Mutation document route arguments',
      );
      const definitionCandidate = argumentsSnapshot[1] ?? argumentsSnapshot[0];
      const definition =
        definitionCandidate === undefined
          ? undefined
          : unwrapMutationComponentExpression(definitionCandidate);
      if (definition !== undefined && ts.isObjectLiteralExpression(definition)) {
        const properties = compilerSnapshotDenseArray(
          definition.properties,
          'Mutation document route properties',
        );
        for (let index = 0; index < properties.length; index += 1) {
          const property = properties[index]!;
          if (ts.isSpreadAssignment(property)) continue;
          if (mutationDocumentPropertyName(property.name) !== 'page') continue;
          let implementation: MutationComponentImplementation | null = null;
          if (ts.isPropertyAssignment(property)) {
            const initializer = unwrapMutationComponentExpression(property.initializer);
            if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
              implementation = { body: initializer.body, source };
            } else if (ts.isIdentifier(initializer)) {
              implementation = localMutationComponentImplementation(source, initializer.text);
            }
          } else if (ts.isMethodDeclaration(property) && property.body !== undefined) {
            implementation = { body: property.body, source };
          }
          if (implementation === null) continue;
          const identity = mutationComponentImplementationIdentity(implementation);
          if (compilerSetHas(identities, identity)) continue;
          compilerSetAdd(identities, identity);
          appendCompilerFact(roots, implementation, 'Mutation document route roots');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.model.sourceFile);
}

function mutationDocumentPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function appendMutationDocumentImplementation(
  implementation: MutationComponentImplementation,
  inheritedForm: MutationDocumentFormInstance | undefined,
  componentDepth: number,
  rootSpan: SourceSpan,
  active: Set<string>,
  project: MutationComponentProject,
  options: StructuralJsxLoweringOptions,
  census: {
    controls: MutationDocumentControlInstance[];
    forms: MutationDocumentFormInstance[];
    opaque: MutationDocumentOpaqueInstance[];
  },
  projections: MutationDocumentProjectionContext,
): void {
  const identity = mutationComponentImplementationIdentity(implementation);
  if (compilerSetHas(active, identity)) {
    appendCompilerFact(
      census.opaque,
      {
        descendantClassified: true,
        diagnosticSpan: rootSpan,
        inheritedForm,
        tag: mutationImplementationDisplayName(implementation),
      },
      'Mutation document opaque implementations',
    );
    return;
  }
  compilerSetAdd(active, identity);
  const roots = mutationImplementationOutputTree(implementation);
  for (let index = 0; index < roots.length; index += 1) {
    appendMutationDocumentOutput(
      roots[index]!,
      inheritedForm,
      componentDepth,
      rootSpan,
      active,
      project,
      options,
      census,
      projections,
    );
  }
  compilerSetDelete(active, identity);
}

type MutationDocumentOutputNode = MutationDocumentElementNode | MutationDocumentExpressionNode;

interface MutationDocumentElementNode {
  readonly children: readonly MutationDocumentOutputNode[];
  readonly element: JsxElementModel;
  readonly implementation: MutationComponentImplementation;
  readonly kind: 'element';
  readonly node: ts.JsxElement | ts.JsxSelfClosingElement;
}

interface MutationDocumentExpressionNode {
  readonly expression: ts.Expression;
  readonly implementation: MutationComponentImplementation;
  readonly kind: 'expression';
  readonly span: SourceSpan;
}

function mutationImplementationOutputTree(
  implementation: MutationComponentImplementation,
): MutationDocumentOutputNode[] {
  const roots: MutationDocumentOutputNode[] = [];
  if (!ts.isBlock(implementation.body)) {
    appendMutationDocumentExpressionOutput(implementation.body, implementation, roots);
    return roots;
  }

  const visit = (node: ts.Node): void => {
    if (node !== implementation.body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined) {
        appendMutationDocumentExpressionOutput(node.expression, implementation, roots);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(implementation.body);
  return roots;
}

function appendMutationDocumentExpressionOutput(
  expression: ts.Expression,
  implementation: MutationComponentImplementation,
  output: MutationDocumentOutputNode[],
): void {
  const value = unwrapMutationComponentExpression(expression);
  if (ts.isJsxElement(value) || ts.isJsxSelfClosingElement(value)) {
    const element = mutationDocumentElementModelForNode(implementation.source, value);
    if (element === null) {
      appendCompilerFact(
        output,
        {
          expression: value,
          implementation,
          kind: 'expression',
          span: mutationDocumentNodeSpan(implementation.source, value),
        },
        'Mutation document unresolved JSX output',
      );
      return;
    }
    const children: MutationDocumentOutputNode[] = [];
    if (ts.isJsxElement(value)) {
      const childSnapshot = compilerSnapshotDenseArray(
        value.children,
        'Mutation document JSX children',
      );
      for (let index = 0; index < childSnapshot.length; index += 1) {
        const child = childSnapshot[index]!;
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
          appendMutationDocumentExpressionOutput(child, implementation, children);
        } else if (ts.isJsxExpression(child) && child.expression !== undefined) {
          appendMutationDocumentExpressionOutput(child.expression, implementation, children);
        }
      }
    }
    appendCompilerFact(
      output,
      { children, element, implementation, kind: 'element', node: value },
      'Mutation document JSX output',
    );
    return;
  }
  if (ts.isJsxFragment(value)) {
    const children = compilerSnapshotDenseArray(
      value.children,
      'Mutation document fragment children',
    );
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index]!;
      if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
        appendMutationDocumentExpressionOutput(child, implementation, output);
      } else if (ts.isJsxExpression(child) && child.expression !== undefined) {
        appendMutationDocumentExpressionOutput(child.expression, implementation, output);
      }
    }
    return;
  }
  if (ts.isConditionalExpression(value)) {
    appendMutationDocumentExpressionOutput(value.whenTrue, implementation, output);
    appendMutationDocumentExpressionOutput(value.whenFalse, implementation, output);
    return;
  }
  if (ts.isArrayLiteralExpression(value)) {
    const elements = compilerSnapshotDenseArray(value.elements, 'Mutation document output array');
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (ts.isOmittedExpression(element)) continue;
      appendMutationDocumentExpressionOutput(
        ts.isSpreadElement(element) ? element.expression : element,
        implementation,
        output,
      );
    }
    return;
  }
  if (ts.isBinaryExpression(value)) {
    if (
      value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      value.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      appendMutationDocumentExpressionOutput(value.right, implementation, output);
      return;
    }
    if (
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      appendMutationDocumentExpressionOutput(value.left, implementation, output);
      appendMutationDocumentExpressionOutput(value.right, implementation, output);
      return;
    }
  }
  if (
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value)
  ) {
    return;
  }
  appendCompilerFact(
    output,
    {
      expression: value,
      implementation,
      kind: 'expression',
      span: mutationDocumentNodeSpan(implementation.source, value),
    },
    'Mutation document expression output',
  );
}

function mutationDocumentElementModelForNode(
  source: MutationComponentSource,
  node: ts.JsxElement | ts.JsxSelfClosingElement,
): JsxElementModel | null {
  const start = node.getStart(source.model.sourceFile);
  const end = node.getEnd();
  const elements = compilerSnapshotDenseArray(
    source.model.jsxElements,
    'Mutation document source JSX elements',
  );
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (element.start === start && element.end === end) return element;
  }
  return null;
}

function mutationDocumentNodeSpan(source: MutationComponentSource, node: ts.Node): SourceSpan {
  return { end: node.getEnd(), start: node.getStart(source.model.sourceFile) };
}

function appendMutationDocumentOutput(
  node: MutationDocumentOutputNode,
  inheritedForm: MutationDocumentFormInstance | undefined,
  componentDepth: number,
  rootSpan: SourceSpan,
  active: Set<string>,
  project: MutationComponentProject,
  options: StructuralJsxLoweringOptions,
  census: {
    controls: MutationDocumentControlInstance[];
    forms: MutationDocumentFormInstance[];
    opaque: MutationDocumentOpaqueInstance[];
  },
  projections: MutationDocumentProjectionContext,
): void {
  if (node.kind === 'expression') {
    appendMutationDocumentOutputExpression(
      node,
      inheritedForm,
      componentDepth,
      rootSpan,
      active,
      project,
      options,
      census,
      projections,
    );
    return;
  }
  appendMutationDocumentElement(
    node,
    inheritedForm,
    componentDepth,
    rootSpan,
    active,
    project,
    options,
    census,
    projections,
  );
}

function appendMutationDocumentElement(
  node: MutationDocumentElementNode,
  inheritedForm: MutationDocumentFormInstance | undefined,
  componentDepth: number,
  rootSpan: SourceSpan,
  active: Set<string>,
  project: MutationComponentProject,
  options: StructuralJsxLoweringOptions,
  census: {
    controls: MutationDocumentControlInstance[];
    forms: MutationDocumentFormInstance[];
    opaque: MutationDocumentOpaqueInstance[];
  },
  projections: MutationDocumentProjectionContext,
): void {
  const source = node.implementation.source;
  const element = node.element;
  const diagnosticSpan = source === project.root ? element : rootSpan;
  let childForm = inheritedForm;
  if (element.intrinsicTagName !== undefined) {
    if (isIntrinsicHtmlElement(element, 'form')) {
      const idAttribute = mutationDocumentAttribute(element, 'id');
      const rawId = documentStaticAttributeString(idAttribute);
      const idIsWireStable = rawId === null || formAssociationValueIsHtmlWireStable(rawId);
      const id = idIsWireStable ? rawId : null;
      const form: MutationDocumentFormInstance = {
        componentDepth,
        diagnosticSpan,
        element,
        id,
        idIsDynamic:
          element.spreadAttributes.length > 0 ||
          (idAttribute !== undefined &&
            !mutationFormControlIsStaticallyAbsent(idAttribute) &&
            rawId === null),
        idIsWireStable,
        idSpan: idAttribute,
        nearestForm: inheritedForm,
        source,
        typed: mutationDocumentFormIsTyped(source, element, options),
      };
      appendCompilerFact(census.forms, form, 'Mutation document forms');
      childForm = form;
    } else if (mutationDocumentElementIsSuccessfulControl(element)) {
      appendCompilerFact(
        census.controls,
        {
          componentDepth,
          diagnosticSpan,
          element,
          ...(mutationDocumentAttribute(element, 'form') === undefined
            ? {}
            : { formAttribute: mutationDocumentAttribute(element, 'form') }),
          formSpreadAssociation: mutationDocumentControlSpreadAssociation(element),
          nearestForm: inheritedForm,
          source,
        },
        'Mutation document controls',
      );
    }
  } else {
    const invocationSpan = source === project.root ? element : rootSpan;
    if (compilerOwnedMutationFormHelper(source.model, element.tag)) return;
    const implementation = resolveMutationComponent(source, element.tag, project);
    if (implementation === null) {
      appendCompilerFact(
        census.opaque,
        {
          descendantClassified: true,
          diagnosticSpan: invocationSpan,
          inheritedForm,
          tag: element.tag,
        },
        'Mutation document opaque components',
      );
    } else {
      appendMutationDocumentImplementation(
        implementation,
        inheritedForm,
        componentDepth + 1,
        invocationSpan,
        active,
        project,
        options,
        census,
        mutationDocumentComponentProjections(node, implementation, projections),
      );
    }
    // JSX children are component inputs, not lexical DOM descendants. They are visited only at a
    // statically resolved `{children}` / `props.children` projection in the callee output.
    return;
  }

  const children = compilerSnapshotDenseArray(node.children, 'Mutation document child nodes');
  for (let index = 0; index < children.length; index += 1) {
    appendMutationDocumentOutput(
      children[index]!,
      childForm,
      componentDepth,
      rootSpan,
      active,
      project,
      options,
      census,
      projections,
    );
  }
}

interface MutationDocumentPropOutput {
  readonly name: string;
  readonly nodes: readonly MutationDocumentOutputNode[];
}

function mutationDocumentComponentProjections(
  invocation: MutationDocumentElementNode,
  implementation: MutationComponentImplementation,
  callerContext: MutationDocumentProjectionContext,
): MutationDocumentProjectionContext {
  const entries: MutationDocumentProjection[] = [];
  const propOutputs: MutationDocumentPropOutput[] = [];
  let unknownValues = false;
  const opening = ts.isJsxElement(invocation.node)
    ? invocation.node.openingElement
    : invocation.node;
  const attributes = compilerSnapshotDenseArray(
    opening.attributes.properties,
    'Mutation document component props',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (ts.isJsxSpreadAttribute(attribute)) {
      unknownValues = true;
      continue;
    }
    if (!ts.isIdentifier(attribute.name)) {
      unknownValues = true;
      continue;
    }
    const nodes: MutationDocumentOutputNode[] = [];
    if (attribute.initializer !== undefined && ts.isJsxExpression(attribute.initializer)) {
      if (attribute.initializer.expression !== undefined) {
        appendMutationDocumentExpressionOutput(
          attribute.initializer.expression,
          invocation.implementation,
          nodes,
        );
      }
    }
    appendCompilerFact(
      propOutputs,
      { name: attribute.name.text, nodes },
      'Mutation document component prop output',
    );
  }
  if (invocation.children.length > 0) {
    appendCompilerFact(
      propOutputs,
      { name: 'children', nodes: invocation.children },
      'Mutation document component children output',
    );
  }

  const context: MutationDocumentProjectionContext = { entries, unknownValues };
  const parameters = mutationDocumentImplementationParameters(implementation);
  const props = parameters[0];
  if (props === undefined) return context;
  if (ts.isIdentifier(props.name)) {
    for (let index = 0; index < propOutputs.length; index += 1) {
      const prop = propOutputs[index]!;
      appendCompilerFact(
        entries,
        {
          context: callerContext,
          nodes: prop.nodes,
          objectName: props.name.text,
          propertyName: prop.name,
        },
        'Mutation document property projections',
      );
    }
    return context;
  }
  if (!ts.isObjectBindingPattern(props.name)) return context;
  const bindings = compilerSnapshotDenseArray(
    props.name.elements,
    'Mutation document component prop bindings',
  );
  for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
    const binding = bindings[bindingIndex]!;
    if (binding.dotDotDotToken !== undefined || !ts.isIdentifier(binding.name)) {
      unknownValues = true;
      continue;
    }
    const propertyName =
      binding.propertyName === undefined
        ? binding.name.text
        : mutationDocumentPropertyName(binding.propertyName);
    if (propertyName === null) {
      unknownValues = true;
      continue;
    }
    let matched = false;
    for (let propIndex = 0; propIndex < propOutputs.length; propIndex += 1) {
      const prop = propOutputs[propIndex]!;
      if (prop.name !== propertyName) continue;
      matched = true;
      appendCompilerFact(
        entries,
        {
          context: callerContext,
          localName: binding.name.text,
          nodes: prop.nodes,
        },
        'Mutation document local prop projections',
      );
    }
    if (!matched && binding.initializer !== undefined) {
      const nodes: MutationDocumentOutputNode[] = [];
      appendMutationDocumentExpressionOutput(binding.initializer, implementation, nodes);
      appendCompilerFact(
        entries,
        {
          context,
          localName: binding.name.text,
          nodes,
        },
        'Mutation document default prop projections',
      );
    }
  }
  context.unknownValues = unknownValues;
  return context;
}

function mutationDocumentImplementationParameters(
  implementation: MutationComponentImplementation,
): readonly ts.ParameterDeclaration[] {
  const parent = implementation.body.parent;
  return ts.isFunctionLike(parent) ? parent.parameters : [];
}

function appendMutationDocumentOutputExpression(
  node: MutationDocumentExpressionNode,
  inheritedForm: MutationDocumentFormInstance | undefined,
  componentDepth: number,
  rootSpan: SourceSpan,
  active: Set<string>,
  project: MutationComponentProject,
  options: StructuralJsxLoweringOptions,
  census: {
    controls: MutationDocumentControlInstance[];
    forms: MutationDocumentFormInstance[];
    opaque: MutationDocumentOpaqueInstance[];
  },
  projections: MutationDocumentProjectionContext,
): void {
  const projected = mutationDocumentProjectionForExpression(node, projections);
  if (projected !== null) {
    const output = compilerSnapshotDenseArray(
      projected.nodes,
      'Mutation document projected output',
    );
    for (let index = 0; index < output.length; index += 1) {
      appendMutationDocumentOutput(
        output[index]!,
        inheritedForm,
        componentDepth,
        rootSpan,
        active,
        project,
        options,
        census,
        projected.context,
      );
    }
    return;
  }

  if (mutationDocumentExpressionReferencesParameter(node)) {
    if (projections.unknownValues) {
      appendMutationDocumentOpaqueExpression(census.opaque, node, inheritedForm, rootSpan, project);
    }
    return;
  }

  const expression = unwrapMutationComponentExpression(node.expression);
  if (ts.isCallExpression(expression)) {
    if (ts.isIdentifier(expression.expression)) {
      const implementation = resolveMutationComponent(
        node.implementation.source,
        expression.expression.text,
        project,
      );
      if (implementation !== null) {
        appendMutationDocumentImplementation(
          implementation,
          inheritedForm,
          componentDepth + 1,
          node.implementation.source === project.root ? node.span : rootSpan,
          active,
          project,
          options,
          census,
          mutationDocumentHelperProjections(node, expression, implementation, projections),
        );
        return;
      }
    }
    appendMutationDocumentOpaqueExpression(census.opaque, node, inheritedForm, rootSpan, project);
    return;
  }

  if (
    mutationDocumentExpressionIsCompilerEscapedText(node) ||
    mutationDocumentExpressionIsSyntacticPrimitive(expression)
  ) {
    return;
  }
  appendMutationDocumentOpaqueExpression(census.opaque, node, inheritedForm, rootSpan, project);
}

function mutationDocumentProjectionForExpression(
  node: MutationDocumentExpressionNode,
  context: MutationDocumentProjectionContext,
): MutationDocumentProjection | null {
  const expression = unwrapMutationComponentExpression(node.expression);
  const entries = compilerSnapshotDenseArray(context.entries, 'Mutation document projections');
  for (let index = 0; index < entries.length; index += 1) {
    const projection = entries[index]!;
    if (
      projection.localName !== undefined &&
      ts.isIdentifier(expression) &&
      expression.text === projection.localName
    ) {
      return projection;
    }
    if (
      projection.objectName !== undefined &&
      projection.propertyName !== undefined &&
      ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === projection.objectName &&
      expression.name.text === projection.propertyName
    ) {
      return projection;
    }
    if (
      projection.objectName !== undefined &&
      projection.propertyName !== undefined &&
      ts.isElementAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === projection.objectName &&
      expression.argumentExpression !== undefined &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      expression.argumentExpression.text === projection.propertyName
    ) {
      return projection;
    }
  }
  return null;
}

function mutationDocumentExpressionReferencesParameter(
  node: MutationDocumentExpressionNode,
): boolean {
  const expression = unwrapMutationComponentExpression(node.expression);
  const parameters = mutationDocumentImplementationParameters(node.implementation);
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    if (ts.isIdentifier(parameter.name)) {
      if (ts.isIdentifier(expression) && expression.text === parameter.name.text) return true;
      if (
        (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === parameter.name.text
      ) {
        return true;
      }
      continue;
    }
    if (!ts.isObjectBindingPattern(parameter.name) || !ts.isIdentifier(expression)) continue;
    const bindings = compilerSnapshotDenseArray(
      parameter.name.elements,
      'Mutation document parameter bindings',
    );
    for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
      const binding = bindings[bindingIndex]!;
      if (ts.isIdentifier(binding.name) && binding.name.text === expression.text) return true;
    }
  }
  return false;
}

function mutationDocumentHelperProjections(
  caller: MutationDocumentExpressionNode,
  call: ts.CallExpression,
  implementation: MutationComponentImplementation,
  callerContext: MutationDocumentProjectionContext,
): MutationDocumentProjectionContext {
  const entries: MutationDocumentProjection[] = [];
  let unknownValues = false;
  const context: MutationDocumentProjectionContext = { entries, unknownValues };
  const parameters = mutationDocumentImplementationParameters(implementation);
  const argumentsSnapshot = compilerSnapshotDenseArray(
    call.arguments,
    'Mutation document helper arguments',
  );
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index]!;
    const argument = argumentsSnapshot[index];
    if (!ts.isIdentifier(parameter.name)) {
      if (argument !== undefined) unknownValues = true;
      continue;
    }
    const nodes: MutationDocumentOutputNode[] = [];
    if (argument !== undefined) {
      appendMutationDocumentExpressionOutput(argument, caller.implementation, nodes);
    } else if (parameter.initializer !== undefined) {
      appendMutationDocumentExpressionOutput(parameter.initializer, implementation, nodes);
    }
    appendCompilerFact(
      entries,
      {
        context: argument === undefined ? context : callerContext,
        localName: parameter.name.text,
        nodes,
      },
      'Mutation document helper projections',
    );
  }
  context.unknownValues = unknownValues;
  return context;
}

function mutationDocumentExpressionIsCompilerEscapedText(
  node: MutationDocumentExpressionNode,
): boolean {
  const expressions = compilerSnapshotDenseArray(
    node.implementation.source.model.jsxExpressions,
    'Mutation document JSX expressions',
  );
  for (let index = 0; index < expressions.length; index += 1) {
    const expression = expressions[index]!;
    if (expression.start === node.span.start && expression.end === node.span.end) {
      return shouldEscapeStaticTextExpression(expression, node.implementation.source.model);
    }
  }
  return false;
}

function mutationDocumentExpressionIsSyntacticPrimitive(expression: ts.Expression): boolean {
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression) ||
    ts.isTemplateExpression(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return true;
  }
  if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) {
    return true;
  }
  if (ts.isBinaryExpression(expression)) {
    return (
      expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken &&
      expression.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
      expression.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken &&
      expression.operatorToken.kind !== ts.SyntaxKind.CommaToken
    );
  }
  return false;
}

function appendMutationDocumentOpaqueExpression(
  opaque: MutationDocumentOpaqueInstance[],
  node: MutationDocumentExpressionNode,
  inheritedForm: MutationDocumentFormInstance | undefined,
  rootSpan: SourceSpan,
  project: MutationComponentProject,
): void {
  appendCompilerFact(
    opaque,
    {
      descendantClassified: false,
      diagnosticSpan: node.implementation.source === project.root ? node.span : rootSpan,
      inheritedForm,
      tag: 'JSX expression',
    },
    'Mutation document opaque expressions',
  );
}

function mutationDocumentFormIsTyped(
  source: MutationComponentSource,
  form: JsxElementModel,
  options: StructuralJsxLoweringOptions,
): boolean {
  const binding = enhancedMutationFormBinding(form);
  return (
    binding !== null &&
    localMutationKey(source.model, binding.localName, options.registryFacts, source.fileName) !==
      null
  );
}

function mutationDocumentElementIsSuccessfulControl(element: JsxElementModel): boolean {
  return (
    isIntrinsicHtmlElement(element, 'button') ||
    isIntrinsicHtmlElement(element, 'input') ||
    isIntrinsicHtmlElement(element, 'select') ||
    isIntrinsicHtmlElement(element, 'textarea')
  );
}

function mutationDocumentAttribute(
  element: JsxElementModel,
  name: string,
): JsxAttributeModel | undefined {
  const attributes = compilerSnapshotDenseArray(element.attributes, 'Mutation document attributes');
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (compilerStringToLowerCase(attribute.name) === name) return attribute;
  }
  return undefined;
}

function documentStaticAttributeString(attribute: JsxAttributeModel | undefined): string | null {
  if (attribute === undefined || mutationFormControlIsStaticallyAbsent(attribute)) return null;
  if (attribute.value !== undefined) return attribute.value;
  return typeof attribute.expressionStaticValue === 'string'
    ? attribute.expressionStaticValue
    : null;
}

function documentStaticFormAssociationString(
  attribute: JsxAttributeModel | undefined,
): string | null {
  const value = documentStaticAttributeString(attribute);
  return value !== null && formAssociationValueIsHtmlWireStable(value) ? value : null;
}

function documentControlFormAttribute(
  control: MutationDocumentControlInstance,
): JsxAttributeModel | undefined {
  const attribute = control.formAttribute;
  return attribute === undefined || mutationFormControlIsStaticallyAbsent(attribute)
    ? undefined
    : attribute;
}

function mutationDocumentControlHasFormAssociation(
  control: MutationDocumentControlInstance,
): boolean {
  return (
    documentControlFormAttribute(control) !== undefined || control.formSpreadAssociation !== null
  );
}

function mutationDocumentControlHasDefiniteFormAssociation(
  control: MutationDocumentControlInstance,
): boolean {
  return (
    documentControlFormAttribute(control) !== undefined || control.formSpreadAssociation === 'known'
  );
}

function mutationDocumentControlSpreadAssociation(
  element: JsxElementModel,
): 'known' | 'possible' | null {
  const spreads = compilerSnapshotDenseArray(
    element.spreadAttributes,
    'Mutation document control spreads',
  );
  let result: 'possible' | null = null;
  for (let spreadIndex = 0; spreadIndex < spreads.length; spreadIndex += 1) {
    const spread = spreads[spreadIndex]!;
    const names = compilerSnapshotDenseArray(
      spread.mutationFormControlNames ?? [],
      'Mutation document spread control names',
    );
    for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      if (mutationSubmitterTransportAttributeName(names[nameIndex]!) === 'form') return 'known';
    }
    // Only a complete inline object literal proves the absence of a `form` property. Identifier
    // aliases remain mutable at render time, and calls/dynamic spreads have no closed key census.
    if (spread.objectEntries === undefined || spread.expressionIsBareIdentifier === true) {
      result = 'possible';
    }
  }
  return result;
}

function mutationDocumentControlOwner(
  census: MutationDocumentCensus,
  control: MutationDocumentControlInstance,
): MutationDocumentFormInstance | undefined {
  if (control.formSpreadAssociation !== null) return undefined;
  const formAttribute = documentControlFormAttribute(control);
  if (formAttribute === undefined) return control.nearestForm;
  const formId = documentStaticFormAssociationString(formAttribute);
  if (formId === null || formId.length === 0) return undefined;
  const forms = compilerSnapshotDenseArray(census.forms, 'Mutation document owner forms');
  let owner: MutationDocumentFormInstance | undefined;
  for (let index = 0; index < forms.length; index += 1) {
    const form = forms[index]!;
    if (form.idIsDynamic) return undefined;
    if (form.id !== formId) continue;
    if (owner !== undefined) return undefined;
    owner = form;
  }
  return owner;
}

function mutationComponentImplementationIdentity(
  implementation: MutationComponentImplementation,
): string {
  return `${implementation.source.fileName}:${implementation.body.getStart(implementation.source.model.sourceFile)}`;
}

function mutationImplementationDisplayName(
  implementation: MutationComponentImplementation,
): string {
  const start = implementation.body.getStart(implementation.source.model.sourceFile);
  return `${implementation.source.fileName}:${start}`;
}

function inspectMutationComponent(
  from: MutationComponentSource,
  tag: string,
  rootSpan: { readonly end: number; readonly start: number },
  seen: Set<string>,
  project: MutationComponentProject,
  options: StructuralJsxLoweringOptions,
  diagnostics: CompilerDiagnostic[],
): void {
  if (compilerOwnedMutationFormHelper(from.model, tag)) return;
  const implementation = resolveMutationComponent(from, tag, project);
  if (implementation === null) {
    appendCompilerFact(
      diagnostics,
      mutationFormProvenanceDiagnostic(
        options,
        rootSpan,
        `component-rendered <${tag}> cannot be resolved to pinned source while nested in a typed mutation form`,
      ),
      'Unresolved mutation form component diagnostics',
    );
    return;
  }
  const identity = mutationComponentImplementationIdentity(implementation);
  if (compilerSetHas(seen, identity)) {
    appendCompilerFact(
      diagnostics,
      mutationFormProvenanceDiagnostic(
        options,
        rootSpan,
        `component-rendered <${tag}> has recursive output that cannot be proven free of mutation submitter overrides`,
      ),
      'Recursive mutation form component diagnostics',
    );
    return;
  }
  if (!componentBodyHasClosedJsxReturns(implementation.body)) {
    appendCompilerFact(
      diagnostics,
      mutationFormProvenanceDiagnostic(
        options,
        rootSpan,
        `component-rendered <${tag}> has an output path that is not statically resolvable JSX`,
      ),
      'Opaque mutation form component diagnostics',
    );
    return;
  }

  compilerSetAdd(seen, identity);
  const bodyStart = implementation.body.getStart(implementation.source.model.sourceFile);
  const bodyEnd = implementation.body.getEnd();
  const candidates = compilerSnapshotDenseArray(
    implementation.source.model.jsxElements,
    'Resolved mutation component JSX elements',
  );
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (candidate.start < bodyStart || candidate.end > bodyEnd) continue;
    if (candidate.intrinsicTagName === undefined) {
      inspectMutationComponent(
        implementation.source,
        candidate.tag,
        rootSpan,
        seen,
        project,
        options,
        diagnostics,
      );
      continue;
    }
    if (
      !isIntrinsicHtmlElement(candidate, 'button') &&
      !isIntrinsicHtmlElement(candidate, 'input')
    ) {
      continue;
    }
    const transport = mutationSubmitterDirectTransport(candidate);
    for (let overrideIndex = 0; overrideIndex < transport.overrides.length; overrideIndex += 1) {
      const attribute = transport.overrides[overrideIndex]!;
      appendCompilerFact(
        diagnostics,
        mutationFormProvenanceDiagnostic(
          options,
          implementation.source === project.root ? attribute : rootSpan,
          `component-rendered ${attribute.name} cannot override a typed mutation form transport; use a separate native form`,
        ),
        'Component mutation submitter diagnostics',
      );
    }
    const spreads = compilerSnapshotDenseArray(
      candidate.spreadAttributes,
      'Resolved mutation component submitter spreads',
    );
    for (let spreadIndex = 0; spreadIndex < spreads.length; spreadIndex += 1) {
      const spread = spreads[spreadIndex]!;
      const names = compilerSnapshotDenseArray(
        spread.mutationFormControlNames ?? [],
        'Resolved mutation component spread controls',
      );
      const overrides: string[] = [];
      for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
        const transportName = mutationSubmitterTransportAttributeName(names[nameIndex]!);
        if (transportName !== null && transportName !== 'form') {
          appendCompilerFact(overrides, names[nameIndex]!, 'Component submitter spread overrides');
        }
      }
      if (overrides.length === 0) continue;
      appendCompilerFact(
        diagnostics,
        mutationFormProvenanceDiagnostic(
          options,
          implementation.source === project.root ? spread : rootSpan,
          `component-rendered submitter spread cannot override typed mutation transport (${compilerArrayJoin(overrides, ', ')})`,
        ),
        'Component mutation submitter spread diagnostics',
      );
    }
  }
  compilerSetDelete(seen, identity);
}

function compilerOwnedMutationFormHelper(model: ComponentModuleModel, tag: string): boolean {
  const imports = compilerSnapshotDenseArray(model.namedImports, 'Mutation form helper imports');
  for (let index = 0; index < imports.length; index += 1) {
    const entry = imports[index]!;
    if (
      entry.localName === tag &&
      entry.moduleSpecifier === '@kovojs/core' &&
      (entry.importedName === 'FieldError' || entry.importedName === 'FormError')
    ) {
      return true;
    }
  }
  return false;
}

function resolveMutationComponent(
  from: MutationComponentSource,
  tag: string,
  project: MutationComponentProject,
): MutationComponentImplementation | null {
  if (compilerStringIncludes(tag, '.')) return null;
  const local = localMutationComponentImplementation(from, tag);
  if (local !== null) return local;

  const imports = compilerSnapshotDenseArray(from.model.namedImports, 'Mutation component imports');
  for (let index = 0; index < imports.length; index += 1) {
    const entry = imports[index]!;
    if (entry.localName !== tag || !compilerStringStartsWith(entry.moduleSpecifier, '.')) continue;
    const target = mutationComponentImportSource(from.fileName, entry.moduleSpecifier, project);
    if (target === null) return null;
    if (entry.importedName === 'default') return defaultMutationComponentImplementation(target);
    const localName = exportedMutationComponentLocalName(target, entry.importedName);
    return localName === null ? null : localMutationComponentImplementation(target, localName);
  }
  const statements = compilerSnapshotDenseArray(
    from.model.sourceFile.statements,
    'Mutation component default imports',
  );
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.name?.text !== tag ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !compilerStringStartsWith(statement.moduleSpecifier.text, '.')
    ) {
      continue;
    }
    const target = mutationComponentImportSource(
      from.fileName,
      statement.moduleSpecifier.text,
      project,
    );
    return target === null ? null : defaultMutationComponentImplementation(target);
  }
  return null;
}

function defaultMutationComponentImplementation(
  source: MutationComponentSource,
): MutationComponentImplementation | null {
  const statements = compilerSnapshotDenseArray(
    source.model.sourceFile.statements,
    'Default mutation component statements',
  );
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (
      ts.isFunctionDeclaration(statement) &&
      mutationComponentHasModifier(statement, ts.SyntaxKind.DefaultKeyword) &&
      mutationComponentHasExportModifier(statement) &&
      statement.body
    ) {
      return { body: statement.body, source };
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const body = mutationComponentBodyFromInitializer(source, statement.expression);
      if (body !== null) return { body, source };
    }
  }
  const localName = exportedMutationComponentLocalName(source, 'default');
  return localName === null ? null : localMutationComponentImplementation(source, localName);
}

function localMutationComponentImplementation(
  source: MutationComponentSource,
  localName: string,
): MutationComponentImplementation | null {
  const statements = compilerSnapshotDenseArray(
    source.model.sourceFile.statements,
    'Mutation component source statements',
  );
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === localName &&
      statement.body
    ) {
      return { body: statement.body, source };
    }
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = compilerSnapshotDenseArray(
      statement.declarationList.declarations,
      'Mutation component declarations',
    );
    for (let index = 0; index < declarations.length; index += 1) {
      const declaration = declarations[index]!;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== localName) continue;
      const body = mutationComponentBodyFromInitializer(source, declaration.initializer);
      return body === null ? null : { body, source };
    }
  }
  return null;
}

function mutationComponentBodyFromInitializer(
  source: MutationComponentSource,
  initializer: ts.Expression | undefined,
): ts.ConciseBody | null {
  if (initializer === undefined) return null;
  const expression = unwrapMutationComponentExpression(initializer);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return expression.body;
  if (
    !ts.isCallExpression(expression) ||
    !expressionResolvesToFrameworkExport(
      ts as FrameworkIdentityTypeScript,
      source.model.sourceFile,
      expression.expression,
      KOVO_COMPONENT_IDENTITY,
      { legacyGlobals: [KOVO_COMPONENT_IDENTITY] },
    )
  ) {
    return null;
  }
  const options = expression.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return null;
  const properties = compilerSnapshotDenseArray(options.properties, 'Component render properties');
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]!;
    if (
      !ts.isPropertyAssignment(property) ||
      property.name.getText(source.model.sourceFile) !== 'render'
    ) {
      continue;
    }
    const render = unwrapMutationComponentExpression(property.initializer);
    return ts.isArrowFunction(render) || ts.isFunctionExpression(render) ? render.body : null;
  }
  return null;
}

function unwrapMutationComponentExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function componentBodyHasClosedJsxReturns(body: ts.ConciseBody): boolean {
  if (!ts.isBlock(body)) return componentReturnExpressionIsClosed(body);
  let closed = true;
  const visit = (node: ts.Node): void => {
    if (!closed) return;
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) {
      if (node.expression !== undefined && !componentReturnExpressionIsClosed(node.expression)) {
        closed = false;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return closed;
}

function componentReturnExpressionIsClosed(expression: ts.Expression): boolean {
  const value = unwrapMutationComponentExpression(expression);
  if (
    ts.isJsxElement(value) ||
    ts.isJsxSelfClosingElement(value) ||
    ts.isJsxFragment(value) ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value)
  ) {
    return true;
  }
  if (ts.isConditionalExpression(value)) {
    return (
      componentReturnExpressionIsClosed(value.whenTrue) &&
      componentReturnExpressionIsClosed(value.whenFalse)
    );
  }
  if (ts.isArrayLiteralExpression(value)) {
    const elements = compilerSnapshotDenseArray(value.elements, 'Component return array');
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) return false;
      if (!componentReturnExpressionIsClosed(element)) return false;
    }
    return true;
  }
  return false;
}

function exportedMutationComponentLocalName(
  source: MutationComponentSource,
  exportedName: string,
): string | null {
  const statements = compilerSnapshotDenseArray(
    source.model.sourceFile.statements,
    'Exported mutation component statements',
  );
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index]!;
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === exportedName &&
      mutationComponentHasExportModifier(statement)
    ) {
      return exportedName;
    }
    if (ts.isVariableStatement(statement) && mutationComponentHasExportModifier(statement)) {
      const declarations = compilerSnapshotDenseArray(
        statement.declarationList.declarations,
        'Exported mutation component declarations',
      );
      for (
        let declarationIndex = 0;
        declarationIndex < declarations.length;
        declarationIndex += 1
      ) {
        const declaration = declarations[declarationIndex]!;
        if (ts.isIdentifier(declaration.name) && declaration.name.text === exportedName) {
          return exportedName;
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const elements = compilerSnapshotDenseArray(
        statement.exportClause.elements,
        'Mutation component export specifiers',
      );
      for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
        const element = elements[elementIndex]!;
        if (element.name.text === exportedName) return element.propertyName?.text ?? exportedName;
      }
    }
  }
  return null;
}

function mutationComponentHasExportModifier(node: ts.Node): boolean {
  return mutationComponentHasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function mutationComponentHasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = (node as { readonly modifiers?: readonly ts.Modifier[] }).modifiers;
  if (modifiers === undefined) return false;
  const snapshot = compilerSnapshotDenseArray(modifiers, 'Mutation component modifiers');
  for (let index = 0; index < snapshot.length; index += 1) {
    if (snapshot[index]!.kind === kind) return true;
  }
  return false;
}

function mutationComponentImportSource(
  fromFileName: string,
  specifier: string,
  project: MutationComponentProject,
): MutationComponentSource | null {
  const parts = compilerStringSplit(fromFileName, '/');
  const directoryParts: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    appendCompilerFact(directoryParts, parts[index]!, 'Mutation component import directory');
  }
  const target = normalizeComponentFileName(
    `${compilerArrayJoin(directoryParts, '/')}/${specifier}`,
  );
  const targetStem = mutationComponentSourceStem(target);
  const files = compilerSnapshotDenseArray(project.files, 'Mutation component project sources');
  const exact: MutationComponentSource[] = [];
  const directStem: MutationComponentSource[] = [];
  const indexStem: MutationComponentSource[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]!;
    if (compilerRegExpTest(/\.d\.[cm]?[jt]sx?$/i, file.fileName)) continue;
    const fileStem = mutationComponentSourceStem(file.fileName);
    if (file.fileName === target) {
      appendCompilerFact(exact, file, 'Exact mutation component import sources');
    } else if (fileStem === targetStem) {
      appendCompilerFact(directStem, file, 'Direct-stem mutation component import sources');
    } else if (fileStem === `${targetStem}/index`) {
      appendCompilerFact(indexStem, file, 'Index mutation component import sources');
    }
  }
  if (exact.length > 0) return exact.length === 1 ? exact[0]! : null;
  if (directStem.length > 0) return directStem.length === 1 ? directStem[0]! : null;
  return indexStem.length === 1 ? indexStem[0]! : null;
}

function mutationComponentSourceStem(fileName: string): string {
  return compilerRegExpReplace(/(?:\.d)?\.[cm]?[jt]sx?$/i, fileName, '');
}

function removeJsxIrSourceAttribute(
  element: JsxIrElement,
  source: JsxAttributeModel | JsxElementModel['spreadAttributes'][number],
): void {
  const retained: JsxIrAttribute[] = [];
  const attributes = compilerSnapshotDenseArray(
    element.attributes,
    'Mutation form retained IR attributes',
  );
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes[index]!;
    if (attribute.source !== source) {
      appendCompilerFact(retained, attribute, 'Mutation form retained IR attributes');
    }
  }
  if (retained.length === attributes.length) return;
  element.attributes = retained;
  markJsxIrChanged(element);
}

function mutationFormControlIsStaticallyAbsent(attribute: JsxAttributeModel): boolean {
  return attribute.expressionStaticValue === false || attribute.expressionStaticValue === null;
}

function mutationFormProvenanceDiagnostic(
  options: StructuralJsxLoweringOptions,
  span: { end: number; start: number },
  detail: string,
): CompilerDiagnostic {
  return {
    ...diagnosticFor(options.fileName, 'KV242', options.source, span.start, span.end - span.start),
    message: `${diagnosticDefinitions.KV242.message} ${detail}`,
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
    if (element.element.intrinsicTagName === undefined) continue;
    const transportBoundary = isIntrinsicHtmlElement(element.element, 'form')
      ? enhancedMutationFormBinding(element.element) === null
        ? undefined
        : 'mutation-form'
      : isIntrinsicHtmlElement(element.element, 'button') ||
          isIntrinsicHtmlElement(element.element, 'input')
        ? 'mutation-submitter'
        : undefined;
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
      if (isMutationFormAttributesSpread(source)) continue;

      const expression =
        transportBoundary === undefined
          ? `...kovoSafeJsxSpread(${source.expression})`
          : `...kovoSafeJsxSpread(${source.expression}, '${transportBoundary}')`;
      attribute.name = expression;
      attribute.value = {
        kind: 'expression',
        source: expression,
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
  let attribute = findSourceAttribute(element.element.attributes, name, 'Static source attributes');
  if (!attribute && element.element.intrinsicTagName !== undefined) {
    const attributes = compilerSnapshotDenseArray(
      element.element.attributes,
      'Static intrinsic source attributes',
    );
    for (let index = 0; index < attributes.length; index += 1) {
      const candidate = attributes[index]!;
      if (compilerStringToLowerCase(candidate.name) === name) {
        attribute = candidate;
        break;
      }
    }
  }
  if (!attribute) return null;
  if (attribute.value !== undefined) return attribute.value;
  return staticStringValue(attribute.expressionStaticValue);
}

/**
 * Return a form-owner identity only when the authored UTF-16 string survives SSR byte encoding
 * and HTML input preprocessing unchanged. SPEC §§5.2, 6.3, and 9.1 make form ownership part of
 * the compiler proof: U+0000, CR/CRLF, and lone surrogates must not compare as distinct in source
 * and then collapse onto another form id in the browser.
 */
function staticFormAssociationString(element: JsxIrElement, name: string): string | null {
  const value = staticAttributeString(element, name);
  return value !== null && formAssociationValueIsHtmlWireStable(value) ? value : null;
}

function formAssociationValueIsHtmlWireStable(value: string): boolean {
  return isHtmlWireValueStable(value, 'dom-identity');
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
 * only from an element's `childExpressionContainers`, never from author attribute expressions,
 * and records that source owner before primitive composition can move the IR child. Preserve the
 * flat-root recursive traversal, including duplicate nested occurrences and order.
 */
function expressionChildren(elements: readonly JsxIrElement[]): MixedTextExpressionChild[] {
  const result: MixedTextExpressionChild[] = [];
  const visit = (child: JsxIrChild): void => {
    if (child.kind === 'expression') {
      appendCompilerFact(
        result,
        { containingElement: child.containingElement, expression: child },
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
