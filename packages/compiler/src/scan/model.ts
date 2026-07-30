import type * as ts from 'typescript';
import type { CacheInfluenceDerivationInput } from '@kovojs/core/internal/cache-influence';
import type {
  BrowserSecurityOperationKind,
  SecurityOperationDoor,
  SecuritySemanticRoot,
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
  /** Parser-owned structural facts for query-binding consumers; never re-derived from `value`. */
  queryBinding?: QueryBindingModel;
  staticConstructorType?: 'boolean' | 'number' | 'string';
  /** Parser-decoded string literal value; consumers must not re-parse escape sequences. */
  staticStringValue?: string;
  value?: string;
  valuePropertyAccesses?: readonly PropertyAccessPathModel[];
}

export interface QueryBindingModel {
  argsExpression?: string;
  argsParam?: string;
  argsPropertyAccesses?: readonly string[];
  /** Parser-owned verdict: the query expression is an executable identifier/member/call chain. */
  executable: boolean;
  hasRefresh?: boolean;
  /** Readable runtime query reference, absent for object-literal query keys. */
  queryKeyExpression?: string;
  /** Scanner-owned exact span of the runtime query reference in the authoritative source AST. */
  queryKeySpan?: SourceSpan;
  queryExpression: string;
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
export type SecurityOperationSurface = HandlerWriteSinkSurface | 'agent' | 'query';

export interface AgentToolModel {
  binding: string;
  callSpan: SourceSpan;
  mutationBinding?: string;
  mutationBindingSpan?: SourceSpan;
  name?: string;
  resultIntegrity: 'retrieved' | 'untrusted';
  violations?: readonly SecurityOperationViolationModel[];
}

export interface AgentToolReferenceModel {
  binding: string;
  span: SourceSpan;
}

export interface AgentDefinitionModel {
  binding?: string;
  callSpan: SourceSpan;
  modelHandler: MutationHandlerModel;
  name: string;
  toolBindings: readonly AgentToolReferenceModel[];
}

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
  /** Compiler-owned request/cache-axis facts for one finite query or endpoint root. */
  cacheInfluence?: CacheInfluenceDerivationInput;
  paramNames: readonly (string | undefined)[];
  params: readonly string[];
  paramSpans: readonly SourceSpan[];
  securityOperations?: readonly ServerSecurityOperationModel[];
  securityOperationViolations?: readonly SecurityOperationViolationModel[];
  securitySemanticRoot?: SecuritySemanticRoot;
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
  root?: string;
  span: SourceSpan;
  target?: string;
}

export interface SecurityOperationViolationModel {
  detail: string;
  kind:
    | 'computed-security-operation'
    | 'derived-dataset-scope'
    | 'governed-data-persistence'
    | 'incomplete-mutation-form'
    | 'raw-capability-operation'
    | 'raw-dom-operation'
    | 'unscoped-state-key'
    | 'unknown-security-operation';
  span: SourceSpan;
  surface: SecurityOperationSurface | 'browser' | 'route';
}

export interface TaskRunHandlerModel extends MutationHandlerModel {
  callSpan: SourceSpan;
  cron?: string;
  key: string;
  runMutationEdges: readonly TaskCompositionEdgeModel[];
  runQueryEdges: readonly TaskCompositionEdgeModel[];
  scheduleEdges: readonly TaskCompositionEdgeModel[];
}

export interface WebhookHandlerModel extends MutationHandlerModel {
  declaredWriteKeys: readonly string[];
  owner: HandlerWriteSinkOwner;
  runMutationEdges: readonly string[];
}

export interface TaskCompositionEdgeModel {
  span: SourceSpan;
  target: string;
}

export interface PropertyAccessPathModel {
  /** Parser-owned positive proof that this exact handler use is scalar-only. */
  elementParamEligible?: boolean;
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
  /** Parser-owned positive proof that this exact handler use is scalar-only. */
  elementParamEligible?: boolean;
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
  /** Parser-owned derive input facts; post-parse phases must not reparse `arguments`. */
  deriveInputs?: DeriveInputsModel;
  end: number;
  exportedConstName?: string;
  /** Parser-owned exact framework factory identity; a same-named local function never receives it. */
  frameworkFactory?:
    | 'agent'
    | 'domain'
    | 'endpoint'
    | 'mutation'
    | 'query'
    | 'task'
    | 'tool'
    | 'webhook';
  /** Exact framework identity for a security helper whose call shape participates in finite IR. */
  frameworkSecurityOperation?: 'csrf-field' | 'csrf-token';
  /** Exact compiler JSX-runtime constructor identity; app source may not call this emitted ABI. */
  frameworkJsxRuntimeFactory?: 'createElement' | 'jsx' | 'jsxDEV' | 'jsxs';
  name: string;
  start: number;
}

export interface DeriveInputEntryModel {
  /** Callback-local key for object-map derives. */
  alias?: string;
  input: string;
  kind: 'clock' | 'generated' | 'query' | 'state';
}

