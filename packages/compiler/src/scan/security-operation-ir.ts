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
  ServerSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';
import type {
  BrowserSecurityOperationModel,
  HandlerWriteSinkSurface,
  SecurityOperationViolationModel,
  ServerSecurityOperationModel,
} from './model.js';

interface SecurityOperationScanResult<Operation> {
  readonly operations: readonly Operation[];
  readonly violations: readonly SecurityOperationViolationModel[];
}

type BrowserValueProvenance = 'dom' | 'event' | 'form' | 'local' | 'state' | 'unknown';
type ServerValueProvenance =
  | 'context'
  | 'database'
  | 'headers'
  | 'local'
  | 'respond'
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
const browserEventControlMethods = finiteStringSet([
  'preventDefault',
  'stopImmediatePropagation',
  'stopPropagation',
]);
const browserDomReadMethods = finiteStringSet([
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
  'history',
  'localStorage',
  'location',
  'navigator',
  'sessionStorage',
  'window',
]);

/** Scanner/source-text boundary for SPEC §4.3/§5.2 finite browser effects. */
export function scanBrowserSecurityOperations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
): SecurityOperationScanResult<BrowserSecurityOperationModel> {
  const operations: BrowserSecurityOperationModel[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const locals = localBindingNames(body);
  const aliases = browserAliasProvenance(body, locals);

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
      classifyBrowserCall(sourceFile, node, locals, aliases, appendOperation, appendViolation);
    } else if (ts.isNewExpression(node)) {
      const constructor = unwrapExpression(node.expression);
      if (
        !ts.isIdentifier(constructor) ||
        (!compilerSetHas(locals, constructor.text) &&
          !compilerSetHas(browserPureConstructors, constructor.text))
      ) {
        appendViolation(
          node,
          'unknown-security-operation',
          `browser constructor ${nodeName(constructor)} is outside the finite handler IR`,
        );
      }
    } else if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const provenance = browserExpressionProvenance(node.left, aliases);
      if (provenance === 'state') {
        appendOperation('browser.state.write', node.left, browserExpressionTarget(node.left));
      } else if (provenance === 'dom' || provenance === 'form' || provenance === 'event') {
        appendViolation(
          node.left,
          'raw-dom-operation',
          `raw DOM assignment ${browserExpressionTarget(node.left) ?? 'computed'} is not a finite operation`,
        );
      }
    } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      if (
        node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        const operand = node.operand;
        const provenance = browserExpressionProvenance(operand, aliases);
        if (provenance === 'state') {
          appendOperation('browser.state.write', operand, browserExpressionTarget(operand));
        } else if (provenance === 'dom' || provenance === 'form' || provenance === 'event') {
          appendViolation(
            operand,
            'raw-dom-operation',
            `raw DOM update ${browserExpressionTarget(operand) ?? 'computed'} is not a finite operation`,
          );
        }
      }
    } else if (ts.isDeleteExpression(node)) {
      const provenance = browserExpressionProvenance(node.expression, aliases);
      if (provenance === 'state') {
        appendOperation(
          'browser.state.write',
          node.expression,
          browserExpressionTarget(node.expression),
        );
      } else if (provenance === 'dom' || provenance === 'form' || provenance === 'event') {
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
    if (callee.text === 'setTimeout' || callee.text === 'setInterval') {
      appendOperation('browser.timer.schedule', call, callee.text);
      return;
    }
    if (callee.text === 'clearTimeout' || callee.text === 'clearInterval') {
      appendOperation('browser.timer.cancel', call, callee.text);
      return;
    }
    if (
      compilerSetHas(locals, callee.text) ||
      compilerSetHas(browserPureGlobalCalls, callee.text)
    ) {
      return;
    }
    appendOperation('browser.framework.call', call, callee.text);
    return;
  }

  const member = staticMember(callee);
  if (!member) {
    if (browserExpressionProvenance(callee, aliases) !== 'local') {
      appendViolation(
        callee,
        'computed-security-operation',
        'computed browser call target is outside the finite handler IR',
      );
    }
    return;
  }

  // `Object(element)['focus']?.call(element)` is the safe focus idiom used by reviewed primitives.
  const callableMember = staticMember(unwrapExpression(member.receiver));
  if (member.name === 'call' && callableMember) {
    const callableProvenance = browserExpressionProvenance(callableMember.receiver, aliases);
    if (callableMember.name === 'focus' && isDomProvenance(callableProvenance)) {
      appendOperation('browser.dom.focus', call, browserExpressionTarget(callableMember.receiver));
      return;
    }
  }

  const provenance = browserExpressionProvenance(member.receiver, aliases);
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
  }
}

/** Scanner/source-text boundary for structured server effects. */
export function scanServerSecurityOperations(
  sourceFile: ts.SourceFile,
  body: ts.ConciseBody,
  surface: HandlerWriteSinkSurface,
  parameters: readonly ts.ParameterDeclaration[] = [],
): SecurityOperationScanResult<ServerSecurityOperationModel> {
  const operations: ServerSecurityOperationModel[] = [];
  const violations: SecurityOperationViolationModel[] = [];
  const aliases = serverAliasProvenance(body, parameters);
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
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  return {
    operations: dedupeServerOperations(operations),
    violations: dedupeViolations(violations),
  };
}

