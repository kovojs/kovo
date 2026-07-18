import * as ts from 'typescript';

import {
  canonicalFrameworkExportForExpression,
  frameworkExport,
  frameworkExportEquals,
  type FrameworkExportIdentity,
  type FrameworkIdentityTypeScript,
} from '@kovojs/core/internal/framework-identity';
import { securityOperationDoorForKind } from '@kovojs/core/internal/security-operation-ir';
import type {
  BrowserSecurityOperationKind,
  SecuritySemanticBudgets,
  SecuritySemanticClosedReason,
  SecuritySemanticRoot,
  SecuritySemanticSummary,
  SecuritySemanticTrace,
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import {
  compilerArrayAppend,
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetDelete,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import type {
  BrowserSecurityOperationModel,
  SecurityOperationSurface,
  SecurityOperationViolationModel,
  ServerSecurityOperationModel,
} from './model.js';

interface SecurityOperationScanResult<Operation> {
  readonly operations: readonly Operation[];
  readonly semanticRoot?: SecuritySemanticRoot;
  readonly violations: readonly SecurityOperationViolationModel[];
}

/** Parser/scanner-shared exact same-file root or helper callable. */
export interface ResolvedSecurityIrCallable {
  readonly body: ts.ConciseBody;
  readonly declaration: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;
  readonly name: string;
  readonly parameters: ts.NodeArray<ts.ParameterDeclaration>;
}

type BrowserValueProvenance =
  | 'dom'
  | 'event'
  | 'form'
  | 'local'
  | 'raw-browser'
  | 'state'
  | 'unknown'
  | 'unknown-authority'
  | `operation:${BrowserSecurityOperationKind}`;
type ServerValueProvenance =
  | 'context'
  | 'database'
  | 'headers'
  | 'local'
  | 'respond'
  | 'request'
  | 'response-constructor'
  | 'safe-call'
  | 'scope-call'
  | 'storage'
  | 'unknown-authority'
  | `operation:${ServerSecurityOperationKind}`;

const REDIRECT_IDENTITY = frameworkExport('@kovojs/server', 'redirect');
const TRUSTED_SQL_IDENTITY = frameworkExport('@kovojs/drizzle', 'trustedSql');
const TRUSTED_HTML_IDENTITIES = [
  frameworkExport('@kovojs/browser', 'trustedHtml'),
  frameworkExport('@kovojs/server', 'trustedHtml'),
] as const;
const SERVER_OPERATION_LEGACY_IDENTITIES = [
  REDIRECT_IDENTITY,
  TRUSTED_SQL_IDENTITY,
  TRUSTED_HTML_IDENTITIES[0],
  TRUSTED_HTML_IDENTITIES[1],
] as const;

function finiteStringSet(values: readonly string[]): ReadonlySet<string> {
  const result = compilerCreateSet<string>();
  const length = compilerArrayLength(values, 'Finite security-IR vocabulary');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Finite security-IR vocabulary');
    if (typeof value !== 'string') {
      throw new TypeError(`Finite security-IR vocabulary[${index}] must be own string data.`);
    }
    compilerSetAdd(result, value);
  }
  return result;
}

const browserPureGlobalCalls = finiteStringSet([
  'BigInt',
  'Boolean',
  'Number',
  'Object',
  'String',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
]);
const browserPureConstructors = finiteStringSet([
  'Map',
  'Promise',
  'Set',
  'URL',
  'WeakMap',
  'WeakSet',
]);
const browserPureGlobalMemberCalls = finiteStringSet([
  'Array.from',
  'Array.isArray',
  'Date.now',
  'JSON.parse',
  'JSON.stringify',
  'Math.abs',
  'Math.ceil',
  'Math.floor',
  'Math.max',
  'Math.min',
  'Math.round',
  'Math.sign',
  'Math.trunc',
  'Number.isFinite',
  'Number.isInteger',
  'Number.isNaN',
  'Object.assign',
  'Object.entries',
  'Object.freeze',
  'Object.fromEntries',
  'Object.hasOwn',
  'Object.is',
  'Object.keys',
  'Object.values',
  'Promise.all',
  'Promise.allSettled',
  'Promise.race',
  'Promise.reject',
  'Promise.resolve',
  'String.fromCharCode',
  'String.fromCodePoint',
]);
const browserEventControlMethods = finiteStringSet([
  'preventDefault',
  'stopImmediatePropagation',
  'stopPropagation',
]);
const browserEventScalarMembers = finiteStringSet([
  'altKey',
  'animationName',
  'bubbles',
  'button',
  'buttons',
  'cancelable',
  'clientX',
  'clientY',
  'code',
  'ctrlKey',
  'data',
  'defaultPrevented',
  'deltaMode',
  'deltaX',
  'deltaY',
  'deltaZ',
  'detail',
  'elapsedTime',
  'inputType',
  'isComposing',
  'isTrusted',
  'key',
  'location',
  'metaKey',
  'movementX',
  'movementY',
  'offsetX',
  'offsetY',
  'pageX',
  'pageY',
  'pointerId',
  'pressure',
  'repeat',
  'screenX',
  'screenY',
  'shiftKey',
  'timeStamp',
  'type',
  'which',
]);
const browserDomScalarMembers = finiteStringSet([
  'checked',
  'disabled',
  'hidden',
  'id',
  'innerHTML',
  'name',
  'open',
  'outerHTML',
  'selected',
  'selectionDirection',
  'selectionEnd',
  'selectionStart',
  'textContent',
  'type',
  'value',
]);
const browserDomReadMethods = finiteStringSet([
  'checkValidity',
  'closest',
  'getAttribute',
  'hasAttribute',
  'matches',
  'querySelector',
  'querySelectorAll',
  'toString',
  'valueOf',
]);
const browserStateMutatorMethods = finiteStringSet([
  'copyWithin',
  'fill',
  'pop',
  'push',
  'reverse',
  'shift',
  'sort',
  'splice',
  'unshift',
]);
const rawBrowserGlobalNames = finiteStringSet([
  'document',
  'globalThis',
  'history',
  'localStorage',
  'location',
  'navigator',
  'sessionStorage',
  'window',
]);

/**
 * Resolve one exact immutable same-file function used as a structured root or authority-bearing
 * helper edge. Imported, aliased, reassigned, multiply-declared, or lexically shadowed bindings do
 * not resolve here; Phase 2C may later discharge them through an explicit semantic summary.
 */
export function resolveSameFileSecurityIrCallable(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
): ResolvedSecurityIrCallable | undefined {
  const current = unwrapExpression(expression);
  if (
    !ts.isIdentifier(current) ||
    identifierIsShadowedBeforeBoundary(current, sourceFile) ||
    moduleBindingIsAssigned(sourceFile, current.text)
  ) {
    return undefined;
  }

  let resolved: ResolvedSecurityIrCallable | undefined;
  let matches = 0;
  const statements = compilerSnapshotDenseArray(
    sourceFile.statements,
    'Finite security-IR module statements',
  );
  for (let statementIndex = 0; statementIndex < statements.length; statementIndex += 1) {
    const statement = statements[statementIndex]!;
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === current.text &&
      statement.body
    ) {
      matches += 1;
      resolved = {
        body: statement.body,
        declaration: statement,
        name: current.text,
        parameters: statement.parameters,
      };
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const declarations = compilerSnapshotDenseArray(
      statement.declarationList.declarations,
      'Finite security-IR module declarations',
    );
    for (let declarationIndex = 0; declarationIndex < declarations.length; declarationIndex += 1) {
      const declaration = declarations[declarationIndex]!;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== current.text) continue;
      matches += 1;
      const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
      if (
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 &&
        initializer &&
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
      ) {
        resolved = {
          body: initializer.body,
          declaration: initializer,
          name: current.text,
          parameters: initializer.parameters,
        };
      }
    }
  }
  return matches === 1 ? resolved : undefined;
}

