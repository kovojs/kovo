import type * as ts from 'typescript';

import type { StaticLiteralValue } from './object.js';

export interface ComponentOptionEntry {
  end: number;
  key: string;
  objectEntries?: readonly ObjectLiteralEntry[];
  start: number;
  staticValue?: StaticLiteralValue;
  staticTemplateValue?: string;
}

export interface ObjectLiteralEntry {
  key: string;
  objectEntries?: readonly ObjectLiteralEntry[];
  staticConstructorType?: 'boolean' | 'number' | 'string';
  value?: string;
  valuePropertyAccesses?: readonly PropertyAccessPathModel[];
}

export interface MutationHandlerModel {
  body: string;
  bodyEnd: number;
  bodyPropertyAccesses: readonly PropertyAccessPathModel[];
  bodyStart: number;
  paramNames: readonly (string | undefined)[];
  params: readonly string[];
  paramSpans: readonly SourceSpan[];
}

export interface PropertyAccessPathModel {
  end: number;
  inferredType?: 'boolean' | 'number';
  path: string;
  start: number;
  terminalName: string;
}

export interface TemporalReadModel {
  end: number;
  kind: 'Date.now' | 'new Date';
  start: number;
}

export interface IdentifierReferenceModel {
  end: number;
  name: string;
  start: number;
}

export interface DocumentElementActionModel {
  action: 'method' | 'toggle-open';
  method?: string;
  target: string;
}

export interface CallExpressionModel {
  arguments: readonly string[];
  argumentArrowFunctionParts: readonly (ArrowFunctionPartsModel | null)[];
  argumentObjectLiteralPaths: readonly (readonly string[])[];
  argumentPropertyAccesses: readonly (readonly PropertyAccessPathModel[])[];
  argumentSpans: readonly SourceSpan[];
  argumentStringLiteralArrayValues: readonly (readonly string[] | null)[];
  argumentStaticValues: readonly (StaticLiteralValue | undefined)[];
  argumentTemporalReads: readonly (readonly TemporalReadModel[])[];
  end: number;
  exportedConstName?: string;
  name: string;
  start: number;
}

export interface ArrowFunctionPartsModel {
  expression: string;
  param: string;
  params: readonly string[];
}

export interface SourceSpan {
  end: number;
  start: number;
}

export interface JsxExpressionModel {
  callName?: string;
  containerEnd: number;
  containerStart: number;
  end: number;
  expression: string;
  propertyAccesses: readonly PropertyAccessPathModel[];
  references: readonly string[];
  solePropertyAccessPath?: string;
  start: number;
  temporalReads: readonly TemporalReadModel[];
}

export interface JsxCommentModel {
  attachedAttributeStart?: number;
  end: number;
  // SPEC §5.2: typed parser fact for the diagnostic codes a comment justifies, so post-parse
  // phases consume model facts instead of re-scanning the raw comment text.
  justifiedDiagnostics?: readonly string[];
  start: number;
  text: string;
}

export interface JsxAttributeModel {
  domEventName?: string;
  end: number;
  executionTriggerName?: string;
  expression?: string;
  expressionEnd?: number;
  // SPEC §5.2: typed parser facts recording whether the attribute expression is a bare identifier
  // (e.g. `onClick={handleClick}`, including parenthesized/commented forms) and that identifier's
  // name, so lowering/emit never re-derive either from the raw snippet.
  expressionIsBareIdentifier?: boolean;
  expressionBareIdentifierName?: string;
  expressionObjectEntries?: readonly ObjectLiteralEntry[];
  expressionPropertyAccesses?: readonly PropertyAccessPathModel[];
  expressionReferences?: readonly string[];
  expressionStart?: number;
  expressionStaticValue?: StaticLiteralValue;
  leadingStart: number;
  name: string;
  start: number;
  value?: string;
  zeroArgArrow?: ZeroArgArrowModel;
}

export interface JsxSpreadAttributeModel {
  end: number;
  expression: string;
  expressionCallArgumentBareIdentifierName?: string;
  expressionCallName?: string;
  expressionBareIdentifierName?: string;
  expressionIsBareIdentifier?: boolean;
  objectEntries?: readonly ObjectLiteralEntry[];
  start: number;
}

