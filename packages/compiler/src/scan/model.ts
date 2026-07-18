import type * as ts from 'typescript';
import type {
  BrowserSecurityOperationKind,
  SecurityOperationDoor,
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import type { StaticLiteralValue } from './object.js';

export interface ComponentOptionEntry {
  end: number;
  justifiedDiagnostics?: readonly string[];
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
  /** Parser-decoded string literal value; consumers must not re-parse escape sequences. */
  staticStringValue?: string;
  value?: string;
  valuePropertyAccesses?: readonly PropertyAccessPathModel[];
}

export type StaticJsxWireAttributeValue =
  | { readonly kind: 'known'; readonly value: StaticLiteralValue | undefined }
  | { readonly kind: 'unknown' };

/**
 * Parser-owned fact for a statically enumerable JSX spread entry at the HTML wire boundary.
 * The discriminated value preserves known `undefined` separately from a runtime-dynamic value.
 * This fact is separate from {@link ObjectLiteralEntry}: nested object spreads can be complete
 * enough for a security verdict without being eligible for static spread lowering (SPEC §5.2
 * rule 10 / §13.2).
 */
export interface StaticJsxWireAttributeEntry {
  key: string;
  value: StaticJsxWireAttributeValue;
}

export type HandlerWriteSinkSurface = 'endpoint' | 'mutation' | 'task' | 'webhook';

export type HandlerWriteSinkOperationKind =
  | 'batch'
  | 'delete'
  | 'execute'
  | 'insert'
  | 'put'
  | 'raw-driver-escape'
  | 'run'
  | 'store'
  | 'update'
  | 'UNRESOLVED';

export type HandlerWriteSinkTargetProvenance =
  | 'computed-member'
  | 'property-access-path'
  | 'unresolved-property-access';

export interface HandlerWriteSinkOwner {
  kind: 'key' | 'path';
  value: string;
}

export interface HandlerWriteSinkTarget {
  identity: string;
  provenance: HandlerWriteSinkTargetProvenance;
}

export interface HandlerWriteSinkFact {
  canonicalTarget: HandlerWriteSinkTarget;
  operationKind: HandlerWriteSinkOperationKind;
  owner: HandlerWriteSinkOwner;
  path: string;
  span: SourceSpan;
  surface: HandlerWriteSinkSurface;
}

export interface WebhookRecordChangeFact {
  declaredWriteKeys: readonly string[];
  domainKey: string;
  owner: HandlerWriteSinkOwner;
  span: SourceSpan;
}

export interface MutationHandlerModel {
  body: string;
  bodyEnd: number;
  handlerWriteSinks?: readonly HandlerWriteSinkFact[];
  /** Static SPEC §6.6/KV418 provenance: the handler can use browser authority. */
  readsAmbientCookie?: true;
  /** Collision-resistant identity tying source authority proof to the runtime handler. */
  authorityFingerprint?: string;
  /** Source-derived mutation key for graph session-authority facts. */
  mutationOwner?: HandlerWriteSinkOwner;
  webhookRecordChanges?: readonly WebhookRecordChangeFact[];
  bodyPropertyAccesses: readonly PropertyAccessPathModel[];
  bodyStart: number;
  paramNames: readonly (string | undefined)[];
  params: readonly string[];
  paramSpans: readonly SourceSpan[];
  securityOperations?: readonly ServerSecurityOperationModel[];
  securityOperationViolations?: readonly SecurityOperationViolationModel[];
}

export interface BrowserSecurityOperationModel {
  door: SecurityOperationDoor;
  kind: BrowserSecurityOperationKind;
  span: SourceSpan;
  target?: string;
}

export interface ServerSecurityOperationModel {
  door: SecurityOperationDoor;
  justification?: string;
  kind: ServerSecurityOperationKind;
  span: SourceSpan;
  target?: string;
}

export interface SecurityOperationViolationModel {
  detail: string;
  kind:
    | 'computed-security-operation'
    | 'incomplete-mutation-form'
    | 'raw-capability-operation'
    | 'raw-dom-operation'
    | 'unknown-security-operation';
  span: SourceSpan;
  surface: HandlerWriteSinkSurface | 'browser';
}

export interface TaskRunHandlerModel extends MutationHandlerModel {
  cron?: string;
  key: string;
  runMutationEdges: readonly string[];
  runQueryEdges: readonly string[];
  scheduleEdges: readonly string[];
}

export interface WebhookHandlerModel extends MutationHandlerModel {
  declaredWriteKeys: readonly string[];
  owner: HandlerWriteSinkOwner;
  runMutationEdges: readonly string[];
}

export interface PropertyAccessPathModel {
  end: number;
  inferredType?: 'boolean' | 'number';
  path: string;
  start: number;
  terminalName: string;
}

export interface ConditionalExpressionModel {
  condition: string;
  conditionEnd: number;
  conditionPropertyAccesses: readonly PropertyAccessPathModel[];
  conditionStart: number;
  end: number;
  start: number;
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
  /** Parser-owned exact framework factory identity; a same-named local function never receives it. */
  frameworkFactory?: 'endpoint' | 'mutation' | 'task' | 'webhook';
  /** Exact framework identity for a security helper whose call shape participates in finite IR. */
  frameworkSecurityOperation?: 'csrf-field' | 'csrf-token';
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
  localConstAliases: readonly LocalConstAliasModel[];
  localNames: readonly string[];
  propertyAccesses: readonly PropertyAccessPathModel[];
  references: readonly string[];
  solePropertyAccessPath?: string;
  start: number;
  /** Parser-owned literal value for static JSX-child output validation. */
  staticValue?: StaticLiteralValue;
  temporalReads: readonly TemporalReadModel[];
}

export interface LocalConstAliasModel {
  accesses: readonly PropertyAccessPathModel[];
  expression: string;
  name: string;
  references: readonly string[];
  start: number;
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
  /** Parser-owned proof that this DOM-style `onX` attribute is attached to a component tag. */
  componentEventProp?: true;
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
  expressionConditionalFacts?: readonly ConditionalExpressionModel[];
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
  /** Known top-level DOM-style `onX` keys spread onto a component tag. */
  componentEventPropNames?: readonly string[];
  end: number;
  expression: string;
  expressionCallArgumentBareIdentifierName?: string;
  expressionCallImportedName?: string;
  expressionCallModuleSpecifier?: string;
  expressionCallName?: string;
  expressionBareIdentifierName?: string;
  expressionIsBareIdentifier?: boolean;
  /**
   * SPEC §5.2 typed parser fact for statically visible mutation-control/transport names carried by
   * this spread, including incomplete object literals and module-scope aliases. Lowering consumes
   * this instead of re-reading spread expression text after parse.
   */
  mutationFormControlNames?: readonly string[];
  objectEntries?: readonly ObjectLiteralEntry[];
  start: number;
  /** Complete parser-owned entries used only by cross-attribute HTML wire classifiers. */
  staticWireAttributeEntries?: readonly StaticJsxWireAttributeEntry[];
}

export interface JsxElementModel {
  ancestorTags: readonly string[];
  attributes: readonly JsxAttributeModel[];
  childBody: JsxElementChildBody | null;
  childExpressionContainers: readonly SourceSpan[];
  childNonWhitespaceCount: number;
  closingStart: number;
  end: number;
  /**
   * ASCII-folded intrinsic tag identity. Absent for lexical component references, including
   * PascalCase identifiers and member expressions, so HTML case folding cannot turn a component
   * into a framework-owned host boundary.
   */
  intrinsicTagName?: string;
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
  securityOperations?: readonly BrowserSecurityOperationModel[];
  securityOperationViolations?: readonly SecurityOperationViolationModel[];
}

export interface ComponentModel {
  declarationEnd: number;
  localName?: string;
  localNameSpan?: SourceSpan;
  options: readonly ComponentOptionEntry[];
  renderHost?: RenderHostModel;
  renderInputs: readonly RenderInputModel[];
  renderLocalNames: readonly string[];
  renderSlots?: RenderSlotsModel;
  renderSlotsParam?: RenderInputModel;
  stateReturnObject?: StateReturnObjectModel;
  stringRenderReturns?: readonly StringRenderModel[];
}

/** Compiler-owned source-derived component identity assignment observed in module source. */
export interface ComponentIdentityAssignmentModel {
  end: number;
  start: number;
  target: string;
  value: string;
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
  sourceKey?: string;
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
  componentIdentityAssignments: readonly ComponentIdentityAssignmentModel[];
  components: readonly ComponentModel[];
  endpointHandlers: readonly MutationHandlerModel[];
  jsxComments: readonly JsxCommentModel[];
  jsxExpressions: readonly JsxExpressionModel[];
  jsxElements: readonly JsxElementModel[];
  moduleScopeBindings: readonly ModuleScopeBindingModel[];
  moduleSpecifiers: readonly ModuleSpecifierModel[];
  mutationHandlers: readonly MutationHandlerModel[];
  namedImports: readonly NamedImportModel[];
  renderSourceReturns: readonly StringRenderModel[];
  taskRunHandlers: readonly TaskRunHandlerModel[];
  webhookHandlers: readonly WebhookHandlerModel[];
  /**
   * @internal FN7: the scanner's own parsed `ts.SourceFile`, retained so phases like StyleX
   * extraction reuse it instead of re-parsing the component. Non-enumerable so the model stays a
   * serializable fact bag (it is never JSON.stringified/hashed; this keeps it that way).
   */
  readonly sourceFile: ts.SourceFile;
}