function moduleBindingIsAssigned(sourceFile: ts.SourceFile, name: string): boolean {
  let assigned = false;
  const visit = (node: ts.Node): void => {
    if (assigned) return;
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      ts.isIdentifier(unwrapExpression(node.left)) &&
      (unwrapExpression(node.left) as ts.Identifier).text === name
    ) {
      assigned = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(node.operand) &&
      node.operand.text === name
    ) {
      assigned = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return assigned;
}

/** Scanner/source-text boundary for SPEC §4.3/§5.2 finite browser effects. */
export function scanBrowserSecurityOperations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
): SecurityOperationScanResult<BrowserSecurityOperationModel> {
  const operations: BrowserSecurityOperationModel[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const locals = localBindingNames(body);
  const aliases = browserAliasProvenance(body);

  const appendOperation = (kind: BrowserSecurityOperationKind, node: ts.Node, target?: string) => {
    compilerArrayAppend(
      operations,
      {
        door: securityOperationDoorForKind(kind),
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        ...(target === undefined ? {} : { target }),
      },
      'Browser security operations',
    );
  };
  const appendViolation = (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => {
    compilerArrayAppend(
      violations,
      {
        detail,
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        surface: 'browser',
      },
      'Browser security-operation violations',
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      classifyBrowserCall(
        sourceFile,
        body,
        node,
        locals,
        aliases,
        appendOperation,
        appendViolation,
      );
    } else if (ts.isNewExpression(node)) {
      const constructor = unwrapExpression(node.expression);
      const reviewedConstructor =
        ts.isIdentifier(constructor) &&
        (compilerSetHas(locals, constructor.text) ||
          compilerSetHas(browserPureConstructors, constructor.text));
      if (!reviewedConstructor) {
        appendViolation(
          node,
          'unknown-security-operation',
          `browser constructor ${nodeName(constructor)} is outside the finite handler IR`,
        );
      } else if (browserArgumentsContainAuthority(node.arguments ?? [], aliases, body)) {
        appendViolation(
          node,
          'computed-security-operation',
          `browser constructor ${nodeName(constructor)} cannot receive browser authority`,
        );
      }
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const provenance = browserMutationTargetProvenance(node.left, aliases, body);
      if (provenance === 'state') {
        appendOperation('browser.state.write', node.left, browserExpressionTarget(node.left));
      } else if (browserProvenanceCarriesAuthority(provenance)) {
        appendViolation(
          node.left,
          provenance === 'raw-browser' || provenance === 'unknown-authority'
            ? 'computed-security-operation'
            : 'raw-dom-operation',
          `raw browser assignment ${browserExpressionTarget(node.left) ?? 'computed'} is not a finite operation`,
        );
      }
      const rightProvenance = browserExpressionProvenance(node.right, aliases, body);
      if (
        provenance !== 'state' &&
        (browserProvenanceCarriesAuthority(rightProvenance) ||
          expressionContainsBrowserAuthority(node.right, aliases, body))
      ) {
        appendViolation(
          node.right,
          'computed-security-operation',
          'browser authority cannot move through a mutable or computed alias',
        );
      }
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        const operand = node.operand;
        const provenance = browserMutationTargetProvenance(operand, aliases, body);
        if (provenance === 'state') {
          appendOperation('browser.state.write', operand, browserExpressionTarget(operand));
        } else if (browserProvenanceCarriesAuthority(provenance)) {
          appendViolation(
            operand,
            'raw-dom-operation',
            `raw DOM update ${browserExpressionTarget(operand) ?? 'computed'} is not a finite operation`,
          );
        }
      }
    } else if (ts.isDeleteExpression(node)) {
      const provenance = browserMutationTargetProvenance(node.expression, aliases, body);
      if (provenance === 'state') {
        appendOperation(
          'browser.state.write',
          node.expression,
          browserExpressionTarget(node.expression),
        );
      } else if (browserProvenanceCarriesAuthority(provenance)) {
        appendViolation(
          node,
          'raw-dom-operation',
          'deleting a DOM member is outside the finite handler IR',
        );
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(body);

  return {
    operations: dedupeBrowserOperations(operations),
    violations: dedupeViolations(violations),
  };
}

function classifyBrowserCall(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  call: ts.CallExpression,
  locals: ReadonlySet<string>,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  appendOperation: (kind: BrowserSecurityOperationKind, node: ts.Node, target?: string) => void,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  const callee = unwrapExpression(call.expression);
  if (ts.isIdentifier(callee)) {
    const provenance = browserExpressionProvenance(callee, aliases, body);
    const operationKind = browserOperationProvenanceKind(provenance);
    if (operationKind !== undefined) {
      appendOperation(operationKind, call, callee.text);
      return;
    }
    if (browserProvenanceCarriesAuthority(provenance)) {
      appendViolation(
        callee,
        'computed-security-operation',
        `browser capability alias ${callee.text} is outside the finite handler IR`,
      );
      return;
    }
    if (
      (callee.text === 'setTimeout' || callee.text === 'setInterval') &&
      !identifierIsShadowedWithinBoundary(callee, body)
    ) {
      appendOperation('browser.timer.schedule', call, callee.text);
      return;
    }
    if (
      (callee.text === 'clearTimeout' || callee.text === 'clearInterval') &&
      !identifierIsShadowedWithinBoundary(callee, body)
    ) {
      appendOperation('browser.timer.cancel', call, callee.text);
      return;
    }
    if (compilerSetHas(locals, callee.text)) {
      if (callArgumentsContainBrowserAuthority(call, aliases, body)) {
        appendViolation(
          call,
          'computed-security-operation',
          `browser authority cannot pass through local helper ${callee.text}`,
        );
      }
      return;
    }
    if (compilerSetHas(browserPureGlobalCalls, callee.text)) {
      return;
    }
    appendOperation('browser.framework.call', call, callee.text);
    return;
  }

  const member = staticMember(callee);
  if (!member) {
    if (browserExpressionProvenance(callee, aliases, body) !== 'local') {
      appendViolation(
        callee,
        'computed-security-operation',
        'computed browser call target is outside the finite handler IR',
      );
    }
    return;
  }

  const calleeOperationKind = browserOperationProvenanceKind(
    browserExpressionProvenance(callee, aliases, body),
  );
  if (calleeOperationKind !== undefined) {
    appendOperation(calleeOperationKind, call, browserExpressionTarget(callee) ?? member.name);
    return;
  }

  // `Object(element)['focus']?.call(element)` is the safe focus idiom used by reviewed primitives.
  const callableMember = staticMember(unwrapExpression(member.receiver));
  if (member.name === 'call' && callableMember) {
    const callableProvenance = browserExpressionProvenance(callableMember.receiver, aliases, body);
    if (callableMember.name === 'focus' && isDomProvenance(callableProvenance)) {
      appendOperation('browser.dom.focus', call, browserExpressionTarget(callableMember.receiver));
      return;
    }
  }

  const provenance = browserExpressionProvenance(member.receiver, aliases, body);
  if (provenance === 'state') {
    appendOperation(
      compilerSetHas(browserStateMutatorMethods, member.name)
        ? 'browser.state.write'
        : 'browser.state.read',
      call,
      member.name,
    );
    return;
  }
  if (provenance === 'event') {
    if (compilerSetHas(browserEventControlMethods, member.name)) {
      appendOperation('browser.event.control', call, member.name);
      return;
    }
    if (compilerSetHas(browserDomReadMethods, member.name)) {
      appendOperation('browser.event.read', call, member.name);
      return;
    }
  }
  if (isDomProvenance(provenance)) {
    if (compilerSetHas(browserDomReadMethods, member.name)) {
      appendOperation('browser.event.read', call, member.name);
      return;
    }
    if (member.name === 'focus') {
      appendOperation('browser.dom.focus', call, browserExpressionTarget(member.receiver));
      return;
    }
    if (member.name === 'reset') {
      appendOperation('browser.form.reset', call, 'reset');
      return;
    }
    if (member.name === 'requestSubmit') {
      appendOperation('browser.form.submit', call, 'requestSubmit');
      return;
    }
    if (member.name === 'showModal' || member.name === 'showPopover') {
      appendOperation('browser.dialog.open', call, member.name);
      return;
    }
    if (
      member.name === 'close' ||
      member.name === 'requestClose' ||
      member.name === 'hidePopover'
    ) {
      appendOperation('browser.dialog.close', call, member.name);
      return;
    }
    appendViolation(
      call,
      'raw-dom-operation',
      `DOM method ${member.name} is outside the finite handler IR`,
    );
    return;
  }

  const root = rootIdentifier(member.receiver);
  if (provenance === 'raw-browser' && root === 'document' && member.name === 'getElementById') {
    appendOperation('browser.event.read', call, 'document.getElementById');
    return;
  }
  if (provenance === 'raw-browser' || provenance === 'unknown-authority') {
    appendViolation(
      call,
      'computed-security-operation',
      `browser capability call ${browserExpressionTarget(callee) ?? member.name} is outside the finite handler IR`,
    );
    return;
  }

  if (root && !compilerSetHas(locals, root) && compilerSetHas(rawBrowserGlobalNames, root)) {
    // A literal document lookup is only a carrier. Its eventual dialog/focus/form operation is
    // classified at the outer call; all other document/global methods close here.
    if (root === 'document' && member.name === 'getElementById') {
      appendOperation('browser.event.read', call, 'document.getElementById');
      return;
    }
    appendViolation(
      call,
      'raw-dom-operation',
      `raw browser global operation ${root}.${member.name} is outside the finite handler IR`,
    );
    return;
  }

  if (
    (provenance === 'local' || (root !== undefined && compilerSetHas(locals, root))) &&
    callArgumentsContainBrowserAuthority(call, aliases, body)
  ) {
    appendViolation(
      call,
      'computed-security-operation',
      `browser authority cannot pass through local call ${member.name}`,
    );
    return;
  }

  const globalMember = root ? `${root}.${member.name}` : undefined;
  if (
    provenance === 'unknown' &&
    globalMember !== undefined &&
    compilerSetHas(browserPureGlobalMemberCalls, globalMember)
  ) {
    if (callArgumentsContainBrowserAuthority(call, aliases, body)) {
      appendViolation(
        call,
        'computed-security-operation',
        `${globalMember} cannot receive browser authority in the finite handler IR`,
      );
    }
    return;
  }

  if (provenance === 'unknown' && (!root || !compilerSetHas(locals, root))) {
    appendViolation(
      call,
      'unknown-security-operation',
      `browser call ${browserExpressionTarget(callee) ?? member.name} has no reviewed finite operation`,
    );
  }
}

/** Scanner/source-text boundary for structured server effects. */
const SECURITY_SEMANTIC_CALL_DEPTH_BUDGET = 16;
const SECURITY_SEMANTIC_NODE_BUDGET = 50_000;
const SECURITY_SEMANTIC_OPERATION_BUDGET = 4_096;
const SECURITY_SEMANTIC_SUMMARY_BUDGET = 256;

interface SecuritySemanticState {
  readonly active: Set<string>;
  readonly summaryKeys: Set<string>;
  nodes: number;
  operations: number;
  summaries: number;
}

interface SecuritySemanticInvocationResult {
  readonly closed: boolean;
  readonly operations: readonly ServerSecurityOperationModel[];
  readonly summaries: readonly SecuritySemanticSummary[];
  readonly traces: readonly SecuritySemanticTrace[];
  readonly violations: readonly SecurityOperationViolationModel[];
}

interface SecuritySemanticHelperInvocation {
  readonly authorityInputs: readonly string[];
  readonly call: ts.CallExpression;
  readonly callable: ResolvedSecurityIrCallable;
  readonly parameterProvenances: readonly ServerValueProvenance[];
  readonly transfer: string;
  readonly unsupportedDetail?: string;
}

/**
 * SPEC §5.2/§6.6 narrow normalized abstract interpreter.
 *
 * The finite scanner remains the syntax-to-operation boundary. This pass consumes only its exact
 * same-file `server.helper.call` edges, evaluates the small provenance lattice above, and builds
 * bottom-up summaries. It deliberately does not execute or otherwise model general JavaScript.
 */
export function scanServerSecurityOperations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  surface: SecurityOperationSurface,
  parameters: readonly ts.ParameterDeclaration[] = [],
  root = `${surface}:<anonymous>`,
): SecurityOperationScanResult<ServerSecurityOperationModel> {
  const state: SecuritySemanticState = {
    active: compilerCreateSet<string>(),
    nodes: 0,
    operations: 0,
    summaryKeys: compilerCreateSet<string>(),
    summaries: 0,
  };
  const result = analyzeServerSecurityCallable({
    body,
    callable: undefined,
    depth: 0,
    parameterProvenances: undefined,
    parameters,
    root,
    sourceFile,
    state,
    surface,
    transfers: [],
  });
  return {
    operations: dedupeServerOperations(result.operations),
    semanticRoot: {
      root,
      summaries: dedupeSemanticSummaries(result.summaries),
      traces: dedupeSemanticTraces(result.traces),
    },
    violations: dedupeViolations(result.violations),
  };
}

function analyzeServerSecurityCallable(options: {
  body: ts.ConciseBody;
  callable: ResolvedSecurityIrCallable | undefined;
  depth: number;
  parameterProvenances: readonly ServerValueProvenance[] | undefined;
  parameters: readonly ts.ParameterDeclaration[];
  root: string;
  sourceFile: ts.SourceFile;
  state: SecuritySemanticState;
  surface: SecurityOperationSurface;
  transfers: readonly string[];
}): SecuritySemanticInvocationResult {
  const {
    body,
    callable,
    depth,
    parameterProvenances,
    parameters,
    root,
    sourceFile,
    state,
    surface,
    transfers,
  } = options;
  const operations: ServerSecurityOperationModel[] = [];
  const summaries: SecuritySemanticSummary[] = [];
  const traces: SecuritySemanticTrace[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const authorityInputs = semanticAuthorityInputs(parameterProvenances ?? []);
  const signature =
    callable === undefined
      ? undefined
      : `${surface}\0${callable.name}\0${compilerArrayJoin(authorityInputs, ',')}`;

  if (signature !== undefined && compilerSetHas(state.active, signature)) {
    appendSemanticClosure(
      sourceFile,
      callable?.declaration ?? body,
      root,
      transfers,
      surface,
      'helper-cycle',
      `recursive semantic helper cycle at local:${callable?.name ?? '<unknown>'}`,
      traces,
      violations,
    );
    compilerArrayAppend(
      summaries,
      {
        authorityInputs,
        callable: `local:${callable?.name ?? '<unknown>'}`,
        operationKinds: [],
        verdict: 'closed',
      },
      'Closed semantic helper summaries',
    );
    return { closed: true, operations, summaries, traces, violations };
  }

  if (callable !== undefined) {
    if (signature === undefined) {
      compilerFailClosed(
        'Semantic helper summary signature was not constructed for a resolved callable.',
      );
    }
    if (!compilerSetHas(state.summaryKeys, signature)) {
      compilerSetAdd(state.summaryKeys, signature);
      state.summaries += 1;
      if (state.summaries > SECURITY_SEMANTIC_SUMMARY_BUDGET) {
        appendSemanticClosure(
          sourceFile,
          callable.declaration,
          root,
          transfers,
          surface,
          'budget-summary-count',
          `semantic helper summary budget exceeded at local:${callable.name}`,
          traces,
          violations,
        );
        compilerArrayAppend(
          summaries,
          {
            authorityInputs,
            callable: `local:${callable.name}`,
            operationKinds: [],
            verdict: 'closed',
          },
          'Budget-closed semantic helper summaries',
        );
        return { closed: true, operations, summaries, traces, violations };
      }
    }
    compilerSetAdd(state.active, signature);
  }

  let closed = false;
  try {
    state.nodes += semanticNodeCount(body);
    if (state.nodes > SECURITY_SEMANTIC_NODE_BUDGET) {
      appendSemanticClosure(
        sourceFile,
        callable?.declaration ?? body,
        root,
        transfers,
        surface,
        'budget-node-count',
        `semantic node budget exceeded while analyzing ${callable ? `local:${callable.name}` : root}`,
        traces,
        violations,
      );
      closed = true;
    } else {
      const direct = scanServerSecurityOperationsDirect(
        sourceFile,
        body,
        surface,
        parameters,
        parameterProvenances,
      );
      appendServerOperations(operations, direct.operations);
      state.operations += direct.operations.length;
      if (state.operations > SECURITY_SEMANTIC_OPERATION_BUDGET) {
        appendSemanticClosure(
          sourceFile,
          callable?.declaration ?? body,
          root,
          transfers,
          surface,
          'budget-operation-count',
          `semantic operation budget exceeded while analyzing ${callable ? `local:${callable.name}` : root}`,
          traces,
          violations,
        );
        closed = true;
      }

      const operationSnapshot = compilerSnapshotDenseArray(
        direct.operations,
        'Direct semantic operations',
      );
      for (let index = 0; index < operationSnapshot.length; index += 1) {
        const operation = operationSnapshot[index]!;
        if (operation.kind === 'server.helper.call' || operation.kind === 'server.handler.root') {
          continue;
        }
        compilerArrayAppend(
          traces,
          {
            root,
            sink: {
              door: operation.door,
              kind: operation.kind,
              ...(operation.target === undefined ? {} : { target: operation.target }),
            },
            transfers: compilerSnapshotDenseArray(transfers, 'Semantic transfer path'),
            verdict: 'proved',
          },
          'Proved semantic traces',
        );
      }

      const violationSnapshot = compilerSnapshotDenseArray(
        direct.violations,
        'Direct semantic violations',
      );
      for (let index = 0; index < violationSnapshot.length; index += 1) {
        const violation = violationSnapshot[index]!;
        const reason = semanticReasonForViolation(violation);
        const trace: SecuritySemanticTrace = {
          detail: violation.detail,
          reason,
          root,
          sink: violation.detail,
          transfers: compilerSnapshotDenseArray(transfers, 'Semantic transfer path'),
          verdict: 'closed',
        };
        compilerArrayAppend(traces, trace, 'Closed semantic traces');
        compilerArrayAppend(
          violations,
          {
            ...violation,
            detail: semanticClosedDetail(root, transfers, violation.detail, reason),
          },
          'Rooted semantic violations',
        );
        closed = true;
      }

      if (!closed || state.operations <= SECURITY_SEMANTIC_OPERATION_BUDGET) {
        const aliases = serverAliasProvenance(body, parameters, surface, parameterProvenances);
        const helpers = semanticHelperInvocations(sourceFile, body, direct.operations, aliases);
        const helperSnapshot = compilerSnapshotDenseArray(
          helpers,
          'Normalized semantic helper invocations',
        );
        for (let index = 0; index < helperSnapshot.length; index += 1) {
          const helper = helperSnapshot[index]!;
          const nextTransfers = appendSemanticTransfer(transfers, helper.transfer);
          if (helper.unsupportedDetail !== undefined) {
            appendSemanticClosure(
              sourceFile,
              helper.call,
              root,
              nextTransfers,
              surface,
              'opaque-transfer',
              helper.unsupportedDetail,
              traces,
              violations,
            );
            compilerArrayAppend(
              summaries,
              {
                authorityInputs: helper.authorityInputs,
                callable: `local:${helper.callable.name}`,
                operationKinds: [],
                verdict: 'closed',
              },
              'Unsupported semantic helper summaries',
            );
            closed = true;
            continue;
          }
          if (depth + 1 > SECURITY_SEMANTIC_CALL_DEPTH_BUDGET) {
            appendSemanticClosure(
              sourceFile,
              helper.call,
              root,
              nextTransfers,
              surface,
              'budget-call-depth',
              `semantic call-depth budget exceeded at local:${helper.callable.name}`,
              traces,
              violations,
            );
            compilerArrayAppend(
              summaries,
              {
                authorityInputs: helper.authorityInputs,
                callable: `local:${helper.callable.name}`,
                operationKinds: [],
                verdict: 'closed',
              },
              'Depth-closed semantic helper summaries',
            );
            closed = true;
            continue;
          }

          const child = analyzeServerSecurityCallable({
            body: helper.callable.body,
            callable: helper.callable,
            depth: depth + 1,
            parameterProvenances: helper.parameterProvenances,
            parameters: helper.callable.parameters,
            root,
            sourceFile,
            state,
            surface,
            transfers: nextTransfers,
          });
          appendServerOperations(operations, child.operations);
          appendSemanticSummaries(summaries, child.summaries);
          appendSemanticTraces(traces, child.traces);
          appendSemanticViolations(violations, child.violations);
          if (child.closed) closed = true;
        }
      }
    }

    if (callable !== undefined) {
      const operationKinds = semanticOperationKinds(operations);
      compilerArrayAppend(
        summaries,
        {
          authorityInputs,
          callable: `local:${callable.name}`,
          operationKinds,
          verdict: closed ? 'closed' : 'proved',
        },
        'Bottom-up semantic helper summaries',
      );
    }
    return { closed, operations, summaries, traces, violations };
  } finally {
    if (signature !== undefined) compilerSetDelete(state.active, signature);
  }
}

function semanticHelperInvocations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  operations: readonly ServerSecurityOperationModel[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): SecuritySemanticHelperInvocation[] {
  const helperEdges = compilerCreateSet<string>();
  const operationSnapshot = compilerSnapshotDenseArray(
    operations,
    'Semantic helper-edge operations',
  );
  for (let index = 0; index < operationSnapshot.length; index += 1) {
    const operation = operationSnapshot[index]!;
    if (operation.kind !== 'server.helper.call' || operation.target === undefined) continue;
    compilerSetAdd(
      helperEdges,
      `${operation.span.start}\0${operation.span.end}\0${operation.target}`,
    );
  }

  const helpers: SecuritySemanticHelperInvocation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      if (ts.isIdentifier(callee)) {
        const callable = resolveSameFileSecurityIrCallable(sourceFile, callee);
        const edgeKey = callable
          ? `${node.getStart(sourceFile)}\0${node.getEnd()}\0local:${callable.name}`
          : undefined;
        if (callable && edgeKey && compilerSetHas(helperEdges, edgeKey)) {
          compilerArrayAppend(
            helpers,
            semanticHelperInvocation(sourceFile, node, callable, aliases),
            'Normalized semantic helper invocations',
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return helpers;
}

function semanticHelperInvocation(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  callable: ResolvedSecurityIrCallable,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): SecuritySemanticHelperInvocation {
  const argumentSnapshot = compilerSnapshotDenseArray(call.arguments, 'Semantic helper arguments');
  const parameterSnapshot = compilerSnapshotDenseArray(
    callable.parameters,
    'Semantic helper parameters',
  );
  const parameterProvenances: ServerValueProvenance[] = [];
  const authorityInputs: string[] = [];
  let unsupportedDetail: string | undefined;
  let restParameterIndex: number | undefined;
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    if (parameterSnapshot[index]?.dotDotDotToken) {
      restParameterIndex = index;
      break;
    }
  }

  for (let index = 0; index < argumentSnapshot.length; index += 1) {
    const argument = argumentSnapshot[index]!;
    const spread = ts.isSpreadElement(argument);
    const expression = spread ? argument.expression : argument;
    const provenance = serverExpressionProvenance(expression, aliases);
    if (serverProvenanceCarriesAuthority(provenance)) {
      compilerArrayAppend(
        authorityInputs,
        `arg${index}=${provenance}`,
        'Semantic helper authority inputs',
      );
      if (spread) {
        unsupportedDetail = `authority-bearing spread argument into local:${callable.name} has no finite parameter mapping`;
      } else if (restParameterIndex !== undefined && index >= restParameterIndex) {
        unsupportedDetail = `authority-bearing rest argument into local:${callable.name} is outside the finite summary semantics`;
      } else if (index >= parameterSnapshot.length) {
        unsupportedDetail = `authority-bearing extra argument into local:${callable.name} has no finite parameter mapping`;
      }
    }
    if (index < parameterSnapshot.length) {
      compilerArrayAppend(parameterProvenances, provenance, 'Semantic helper parameter provenance');
    }
  }
  while (parameterProvenances.length < parameterSnapshot.length) {
    compilerArrayAppend(parameterProvenances, 'local', 'Semantic helper parameter provenance');
  }

  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    const parameter = parameterSnapshot[index]!;
    if (parameter.dotDotDotToken && serverProvenanceCarriesAuthority(parameterProvenances[index])) {
      unsupportedDetail = `authority-bearing rest parameter in local:${callable.name} is outside the finite summary semantics`;
    }
  }
  if (authorityInputs.length > 0 && semanticBodyUsesArguments(callable.body)) {
    unsupportedDetail = `arguments-object authority recovery in local:${callable.name} is outside the finite summary semantics`;
  }

  const transfer = `local:${callable.name}[${compilerArrayJoin(authorityInputs, ',')}]`;
  return {
    authorityInputs,
    call,
    callable,
    parameterProvenances,
    transfer,
    ...(unsupportedDetail === undefined ? {} : { unsupportedDetail }),
  };
}

function semanticBodyUsesArguments(body: ts.ConciseBody): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === 'arguments') {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function semanticNodeCount(node: ts.Node): number {
  let count = 0;
  const visit = (current: ts.Node): void => {
    count += 1;
    ts.forEachChild(current, visit);
  };
  visit(node);
  return count;
}

function semanticAuthorityInputs(provenances: readonly ServerValueProvenance[]): string[] {
  const result: string[] = [];
  const snapshot = compilerSnapshotDenseArray(provenances, 'Semantic parameter provenance');
  for (let index = 0; index < snapshot.length; index += 1) {
    if (!serverProvenanceCarriesAuthority(snapshot[index])) continue;
    compilerArrayAppend(
      result,
      `arg${index}=${snapshot[index]}`,
      'Semantic authority-input summary',
    );
  }
  return result;
}

function semanticOperationKinds(
  operations: readonly ServerSecurityOperationModel[],
): ServerSecurityOperationKind[] {
  const result: ServerSecurityOperationKind[] = [];
  const seen = compilerCreateSet<ServerSecurityOperationKind>();
  const snapshot = compilerSnapshotDenseArray(operations, 'Semantic summary operations');
  for (let index = 0; index < snapshot.length; index += 1) {
    const kind = snapshot[index]!.kind;
    if (
      kind === 'server.handler.root' ||
      kind === 'server.helper.call' ||
      compilerSetHas(seen, kind)
    ) {
      continue;
    }
    compilerSetAdd(seen, kind);
    compilerArrayAppend(result, kind, 'Semantic summary operation kinds');
  }
  return result;
}

function semanticReasonForViolation(
  violation: SecurityOperationViolationModel,
): SecuritySemanticClosedReason {
  switch (violation.kind) {
    case 'computed-security-operation':
      return 'opaque-transfer';
    case 'unknown-security-operation':
      return 'unknown-operation';
    case 'incomplete-mutation-form':
    case 'raw-capability-operation':
    case 'raw-dom-operation':
      return 'unsupported-authority-use';
  }
}

function appendSemanticClosure(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  root: string,
  transfers: readonly string[],
  surface: SecurityOperationSurface,
  reason: SecuritySemanticClosedReason,
  detail: string,
  traces: SecuritySemanticTrace[],
  violations: SecurityOperationViolationModel[],
): void {
  const transferSnapshot = compilerSnapshotDenseArray(transfers, 'Semantic transfer path');
  compilerArrayAppend(
    traces,
    {
      detail,
      reason,
      root,
      sink: detail,
      transfers: transferSnapshot,
      verdict: 'closed',
    },
    'Synthetic closed semantic traces',
  );
  compilerArrayAppend(
    violations,
    {
      detail: semanticClosedDetail(root, transfers, detail, reason),
      kind: 'computed-security-operation',
      span: { end: node.getEnd(), start: node.getStart(sourceFile) },
      surface,
    },
    'Synthetic closed semantic violations',
  );
}

function semanticClosedDetail(
  root: string,
  transfers: readonly string[],
  sink: string,
  reason: SecuritySemanticClosedReason,
): string {
  const path = transfers.length === 0 ? '<direct>' : compilerArrayJoin(transfers, ' -> ');
  return `semantic root=${root}; transfers=${path}; sink=${sink}; verdict=closed:${reason}`;
}

function appendSemanticTransfer(transfers: readonly string[], transfer: string): string[] {
  const result = compilerSnapshotDenseArray(transfers, 'Semantic transfer path');
  compilerArrayAppend(result, transfer, 'Semantic transfer path');
  return result;
}

function appendServerOperations(
  target: ServerSecurityOperationModel[],
  values: readonly ServerSecurityOperationModel[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic server operations');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic server operations');
  }
}

function appendSemanticSummaries(
  target: SecuritySemanticSummary[],
  values: readonly SecuritySemanticSummary[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic helper summaries');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic helper summaries');
  }
}

function appendSemanticTraces(
  target: SecuritySemanticTrace[],
  values: readonly SecuritySemanticTrace[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic traces');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic traces');
  }
}

function appendSemanticViolations(
  target: SecurityOperationViolationModel[],
  values: readonly SecurityOperationViolationModel[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Semantic violations');
  for (let index = 0; index < snapshot.length; index += 1) {
    compilerArrayAppend(target, snapshot[index]!, 'Semantic violations');
  }
}

function dedupeSemanticSummaries(
  values: readonly SecuritySemanticSummary[],
): SecuritySemanticSummary[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.callable}\0${compilerArrayJoin(value.authorityInputs, ',')}\0${compilerArrayJoin(value.operationKinds, ',')}\0${value.verdict}`,
  );
}

function dedupeSemanticTraces(values: readonly SecuritySemanticTrace[]): SecuritySemanticTrace[] {
  return dedupeByKey(values, (value) => {
    const sink =
      value.verdict === 'proved'
        ? `${value.sink.kind}\0${value.sink.door}\0${value.sink.target ?? ''}`
        : `${value.reason}\0${value.sink}\0${value.detail}`;
    return `${value.root}\0${compilerArrayJoin(value.transfers, '\0')}\0${value.verdict}\0${sink}`;
  });
}

export function serverSecuritySemanticBudgets(): SecuritySemanticBudgets {
  return {
    callDepth: SECURITY_SEMANTIC_CALL_DEPTH_BUDGET,
    nodes: SECURITY_SEMANTIC_NODE_BUDGET,
    operations: SECURITY_SEMANTIC_OPERATION_BUDGET,
    summaries: SECURITY_SEMANTIC_SUMMARY_BUDGET,
  };
}

function scanServerSecurityOperationsDirect(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  surface: SecurityOperationSurface,
  parameters: readonly ts.ParameterDeclaration[] = [],
  parameterProvenances?: readonly ServerValueProvenance[],
): SecurityOperationScanResult<ServerSecurityOperationModel> {
  const operations: ServerSecurityOperationModel[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const aliases = serverAliasProvenance(body, parameters, surface, parameterProvenances);
  const appendOperation = (
    kind: ServerSecurityOperationKind,
    node: ts.Node,
    target?: string,
    justification?: string,
  ) => {
    compilerArrayAppend(
      operations,
      {
        door: securityOperationDoorForKind(kind),
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        ...(target === undefined ? {} : { target }),
        ...(justification === undefined ? {} : { justification }),
      },
      'Server security operations',
    );
  };
  const appendViolation = (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => {
    compilerArrayAppend(
      violations,
      {
        detail,
        kind,
        span: { end: node.getEnd(), start: node.getStart(sourceFile) },
        surface,
      },
      'Server security-operation violations',
    );
  };

  const visit = (node: ts.Node): void => {
    if (isSecurityIrFunctionScope(node)) {
      if (nestedServerFunctionCapturesAuthority(node, aliases)) {
        appendViolation(
          node,
          'computed-security-operation',
          'server authority cannot be captured by an unsummarized nested callable',
        );
      }
      return;
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializerProvenance = serverExpressionProvenance(node.initializer, aliases);
      if (initializerProvenance === 'unknown-authority') {
        appendViolation(
          node.initializer,
          'computed-security-operation',
          'server authority cannot move through an opaque container or control-flow join',
        );
      }
    }
    if (ts.isCallExpression(node)) {
      classifyServerCall(sourceFile, node, surface, aliases, appendOperation, appendViolation);
    } else if (ts.isNewExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const provenance = serverExpressionProvenance(callee, aliases);
      if (provenance === 'response-constructor') {
        if (surface === 'endpoint' || surface === 'webhook') {
          appendOperation(
            'server.response.raw',
            node,
            'new Response',
            `${surface} access/CSRF posture`,
          );
        } else {
          appendViolation(
            node,
            'raw-capability-operation',
            `raw Response is not a supported ${surface} outcome`,
          );
        }
      } else if (provenance === 'unknown-authority') {
        appendViolation(
          node,
          'computed-security-operation',
          'computed server capability constructor is outside the finite server IR',
        );
      } else if (serverArgumentsContainAuthority(node.arguments ?? [], aliases)) {
        appendViolation(
          node,
          'computed-security-operation',
          'server authority cannot pass through an unreviewed constructor',
        );
      }
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const left = unwrapExpression(node.left);
      if (
        ts.isIdentifier(left) &&
        serverProvenanceCarriesAuthority(compilerMapGet(aliases, left.text))
      ) {
        appendViolation(
          left,
          'raw-capability-operation',
          `server capability alias ${left.text} cannot be reassigned`,
        );
      }
      if (!ts.isIdentifier(left) && serverExpressionCarriesAuthority(left, aliases)) {
        appendViolation(
          left,
          'raw-capability-operation',
          'server capability members and containers cannot be mutated',
        );
      }
      if (serverExpressionCarriesAuthority(node.right, aliases)) {
        appendViolation(
          node.right,
          'computed-security-operation',
          'server authority cannot move through a mutable or computed alias',
        );
      }
    } else if (
      ts.isDeleteExpression(node) &&
      serverExpressionCarriesAuthority(node.expression, aliases)
    ) {
      appendViolation(
        node,
        'raw-capability-operation',
        'server capability members and containers cannot be deleted',
      );
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      serverExpressionCarriesAuthority(node.operand, aliases)
    ) {
      appendViolation(
        node,
        'raw-capability-operation',
        'server capability members and containers cannot be incremented or decremented',
      );
    } else if (
      (ts.isReturnStatement(node) || ts.isThrowStatement(node)) &&
      node.expression &&
      serverExpressionCarriesAuthority(node.expression, aliases)
    ) {
      appendViolation(
        node.expression,
        'raw-capability-operation',
        'server capability cannot escape a structured handler outcome',
      );
    }
    ts.forEachChild(node, visit);
  };
  if (!ts.isBlock(body) && serverExpressionCarriesAuthority(body, aliases)) {
    appendViolation(
      body,
      'raw-capability-operation',
      'server capability cannot escape a structured handler outcome',
    );
  }
  visit(body);

  return {
    operations: dedupeServerOperations(operations),
    violations: dedupeViolations(violations),
  };
}

function nestedServerFunctionCapturesAuthority(
  functionNode: ts.Node,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (node !== functionNode && isSecurityIrFunctionScope(node)) return;
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        !(
          (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
          (ts.isPropertyAssignment(parent) && parent.name === node)
        ) &&
        serverProvenanceCarriesAuthority(compilerMapGet(aliases, node.text)) &&
        !identifierIsShadowedWithinBoundary(node, functionNode)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(functionNode);
  return found;
}

function classifyServerCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  surface: SecurityOperationSurface,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
  appendOperation: (
    kind: ServerSecurityOperationKind,
    node: ts.Node,
    target?: string,
    justification?: string,
  ) => void,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): void {
  const callee = unwrapExpression(call.expression);
  const frameworkIdentity = canonicalFrameworkExportForExpression(
    ts as FrameworkIdentityTypeScript,
    sourceFile,
    callee,
    { legacyGlobals: SERVER_OPERATION_LEGACY_IDENTITIES },
  );
  if (frameworkExportEquals(frameworkIdentity, REDIRECT_IDENTITY)) {
    appendOperation('server.response.redirect', call, 'redirect');
    return;
  }
  if (frameworkExportEquals(frameworkIdentity, TRUSTED_SQL_IDENTITY)) {
    appendOperation(
      'server.database.trusted-sql',
      call,
      'trustedSql',
      justificationFromCall(call) ?? 'missing',
    );
    return;
  }
  if (frameworkIdentityIn(frameworkIdentity, TRUSTED_HTML_IDENTITIES)) {
    appendOperation(
      'server.output.trusted-html',
      call,
      'trustedHtml',
      justificationFromCall(call) ?? 'missing',
    );
    return;
  }
  if (ts.isIdentifier(callee)) {
    const authorityTransfer = serverArgumentsContainAuthority(call.arguments, aliases);
    const classified = classifyServerProvenanceCall(
      serverExpressionProvenance(callee, aliases),
      call,
      callee.text,
      surface,
      appendOperation,
      appendViolation,
    );
    if (!classified && authorityTransfer) {
      const local = resolveSameFileSecurityIrCallable(sourceFile, callee);
      if (local) {
        appendOperation('server.helper.call', call, `local:${local.name}`);
      } else {
        appendViolation(
          call,
          'computed-security-operation',
          `server authority cannot pass through unresolved or foreign helper ${callee.text}`,
        );
      }
    }
    return;
  }

  const member = staticMember(callee);
  if (!member) {
    const provenance = serverExpressionProvenance(callee, aliases);
    const root = rootIdentifier(callee);
    if (provenance === 'unknown-authority' || (root && isStructuredServerReceiver(root))) {
      appendViolation(
        callee,
        'computed-security-operation',
        `computed ${root} operation is outside the finite server IR`,
      );
    } else if (serverArgumentsContainAuthority(call.arguments, aliases)) {
      appendViolation(
        call,
        'computed-security-operation',
        'server authority cannot pass through a computed helper',
      );
    }
    return;
  }
  const provenance = serverExpressionProvenance(callee, aliases);
  const path = expressionPath(member.receiver);
  const target = path ? `${path}.${member.name}` : member.name;
  if (
    classifyServerProvenanceCall(
      provenance,
      call,
      target,
      surface,
      appendOperation,
      appendViolation,
    )
  ) {
    return;
  }
  if (serverArgumentsContainAuthority(call.arguments, aliases)) {
    appendViolation(
      call,
      'computed-security-operation',
      `server authority cannot pass through unreviewed helper ${target}`,
    );
  }
}

function classifyServerProvenanceCall(
  provenance: ServerValueProvenance,
  call: ts.CallExpression,
  target: string,
  surface: SecurityOperationSurface,
  appendOperation: (
    kind: ServerSecurityOperationKind,
    node: ts.Node,
    target?: string,
    justification?: string,
  ) => void,
  appendViolation: (
    node: ts.Node,
    kind: SecurityOperationViolationModel['kind'],
    detail: string,
  ) => void,
): boolean {
  if (provenance === 'unknown-authority') {
    appendViolation(
      call,
      'computed-security-operation',
      `computed server capability call ${target} is outside the finite server IR`,
    );
    return true;
  }
  if (provenance === 'scope-call') {
    appendOperation('server.authority.scope', call, target);
    return true;
  }
  if (!compilerStringStartsWith(provenance, 'operation:')) {
    if (serverProvenanceCarriesAuthority(provenance)) {
      appendViolation(
        call,
        'raw-capability-operation',
        `server capability call ${target} has no reviewed finite operation`,
      );
      return true;
    }
    return false;
  }
  const kind = compilerStringSlice(provenance, 'operation:'.length) as ServerSecurityOperationKind;
  if (surface === 'query' && kind === 'server.database.write') {
    appendViolation(
      call,
      'raw-capability-operation',
      'query loaders cannot perform a managed database write',
    );
    return true;
  }
  if (kind === 'server.response.raw') {
    if (surface === 'endpoint' || surface === 'webhook') {
      appendOperation(kind, call, target, `${surface} access/CSRF posture`);
    } else {
      appendViolation(
        call,
        'raw-capability-operation',
        `raw Response is not a supported ${surface} outcome`,
      );
    }
    return true;
  }
  appendOperation(kind, call, target);
  return true;
}

function serverAliasProvenance(
  body: ts.ConciseBody,
  parameters: readonly ts.ParameterDeclaration[],
  surface: SecurityOperationSurface,
  parameterProvenances?: readonly ServerValueProvenance[],
): ReadonlyMap<string, ServerValueProvenance> {
  const aliases = compilerCreateMap<string, ServerValueProvenance>();
  compilerMapSet(aliases, 'Response', 'response-constructor');

  const parameterSnapshot = compilerSnapshotDenseArray(parameters, 'Security-IR parameters');
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    setServerAliasPattern(
      parameterSnapshot[index]!.name,
      parameterProvenances === undefined ? 'local' : (parameterProvenances[index] ?? 'local'),
      aliases,
    );
  }
  if (parameterProvenances === undefined) {
    const contextParameter = parameterSnapshot[surface === 'mutation' ? 2 : 1];
    if (contextParameter) setServerAliasPattern(contextParameter.name, 'context', aliases);
    if (surface === 'mutation' && parameterSnapshot[1]) {
      setServerAliasPattern(parameterSnapshot[1]!.name, 'request', aliases);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const initializer = node.initializer;
        let provenance: ServerValueProvenance = 'local';
        if (initializer) {
          const derived = serverExpressionProvenance(initializer, aliases);
          const authority = derived;
          provenance = isConstVariableDeclaration(node)
            ? authority
            : serverProvenanceCarriesAuthority(authority)
              ? 'unknown-authority'
              : 'local';
        }
        if (bindServerAliasPattern(node.name, provenance, aliases)) changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return aliases;
}

function bindServerAliasPattern(
  name: ts.BindingName,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): boolean {
  if (ts.isIdentifier(name)) {
    return joinServerAlias(name.text, provenance, aliases);
  }
  let changed = false;
  const elements = compilerSnapshotDenseArray(name.elements, 'Security-IR server bindings');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    const property =
      staticPropertyName(
        element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined),
      ) ?? 'computed';
    const elementProvenance = element.dotDotDotToken
      ? serverProvenanceCarriesAuthority(provenance)
        ? 'unknown-authority'
        : 'local'
      : serverMemberProvenance(provenance, property);
    if (bindServerAliasPattern(element.name, elementProvenance, aliases)) changed = true;
  }
  return changed;
}

function setServerAliasPattern(
  name: ts.BindingName,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): void {
  if (ts.isIdentifier(name)) {
    compilerMapSet(aliases, name.text, provenance);
    return;
  }
  const elements = compilerSnapshotDenseArray(name.elements, 'Security-IR server parameters');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    const property =
      staticPropertyName(
        element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined),
      ) ?? 'computed';
    const elementProvenance = element.dotDotDotToken
      ? serverProvenanceCarriesAuthority(provenance)
        ? 'unknown-authority'
        : 'local'
      : serverMemberProvenance(provenance, property);
    setServerAliasPattern(element.name, elementProvenance, aliases);
  }
}

function joinServerAlias(
  name: string,
  provenance: ServerValueProvenance,
  aliases: Map<string, ServerValueProvenance>,
): boolean {
  const previous = compilerMapGet(aliases, name);
  if (previous === provenance || previous === 'unknown-authority') return false;
  compilerMapSet(aliases, name, previous === undefined ? provenance : 'unknown-authority');
  return true;
}

function serverExpressionProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): ServerValueProvenance {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return compilerMapGet(aliases, current.text) ?? 'local';
  if (ts.isCallExpression(current)) {
    const callee = serverExpressionProvenance(current.expression, aliases);
    return callee === 'scope-call' ? 'context' : 'local';
  }
  const member = staticMember(current);
  if (member) {
    return serverMemberProvenance(
      serverExpressionProvenance(member.receiver, aliases),
      member.name,
    );
  }
  return expressionContainsServerAuthority(current, aliases) ? 'unknown-authority' : 'local';
}

function serverMemberProvenance(
  receiver: ServerValueProvenance,
  member: string,
): ServerValueProvenance {
  if (receiver === 'unknown-authority') return receiver;
  if (
    receiver === serverOperationProvenance('server.database.read') ||
    receiver === serverOperationProvenance('server.database.write')
  ) {
    // Managed principal scopes expose exact `db.read.select` / `db.write.insert` namespaces. Keep
    // only a terminal whose reviewed DB kind agrees with the namespace; Function-prototype
    // laundering (`bind`/`call`/`apply`) and arbitrary members remain opaque.
    return databaseOperationKind(member) === compilerStringSlice(receiver, 'operation:'.length)
      ? receiver
      : 'unknown-authority';
  }
  // Every other finite operation is an exact callable sink, not a first-class capability object.
  if (compilerStringStartsWith(receiver, 'operation:')) return 'unknown-authority';
  if (receiver === 'context') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'headers') return 'headers';
    if (member === 'respond') return 'respond';
    if (member === 'storage') return 'storage';
    if (member === 'request') return 'request';
    if (member === 'tx') return 'database';
    if (member === 'fetch') return serverOperationProvenance('server.egress.request');
    if (
      member === 'forwardSetCookie' ||
      member === 'setCookie' ||
      member === 'setSessionRevocationClearSiteData'
    ) {
      return serverOperationProvenance('server.response.cookie');
    }
    if (member === 'fail') return serverOperationProvenance('server.response.outcome');
    if (
      member === 'invalidate' ||
      member === 'recordChange' ||
      member === 'runMutation' ||
      member === 'runQuery' ||
      member === 'schedule'
    ) {
      return serverOperationProvenance('server.task.compose');
    }
    if (member === 'actAs' || member === 'declareSystemRead' || member === 'declareSystemWrite') {
      return 'scope-call';
    }
    if (member === 'header') return 'safe-call';
    return 'unknown-authority';
  }
  if (receiver === 'request') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'cancel' || member === 'schedule') {
      return serverOperationProvenance('server.task.compose');
    }
    return 'local';
  }
  if (receiver === 'database') {
    const kind = databaseOperationKind(member);
    if (kind) return serverOperationProvenance(kind);
    if (isRawDatabaseCapabilityMember(member)) {
      return 'unknown-authority';
    }
    // Managed handles can expose schema/table namespaces before the terminal reviewed method.
    // A call while provenance is still `database` closes below; mere static member traversal does
    // not erase the managed capability.
    return 'database';
  }
  if (receiver === 'headers') {
    if (member === 'append' || member === 'delete' || member === 'set') {
      return serverOperationProvenance('server.response.header');
    }
    if (member === 'entries' || member === 'get' || member === 'has' || member === 'keys') {
      return 'safe-call';
    }
    return 'unknown-authority';
  }
  if (receiver === 'storage') {
    if (member === 'get' || member === 'list' || member === 'signUrl') {
      return serverOperationProvenance('server.storage.read');
    }
    if (member === 'delete' || member === 'put') {
      return serverOperationProvenance('server.storage.write');
    }
    return 'unknown-authority';
  }
  if (receiver === 'respond') {
    if (member === 'file' || member === 'stream') {
      return serverOperationProvenance('server.response.outcome');
    }
    return 'unknown-authority';
  }
  if (receiver === 'response-constructor') {
    if (member === 'error' || member === 'json' || member === 'redirect') {
      return serverOperationProvenance('server.response.raw');
    }
    return 'unknown-authority';
  }
  return 'local';
}

function isRawDatabaseCapabilityMember(member: string): boolean {
  return (
    member === '$client' ||
    member === 'client' ||
    member === 'pglite' ||
    member === 'session' ||
    member === 'sqlite'
  );
}

function serverOperationProvenance(
  kind: ServerSecurityOperationKind,
): `operation:${ServerSecurityOperationKind}` {
  return `operation:${kind}`;
}

function serverProvenanceCarriesAuthority(provenance: ServerValueProvenance | undefined): boolean {
  return provenance !== undefined && provenance !== 'local' && provenance !== 'safe-call';
}

function expressionContainsServerAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const result = serverExpressionProvenance(node, aliases);
      if (serverProvenanceCarriesAuthority(result)) found = true;
      // A reviewed operation consumes its receiver and returns plain data. An unreviewed call that
      // receives authority is diagnosed at that call site; its result is not itself a capability.
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        return;
      }
      if (serverProvenanceCarriesAuthority(compilerMapGet(aliases, node.text))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function serverExpressionCarriesAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  return serverProvenanceCarriesAuthority(serverExpressionProvenance(expression, aliases));
}

function serverArgumentsContainAuthority(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, ServerValueProvenance>,
): boolean {
  const snapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Server security-operation call arguments',
  );
  for (let index = 0; index < snapshot.length; index += 1) {
    if (serverExpressionCarriesAuthority(snapshot[index]!, aliases)) return true;
  }
  return false;
}

function isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function databaseOperationKind(method: string): ServerSecurityOperationKind | undefined {
  if (
    method === 'count' ||
    method === 'findFirst' ||
    method === 'findMany' ||
    method === 'read' ||
    method === 'select' ||
    method === 'get' ||
    method === 'all' ||
    method === 'values' ||
    method === 'rawRead'
  ) {
    return 'server.database.read';
  }
  if (
    method === 'batch' ||
    method === 'delete' ||
    method === 'execute' ||
    method === 'insert' ||
    method === 'put' ||
    method === 'run' ||
    method === 'transaction' ||
    method === 'update' ||
    method === 'write'
  ) {
    return 'server.database.write';
  }
  return undefined;
}

function isStructuredServerReceiver(root: string): boolean {
  return (
    root === 'Response' ||
    root === 'context' ||
    root === 'ctx' ||
    root === 'db' ||
    root === 'headers' ||
    root === 'readonlyAppDb' ||
    root === 'respond' ||
    root === 'storage' ||
    root === 'tx'
  );
}

function justificationFromCall(call: ts.CallExpression): string | undefined {
  const argumentsSnapshot = compilerSnapshotDenseArray(call.arguments, 'Security escape arguments');
  // Argument zero is the trusted value itself; only trailing metadata can justify the escape.
  for (let index = argumentsSnapshot.length - 1; index >= 1; index -= 1) {
    const argument = unwrapExpression(argumentsSnapshot[index]!);
    if (ts.isStringLiteralLike(argument) && compilerStringTrim(argument.text).length > 0) {
      return argument.text;
    }
    if (!ts.isObjectLiteralExpression(argument)) continue;
    const properties = compilerSnapshotDenseArray(
      argument.properties,
      'Security escape option properties',
    );
    for (let propertyIndex = 0; propertyIndex < properties.length; propertyIndex += 1) {
      const property = properties[propertyIndex]!;
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      if (name !== 'justification' && name !== 'reason') continue;
      const value = unwrapExpression(property.initializer);
      return ts.isStringLiteralLike(value) && compilerStringTrim(value.text).length > 0
        ? value.text
        : undefined;
    }
  }
  return undefined;
}

function frameworkIdentityIn(
  candidate: FrameworkExportIdentity | undefined,
  expected: readonly FrameworkExportIdentity[],
): boolean {
  if (candidate === undefined) return false;
  const length = compilerArrayLength(expected, 'Finite server-operation identities');
  for (let index = 0; index < length; index += 1) {
    const identity = compilerOwnDataValue(expected, index, 'Finite server-operation identities') as
      | FrameworkExportIdentity
      | undefined;
    if (!identity) {
      throw new TypeError(`Finite server-operation identities[${index}] must be own data.`);
    }
    if (frameworkExportEquals(candidate, identity)) return true;
  }
  return false;
}

function browserAliasProvenance(body: ts.ConciseBody): ReadonlyMap<string, BrowserValueProvenance> {
  const aliases = compilerCreateMap<string, BrowserValueProvenance>();
  compilerMapSet(aliases, 'state', 'state');
  compilerMapSet(aliases, 'event', 'event');
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const initializer = node.initializer;
        const derived = initializer
          ? browserExpressionProvenance(initializer, aliases, body)
          : 'local';
        const authority: BrowserValueProvenance =
          derived !== 'unknown'
            ? derived
            : initializer && expressionContainsBrowserAuthority(initializer, aliases, body)
              ? 'unknown-authority'
              : 'unknown';
        const provenance =
          isConstVariableDeclaration(node) || !browserProvenanceCarriesAuthority(authority)
            ? authority
            : 'unknown-authority';
        if (provenance !== 'unknown' && bindBrowserAliasPattern(node.name, provenance, aliases)) {
          changed = true;
        }
      } else if (ts.isParameter(node)) {
        if (bindBrowserAliasPattern(node.name, 'local', aliases)) changed = true;
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
        if (joinBrowserAlias(node.name.text, 'local', aliases)) changed = true;
      }
      ts.forEachChild(node, visit);
    };
    visit(body);
  }
  return aliases;
}

function browserExpressionProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): BrowserValueProvenance {
  const current = unwrapExpression(expression);
  if (
    ts.isStringLiteralLike(current) ||
    ts.isNumericLiteral(current) ||
    ts.isRegularExpressionLiteral(current) ||
    current.kind === ts.SyntaxKind.TrueKeyword ||
    current.kind === ts.SyntaxKind.FalseKeyword ||
    current.kind === ts.SyntaxKind.NullKeyword
  ) {
    return 'local';
  }
  if (ts.isIdentifier(current)) {
    if (
      (current.text === 'setTimeout' || current.text === 'setInterval') &&
      !identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return browserOperationProvenance('browser.timer.schedule');
    }
    if (
      (current.text === 'clearTimeout' || current.text === 'clearInterval') &&
      !identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return browserOperationProvenance('browser.timer.cancel');
    }
    if (
      compilerSetHas(rawBrowserGlobalNames, current.text) &&
      !identifierIsShadowedWithinBoundary(current, boundary)
    ) {
      return 'raw-browser';
    }
    return compilerMapGet(aliases, current.text) ?? 'unknown';
  }
  if (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    if (
      ts.isIdentifier(callee) &&
      callee.text === 'Object' &&
      !identifierIsShadowedWithinBoundary(callee, boundary)
    ) {
      const first = current.arguments[0];
      return first ? browserExpressionProvenance(first, aliases, boundary) : 'unknown';
    }
    if (ts.isIdentifier(callee)) {
      // The call itself is independently required to be a local callable, a finite global, or an
      // exact reviewed client export. Its return is plain data unless one of the explicit DOM
      // carrier methods below says otherwise.
      return 'local';
    }
    const member = staticMember(callee);
    if (member) {
      const receiver = browserExpressionProvenance(member.receiver, aliases, boundary);
      if (receiver === 'local') return 'local';
      if (member.name === 'closest' || member.name === 'querySelector') {
        return isDomProvenance(receiver) || receiver === 'event' ? 'dom' : 'unknown';
      }
      if (member.name === 'getElementById' && rootIdentifier(member.receiver) === 'document') {
        return 'dom';
      }
      return 'local';
    }
  }
  const member = staticMember(current);
  if (member) {
    const receiver = browserExpressionProvenance(member.receiver, aliases, boundary);
    const receiverOperation = browserOperationProvenanceKind(receiver);
    if (receiverOperation !== undefined) {
      return member.name === 'call' || member.name === 'apply' || member.name === 'bind'
        ? receiver
        : 'unknown-authority';
    }
    if (receiver === 'state') return 'state';
    if (receiver === 'event') {
      if (member.name === 'form') return 'form';
      if (member.name === 'target' || member.name === 'currentTarget') return 'dom';
      if (compilerSetHas(browserEventControlMethods, member.name)) {
        return browserOperationProvenance('browser.event.control');
      }
      if (compilerSetHas(browserDomReadMethods, member.name)) {
        return browserOperationProvenance('browser.event.read');
      }
      if (compilerSetHas(browserEventScalarMembers, member.name)) return 'local';
      return 'event';
    }
    if (receiver === 'dom' || receiver === 'form') {
      if (member.name === 'form') return 'form';
      if (compilerSetHas(browserDomReadMethods, member.name)) {
        return browserOperationProvenance('browser.event.read');
      }
      if (compilerSetHas(browserDomScalarMembers, member.name)) return 'local';
      return receiver;
    }
    if (receiver === 'raw-browser') {
      if (member.name === 'setTimeout' || member.name === 'setInterval') {
        return browserOperationProvenance('browser.timer.schedule');
      }
      if (member.name === 'clearTimeout' || member.name === 'clearInterval') {
        return browserOperationProvenance('browser.timer.cancel');
      }
      return receiver;
    }
    if (receiver === 'unknown-authority') {
      return 'unknown-authority';
    }
    const root = rootIdentifier(member.receiver);
    if (root === 'document') return 'dom';
  }
  return 'unknown';
}

function browserMutationTargetProvenance(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): BrowserValueProvenance {
  const current = unwrapExpression(expression);
  const member = staticMember(current);
  return member
    ? browserExpressionProvenance(member.receiver, aliases, boundary)
    : browserExpressionProvenance(current, aliases, boundary);
}

function bindBrowserAliasPattern(
  name: ts.BindingName,
  provenance: BrowserValueProvenance,
  aliases: Map<string, BrowserValueProvenance>,
): boolean {
  if (ts.isIdentifier(name)) return joinBrowserAlias(name.text, provenance, aliases);
  let changed = false;
  const elements = compilerSnapshotDenseArray(name.elements, 'Security-IR browser bindings');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (ts.isOmittedExpression(element)) continue;
    const childProvenance = browserProvenanceCarriesAuthority(provenance)
      ? provenance === 'state'
        ? 'state'
        : provenance === 'raw-browser'
          ? 'raw-browser'
          : provenance === 'unknown-authority'
            ? 'unknown-authority'
            : provenance
      : 'local';
    if (bindBrowserAliasPattern(element.name, childProvenance, aliases)) changed = true;
  }
  return changed;
}

function joinBrowserAlias(
  name: string,
  provenance: BrowserValueProvenance,
  aliases: Map<string, BrowserValueProvenance>,
): boolean {
  const previous = compilerMapGet(aliases, name);
  if (previous === provenance || previous === 'unknown-authority') return false;
  compilerMapSet(aliases, name, previous === undefined ? provenance : 'unknown-authority');
  return true;
}

function browserProvenanceCarriesAuthority(
  provenance: BrowserValueProvenance | undefined,
): boolean {
  return provenance !== undefined && provenance !== 'local' && provenance !== 'unknown';
}

function browserOperationProvenance(
  kind: BrowserSecurityOperationKind,
): `operation:${BrowserSecurityOperationKind}` {
  return `operation:${kind}`;
}

function browserOperationProvenanceKind(
  provenance: BrowserValueProvenance,
): BrowserSecurityOperationKind | undefined {
  return compilerStringStartsWith(provenance, 'operation:')
    ? (compilerStringSlice(provenance, 'operation:'.length) as BrowserSecurityOperationKind)
    : undefined;
}

function expressionContainsBrowserAuthority(
  expression: ts.Expression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      node !== expression &&
      ts.isExpression(node) &&
      browserExpressionProvenance(node, aliases, boundary) === 'local'
    ) {
      // A finite scalar read (for example event.target.value) has discharged the carrier. Do not
      // rediscover the DOM root by descending through that already-classified value expression.
      return;
    }
    if (
      node !== expression &&
      ts.isExpression(node) &&
      browserExpressionProvenance(node, aliases, boundary) === 'state' &&
      browserStateValueIsConsumedAsScalar(node)
    ) {
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node)
      ) {
        return;
      }
      if (browserProvenanceCarriesAuthority(browserExpressionProvenance(node, aliases, boundary))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return found;
}

function browserStateValueIsConsumedAsScalar(expression: ts.Expression): boolean {
  const parent = expression.parent;
  return (
    ts.isBinaryExpression(parent) ||
    ts.isConditionalExpression(parent) ||
    ts.isTemplateSpan(parent) ||
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent) ||
    ts.isTypeOfExpression(parent)
  );
}

function callArgumentsContainBrowserAuthority(
  call: ts.CallExpression,
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  return browserArgumentsContainAuthority(call.arguments, aliases, boundary);
}

function browserArgumentsContainAuthority(
  argumentsList: readonly ts.Expression[],
  aliases: ReadonlyMap<string, BrowserValueProvenance>,
  boundary: ts.ConciseBody,
): boolean {
  const argumentsSnapshot = compilerSnapshotDenseArray(
    argumentsList,
    'Browser security-operation call arguments',
  );
  for (let index = 0; index < argumentsSnapshot.length; index += 1) {
    const argument = argumentsSnapshot[index]!;
    if (
      browserProvenanceCarriesAuthority(browserExpressionProvenance(argument, aliases, boundary)) ||
      expressionContainsBrowserAuthority(argument, aliases, boundary)
    ) {
      return true;
    }
  }
  return false;
}

function isDomProvenance(value: BrowserValueProvenance): boolean {
  return value === 'dom' || value === 'form';
}

function localBindingNames(node: ts.Node): ReadonlySet<string> {
  const names = compilerCreateSet<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isVariableDeclaration(current) || ts.isParameter(current)) {
      collectBindingNames(current.name, names);
    } else if (
      (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) &&
      current.name
    ) {
      compilerSetAdd(names, current.name.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return names;
}

/**
 * Lexical identity check for the few ambient browser names in the finite IR. A flat name census
 * is not sufficient: a nested shadow must not make an outer `document`/timer use look local, and
 * a sibling shadow must not launder ambient authority. This mirrors the parser's symbol-identity
 * rule without requiring a TypeScript type checker.
 */
function identifierIsShadowedWithinBoundary(identifier: ts.Identifier, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current && current !== boundary) {
    if (
      isSecurityIrLexicalScope(current) &&
      securityIrScopeDeclaresName(current, identifier.text)
    ) {
      return true;
    }
    current = current.parent;
  }
  return securityIrScopeDeclaresName(boundary, identifier.text);
}

function identifierIsShadowedBeforeBoundary(identifier: ts.Identifier, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = identifier.parent;
  while (current && current !== boundary) {
    if (
      isSecurityIrLexicalScope(current) &&
      securityIrScopeDeclaresName(current, identifier.text)
    ) {
      return true;
    }
    current = current.parent;
  }
  return current !== boundary;
}

function securityIrScopeDeclaresName(scope: ts.Node, name: string): boolean {
  let found = false;

  const visitBindingName = (bindingName: ts.BindingName): void => {
    if (ts.isIdentifier(bindingName)) {
      if (bindingName.text === name) found = true;
      return;
    }
    const elements = compilerSnapshotDenseArray(
      bindingName.elements,
      'Security-IR lexical binding elements',
    );
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index]!;
      if (!ts.isOmittedExpression(element)) visitBindingName(element.name);
    }
  };

  const visit = (node: ts.Node, insideNestedLexicalBlock: boolean): void => {
    if (found) return;
    if (node !== scope && isSecurityIrFunctionScope(node)) {
      if (ts.isFunctionDeclaration(node) && node.name && !insideNestedLexicalBlock) {
        visitBindingName(node.name);
      }
      return;
    }
    if (node !== scope && ts.isClassDeclaration(node)) {
      if (node.name && !insideNestedLexicalBlock) visitBindingName(node.name);
      return;
    }
    if (ts.isParameter(node)) visitBindingName(node.name);
    if (ts.isVariableDeclaration(node)) {
      const declarationList = ts.isVariableDeclarationList(node.parent) ? node.parent : undefined;
      const blockScoped =
        declarationList !== undefined && (declarationList.flags & ts.NodeFlags.BlockScoped) !== 0;
      if (!insideNestedLexicalBlock || !blockScoped) visitBindingName(node.name);
    }
    if (ts.isFunctionDeclaration(node) && node.name && !insideNestedLexicalBlock) {
      visitBindingName(node.name);
    }
    if (ts.isClassDeclaration(node) && node.name && !insideNestedLexicalBlock) {
      visitBindingName(node.name);
    }
    const nestedForChildren =
      insideNestedLexicalBlock || (node !== scope && (ts.isBlock(node) || ts.isModuleBlock(node)));
    ts.forEachChild(node, (child) => visit(child, nestedForChildren));
  };

  visit(scope, false);
  return found;
}

function isSecurityIrLexicalScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    isSecurityIrFunctionScope(node)
  );
}

function isSecurityIrFunctionScope(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessor(node) ||
    ts.isSetAccessor(node)
  );
}

function collectBindingNames(name: ts.BindingName, target: Set<string>): void {
  if (ts.isIdentifier(name)) {
    compilerSetAdd(target, name.text);
    return;
  }
  const elements = compilerSnapshotDenseArray(name.elements, 'Security IR binding elements');
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index]!;
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, target);
  }
}

function staticMember(
  expression: ts.Expression,
): { name: string; receiver: ts.Expression } | undefined {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) {
    return { name: current.name.text, receiver: current.expression };
  }
  if (ts.isElementAccessExpression(current) && current.argumentExpression) {
    const key = unwrapExpression(current.argumentExpression);
    if (ts.isStringLiteralLike(key)) return { name: key.text, receiver: current.expression };
  }
  return undefined;
}

function rootIdentifier(expression: ts.Expression): string | undefined {
  let current = unwrapExpression(expression);
  while (true) {
    if (ts.isIdentifier(current)) return current.text;
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = unwrapExpression(current.expression);
      continue;
    }
    if (ts.isCallExpression(current)) {
      const callee = unwrapExpression(current.expression);
      if (ts.isIdentifier(callee) && callee.text === 'Object' && current.arguments[0]) {
        current = unwrapExpression(current.arguments[0]!);
        continue;
      }
    }
    return undefined;
  }
}

function expressionPath(expression: ts.Expression): string | undefined {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  const member = staticMember(current);
  if (!member) return undefined;
  const receiver = expressionPath(member.receiver);
  return receiver ? `${receiver}.${member.name}` : undefined;
}

function browserExpressionTarget(expression: ts.Expression): string | undefined {
  return expressionPath(expression);
}

function nodeName(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text;
  const member = ts.isExpression(node) ? staticMember(node) : undefined;
  return member?.name ?? 'computed';
}

function staticPropertyName(name: ts.PropertyName | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function dedupeBrowserOperations(
  values: readonly BrowserSecurityOperationModel[],
): BrowserSecurityOperationModel[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.kind}\0${value.door}\0${value.target ?? ''}\0${value.span.start}\0${value.span.end}`,
  );
}

function dedupeServerOperations(
  values: readonly ServerSecurityOperationModel[],
): ServerSecurityOperationModel[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.kind}\0${value.door}\0${value.root ?? ''}\0${value.target ?? ''}\0${value.justification ?? ''}\0${value.span.start}\0${value.span.end}`,
  );
}

function dedupeViolations(
  values: readonly SecurityOperationViolationModel[],
): SecurityOperationViolationModel[] {
  return dedupeByKey(
    values,
    (value) =>
      `${value.surface}\0${value.kind}\0${value.detail}\0${value.span.start}\0${value.span.end}`,
  );
}

function dedupeByKey<Value>(values: readonly Value[], keyFor: (value: Value) => string): Value[] {
  const result: Value[] = [];
  const seen = compilerCreateSet<string>();
  const length = compilerArrayLength(values, 'Security IR facts');
  for (let index = 0; index < length; index += 1) {
    const value = compilerOwnDataValue(values, index, 'Security IR facts') as Value | undefined;
    if (value === undefined) throw new TypeError(`Security IR facts[${index}] must be own data.`);
    const key = keyFor(value);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(result, value, 'Security IR facts');
  }
  return result;
}