export interface DeriveInputsModel {
  entries: readonly DeriveInputEntryModel[];
  form: 'object' | 'tuple';
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

/** Parser-owned JSX transform directive found inside an actual source comment. */
export interface JsxPragmaModel {
  end: number;
  kind: 'jsx' | 'jsxFrag' | 'jsxImportSource' | 'jsxRuntime';
  start: number;
  value?: string;
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
  /**
   * Parser-owned proof that this tag is an exact, unshadowed, unmutated value import of the
   * reviewed `@kovojs/ui/button` Button. Mutation-form lowering consumes this closed verdict
   * instead of rediscovering import or binding provenance from the source AST (SPEC §5.2 rule 10).
   */
  reviewedMutationSubmitter?: true;
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

export type HandlerBodyTypeScriptErasureKind =
  | 'as-assertion'
  | 'implements-clause'
  | 'non-null-assertion'
  | 'optional-marker'
  | 'satisfies-clause'
  | 'this-parameter'
  | 'type-annotation'
  | 'type-arguments'
  | 'type-assertion'
  | 'type-modifier'
  | 'type-only-declaration'
  | 'type-parameters';

/** Parser-owned TypeScript-only source that must not cross into an emitted JavaScript handler. */
export interface HandlerBodyTypeScriptErasureModel extends SourceSpan {
  kind: HandlerBodyTypeScriptErasureKind;
}

export type UnsupportedHandlerBodyTypeScriptKind =
  | 'accessor-field'
  | 'ambient-declaration'
  | 'decorator'
  | 'enum-declaration'
  | 'function-signature'
  | 'import-equals-declaration'
  | 'jsx-expression'
  | 'module-syntax'
  | 'namespace-declaration'
  | 'parameter-property'
  | 'unclassified-typescript'
  | 'uninitialized-const'
  | 'using-declaration';

/** Runtime-bearing TypeScript syntax that cannot be represented by source erasure alone. */
export interface UnsupportedHandlerBodyTypeScriptModel extends SourceSpan {
  kind: UnsupportedHandlerBodyTypeScriptKind;
}

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
  /** Roots withheld when a scalar-safe candidate has any unproved executable sibling use. */
  bodyElementParamUnsafeRoots?: readonly string[];
  bodyPropertyAccesses: readonly PropertyAccessPathModel[];
  bodyReferences: readonly IdentifierReferenceModel[];
  bodyStart: number;
  bodySourceStart: number;
  bodyTypeScriptErasures: readonly HandlerBodyTypeScriptErasureModel[];
  bodyUnsupportedTypeScript: readonly UnsupportedHandlerBodyTypeScriptModel[];
  callArguments?: readonly string[];
  documentElementAction?: DocumentElementActionModel;
  references: readonly string[];
  /** Roots that cannot inhabit a sync wrapper are retained for diagnostics but omitted at runtime. */
  runtimeOmitted?: true;
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
  /** First parser-proven value that cannot inhabit JsonValue (SPEC §4.3). */
  nonJsonValueSpan?: SourceSpan;
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

/** Parser-owned value import/re-export of the compiler JSX-runtime ABI. */
export interface CompilerJsxRuntimeImportModel {
  end: number;
  factories: readonly ('createElement' | 'jsx' | 'jsxDEV' | 'jsxs' | '*')[];
  specifier: '@kovojs/server/jsx-dev-runtime' | '@kovojs/server/jsx-runtime';
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
  agentDefinitions: readonly AgentDefinitionModel[];
  agentHandlers: readonly MutationHandlerModel[];
  agentTools: readonly AgentToolModel[];
  calls: readonly CallExpressionModel[];
  compilerJsxRuntimeImports: readonly CompilerJsxRuntimeImportModel[];
  componentIdentityAssignments: readonly ComponentIdentityAssignmentModel[];
  components: readonly ComponentModel[];
  endpointHandlers: readonly MutationHandlerModel[];
  jsxComments: readonly JsxCommentModel[];
  jsxExpressions: readonly JsxExpressionModel[];
  jsxElements: readonly JsxElementModel[];
  /** @internal Non-enumerable parser facts; security consumers must not rescan source comments. */
  readonly jsxPragmas: readonly JsxPragmaModel[];
  moduleScopeBindings: readonly ModuleScopeBindingModel[];
  /** Parser-owned byte offset after the preamble and parsed imports for generated value imports. */
  moduleImportInsertionOffset: number;
  moduleSpecifiers: readonly ModuleSpecifierModel[];
  mutationHandlers: readonly MutationHandlerModel[];
  namedImports: readonly NamedImportModel[];
  queryHandlers: readonly MutationHandlerModel[];
  renderSourceReturns: readonly StringRenderModel[];
  /** @internal Non-enumerable parser facts used to choose collision-free generated bindings. */
  readonly sourceIdentifierNames: readonly string[];
  taskRunHandlers: readonly TaskRunHandlerModel[];
  webhookHandlers: readonly WebhookHandlerModel[];
  /**
   * @internal FN7: the scanner's own parsed `ts.SourceFile`, retained so phases like StyleX
   * extraction reuse it instead of re-parsing the component. Non-enumerable so the model stays a
   * serializable fact bag (it is never JSON.stringified/hashed; this keeps it that way).
   */
  readonly sourceFile: ts.SourceFile;
}