export interface JsxElementModel {
  ancestorTags: readonly string[];
  attributes: readonly JsxAttributeModel[];
  childBody: JsxElementChildBody | null;
  childExpressionContainers: readonly SourceSpan[];
  childNonWhitespaceCount: number;
  closingStart: number;
  end: number;
  openingEnd: number;
  openingTagNameEnd: number;
  openingTagNameStart: number;
  repeatable: boolean;
  selfClosing: boolean;
  selfClosingSlashHasLeadingWhitespace: boolean;
  spreadAttributes: readonly JsxSpreadAttributeModel[];
  start: number;
  tag: string;
}

export interface JsxElementChildBody {
  offset: number;
  source: string;
}

export type ZeroArgArrowCallArgumentKind =
  | 'state'
  | 'empty'
  | 'reference'
  | 'member'
  | 'static'
  | 'other';

export interface ZeroArgArrowModel {
  body: string;
  bodyEnd: number;
  bodyKind: 'block' | 'expression';
  callArgumentReferences?: readonly (readonly IdentifierReferenceModel[])[];
  callArgumentPropertyAccesses?: readonly (readonly PropertyAccessPathModel[])[];
  callArgumentStaticValues?: readonly (StaticLiteralValue | undefined)[];
  // SPEC §5.2: per-call-argument typed kind computed from the ts arg nodes, so handler lowering
  // never re-derives element-param eligibility by comparing the raw argument source string.
  callArgumentKinds?: readonly ZeroArgArrowCallArgumentKind[];
  bodyLocalNames: readonly string[];
  bodyPropertyAccesses: readonly PropertyAccessPathModel[];
  bodyReferences: readonly IdentifierReferenceModel[];
  bodyStart: number;
  bodySourceStart: number;
  callArguments?: readonly string[];
  documentElementAction?: DocumentElementActionModel;
  references: readonly string[];
}

export interface ComponentModel {
  declarationEnd: number;
  localName?: string;
  localNameSpan?: SourceSpan;
  options: readonly ComponentOptionEntry[];
  renderHost?: RenderHostModel;
  renderInputs: readonly RenderInputModel[];
  renderSlots?: RenderSlotsModel;
  renderSlotsParam?: RenderInputModel;
  stateReturnObject?: StateReturnObjectModel;
  stringRenderReturns?: readonly StringRenderModel[];
}

// SPEC §4.5/§4.8: the render function's third parameter is the projected-children/named-slot
// channel (`(_, state, { children, footer })` or `(_, state, slots)`). KV316 keys off whether a
// component composes children/slots at all, independent of whether the param is destructured.
export interface RenderSlotsModel {
  end: number;
  names: readonly string[];
  start: number;
}

export interface RenderHostModel {
  end: number;
  start: number;
}

export interface RenderInputModel {
  end: number;
  name: string;
  start: number;
}

export interface StateReturnObjectModel {
  end: number;
  entries: readonly ObjectLiteralEntry[];
  staticValue?: Record<string, StaticLiteralValue>;
  start: number;
}

export interface StringRenderModel {
  end: number;
  firstHtmlTagName?: string;
  source: string;
  start: number;
}

export interface ModuleSpecifierModel {
  end: number;
  specifier: string;
  start: number;
}

export interface NamedImportModel {
  importedName: string;
  localName: string;
  moduleSpecifier: string;
}

export interface ModuleScopeBindingModel {
  name: string;
  source: string;
  staticValue: StaticLiteralValue;
}

export interface ComponentModuleModel {
  calls: readonly CallExpressionModel[];
  components: readonly ComponentModel[];
  jsxComments: readonly JsxCommentModel[];
  jsxExpressions: readonly JsxExpressionModel[];
  jsxElements: readonly JsxElementModel[];
  moduleScopeBindings: readonly ModuleScopeBindingModel[];
  moduleSpecifiers: readonly ModuleSpecifierModel[];
  mutationHandlers: readonly MutationHandlerModel[];
  namedImports: readonly NamedImportModel[];
  renderSourceReturns: readonly StringRenderModel[];
  /**
   * @internal FN7: the scanner's own parsed `ts.SourceFile`, retained so phases like StyleX
   * extraction reuse it instead of re-parsing the component. Non-enumerable so the model stays a
   * serializable fact bag (it is never JSON.stringified/hashed; this keeps it that way).
   */
  readonly sourceFile: ts.SourceFile;
}