function classifyServerCall(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  surface: HandlerWriteSinkSurface,
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
  if (ts.isIdentifier(callee)) {
    if (frameworkExportEquals(frameworkIdentity, REDIRECT_IDENTITY)) {
      appendOperation('server.response.redirect', call, 'redirect');
    } else if (frameworkExportEquals(frameworkIdentity, TRUSTED_SQL_IDENTITY)) {
      appendOperation(
        'server.database.trusted-sql',
        call,
        'trustedSql',
        justificationFromCall(call) ?? 'missing',
      );
    } else if (frameworkIdentityIn(frameworkIdentity, TRUSTED_HTML_IDENTITIES)) {
      appendOperation(
        'server.output.trusted-html',
        call,
        'trustedHtml',
        justificationFromCall(call) ?? 'missing',
      );
    } else {
      classifyServerProvenanceCall(
        serverExpressionProvenance(callee, aliases),
        call,
        callee.text,
        surface,
        appendOperation,
        appendViolation,
      );
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
}

function classifyServerProvenanceCall(
  provenance: ServerValueProvenance,
  call: ts.CallExpression,
  target: string,
  surface: HandlerWriteSinkSurface,
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
  if (!compilerStringStartsWith(provenance, 'operation:')) return false;
  const kind = compilerStringSlice(provenance, 'operation:'.length) as ServerSecurityOperationKind;
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
): ReadonlyMap<string, ServerValueProvenance> {
  const aliases = compilerCreateMap<string, ServerValueProvenance>();
  compilerMapSet(aliases, 'Response', 'response-constructor');
  compilerMapSet(aliases, 'context', 'context');
  compilerMapSet(aliases, 'ctx', 'context');
  compilerMapSet(aliases, 'db', 'database');
  compilerMapSet(aliases, 'headers', 'headers');
  compilerMapSet(aliases, 'readonlyAppDb', 'database');
  compilerMapSet(aliases, 'respond', 'respond');
  compilerMapSet(aliases, 'storage', 'storage');
  compilerMapSet(aliases, 'tx', 'database');

  const parameterSnapshot = compilerSnapshotDenseArray(parameters, 'Security-IR parameters');
  for (let index = 0; index < parameterSnapshot.length; index += 1) {
    bindServerAliasPattern(parameterSnapshot[index]!.name, 'local', aliases);
  }
  const contextParameter = parameterSnapshot[1];
  if (contextParameter) bindServerAliasPattern(contextParameter.name, 'context', aliases);

  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        const initializer = node.initializer;
        let provenance: ServerValueProvenance = 'local';
        if (initializer) {
          const derived = serverExpressionProvenance(initializer, aliases);
          const authority = serverProvenanceCarriesAuthority(derived)
            ? derived
            : expressionContainsServerAuthority(initializer, aliases)
              ? 'unknown-authority'
              : 'local';
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
    if (compilerMapGet(aliases, name.text) === provenance) return false;
    compilerMapSet(aliases, name.text, provenance);
    return true;
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
  if (receiver === 'context') {
    if (member === 'db' || member === 'readonlyAppDb' || member === 'tx') return 'database';
    if (member === 'headers') return 'headers';
    if (member === 'respond') return 'respond';
    if (member === 'storage') return 'storage';
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
  if (receiver === 'database') {
    const kind = databaseOperationKind(member);
    return kind ? serverOperationProvenance(kind) : 'unknown-authority';
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

function isConstVariableDeclaration(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

function databaseOperationKind(method: string): ServerSecurityOperationKind | undefined {
  if (
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
    method === 'update'
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

function browserAliasProvenance(
  body: ts.ConciseBody,
  locals: ReadonlySet<string>,
): ReadonlyMap<string, BrowserValueProvenance> {
  const aliases = compilerCreateMap<string, BrowserValueProvenance>();
  compilerMapSet(aliases, 'state', 'state');
  compilerMapSet(aliases, 'event', 'event');
  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const next = browserExpressionProvenance(node.initializer, aliases);
        const previous = compilerMapGet(aliases, node.name.text);
        if (next !== 'unknown' && previous !== next) {
          compilerMapSet(aliases, node.name.text, next);
          changed = true;
        } else if (previous === undefined && compilerSetHas(locals, node.name.text)) {
          compilerMapSet(aliases, node.name.text, 'local');
          changed = true;
        }
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
): BrowserValueProvenance {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return compilerMapGet(aliases, current.text) ?? 'unknown';
  }
  if (ts.isCallExpression(current)) {
    const callee = unwrapExpression(current.expression);
    if (ts.isIdentifier(callee) && compilerMapGet(aliases, callee.text) === 'local') {
      return 'local';
    }
    if (ts.isIdentifier(callee) && callee.text === 'Object') {
      const first = current.arguments[0];
      return first ? browserExpressionProvenance(first, aliases) : 'unknown';
    }
    const member = staticMember(callee);
    if (member) {
      const receiver = browserExpressionProvenance(member.receiver, aliases);
      if (receiver === 'local') return 'local';
      if (member.name === 'closest' || member.name === 'querySelector') {
        return isDomProvenance(receiver) || receiver === 'event' ? 'dom' : 'unknown';
      }
      if (member.name === 'getElementById' && rootIdentifier(member.receiver) === 'document') {
        return 'dom';
      }
    }
  }
  const member = staticMember(current);
  if (member) {
    const receiver = browserExpressionProvenance(member.receiver, aliases);
    if (receiver === 'state') return 'state';
    if (receiver === 'event') {
      if (member.name === 'form') return 'form';
      if (member.name === 'target' || member.name === 'currentTarget') return 'dom';
      return 'event';
    }
    if (receiver === 'dom') return member.name === 'form' ? 'form' : 'dom';
    if (receiver === 'form') return 'form';
    const root = rootIdentifier(member.receiver);
    if (root === 'document') return 'dom';
  }
  return 'unknown';
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
    ts.isSatisfiesExpression(current)
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
      `${value.kind}\0${value.door}\0${value.target ?? ''}\0${value.justification ?? ''}\0${value.span.start}\0${value.span.end}`,
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
